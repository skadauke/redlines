// The no-host replay merge with Yjs as the intent log (research: collaboration.md, "Yjs as the
// intent log"). Each replica keeps a `Y.Array` of intents in a `Y.Doc`. Replicas exchange Yjs
// updates over the simulator's links (flooded as in replay.ts, and the two ends of a link that
// comes back exchange a state vector and the update it asks for, which is Yjs's sync protocol).
// The text is never merged by Yjs: it is the first text with every intent derived again, in the
// log's order, with the real `trackedEdits`.
//
// Two orders are tried:
//  - `array`: the order is the Y.Array's merged order. Intents carry no Lamport time.
//  - `lamport`: Yjs only carries and deduplicates intents; they are sorted by Lamport time and
//    replica as in replay.ts, so the order is the same as the plain log's.

import * as Y from 'yjs';
import { applyChanges } from '@redlines/format';
import { derive } from './intents.ts';
import type { Intent } from './intents.ts';
import { Clock, DEFAULT_NET, Link } from './net.ts';
import { INVALID_MARKUP, Oracle } from './oracle.ts';
import type { Code, Violation } from './oracle.ts';
import type { ReplayConfig, ReplayResult, ReplayStats } from './replay.ts';
import { Rng } from './rng.ts';
import { baseDocument } from './text.ts';
import { makeIntent } from './workloads.ts';
import type { Scene } from './workloads.ts';

export type LogOrder = 'array' | 'lamport';

export interface YjsReplayConfig extends ReplayConfig {
  order?: LogOrder;
  /** Yjs's garbage collection of deleted content (nothing is deleted here, so it only matters in
   * compaction experiments). */
  gc?: boolean;
}

export interface YOp {
  id: string;
  replica: number;
  lamport?: number;
  intent: Intent;
}

export interface YjsStats extends ReplayStats {
  /** The steps a replica really redoes when a batch arrives (the plain log's `rewound` is per
   * intent; this is per batch, where a reconnect brings many intents at once). */
  rederived: number;
  /** Replicas that ended with updates still held back for what they depend on. */
  heldBack: number;
  /** Bytes of the Yjs documents at the end, per replica (mean), and the plain log's JSON. */
  docBytes: number;
  plainBytes: number;
  /** Updates received that changed nothing (duplicates). */
  duplicates: number;
}

export interface YjsReplayResult extends Omit<ReplayResult, 'stats'> {
  stats: YjsStats;
  /** The order of the final log, ids. */
  order: string[];
}

interface Node {
  text: string;
  depth: number;
  oracle: Oracle;
  children: Map<string, Node>;
  applied: boolean;
  reason: string;
  shown: boolean;
}

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

const lamportBefore = (a: YOp, b: YOp): number =>
  (a.lamport ?? 0) - (b.lamport ?? 0) || a.replica - b.replica;

class YReplica {
  readonly index: number;
  readonly world: YWorld;
  readonly doc: Y.Doc;
  readonly arr: Y.Array<YOp>;
  order: YOp[] = [];
  readonly ids = new Set<string>();
  lamport = 0;
  node: Node;
  readonly counter = { words: 0, notes: 0, replies: 0, intents: 0 };
  readonly rng: Rng;

