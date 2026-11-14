// Aligning columns, tracked and plain, decided in any order and viewed (format §3.7, §3.9, §8): a
// tracked change is a point mark, `<!--fmt ID align=SPEC-->`, at the end of the header's last cell,
// whose `SPEC` is the old delimiter row. The span form that other tools wrote (an opener before the
// table, a closer after it) is still read and decided, and never written.
import { describe, expect, it } from 'vitest';
import { suggestReplace } from './agent.ts';
import { applyChanges } from './changes.ts';
import { accept, acceptAll, canReject, reject, rejectAll } from './decide.ts';
import { EditError } from './errors.ts';
import { formatChange } from './format-blocks.ts';
import { encodeValue } from './format-ops.ts';
import * as format from './index.ts';
import { parse } from './parse.ts';
import { alignLabel, alignMarkOf, closerRange, isAlignPoint } from './table-align.ts';
import { ALIGN_FIRST, pendingOf, ruleTwo, tableEdit, untrackedTableEdit } from './table-ops.ts';
import { outerPipeWrites } from './table-rules.ts';
import type { TableOp, TablePending } from './table-ops.ts';
import { readTables } from './table.ts';
import type { TableAlign } from './table.ts';
import { trackedEdit } from './track.ts';
import { untrackedEdit } from './untracked.ts';
import {
  TIME,
  ada,
  blockLeaves,
  bo,
  bodyOf,
  claudeAda,
  context,
  everyOrder,
  exactly,
  expectEveryOrderAlike,
  expectNoDecisionRefused,
  expectInOrder,
  file,
  problemsOf,
} from './test-helpers.ts';
import type { Leaf } from './test-helpers.ts';
import { expectEveryOrderRead } from './oracle.ts';
import { newestView, originalView, reviewView } from './views.ts';

const FRUIT =
  '| Fruit  | Count | Price |\n| :----- | ----- | ----: |\n| Apples | 3     | 1.20  |\n| Pears  | 5     | 0.90  |';
const IDS = ['k3x9', 'w8nn', 'p5qm', 'q6rs'];
const trim = (text: string) => bodyOf(text).replace(/[\r\n]+$/, '');
/** The same body, byte for byte: a file with no pending change has no ledger. */
const same = (a: string, b: string) => expect(trim(a)).toBe(trim(b));
const SPEC = '\\|\\x20:-\\-\\-\\-\\-\\x20\\|\\x20-\\-\\-\\-\\-\\x20\\|\\x20-\\-\\-\\-:\\x20\\|';
/** The mark of Ada's change that centers Count: its value is the old delimiter row of `FRUIT`. */
const MARK = `<!--fmt k3x9 align=${SPEC}-->`;
/** `FRUIT` with Count centered, and the same with the mark that a tracked change writes. */
const CENTERED = FRUIT.replace('| ----- |', '| :---: |');
const POINTED = CENTERED.replace('Price |', `Price${MARK} |`);
/** The mark of Ada's change of a table whose old delimiter row is `row`. */
const markFor = (row: string, id = 'k3x9') => `<!--fmt ${id} align=${encodeValue(row)}-->`;
/** The tables of a file as micromark reads them. */
const tableLeaves = (text: string): Leaf[] => blockLeaves(text).filter((l) => l.kind === 'table');
const COLUMNS_FIRST = 'Accept or reject the column changes in this table first.';
const ROWS_FIRST = 'Accept or reject the row changes in this table first.';
const PLACE =
  "A marker can't go at the end of this table's header, where Markdown would read it otherwise. Change the end of its last cell first, then align.";
const LOST =
  "This alignment change can't be rejected, because its table no longer has the columns it had. Accept it, or change the text in Raw with Track Changes off.";

type Shape =
  | { kind: 'align'; cols: number[]; align: TableAlign }
  | { kind: 'insertCols'; after: number }
  | { kind: 'deleteCols'; cols: number[] }
  | { kind: 'moveCols'; cols: number[]; to: number }
  | { kind: 'insertRows'; after: number }
  | { kind: 'deleteRows'; rows: number[] }
  | { kind: 'moveRows'; rows: number[]; to: number };

function edit(text: string, shape: Shape, who: typeof ada | null = ada, ids = IDS) {
  const table = readTables(text, parse(text))[0]?.from ?? 0;
  const op = { count: 1, ...shape, table } as TableOp;
  const done = who ? tableEdit(text, op, context(who, ids)) : untrackedTableEdit(text, op);
  return { ...done, after: applyChanges(text, done.changes) };
}
const align = (text: string, cols: number[], to: TableAlign, who = ada, ids = IDS) =>
  edit(text, { kind: 'align', cols, align: to }, who, ids);
const said = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return error instanceof EditError ? error.message : String(error);
  }
  return 'no error';
};
const aligns = (text: string) => readTables(text, parse(text))[0]?.aligns;
/** The first line of a file's table text: the header row. */
const headerLine = (text: string) => trim(text).split('\n')[0];

/** Nothing is pending in a table. */
const none: TablePending = {
  rowsInserted: false,
  rowsChanged: false,
  colsInserted: false,
  colsChanged: false,
  align: false,
  headerChanged: false,
};

