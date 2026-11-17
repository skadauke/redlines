// A table with no column of its original (#477, format §3.7): when every column that is left is a
// pending insertion, the table reads as inserted whole. Its original is nothing, no view function
// throws, rejecting the inserted column takes the table away, and a decision that leaves such a table is
// never refused ("A table keeps at least one column." is gone). Every order of decisions reads alike.
import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { accept, acceptAll, reject, rejectAll } from './decide.ts';
import { parse } from './parse.ts';
import { tableEdit } from './table-ops.ts';
import type { TableOp } from './table-ops.ts';
import { readTables } from './table.ts';
import {
  ada,
  bo,
  bodyOf,
  context,
  exactly,
  expectEveryOrderAlike,
  expectNoDecisionRefused,
  file,
  thread,
} from './test-helpers.ts';
import { newestView, originalView, reviewView } from './views.ts';

type WithoutTable<T> = T extends unknown ? Omit<T, 'table'> : never;
const op = (text: string, o: WithoutTable<TableOp>, ids: string[]) => {
  const table = readTables(text, parse(text))[0]?.from ?? 0;
  return applyChanges(text, tableEdit(text, { ...o, table }, context(bo, ids)).changes);
};
const trim = (text: string) => bodyOf(text).replace(/\s+$/, '');

/** Bo inserts a column after the only column and deletes the only column of the original. */
const made = (tail: string) => {
  const base = file(`Before.\n\n| a |\n| - |\n| x |\n\nText.${tail}`);
  const inserted = op(base, { kind: 'insertCols', after: 1, count: 1 }, ['t5vw']);
  return op(inserted, { kind: 'deleteCols', cols: [0] }, ['v6xz', 'v7aa', 'v8bb']);
};
const TAILS = ['', '\n\n    indented code'];

describe('a table with no column of its original (#477)', () => {
  for (const tail of TAILS) {
    const label = tail === '' ? 'without indented code' : 'with indented code';
    const both = made(tail);

    it(`builds the issue's file (${label}): the original is nothing and no view throws`, () => {
      expect(() => originalView(both)).not.toThrow();
      expect(() => newestView(both)).not.toThrow();
      expect(() => reviewView(both)).not.toThrow();
    });

    it(`accepts the deletion, and the table then reads as inserted whole (${label})`, () => {
      const accepted = applyChanges(both, accept(both, 'v6xz'));
      expect(trim(accepted)).toContain('| <!--ins t5vw col-->');
      expect(trim(accepted)).not.toContain('<!--del');
      // The original has no table; nothing throws.
      expect(trim(originalView(accepted).text)).toBe(`Before.\n\nText.${tail}`);
      // Rejecting the inserted column removes the table, with the blank line after it.
      const rejected = applyChanges(accepted, reject(accepted, 't5vw'));
      expect(trim(rejected)).toBe(`Before.\n\nText.${tail}`);
      expect(parse(rejected).marks).toEqual([]);
    });

    it(`reads the same in every order, and no decision is refused (${label})`, () => {
      expectEveryOrderAlike(label, both, exactly);
      expectNoDecisionRefused(label, both);
    });

    it(`rejecting everything gives the original, accepting everything the newest view (${label})`, () => {
      expect(trim(applyChanges(both, rejectAll(both)))).toBe(
        trim(file(`Before.\n\n| a |\n| - |\n| x |\n\nText.${tail}`)),
      );
      expect(trim(applyChanges(both, acceptAll(both)))).toBe(trim(newestView(both).text));
    });
  }
});

describe('other shapes of a table with no column of its original (#477)', () => {
  const check = (label: string, text: string) => {
    expect(() => originalView(text), label).not.toThrow();
    expectEveryOrderAlike(label, text, exactly);
    expectNoDecisionRefused(label, text);
  };

  it('a table that ends the text, and one with text only after it', () => {
    const end = file('Before.\n\n| a |\n| - |\n| x |');
    const inserted = op(end, { kind: 'insertCols', after: 1, count: 1 }, ['t5vw']);
    check('ends the text', op(inserted, { kind: 'deleteCols', cols: [0] }, ['v6xz', 'v7aa']));
    const alone = file('| a |\n| - |\n| x |');
    const aloneIns = op(alone, { kind: 'insertCols', after: 1, count: 1 }, ['t5vw']);
    check('is all the text', op(aloneIns, { kind: 'deleteCols', cols: [0] }, ['v6xz', 'v7aa']));
  });

  it('two inserted columns, the only original column deleted', () => {
    const base = file('Before.\n\n| a |\n| - |\n| x |\n\nText.');
    const one = op(base, { kind: 'insertCols', after: 1, count: 1 }, ['t5vw']);
    const two = op(one, { kind: 'insertCols', after: 2, count: 1 }, ['t6vw']);
    check(
      'two inserted',
      op(two, { kind: 'deleteCols', cols: [0] }, ['v6xz', 'v7aa', 'v8bb', 'v9cc']),
    );
  });

  it('a pending inserted row in the table', () => {
    const base = file('Before.\n\n| a |\n| - |\n| x |\n\nText.');
    const col = op(base, { kind: 'insertCols', after: 1, count: 1 }, ['t5vw']);
    const row = op(col, { kind: 'insertRows', after: 1, count: 1 }, ['r4ab', 'r5cd', 'r6ef']);
    check(
      'with a pending row',
      op(row, { kind: 'deleteCols', cols: [0] }, ['v6xz', 'v7aa', 'v8bb', 'v9cc', 'w2dd']),
    );
  });

  it('a comment in the inserted column stays as a point where the table was', () => {
    const text = file(
      'Before.\n\n| <!--ins t5vw col--> <!--cmt c9qf-->New<!--/c9qf--> |\n| --- |\n|  |\n\n<!--del v6xz col=1  a \\n - \\n x -->\n\nText.',
      { t5vw: 'bo', v6xz: 'bo' },
      thread('c9qf', 'bo', 'A note.'),
    );
    check('with a comment', text);
    const both = applyChanges(text, accept(text, 'v6xz'));
    const gone = applyChanges(both, reject(both, 't5vw'));
    expect(trim(gone)).toBe('Before.\n\n<!--cmt c9qf-->\n\nText.');
    expect(parse(gone).ledger.comments.map((t) => t.id)).toEqual(['c9qf']);
    expect(parse(gone).marks.map((m) => m.id)).toContain('c9qf');
  });
});