  constructor(index: number, world: YWorld, rng: Rng) {
    this.index = index;
    this.world = world;
    this.rng = rng;
    this.node = world.root;
    this.doc = new Y.Doc({ gc: world.config.gc !== false });
    // Deterministic, and in the same order as the replica indices.
    this.doc.clientID = 1000 + index;
    this.arr = this.doc.getArray<YOp>('log');
    this.arr.observe(() => this.changed());
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      for (const peer of world.replicas) {
        if (peer !== this && peer !== origin) world.send(this, peer, update);
      }
    });
  }

  get text(): string {
    return this.node.text;
  }

  private currentOrder(): YOp[] {
    const all = this.arr.toArray();
    return this.world.config.order === 'lamport' ? all.sort(lamportBefore) : all;
  }

  /** After a transaction that changed the log: the new order, and the text derived from it. */
  private changed(): void {
    const next = this.currentOrder();
    const old = this.order;
    const stats = this.world.stats;
    if (next.length === old.length) return;
    // Where the new order first differs from the old one.
    let d = 0;
    while (d < old.length && d < next.length && (old[d] as YOp).id === (next[d] as YOp).id) d++;
    // Per intent: it slots in before one already derived when an old intent follows it.
    let oldAfter = old.length;
    for (const op of next) {
      if (this.ids.has(op.id)) {
        oldAfter--;
        continue;
      }
      stats.merges++;
      if (oldAfter > 0) {
        stats.rewrites++;
        stats.rewound += oldAfter;
      }
    }
    stats.rederived += old.length - d;
    for (const op of next) {
      if (this.ids.has(op.id)) continue;
      this.ids.add(op.id);
      this.lamport = Math.max(this.lamport, op.lamport ?? 0);
      if (op.replica !== this.index) this.world.learned(op, this);
    }
    this.order = next;
    let node = this.world.root;
    for (const op of next) node = this.world.step(node, op);
    this.node = node;
    this.world.show(node);
  }

  act(): void {
    const world = this.world;
    const scene: Scene = {
      rng: this.rng,
      workload: world.config.workload,
      who: this.index,
      local: this.text,
      confirmed: this.text,
      counter: this.counter,
      at: world.clock.now,
      guard: world.guard,
    };
    const intent = makeIntent(scene);
    if (!intent) return;
    world.stats.byKind[intent.body.kind] = (world.stats.byKind[intent.body.kind] ?? 0) + 1;
    const op: YOp = { id: intent.id, replica: this.index, intent };
    if (world.config.order === 'lamport') op.lamport = ++this.lamport;
    world.created.set(op.id, world.clock.now);
    this.doc.transact(() => this.arr.push([op]), this);
    world.localApplied.set(op.id, this.node.applied);
  }

  receive(update: Uint8Array, from: YReplica): void {
    const before = this.arr.length;
    Y.applyUpdate(this.doc, update, from);
    if (this.arr.length === before) this.world.stats.duplicates++;
  }

  /** After a link comes back: send the state vector, and the other end answers with the rest. */
  sync(peer: YReplica): void {
    const world = this.world;
    const link = world.linkBetween(this, peer);
    const sv = Y.encodeStateVector(this.doc);
    world.stats.bytes.sync += sv.length;
    world.stats.bytes.messages++;
    link.send(world.direction(this, peer), () => {
      const diff = Y.encodeStateAsUpdate(peer.doc, sv);
      world.stats.bytes.sync += diff.length;
      world.stats.bytes.messages++;
      link.send(world.direction(peer, this), () => this.receive(diff, peer));
    });
  }
}

class YWorld {
  readonly clock = new Clock();
  readonly config: YjsReplayConfig;
  readonly guard: boolean;
  readonly root: Node;
  readonly replicas: YReplica[] = [];
  readonly violations: Violation[] = [];
  readonly created = new Map<string, number>();
  readonly localApplied = new Map<string, boolean>();
  readonly informed = new Map<string, Set<number>>();
  readonly links = new Map<string, Link>();
  readonly stats: YjsStats = {
    byKind: {},
    turnedAway: {},
    rewrites: 0,
    merges: 0,
    rewound: 0,
    vanished: 0,
    appeared: 0,
    intents: 0,
    applied: 0,
    latencies: [],
    outages: 0,
    derived: 0,
    bytes: { messages: 0, ops: 0, sync: 0 },
    rederived: 0,
    heldBack: 0,
    docBytes: 0,
    plainBytes: 0,
    duplicates: 0,
  };

  constructor(config: YjsReplayConfig) {
    this.config = config;
    this.guard = config.guard !== false;
    this.root = {
      text: baseDocument(config.paragraphs ?? 5, config.words ?? 12),
      depth: 0,
      oracle: new Oracle({ render: config.render !== false }),
      children: new Map(),
      applied: false,
      reason: '',
      shown: true,
    };
  }

  step(parent: Node, op: YOp): Node {
    const known = parent.children.get(op.id);
    if (known) return known;
    const derived = derive(parent.text, op.intent, { guard: this.guard });
    let child: Node;
    if (derived.ok) {
      this.stats.derived++;
      let text = parent.text;
      try {
        text = applyChanges(parent.text, derived.changes);
      } catch {
        this.violations.push({ version: parent.depth + 1, code: 'crash', detail: 'changes' });
      }
      const oracle = parent.oracle.clone();
      try {
        this.violations.push(...oracle.step(parent.depth + 1, parent.text, text, derived.summary));
      } catch (error) {
        this.violations.push({
          version: parent.depth + 1,
          code: 'crash',
          detail: `oracle: ${(error as Error).message}`,
        });
      }
      child = {
        text,
        depth: parent.depth + 1,
        oracle,
        children: new Map(),
        applied: true,
        reason: '',
        shown: false,
      };
    } else {
      if (derived.crash) {
        this.violations.push({ version: parent.depth + 1, code: 'crash', detail: derived.reason });
      }
      child = {
        text: parent.text,
        depth: parent.depth + 1,
        oracle: parent.oracle,
        children: new Map(),
        applied: false,
        reason: derived.reason,
        shown: false,
      };
    }
    parent.children.set(op.id, child);
    return child;
  }

  show(node: Node): void {
    if (node.shown) return;
    node.shown = true;
    try {
      this.violations.push(...node.oracle.state(node.depth, node.text));
    } catch (error) {
      this.violations.push({
        version: node.depth,
        code: 'crash',
        detail: `oracle: ${(error as Error).message}`,
      });
    }
  }

