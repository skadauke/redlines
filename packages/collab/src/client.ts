// A window's side of a live session (docs/research/collaboration.md, "Rules for live
// collaboration"). It keeps the person's edits as they are made, sends them to the authority one
// at a time, takes in what everyone else did, and, when the authority turns a push away because
// someone changed what it depends on, has the editor derive the person's edits again on the newest
// text (`rederive`) instead of mapping them through someone else's markers.
//
// The client knows nothing of CodeMirror's view or of marks: the editor's side is given as
// callbacks, so the same client serves a window, a browser tab and the tests.

import type { ChangeSet, Text } from '@codemirror/state';
import { declareFootprint, changedRanges, mapFootprint, touches } from './footprint.ts';
import { FORMAT_VERSION, PROTOCOL_VERSION } from './protocol.ts';
import type { Credential, WireRange } from './protocol.ts';
import type { Pending, Replica } from './replica.ts';
import type { Notice, Reply, Transport } from './wire.ts';

export type SyncState =
  /** Saying hello, or catching up. */
  | 'connecting'
  /** The authority has everything sent here, and this window has everything it has. */
  | 'synced'
  /** Edits are on their way, or the authority's are. */
  | 'syncing'
  /** The authority can't be reached; edits are kept and sent when it can. */
  | 'offline'
  /** The session ended, or this window may not edit in it. */
  | 'ended';

export interface Rederived<T> {
  /** The edits on the confirmed text, in order; ones that could not be placed are left out. */
  pending: Pending<T>[];
  /** What the person is told: where text was kept, what was left out. */
  notices: string[];
}

export interface SyncOptions<T> {
  transport: Transport;
  replica: Replica<T>;
  credential: Credential;
  /** Whether the replica holds the authority's text already: the window that hosts it does. */
  loaded: boolean;
  /**
   * The first `drop` pending edits are not to be kept (the authority said they can't be applied);
   * the rest are derived again on `confirmed`, each on what the ones before it made.
   */
  rederive(confirmed: Text, pending: readonly Pending<T>[], drop: number): Rederived<T>;
  /** Shows others' edits in the editor: changes to what the person sees, over their pending ones. */
  showRemote(changes: ChangeSet): void;
  /** Shows the replica's whole text, after the person's edits were derived again. */
  showAll(doc: Text): void;
  /** The authority's text replaces what the editor holds (a joining window, or a reset). */
  load(text: string): void;
  notice?(message: string): void;
  onState?(state: SyncState): void;
  footprint?(text: string, changes: ChangeSet): WireRange[];
  /** How long to wait before trying again after the authority could not be reached. */
  retryMs?: number;
}

const PULL = 500;

export class SyncClient<T = unknown> {
  readonly #o: SyncOptions<T>;
  readonly #replica: Replica<T>;
  #epoch = 0;
  #joined = false;
  #loaded: boolean;
  #running = false;
  #again = false;
  #mustRederive = false;
  /** The version at which the pending edits were last derived again. */
  #rederivedAt = -1;
  #state: SyncState = 'connecting';
  #stopped = false;
  #retry: ReturnType<typeof setTimeout> | null = null;
  #unsubscribe: (() => void) | null = null;
  #idle: Promise<void> = Promise.resolve();

  constructor(options: SyncOptions<T>) {
    this.#o = options;
    this.#replica = options.replica;
    this.#loaded = options.loaded;
  }

  get state(): SyncState {
    return this.#state;
  }

  get epoch(): number {
    return this.#epoch;
  }

  /** Joins the session and keeps in step with it until `stop`. */
  start(): Promise<void> {
    this.#unsubscribe = this.#o.transport.subscribe((notice) => this.#heard(notice));
    return this.sync();
  }

  /** The person edited: send it. */
  edited(): void {
    void this.sync();
  }

  /** Resolves when everything this window has made is confirmed, or it can't be sent. */
  sync(): Promise<void> {
    if (this.#stopped) return Promise.resolve();
    void this.#cycle();
    return this.#idle;
  }

  async stop(leave = true): Promise<void> {
    if (this.#stopped) return;
    this.#stopped = true;
    this.#unsubscribe?.();
    if (this.#retry) clearTimeout(this.#retry);
    if (leave && this.#joined) {
      try {
        await this.#o.transport.call({ call: 'leave', clientID: this.#replica.clientID });
      } catch {
        // The host is gone; nothing to tell.
      }
    }
  }

  #set(state: SyncState): void {
    if (state === this.#state) return;
    this.#state = state;
    this.#o.onState?.(state);
  }

  #heard(notice: Notice): void {
    if (this.#stopped) return;
    if (notice.kind === 'version') void this.sync();
    else if (notice.kind === 'epoch') {
      this.#joined = false;
      void this.sync();
    } else if (notice.kind === 'ended') this.#set('ended');
  }

  #cycle(): Promise<void> {
    if (this.#running) {
      this.#again = true;
      return this.#idle;
    }
    this.#running = true;
    this.#idle = (async () => {
      try {
        do {
          this.#again = false;
          await this.#step();
        } while (this.#again && !this.#stopped);
      } catch (error) {
        console.error('Sync failed', error);
        this.#offline();
      } finally {
        this.#running = false;
      }
    })();
    return this.#idle;
  }

  #offline(): void {
    this.#joined = false;
    this.#set('offline');
    if (this.#stopped || this.#retry) return;
    this.#retry = setTimeout(() => {
      this.#retry = null;
      void this.sync();
    }, this.#o.retryMs ?? 1000);
  }

