// One live session with an authority: clients keep intents and derive their tracked form again
// with the real `trackedEdits` against the newest confirmed text; the authority orders pushes
// (c1, c2 or naive); the oracle checks every confirmed state.

import { applyChanges } from '@redlines/format';
import { Authority } from './authority.ts';
import type { LogEntry, PushResult, Strategy } from './authority.ts';
import { footprintOf } from './footprint.ts';
import { derive } from './intents.ts';
import type { Intent } from './intents.ts';
import { Clock, DEFAULT_NET, Link, planOutages } from './net.ts';
import type { NetConfig } from './net.ts';
import { INVALID_MARKUP, Oracle } from './oracle.ts';
import type { Code, Violation } from './oracle.ts';
import { Rng } from './rng.ts';
import { PEOPLE, baseDocument } from './text.ts';
import { makeIntent } from './workloads.ts';
import type { Scene, WorkloadName } from './workloads.ts';

export interface SessionConfig {
  seed: number;
  workload: WorkloadName;
  strategy: Strategy;
  /** 3–5. */
  clients?: number;
  /** Operations per client. */
  ops?: number;
  paragraphs?: number;
  words?: number;
  /** Accept and reject carry the mark as seen, and are dropped if it changed (default true). */
  guard?: boolean;
  /** The chance that a client has an offline period of 2–8 s. */
  offlineP?: number;
  /** Also check that the body reads as the newest view does, in micromark. */
  render?: boolean;
  net?: NetConfig;
  /** Keep the log and every confirmed text in the result, for looking at a failure. */
  keep?: boolean;
}

/** Violations that lose, move or invent text for good, as against markup that was invalid for a
 * while. */
const DATA_LOSS: ReadonlySet<Code> = new Set([
  'lost',
  'swallowed',
  'revived',
  'untracked',
  'duplicated',
  'misattributed',
  'decision',
  'ledger',
  'diverged',
  'crash',
  'stuck',
]);

export interface SessionStats {
  confirmed: number;
  turnedAway: Record<string, number>;
  pushes: number;
  rejected: number;
  rebased: number;
  stale: number;
  staleBody: number;
  staleLedgerOnly: number;
  staleWithLedger: number;
  staleLedgerCollides: number;
  ledgerUpdates: number;
  updates: number;
  /** Time from doing something to seeing it confirmed, ms. */
  latencies: number[];
  outages: number;
  /** Operations by kind. */
  byKind: Record<string, number>;
}

export interface SessionResult {
  config: SessionConfig;
  violations: Violation[];
  /** Invalid markup was confirmed at some point. */
  invalidAtAnyPoint: boolean;
  /** Text was lost, duplicated, left untracked, revived or misattributed for good, or the markup
   * is invalid at the end. */
  corruptedAtEnd: boolean;
  converged: boolean;
  finalText: string;
  stats: SessionStats;
  history?: { log: LogEntry[]; snapshots: string[] };
}

interface Inflight {
  pushId: string;
  intent: Intent;
}

class Client {
  confirmed: string;
  version = 0;
  pending: Intent[] = [];
  inflight: Inflight | null = null;
  /** Waits until its copy has caught up to what the authority said was newest. */
  waitFor = 0;
  /** Between a dropped connection and the catch-up that follows. */
  syncing = false;
  /** Catch-ups asked for and not answered. */
  syncs = 0;
  pushCount = 0;
  readonly counter = { words: 0, notes: 0, replies: 0, intents: 0 };

  readonly index: number;
  readonly rng: Rng;
  readonly link: Link;
  private readonly world: World;

  constructor(index: number, rng: Rng, link: Link, base: string, world: World) {
    this.index = index;
    this.rng = rng;
    this.link = link;
    this.world = world;
    this.confirmed = base;
  }

  get id(): string {
    return PEOPLE[this.index]?.handle ?? String(this.index);
  }

  /** The text as the person sees it: the confirmed text with their pending edits written on it. */
  local(): string {
    let text = this.confirmed;
    for (const intent of this.pending) {
      const derived = derive(text, intent, { guard: this.world.guard });
      if (derived.ok) {
        try {
          text = applyChanges(text, derived.changes);
        } catch {
          // A change list that doesn't apply is a bug the push will report.
        }
      }
    }
    return text;
  }