describe('a table with no column of its original, beside other pending changes (#891)', () => {
  type Step = [typeof ada, WithoutTable<TableOp>, string[]];
  const make = (base: string, steps: Step[]) => {
    let text = file(base);
    for (const [person, o, ids] of steps) {
      const table = readTables(text, parse(text))[0]?.from ?? 0;
      const edit = tableEdit(text, { ...o, table }, context(person, ids));
      text = applyChanges(text, edit.changes);
    }
    return text;
  };
  const check = (label: string, text: string) => {
    expectEveryOrderAlike(label, text, exactly);
    expectNoDecisionRefused(label, text);
  };
  const TWO = 'Before.\n\n| a | b |\n| - | - |\n| x | y |\n| z | w |\n\nText.';
  const ONE = 'Before.\n\n| a |\n| - |\n| x |\n| z |\n\nText.';
  const ids = (...more: string[]) => ['v6xz', 'v7aa', 'v8bb', 'v9cc', 'w2dd', 'w3ee', ...more];

  it("another person's inserted row beside the one deleted column", () => {
    check(
      'a row inserted by Ada',
      make(ONE, [
        [bo, { kind: 'insertCols', after: 1, count: 1 }, ['t6vw']],
        [bo, { kind: 'deleteCols', cols: [0] }, ids()],
        [ada, { kind: 'insertRows', after: 1, count: 1 }, ['r4ab', 'r5cd', 'r6ef']],
      ]),
    );
  });

  it("another person's deleted row beside the one deleted column", () => {
    check(
      'a row deleted by Ada',
      make(ONE, [
        [bo, { kind: 'insertCols', after: 1, count: 1 }, ['t6vw']],
        [bo, { kind: 'deleteCols', cols: [0] }, ids()],
        [ada, { kind: 'deleteRows', rows: [1] }, ['r4ab', 'r5cd']],
      ]),
    );
  });

  it('two deleted columns', () => {
    const steps: Step[] = [
      [bo, { kind: 'insertCols', after: 2, count: 1 }, ['t6vw']],
      [bo, { kind: 'deleteCols', cols: [0, 1] }, ids()],
    ];
    check('both in one operation', make(TWO, steps));
    check(
      'a row inserted by Ada',
      make(TWO, [
        ...steps,
        [ada, { kind: 'insertRows', after: 1, count: 1 }, ['r4ab', 'r5cd', 'r6ef']],
      ]),
    );
  });

  it("another person's row, pending in the table beside the one deleted column (written by hand)", () => {
    // No operation writes this state (a table operation beside another person's change is a replacement),
    // so the file is made as a merge makes it: the carrier of the table's deletion holds the row.
    const table = '| <!--ins t5vw col--> |\n| --- |\n|  |\n| <!--ins r4ab row--> |';
    const gone = '<!--del v6xz col=1  a \\n - \\n x -->';
    const ledger = { t5vw: 'bo', v6xz: 'bo', r4ab: 'ada' };
    for (const [label, body] of [
      ['in a document', `Before.\n\n${table}\n\n${gone}\n\nText.`],
      ['the whole text', `${table}\n\n${gone}`],
    ] as const) {
      const text = file(body, ledger);
      check(label, text);
      const rejected = applyChanges(text, reject(text, 't5vw'));
      // The table is deleted whole, with the row still pending in it, or all of it is rejected with the
      // column where no unit holds the table: no change of the table is left outside the deletion.
      expect(
        parse(rejected).marks.some((m) => m.id === 't5vw'),
        label,
      ).toBe(false);
      expect(trim(originalView(rejected).text), label).toContain('| a |');
    }
  });

  it('two deleted columns, one by each of two people', () => {
    check(
      'two people',
      make(TWO, [
        [bo, { kind: 'insertCols', after: 2, count: 1 }, ['t6vw']],
        [bo, { kind: 'deleteCols', cols: [0] }, ids()],
        [ada, { kind: 'deleteCols', cols: [0] }, ids('x4ff')],
      ]),
    );
  });
});
