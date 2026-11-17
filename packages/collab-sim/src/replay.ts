// The no-host replay merge (multiuser §3, "Worth a simulation"): there is no authority. Every
// replica keeps the intents it knows, each with a Lamport time and its replica's index, and its
// text is the first text with every intent derived again, in that order, with the real
// `trackedEdits`. An intent that arrives from someone else is slotted in by its time; when it sorts
// before intents already derived, the ones after it are derived again on the new text. Replicas
// that know the same intents have the same text, to the byte, whatever order they heard them in.
//
// The oracle runs on every history that any replica derived: each step on its own, and each state
// that a replica showed. Histories share their common beginnings (a trie of derivations), so each
// step is derived and checked once.

import { applyChanges } from '@redlines/format';
import { derive } from './intents.ts';
import type { Intent } from './intents.ts';
import { Clock, DEFAULT_NET, Link } from './net.ts';
import type { NetConfig } from './net.ts';
import { INVALID_MARKUP, Oracle } from './oracle.ts';
import type { Code, Violation } from './oracle.ts';
import { Rng } from './rng.ts';
import { baseDocument } from './text.ts';
import { makeIntent } from './workloads.ts';
import type { Scene, WorkloadName } from './workloads.ts';

export interface ReplayConfig {
  seed: number;
  workload: WorkloadName;
  clients?: number;
  ops?: number;
  paragraphs?: number;
  words?: number;
  guard?: boolean;
  offlineP?: number;
  render?: boolean;
  net?: NetConfig;
  /** The range of a long outage in ms (default 2 000 to 8 000). */
  offlineMs?: [number, number];
}

interface Op {
  id: string;
  lamport: number;
  replica: number;
  intent: Intent;
}

const before = (a: Op, b: Op): boolean =>
  a.lamport < b.lamport || (a.lamport === b.lamport && a.replica < b.replica);

interface Node {
  text: string;
  depth: number;
  oracle: Oracle;
  children: Map<string, Node>;
  /** The op that made this node was derived (not turned away). */
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

export interface ReplayStats {
  /** Intents made, by kind. */
  byKind: Record<string, number>;
  /** In the final order: intents that changed nothing, by kind and reason. */
  turnedAway: Record<string, number>;
  /** Merges that slotted an intent in before ones already derived. */
  rewrites: number;
  /** Merges in all. */
  merges: number;
  /** Intents derived again by those rewrites. */
  rewound: number;
  /** Intents that changed the text where their person made them and changed nothing in the final
   * order, and the other way about. */
  vanished: number;
  appeared: number;
  /** Intents in the final order, and how many of them changed the text. */
  intents: number;
  applied: number;
  /** Time until every replica knew an intent, ms. */
  latencies: number[];
  outages: number;
  /** Nodes derived, and states shown. */
  derived: number;
  /** What went over the links: messages, bytes of intents (JSON), and of the requests that a link
   * coming back sends (counted at 12 bytes, about a version vector of five replicas). */
  bytes: { messages: number; ops: number; sync: number };
}

export interface ReplayResult {
  config: ReplayConfig;
  violations: Violation[];
  invalidAtAnyPoint: boolean;
  corruptedAtEnd: boolean;
  converged: boolean;
  finalText: string;
  stats: ReplayStats;
}

class Replica {
  readonly index: number;
  readonly world: ReplayWorld;
  known: Op[] = [];
  readonly ids = new Set<string>();
  lamport = 0;
  node: Node;
  readonly counter = { words: 0, notes: 0, replies: 0, intents: 0 };
  readonly rng: Rng;

  constructor(index: number, world: ReplayWorld, rng: Rng) {
    this.index = index;
    this.world = world;
    this.rng = rng;
    this.node = world.root;
  }

  get text(): string {
    return this.node.text;
  }

  /** Slots an op in by its time, and derives what follows it again. */
  add(op: Op): boolean {
    if (this.ids.has(op.id)) return false;
    this.ids.add(op.id);
    this.lamport = Math.max(this.lamport, op.lamport);
    let at = this.known.length;
    while (at > 0 && before(op, this.known[at - 1] as Op)) at--;
    this.known.splice(at, 0, op);
    this.world.stats.merges++;
    if (at < this.known.length - 1) {
      this.world.stats.rewrites++;
      this.world.stats.rewound += this.known.length - at - 1;
    }
    let node = this.world.root;
    for (const next of this.known) node = this.world.step(node, next);
    this.node = node;
    this.world.show(node);
    return true;
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
    const op: Op = { id: intent.id, lamport: ++this.lamport, replica: this.index, intent };
    world.created.set(op.id, world.clock.now);
    this.add(op);
    const mine = this.node;
    // Did it change what this person sees? The node at the end of their history is the op's own.
    world.localApplied.set(op.id, mine.applied);
    for (const peer of world.replicas) if (peer !== this) world.send(this, peer, op);
  }

