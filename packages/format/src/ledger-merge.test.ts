import { describe, expect, it } from 'vitest';
import {
  applyLedgerOp,
  applyLedgerOps,
  emptyLedgerMap,
  ledgerEntries,
  writeLedger,
} from './ledger-map.ts';
import type { LedgerMap, LedgerOp } from './ledger-map.ts';
import { mergeLedgers, renameMarkId } from './ledger-merge.ts';
import { fuzzCount, seeded } from './random-docs.ts';
import type { MarkEntry, Reply, Thread } from './types.ts';

const T = (minute: number) =>
  new Date(Date.UTC(2026, 10, 16, 0, minute)).toISOString().slice(0, 16) + 'Z';
const entry = (by: string, minute = 1, extra: Partial<MarkEntry> = {}): MarkEntry => ({
  by,
  at: T(minute),
  ...extra,
});
const thread = (id: string, by = 'ada', minute = 1, text = `Thread ${id}`): Thread => ({
  id,
  by,
  at: T(minute),
  likes: [],
  replies: [],
  text,
});
const reply = (id: string, by: string, minute: number, text = `Reply ${id}`): Reply => ({
  id,
  by,
  at: T(minute),
  text,
});
const person = (handle: string, name = handle, extra: object = {}) => ({ handle, name, ...extra });

const make = (...ops: LedgerOp[]) => applyLedgerOps(emptyLedgerMap(), ops);
const more = (map: LedgerMap, ...ops: LedgerOp[]) => applyLedgerOps(map, ops);

/** A body that anchors the marks and threads of a map, marks first. */
function bodyOf(...maps: LedgerMap[]): string {
  const marks = new Set(maps.flatMap((m) => [...m.marks.keys()]));
  const threads = new Set(maps.flatMap((m) => [...m.threads.keys()]));
  return [
    ...[...marks].sort().map((id) => `<!--ins ${id}-->x<!--/${id}-->`),
    ...[...threads].sort().map((id) => `<!--cmt ${id}-->y<!--/${id}-->`),
  ].join('\n');
}

const text = (map: LedgerMap, ...from: LedgerMap[]) => writeLedger(map, bodyOf(map, ...from));

const draw = (...ids: string[]) => {
  let i = 0;
  return () => ids[i++] ?? 'zzzz';
};

const base = make(
  { op: 'addPerson', person: person('ada', 'Ada Lovelace') },
  { op: 'addMark', id: 'k3x9', entry: entry('ada') },
  { op: 'addThread', thread: thread('c8d2') },
);

