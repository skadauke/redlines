import { describe, expect, it } from 'vitest';
import { EditError } from './errors.ts';
import {
  applyLedgerOp,
  applyLedgerOps,
  emptyLedgerMap,
  ledgerEntries,
  setLedgerEntries,
  writeLedger,
} from './ledger-map.ts';
import type { LedgerMap, LedgerOp } from './ledger-map.ts';
import { setLedger } from './ledger-write.ts';
import { applyChanges } from './changes.ts';
import { fuzzCount, seeded } from './random-docs.ts';
import type { MarkEntry, Reply, Thread } from './types.ts';

const T = (minute: number) =>
  new Date(Date.UTC(2026, 10, 16, 0, minute)).toISOString().slice(0, 16) + 'Z';
const entry = (by: string, minute = 1): MarkEntry => ({ by, at: T(minute) });
const thread = (id: string, by = 'ada', minute = 1): Thread => ({
  id,
  by,
  at: T(minute),
  likes: [],
  replies: [],
  text: `Thread ${id}`,
});
const replyOf = (id: string, by: string, minute: number): Reply => ({
  id,
  by,
  at: T(minute),
  text: `Reply ${id}`,
});

/** A body that anchors the marks and the threads, in the order given. */
function bodyOf(marks: string[], threads: string[]): string {
  return [
    ...marks.map((id) => `<!--ins ${id}-->x<!--/${id}-->`),
    ...threads.map((id) => `<!--cmt ${id}-->y<!--/${id}-->`),
  ].join('\n');
}

const ada = { handle: 'ada', name: 'Ada Lovelace' };
const bo = { handle: 'bo', name: 'Bo Chen' };

function written(map: LedgerMap, marks: string[] = [], threads: string[] = []): string {
  return writeLedger(map, bodyOf(marks, threads));
}

describe('the ledger map', () => {
  it('reads a file with no ledger as an empty map, and writes nothing for it', () => {
    const map = ledgerEntries('Just text.\n');
    expect(map.marks.size + map.threads.size + map.people.size).toBe(0);
    expect(writeLedger(map, 'Just text.\n')).toBe('');
  });

  it('marks the map of a ledger that cannot be read, and the file is not written over', () => {
    const file = 'a\n\n<!-- redlines\nmarks: [\n-->\n';
    const map = ledgerEntries(file);
    expect(map.unreadable).toBe(true);
    expect(() => setLedgerEntries(file, map)).toThrow(EditError);
  });

  it('reads and writes marks, threads, people and settings, keyed', () => {
    const base = applyLedgerOps(emptyLedgerMap(), [
      { op: 'setTracking', value: 'everyone' },
      { op: 'setView', value: 'simple' },
      { op: 'setHistory', value: 'full' },
      { op: 'addPerson', person: ada },
      { op: 'addMark', id: 'k3x9', entry: entry('ada') },
      { op: 'addThread', thread: thread('c8d2') },
      { op: 'setField', name: 'frontmatter', value: [{ key: 'title', by: 'ada', at: T(2) }] },
    ]);
    const body = bodyOf(['k3x9'], ['c8d2']);
    const file = `${body}\n\n${writeLedger(base, body)}\n`;
    const map = ledgerEntries(file);
    expect([...map.marks.keys()]).toEqual(['k3x9']);
    expect([...map.threads.keys()]).toEqual(['c8d2']);
    expect([...map.people.keys()]).toEqual(['ada']);
    expect(map.settings).toEqual({ tracking: 'everyone', view: 'simple', history: 'full' });
    expect([...map.extra.keys()]).toEqual(['frontmatter']);
    expect(setLedgerEntries(file, map)).toEqual([]);
  });

  it('writes the ledger into a file through the writer that exists, without a second ledger', () => {
    const body = bodyOf(['k3x9'], []);
    const map = applyLedgerOp(emptyLedgerMap(), { op: 'addMark', id: 'k3x9', entry: entry('ada') });
    const file = applyChanges(`${body}\n`, setLedgerEntries(`${body}\n`, map));
    expect(file.match(/<!-- redlines/g)).toHaveLength(1);
    expect(ledgerEntries(file).marks.get('k3x9')).toEqual(entry('ada'));
    // The same map again changes nothing.
    expect(setLedgerEntries(file, ledgerEntries(file))).toEqual([]);
    const bare = applyChanges(
      file,
      setLedger(file, { version: 1, people: [], marks: {}, comments: [] }),
    );
    expect(bare).toBe(`${body}\n`);
  });

  it('writes marks and threads in the document order of the body, whatever order they came in', () => {
    const ops: LedgerOp[] = [
      { op: 'addMark', id: 'w8nn', entry: entry('ada') },
      { op: 'addMark', id: 'k3x9', entry: entry('ada') },
      { op: 'addThread', thread: thread('c9qf') },
      { op: 'addThread', thread: thread('c8d2') },
    ];
    const body = bodyOf(['k3x9', 'w8nn'], ['c8d2', 'c9qf']);
    const text = writeLedger(applyLedgerOps(emptyLedgerMap(), ops), body);
    expect(text.indexOf('k3x9')).toBeLessThan(text.indexOf('w8nn'));
    expect(text.indexOf('c8d2')).toBeLessThan(text.indexOf('c9qf'));
    expect(writeLedger(applyLedgerOps(emptyLedgerMap(), ops.toReversed()), body)).toBe(text);
  });

  it('does not change the map it is given', () => {
    const map = emptyLedgerMap();
    applyLedgerOp(map, { op: 'addMark', id: 'k3x9', entry: entry('ada') });
    applyLedgerOp(map, { op: 'setView', value: 'clean' });
    expect(map.marks.size).toBe(0);
    expect(map.settings).toEqual({});
  });
});