  receive(op: Op, from: Replica): void {
    if (!this.add(op)) return;
    this.world.learned(op, this);
    for (const peer of this.world.replicas) {
      if (peer !== this && peer !== from) this.world.send(this, peer, op);
    }
  }

  /** After a link comes back: tell the other end what is known, and it answers with the rest. */
  sync(peer: Replica): void {
    const link = this.world.linkBetween(this, peer);
    const mine = new Set(this.ids);
    this.world.stats.bytes.sync += 12;
    this.world.stats.bytes.messages++;
    link.send(this.world.direction(this, peer), () => {
      for (const op of peer.known) {
        if (!mine.has(op.id)) this.world.send(peer, this, op);
      }
    });
  }
}

class ReplayWorld {
  readonly clock = new Clock();
  readonly config: ReplayConfig;
  readonly guard: boolean;
  readonly root: Node;
  readonly replicas: Replica[] = [];
  readonly violations: Violation[] = [];
  readonly created = new Map<string, number>();
  readonly localApplied = new Map<string, boolean>();
  readonly informed = new Map<string, Set<number>>();
  readonly links = new Map<string, Link>();
  readonly opsById = new Map<string, Op>();
  readonly appliedFinal = new Map<string, boolean>();
  readonly stats: ReplayStats = {
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
  };
  private readonly options: { render: boolean };

  constructor(config: ReplayConfig) {
    this.config = config;
    this.guard = config.guard !== false;
    this.options = { render: config.render !== false };
    this.root = {
      text: baseDocument(config.paragraphs ?? 5, config.words ?? 12),
      depth: 0,
      oracle: new Oracle(this.options),
      children: new Map(),
      applied: false,
      reason: '',
      shown: true,
    };
  }

  /** The node after `op`, derived once however many replicas get there. */
  step(parent: Node, op: Op): Node {
    const known = parent.children.get(op.id);
    if (known) return known;
    this.opsById.set(op.id, op);
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

  /** The checks of a state that a replica shows. */
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

  key(a: Replica, b: Replica): string {
    return a.index < b.index ? `${a.index}-${b.index}` : `${b.index}-${a.index}`;
  }

  linkBetween(a: Replica, b: Replica): Link {
    return this.links.get(this.key(a, b)) as Link;
  }

  direction(from: Replica, to: Replica): 'up' | 'down' {
    return from.index < to.index ? 'up' : 'down';
  }

  send(from: Replica, to: Replica, op: Op): void {
    this.stats.bytes.messages++;
    this.stats.bytes.ops += JSON.stringify(op).length;
    this.linkBetween(from, to).send(this.direction(from, to), () => to.receive(op, from));
  }

  learned(op: Op, replica: Replica): void {
    let set = this.informed.get(op.id);
    if (!set) this.informed.set(op.id, (set = new Set([op.replica])));
    set.add(replica.index);
    if (set.size === this.replicas.length) {
      this.stats.latencies.push(this.clock.now - (this.created.get(op.id) ?? 0));
    }
  }
}

/** The text of a set of intents, in whatever order they are given: the same as every replica that
 * knows them has. */
export function replayText(
  base: string,
  entries: readonly { lamport: number; replica: number; intent: Intent }[],
  guard = true,
): string {
  const sorted = entries
    .map((e) => ({ id: e.intent.id, ...e }))
    .sort((a, b) => (before(a, b) ? -1 : before(b, a) ? 1 : 0));
  let text = base;
  for (const entry of sorted) {
    const derived = derive(text, entry.intent, { guard });
    if (derived.ok) text = applyChanges(text, derived.changes);
  }
  return text;
}

export function runReplay(config: ReplayConfig): ReplayResult {
  const world = new ReplayWorld(config);
  const rng = new Rng(config.seed);
  const count = config.clients ?? 4;
  const ops = config.ops ?? 20;
  const net = config.net ?? DEFAULT_NET;
  const span = ops * 1400;
  const long = config.offlineMs ?? [2000, 8000];

  for (let i = 0; i < count; i++) world.replicas.push(new Replica(i, world, rng.fork()));
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
    // A replica's outage takes down every link it has.
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

  // Convergence: every replica knows every intent and has the same text.
  const first = world.replicas[0] as Replica;
  let converged = true;
  for (const replica of world.replicas) {
    if (replica.text !== first.text || replica.known.length !== first.known.length) {
      converged = false;
      world.violations.push({
        version: replica.node.depth,
        code: 'diverged',
        detail: `replica ${replica.index} knows ${replica.known.length} intents and differs`,
      });
    }
  }

  // The final order: what changed nothing, and what the people saw that no longer holds.
  let node = world.root;
  for (const op of first.known) {
    node = world.step(node, op);
    world.stats.intents++;
    world.appliedFinal.set(op.id, node.applied);
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
  };
}
