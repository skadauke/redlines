import { describe, expect, it } from 'vitest';
import { applyLedgerOps, emptyLedgerMap, ledgerOps } from './ledger-map.ts';
import type { LedgerMap } from './ledger-map.ts';
import type { MarkEntry, Thread } from './types.ts';

const at = '2026-11-17T10:00Z';
const entry = (by: string) => ({ by, at, kind: 'ins' }) as unknown as MarkEntry;
const thread = (id: string, over: Partial<Thread> = {}): Thread => ({
  id,
  by: 'ada',
  at,
  likes: [],
  replies: [],
  text: 'Why?',
  ...over,
});

function withMarks(...ids: string[]): LedgerMap {
  const map = emptyLedgerMap();
  for (const id of ids) map.marks.set(id, entry('ada'));
  return map;
}

describe('ledgerOps', () => {
  it('has none for the same ledger', () => {
    expect(ledgerOps(withMarks('a', 'b'), withMarks('a', 'b'))).toEqual([]);
  });

  it('removes and adds marks by id, and leaves the keys of another ledger alone', () => {
    const ops = ledgerOps(withMarks('a', 'b'), withMarks('b', 'c'));
    const result = applyLedgerOps(withMarks('a', 'b', 'd'), ops);
    expect([...result.marks.keys()].sort()).toEqual(['b', 'c', 'd']);
  });

  it('adds a reply and a like to a thread that someone else resolved meanwhile', () => {
    const before = emptyLedgerMap();
    before.threads.set('t', thread('t'));
    const after = emptyLedgerMap();
    after.threads.set(
      't',
      thread('t', {
        likes: [{ by: 'bo', at }],
        replies: [{ id: 'r1', by: 'bo', at: '2026-11-17T10:05Z', text: 'Because.' }],
      }),
    );
    const theirs = emptyLedgerMap();
    theirs.threads.set('t', thread('t', { resolved: { by: 'ada', at } }));
    const t = applyLedgerOps(theirs, ledgerOps(before, after)).threads.get('t')!;
    expect(t.replies.map((r) => r.id)).toEqual(['r1']);
    expect(t.likes.map((l) => l.by)).toEqual(['bo']);
  });

  it('keeps two replies, one from each ledger', () => {
    const before = emptyLedgerMap();
    before.threads.set('t', thread('t'));
    const mine = emptyLedgerMap();
    mine.threads.set('t', thread('t', { replies: [{ id: 'r1', by: 'bo', at, text: 'One.' }] }));
    const theirs = emptyLedgerMap();
    theirs.threads.set('t', thread('t', { replies: [{ id: 'r2', by: 'ada', at, text: 'Two.' }] }));
    const t = applyLedgerOps(theirs, ledgerOps(before, mine)).threads.get('t')!;
    expect(t.replies.map((r) => r.id)).toEqual(['r2', 'r1']);
  });

  it('turns one ledger into the other when applied to the first', () => {
    const before = withMarks('a');
    before.threads.set('t', thread('t'));
    const after = withMarks('a', 'b');
    after.threads.set('t', thread('t', { text: 'Edited.', resolved: { by: 'bo', at } }));
    after.settings.tracking = 'everyone';
    after.extra.set('x', 'one');
    const result = applyLedgerOps(before, ledgerOps(before, after));
    expect(Object.fromEntries(result.marks)).toEqual(Object.fromEntries(after.marks));
    expect(result.threads.get('t')).toEqual(after.threads.get('t'));
    expect(result.settings).toEqual(after.settings);
    expect(result.extra).toEqual(after.extra);
  });
});