describe('entry operations', () => {
  const start = applyLedgerOps(emptyLedgerMap(), [
    { op: 'addPerson', person: ada },
    { op: 'addThread', thread: thread('c8d2') },
    { op: 'addMark', id: 'k3x9', entry: entry('ada') },
  ]);
  const text = (map: LedgerMap) => written(map, ['k3x9', 'm4vf'], ['c8d2', 'c9qf']);

  it('adds and removes a mark entry, and sets one again', () => {
    const withMark = applyLedgerOp(start, { op: 'addMark', id: 'm4vf', entry: entry('bo', 3) });
    expect(withMark.marks.get('m4vf')).toEqual(entry('bo', 3));
    const note = { ...entry('bo', 3), note: 'why' };
    expect(
      applyLedgerOp(withMark, { op: 'addMark', id: 'm4vf', entry: note }).marks.get('m4vf'),
    ).toEqual(note);
    expect(applyLedgerOp(withMark, { op: 'removeMark', id: 'm4vf' }).marks.has('m4vf')).toBe(false);
    expect(applyLedgerOp(start, { op: 'removeMark', id: 'zzzz' })).toBe(start);
  });

  it('keeps both replies to one thread, in the order given', () => {
    const a = replyOf('r5tw', 'ada', 5);
    const b = replyOf('r6tw', 'bo', 5);
    const one = applyLedgerOps(start, [
      { op: 'reply', thread: 'c8d2', reply: a },
      { op: 'reply', thread: 'c8d2', reply: b },
    ]);
    const two = applyLedgerOps(start, [
      { op: 'reply', thread: 'c8d2', reply: b },
      { op: 'reply', thread: 'c8d2', reply: a },
    ]);
    expect(one.threads.get('c8d2')?.replies).toEqual([a, b]);
    expect(two.threads.get('c8d2')?.replies).toEqual([b, a]);
  });

  it('ignores a reply to nothing, and a reply id that is used', () => {
    const r = replyOf('r5tw', 'ada', 5);
    expect(applyLedgerOp(start, { op: 'reply', thread: 'c9qf', reply: r })).toBe(start);
    const once = applyLedgerOp(start, { op: 'reply', thread: 'c8d2', reply: r });
    expect(applyLedgerOp(once, { op: 'reply', thread: 'c8d2', reply: r })).toBe(once);
  });

  it('keeps one like for each person, and takes one back', () => {
    const liked = applyLedgerOps(start, [
      { op: 'like', thread: 'c8d2', by: 'bo', at: T(6) },
      { op: 'like', thread: 'c8d2', by: 'bo', at: T(7) },
      { op: 'like', thread: 'c8d2', by: 'ada', at: T(8) },
    ]);
    expect(liked.threads.get('c8d2')?.likes).toEqual([
      { by: 'bo', at: T(6) },
      { by: 'ada', at: T(8) },
    ]);
    const unliked = applyLedgerOp(liked, { op: 'unlike', thread: 'c8d2', by: 'bo' });
    expect(unliked.threads.get('c8d2')?.likes).toEqual([{ by: 'ada', at: T(8) }]);
  });

  it('resolves, and a later reply reopens', () => {
    const resolved = applyLedgerOp(start, { op: 'resolve', thread: 'c8d2', by: 'ada', at: T(5) });
    expect(resolved.threads.get('c8d2')?.resolved).toEqual({ by: 'ada', at: T(5) });
    const reopened = applyLedgerOp(resolved, {
      op: 'reply',
      thread: 'c8d2',
      reply: replyOf('r5tw', 'bo', 6),
    });
    expect(reopened.threads.get('c8d2')?.resolved).toBeUndefined();
    expect(reopened.threads.get('c8d2')?.replies).toHaveLength(1);
    expect(text(reopened)).not.toContain('resolved:');
  });

  it('leaves a thread resolved by a reply made at the same time or before', () => {
    const resolved = applyLedgerOp(start, { op: 'resolve', thread: 'c8d2', by: 'ada', at: T(5) });
    for (const minute of [4, 5]) {
      const next = applyLedgerOp(resolved, {
        op: 'reply',
        thread: 'c8d2',
        reply: replyOf('r5tw', 'bo', minute),
      });
      expect(next.threads.get('c8d2')?.resolved).toEqual({ by: 'ada', at: T(5) });
      expect(next.threads.get('c8d2')?.replies).toHaveLength(1);
    }
  });

  it('reopens by itself', () => {
    const resolved = applyLedgerOp(start, { op: 'resolve', thread: 'c8d2', by: 'ada', at: T(5) });
    const open = applyLedgerOp(resolved, { op: 'reopen', thread: 'c8d2' });
    expect(open.threads.get('c8d2')?.resolved).toBeUndefined();
    expect(applyLedgerOp(open, { op: 'reopen', thread: 'c8d2' })).toBe(open);
  });

  it('adds a person once: the earlier one keeps the handle', () => {
    const next = applyLedgerOp(start, { op: 'addPerson', person: bo });
    expect([...next.people.keys()]).toEqual(['ada', 'bo']);
    const other = { handle: 'ada', name: 'Someone Else' };
    expect(applyLedgerOp(start, { op: 'addPerson', person: other })).toBe(start);
  });

  it('sets and clears the settings, and a field of a later version', () => {
    let map = applyLedgerOps(start, [
      { op: 'setTracking', value: 'everyone' },
      { op: 'setView', value: 'redlines' },
      { op: 'setField', name: 'frontmatter', value: [] },
    ]);
    expect(map.settings).toEqual({ tracking: 'everyone', view: 'redlines' });
    map = applyLedgerOps(map, [
      { op: 'setTracking', value: undefined },
      { op: 'setView', value: undefined },
      { op: 'setField', name: 'frontmatter', value: undefined },
    ]);
    expect(map.settings).toEqual({});
    expect(map.extra.size).toBe(0);
  });

  it('ignores a field that the ledger has its own entries for', () => {
    expect(applyLedgerOp(start, { op: 'setField', name: 'marks', value: 'x' })).toBe(start);
  });

  it('commutes across different keys', () => {
    const ops: LedgerOp[] = [
      { op: 'addMark', id: 'm4vf', entry: entry('bo', 3) },
      { op: 'like', thread: 'c8d2', by: 'bo', at: T(4) },
      { op: 'addThread', thread: thread('c9qf', 'bo', 4) },
      { op: 'addPerson', person: bo },
      { op: 'setView', value: 'clean' },
      { op: 'removeMark', id: 'k3x9' },
      { op: 'reply', thread: 'c8d2', reply: replyOf('r5tw', 'bo', 5) },
    ];
    const result = text(applyLedgerOps(start, ops));
    for (let i = 0; i < ops.length; i++) {
      const rotated = [...ops.slice(i), ...ops.slice(0, i)];
      expect(text(applyLedgerOps(start, rotated))).toBe(result);
    }
    expect(text(applyLedgerOps(start, ops.toReversed()))).toBe(result);
  });
});