describe('mergeLedgers', () => {
  it('keeps what each side added', () => {
    const ours = more(
      base,
      { op: 'addMark', id: 'm4vf', entry: entry('ada', 2) },
      { op: 'addPerson', person: person('bo', 'Bo Chen') },
    );
    const theirs = more(
      base,
      { op: 'addMark', id: 'n5vt', entry: entry('ada', 3) },
      { op: 'addThread', thread: thread('c9qf', 'ada', 3) },
    );
    const { ledger, renames } = mergeLedgers(base, ours, theirs);
    expect(renames).toEqual([]);
    expect([...ledger.marks.keys()].sort()).toEqual(['k3x9', 'm4vf', 'n5vt']);
    expect([...ledger.threads.keys()].sort()).toEqual(['c8d2', 'c9qf']);
    expect([...ledger.people.keys()].sort()).toEqual(['ada', 'bo']);
  });

  it('is the same whichever side is which', () => {
    const ours = more(
      base,
      { op: 'addMark', id: 'm4vf', entry: entry('ada', 2) },
      { op: 'setView', value: 'clean' },
      { op: 'reply', thread: 'c8d2', reply: reply('r5tw', 'ada', 4) },
    );
    const theirs = more(
      base,
      { op: 'addMark', id: 'n5vt', entry: entry('ada', 3) },
      { op: 'setView', value: 'simple' },
      { op: 'reply', thread: 'c8d2', reply: reply('r6tw', 'ada', 5) },
    );
    const a = mergeLedgers(base, ours, theirs).ledger;
    const b = mergeLedgers(base, theirs, ours).ledger;
    expect(text(a, ours, theirs)).toBe(text(b, ours, theirs));
    // Two views from two sides: one, the one that sorts later.
    expect(a.settings.view).toBe('simple');
  });

  it('removes what one side removed and the other left alone', () => {
    const ours = more(base, { op: 'removeMark', id: 'k3x9' }, { op: 'removeThread', id: 'c8d2' });
    const { ledger } = mergeLedgers(base, ours, base);
    expect(ledger.marks.size).toBe(0);
    expect(ledger.threads.size).toBe(0);
    expect(mergeLedgers(base, base, ours).ledger.marks.size).toBe(0);
  });

  it('keeps what one side removed and the other changed', () => {
    const ours = more(base, { op: 'removeThread', id: 'c8d2' });
    const theirs = more(base, { op: 'reply', thread: 'c8d2', reply: reply('r5tw', 'ada', 5) });
    expect(mergeLedgers(base, ours, theirs).ledger.threads.get('c8d2')?.replies).toHaveLength(1);
    expect(mergeLedgers(base, theirs, ours).ledger.threads.get('c8d2')?.replies).toHaveLength(1);
  });

  it('keeps both replies to one thread, in order of time, and both likes', () => {
    const ours = more(
      base,
      { op: 'reply', thread: 'c8d2', reply: reply('r7aa', 'ada', 7) },
      { op: 'like', thread: 'c8d2', by: 'ada', at: T(9) },
    );
    const theirs = more(
      base,
      { op: 'reply', thread: 'c8d2', reply: reply('r5bb', 'bo', 5) },
      { op: 'reply', thread: 'c8d2', reply: reply('r8cc', 'bo', 8) },
      { op: 'like', thread: 'c8d2', by: 'bo', at: T(6) },
    );
    for (const merged of [
      mergeLedgers(base, ours, theirs).ledger,
      mergeLedgers(base, theirs, ours).ledger,
    ]) {
      const t = merged.threads.get('c8d2') as Thread;
      expect(t.replies.map((r) => r.id)).toEqual(['r5bb', 'r7aa', 'r8cc']);
      expect(t.likes.map((l) => l.by).sort()).toEqual(['ada', 'bo']);
    }
  });

  it('merges the same entry field by field', () => {
    const ours = more(base, { op: 'addMark', id: 'k3x9', entry: entry('ada', 1, { note: 'why' }) });
    const theirs = more(base, {
      op: 'addMark',
      id: 'k3x9',
      entry: entry('ada', 1, { group: 'g2rs' }),
    });
    const merged = mergeLedgers(base, ours, theirs).ledger.marks.get('k3x9');
    expect(merged).toEqual({ by: 'ada', at: T(1), note: 'why', group: 'g2rs' });
  });

  describe('resolved', () => {
    const resolved = more(base, { op: 'resolve', thread: 'c8d2', by: 'ada', at: T(5) });
    const get = (map: LedgerMap) => map.threads.get('c8d2')?.resolved;

    it('stays resolved when one side resolved and the other replied', () => {
      const replied = more(base, { op: 'reply', thread: 'c8d2', reply: reply('r5tw', 'bo', 6) });
      expect(get(mergeLedgers(base, resolved, replied).ledger)).toEqual({ by: 'ada', at: T(5) });
      expect(get(mergeLedgers(base, replied, resolved).ledger)).toEqual({ by: 'ada', at: T(5) });
      expect(
        mergeLedgers(base, resolved, replied).ledger.threads.get('c8d2')?.replies,
      ).toHaveLength(1);
    });

    it('reopens when one side reopened a resolved thread and the other changed nothing', () => {
      const reopened = more(resolved, {
        op: 'reply',
        thread: 'c8d2',
        reply: reply('r5tw', 'bo', 6),
      });
      expect(get(reopened)).toBeUndefined();
      expect(get(mergeLedgers(resolved, reopened, resolved).ledger)).toBeUndefined();
      expect(get(mergeLedgers(resolved, resolved, reopened).ledger)).toBeUndefined();
    });

    it('is resolved again when one side reopened and the other resolved again', () => {
      const reopened = more(resolved, { op: 'reopen', thread: 'c8d2' });
      const again = more(resolved, { op: 'resolve', thread: 'c8d2', by: 'bo', at: T(8) });
      expect(get(mergeLedgers(resolved, reopened, again).ledger)).toEqual({ by: 'bo', at: T(8) });
    });

    it('takes the later of two resolves', () => {
      const early = more(base, { op: 'resolve', thread: 'c8d2', by: 'ada', at: T(5) });
      const late = more(base, { op: 'resolve', thread: 'c8d2', by: 'bo', at: T(7) });
      expect(get(mergeLedgers(base, early, late).ledger)).toEqual({ by: 'bo', at: T(7) });
      expect(get(mergeLedgers(base, late, early).ledger)).toEqual({ by: 'bo', at: T(7) });
    });
  });

  describe('duplicate ids', () => {
    it('renames the later mark, and says which side', () => {
      const ours = more(base, { op: 'addMark', id: 'm4vf', entry: entry('ada', 2) });
      const theirs = more(base, {
        op: 'addMark',
        id: 'm4vf',
        entry: entry('ada', 6, { note: 'x' }),
      });
      const { ledger, renames } = mergeLedgers(base, ours, theirs, { newId: draw('p7qd') });
      expect(renames).toEqual([{ side: 'theirs', kind: 'id', from: 'm4vf', to: 'p7qd' }]);
      expect(ledger.marks.get('m4vf')).toEqual(entry('ada', 2));
      expect(ledger.marks.get('p7qd')).toEqual(entry('ada', 6, { note: 'x' }));
      // The other way round, the same mark is renamed, on the other side.
      const swapped = mergeLedgers(base, theirs, ours, { newId: draw('p7qd') });
      expect(swapped.renames).toEqual([{ side: 'ours', kind: 'id', from: 'm4vf', to: 'p7qd' }]);
      expect(text(swapped.ledger, ours, theirs)).toBe(text(ledger, ours, theirs));
    });

    it('renames the mark in the body of that side, so that the bodies merge', () => {
      const body = '<!--ins m4vf-->a<!--/m4vf--> b <!--ins m4vf-->c<!--/m4vf-->';
      expect(renameMarkId(body, 'm4vf', 'p7qd')).toBe(
        '<!--ins p7qd-->a<!--/p7qd--> b <!--ins p7qd-->c<!--/p7qd-->',
      );
      expect(renameMarkId('<!--del m4vf old--><!--ins zzzz-->x<!--/zzzz-->', 'm4vf', 'p7qd')).toBe(
        '<!--del p7qd old--><!--ins zzzz-->x<!--/zzzz-->',
      );
      expect(renameMarkId('`<!--ins m4vf-->` text', 'm4vf', 'p7qd')).toBe('`<!--ins m4vf-->` text');
    });

    it('writes the merged ledger for the merged body, each mark with its own entry', () => {
      const ours = more(base, {
        op: 'addMark',
        id: 'm4vf',
        entry: entry('ada', 2, { note: 'mine' }),
      });
      const theirs = more(base, {
        op: 'addMark',
        id: 'm4vf',
        entry: entry('ada', 6, { note: 'theirs' }),
      });
      const { ledger, renames } = mergeLedgers(base, ours, theirs, { newId: draw('p7qd') });
      let theirBody = '<!--ins k3x9-->a<!--/k3x9--> <!--ins m4vf-->t<!--/m4vf-->';
      for (const r of renames)
        if (r.side === 'theirs') theirBody = renameMarkId(theirBody, r.from, r.to);
      const merged = `<!--ins k3x9-->a<!--/k3x9--> <!--ins m4vf-->o<!--/m4vf--> <!--ins p7qd-->t<!--/p7qd-->`;
      expect(theirBody).toContain('p7qd');
      const out = writeLedger(ledger, merged);
      const back = ledgerEntries(`${merged}\n\n${out}\n`);
      expect(back.marks.get('m4vf')?.note).toBe('mine');
      expect(back.marks.get('p7qd')?.note).toBe('theirs');
    });

    it('does not rename the same thing added on both sides', () => {
      const added = { op: 'addMark', id: 'm4vf', entry: entry('ada', 2) } as const;
      const { ledger, renames } = mergeLedgers(base, more(base, added), more(base, added));
      expect(renames).toEqual([]);
      expect(ledger.marks.size).toBe(2);
    });

    it('renames a thread, and what refers to it', () => {
      const ours = more(
        base,
        { op: 'addThread', thread: thread('c9qf', 'ada', 2, 'one') },
        { op: 'addMark', id: 'm4vf', entry: entry('ada', 2) },
      );
      const theirs = more(
        base,
        { op: 'addThread', thread: { ...thread('c9qf', 'ada', 3, 'two'), about: 'm4vf' } },
        { op: 'addMark', id: 'm4vf', entry: entry('ada', 3) },
      );
      const { ledger, renames } = mergeLedgers(base, ours, theirs, {
        newId: draw('d2ff', 'g3hh'),
      });
      expect(renames.map((r) => `${r.side} ${r.from}>${r.to}`).sort()).toEqual([
        'theirs c9qf>d2ff',
        'theirs m4vf>g3hh',
      ]);
      expect(ledger.threads.get('d2ff')?.about).toBe('g3hh');
      expect(ledger.threads.get('c9qf')?.text).toBe('one');
    });

    it('renames a reply id that another thread uses', () => {
      const ours = more(base, { op: 'reply', thread: 'c8d2', reply: reply('r5tw', 'ada', 4, 'a') });
      const other = more(base, { op: 'addThread', thread: thread('c9qf', 'ada', 2) });
      const theirs = more(other, {
        op: 'reply',
        thread: 'c9qf',
        reply: reply('r5tw', 'bo', 5, 'b'),
      });
      const { ledger, renames } = mergeLedgers(base, ours, theirs, { newId: draw('d2ff') });
      expect(renames).toEqual([{ side: 'theirs', kind: 'id', from: 'r5tw', to: 'd2ff' }]);
      expect(ledger.threads.get('c9qf')?.replies.map((r) => r.id)).toEqual(['d2ff']);
    });

    it('draws ids that are not taken, anywhere', () => {
      const ours = more(base, { op: 'addMark', id: 'm4vf', entry: entry('ada', 2) });
      const theirs = more(base, { op: 'addMark', id: 'm4vf', entry: entry('ada', 3) });
      const seen: ReadonlySet<string>[] = [];
      mergeLedgers(base, ours, theirs, {
        taken: ['q9zz'],
        newId: (taken) => {
          seen.push(new Set(taken));
          return 'p7qd';
        },
      });
      expect(seen).toHaveLength(1);
      for (const id of ['k3x9', 'c8d2', 'm4vf', 'q9zz']) expect(seen[0]?.has(id)).toBe(true);
    });
  });

  describe('duplicate handles', () => {
    it('gives two different people with one handle a suffix, and renames what refers to it', () => {
      const ours = more(
        base,
        { op: 'addPerson', person: person('bo', 'Bo Chen', { email: 'bo@a.example' }) },
        { op: 'addMark', id: 'm4vf', entry: entry('bo', 2) },
      );
      const theirs = more(
        base,
        { op: 'addPerson', person: person('bo', 'Bo Diaz', { email: 'bo@b.example' }) },
        { op: 'addMark', id: 'n5vt', entry: entry('bo', 3, { note: 'ask @bo' }) },
        {
          op: 'addThread',
          thread: { ...thread('c9qf', 'bo', 3), text: 'Hi @bo and @ada, @bobby' },
        },
        { op: 'reply', thread: 'c8d2', reply: reply('r5tw', 'bo', 4, 'Yes @bo') },
        { op: 'like', thread: 'c8d2', by: 'bo', at: T(5) },
        { op: 'resolve', thread: 'c8d2', by: 'bo', at: T(6) },
      );
      const { ledger, renames } = mergeLedgers(base, ours, theirs);
      expect(renames).toEqual([{ side: 'theirs', kind: 'handle', from: 'bo', to: 'bo-2' }]);
      expect(ledger.people.get('bo')?.email).toBe('bo@a.example');
      expect(ledger.people.get('bo-2')?.email).toBe('bo@b.example');
      expect(ledger.marks.get('m4vf')?.by).toBe('bo');
      expect(ledger.marks.get('n5vt')).toMatchObject({ by: 'bo-2', note: 'ask @bo-2' });
      expect(ledger.threads.get('c9qf')?.by).toBe('bo-2');
      expect(ledger.threads.get('c9qf')?.text).toBe('Hi @bo-2 and @ada, @bobby');
      const old = ledger.threads.get('c8d2') as Thread;
      expect(old.replies[0]).toMatchObject({ by: 'bo-2', text: 'Yes @bo-2' });
      expect(old.likes).toEqual([{ by: 'bo-2', at: T(5) }]);
      expect(old.resolved).toEqual({ by: 'bo-2', at: T(6) });
      // The same either way round, which side is renamed aside.
      const swapped = mergeLedgers(base, theirs, ours).ledger;
      expect(text(swapped, ours, theirs)).toBe(text(ledger, ours, theirs));
    });

    it('skips a suffix that is used', () => {
      const ours = more(
        base,
        { op: 'addPerson', person: person('bo', 'Bo A') },
        { op: 'addPerson', person: person('bo-2', 'Other') },
      );
      const theirs = more(base, { op: 'addPerson', person: person('bo', 'Bo B') });
      const { renames } = mergeLedgers(base, ours, theirs);
      expect(renames[0]?.to).toBe('bo-3');
    });

    it('takes the same person added on both sides as one', () => {
      const bo = person('bo', 'Bo Chen', { email: 'bo@a.example' });
      const ours = more(base, { op: 'addPerson', person: bo });
      const theirs = more(base, { op: 'addPerson', person: { ...bo, org: 'Example' } });
      const { ledger, renames } = mergeLedgers(base, ours, theirs);
      expect(renames).toEqual([]);
      expect(ledger.people.get('bo')).toMatchObject({ email: 'bo@a.example', org: 'Example' });
    });

    it('merges the accounts of one person as a set', () => {
      const b = make({
        op: 'addPerson',
        person: person('ada', 'Ada Lovelace', { accounts: ['a:1'] }),
      });
      const o = make({
        op: 'addPerson',
        person: person('ada', 'Ada Lovelace', { accounts: ['a:1', 'b:2'] }),
      });
      const t = make({
        op: 'addPerson',
        person: person('ada', 'Ada Lovelace', { accounts: ['a:1', 'c:3'] }),
      });
      expect(mergeLedgers(b, o, t).ledger.people.get('ada')?.accounts).toEqual([
        'a:1',
        'b:2',
        'c:3',
      ]);
    });
  });

  describe('settings and later fields', () => {
    it('takes the setting that one side changed', () => {
      const changed = more(base, { op: 'setTracking', value: 'everyone' });
      expect(mergeLedgers(base, changed, base).ledger.settings.tracking).toBe('everyone');
      expect(mergeLedgers(base, base, changed).ledger.settings.tracking).toBe('everyone');
      const off = more(changed, { op: 'setTracking', value: undefined });
      expect(mergeLedgers(changed, off, changed).ledger.settings.tracking).toBeUndefined();
    });

    it('unites the front matter changes by key', () => {
      const item = (key: string, minute: number) => ({ key, by: 'ada', at: T(minute) });
      const b = more(base, { op: 'setField', name: 'frontmatter', value: [item('title', 1)] });
      const o = more(b, {
        op: 'setField',
        name: 'frontmatter',
        value: [item('title', 1), item('date', 2)],
      });
      const t = more(b, {
        op: 'setField',
        name: 'frontmatter',
        value: [item('title', 1), item('tags', 3)],
      });
      expect(mergeLedgers(b, o, t).ledger.extra.get('frontmatter')).toEqual([
        item('title', 1),
        item('date', 2),
        item('tags', 3),
      ]);
    });

    it('keeps a field only one side has', () => {
      const t = more(base, { op: 'setField', name: 'future', value: 'x' });
      expect(mergeLedgers(base, base, t).ledger.extra.get('future')).toBe('x');
    });
  });

  it('merges ledgers read from files', () => {
    const ancestor = '<!--ins k3x9-->a<!--/k3x9-->';
    const file = (map: LedgerMap, body: string) => `${body}\n\n${writeLedger(map, body)}\n`;
    const b = make({ op: 'addMark', id: 'k3x9', entry: entry('ada') });
    const ours = more(b, { op: 'addMark', id: 'm4vf', entry: entry('ada', 2) });
    const theirs = more(b, { op: 'addMark', id: 'n5vt', entry: entry('ada', 3) });
    const merged = mergeLedgers(
      ledgerEntries(file(b, ancestor)),
      ledgerEntries(file(ours, `${ancestor}<!--ins m4vf-->b<!--/m4vf-->`)),
      ledgerEntries(file(theirs, `${ancestor}<!--ins n5vt-->c<!--/n5vt-->`)),
    ).ledger;
    expect([...merged.marks.keys()]).toEqual(['k3x9', 'm4vf', 'n5vt']);
    expect(applyLedgerOp(merged, { op: 'removeMark', id: 'k3x9' }).marks.size).toBe(2);
  });
});

