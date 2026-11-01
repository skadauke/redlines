import { describe, expect, it } from 'vitest';
import { normalizeLedger } from './ledger-order.ts';
import { parse } from './parse.ts';
import type { Ledger, MarkEntry, Thread } from './types.ts';

const entry = (by: string): MarkEntry => ({ by, at: '2026-10-13T22:30Z' });
const thread = (id: string): Thread => ({
  id,
  by: 'ada',
  at: '2026-10-13T22:40Z',
  likes: [],
  replies: [],
  text: `Thread ${id}`,
});

function ledgerOf(marks: string[], comments: string[] = []): Ledger {
  return {
    version: 1,
    tracking: 'everyone',
    people: [{ handle: 'ada', name: 'Ada Lovelace' }],
    marks: Object.fromEntries(marks.map((id) => [id, entry('ada')])),
    comments: comments.map(thread),
  };
}

describe('normalizeLedger', () => {
  it('orders marks and threads by the document order of their first opener', () => {
    const text =
      'a <!--ins w8nn-->b<!--/w8nn--> <!--cmt c9qf--> <!--del k3x9 c--> <!--cmt c8d2-->d<!--/c8d2-->';
    const ledger = ledgerOf(['k3x9', 'w8nn'], ['c8d2', 'c9qf']);
    const result = normalizeLedger(text, ledger);
    expect(Object.keys(result.marks)).toEqual(['w8nn', 'k3x9']);
    expect(result.comments.map((t) => t.id)).toEqual(['c9qf', 'c8d2']);
  });

  it('orders by the first segment of a mark that has several', () => {
    const text =
      '<!--ins k3x9-->a<!--/k3x9--><!--ins w8nn-->b<!--/w8nn--><!--ins k3x9-->c<!--/k3x9-->';
    const result = normalizeLedger(text, ledgerOf(['w8nn', 'k3x9']));
    expect(Object.keys(result.marks)).toEqual(['k3x9', 'w8nn']);
  });

  it('drops the entry of a mark that is no longer in the body', () => {
    const text = 'a <!--ins k3x9-->b<!--/k3x9--> c';
    const result = normalizeLedger(text, ledgerOf(['k3x9', 'w8nn', 'p7qd']));
    expect(Object.keys(result.marks)).toEqual(['k3x9']);
  });

  it('keeps the entry of a marker that the parser reads as text, so a repair finds it', () => {
    // The closer is missing: parse reports the opener and keeps it as text.
    const text = 'a <!--ins k3x9-->b';
    expect(parse(text).marks).toEqual([]);
    expect(Object.keys(normalizeLedger(text, ledgerOf(['k3x9'])).marks)).toEqual(['k3x9']);
    // A closer alone is not a mark.
    expect(normalizeLedger('a <!--/k3x9--> b', ledgerOf(['k3x9'])).marks).toEqual({});
  });

  it('keeps a thread whose anchor is gone, after the others, in the order it had (format §4)', () => {
    const text = '<!--cmt c9qf--> and <!--cmt c8d2-->x<!--/c8d2-->';
    const result = normalizeLedger(text, ledgerOf([], ['c7mb', 'c8d2', 'c6hz', 'c9qf']));
    expect(result.comments.map((t) => t.id)).toEqual(['c9qf', 'c8d2', 'c7mb', 'c6hz']);
  });

  it('does not take a comment anchor for a mark, or the other way round', () => {
    const text = '<!--cmt k3x9-->a<!--/k3x9--> <!--ins c8d2-->b<!--/c8d2-->';
    const result = normalizeLedger(text, ledgerOf(['k3x9', 'c8d2'], ['c8d2', 'k3x9']));
    expect(Object.keys(result.marks)).toEqual(['c8d2']);
    expect(result.comments.map((t) => t.id)).toEqual(['k3x9', 'c8d2']);
  });

  it('ignores markers in code', () => {
    const text =
      'Use `<!--ins k3x9-->` or\n\n```\n<!--ins w8nn-->\n```\n\n<!--ins p7qd-->x<!--/p7qd-->';
    const result = normalizeLedger(text, ledgerOf(['k3x9', 'w8nn', 'p7qd']));
    expect(Object.keys(result.marks)).toEqual(['p7qd']);
  });

  it('keeps everything else as it is', () => {
    const ledger: Ledger = {
      ...ledgerOf(['k3x9']),
      history: 'full',
      extra: { frontmatter: [{ key: 'title' }] },
    };
    const result = normalizeLedger('<!--ins k3x9-->a<!--/k3x9-->', ledger);
    expect(result).toEqual(ledger);
    // The ledger it was given is not changed.
    expect(normalizeLedger('plain', ledger).marks).toEqual({});
    expect(Object.keys(ledger.marks)).toEqual(['k3x9']);
  });
});