  async #call(call: Parameters<Transport['call']>[0]): Promise<Reply | null> {
    try {
      return await this.#o.transport.call(call);
    } catch {
      this.#offline();
      return null;
    }
  }

  async #step(): Promise<void> {
    if (!this.#joined && !(await this.#join())) return;
    for (let round = 0; round < 10_000 && !this.#stopped; round++) {
      if (!(await this.#catchUp())) return;
      if (this.#mustRederive && this.#replica.pending.length) this.#rederiveNow(0);
      this.#mustRederive = false;
      if (!this.#replica.pending.length) {
        this.#set('synced');
        return;
      }
      this.#set('syncing');
      const outcome = await this.#pushHead();
      if (outcome === 'stop') return;
    }
  }

  async #join(): Promise<boolean> {
    this.#set('connecting');
    const { replica } = this;
    const reply = await this.#call({
      call: 'hello',
      request: {
        credential: this.#o.credential,
        clientID: replica.clientID,
        protocol: PROTOCOL_VERSION,
        format: FORMAT_VERSION,
        version: replica.version,
        epoch: this.#epoch,
      },
    });
    if (!reply) return false;
    if (!reply.ok) {
      this.#set('ended');
      this.#o.notice?.(reply.message);
      return false;
    }
    if (!('reset' in reply)) return false;
    this.#epoch = reply.epoch;
    // A newer epoch that kept this log (a takeover) needs no more than a new epoch to push in.
    const keeps = this.#loaded && replica.version <= reply.version;
    if ((reply.reset && !keeps) || !this.#loaded) {
      const document = await this.#call({ call: 'getDocument', clientID: replica.clientID });
      if (!document) return false;
      if (!document.ok || !('text' in document)) {
        this.#set('ended');
        return false;
      }
      const lost = replica.pending.length;
      replica.reset(document.text, document.version);
      this.#o.load(document.text);
      this.#epoch = document.epoch;
      this.#loaded = true;
      if (lost) this.#o.notice?.('Your last edits could not be kept: the session started over.');
    }
    this.#joined = true;
    return true;
  }

  get replica(): Replica<T> {
    return this.#replica;
  }

  /** Pulls what the log has past this window's version and takes it in. False if it couldn't. */
  async #catchUp(): Promise<boolean> {
    const { replica } = this;
    const reply = await this.#call({
      call: 'pull',
      clientID: replica.clientID,
      since: replica.version,
      limit: PULL,
    });
    if (!reply) return false;
    if (!reply.ok) {
      if (reply.error === 'ended') this.#set('ended');
      else if (reply.error === 'stale' || reply.error === 'forbidden') {
        this.#joined = false;
        this.#again = true;
      }
      return false;
    }
    if (!('updates' in reply)) return false;
    let shown: ChangeSet | null = null;
    for (const update of reply.updates) {
      if (update.version <= replica.version) continue;
      if (update.clientID !== replica.clientID && this.#touchesPending(update.footprint)) {
        this.#mustRederive = true;
      }
      const change = replica.receive([update]);
      if (change) shown = shown ? shown.compose(change) : change;
    }
    if (shown) this.#o.showRemote(shown);
    // A full page means more: go on until the log has been read to its end.
    if (reply.updates.length >= PULL) return this.#catchUp();
    return true;
  }

  /** Whether an update of the log, over the confirmed text, touches what is pending. */
  #touchesPending(footprint: readonly WireRange[]): boolean {
    let theirs: readonly WireRange[] = footprint;
    for (const edit of this.#replica.pending) {
      if (touches(changedRanges(edit.changes), theirs)) return true;
      theirs = mapFootprint(theirs, edit.changes);
    }
    return false;
  }

  #rederiveNow(drop: number): void {
    const { replica } = this;
    const result = this.#o.rederive(replica.confirmed, replica.pending, drop);
    replica.pending = result.pending;
    this.#rederivedAt = replica.version;
    this.#o.showAll(replica.text);
    for (const message of result.notices) this.#o.notice?.(message);
  }

  /** Sends the oldest pending edit. `stop` when the cycle can't go on. */
  async #pushHead(): Promise<'go' | 'stop'> {
    const { replica } = this;
    const head = replica.pending[0];
    if (!head) return 'go';
    const text = replica.confirmed.toString();
    let footprint: WireRange[];
    try {
      footprint = (this.#o.footprint ?? declareFootprint)(text, head.changes);
    } catch {
      footprint = changedRanges(head.changes);
    }
    const reply = await this.#call({
      call: 'push',
      clientID: replica.clientID,
      request: {
        version: replica.version,
        epoch: this.#epoch,
        updates: [{ changes: head.changes.toJSON(), clientID: replica.clientID, footprint }],
      },
    });
    if (!reply) return 'stop';
    if (reply.ok) return 'go';
    switch (reply.error) {
      case 'stale':
        if (reply.reason === 'epoch') {
          this.#joined = false;
          return (await this.#join()) ? 'go' : 'stop';
        }
        // Derived again once on what the log holds; turned away still at the same version, the
        // edit can't be placed there.
        if (this.#rederivedAt === replica.version && reply.version === replica.version) {
          this.#rederiveNow(1);
          this.#o.notice?.('An edit of yours could not be placed after what others changed.');
        } else {
          this.#mustRederive = true;
        }
        return 'go';
      case 'invalid':
      case 'too-large':
        this.#rederiveNow(1);
        this.#o.notice?.('An edit of yours could not be sent, and was taken back.');
        return 'go';
      case 'rate-limited':
        await new Promise((resolve) => setTimeout(resolve, reply.retryAfterMs ?? 200));
        return 'go';
      case 'forbidden':
        this.#set('ended');
        this.#o.notice?.(reply.message);
        return 'stop';
      case 'ended':
        this.#set('ended');
        return 'stop';
      default:
        this.#o.notice?.(reply.message);
        return 'stop';
    }
  }
}