// --- A seeded suite of edit sequences --------------------------------------------------------

const ID_FIRST = 'bcdfghjkmnpqrstvwxz';
const ID_REST = 'bcdfghjkmnpqrstvwxz23456789';
function idOf(n: number): string {
  let id = ID_FIRST[n % ID_FIRST.length] as string;
  let rest = Math.floor(n / ID_FIRST.length);
  for (let i = 0; i < 3; i++) {
    id += ID_REST[rest % ID_REST.length];
    rest = Math.floor(rest / ID_REST.length);
  }
  return id;
}

/** Text that is hard to write: colons, quotes, hashes, blank lines, backslashes, emoji, YAML words. */
const TEXTS = [
  'plain words',
  'a: b',
  '"quoted" and \'single\'',
  '# not a comment',
  'two\n\nparagraphs',
  'back\\slash and \\',
  '😀 café',
  'yes',
  'null',
  ' leading space',
  'trailing space ',
  'a --> b <!-- c',
  '- [ ] item\n- two',
  '@ada, look at {this}, [that]',
];

const HANDLES = ['ada', 'bo', 'cy', 'dee', 'claude-ada'];

interface World {
  random: () => number;
  /** Next number for ids and times. */
  n: number;
  marks: string[];
  threads: string[];
  people: Set<string>;
  replies: number;
}