  act(): void {
    const world = this.world;
    const scene: Scene = {
      rng: this.rng,
      workload: world.config.workload,
      who: this.index,
      local: this.local(),
      confirmed: this.confirmed,
      counter: this.counter,
      at: world.clock.now,
      guard: world.guard,
    };
    const intent = makeIntent(scene);
    if (!intent) return;
    world.stats.byKind[intent.body.kind] = (world.stats.byKind[intent.body.kind] ?? 0) + 1;
    this.pending.push(intent);
    this.pushNext();
  }

  pushNext(): void {
    const world = this.world;
    if (!this.link.up || this.syncing || this.inflight || this.version < this.waitFor) return;
    while (this.pending.length > 0) {
      const intent = this.pending[0] as Intent;
      const derived = derive(this.confirmed, intent, { guard: world.guard });
      if (!derived.ok) {
        const why = `${intent.body.kind}:${derived.reason}`;
        world.stats.turnedAway[why] = (world.stats.turnedAway[why] ?? 0) + 1;
        if (derived.crash) world.crash(derived.reason);
        this.pending.shift();
        continue;
      }
      let footprint;
      try {
        footprint = footprintOf(this.confirmed, derived.changes);
      } catch (error) {
        world.crash(`footprint: ${(error as Error).message}`);
        this.pending.shift();
        continue;
      }
      const push = {
        clientId: this.id,
        pushId: `${this.id}#${this.pushCount++}`,
        base: this.version,
        changes: derived.changes,
        footprint,
        summary: derived.summary,
      };
      this.inflight = { pushId: push.pushId, intent };
      this.link.send('up', () => {
        const result = world.authority.push(push);
        this.link.send('down', () => this.onReply(push.pushId, result));
      });
      return;
    }
  }

  onReply(pushId: string, result: PushResult): void {
    if (this.syncing || this.inflight?.pushId !== pushId) return;
    if (result.status === 'invalid') {
      // Changes that don't apply are a bug in the derivation; the intent is given up.
      const why = `${this.inflight.intent.body.kind}:invalid-changes`;
      this.world.stats.turnedAway[why] = (this.world.stats.turnedAway[why] ?? 0) + 1;
      this.world.crash('the authority could not apply a push');
      this.pending.shift();
      this.inflight = null;
      this.pushNext();
      return;
    }
    if (result.status === 'stale') {
      this.inflight = null;
      this.waitFor = result.version;
      this.pushNext();
    }
  }

  onEntry(entry: LogEntry): void {
    if (entry.version <= this.version) return;
    // A gap means the connection dropped; the catch-up after it brings what is missing.
    if (entry.version !== this.version + 1) return;
    this.apply(entry);
    this.pushNext();
  }

  private apply(entry: LogEntry): void {
    const world = this.world;
    this.confirmed = applyChanges(this.confirmed, entry.changes);
    this.version = entry.version;
    if (this.confirmed !== world.authority.snapshots[this.version]) world.diverged(this);
    if (this.inflight?.pushId === entry.pushId) {
      world.stats.latencies.push(world.clock.now - this.inflight.intent.at);
      world.stats.confirmed++;
      this.pending.shift();
      this.inflight = null;
    }
  }

  /** After a dropped connection, or a gap in the updates. */
  catchUp(): void {
    this.syncing = true;
    this.syncs++;
    const world = this.world;
    this.link.send('up', () => {
      const entries = world.authority.since(this.version);
      this.link.send('down', () => this.onCatchUp(entries));
    });
  }

  private onCatchUp(entries: LogEntry[]): void {
    for (const entry of entries) {
      if (entry.version === this.version + 1) this.apply(entry);
    }
    if (--this.syncs > 0) return;
    this.syncing = false;
    // Everything the authority had is here now, so a push still in flight never arrived.
    if (this.inflight) this.inflight = null;
    this.pushNext();
  }
}

