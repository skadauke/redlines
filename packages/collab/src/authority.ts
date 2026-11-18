// The session authority (docs/research/multiuser.md §4.1, collaboration.md "Rules for live
// collaboration"). It orders, persists and broadcasts; it never transforms tracked changes. It
// appends a push based on the current version, rebases a stale push one logged update at a time and
// only if its footprint touches no update logged since its base, and checks every update with the
// format library before it logs it. Pure TypeScript: no timers, no I/O but the log it is given.

import { ChangeSet, Text } from '@codemirror/state';
import { parse } from '@redlines/format';
import type { Parsed } from '@redlines/format';
import { changedRanges, mapFootprint, readFootprint, touches } from './footprint.ts';
import type { Footprint } from './footprint.ts';
import {
  FORMAT_VERSION,
  MIN_FORMAT_VERSION,
  MIN_PROTOCOL_VERSION,
  PROTOCOL_VERSION,
} from './protocol.ts';
import type {
  Credential,
  Decision,
  ErrorCode,
  GetDocumentReply,
  HelloReply,
  HelloRequest,
  Identity,
  Peer,
  PresenceReply,
  PresenceState,
  ProtocolError,
  PullReply,
  PushReply,
  PushRequest,
  WireRange,
  WireUpdate,
} from './protocol.ts';
import { reviewCheck } from './review.ts';
import type { DecidedRecord } from './review.ts';
import { MemoryLog } from './wal.ts';
import type { UpdateRecord, WalRecord, WriteAheadLog } from './wal.ts';
import { rebaseUpdates } from './vendor/collab.ts';
import type { Update } from './vendor/collab.ts';

export interface Limits {
  /** Updates in one push. */
  maxUpdates: number;
  /** Characters a push inserts, all its updates together. */
  maxInserted: number;
  /** The text's length after an update. */
  maxDocument: number;
  /** The JSON length of a presence state. */
  maxPresence: number;
  /** Ranges in one footprint. */
  maxFootprint: number;
  /** The JSON length of an update's entries and decision. */
  maxEntries: number;
  /** Pushes per window, per client. */
  rateMax: number;
  rateWindowMs: number;
  /** How long a presence state lives without being sent again. */
  presenceTtlMs: number;
}

export const DEFAULT_LIMITS: Limits = {
  maxUpdates: 100,
  maxInserted: 256_000,
  maxDocument: 8_000_000,
  maxPresence: 4_000,
  maxFootprint: 1_000,
  maxEntries: 64_000,
  rateMax: 200,
  rateWindowMs: 10_000,
  presenceTtlMs: 30_000,
};

/** What `authenticate` answers: who the credential is, or why it isn't accepted. */
export type AuthResult = Identity | { error: 'token-expired' | 'forbidden' };

/** What a check of a push is given. It returns a reason to refuse it, or null. */
export interface PushContext {
  identity: Identity;
  update: WireUpdate;
  beforeText: string;
  afterText: string;
  before: Parsed;
  after: Parsed;
  changes: ChangeSet;
  /** The decisions the log holds, by mark id: the first one wins. */
  decided: ReadonlyMap<string, DecidedRecord>;
}

/** A refusal: `forbidden` (stop), `invalid`, or `stale` with a reason and detail. */
export type PushRefusal = {
  error: 'forbidden' | 'invalid' | 'stale';
  message: string;
  reason?: ProtocolError['reason'];
  detail?: unknown;
};

export type PushCheck = (context: PushContext) => PushRefusal | null;

export interface AuthorityOptions {
  /** The text at version 0. */
  base: string;
  authenticate: (credential: Credential) => AuthResult;
  wal?: WriteAheadLog;
  /** The epoch to start in, when the log holds none. */
  epoch?: number;
  now?: () => number;
  limits?: Partial<Limits>;
  /** Extra checks on every update, after the format check. */
  check?: PushCheck;
}

interface Session {
  identity: Identity;
}

interface LogEntry {
  record: UpdateRecord;
  changes: ChangeSet;
}

interface Pending {
  wire: WireUpdate;
  update: Update;
  footprint: Footprint;
  entries: unknown;
  decision: Decision | undefined;
}

