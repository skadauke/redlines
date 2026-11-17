// `node --expose-gc --experimental-strip-types --disable-warning=ExperimentalWarning src/yjs-growth.ts`
//
// The size of a Yjs intent log as it grows, against the plain log; and what Yjs's garbage
// collection and a compaction do. Intents are those of the simulator's workloads (typical and
// review, four people), repeated with new ids. Prints Markdown tables.

import * as Y from 'yjs';
import type { Intent } from './intents.ts';
import { Rng } from './rng.ts';
import { baseDocument } from './text.ts';
import { makeIntent } from './workloads.ts';
import type { WorkloadName } from './workloads.ts';
import type { YOp } from './yjs-replay.ts';

const gc = (globalThis as { gc?: () => void }).gc;
if (!gc) throw new Error('run with --expose-gc');

function sample(count: number): Intent[] {
  const base = baseDocument(5, 12);
  const rng = new Rng(11);
  const counters = [0, 1, 2, 3].map(() => ({ words: 0, notes: 0, replies: 0, intents: 0 }));
  const out: Intent[] = [];
  const workloads: WorkloadName[] = ['typical', 'review', 'hot', 'spread'];
  for (let n = 0; out.length < count && n < count * 10; n++) {
    const who = n % 4;
    const intent = makeIntent({
      rng,
      workload: workloads[n % 4] as WorkloadName,
      who,
      local: base,
      confirmed: base,
      counter: counters[who] as (typeof counters)[number],
      at: n * 1000,
      guard: true,
    });
    if (intent) out.push(intent);
  }
  return out;
}

const pool = sample(2000);
const mkOp = (n: number, who: number): YOp => {
  const intent = pool[n % pool.length] as Intent;
  return { id: `${intent.id}#${n}`, replica: who, intent: { ...intent, id: `${intent.id}#${n}` } };
};