  key(a: YReplica, b: YReplica): string {
    return a.index < b.index ? `${a.index}-${b.index}` : `${b.index}-${a.index}`;
  }

  linkBetween(a: YReplica, b: YReplica): Link {
    return this.links.get(this.key(a, b)) as Link;
  }

  direction(from: YReplica, to: YReplica): 'up' | 'down' {
    return from.index < to.index ? 'up' : 'down';
  }

  send(from: YReplica, to: YReplica, update: Uint8Array): void {
    this.stats.bytes.messages++;
    this.stats.bytes.ops += update.length;
    this.linkBetween(from, to).send(this.direction(from, to), () => to.receive(update, from));
  }

  learned(op: YOp, replica: YReplica): void {
    let set = this.informed.get(op.id);
    if (!set) this.informed.set(op.id, (set = new Set([op.replica])));
    set.add(replica.index);
    if (set.size === this.replicas.length) {
      this.stats.latencies.push(this.clock.now - (this.created.get(op.id) ?? 0));
    }
  }
}

export function runYjsReplay(config: YjsReplayConfig): YjsReplayResult {
  const world = new YWorld(config);
  const rng = new Rng(config.seed);
  const count = config.clients ?? 4;
  const ops = config.ops ?? 20;
  const net = config.net ?? DEFAULT_NET;
  const span = ops * 1400;
  const long = config.offlineMs ?? [2000, 8000];

  for (let i = 0; i < count; i++) world.replicas.push(new YReplica(i, world, rng.fork()));
  for (const a of world.replicas) {
    for (const b of world.replicas) {
      if (a.index < b.index) {
        const link = new Link(world.clock, rng.fork(), net);
        world.links.set(world.key(a, b), link);
        link.onConnect(() => {
          a.sync(b);
          b.sync(a);
        });
      }
    }
  }
  for (const replica of world.replicas) {
    const mine = [...world.links.entries()]
      .filter(([k]) => k.split('-').includes(String(replica.index)))
      .map(([, link]) => link);
    const outage = (start: number, length: number) => {
      world.stats.outages++;
      world.clock.at(start, () => mine.forEach((l) => l.disconnect()));
      world.clock.at(start + length, () => mine.forEach((l) => l.connect()));
    };
    const plan = rng.fork();
    if (plan.chance(config.offlineP ?? 0.4))
      outage(plan.next() * span * 0.8, long[0] + plan.next() * (long[1] - long[0]));
    if (plan.chance(0.3)) outage(plan.next() * span, 100 + plan.next() * 900);
    let t = plan.next() * 500;
    for (let n = 0; n < ops; n++) {
      t += 300 + plan.next() * 2200;
      world.clock.at(t, () => replica.act());
    }
  }

  const finished = world.clock.run(Infinity, 400_000);
  if (!finished) {
    world.violations.push({ version: 0, code: 'stuck', detail: 'the session did not settle' });
  }

  const first = world.replicas[0] as YReplica;
  let converged = true;
  for (const replica of world.replicas) {
    const same =
      replica.text === first.text &&
      replica.order.length === first.order.length &&
      replica.order.every((o, i) => o.id === (first.order[i] as YOp).id);
    if (!same) {
      converged = false;
      world.violations.push({
        version: replica.node.depth,
        code: 'diverged',
        detail: `replica ${replica.index} knows ${replica.order.length} intents and differs`,
      });
    }
  }

  let node = world.root;
  for (const op of first.order) {
    node = world.step(node, op);
    world.stats.intents++;
    if (node.applied) world.stats.applied++;
    else {
      const why = `${op.intent.body.kind}:${node.reason}`;
      world.stats.turnedAway[why] = (world.stats.turnedAway[why] ?? 0) + 1;
    }
    const local = world.localApplied.get(op.id);
    if (local && !node.applied) world.stats.vanished++;
    if (local === false && node.applied) world.stats.appeared++;
  }
  const endState = first.node.oracle.state(first.node.depth, first.text);

  world.stats.docBytes =
    world.replicas.reduce((a, r) => a + Y.encodeStateAsUpdate(r.doc).length, 0) / count;
  world.stats.plainBytes = JSON.stringify(first.order).length;
  for (const r of world.replicas) {
    if (r.doc.store.pendingStructs) world.stats.heldBack++;
  }

  return {
    config,
    violations: world.violations,
    invalidAtAnyPoint: world.violations.some((v) => INVALID_MARKUP.has(v.code)),
    corruptedAtEnd:
      endState.some((v) => DATA_LOSS.has(v.code) || INVALID_MARKUP.has(v.code)) ||
      world.violations.some((v) => DATA_LOSS.has(v.code)),
    converged,
    finalText: first.text,
    stats: world.stats,
    order: first.order.map((o) => o.id),
  };
}