function error(
  code: ErrorCode,
  message: string,
  extra: Partial<ProtocolError> = {},
): ProtocolError {
  return { ok: false, error: code, message, ...extra };
}

const warningKeys = (parsed: Parsed): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const w of parsed.warnings) {
    const key = `${w.code}|${w.id ?? ''}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
};

/** The warnings `after` has that `before` didn't. */
function newWarnings(before: Parsed, after: Parsed): string[] {
  const had = warningKeys(before);
  const added: string[] = [];
  for (const [key, n] of warningKeys(after)) {
    if (n > (had.get(key) ?? 0)) added.push(key);
  }
  return added;
}

export class Authority {
  private readonly options: AuthorityOptions;
  private readonly limits: Limits;
  private readonly wal: WriteAheadLog;
  private readonly now: () => number;
  private readonly log: LogEntry[] = [];
  /** The text's length at each version. */
  private readonly lengths: number[];
  private doc: Text;
  private parsedAt: { version: number; parsed: Parsed } | null = null;
  private currentEpoch: number;
  private closed = false;
  private readonly decided = new Map<string, DecidedRecord>();
  private readonly sessions = new Map<string, Session>();
  private readonly presences = new Map<string, { state: PresenceState; at: number }>();
  private readonly pushTimes = new Map<string, number[]>();

  constructor(options: AuthorityOptions) {
    this.options = options;
    this.limits = { ...DEFAULT_LIMITS, ...options.limits };
    this.wal = options.wal ?? new MemoryLog();
    this.now = options.now ?? (() => Date.now());
    this.doc = Text.of(options.base.split('\n'));
    this.lengths = [this.doc.length];
    this.currentEpoch = options.epoch ?? 1;
    this.replay();
  }

  /** Reads the log back: the same text, version and epoch as before a restart. */
  private replay(): void {
    for (const record of this.wal.records()) {
      if (record.kind === 'epoch') {
        this.currentEpoch = Math.max(this.currentEpoch, record.epoch);
        continue;
      }
      if (record.version !== this.log.length + 1) {
        throw new Error(
          `The log is not in order: version ${record.version} after ${this.log.length}`,
        );
      }
      const changes = ChangeSet.fromJSON(record.changes);
      if (changes.length !== this.doc.length) {
        throw new Error(`The log's version ${record.version} doesn't fit the text it follows`);
      }
      this.doc = changes.apply(this.doc);
      this.log.push({ record, changes });
      this.lengths.push(this.doc.length);
      this.noteDecision(record);
      this.currentEpoch = Math.max(this.currentEpoch, record.epoch);
    }
  }

  /**
   * Starts the next epoch from a prefix of a log: the first `upTo` versions (all of them by
   * default) of `records`. Everyone who held a longer log, or the old epoch, is turned away
   * until it says `hello` again. The new authority writes the prefix and the new epoch to `wal`.
   */
  static takeover(
    options: AuthorityOptions & { records: readonly WalRecord[]; upTo?: number },
  ): Authority {
    const { records, upTo, ...rest } = options;
    let epoch = options.epoch ?? 0;
    for (const record of records)
      epoch = Math.max(epoch, record.kind === 'epoch' ? record.epoch : record.epoch);
    const wal = rest.wal ?? new MemoryLog();
    let versions = 0;
    for (const record of records) {
      if (record.kind === 'update') {
        if (upTo !== undefined && versions >= upTo) break;
        versions++;
      }
      wal.append(record);
    }
    wal.append({ kind: 'epoch', epoch: epoch + 1 });
    return new Authority({ ...rest, wal, epoch: epoch + 1 });
  }

  get version(): number {
    return this.log.length;
  }
  get epoch(): number {
    return this.currentEpoch;
  }
  get text(): string {
    return this.doc.toString();
  }
  get ended(): boolean {
    return this.closed;
  }

  /** The host closes the session. Every later call answers `ended`. */
  end(): void {
    this.closed = true;
    this.sessions.clear();
    this.presences.clear();
  }

  // --- messages -----------------------------------------------------------------------------

  hello(request: HelloRequest): HelloReply | ProtocolError {
    if (this.closed) return error('ended', 'The session has ended.');
    if (
      !isObject(request) ||
      !Number.isInteger(request.protocol) ||
      !Number.isInteger(request.format)
    ) {
      return error('invalid', 'A hello says which protocol and format it speaks.');
    }
    if (!isObject(request.credential)) return error('invalid', 'A hello carries a credential.');
    if (request.protocol < MIN_PROTOCOL_VERSION || request.format < MIN_FORMAT_VERSION) {
      return error('update-required', 'This version of Redlines is too old for the session.');
    }
    if (request.protocol > PROTOCOL_VERSION || request.format > FORMAT_VERSION) {
      return error('update-required', 'The session is older than this version of Redlines.');
    }
    if (typeof request.clientID !== 'string' || request.clientID === '') {
      return error('invalid', 'A client needs an id.');
    }
    const who = this.options.authenticate(request.credential);
    if ('error' in who) {
      return error(
        who.error,
        who.error === 'token-expired' ? 'The token has expired.' : 'No access.',
      );
    }
    const known = this.sessions.get(request.clientID);
    if (known && known.identity.handle !== who.handle) {
      return error('forbidden', 'That client id belongs to someone else.');
    }
    this.sessions.set(request.clientID, { identity: who });
    const reset = request.epoch !== this.currentEpoch || request.version > this.version;
    return {
      ok: true,
      role: who.role,
      person: { handle: who.handle, name: who.name, ...(who.color ? { color: who.color } : {}) },
      epoch: this.currentEpoch,
      version: this.version,
      reset,
    };
  }

  getDocument(clientID: string): GetDocumentReply | ProtocolError {
    const refused = this.session(clientID);
    if ('ok' in refused) return refused;
    return { ok: true, text: this.text, version: this.version, epoch: this.currentEpoch };
  }

  pull(clientID: string, since: number, limit = Infinity): PullReply | ProtocolError {
    const refused = this.session(clientID);
    if ('ok' in refused) return refused;
    if (!Number.isInteger(since) || since < 0 || since > this.version) {
      return error('stale', 'That version is not in the log.', {
        reason: 'version',
        version: this.version,
        epoch: this.currentEpoch,
      });
    }
    const updates = this.log.slice(since, since + limit).map(({ record }) => ({
      version: record.version,
      changes: record.changes,
      clientID: record.clientID,
      by: record.by,
      at: record.at,
      footprint: record.footprint,
      ...(record.entries !== undefined ? { entries: record.entries } : {}),
      ...(record.decision ? { decision: record.decision } : {}),
    }));
    return { ok: true, version: this.version, epoch: this.currentEpoch, updates };
  }

  push(clientID: string, request: PushRequest): PushReply | ProtocolError {
    const found = this.session(clientID);
    if ('ok' in found) return found;
    const { identity } = found;
    const where = { version: this.version, epoch: this.currentEpoch };
    if (identity.role === 'viewer') return error('forbidden', 'Viewers can not edit.', where);
    if (!isObject(request) || !Number.isInteger(request.epoch)) {
      return error('invalid', 'Not a push.', where);
    }
    if (request.epoch !== this.currentEpoch) {
      return error('stale', 'The session moved to another epoch.', { ...where, reason: 'epoch' });
    }
    if (
      !Number.isInteger(request.version) ||
      request.version < 0 ||
      request.version > this.version
    ) {
      return error('stale', 'The push is based on a version the log has not reached.', {
        ...where,
        reason: 'version',
      });
    }
    const sent: unknown = request.updates;
    if (!Array.isArray(sent) || sent.length === 0 || !sent.every(isObject)) {
      return error('invalid', 'A push holds at least one update.', where);
    }
    if (request.updates.length > this.limits.maxUpdates) {
      return error('too-large', 'Too many updates in one push.', where);
    }
    const limited = this.rateLimit(clientID, request.updates.length);
    if (limited) return limited;

    // Read the updates.
    const parsed: Pending[] = [];
    let length = this.lengths[request.version] ?? 0;
    let inserted = 0;
    for (const wire of request.updates) {
      if (wire.clientID !== clientID) {
        return error('forbidden', 'An update names another client.', where);
      }
      let changes: ChangeSet;
      try {
        changes = ChangeSet.fromJSON(wire.changes);
      } catch {
        return error('invalid', 'An update is not a change.', where);
      }
      if (!Number.isSafeInteger(changes.newLength) || changes.newLength < 0) {
        return error('invalid', 'An update is not a change.', where);
      }
      if (changes.length !== length) {
        return error('invalid', 'An update does not fit the text it follows.', where);
      }
      inserted += insertedLength(changes);
      if (inserted > this.limits.maxInserted)
        return error('too-large', 'The push is too big.', where);
      if (changes.newLength > this.limits.maxDocument) {
        return error('too-large', 'The document would be too big.', where);
      }
      // What the client says it depends on, and always what it changes.
      const declared: unknown = wire.footprint;
      if (Array.isArray(declared) && declared.length > this.limits.maxFootprint) {
        return error('too-large', 'The footprint is too big.', where);
      }
      const read = declared === undefined ? [] : readFootprint(declared, length);
      if (read === null) return error('invalid', 'A footprint is not a list of ranges.', where);
      const footprint = [...read, ...changedRanges(changes)];
      if (!jsonFits([wire.entries, wire.decision], this.limits.maxEntries)) {
        return error('too-large', 'The entries or the decision are too big, or not JSON.', where);
      }
      length = changes.newLength;
      parsed.push({
        wire,
        update: { changes, clientID },
        footprint,
        entries: wire.entries,
        decision: wire.decision,
      });
    }

    // Rebase over what was logged since the base, one update at a time.
    let pending = parsed;
    let duplicates = 0;
    const over = this.log.slice(request.version);
    for (const logged of over) {
      const head = pending[0];
      if (head && head.update.clientID === logged.record.clientID) {
        pending = pending.slice(1);
        duplicates++;
        continue;
      }
      if (!pending.length) break;
      // The logged update's footprint, moved to where each pending update applies.
      let theirs: Footprint = logged.record.footprint;
      for (const p of pending) {
        // A decision is judged by the guard, which reads the marks as they are now.
        if (!p.decision && touches(p.footprint, theirs)) {
          return error('stale', 'An update since the base touches this push.', {
            ...where,
            reason: 'footprint',
          });
        }
        theirs = mapFootprint(theirs, p.update.changes);
      }
      const moved = rebaseUpdates(
        pending.map((p) => p.update),
        [{ changes: logged.changes.desc, clientID: logged.record.clientID }],
      );
      // Footprints follow their updates over the logged one.
      let through = logged.changes.desc;
      pending = pending.map((p, i) => {
        const update = moved[i];
        if (!update) throw new Error('rebase lost an update');
        const mapped = mapFootprint(p.footprint, through);
        through = through.mapDesc(p.update.changes, true);
        return { ...p, update, footprint: mapped };
      });
    }
    const rebased = over.length > duplicates;

    // Check each update against the text it makes, and log them or none.
    const records: Pending[] = [];
    let doc = this.doc;
    let before = this.currentParsed();
    let beforeText = this.text;
    for (const p of pending) {
      if (p.update.changes.newLength > this.limits.maxDocument) {
        return error('too-large', 'The document would be too big.', where);
      }
      doc = p.update.changes.apply(doc);
      const afterText = doc.toString();
      const after = parse(afterText);
      const refusal = this.check({
        identity,
        update: p.wire,
        beforeText,
        afterText,
        before,
        after,
        changes: p.update.changes,
        decided: this.decided,
      });
      if (refusal) {
        return error(refusal.error, refusal.message, {
          ...where,
          ...(refusal.reason ? { reason: refusal.reason } : {}),
          ...(refusal.detail !== undefined ? { detail: refusal.detail } : {}),
        });
      }
      const added = newWarnings(before, after);
      if (added.length) {
        return error('invalid', `The update would break the file: ${added.join(', ')}.`, where);
      }
      records.push(p);
      before = after;
      beforeText = afterText;
    }

    for (const p of records) {
      const record: UpdateRecord = {
        kind: 'update',
        epoch: this.currentEpoch,
        version: this.log.length + 1,
        clientID,
        by: identity.handle,
        at: this.now(),
        changes: p.update.changes.toJSON(),
        footprint: p.footprint,
        ...(p.entries !== undefined ? { entries: p.entries } : {}),
        ...(p.decision ? { decision: p.decision } : {}),
      };
      this.wal.append(record);
      this.doc = p.update.changes.apply(this.doc);
      this.log.push({ record, changes: p.update.changes });
      this.lengths.push(this.doc.length);
      this.noteDecision(record);
      this.parsedAt = null;
    }
    return {
      ok: true,
      status: rebased ? 'rebased' : 'accepted',
      duplicates,
      version: this.version,
      epoch: this.currentEpoch,
    };
  }

  /**
   * Carets, selections and the like. Never stored: they are kept in memory, expire, and are
   * dropped with the session. The reply is everyone else's.
   */
  presence(clientID: string, state: PresenceState | null): PresenceReply | ProtocolError {
    const found = this.session(clientID);
    if ('ok' in found) return found;
    const time = this.now();
    if (state === null) {
      this.presences.delete(clientID);
    } else {
      if (!jsonFits(state, this.limits.maxPresence)) {
        return error('too-large', 'The presence state is too big.');
      }
      this.presences.set(clientID, { state, at: time });
    }
    return { ok: true, peers: this.peers(clientID) };
  }

  /** The presence states of everyone but `clientID`, without changing any: what `presence` answers. */
  peers(clientID: string): Peer[] {
    const time = this.now();
    const peers: Peer[] = [];
    for (const [id, held] of this.presences) {
      if (time - held.at > this.limits.presenceTtlMs) {
        this.presences.delete(id);
        continue;
      }
      const other = this.sessions.get(id);
      if (id === clientID || !other) continue;
      const { handle, name, color } = other.identity;
      peers.push({ clientID: id, handle, name, ...(color ? { color } : {}), state: held.state });
    }
    return peers;
  }

  // --- helpers ------------------------------------------------------------------------------

  private session(clientID: string): Session | ProtocolError {
    if (this.closed) return error('ended', 'The session has ended.');
    const found = this.sessions.get(clientID);
    if (!found) return error('forbidden', 'Say hello first.');
    return found;
  }

  private check(context: PushContext): PushRefusal | null {
    return reviewCheck(context) ?? this.options.check?.(context) ?? null;
  }

  private noteDecision(record: UpdateRecord): void {
    const { decision } = record;
    if (!decision) return;
    for (const id of decision.ids) {
      if (!this.decided.has(id)) {
        this.decided.set(id, { by: record.by, kind: decision.kind, version: record.version });
      }
    }
  }

  private currentParsed(): Parsed {
    if (!this.parsedAt || this.parsedAt.version !== this.version) {
      this.parsedAt = { version: this.version, parsed: parse(this.text) };
    }
    return this.parsedAt.parsed;
  }

  private rateLimit(clientID: string, weight: number): ProtocolError | null {
    const time = this.now();
    const recent = (this.pushTimes.get(clientID) ?? []).filter(
      (t) => time - t < this.limits.rateWindowMs,
    );
    if (recent.length >= this.limits.rateMax) {
      this.pushTimes.set(clientID, recent);
      const oldest = recent[0] ?? time;
      return error('rate-limited', 'Too many pushes.', {
        retryAfterMs: Math.max(1, this.limits.rateWindowMs - (time - oldest)),
        version: this.version,
        epoch: this.currentEpoch,
      });
    }
    for (let i = 0; i < weight; i++) recent.push(time);
    this.pushTimes.set(clientID, recent);
    return null;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Whether `value` is JSON (no cycles, no BigInt) and no longer than `most` characters. */
function jsonFits(value: unknown, most: number): boolean {
  try {
    return (JSON.stringify(value) ?? '').length <= most;
  } catch {
    return false;
  }
}

/** The characters a change inserts. */
function insertedLength(changes: ChangeSet): number {
  let n = 0;
  changes.iterChanges((_from, _to, _a, _b, text) => {
    n += text.length;
  });
  return n;
}

export type { WireRange };