const pick = <T>(random: () => number, items: readonly T[]): T =>
  items[Math.floor(random() * items.length)] as T;

/** One random operation, and the key it acts on (operations of different keys commute). */
function randomOp(w: World): { op: LedgerOp; key: string } {
  const { random } = w;
  const minute = w.n++;
  const text = pick(random, TEXTS);
  const kind = Math.floor(random() * 13);
  const threadId = w.threads.length > 0 ? pick(random, w.threads) : undefined;
  const handle = pick(random, HANDLES);
  switch (kind) {
    case 0:
    case 1: {
      const id = idOf(w.n * 7);
      w.marks.push(id);
      const e: MarkEntry = { by: handle, at: T(minute) };
      if (random() < 0.3) e.note = text;
      if (random() < 0.1) e.extra = { future: text };
      return { op: { op: 'addMark', id, entry: e }, key: `mark ${id}` };
    }
    case 2: {
      if (w.marks.length === 0) break;
      const id = pick(random, w.marks);
      return { op: { op: 'removeMark', id }, key: `mark ${id}` };
    }
    case 3: {
      const id = idOf(w.n * 7 + 1);
      w.threads.push(id);
      const t = { ...thread(id, handle, minute), text };
      if (random() < 0.3) t.quote = pick(random, TEXTS);
      return { op: { op: 'addThread', thread: t }, key: `thread ${id}` };
    }
    case 4:
    case 5: {
      if (!threadId) break;
      const reply = { id: idOf(w.n * 7 + 2), by: handle, at: T(minute), text };
      w.replies++;
      return { op: { op: 'reply', thread: threadId, reply }, key: `thread ${threadId}` };
    }
    case 6: {
      if (!threadId) break;
      return {
        op: { op: 'like', thread: threadId, by: handle, at: T(minute) },
        key: `thread ${threadId}`,
      };
    }
    case 7: {
      if (!threadId) break;
      return { op: { op: 'unlike', thread: threadId, by: handle }, key: `thread ${threadId}` };
    }
    case 8: {
      if (!threadId) break;
      return {
        op: { op: 'resolve', thread: threadId, by: handle, at: T(minute) },
        key: `thread ${threadId}`,
      };
    }
    case 9: {
      if (!threadId) break;
      return { op: { op: 'reopen', thread: threadId }, key: `thread ${threadId}` };
    }
    case 10: {
      const person = { handle, name: text.replace(/\n/g, ' ') || handle };
      return { op: { op: 'addPerson', person }, key: `person ${handle}` };
    }
    case 11:
      return {
        op: { op: 'setView', value: pick(random, ['clean', 'redlines', 'simple', undefined]) },
        key: 'view',
      };
    default:
      return {
        op: { op: 'setTracking', value: pick(random, ['everyone', undefined]) },
        key: 'tracking',
      };
  }
  return randomOp(w);
}