// --- A seeded suite of merges ----------------------------------------------------------------

const HANDLES = ['ada', 'bo', 'cy', 'dee'];
const TEXTS = ['plain', 'a: b', 'two\n\nparagraphs', '😀 café', '"q"'];

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

describe('random merges', () => {
  it('give the ledger of both sides applied in order of time, whichever side is which', () => {
    for (let seed = 1; seed <= fuzzCount(150); seed++) {
      const random = seeded(seed);
      const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
      let clock = 1;
      let next = 1;
      const fresh = () => idOf(next++ * 11);

      // A base with some of everything.
      const setup: LedgerOp[] = [{ op: 'addPerson', person: person('ada', 'Ada Lovelace') }];
      const baseMarks: string[] = [];
      const baseThreads: string[] = [];
      for (let i = 0; i < 2 + Math.floor(random() * 5); i++) {
        const id = fresh();
        baseMarks.push(id);
        setup.push({ op: 'addMark', id, entry: entry(pick(HANDLES), clock++) });
      }
      for (let i = 0; i < 1 + Math.floor(random() * 3); i++) {
        const id = fresh();
        baseThreads.push(id);
        setup.push({ op: 'addThread', thread: thread(id, pick(HANDLES), clock++, pick(TEXTS)) });
      }
      const start = make(...setup);

      // What the two sides do, apart: on keys of their own, but for replies and likes, which both
      // may add to the same threads (a side's likes are its own people's).
      const taken = new Set<string>();
      const sides: { ops: LedgerOp[]; at: number }[][] = [[], []];
      const likers = [
        ['ada', 'bo'],
        ['cy', 'dee'],
      ];
      for (let n = 0; n < 4 + Math.floor(random() * 20); n++) {
        const side = random() < 0.5 ? 0 : 1;
        const k = Math.floor(random() * 6);
        const at = clock++;
        const free = (id: string) => !taken.has(id) && taken.add(id);
        let op: LedgerOp | undefined;
        if (k === 0)
          op = {
            op: 'addMark',
            id: fresh(),
            entry: entry(pick(HANDLES), at, { note: pick(TEXTS) }),
          };
        else if (k === 1)
          op = { op: 'addThread', thread: thread(fresh(), pick(HANDLES), at, pick(TEXTS)) };
        else if (k === 2) {
          const id = pick(baseThreads);
          op = { op: 'reply', thread: id, reply: reply(fresh(), pick(HANDLES), at, pick(TEXTS)) };
        } else if (k === 3) {
          const by = pick(likers[side] as string[]);
          op = { op: 'like', thread: pick(baseThreads), by, at: T(at) };
          // A person likes a thread once.
          const key = `${side} ${by} ${(op as { thread: string }).thread}`;
          if (!free(key)) continue;
        } else if (k === 4) {
          const id = pick(baseMarks);
          if (!free(`mark ${id}`)) continue;
          op =
            random() < 0.5
              ? { op: 'removeMark', id }
              : { op: 'addMark', id, entry: entry('ada', 1, { note: pick(TEXTS) }) };
        } else {
          const handle = `p${next++}`;
          op = { op: 'addPerson', person: person(handle, handle) };
        }
        sides[side]?.push({ ops: [op], at });
      }

      const apply = (list: { ops: LedgerOp[]; at: number }[]) =>
        more(start, ...list.flatMap((item) => item.ops));
      const ours = apply(sides[0] as { ops: LedgerOp[]; at: number }[]);
      const theirs = apply(sides[1] as { ops: LedgerOp[]; at: number }[]);
      const all = [
        ...(sides[0] as { ops: LedgerOp[]; at: number }[]),
        ...(sides[1] as { ops: LedgerOp[]; at: number }[]),
      ]
        .toSorted((a, b) => a.at - b.at)
        .flatMap((item) => item.ops);
      const expected = more(start, ...all);

      const a = mergeLedgers(start, ours, theirs);
      const b = mergeLedgers(start, theirs, ours);
      expect(a.renames, `seed ${seed}`).toEqual([]);
      const body = bodyOf(start, ours, theirs, expected);
      expect(writeLedger(a.ledger, body), `seed ${seed}`).toBe(writeLedger(expected, body));
      expect(writeLedger(b.ledger, body), `seed ${seed}`).toBe(writeLedger(expected, body));
    }
  });
});