describe('aligning a column, tracked (format §3.7)', () => {
  const start = file(FRUIT);

  it('writes a point mark at the end of the header’s last cell, with the old delimiter row', () => {
    const done = align(start, [1], 'center');
    expect(trim(done.after)).toBe(POINTED);
    // The caret is at the text of the first column aligned.
    expect(done.after.slice(done.caret, done.caret + 5)).toBe('Count');
  });

  it('is a clean file, with its entry in the ledger', () => {
    const done = align(start, [1], 'center').after;
    expect(problemsOf(parse(done))).toEqual([]);
    expect(parse(done).ledger.marks['k3x9']).toEqual({ by: 'ada', at: TIME });
    expect(aligns(done)).toEqual(['left', 'center', 'right']);
    expect(tableLeaves(done)).toHaveLength(1);
    expect(tableLeaves(done)).toEqual(tableLeaves(start));
    expect(parse(done).marks.map((m) => [m.id, m.segments.length, m.segments[0]?.close])).toEqual([
      ['k3x9', 1, undefined],
    ]);
  });

  it('writes the file’s own line breaks', () => {
    const crlf = start.replace(/\n/g, '\r\n');
    const done = align(crlf, [0, 2], 'center').after;
    expect(done.replace(/\r\n/g, '')).not.toContain('\n');
    same(applyChanges(done, reject(done, 'k3x9')), crlf);
    same(
      applyChanges(done, accept(done, 'k3x9')),
      crlf.replace(':-----', ':----:').replace('| ----: |', '| :---: |'),
    );
  });

  it('gives every byte back when rejected, and none else when accepted', () => {
    for (const cols of [[0], [1], [2], [0, 1, 2]]) {
      const done = align(start, cols, 'center').after;
      same(applyChanges(done, reject(done, 'k3x9')), start);
      const accepted = applyChanges(done, accept(done, 'k3x9'));
      expect(parse(accepted).marks).toEqual([]);
      expect(trim(accepted)).toBe(trim(newestView(done).text));
      expect(trim(applyChanges(done, rejectAll(done)))).toBe(FRUIT);
      expect(trim(applyChanges(done, acceptAll(done)))).toBe(trim(newestView(done).text));
      expect(trim(originalView(done).text)).toBe(FRUIT);
    }
  });

  it('changes no byte outside the table’s first two lines, deciding it either way', () => {
    const second = FRUIT.replace('Fruit', 'Veg');
    // A table between blocks and before another table, and one that starts the file.
    for (const body of [`Before it.\n\n${FRUIT}\n\nAfter it.\n\n${second}`, FRUIT]) {
      const text = file(body);
      const done = align(text, [1], 'center').after;
      const lines = (t: string) => trim(t).split('\n');
      const before = lines(text);
      const top = before.indexOf(FRUIT.split('\n')[0] ?? '');
      for (const [name, after] of [
        ['aligned', done],
        ['accepted', applyChanges(done, accept(done, 'k3x9'))],
        ['rejected', applyChanges(done, reject(done, 'k3x9'))],
      ] as const) {
        const now = lines(after);
        expect(now, name).toHaveLength(before.length);
        before.forEach((line, i) => {
          if (i !== top && i !== top + 1) expect(now[i], `${name}, line ${i}`).toBe(line);
        });
      }
      same(applyChanges(done, reject(done, 'k3x9')), text);
      expect(problemsOf(parse(done))).toEqual([]);
      expectEveryOrderAlike('between blocks', done, exactly);
    }
    // The second table is as it was, and the first is the one aligned.
    const text = file(`Before it.\n\n${FRUIT}\n\nAfter it.\n\n${second}`);
    const done = align(text, [1], 'center').after;
    expect(aligns(done)).toEqual(['left', 'center', 'right']);
    expect(readTables(done, parse(done))[1]?.aligns).toEqual(['left', '', 'right']);
  });

  it('writes no blank line, no opener line and no closer', () => {
    const done = trim(align(start, [1], 'center').after);
    expect(done.split('\n')).toHaveLength(FRUIT.split('\n').length);
    expect(done).not.toContain('\n\n');
    expect(done).not.toContain('<!--/');
    expect(done.split('\n').filter((line) => line.startsWith('<!--'))).toEqual([]);
    expect(done.match(/<!--/g)).toHaveLength(1);
  });

  it('keeps each cell as wide as it was, and writes the colons the alignment asks for', () => {
    const rows = (to: TableAlign) =>
      trim(newestView(align(start, [0, 1, 2], to).after).text).split('\n')[1];
    expect(rows('left')).toBe('| :----- | :---- | :---- |');
    expect(rows('center')).toBe('| :----: | :---: | :---: |');
    expect(rows('right')).toBe('| -----: | ----: | ----: |');
    expect(rows('')).toBe('| ------ | ----- | ----- |');
    // A cell of one dash grows by the colons.
    const narrow = file('| a | b |\n|-|-|\n| c | d |');
    expect(trim(newestView(align(narrow, [0], 'center').after).text).split('\n')[1]).toBe(
      '|:-:|-|',
    );
  });

  describe('where the mark stands', () => {
    it('is the line’s end in a header with no trailing pipe, where no pipe is added', () => {
      const bare = file('a | b\n--|--\nc | d');
      const done = align(bare, [1], 'right').after;
      expect(trim(done)).toBe(`a | b${markFor('--|--')}\n--|-:\nc | d`);
      expect(aligns(done)).toEqual(['', 'right']);
      same(applyChanges(done, reject(done, 'k3x9')), bare);
      same(applyChanges(done, accept(done, 'k3x9')), file('a | b\n--|-:\nc | d'));
      expectEveryOrderAlike('bare', done, exactly);
    });

    it('is in front of the spaces after the text of the last cell', () => {
      const spaced = file('a | b   \n--|--\nc | d');
      const done = align(spaced, [1], 'right').after;
      expect(trim(done)).toBe(`a | b${markFor('--|--')}   \n--|-:\nc | d`);
      same(applyChanges(done, reject(done, 'k3x9')), spaced);
      expectEveryOrderAlike('spaces after', done, exactly);
    });

    it('is after the first space of an empty last cell, which deciding gives back', () => {
      const empty = file('| a |  |\n| - | - |\n| c | d |');
      const mark = markFor('| - | - |');
      const done = align(empty, [0], 'left');
      expect(trim(done.after)).toBe(`| a | ${mark} |\n| :- | - |\n| c | d |`);
      same(applyChanges(done.after, reject(done.after, 'k3x9')), empty);
      same(
        applyChanges(done.after, accept(done.after, 'k3x9')),
        file('| a |  |\n| :- | - |\n| c | d |'),
      );
      expect(blockLeaves(done.after)).toEqual(blockLeaves(empty));
      expectEveryOrderAlike('empty last cell', done.after, exactly);
      // The caret of an empty last cell that is aligned stays in front of the mark.
      const last = align(empty, [1], 'right');
      expect(last.after.slice(last.caret, last.caret + 8)).toBe('<!--fmt ');
    });

    it('is the end of the text of a header of one cell', () => {
      const one = file('| a |\n| - |\n| b |');
      const done = align(one, [0], 'right').after;
      expect(trim(done)).toBe(`| a${markFor('| - |')} |\n| -: |\n| b |`);
      same(applyChanges(done, reject(done, 'k3x9')), one);
      expect(tableLeaves(done)).toEqual(tableLeaves(one));
      expectEveryOrderAlike('one cell', done, exactly);
    });

    it('is after a pipe that a code span holds, which reads as the same table', () => {
      const text = file('| a | `x\\|y` |\n| - | - |\n| c | d |');
      const done = align(text, [0], 'right').after;
      expect(trim(done)).toBe(`| a | \`x\\|y\`${markFor('| - | - |')} |\n| -: | - |\n| c | d |`);
      expect(tableLeaves(done)).toEqual(tableLeaves(text));
      expect(readTables(done, parse(done))[0]?.aligns).toEqual(['right', '']);
      expectEveryOrderAlike('a pipe in a code span', done, exactly);
    });

    it('is refused where the end of the last cell would make Markdown read it otherwise', () => {
      for (const end of ['b\\', '_b_', 'b_']) {
        const text = file(`| a | ${end} |\n| - | - |\n| c | d |`);
        expect(
          said(() => align(text, [0], 'right')),
          end,
        ).toBe(PLACE);
        // With Track Changes off no mark is written, and the delimiter row changes as asked.
        expect(
          said(() => edit(text, { kind: 'align', cols: [0], align: 'right' }, null)),
          end,
        ).toBe('no error');
      }
      // The same in a header with no trailing pipe, where the mark is the line's end.
      const bare = file('a | _b_\n--|--\nc | d');
      expect(said(() => align(bare, [0], 'right'))).toBe(PLACE);
    });

    it('is refused where the scan would not read the mark: an unclosed comment, a backtick paired below', () => {
      // The mark would be inside a comment that never closes, or inside a code span that the scan pairs
      // across the cells of the table: it would be no change, and its entry would be lost without a word.
      for (const body of [
        '| a | b <!-- x |\n| - | - |\n| c | d |',
        'a | b <!--\n--|--\nc | d',
        '| a | `b |\n| - | - |\n| c | d` |',
        'a | `b\n--|--\nc | d`',
      ]) {
        const text = file(body);
        expect(
          said(() => align(text, [0], 'right')),
          body,
        ).toBe(PLACE);
        expect(
          said(() => edit(text, { kind: 'align', cols: [0], align: 'right' }, null)),
          body,
        ).toBe('no error');
      }
      // A comment that closes, and a backtick that closes in the cell, are no hindrance.
      for (const body of [
        '| a | b<!-- x --> |\n| - | - |\n| c | d |',
        '| a | `b` |\n| - | - |\n| c | d |',
      ]) {
        const done = align(file(body), [0], 'right').after;
        expect(
          parse(done).marks.map((m) => m.id),
          body,
        ).toEqual(['k3x9']);
      }
    });

    it('is written after the ends that Markdown reads the same with the mark', () => {
      for (const end of [
        'b\\\\',
        '*b*',
        'b*',
        '**b**',
        '`b`',
        '[b](c)',
        'https://example.org/a',
        'b~~',
        '<b>',
        '&amp;',
      ]) {
        const text = file(`| a | ${end} |\n| - | - |\n| c | d |`);
        const done = align(text, [0], 'right').after;
        expect(problemsOf(parse(done)), end).toEqual([]);
        const mark = readTables(done, parse(done))[0]?.rows[0]?.cells[1];
        expect(done.slice(mark?.textTo).startsWith('<!--fmt k3x9'), end).toBe(true);
        expect(tableLeaves(done), end).toEqual(tableLeaves(text));
        expect(tableLeaves(applyChanges(done, accept(done, 'k3x9'))), end).toEqual(
          tableLeaves(text),
        );
        same(applyChanges(done, reject(done, 'k3x9')), text);
        // Every order of decisions reads, as micromark reads it, as the newest view does.
        expectEveryOrderRead(end, done);
      }
    });

    it('is refused where another change at the end of the cell would put the end of its text in front of the mark', () => {
      // Bo's pending deletion of the backslash, or of the underscore: the cell reads fine now, and
      // rejecting the deletion would bring the backslash back in front of the mark, which it would
      // escape, or the underscore, whose flanking the mark would change.
      const byBo = (text: string, take: string, insert = '') => {
        // The last such character of the header row: the end of its last cell.
        const at = text.lastIndexOf(take, text.indexOf('\n'));
        return applyChanges(
          text,
          trackedEdit(text, { from: at, to: at + take.length, insert }, context(bo, ['c2dd'])),
        );
      };
      for (const [end, take] of [
        ['b\\', '\\'],
        ['b_', '_'],
      ] as const) {
        const text = byBo(file(`| a | ${end} |\n| - | - |\n| c | d |`), take);
        expect(newestView(text).text).not.toMatch(/[\\_]\s*\|/);
        expect(
          said(() => align(text, [0], 'right')),
          end,
        ).toBe(PLACE);
        // With Track Changes off no mark is written.
        expect(
          said(() => edit(text, { kind: 'align', cols: [0], align: 'right' }, null)),
          end,
        ).toBe('no error');
      }
      // A change that brings back nothing in the way is no hindrance: the mark ends the cell, every order
      // of decisions reads alike, and every decision is possible.
      for (const [end, take, insert] of [
        ['bx', 'x', ''],
        ['b\\\\', '\\', 'q'],
        ['b\\', '\\', 'q'],
        ['*b*', '*', ''],
      ] as const) {
        const text = byBo(file(`| a | ${end} |\n| - | - |\n| c | d |`), take, insert);
        const done = align(text, [0], 'right').after;
        const cell = readTables(done, parse(done))[0]?.rows[0]?.cells[1];
        expect(cell?.textTo, end).toBe(done.indexOf('<!--fmt k3x9'));
        expectEveryOrderAlike(end, done, exactly);
        expectNoDecisionRefused(end, done);
        expectEveryOrderRead(end, done);
      }
    });
  });

  it('names the change by the columns it changed, in a card and in the review view', () => {
    const done = align(start, [1], 'center').after;
    const parsed = parse(done);
    const mark = parsed.marks[0];
    expect(mark && formatChange(parsed, mark)).toEqual([
      { kind: 'align', columns: [{ col: 1, name: 'Count', now: 'center', was: '' }] },
    ]);
    expect(alignLabel([{ col: 0, name: 'Fruit', now: 'center', was: 'left' }])).toBe(
      'column Fruit centered (was left)',
    );
    // The note stands where the mark stands.
    expect(reviewView(done)).toContain(
      '| Fruit  | Count | Price{>>[k3x9 ada] Formatted: column Count centered (was default)<<} |',
    );
    expect(reviewView(done)).not.toContain('align=');
    expect(canReject(parsed, parsed.marks[0]!)).toBe(true);
  });

  it('changes your own pending change in place, and takes it away when the old alignments are back', () => {
    const one = align(start, [1], 'center').after;
    const two = align(one, [0], 'right', ada, ['m5nn']).after;
    expect(parse(two).marks.map((m) => m.id)).toEqual(['k3x9']);
    expect(aligns(two)).toEqual(['right', 'center', 'right']);
    // The mark is where it was, with the value it had.
    expect(headerLine(two)).toBe(headerLine(one));
    same(applyChanges(two, reject(two, 'k3x9')), start);
    const back = align(two, [0], 'left', ada, ['m5nn']).after;
    expect(aligns(back)).toEqual(['left', 'center', 'right']);
    const undone = align(back, [1], '', ada, ['m5nn']).after;
    // The old alignments are back: the change is gone, with the old row as it was written.
    same(undone, start);
    expect(parse(undone).marks).toEqual([]);
    expect(parse(undone).ledger.marks).toEqual({});
  });

  it('refuses another person’s pending alignment change, naming them', () => {
    const one = align(start, [1], 'center').after;
    expect(said(() => align(one, [0], 'right', bo, ['c2dd']))).toBe(
      "Ada Lovelace's alignment change is pending. Decide it first.",
    );
    expect(said(() => align(start, [0], 'left', ada))).toBe(
      'The columns are already aligned that way.',
    );
  });

  it('is refused while a column is pending, in words, and plain is allowed', () => {
    const pending = {
      inserted: edit(start, { kind: 'insertCols', after: 1 }, bo, ['c2dd']).after,
      moved: edit(start, { kind: 'moveCols', cols: [0], to: 3 }, bo, ['c2dd', 'f3gg']).after,
      deleted: edit(start, { kind: 'deleteCols', cols: [1] }, bo, ['c2dd']).after,
    };
    for (const [name, text] of Object.entries(pending)) {
      expect(
        said(() => align(text, [0], 'center')),
        name,
      ).toBe(COLUMNS_FIRST);
      const table = readTables(text, parse(text))[0];
      expect(table && ruleTwo('align', pendingOf(table, parse(text)), true), name).toBe(
        COLUMNS_FIRST,
      );
      expect(
        said(() => edit(text, { kind: 'align', cols: [0], align: 'center' }, null)),
        name,
      ).toBe('no error');
    }
  });

  it('is allowed with any body row pending, and decided in every order', () => {
    for (const shape of [
      { kind: 'insertRows', after: 1 },
      { kind: 'deleteRows', rows: [2] },
      { kind: 'moveRows', rows: [1], to: 3 },
    ] satisfies Shape[]) {
      const rows = edit(start, shape, bo, ['c2dd', 'f3gg']).after;
      const table = readTables(rows, parse(rows))[0];
      expect(table && pendingOf(table, parse(rows)).headerChanged, shape.kind).toBe(false);
      const done = align(rows, [1], 'center').after;
      expect(aligns(done)).toEqual(['left', 'center', 'right']);
      // Nothing is written below the table: a deletion line stays the last thing there.
      expect(trim(done)).not.toContain('<!--/');
      expectEveryOrderAlike(`${shape.kind} pending`, done, exactly);
      expect(expectNoDecisionRefused(shape.kind, done)).toBeGreaterThan(2);
      expect(trim(applyChanges(done, rejectAll(done)))).toBe(trim(originalView(done).text));
    }
  });

  it('is refused while the header is a pending row change, in words; plain is allowed', () => {
    const states: [string, string][] = [
      [
        'a row inserted above it',
        edit(start, { kind: 'insertRows', after: -1 }, bo, ['c2dd']).after,
      ],
      [
        'a row moved to the top',
        edit(start, { kind: 'moveRows', rows: [2], to: 0 }, bo, ['c2dd', 'f3gg']).after,
      ],
      ['the header deleted', edit(start, { kind: 'deleteRows', rows: [0] }, bo, ['c2dd']).after],
      [
        'the header moved away',
        edit(start, { kind: 'moveRows', rows: [0], to: 3 }, bo, ['c2dd', 'f3gg']).after,
      ],
    ];
    for (const [name, text] of states) {
      const parsed = parse(text);
      const table = readTables(text, parsed)[0];
      const pending = table && pendingOf(table, parsed);
      expect(pending?.headerChanged, name).toBe(true);
      expect(pending?.align, name).toBe(false);
      expect(pending && ruleTwo('align', pending, true), name).toBe(ROWS_FIRST);
      expect(pending && ruleTwo('align', pending, false), name).toBeNull();
      expect(
        said(() => align(text, [1], 'center', ada, ['k3x9'])),
        name,
      ).toBe(ROWS_FIRST);
      // Plain alignment writes no mark, and is allowed.
      const plain = edit(text, { kind: 'align', cols: [1], align: 'center' }, null);
      expect(
        parse(plain.after)
          .marks.map((m) => m.id)
          .sort(),
        name,
      ).toEqual(parsed.marks.map((m) => m.id).sort());
      expect(aligns(plain.after)?.[1], name).toBe('center');
    }
    // A column change and a header change together: the columns first.
    expect(ruleTwo('align', { ...none, colsChanged: true, headerChanged: true }, true)).toBe(
      COLUMNS_FIRST,
    );
  });

  it('refuses a row operation on the header while it is pending, tracked and plain, and allows the others', () => {
    // A header and three rows.
    const four = file(`${FRUIT}\n| Plums  | 7     | 2.00  |`);
    const pending = align(four, [1], 'center').after;
    const table = readTables(pending, parse(pending))[0];
    expect(table && pendingOf(table, parse(pending)).align).toBe(true);
    expect(table && pendingOf(table, parse(pending)).headerChanged).toBe(false);
    const refused: Shape[] = [
      { kind: 'insertRows', after: -1 },
      { kind: 'deleteRows', rows: [0] },
      { kind: 'deleteRows', rows: [0, 2] },
      { kind: 'moveRows', rows: [0], to: 3 },
      { kind: 'moveRows', rows: [2], to: 0 },
    ];
    const allowed: Shape[] = [
      { kind: 'insertRows', after: 0 },
      { kind: 'insertRows', after: 3 },
      { kind: 'deleteRows', rows: [2] },
      { kind: 'moveRows', rows: [1], to: 3 },
      { kind: 'moveRows', rows: [3], to: 1 },
    ];
    for (const [who, label] of [
      [bo, 'Bo'],
      [ada, 'Ada'],
      [null, 'plain'],
    ] as const) {
      for (const shape of refused) {
        expect(
          said(() => edit(pending, shape, who, ['c2dd', 'f3gg'])),
          `${label} ${JSON.stringify(shape)}`,
        ).toBe(ALIGN_FIRST);
      }
      for (const shape of allowed) {
        const name = `${label} ${JSON.stringify(shape)}`;
        const written = edit(pending, shape, who, ['c2dd', 'f3gg']).after;
        expect(headerLine(written), name).toBe(headerLine(pending));
        expectEveryOrderAlike(name, written, exactly);
        expectNoDecisionRefused(name, written);
      }
    }
  });

  it('refuses an agent’s edit of the table that adds a row above the header or takes it out', () => {
    const text = file(`Intro.\n\n${FRUIT}\n\nAfter.`);
    const one = align(text, [1], 'center').after;
    const rows = CENTERED.split('\n');
    const agent = (table: string[]) =>
      suggestReplace(one, CENTERED, table.join('\n'), context(claudeAda, ['c2dd', 'f3gg', 'h4jj']));
    const plums = '| Plums  | 7     | 2.00  |';
    // A row above the header, and the header taken out.
    expect(
      said(() => agent([plums, rows[1] ?? '', rows[0] ?? '', rows[2] ?? '', rows[3] ?? ''])),
    ).toBe(ALIGN_FIRST);
    expect(said(() => agent([rows[2] ?? '', rows[1] ?? '', rows[3] ?? '']))).toBe(ALIGN_FIRST);
    // A row below the header is written, and decided in every order.
    const below = applyChanges(
      one,
      agent([rows[0] ?? '', rows[1] ?? '', plums, rows[2] ?? '', rows[3] ?? '']).changes,
    );
    expect(headerLine(below)).toBe(headerLine(one));
    expect(trim(newestView(below).text)).toContain('| Plums  | 7     | 2.00  |');
    expectEveryOrderAlike('an agent’s row', below, exactly);
    expectNoDecisionRefused('an agent’s row', below);
  });

  it('still refuses every column operation while it is pending, tracked and plain', () => {
    const done = align(start, [1], 'center').after;
    for (const who of [bo, null]) {
      for (const shape of [
        { kind: 'insertCols', after: 1 },
        { kind: 'deleteCols', cols: [1] },
        { kind: 'moveCols', cols: [0], to: 2 },
      ] satisfies Shape[]) {
        expect(
          said(() => edit(done, shape, who, ['c2dd', 'f3gg'])),
          `${who?.handle} ${shape.kind}`,
        ).toBe(ALIGN_FIRST);
      }
    }
  });

  it('keeps a header with no trailing pipe a table when all the text of its last cell goes', () => {
    const bare = file('a | b\n--- | ---\nc | d');
    const done = align(bare, [1], 'center').after;
    const mark = markFor('--- | ---');
    expect(headerLine(done)).toBe(`a | b${mark}`);
    const cell = readTables(done, parse(done))[0]?.rows[0]?.cells[1];
    const gone = { from: cell?.textFrom ?? 0, to: cell?.textTo ?? 0, insert: '' };
    expect(done.slice(gone.from, gone.to)).toBe('b');
    // The edit takes all the text of the cell, which the mark after it does not count in: the pipe is
    // the line's end, after the mark.
    expect(outerPipeWrites(done, gone, parse(done))).toEqual([
      { at: done.indexOf('\n'), insert: ' |', leading: false },
    ]);
    const states: [string, string][] = [
      ['Bo, tracked', applyChanges(done, trackedEdit(done, gone, context(bo, ['c2dd'])))],
      ['Ada, tracked', applyChanges(done, trackedEdit(done, gone, context(ada, ['c2dd'])))],
      ['plain', applyChanges(done, untrackedEdit(done, gone))],
    ];
    for (const [name, after] of states) {
      // The closing pipe is written plain, after the mark, and is in both versions.
      expect(headerLine(after), name).toMatch(/--> \|$/);
      expect(headerLine(after), name).toContain(mark);
      const { outcomes, stuck } = everyOrder(after);
      expect(stuck, name).toEqual([]);
      expect(outcomes.size, name).toBeGreaterThan(1);
      for (const [decided, results] of outcomes) {
        for (const result of results) {
          const tables = (JSON.parse(result) as Leaf[]).filter((leaf) => leaf.kind === 'table');
          expect(tables, `${name}: ${decided}`).toHaveLength(1);
          expect(
            tables[0]?.rows?.map((row) => row.length),
            `${name}: ${decided}`,
          ).toEqual([2, 2]);
        }
      }
      expectEveryOrderAlike(name, after, exactly);
      expectNoDecisionRefused(name, after);
    }
    // With a trailing pipe there is nothing to write: the header keeps its pipe, and its cells.
    const piped = align(file('| a | b |\n| --- | --- |\n| c | d |'), [1], 'center').after;
    const last = readTables(piped, parse(piped))[0]?.rows[0]?.cells[1];
    const away = { from: last?.textFrom ?? 0, to: last?.textTo ?? 0, insert: '' };
    const after = applyChanges(piped, trackedEdit(piped, away, context(bo, ['c2dd'])));
    expect(headerLine(after)).toBe(`| a | <!--del c2dd b-->${markFor('| --- | --- |')} |`);
    expectEveryOrderAlike('a trailing pipe', after, exactly);
  });

  it('allows a tracked edit right under the table, where no closer is to share a line', () => {
    const text = file(`${FRUIT}\n\nOutro words.\n\nMore.`);
    const one = align(text, [1], 'center').after;
    const view = newestView(one);
    const at = view.text.indexOf('Outro words.');
    const end = at + 'Outro words.'.length;
    const edits: [string, number, number, string][] = [
      ['typing on the blank line', at - 1, at - 1, 'q'],
      ['deleting a break', at - 2, at - 1, ''],
      ['the break and the paragraph', at - 2, end, ''],
      ['the paragraph', at, end, ''],
      ['the word Outro', at, at + 5, ''],
      ['typing at its start', at, at, 'q'],
      ['a new paragraph in front of it', at - 2, at - 2, '\n\nNew.'],
    ];
    for (const who of [bo, ada]) {
      for (const [name, a, b, insert] of edits) {
        const from = view.map.toSource(a, 1);
        const to = Math.max(from, view.map.toSource(b, -1));
        const label = `${who.handle}: ${name}`;
        const edited = applyChanges(
          one,
          trackedEdit(one, { from, to, insert }, context(who, ['c2dd', 'f3gg', 'h4jj'])),
        );
        expect(problemsOf(parse(edited)), label).toEqual([]);
        expectEveryOrderAlike(label, edited, exactly);
        expectNoDecisionRefused(label, edited);
      }
    }
  });

  it('decides in every order with a text edit in a cell of the table', () => {
    const done = align(start, [1], 'center').after;
    const at = done.indexOf('Apples') + 3;
    const typed = applyChanges(
      done,
      trackedEdit(done, { from: at, to: at, insert: 'QQ' }, context(bo, ['b7cd'])),
    );
    expect(
      parse(typed)
        .marks.map((m) => m.id)
        .sort(),
    ).toEqual(['b7cd', 'k3x9']);
    expectEveryOrderAlike('typed in a cell', typed, exactly);
    const rejected = applyChanges(typed, reject(typed, 'k3x9'));
    expect(trim(rejected)).toContain('| App<!--ins b7cd-->QQ<!--/b7cd-->les | 3');
    expect(aligns(rejected)).toEqual(['left', '', 'right']);
    // The first and the last cell of the table, and the header.
    for (const word of ['Fruit', '0.90', 'Count']) {
      const to = done.indexOf(word) + word.length;
      const edited = applyChanges(
        done,
        trackedEdit(done, { from: to, to, insert: 'Z' }, context(bo, ['b7cd'])),
      );
      expectEveryOrderAlike(`typed after ${word}`, edited, exactly);
    }
  });

  it('can decide each change on its own, in every order, with rows around', () => {
    const text = file(`${FRUIT}\n\nOutro words.`);
    let states = 0;
    for (const first of [
      { kind: 'deleteRows', rows: [1] },
      { kind: 'insertRows', after: 1 },
      { kind: 'moveRows', rows: [1], to: 3 },
    ] satisfies Shape[]) {
      const base = edit(text, first, bo, ['c2dd', 'f3gg']).after;
      // Another person's alignment change beside a row change, and a plain edit in the paragraph below.
      const withAlign = align(base, [1], 'center', ada, ['k3x9']).after;
      const plainBelow = (t: string) => {
        const o = t.indexOf('Outro');
        return applyChanges(t, untrackedEdit(t, { from: o + 5, to: o + 5, insert: 'q' }));
      };
      for (const t of [withAlign, plainBelow(withAlign)]) {
        states += expectNoDecisionRefused(JSON.stringify(first), t);
      }
    }
    expect(states).toBeGreaterThan(20);
  });

  it('is one change with the rest of a group, and takes a note', () => {
    const table = readTables(start, parse(start))[0]?.from ?? 0;
    const done = applyChanges(
      start,
      tableEdit(
        start,
        { kind: 'align', table, cols: [1], align: 'center' },
        context(ada, ['k3x9'], { group: 'g5nb', note: 'Numbers read better centered.' }),
      ).changes,
    );
    expect(parse(done).ledger.marks['k3x9']).toMatchObject({
      group: 'g5nb',
      note: 'Numbers read better centered.',
    });
    expect(trim(done)).toBe(POINTED);
  });

  it('leaves the markers in the table’s other readings: Simple and Clean see no marker', () => {
    const done = align(start, [1], 'center').after;
    expect(newestView(done).text).not.toContain('<!--');
    expect(originalView(done).text).not.toContain('<!--');
    expectInOrder('after', [], done);
  });
});