function world(seed: number): World {
  return { random: seeded(seed), n: 1, marks: [], threads: [], people: new Set(), replies: 0 };
}

/** The ops in a random interleaving that keeps the order of each key's own. */
function interleave(
  ops: { op: LedgerOp; key: string }[],
  random: () => number,
): { op: LedgerOp; key: string }[] {
  const queues = new Map<string, { op: LedgerOp; key: string }[]>();
  for (const item of ops) queues.set(item.key, [...(queues.get(item.key) ?? []), item]);
  const out: { op: LedgerOp; key: string }[] = [];
  while (queues.size > 0) {
    const key = pick(random, [...queues.keys()]);
    const queue = queues.get(key) as { op: LedgerOp; key: string }[];
    out.push(queue.shift() as { op: LedgerOp; key: string });
    if (queue.length === 0) queues.delete(key);
  }
  return out;
}

describe('random edit sequences', () => {
  const runs = fuzzCount(150);

  it('are written, read and written again as the same bytes', () => {
    for (let seed = 1; seed <= runs; seed++) {
      const w = world(seed);
      const ops = Array.from({ length: 5 + Math.floor(w.random() * 40) }, () => randomOp(w));
      const map = applyLedgerOps(
        emptyLedgerMap(),
        ops.map((o) => o.op),
      );
      const body = bodyOf(w.marks, w.threads);
      const out = writeLedger(map, body);
      if (out === '') continue;
      const file = `${body}\n\n${out}\n`;
      const again = writeLedger(ledgerEntries(file), body);
      expect(again, `seed ${seed}`).toBe(out);
      expect(setLedgerEntries(file, ledgerEntries(file)), `seed ${seed}`).toEqual([]);
    }
  });

  it('give one ledger in every interleaving that keeps each key in order', () => {
    for (let seed = 1; seed <= runs; seed++) {
      const w = world(1000 + seed);
      const ops = Array.from({ length: 5 + Math.floor(w.random() * 40) }, () => randomOp(w));
      const body = bodyOf(w.marks, w.threads);
      const result = writeLedger(
        applyLedgerOps(
          emptyLedgerMap(),
          ops.map((o) => o.op),
        ),
        body,
      );
      for (let k = 0; k < 3; k++) {
        const shuffled = interleave(ops, w.random);
        const other = writeLedger(
          applyLedgerOps(
            emptyLedgerMap(),
            shuffled.map((o) => o.op),
          ),
          body,
        );
        expect(other, `seed ${1000 + seed}`).toBe(result);
      }
    }
  });
});