const heap = (): number => {
  (gc as () => void)();
  (gc as () => void)();
  return process.memoryUsage().heapUsed;
};
const kb = (b: number): string => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${(b / 1024).toFixed(0)} KB`);
const ms = (t: number): string => `${t.toFixed(0)} ms`;

const row = (...c: string[]): string => `| ${c.join(' | ')} |`;
const out: string[] = [];
const emit = (head: string[], rows: string[][]): void => {
  out.push(row(...head), row(...head.map(() => '---')), ...rows.map((r) => row(...r)), '');
};

/** Replicas that push and sync with each other in turn, so the doc has several clients. */
function build(count: number, writers: number, asString: boolean): Y.Doc {
  const docs = Array.from({ length: writers }, (_, i) => {
    const d = new Y.Doc();
    d.clientID = 1000 + i;
    return d;
  });
  const arrs = docs.map((d) => d.getArray<YOp | string>('log'));
  const round = 25;
  for (let n = 0; n < count; n++) {
    const who = Math.floor(n / round) % writers;
    const op = mkOp(n, who);
    (arrs[who] as Y.Array<YOp | string>).push([asString ? JSON.stringify(op) : op]);
    if (n % round === round - 1 || n === count - 1) {
      // Everyone catches up with everyone (a flood and a sync, in one step).
      for (const a of docs) {
        for (const b of docs) {
          if (a !== b) Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
        }
      }
    }
  }
  return docs[0] as Y.Doc;
}

// 1. Growth: plain log, Y.Array of objects, Y.Array of JSON strings. The heap is that of a replica
// that has received the log over the wire (decoded), as the plain log is parsed.
{
  const rows: string[][] = [];
  for (const n of [100, 1_000, 10_000, 100_000]) {
    const json = JSON.stringify(Array.from({ length: n }, (_, i) => mkOp(i, i % 4)));
    const h0 = heap();
    let plain: YOp[] | null = JSON.parse(json) as YOp[];
    const plainHeap = heap() - h0;
    void plain.length;
    plain = null;
    const results: string[] = [];
    for (const [writers, asString] of [
      [1, false],
      [4, false],
      [4, true],
    ] as const) {
      let built: Y.Doc | null = build(n, writers, asString);
      const update = Y.encodeStateAsUpdate(built);
      const sv = Y.encodeStateVector(built).length;
      built = null;
      const before = heap();
      let fresh: Y.Doc | null = new Y.Doc();
      const t1 = performance.now();
      Y.applyUpdate(fresh, update);
      const loaded = performance.now() - t1;
      const live = heap() - before;
      const t2 = performance.now();
      fresh.getArray('log').toArray();
      const listed = performance.now() - t2;
      results.push(`${kb(update.length)} / ${kb(live)} / ${sv} B / ${ms(loaded)} / ${ms(listed)}`);
      fresh = null;
    }
    rows.push([String(n), `${kb(json.length)} / ${kb(plainHeap)}`, ...results]);
  }
  out.push('Growth. Each cell: encoded size / live heap / state vector / time to load that update into a new doc / time to list the array.', '');
  emit(
    ['Intents', 'Plain log (JSON / heap)', 'Y.Array, one writer', 'Y.Array, four writers (turns of 25)', 'Y.Array of JSON strings, four writers'],
    rows,
  );
}

// 2. Garbage collection and compaction by deleting a prefix.
{
  const n = 10_000;
  const rows: string[][] = [];
  for (const gcOn of [true, false]) {
    const doc = build(n, 4, false);
    const copy = new Y.Doc({ gc: gcOn });
    copy.clientID = 2000;
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
    const arr = copy.getArray('log');
    const full = Y.encodeStateAsUpdate(copy).length;
    arr.delete(0, n - 100);
    const after = Y.encodeStateAsUpdate(copy);
    const shipped = new Y.Doc();
    Y.applyUpdate(shipped, after);
    rows.push([
      gcOn ? 'gc on (the default)' : 'gc off',
      kb(full),
      kb(after.length),
      String(arr.length),
      String(Y.encodeStateVector(copy).length),
    ]);
  }
  out.push('Compaction by deleting all but the last 100 of 10,000 intents.', '');
  emit(['Y.Doc', 'Update before', 'Update after the delete', 'Left in the array', 'State vector, bytes'], rows);
}

// 3. A concurrent intent whose origin was in the deleted prefix.
{
  const rows: string[][] = [];
  const make = (): [Y.Doc, Y.Doc] => {
    const a = new Y.Doc();
    a.clientID = 1;
    const b = new Y.Doc();
    b.clientID = 2;
    return [a, b];
  };
  const sync = (a: Y.Doc, b: Y.Doc): void => {
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
  };
  for (const keep of [0, 1]) {
    const [a, b] = make();
    const aa = a.getArray<string>('log');
    const bb = b.getArray<string>('log');
    aa.push(['p1', 'p2', 'p3']);
    sync(a, b);
    // b writes after p3 while a deletes the prefix, without having seen b's intent.
    bb.push(['late']);
    aa.delete(0, 3 - keep);
    sync(a, b);
    rows.push([
      keep === 0 ? 'delete the whole prefix' : 'keep the last intent of the prefix',
      JSON.stringify(aa.toArray()),
      JSON.stringify(bb.toArray()),
    ]);
  }
  out.push('A replica pushes after the last intent of a prefix while another replica deletes the prefix.', '');
  emit(['Compaction', 'Array at the compactor', 'Array at the writer'], rows);
}

// 4. A snapshot of the state, and what it costs.
{
  const n = 10_000;
  const doc = build(n, 4, false);
  const snap = new Y.Doc({ gc: false });
  Y.applyUpdate(snap, Y.encodeStateAsUpdate(doc));
  const arr = snap.getArray('log');
  const s = Y.snapshot(snap);
  arr.delete(0, n - 100);
  const encoded = Y.encodeSnapshot(s).length;
  const full = Y.encodeStateAsUpdate(snap).length;
  out.push(
    `Snapshot (gc off) of 10,000 intents: ${encoded} bytes encoded; the doc with the prefix deleted still holds ${kb(full)}, because a snapshot needs the deleted content.`,
    '',
  );
}

console.log(out.join('\n'));