class World {
  readonly clock = new Clock();
  readonly authority: Authority;
  readonly oracle: Oracle;
  readonly violations: Violation[] = [];
  readonly guard: boolean;
  readonly stats: SessionStats = {
    confirmed: 0,
    turnedAway: {},
    pushes: 0,
    rejected: 0,
    rebased: 0,
    stale: 0,
    staleBody: 0,
    staleLedgerOnly: 0,
    staleWithLedger: 0,
    staleLedgerCollides: 0,
    ledgerUpdates: 0,
    updates: 0,
    latencies: [],
    outages: 0,
    byKind: {},
  };
  converged = true;

  readonly config: SessionConfig;

  constructor(config: SessionConfig) {
    this.config = config;
    this.guard = config.guard !== false;
    this.authority = new Authority(
      baseDocument(config.paragraphs ?? 5, config.words ?? 12),
      config.strategy,
    );
    this.oracle = new Oracle({ render: config.render !== false });
  }

  crash(detail: string): void {
    this.violations.push({ version: this.authority.version, code: 'crash', detail });
  }

  diverged(client: Client): void {
    this.converged = false;
    this.violations.push({
      version: client.version,
      code: 'diverged',
      detail: `${client.id}'s copy differs from the authority's`,
    });
  }
}

export function runSession(config: SessionConfig): SessionResult {
  const world = new World(config);
  const rng = new Rng(config.seed);
  const count = config.clients ?? 4;
  const ops = config.ops ?? 20;
  const net = config.net ?? DEFAULT_NET;
  const base = world.authority.text;

  world.authority.onConfirm = (entry: LogEntry, before: string, after: string) => {
    try {
      world.violations.push(...world.oracle.step(entry.version, before, after, entry.summary));
      world.violations.push(...world.oracle.state(entry.version, after));
    } catch (error) {
      world.crash(`oracle: ${(error as Error).message}`);
    }
    for (const client of clients) {
      client.link.send('down', () => client.onEntry(entry));
    }
  };

  const span = ops * 1400;
  const clients: Client[] = [];
  for (let i = 0; i < count; i++) {
    const link = new Link(world.clock, rng.fork(), net);
    const client = new Client(i, rng.fork(), link, base, world);
    link.onConnect(() => client.catchUp());
    link.onDisconnect(() => {
      client.syncing = true;
      client.syncs = 0;
    });
    clients.push(client);
    world.stats.outages += planOutages(world.clock, link, rng.fork(), span, config.offlineP ?? 0.4);
    let t = rng.next() * 500;
    for (let n = 0; n < ops; n++) {
      t += 300 + rng.next() * 2200;
      world.clock.at(t, () => client.act());
    }
  }

  const finished = world.clock.run(Infinity, 400_000);
  if (!finished) {
    world.violations.push({
      version: world.authority.version,
      code: 'stuck',
      detail: 'the session did not settle',
    });
  }

  const final = world.authority.text;
  for (const client of clients) {
    if (client.confirmed !== final) world.diverged(client);
    if (client.pending.length > 0) {
      world.violations.push({
        version: world.authority.version,
        code: 'stuck',
        detail: `${client.id} still has ${client.pending.length} intents that were never settled`,
      });
    }
  }
  const endState = world.oracle.state(world.authority.version, final);
  world.violations.push(...endState);

  const a = world.authority.stats;
  Object.assign(world.stats, {
    pushes: a.pushes,
    rejected: a.rejected,
    rebased: a.rebased,
    stale: a.stale,
    staleBody: a.staleBody,
    staleLedgerOnly: a.staleLedgerOnly,
    staleWithLedger: a.staleWithLedger,
    staleLedgerCollides: a.staleLedgerCollides,
    ledgerUpdates: a.ledgerUpdates,
    updates: world.authority.version,
  });

  return {
    config,
    violations: world.violations,
    invalidAtAnyPoint: world.violations.some((v) => INVALID_MARKUP.has(v.code)),
    corruptedAtEnd:
      endState.some((v) => DATA_LOSS.has(v.code) || INVALID_MARKUP.has(v.code)) ||
      world.violations.some((v) => DATA_LOSS.has(v.code)),
    converged: world.converged,
    finalText: final,
    stats: world.stats,
    ...(config.keep
      ? { history: { log: world.authority.log, snapshots: world.authority.snapshots } }
      : {}),
  };
}