// The span form is the one other tools wrote: an opener alone on the line before the table, and a closer
// after one blank line below the table and its deletion lines. Redlines never writes it any more, and
// reads, draws, cards and decides it as before; the fixtures here are written by hand.
describe('the span form, written by another tool', () => {
  /** A file with the span form around `table`, then `rest` in the paragraphs after it. */
  const around = (
    table: string,
    rest = '',
    marks: Record<string, string> = { k3x9: 'ada' },
    before = '',
    deleted = '',
  ) =>
    file(
      `${before}${MARK}\n\n${table}${deleted === '' ? '' : `\n\n${deleted}`}\n\n<!--/k3x9-->${rest === '' ? '' : `\n\n${rest}`}`,
      marks,
    );
  const SPAN = around(CENTERED);
  /** The deletion line of the Pears row of `CENTERED` (the old text of the row is as it was). */
  const PEARS = '<!--del m5nn row=2 \\| Pears  \\| 5     \\| 0.90  \\|-->';
  const WITHOUT_PEARS = CENTERED.split('\n').slice(0, 3).join('\n');

  it('is read, and accepted and rejected to the byte: its markers and blank lines go', () => {
    expect(problemsOf(parse(SPAN))).toEqual([]);
    const parsed = parse(SPAN);
    const table = readTables(SPAN, parsed)[0];
    expect(table && alignMarkOf(parsed, table)?.id).toBe('k3x9');
    expect(table && pendingOf(table, parsed).align).toBe(true);
    expect(parsed.marks[0] && isAlignPoint(parsed.marks[0])).toBe(false);
    same(applyChanges(SPAN, accept(SPAN, 'k3x9')), file(CENTERED));
    same(applyChanges(SPAN, reject(SPAN, 'k3x9')), file(FRUIT));
    expect(trim(newestView(SPAN).text)).toBe(CENTERED);
    expect(trim(originalView(SPAN).text)).toBe(FRUIT);
    expect(reviewView(SPAN)).toContain(
      '| Pears  | 5     | 0.90  |\n\n{>>[k3x9 ada] Formatted: column Count centered (was default)<<}',
    );
    expectEveryOrderAlike('a span', SPAN, exactly);
    expect(expectNoDecisionRefused('a span', SPAN)).toBeGreaterThan(1);
    // Between other blocks, and with a table after it.
    const second = FRUIT.replace('Fruit', 'Veg');
    const text = around(CENTERED, `After it.\n\n${second}`, { k3x9: 'ada' }, 'Before it.\n\n');
    same(
      applyChanges(text, reject(text, 'k3x9')),
      file(`Before it.\n\n${FRUIT}\n\nAfter it.\n\n${second}`),
    );
    same(
      applyChanges(text, accept(text, 'k3x9')),
      file(`Before it.\n\n${CENTERED}\n\nAfter it.\n\n${second}`),
    );
  });

  it('changes your own pending span in place, and keeps its form', () => {
    const two = align(SPAN, [0], 'right', ada, ['m5nn']).after;
    expect(aligns(two)).toEqual(['right', 'center', 'right']);
    expect(trim(two)).toContain('<!--/k3x9-->');
    expect(trim(two).startsWith(MARK)).toBe(true);
    same(applyChanges(two, reject(two, 'k3x9')), file(FRUIT));
    // Another person's is refused, naming them; plain Align changes the old row as well.
    expect(said(() => align(SPAN, [0], 'right', bo, ['c2dd']))).toBe(
      "Ada Lovelace's alignment change is pending. Decide it first.",
    );
    const plain = edit(SPAN, { kind: 'align', cols: [0], align: 'right' }, null).after;
    expect(aligns(plain)).toEqual(['right', 'center', 'right']);
    expect(aligns(applyChanges(plain, reject(plain, 'k3x9')))).toEqual(['right', '', 'right']);
    // Aligning back to the old alignments takes it away, with the old row as it was.
    const back = align(SPAN, [1], '', ada, ['m5nn']).after;
    same(back, file(FRUIT));
    expect(parse(back).marks).toEqual([]);
  });

  it('is decided in every order beside a row deleted: the deletion line stands in front of the closer', () => {
    const text = around(WITHOUT_PEARS, '', { k3x9: 'ada', m5nn: 'bo' }, '', PEARS);
    expect(problemsOf(parse(text))).toEqual([]);
    const table = readTables(text, parse(text))[0];
    expect(table?.deletions.map((d) => d.mark.id)).toEqual(['m5nn']);
    for (const id of ['k3x9', 'm5nn']) {
      for (const decide of [accept, reject]) {
        expect(problemsOf(parse(applyChanges(text, decide(text, id)))), id).toEqual([]);
      }
    }
    expectEveryOrderAlike('a span, a deletion', text, exactly);
    expectNoDecisionRefused('a span, a deletion', text);
    // Both rejected: the deletion line and the closer go, the table is as it was.
    expect(trim(applyChanges(text, rejectAll(text)))).toBe(FRUIT);
    // The other order: a row deleted under a span that is pending already is written in front of its closer.
    const second = edit(SPAN, { kind: 'deleteRows', rows: [2] }, bo, ['m5nn']).after;
    expect(trim(second)).toMatch(/\|\n\n<!--del m5nn row=2 [^\n]*-->\n\n<!--\/k3x9-->$/);
    expect(trim(second)).toBe(trim(text));
    expectEveryOrderAlike('a deletion under a span', second, exactly);
  });

  it('refuses a column operation and a row operation on the header while it is pending', () => {
    for (const who of [bo, null]) {
      for (const shape of [
        { kind: 'insertCols', after: 1 },
        { kind: 'deleteCols', cols: [1] },
        { kind: 'moveCols', cols: [0], to: 2 },
        { kind: 'insertRows', after: -1 },
        { kind: 'deleteRows', rows: [0] },
        { kind: 'moveRows', rows: [0], to: 3 },
      ] satisfies Shape[]) {
        expect(
          said(() => edit(SPAN, shape, who, ['c2dd', 'f3gg'])),
          `${who?.handle} ${shape.kind}`,
        ).toBe(ALIGN_FIRST);
      }
    }
  });

  describe('its gap guard', () => {
    const WORDS =
      "Ada Lovelace's alignment change to the table above is pending. Decide it first, or turn off Track Changes.";
    const text = around(CENTERED, 'Outro words.\n\nMore.');
    const view = newestView(text);
    const at = view.text.indexOf('Outro words.');
    const end = at + 'Outro words.'.length;

    it('refuses a tracked edit right under the table, naming the person', () => {
      // Written as the editor writes them: from the newest view, mapped into the file.
      const refused: [string, number, number, string][] = [
        ['typing on the blank line', at - 1, at - 1, 'q'],
        ['deleting a break', at - 2, at - 1, ''],
        ['the break and the paragraph', at - 2, end, ''],
        ['the paragraph', at, end, ''],
        ['the word Outro', at, at + 5, ''],
        ['typing at its start', at, at, 'q'],
        ['a new paragraph in front of it', at - 2, at - 2, '\n\nNew.'],
      ];
      for (const who of [bo, ada]) {
        for (const [name, a, b, insert] of refused) {
          const from = view.map.toSource(a, 1);
          const to = Math.max(from, view.map.toSource(b, -1));
          expect(
            said(() =>
              trackedEdit(text, { from, to, insert }, context(who, ['c2dd', 'f3gg', 'h4jj'])),
            ),
            `${who.handle}: ${name}`,
          ).toBe(WORDS);
        }
      }
      // The words follow the person: Bo's change names Bo.
      const bos = around(CENTERED, 'Outro words.', { k3x9: 'bo' });
      const at2 = bos.indexOf('Outro');
      expect(
        said(() => trackedEdit(bos, { from: at2, to: at2, insert: 'q' }, context(ada, ['c2dd']))),
      ).toMatch(/^Bo Chen's alignment change to the table above is pending\./);
    });

    it('allows the end of the last cell, typing further into the paragraph, and Track Changes off', () => {
      const inCell = text.indexOf('0.90') + 4;
      for (const [name, change] of [
        ['the end of the last cell', { from: inCell, to: inCell, insert: 'q' }],
        [
          'the middle of the paragraph',
          { from: text.indexOf('words.'), to: text.indexOf('words.'), insert: 'q' },
        ],
        [
          'the paragraph after it',
          { from: text.indexOf('More.') + 4, to: text.indexOf('More.') + 4, insert: 'q' },
        ],
      ] as const) {
        expect(
          said(() => trackedEdit(text, change, context(bo, ['c2dd']))),
          name,
        ).toBe('no error');
      }
      const under = text.indexOf('Outro');
      expect(said(() => untrackedEdit(text, { from: under, to: under, insert: 'q' }))).toBe(
        'no error',
      );
    });

    it('refuses every tracked edit right under the table, or leaves every decision possible', () => {
      // Every range from the end of the last row to a little into the paragraph, typed over or deleted by
      // Bo or Ada, with a row deleted or not and a comment on the paragraph or not: either the edit is
      // refused in words, or each change can be decided on its own in every order.
      const thread = [
        '  c9qf:',
        '    by: bo',
        '    at: 2026-10-13T22:40Z',
        '    text: |-',
        '      A note.',
      ];
      const CENTER0 = FRUIT.replace('| :----- |', '| :----: |');
      const OLD = encodeValue('| :----- | ----- | ----: |');
      const around0 = (rest: string, deleted: boolean, marks: Record<string, string>) =>
        file(
          `<!--fmt k3x9 align=${OLD}-->\n\n${
            deleted ? CENTER0.split('\n').slice(0, 3).join('\n') : CENTER0
          }${deleted ? `\n\n${PEARS}` : ''}\n\n<!--/k3x9-->\n\n${rest}`,
          marks,
          rest.includes('c9qf') ? thread : [],
        );
      let built = 0;
      let refusedEdits = 0;
      for (const rest of ['Outro words.\n\nMore.', '<!--cmt c9qf-->Outro<!--/c9qf--> words.']) {
        for (const deleted of [false, true]) {
          const one = around0(
            rest,
            deleted,
            deleted ? { k3x9: 'ada', m5nn: 'ada' } : { k3x9: 'ada' },
          );
          expect(problemsOf(parse(one))).toEqual([]);
          const shown = newestView(one);
          const first = shown.text.indexOf('0.90') + 4;
          for (const who of [bo, ada]) {
            for (let a = first; a <= first + 20; a++) {
              for (const b of [a, a + 1, a + 2, a + 8]) {
                for (const insert of ['', 'q']) {
                  if ((a === b && insert === '') || b > shown.text.length - 1) continue;
                  const from = shown.map.toSource(a, 1);
                  const to = Math.max(from, shown.map.toSource(b, -1));
                  let edited: string;
                  try {
                    edited = applyChanges(
                      one,
                      trackedEdit(
                        one,
                        { from, to, insert },
                        context(who, ['c2dd', 'f3gg', 'h4jj']),
                      ),
                    );
                  } catch (error) {
                    if (!(error instanceof EditError)) throw error;
                    if (/alignment change to the table above is pending/.test(error.message)) {
                      refusedEdits++;
                    }
                    continue;
                  }
                  built++;
                  expectNoDecisionRefused(
                    `${who.handle} ${a}-${b} ${JSON.stringify(insert)}`,
                    edited,
                  );
                }
              }
            }
          }
        }
      }
      expect(refusedEdits).toBeGreaterThan(40);
      expect(built).toBeGreaterThan(100);
      // Every edit at every place, decided in every order: seconds here, more on a busy runner.
    }, 120_000);
  });

  it('rejects all, and accepts all, with the header moved and a row put above it under the change', () => {
    // One decision writes the delimiter row after the new first row, the next takes it away with the
    // row that moves back: the two come to one change and no delimiter row is left in the table. The
    // rows were changed before the span was written round them (a tracked change may not touch the
    // header while it stands).
    const plain = file('| x y  |\n| ----- |\n| b    |\n| alpha |\n| 11   |');
    const moved = edit(plain, { kind: 'moveRows', rows: [0], to: 2 }, ada, ['w8nn', 'p5qm']).after;
    const above = edit(moved, { kind: 'insertRows', after: -1 }, bo, ['q6rs']).after;
    const body = trim(above);
    const text = file(
      `<!--fmt k3x9 align=${encodeValue('| :---: |')}-->\n\n${body}\n\n<!--/k3x9-->`,
      {
        k3x9: 'ada',
        w8nn: 'ada',
        p5qm: 'ada',
        q6rs: 'bo',
      },
    );
    expect(problemsOf(parse(text))).toEqual([]);
    const rejected = applyChanges(text, rejectAll(text));
    expect(trim(rejected)).toBe('| x y  |\n| :---: |\n| b    |\n| alpha |\n| 11   |');
    expect(trim(applyChanges(text, acceptAll(text)))).toBe(trim(newestView(text).text));
    expectEveryOrderAlike('header moved, row above it', text, exactly);
  });

  describe('its closer', () => {
    const TABLE = '| a | b |\n| - | - |';
    const close = (text: string) => {
      const from = text.indexOf('<!--/k3x9-->');
      return { from, to: from + '<!--/k3x9-->'.length };
    };
    const without = (text: string) => {
      const range = closerRange(text, close(text));
      return text.slice(0, range.from) + text.slice(range.to);
    };

    it('takes the blank line before it and the line break, back to the end of the table', () => {
      expect(without(`${TABLE}\n\n<!--/k3x9-->\n\nAfter.`)).toBe(`${TABLE}\n\nAfter.`);
      expect(without(`${TABLE}\n\n<!--/k3x9-->`)).toBe(TABLE);
      expect(without(`${TABLE}\r\n\r\n<!--/k3x9-->\r\n\r\nAfter.`)).toBe(`${TABLE}\r\n\r\nAfter.`);
      // Back to the last deletion line when there is one.
      const del = '<!--del m5nn row=2 \\| x \\| y \\|-->';
      expect(without(`${TABLE}\n\n${del}\n\n<!--/k3x9-->\n\nAfter.`)).toBe(
        `${TABLE}\n\n${del}\n\nAfter.`,
      );
    });

    it('takes its own line only when text is on the next line, so that the text is no row', () => {
      expect(without(`${TABLE}\n\n<!--/k3x9-->\nAfter.`)).toBe(`${TABLE}\n\nAfter.`);
      expect(
        closerRange(`${TABLE}\n\n<!--/k3x9-->\nAfter.`, close(`${TABLE}\n\n<!--/k3x9-->\nAfter.`)),
      ).toEqual({ from: TABLE.length + 2, to: TABLE.length + 2 + '<!--/k3x9-->\n'.length });
    });

    it('takes itself only when others are after it on its line, or it is not at the line’s start', () => {
      const text = `${TABLE}\n\n<!--/k3x9--> after\n\nMore.`;
      expect(closerRange(text, close(text))).toEqual(close(text));
      const inline = `${TABLE}\n\nthen <!--/k3x9-->`;
      expect(closerRange(inline, close(inline))).toEqual(close(inline));
    });
  });
});

describe('aligning a column with Track Changes off (format §3.10)', () => {
  const start = file(FRUIT);

  it('changes the delimiter row alone, no marks and no ledger', () => {
    const done = align(start, [1], 'center', null as never).after;
    expect(done).toBe(start.replace('| ----- |', '| :---: |'));
    expect(parse(done).marks).toEqual([]);
  });

  it('is refused where the columns are as asked, and for a column the table has not', () => {
    expect(said(() => edit(start, { kind: 'align', cols: [0], align: 'left' }, null))).toBe(
      'The columns are already aligned that way.',
    );
    expect(said(() => edit(start, { kind: 'align', cols: [3], align: 'left' }, null))).toBe(
      'There is no such column in this table.',
    );
    expect(said(() => edit(start, { kind: 'align', cols: [], align: 'left' }, null))).toBe(
      'There is no such column in this table.',
    );
  });

  it('is written in the old row of a pending change too, so that rejecting it keeps what was done', () => {
    const pending = align(start, [1], 'center').after;
    const plain = edit(pending, { kind: 'align', cols: [0], align: 'right' }, null).after;
    expect(aligns(plain)).toEqual(['right', 'center', 'right']);
    // Rejected, the old row comes back with the plain change in it; the original has it too.
    const rejected = applyChanges(plain, reject(plain, 'k3x9'));
    expect(aligns(rejected)).toEqual(['right', '', 'right']);
    expect(trim(originalView(plain).text)).toBe(trim(rejected));
    expectEveryOrderAlike('plain under a change', plain, exactly);
    // The plain change that brings the old alignments back leaves nothing to decide.
    const same = edit(pending, { kind: 'align', cols: [1], align: '' }, null).after;
    expect(parse(same).marks).toEqual([]);
    expect(aligns(same)).toEqual(['left', '', 'right']);
  });

  it('is written in both halves of a pending move of the column', () => {
    const moved = edit(start, { kind: 'moveCols', cols: [2], to: 0 }, bo, ['c2dd', 'f3gg']).after;
    const plain = edit(moved, { kind: 'align', cols: [0], align: 'center' }, null).after;
    const copy = parse(plain).marks.find((m) => m.payload?.startsWith('col='));
    expect(copy?.payload).toContain(':---:');
    expect(aligns(plain)?.[0]).toBe('center');
    // Rejected, the column goes back to its place with the new alignment; accepted it keeps it.
    const back = applyChanges(plain, reject(plain, 'c2dd'));
    expect(aligns(back)).toEqual(['left', '', 'center']);
    expect(aligns(applyChanges(plain, accept(plain, 'c2dd')))).toEqual(['center', 'left', '']);
    expect(aligns(originalView(plain).text)).toEqual(['left', '', 'center']);
    expectEveryOrderAlike('plain under a move', plain, exactly);
  });

  it('is allowed beside a pending inserted or deleted column, and reads alike', () => {
    const inserted = edit(start, { kind: 'insertCols', after: 1 }, bo, ['c2dd']).after;
    const deleted = edit(start, { kind: 'deleteCols', cols: [1] }, bo, ['c2dd']).after;
    for (const text of [inserted, deleted]) {
      const plain = edit(text, { kind: 'align', cols: [0], align: 'center' }, null).after;
      expect(aligns(plain)?.[0]).toBe('center');
      expectEveryOrderAlike('plain beside a column', plain, exactly);
    }
  });

  it('is typed text like any other with Track Changes off: typing in a cell under a change', () => {
    const pending = align(start, [1], 'center').after;
    const at = pending.indexOf('Apples') + 3;
    const typed = applyChanges(pending, untrackedEdit(pending, { from: at, to: at, insert: 'QQ' }));
    expect(parse(typed).marks.map((m) => m.id)).toEqual(['k3x9']);
    expect(trim(applyChanges(typed, reject(typed, 'k3x9')))).toContain('| AppQQles');
    expectEveryOrderAlike('plain typing under a change', typed, exactly);
  });
});

describe('rule 5 in ruleTwo', () => {
  const COLUMNS = COLUMNS_FIRST;
  const ALIGN = ALIGN_FIRST;

  it('refuses an alignment change tracked while a column is pending, and allows the rest', () => {
    for (const key of ['colsInserted', 'colsChanged'] as const) {
      expect(ruleTwo('align', { ...none, [key]: true }, true)).toBe(COLUMNS);
      // With Track Changes off it is written in both halves, or in the one that is there.
      expect(ruleTwo('align', { ...none, [key]: true }, false)).toBeNull();
    }
    for (const key of ['rowsInserted', 'rowsChanged', 'align'] as const) {
      for (const tracked of [true, false]) {
        expect(ruleTwo('align', { ...none, [key]: true }, tracked)).toBeNull();
      }
    }
  });

  it('refuses an alignment change tracked while the header is a pending row change, in words', () => {
    expect(ruleTwo('align', { ...none, headerChanged: true }, true)).toBe(ROWS_FIRST);
    // Plain writes no mark, and is never refused here.
    expect(ruleTwo('align', { ...none, headerChanged: true }, false)).toBeNull();
    // A column pending too: the column words first.
    for (const key of ['colsInserted', 'colsChanged'] as const) {
      expect(ruleTwo('align', { ...none, [key]: true, headerChanged: true }, true)).toBe(COLUMNS);
    }
    // And no other operation is refused for it.
    for (const op of ['insertRows', 'deleteRows', 'moveRows'] as const) {
      expect(ruleTwo(op, { ...none, headerChanged: true }, true)).toBeNull();
    }
  });

  it('refuses every column operation, and no row operation, while it is pending', () => {
    for (const op of ['insertCols', 'deleteCols', 'moveCols'] as const) {
      for (const tracked of [true, false]) {
        expect(ruleTwo(op, { ...none, align: true }, tracked)).toBe(ALIGN);
      }
    }
    for (const op of ['insertRows', 'deleteRows', 'moveRows'] as const) {
      expect(ruleTwo(op, { ...none, align: true }, true)).toBeNull();
    }
  });
});

// The point form (#281): another tool or person wrote a tracked alignment change as one mark with no
// closer at the end of the header row's last cell, `<!--fmt ID align=SPEC-->`. It is read, named,
// viewed and decided like the span form around a table, and touches nothing outside the table's first
// two lines. (Writing it, and deciding it among other changes, are the next tasks of the same work.)
describe('a point alignment change, written by another person', () => {
  const POINT = file(
    `| Fruit  | Count | Price${MARK} |\n| :----- | :---: | ----: |\n| Apples | 3     | 1.20  |\n| Pears  | 5     | 0.90  |`,
    { k3x9: 'bo' },
  );
  const NOTE = 'Price{>>[k3x9 bo] Formatted: column Count centered (was default)<<} |';
  const crlf = (text: string) => text.replace(/\n/g, '\r\n');

  it('is the new table with the mark at the end of its header, and SPEC is the old row', () => {
    expect(encodeValue('| :----- | ----- | ----: |')).toBe(SPEC);
    expect(trim(POINT)).toBe(CENTERED.replace('Price |', `Price${MARK} |`));
  });

  it('is pending, and names the column it changed', () => {
    const parsed = parse(POINT);
    expect(problemsOf(parsed)).toEqual([]);
    const table = readTables(POINT, parsed)[0];
    expect(table && pendingOf(table, parsed)).toEqual({
      rowsInserted: false,
      rowsChanged: false,
      colsInserted: false,
      colsChanged: false,
      align: true,
      headerChanged: false,
    });
    const mark = parsed.marks[0];
    expect(mark && formatChange(parsed, mark)).toEqual([
      { kind: 'align', columns: [{ col: 1, name: 'Count', now: 'center', was: '' }] },
    ]);
    expect(mark && canReject(parsed, mark)).toBe(true);
  });

  it('names the last column by its text, with no mark in it', () => {
    const old = encodeValue('| :----- | ----- | ----- |');
    const last = file(
      `| Fruit  | Count | Price<!--fmt k3x9 align=${old}--> |\n| :----- | ----- | ----: |\n| Apples | 3     | 1.20  |`,
      { k3x9: 'bo' },
    );
    const parsed = parse(last);
    const mark = parsed.marks[0];
    expect(mark && formatChange(parsed, mark)).toEqual([
      { kind: 'align', columns: [{ col: 2, name: 'Price', now: 'right', was: '' }] },
    ]);
    expect(reviewView(last)).toContain(
      'Price{>>[k3x9 bo] Formatted: column Price right (was default)<<} |',
    );
  });

  it('is accepted by taking the mark away and nothing else, and leaves no entry in the ledger', () => {
    const accepted = applyChanges(POINT, accept(POINT, 'k3x9'));
    expect(trim(accepted)).toBe(trim(POINT).replace(MARK, ''));
    expect(trim(accepted)).toBe(CENTERED);
    expect(parse(accepted).marks).toEqual([]);
    expect(parse(accepted).ledger.marks).toEqual({});
  });

  it('is rejected by writing the old row back, and the file is as it was, byte for byte', () => {
    const rejected = applyChanges(POINT, reject(POINT, 'k3x9'));
    same(rejected, file(FRUIT));
    expect(trim(rejected)).toBe(FRUIT);
    expect(parse(rejected).marks).toEqual([]);
    expect(parse(rejected).ledger.marks).toEqual({});
  });

  it('is shown as it is decided: the new row with no mark, the old table, a note where the mark stands', () => {
    expect(trim(newestView(POINT).text)).toBe(CENTERED);
    expect(trim(originalView(POINT).text)).toBe(FRUIT);
    expect(reviewView(POINT)).toContain(`| Fruit  | Count | ${NOTE}`);
    expect(reviewView(POINT)).not.toContain('align=');
    expect(reviewView(POINT)).not.toContain('<!--');
    // The two ways of deciding everything agree with the views.
    expect(trim(applyChanges(POINT, acceptAll(POINT)))).toBe(trim(newestView(POINT).text));
    expect(trim(applyChanges(POINT, rejectAll(POINT)))).toBe(trim(originalView(POINT).text));
  });

  it('is decided in every order, and no decision of it is refused', () => {
    expectEveryOrderAlike('a point', POINT, exactly);
    expect(expectNoDecisionRefused('a point', POINT)).toBeGreaterThan(1);
  });

  it('is the same in a CRLF file, and no line break is touched', () => {
    const text = crlf(POINT);
    const parsed = parse(text);
    expect(problemsOf(parsed)).toEqual([]);
    const mark = parsed.marks[0];
    expect(mark && formatChange(parsed, mark)).toEqual([
      { kind: 'align', columns: [{ col: 1, name: 'Count', now: 'center', was: '' }] },
    ]);
    const accepted = applyChanges(text, accept(text, 'k3x9'));
    expect(trim(accepted)).toBe(trim(text).replace(MARK, ''));
    expect(trim(accepted)).toBe(crlf(CENTERED));
    same(applyChanges(text, reject(text, 'k3x9')), crlf(file(FRUIT)));
    expect(trim(newestView(text).text)).toBe(crlf(CENTERED));
    expect(trim(originalView(text).text)).toBe(crlf(FRUIT));
    expect(reviewView(text)).toContain(`| Fruit  | Count | ${NOTE}\r\n`);
    expect(trim(applyChanges(text, acceptAll(text)))).toBe(trim(newestView(text).text));
    expect(trim(applyChanges(text, rejectAll(text)))).toBe(trim(originalView(text).text));
  });

  it('is read, shown and decided in the second of two tables, with the first as it was', () => {
    const first = FRUIT.replace('Fruit ', 'Veg   ');
    const body = (table: string) => `${first}\n\n${table}`;
    const two = file(
      body(
        `| Fruit  | Count | Price${MARK} |\n| :----- | :---: | ----: |\n| Apples | 3     | 1.20  |\n| Pears  | 5     | 0.90  |`,
      ),
      { k3x9: 'bo' },
    );
    const parsed = parse(two);
    const [one, other] = readTables(two, parsed);
    expect(one && alignMarkOf(parsed, one)).toBeUndefined();
    expect(other && alignMarkOf(parsed, other)?.id).toBe('k3x9');
    expect(one && pendingOf(one, parsed).align).toBe(false);
    expect(other && pendingOf(other, parsed).align).toBe(true);
    const mark = parsed.marks[0];
    expect(mark && formatChange(parsed, mark)).toEqual([
      { kind: 'align', columns: [{ col: 1, name: 'Count', now: 'center', was: '' }] },
    ]);
    same(applyChanges(two, accept(two, 'k3x9')), file(body(CENTERED)));
    same(applyChanges(two, reject(two, 'k3x9')), file(body(FRUIT)));
    expect(trim(newestView(two).text)).toBe(body(CENTERED));
    expect(trim(originalView(two).text)).toBe(body(FRUIT));
    // The note stands in the second table, and the first has none.
    expect(reviewView(two)).toContain(`${first}\n\n| Fruit  | Count | ${NOTE}`);
    expect(reviewView(two).match(/\{>>/g)).toHaveLength(1);
    expectEveryOrderAlike('second table', two, exactly);
  });

  it('is read in the first of two tables, with the second as it was', () => {
    const later = FRUIT.replace('Fruit ', 'Veg   ');
    const two = file(`${POINT.slice(0, POINT.indexOf('\n\n<!-- redlines'))}\n\n${later}`, {
      k3x9: 'bo',
    });
    const parsed = parse(two);
    const [one, other] = readTables(two, parsed);
    expect(one && alignMarkOf(parsed, one)?.id).toBe('k3x9');
    expect(other && alignMarkOf(parsed, other)).toBeUndefined();
    same(applyChanges(two, reject(two, 'k3x9')), file(`${FRUIT}\n\n${later}`));
    same(applyChanges(two, accept(two, 'k3x9')), file(`${CENTERED}\n\n${later}`));
  });

  it('can be accepted but not rejected when its old row has more cells than the table has columns', () => {
    // SPEC has three cells, and the table has two columns.
    const wide = file(`| Fruit | Price${MARK} |\n| :---- | ----: |\n| Apples | 1.20 |`, {
      k3x9: 'bo',
    });
    const parsed = parse(wide);
    const mark = parsed.marks[0];
    expect(mark && canReject(parsed, mark)).toBe(false);
    expect(said(() => reject(wide, 'k3x9'))).toBe(LOST);
    const accepted = applyChanges(wide, accept(wide, 'k3x9'));
    expect(trim(accepted)).toBe('| Fruit | Price |\n| :---- | ----: |\n| Apples | 1.20 |');
    expect(parse(accepted).marks).toEqual([]);
  });

  it('is read from the opener of a span whose closer is gone as a point that no table holds', () => {
    const lost = file(`${MARK}\n\n${FRUIT}`, { k3x9: 'bo' });
    const parsed = parse(lost);
    expect(problemsOf(parsed)).toEqual([]);
    expect(readTables(lost, parsed).map((table) => alignMarkOf(parsed, table))).toEqual([
      undefined,
    ]);
    // Accepting takes the opener away; rejecting is refused, in words.
    const accepted = applyChanges(lost, accept(lost, 'k3x9'));
    expect(parse(accepted).marks).toEqual([]);
    expect(trim(accepted).trim()).toBe(FRUIT);
    expect(said(() => reject(lost, 'k3x9'))).toBe(LOST);
  });

  it('is told from the span form and from other format changes', () => {
    const only = (text: string) => parse(text).marks[0];
    const span = only(file(`${MARK}\n\n${FRUIT}\n\n<!--/k3x9-->`, { k3x9: 'bo' }));
    const point = only(POINT);
    const bold = only(file('a <!--fmt k3x9 +bold-->b<!--/k3x9--> c', { k3x9: 'bo' }));
    const box = only(file('- [x] a<!--fmt k3x9 +check-->', { k3x9: 'bo' }));
    // A value that is no delimiter row is no alignment change: the opener is not read as a mark at all.
    const garbage = only(
      file('| a | b<!--fmt k3x9 align=nonsense--> |\n| - | - |', { k3x9: 'bo' }),
    );
    expect(garbage).toBeUndefined();
    const kinds = [span, point, bold, box].map((mark) => mark !== undefined && isAlignPoint(mark));
    expect(kinds).toEqual([false, true, false, false]);
    expect(format.isAlignPoint).toBe(isAlignPoint);
  });
});
