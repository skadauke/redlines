// Aligning columns, tracked and plain, decided in any order and viewed (format §3.7, §3.9, §8): a
// tracked change is a point mark, `<!--fmt ID align=SPEC-->`, at the end of the header's last cell,
// whose `SPEC` is the old delimiter row. The span form that other tools wrote (an opener before the
// table, a closer after it) is still read and decided, and never written.
import { describe, expect, it } from 'vitest';
import { suggestReplace } from './agent.ts';
import { applyChanges } from './changes.ts';
import { addComment } from './comments.ts';
import { accept, acceptAll, canReject, reject, rejectAll } from './decide.ts';
import { EditError } from './errors.ts';
import { formatChange } from './format-blocks.ts';
import { trackedFormat } from './formatting.ts';
import type { FormatOp } from './formatting.ts';
import { encodeValue } from './format-ops.ts';
import * as format from './index.ts';
import { parse } from './parse.ts';
import { encodePayload } from './payload.ts';
import { fuzzCount, seeded } from './random-docs.ts';
import {
  alignLabel,
  alignMarkOf,
  closerRange,
  headerSlice,
  isAlignPoint,
  placeHolds,
} from './table-align.ts';
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
  thread,
} from './test-helpers.ts';
import type { Leaf } from './test-helpers.ts';
import type { Person, Range, TextChange } from './types.ts';
import { expectEveryOrderRead, readAs } from './oracle.ts';
import { newestView, originalView, originalViewOfText, reviewView } from './views.ts';

const FRUIT =
  '| Fruit  | Count | Price |\n| :----- | ----- | ----: |\n| Apples | 3     | 1.20  |\n| Pears  | 5     | 0.90  |';
const IDS = ['k3x9', 'w8nn', 'p5qm', 'q6rs'];
const trim = (text: string) => bodyOf(text).replace(/[\r\n]+$/, '');
const BOLD: FormatOp = { kind: 'inline', format: 'bold', on: true };
/** The same body, byte for byte: a file with no pending change has no ledger. */
const same = (a: string, b: string) => expect(trim(a)).toBe(trim(b));
const SPEC = '\\|\\x20:-\\-\\-\\-\\-\\x20\\|\\x20-\\-\\-\\-\\-\\x20\\|\\x20-\\-\\-\\-:\\x20\\|';
/** The mark of Ada's change that centers Count: its value is the old delimiter row of `FRUIT`. */
const MARK = `<!--fmt k3x9 align=${SPEC}-->`;
/** `FRUIT` with Count centered, and the same with the mark that a tracked change writes. */
const CENTERED = FRUIT.replace('| ----- |', '| :---: |');
const POINTED = CENTERED.replace('Price |', `Price${MARK} |`);
/** `FRUIT` with Count centered by someone else, as the point form that another person's file has. */
const POINT_BODY = `| Fruit  | Count | Price${MARK} |\n| :----- | :---: | ----: |\n| Apples | 3     | 1.20  |\n| Pears  | 5     | 0.90  |`;
const POINT = file(POINT_BODY, { k3x9: 'bo' });
/** The deletion line of the Pears row of `FRUIT` (the old text of the row is as it was). */
const PEARS = '<!--del m5nn row=2 \\| Pears  \\| 5     \\| 0.90  \\|-->';
/** The mark of Ada's change of a table whose old delimiter row is `row`. */
const markFor = (row: string, id = 'k3x9') => `<!--fmt ${id} align=${encodeValue(row)}-->`;
/** The tables of a file as micromark reads them. */
const tableLeaves = (text: string): Leaf[] => blockLeaves(text).filter((l) => l.kind === 'table');
const COLUMNS_FIRST = 'Accept or reject the column changes in this table first.';
const ROWS_FIRST = 'Accept or reject the row changes in this table first.';
const PLACE =
  "A marker can't go at the end of this table's header, where Markdown would read it otherwise. Change the end of its last cell first, then align.";
/** The words of a refusal to align while more changes than are looked at in every order are pending in the header's last cell. */
const TOO_MANY = "Decide the changes in the last cell of this table's header first, then align.";
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

    it('is refused after a delimiter run that the mark would change, and written after one that it would not', () => {
      // The mark's `<` makes a `*` that closes an emphasis one that can open as well, when what stands before
      // it is punctuation (a full stop, or the end of a marker): the rule of three then keeps `**a .*` from
      // closing. A run after a letter, and one with nothing before it that it could close, read as they did.
      for (const end of ['**a .*', '*a .**', '_a .__', '**a ~*', '**a )*', '**a _*']) {
        const text = file(`| a | ${end} |\n| - | - |\n| c | d |`);
        expect(
          said(() => align(text, [0], 'right')),
          end,
        ).toBe(PLACE);
      }
      // A marker closes the run before it, as the end of an insertion does: the file reads as its newest view
      // with the mark after it only where the run is not changed by it.
      const typed = file(`| a | **b<!--sub k3x9 *b-->**b<!--/k3x9-->* |\n| - | - |\n| c | d |`, {
        k3x9: 'bo',
      });
      expect(said(() => align(typed, [0], 'right', ada, ['c2dd']))).toBe(PLACE);
      for (const end of ['b*', '*b*', '**b**', 'Price *', '**a b*', 'a *', '**', '*']) {
        const text = file(`| a | ${end} |\n| - | - |\n| c | d |`);
        const done = align(text, [0], 'right', ada, ['c2dd']).after;
        expect(readAs(bodyOf(done)), end).toBe(readAs(newestView(done).text));
      }
    });

    it('is written only where Markdown reads the cell as it did, for every short ending', () => {
      // Every ending of up to three characters over the characters that read as syntax, after each of five
      // beginnings: the mark is refused in words, or the file reads, as micromark reads it, as its newest view.
      const alphabet = ['b', ' ', '.', '*', '_', '~', ')', '\\'];
      const ends = new Set<string>();
      const grow = (end: string) => {
        if (end !== '') ends.add(end);
        if (end.length < 3) for (const c of alphabet) grow(end + c);
      };
      grow('');
      let written = 0;
      let refused = 0;
      for (const end of ends) {
        for (const lead of ['', 'a ', '**a ', '*a ', '_a ']) {
          const text = file(`| h | ${lead}${end} |\n| - | - |\n| c | d |`);
          if (readTables(text, parse(text))[0]?.rows[0]?.cells.length !== 2) continue;
          let done: string;
          try {
            done = align(text, [0], 'right', ada, ['k3x9']).after;
          } catch (error) {
            expect(
              error instanceof EditError ? error.message : String(error),
              `${lead}${end}`,
            ).toBe(PLACE);
            refused++;
            continue;
          }
          written++;
          expect(readAs(bodyOf(done)), JSON.stringify(`${lead}${end}`)).toBe(
            readAs(newestView(done).text),
          );
        }
      }
      expect(written).toBeGreaterThan(1500);
      expect(refused).toBeGreaterThan(100);
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

  it('can decide each change on its own, in every order, with rows and columns around', () => {
    const text = file(`${FRUIT}\n\nOutro words.`);
    let states = 0;
    for (const first of [
      { kind: 'deleteRows', rows: [1] },
      { kind: 'insertRows', after: 1 },
      { kind: 'moveRows', rows: [1], to: 3 },
      { kind: 'insertCols', after: 1 },
      { kind: 'moveCols', cols: [0], to: 3 },
      { kind: 'deleteCols', cols: [1] },
    ] satisfies Shape[]) {
      const rowOp = first.kind.endsWith('Rows');
      const base = edit(text, first, bo, ['c2dd', 'f3gg']).after;
      // Another person's alignment change beside a row change (a column change refuses it, in words),
      // the same person's, and a plain edit in the paragraph below.
      const withAlign = rowOp ? align(base, [1], 'center', ada, ['k3x9']).after : base;
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
    // Rejected alone, the span writes the old delimiter row back and takes its closer away: the rows are
    // as they were, byte for byte, and the deletion line stays under them.
    expect(trim(applyChanges(text, reject(text, 'k3x9')))).toBe(
      `${FRUIT.split('\n').slice(0, 3).join('\n')}\n\n${PEARS}`,
    );
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

// A tracked alignment change is one mark at the end of the header's last cell (format §3.7, #281). What
// other people do beside it stands in front of it or around it: typing, deleting, replacing, commenting and
// formatting at the end of that cell, edits under the table, an edit that covers the mark, other changes
// pending in the table, another table with the span form. Every order of decisions reads alike, judged
// exactly and by micromark 4.0.2 with GFM, and no single decision is refused.
describe('a point alignment change beside other marks and edits', () => {
  /** The same table with the mark of Ada, for Bo to edit. */
  const BY_ADA = file(POINT_BODY, { k3x9: 'ada' });
  /** The text of the last header cell, which stops in front of the mark. */
  const lastCell = (text: string) => {
    const cell = readTables(text, parse(text))[0]?.rows[0]?.cells.at(-1);
    if (!cell) throw new Error('the table has no header');
    return { from: cell.textFrom, to: cell.textTo };
  };
  /** Both files, and the person who is not the author of the mark in each. */
  const FILES: [Person, string][] = [
    [ada, POINT],
    [bo, BY_ADA],
  ];

  /** The file reads as one table with rows as wide as `widths` in the newest and the original view, each order of
   * decisions reads alike and as micromark reads the newest view, no decision is refused, and deciding
   * all of it gives the newest and the original view. Returns the number of states seen. */
  function expectDecided(label: string, text: string, widths: number[] = [3, 3, 3]): number {
    expect(problemsOf(parse(text)), label).toEqual([]);
    expect(
      parse(text).marks.map((mark) => mark.id),
      label,
    ).toContain('k3x9');
    for (const view of [newestView(text).text, originalView(text).text]) {
      const tables = tableLeaves(view);
      expect(tables, `${label}: a table`).toHaveLength(1);
      expect(
        tables[0]?.rows?.map((row) => row.length),
        label,
      ).toEqual(widths);
    }
    expectEveryOrderAlike(label, text, exactly);
    expectEveryOrderRead(label, text);
    const states = expectNoDecisionRefused(label, text);
    expect(states, label).toBeGreaterThan(2);
    const accepted = applyChanges(text, acceptAll(text));
    const rejected = applyChanges(text, rejectAll(text));
    expect(trim(newestView(accepted).text), `${label}: accept all`).toBe(
      trim(newestView(text).text),
    );
    expect(trim(originalView(rejected).text), `${label}: reject all`).toBe(
      trim(originalView(text).text),
    );
    for (const done of [accepted, rejected]) {
      expect(
        parse(done).marks.filter((mark) => mark.kind !== 'cmt'),
        label,
      ).toEqual([]);
    }
    return states;
  }

  describe('at the end of the last header cell', () => {
    // `Price` is the text of the last header cell, and the mark stands after it: what is written there
    // stands in front of the mark, tracked or plain.
    const edits: {
      name: string;
      edit: (cell: Range) => TextChange;
      tracked: RegExp;
      plain?: RegExp;
    }[] = [
      {
        name: 'types x at the end',
        edit: (cell) => ({ from: cell.to, to: cell.to, insert: 'x' }),
        tracked: /Price<!--ins \w{4}-->x<!--\/\w{4}--><!--fmt k3x9/,
        plain: /Pricex<!--fmt k3x9/,
      },
      {
        name: 'deletes ce',
        edit: (cell) => ({ from: cell.to - 2, to: cell.to, insert: '' }),
        tracked: /Pri<!--del \w{4} ce--><!--fmt k3x9/,
        plain: /Pri<!--fmt k3x9/,
      },
      {
        name: 'deletes all of Price',
        edit: (cell) => ({ from: cell.from, to: cell.to, insert: '' }),
        tracked: /\| <!--del \w{4} Price--><!--fmt k3x9/,
        plain: /\| <!--fmt k3x9/,
      },
      {
        name: 'replaces Price',
        edit: (cell) => ({ from: cell.from, to: cell.to, insert: 'Cost' }),
        tracked: /<!--sub \w{4} Price-->Cost<!--\/\w{4}--><!--fmt k3x9/,
        plain: /\| Cost<!--fmt k3x9/,
      },
    ];

    it('is in front of what is typed, deleted and replaced there, by the other person or plain', () => {
      for (const [who, text] of FILES) {
        for (const { name, edit: at, tracked, plain } of edits) {
          const change = at(lastCell(text));
          const by = applyChanges(text, trackedEdit(text, change, context(who, ['c2dd', 'f3gg'])));
          expect(by, `${who.handle} ${name}`).toMatch(tracked);
          expectDecided(`${who.handle} ${name}`, by);
          if (plain) {
            const alone = applyChanges(text, untrackedEdit(text, change));
            expect(alone, `${name}, plain`).toMatch(plain);
            expectDecided(`${name}, plain`, alone);
          }
        }
      }
    });

    it('is in front of a comment over the text of the cell, whose closer stands before it', () => {
      for (const [who, text] of FILES) {
        const commented = applyChanges(
          text,
          addComment(text, lastCell(text), 'A note.', context(who, ['c2dd'])).changes,
        );
        expect(commented, who.handle).toMatch(/<!--cmt \w{4}-->Price<!--\/\w{4}--><!--fmt k3x9/);
        expectDecided(`${who.handle} comments Price`, commented);
      }
    });
  });

  describe('under the table', () => {
    it('holds no tracked edit back, and leaves every decision possible', () => {
      // Every range from the end of the last row to a little into the paragraph below, typed over or
      // deleted by Bo or Ada, with a row deleted or not and a comment on the paragraph or not. The
      // point form has no closer on a line of its own, so no edit is refused for it, and each change
      // can be decided on its own in every order.
      const thread = [
        '  c9qf:',
        '    by: bo',
        '    at: 2026-10-13T22:40Z',
        '    text: |-',
        '      A note.',
      ];
      const OLD = encodeValue('| :----- | ----- | ----: |');
      const aligned = FRUIT.replace('| :----- |', '| :----: |').replace(
        'Price |',
        `Price<!--fmt k3x9 align=${OLD}--> |`,
      );
      const withRest = (rest: string, deleted: boolean) =>
        file(
          `${deleted ? aligned.split('\n').slice(0, 3).join('\n') : aligned}${
            deleted ? `\n\n${PEARS}` : ''
          }\n\n${rest}`,
          deleted ? { k3x9: 'ada', m5nn: 'ada' } : { k3x9: 'ada' },
          rest.includes('c9qf') ? thread : [],
        );
      let built = 0;
      let refusedEdits = 0;
      for (const rest of ['Outro words.\n\nMore.', '<!--cmt c9qf-->Outro<!--/c9qf--> words.']) {
        for (const deleted of [false, true]) {
          const one = withRest(rest, deleted);
          expect(problemsOf(parse(one))).toEqual([]);
          const shown = newestView(one);
          // The end of the last row that is not deleted.
          const first = shown.text.indexOf(deleted ? '1.20' : '0.90') + 4;
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
                    // Refused for something other than the alignment change (a pipe, say) is no matter.
                    if (/alignment/.test(error.message)) refusedEdits++;
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
      // No edit is refused for the alignment change, and many were written and decided in every order.
      expect(refusedEdits).toBe(0);
      expect(built).toBeGreaterThan(100);
    }, 60_000);
  });

  describe('an edit that covers the mark', () => {
    /** The edit is refused, in words, or the mark is pending still and every decision stays possible. */
    function refusedOrKept(label: string, run: () => string): 'refused' | 'kept' {
      let after: string;
      try {
        after = run();
      } catch (error) {
        if (!(error instanceof EditError)) throw error;
        expect(error.message, label).not.toBe('');
        return 'refused';
      }
      expect(
        parse(after).marks.map((mark) => mark.id),
        label,
      ).toContain('k3x9');
      expect(problemsOf(parse(after)), label).toEqual([]);
      expectEveryOrderAlike(label, after, exactly);
      expectNoDecisionRefused(label, after);
      return 'kept';
    }

    it('is refused, or leaves the mark pending with every decision possible, tracked or plain', () => {
      const outcomes = { refused: 0, kept: 0 };
      const files: [Person, string][] = [...FILES, [bo, POINT], [ada, BY_ADA]];
      for (const [who, text] of files) {
        const from = text.indexOf('ce<!--fmt');
        const markEnd = text.indexOf('-->', from) + 3;
        // `ce` and the mark, with the space after it, and with the closing pipe too.
        for (const to of [markEnd, markEnd + 1, markEnd + 2]) {
          for (const insert of ['', 'zz']) {
            const change = { from, to, insert };
            const name = `${who.handle} over ${JSON.stringify(text.slice(from, to).slice(0, 2))}…${to - markEnd} ${JSON.stringify(insert)}`;
            outcomes[
              refusedOrKept(`${name}, tracked`, () =>
                applyChanges(text, trackedEdit(text, change, context(who, ['c2dd', 'f3gg']))),
              )
            ]++;
            outcomes[
              refusedOrKept(`${name}, plain`, () => applyChanges(text, untrackedEdit(text, change)))
            ]++;
          }
        }
      }
      // The closing pipe is no text of the cell, so an edit that takes it is refused; the others keep the mark.
      expect(outcomes.refused).toBeGreaterThan(0);
      expect(outcomes.kept).toBeGreaterThan(0);
    });

    it('is refused, or leaves the mark pending, when an agent replaces text that includes the cell', () => {
      const agent = (text: string, old: string, now: string) =>
        refusedOrKept(`${JSON.stringify(old)} to ${JSON.stringify(now)}`, () =>
          applyChanges(
            text,
            suggestReplace(text, old, now, context(claudeAda, ['c2dd', 'f3gg', 'h4jj'])).changes,
          ),
        );
      for (const text of [POINT, BY_ADA]) {
        const table = trim(newestView(text).text);
        agent(text, 'Price |', 'Cost |');
        agent(text, 'Price |', ' |');
        agent(text, 'Count | Price |', 'Count | Cost of it |');
        agent(text, table, table.replace('Price', 'Cost'));
        agent(text, table, table.replace('Price', 'Unit price'));
      }
    });

    it('writes an agent’s replacement of the text of the cell in front of the mark, and every order reads alike', () => {
      // `Price` to `Cost`: the substitution covers the text that the mark follows and no more, so it stands in
      // front of the mark, which stays pending and at the end of the cell.
      for (const text of [POINT, BY_ADA]) {
        const label = text === POINT ? 'by Bo' : 'by Ada';
        const after = applyChanges(
          text,
          suggestReplace(text, 'Price', 'Cost', context(claudeAda, ['c2dd', 'f3gg', 'h4jj']))
            .changes,
        );
        expect(headerLine(after), label).toMatch(
          /<!--sub c2dd Price-->Cost<!--\/c2dd--><!--fmt k3x9 [^\n]*?--> \|$/,
        );
        expect(problemsOf(parse(after)), label).toEqual([]);
        expectEveryOrderAlike(label, after, exactly);
        expectEveryOrderRead(label, after);
        expect(expectNoDecisionRefused(label, after), label).toBeGreaterThan(2);
        // Rejecting everything gives the old text and the old row back, and accepting everything the new text.
        expect(trim(applyChanges(after, rejectAll(after))), label).toBe(
          trim(originalView(after).text),
        );
        expect(trim(newestView(applyChanges(after, acceptAll(after))).text), label).toBe(
          trim(newestView(after).text),
        );
      }
    });

    it('writes an agent’s insertion after the mark when the change holds the cell’s padding, and no decision is refused', () => {
      // Replacing all the text of the cell by one that ends in a backslash, or by blanks, the change takes the
      // space after the text in with it, so that the mark no longer ends the cell: the old text is deleted in front
      // of the mark and the new text inserted after it. The mark stays pending, and every order reads alike.
      for (const text of [POINT, BY_ADA]) {
        const table = trim(newestView(text).text);
        for (const now of ['x\\', '     ']) {
          const label = JSON.stringify(now);
          const after = applyChanges(
            text,
            suggestReplace(
              text,
              table,
              table.replace('Price', now),
              context(claudeAda, ['c2dd', 'f3gg', 'h4jj']),
            ).changes,
          );
          expect(headerLine(after), label).toMatch(
            /<!--del \w{4} +Price--><!--fmt k3x9 [^\n]*?--><!--del \w{4} {2}--><!--ins \w{4}-->/,
          );
          expect(
            parse(after)
              .marks.map((mark) => mark.id)
              .sort(),
            label,
          ).toContain('k3x9');
          expect(problemsOf(parse(after)), label).toEqual([]);
          expectEveryOrderAlike(label, after, exactly);
          expect(expectNoDecisionRefused(label, after), label).toBeGreaterThan(2);
          // Rejecting everything gives the old text and the old row back, and accepting everything the new text.
          expect(trim(applyChanges(after, rejectAll(after))), label).toBe(
            trim(originalView(after).text),
          );
          expect(trim(newestView(applyChanges(after, acceptAll(after))).text), label).toBe(
            trim(newestView(after).text),
          );
        }
      }
    });
  });

  describe('with other changes pending in the table', () => {
    /** A header and three rows, with Bo's inserted row, Ada's deleted row and Bo's typing in the header. */
    const four = file(`${FRUIT}\n| Plums  | 7     | 2.00  |`);
    const rows = (text: string) =>
      edit(
        edit(text, { kind: 'insertRows', after: 1 }, bo, ['c2dd', 'f3gg']).after,
        {
          kind: 'deleteRows',
          rows: [3],
        },
        ada,
        ['h4jj'],
      ).after;
    /** `who` types `word` in the last header cell, `back` characters before the end of its text as the
     * newest view shows it. */
    const typed = (text: string, who: Person, id: string, word = 'x', back = 0) => {
      const view = newestView(text);
      const at = view.map.toSource(view.map.fromSource(lastCell(text).to) - back, -1);
      return applyChanges(
        text,
        trackedEdit(text, { from: at, to: at, insert: word }, context(who, [id])),
      );
    };
    const decided = (label: string, text: string, states: number) => {
      expect(problemsOf(parse(text)), label).toEqual([]);
      expectEveryOrderAlike(label, text, exactly);
      expect(expectNoDecisionRefused(label, text), label).toBeGreaterThan(states);
      // The mark is decided last, on the text the others leave: all accepted is the newest view, all
      // rejected the original, and nothing is left pending.
      const accepted = applyChanges(text, acceptAll(text));
      const rejected = applyChanges(text, rejectAll(text));
      expect(trim(newestView(accepted).text), `${label}: accept all`).toBe(
        trim(newestView(text).text),
      );
      expect(trim(originalView(rejected).text), `${label}: reject all`).toBe(
        trim(originalView(text).text),
      );
      // A comment stays; every change is decided.
      for (const done of [accepted, rejected]) {
        expect(
          parse(done).marks.filter((mark) => mark.kind !== 'cmt'),
          label,
        ).toEqual([]);
      }
    };

    it('is decided in every order beside Bo’s inserted row, Ada’s deleted row and Bo’s typing in the header', () => {
      const pending = rows(four);
      // The typing first and the alignment last: the mark is written after the closer of the typing.
      const last = align(typed(pending, bo, 'm5nn'), [1], 'center', ada, ['k3x9']).after;
      expect(headerLine(last)).toMatch(/Price<!--ins m5nn-->x<!--\/m5nn--><!--fmt k3x9/);
      decided('typing, then the alignment', last, 10);
      // The alignment first, and the typing after it: it is written in front of the mark.
      const first = typed(align(pending, [1], 'center', ada, ['k3x9']).after, bo, 'm5nn');
      expect(headerLine(first)).toBe(headerLine(last));
      decided('the alignment, then the typing', first, 10);
    });

    it('is decided in every order where a closer stands next to the mark', () => {
      // A comment over the text of the cell, and Bo's typing inside it: the closer of the comment stands
      // in front of the mark, with the closer of the typing before it, and deciding the typing leaves the
      // comment's closer next to the mark.
      const commented = (text: string, who: Person) =>
        applyChanges(
          text,
          addComment(text, lastCell(text), 'A note.', context(who, ['p5qm'])).changes,
        );
      for (const by of [ada, bo]) {
        const inside = typed(commented(file(FRUIT), by), bo, 'm5nn', 'x', 1);
        const done = align(inside, [1], 'center', ada, ['k3x9']).after;
        expect(headerLine(done), by.handle).toMatch(
          /<!--cmt p5qm-->Pric<!--ins m5nn-->x<!--\/m5nn-->e<!--\/p5qm--><!--fmt k3x9/,
        );
        decided(`${by.handle}’s comment, Bo’s typing inside it`, done, 5);
        // The other order: the alignment first, then the comment over the text and the typing in it.
        const early = align(file(FRUIT), [1], 'center', ada, ['k3x9']).after;
        const then = typed(commented(early, by), bo, 'm5nn', 'x', 1);
        expect(headerLine(then), by.handle).toBe(headerLine(done));
        decided(`${by.handle}’s comment after the alignment`, then, 5);
      }
    });
  });

  describe('with the span form in another table of the file', () => {
    it('leaves each table as it was when the other is decided, in every order', () => {
      const second = FRUIT.replace('Fruit ', 'Veg   ');
      const spanned = `${MARK}\n\n${CENTERED}\n\n<!--/k3x9-->`;
      const pointed = POINT_BODY.replace('Fruit ', 'Veg   ').replace('k3x9', 'w8nn');
      const doc = file(`${spanned}\n\nBetween the tables.\n\n${pointed}`, {
        k3x9: 'ada',
        w8nn: 'bo',
      });
      const parsed = parse(doc);
      expect(problemsOf(parsed)).toEqual([]);
      expect(readTables(doc, parsed).map((table) => alignMarkOf(parsed, table)?.id)).toEqual([
        'k3x9',
        'w8nn',
      ]);
      // Deciding one leaves the other byte for byte.
      for (const decide of [accept, reject]) {
        expect(applyChanges(doc, decide(doc, 'k3x9')), decide.name).toContain(pointed);
        expect(applyChanges(doc, decide(doc, 'w8nn')), decide.name).toContain(spanned);
      }
      same(
        applyChanges(doc, reject(doc, 'k3x9')),
        file(`${FRUIT}\n\nBetween the tables.\n\n${pointed}`, { w8nn: 'bo' }),
      );
      same(
        applyChanges(doc, reject(doc, 'w8nn')),
        file(`${spanned}\n\nBetween the tables.\n\n${second}`, { k3x9: 'ada' }),
      );
      expectEveryOrderAlike('a span and a point', doc, exactly);
      expect(expectNoDecisionRefused('a span and a point', doc)).toBeGreaterThan(2);
      expect(trim(applyChanges(doc, rejectAll(doc)))).toBe(
        `${FRUIT}\n\nBetween the tables.\n\n${second}`,
      );
      expect(trim(applyChanges(doc, acceptAll(doc)))).toBe(trim(newestView(doc).text));
    });
  });

  describe('written after changes pending in the last header cell', () => {
    // The mark is written last, after other people's changes at the end of the cell. Deciding those in some
    // order, neither all accepted nor all rejected, can leave a backslash or a delimiter run right in front of
    // the mark, which Markdown then reads otherwise: the writer tries the orders of the changes in that cell.
    const aligned = (body: string, marks: Record<string, string>, who = ada) =>
      align(file(body, marks), [0], 'right', who, ['k3x9']).after;

    it('is refused where deciding some of the changes would leave a delimiter run in front of it', () => {
      // Bo deletes the `x` after `**a .*` and Ada types `b` after it: with the typing rejected and the
      // deletion accepted the run ends the cell, and the mark after it makes the rule of three keep it from
      // closing. All accepted ends in `b`, all rejected in `x`.
      const body =
        '| h | **a .*<!--del c2dd x--><!--ins f3gg-->b<!--/f3gg--> |\n| - | - |\n| c | d |';
      expect(
        said(() => aligned(body, { c2dd: 'bo', f3gg: 'ada' })),
        'exposed',
      ).toBe(PLACE);
      // Nothing that exposes a run: the same cell with a plain `x` in front of the changes is written.
      const plain = body.replace('<!--del c2dd x-->', 'x<!--del c2dd y-->');
      const done = aligned(plain, { c2dd: 'bo', f3gg: 'ada' });
      expectEveryOrderAlike('plain x', done, exactly);
      expectEveryOrderRead('plain x', done);
      expectNoDecisionRefused('plain x', done);
    });

    it('is refused where a backslash would be brought back in front of it by a decision of two changes', () => {
      // `a\` with a pending deletion of `b` after it and a typing: the deletion accepted and the typing
      // rejected leaves the backslash right in front of the mark.
      const body = '| h | a\\<!--del c2dd b--><!--ins f3gg-->c<!--/f3gg--> |\n| - | - |\n| c | d |';
      expect(said(() => aligned(body, { c2dd: 'bo', f3gg: 'ada' }))).toBe(PLACE);
    });

    it('is refused where deciding the changes in the cell would leave no table to decide it in', () => {
      // A header with no leading pipe, in which Bo commented over a character of `b~~` and replaced another:
      // accepting his deletions and rejecting his insertion empties the cell, and the header, which then
      // starts with the closer of the comment, is no table. Rejecting the alignment change would then be
      // refused (its table no longer has the columns it had), in that order of decisions and in no other:
      // the writer does not write a change that it can't decide there.
      const body =
        ' <!--del q6rs b-->\n\n <!--cmt d8fg-->\n\n <!--del q6rs ~~-->\n\n <!--ins m5nn-->\n\n b~ab<!--/m5nn--><!--/d8fg--> |\n ----: |\n café |\n café |';
      const text = file(body, { q6rs: 'bo', m5nn: 'bo' }, thread('d8fg', 'bo'));
      expect(said(() => align(text, [0], 'left', claudeAda, ['v6xz']))).toBe(PLACE);
      // The same header with its text in front of the changes keeps a cell when they are decided.
      const kept = file(
        ' x<!--del q6rs b--><!--cmt d8fg--><!--ins m5nn-->ab<!--/m5nn--><!--/d8fg--> |\n ----: |\n café |\n café |',
        { q6rs: 'bo', m5nn: 'bo' },
        thread('d8fg', 'bo'),
      );
      const done = align(kept, [0], 'left', claudeAda, ['v6xz']).after;
      expectEveryOrderAlike('a cell that keeps its text', done, exactly);
      expectNoDecisionRefused('a cell that keeps its text', done);
    });

    it('is written after a pending bold over the text of the cell, and every order reads alike', () => {
      // A bold over the last header cell, as people make the header row bold, leaves the mark's decisions
      // as before: accepted it leaves `**Price**`, rejected `Price`, and neither ends in front of the mark in a way
      // that reads otherwise.
      const text = file(FRUIT);
      const { changes } = trackedFormat(text, lastCell(text), BOLD, context(bo, ['c2dd']));
      const bold = applyChanges(text, changes);
      expect(headerLine(bold)).toMatch(/<!--fmt c2dd \+bold-->\*\*Price\*\*<!--\/c2dd--> \|$/);
      const done = align(bold, [1], 'center', ada, ['k3x9']).after;
      expect(headerLine(done)).toMatch(/<!--\/c2dd--><!--fmt k3x9/);
      expectEveryOrderAlike('bold, then the alignment', done, exactly);
      expectEveryOrderRead('bold, then the alignment', done);
      expect(expectNoDecisionRefused('bold, then the alignment', done)).toBeGreaterThan(2);
    });

    it('is written after up to two changes in the cell, and refused after more in words that say what to do', () => {
      const ids = ['c2dd', 'f3gg', 'h4jj'];
      const typing = (n: number) =>
        ['b', 'c', 'd']
          .slice(0, n)
          .map((c, i) => `<!--ins ${ids[i]}-->${c}<!--/${ids[i]}-->`)
          .join('');
      const marks = { c2dd: 'bo', f3gg: 'bo', h4jj: 'bo' };
      const two = aligned(`| h | a${typing(2)} |\n| - | - |\n| c | d |`, marks);
      expectEveryOrderAlike('two changes', two, exactly);
      expect(expectNoDecisionRefused('two changes', two)).toBeGreaterThan(6);
      // Three are too many to look at in every order. Deciding one of them leaves two, and then it is written.
      const three = file(`| h | a${typing(3)} |\n| - | - |\n| c | d |`, marks);
      expect(said(() => align(three, [0], 'right', ada, ['k3x9']))).toBe(TOO_MANY);
      const decided = applyChanges(three, accept(three, 'c2dd'));
      const done = align(decided, [0], 'right', ada, ['k3x9']).after;
      expectEveryOrderAlike('after one is decided', done, exactly);
      expect(expectNoDecisionRefused('after one is decided', done)).toBeGreaterThan(6);
    });
  });

  describe('an edit that would leave the mark read otherwise', () => {
    // The mark stands at the end of its cell, so what is typed there lands right in front of it. A backslash
    // there escapes its `<`, and a delimiter run there changes how the text before it reads: Markdown readers
    // that don't know the markers would show the mark as text, or read the emphasis otherwise. Such an edit is
    // refused in words that name the change, with Track Changes on and off, rather than written.
    const WORDS = (who: string) =>
      new RegExp(`^${who}'s alignment change is at the end of this cell, where this edit`);
    const at = (text: string, find: string, plus = 0) => text.indexOf(find) + plus;
    const typed = (text: string, where: number, insert: string, who: Person | null, to = where) =>
      who === null
        ? untrackedEdit(text, { from: where, to, insert })
        : trackedEdit(text, { from: where, to, insert }, context(who, ['c2dd', 'f3gg']));

    it('refuses a plain backslash typed at the end of the cell, or left there by a deletion', () => {
      for (const [who, text, name] of [
        [null, POINT, 'Bo Chen'],
        [null, BY_ADA, 'Ada Lovelace'],
      ] as const) {
        const end = lastCell(text).to;
        expect(
          said(() => typed(text, end, '\\', who)),
          name,
        ).toMatch(WORDS(name));
        // Two backslashes escape each other, and a backslash earlier in the cell is no matter.
        for (const insert of ['\\\\', 'q']) {
          const after = applyChanges(text, typed(text, end, insert, who));
          expect(problemsOf(parse(after)), insert).toEqual([]);
          expectDecided(`plain ${JSON.stringify(insert)}`, after);
        }
      }
      // A deletion that brings a backslash next to the mark: `a\b`, the `b` deleted.
      const body =
        '| h | a\\b<!--fmt k3x9 align=\\|\\x20-\\x20\\|\\x20-\\x20\\|--> |\n| - | - |\n| c | d |';
      const text = file(body, { k3x9: 'bo' });
      expect(said(() => typed(text, at(text, 'b<!--'), '', null, at(text, 'b<!--', 1)))).toMatch(
        WORDS('Bo Chen'),
      );
    });

    it('writes a tracked backslash at the end of the cell, and every order reads alike', () => {
      for (const [who, text] of FILES) {
        const end = lastCell(text).to;
        const after = applyChanges(text, typed(text, end, '\\', who));
        expect(after, who.handle).toMatch(/<!--fmt k3x9 /);
        expect(problemsOf(parse(after)), who.handle).toEqual([]);
        expectEveryOrderAlike(who.handle, after, exactly);
        expectNoDecisionRefused(who.handle, after);
      }
    });

    it('takes an underscore or a tilde after a letter at the end of the cell, plain and tracked, and a backspace that leaves one', () => {
      // `Price_` reads as the view does with the mark after it (the underscore closes, as it did): the rule that
      // keeps the mark off an underscore is for where it is written, not for what is typed after it is there.
      const start = file('| Fruit | Price |\n| ----- | ----- |\n| a | b |');
      const pointed = align(start, [0], 'right', bo, ['k3x9']).after;
      const end = lastCell(pointed).to;
      for (const key of ['_', '~', '*', 'x']) {
        for (const who of [null, ada] as const) {
          const after = applyChanges(pointed, typed(pointed, end, key, who));
          const label = `${who?.handle ?? 'plain'} types ${key} after Price`;
          expect(after, label).toMatch(/<!--fmt k3x9 /);
          expectDecided(label, after, [2, 2]);
        }
      }
      // A cell that ends in `unit_x` with the first `x` backspaced leaves the underscore at its end.
      const unit = align(
        file('| Fruit | unit_x |\n| ----- | ----- |\n| a | b |'),
        [0],
        'right',
        bo,
        ['k3x9'],
      ).after;
      const x = lastCell(unit).to;
      for (const who of [null, ada] as const) {
        const after = applyChanges(unit, typed(unit, x - 1, '', who, x));
        expectDecided(`${who?.handle ?? 'plain'} backspaces unit_x`, after, [2, 2]);
      }
      // The closing underscore of `_a`, tracked.
      const open = align(file('| Fruit | _a |\n| ----- | ----- |\n| a | b |'), [0], 'right', bo, [
        'k3x9',
      ]).after;
      const closing = applyChanges(open, typed(open, lastCell(open).to, '_', ada));
      expectDecided('ada closes _a', closing, [2, 2]);
    });

    it('refuses, of the endings it lists, only what the mark makes unsound: a key or a backspace that leaves the text in front of it read otherwise', () => {
      // The same cell with the mark and with nothing at its end, under every key (`x _ ~ * \`) and a backspace, plain
      // and tracked. What the file with the mark refuses and the other writes is each of the shapes below, each
      // with its reason, and nothing else: not an `_`, a `~` or a `*` after a word, which reads as it did. That
      // holds of the endings listed here, and of no others. `changesRun` pairs no runs, so it refuses a run after
      // a completed pair as well (`**a** (b)` and a typed `*`), though Markdown reads that file as it reads the
      // view: a false alarm, which costs a refusal. And a key that lengthens a run that has closed an emphasis
      // already (`*a .*` and a typed `*`, `_a ._` and a typed `_`) is refused rightly, in none of the shapes below.
      // No ending listed is one of these, and the list would not pass with one in it.
      type Key = 'x' | '_' | '~' | '*' | '\\' | 'BACKSPACE';
      const KEYS: Key[] = ['x', '_', '~', '*', '\\', 'BACKSPACE'];
      const alphabet = ['b', ' ', '.', '*', '_', '~', '\\', ')'];
      const ends = new Set([
        ...['**a .', '__a .', '*a .', '_a', '_a_', 'a b', 'x y', 'unit', 'unit_x', 'Price', '*b*'],
        ...['**b**'],
        ...[
          'a\\\\',
          '`b`',
          '[b](c)',
          '[b](c',
          '<b',
          'https://example.org/a',
          '&amp',
          '~~a ',
          '~a ',
        ],
      ]);
      const grow = (end: string) => {
        if (end !== '' && end === end.trim()) ends.add(end);
        if (end.length < 2) for (const c of alphabet) grow(end + c);
      };
      grow('');
      const rows = '\n| - | - |\n| c | d |';
      const withMark = (end: string) =>
        file(`| h | ${end}${markFor('| - | - |')} |${rows}`, { k3x9: 'bo' });
      const withComment = (end: string) =>
        file(`| h | ${end}<!--cmt c9qf--> |${rows}`, {}, thread('c9qf', 'bo'));
      const withNothing = (end: string) => file(`| h | ${end} |${rows}`);
      const widthOf = (text: string) => readTables(text, parse(text))[0]?.rows[0]?.cells.length;
      const keyEdit = (text: string, key: Key, comment = false): TextChange => {
        const where = comment ? text.indexOf('<!--cmt c9qf-->') : lastCell(text).to;
        return key === 'BACKSPACE'
          ? { from: where - 1, to: where, insert: '' }
          : { from: where, to: where, insert: key };
      };
      /** The words a key is refused with, or null where it is written. */
      const refusal = (text: string, key: Key, tracked: boolean, comment = false) => {
        const change = keyEdit(text, key, comment);
        try {
          if (tracked) trackedEdit(text, change, context(ada, ['c2dd', 'f3gg', 'h4jj']));
          else untrackedEdit(text, change);
          return null;
        } catch (error) {
          if (!(error instanceof EditError)) throw error;
          return error.message;
        }
      };
      interface Case {
        end: string;
        key: Key;
        tracked: boolean;
        /** The text of the cell after the key. */
        cell: string;
        label: string;
      }
      const shapes: {
        why: string;
        holds: (found: Case) => boolean;
        /** Whether micromark reads the file as typed otherwise than its view (it knows no URLs). */
        oracle: boolean;
        /** Whether the same key, in front of a comment, is refused too (a plain backslash, whatever the marker). */
        comment: boolean;
        seen: number;
      }[] = [
        {
          why: 'a plain backslash right in front of the mark escapes its `<`, and Markdown shows the mark as text',
          holds: ({ tracked, cell }) => !tracked && /(?:^|[^\\])(?:\\\\)*\\$/.test(cell),
          oracle: true,
          comment: true,
          seen: 0,
        },
        {
          why: 'a plain `*` that closes a `**`, or an `_` that closes a `__`, after punctuation opens as well once `<` follows it, and the rule of three keeps it from closing',
          holds: ({ tracked, cell }) =>
            !tracked && /^(?:\*\*[^*]*[^\w\s*]\*|__[^_]*[^\w\s_]_)$/.test(cell),
          oracle: true,
          comment: false,
          seen: 0,
        },
        {
          why: 'a tracked backslash can not stand in front of the mark, so it is written after it, where it goes on with a bare URL that the mark would then stand inside (§3.1)',
          holds: ({ tracked, key, end }) => tracked && key === '\\' && /^https?:\/\/\S+$/.test(end),
          oracle: false,
          comment: false,
          seen: 0,
        },
      ];
      let total = 0;
      const listed: Case[] = [];
      for (const end of ends) {
        const marked = withMark(end);
        const nothing = withNothing(end);
        if (widthOf(marked) !== 2 || widthOf(nothing) !== 2) continue;
        for (const key of KEYS) {
          for (const tracked of [false, true]) {
            total++;
            if (refusal(marked, key, tracked) === null || refusal(nothing, key, tracked) !== null) {
              continue;
            }
            const cell = key === 'BACKSPACE' ? end.slice(0, -1) : end + key;
            const label = `${tracked ? 'tracked' : 'plain'} ${JSON.stringify(end)} + ${key}`;
            listed.push({ end, key, tracked, cell, label });
          }
        }
      }
      for (const found of listed) {
        const matching = shapes.filter((shape) => shape.holds(found));
        expect(
          matching.map((shape) => shape.why),
          `${found.label}: refused for the mark, and in the list once`,
        ).toHaveLength(1);
        const [shape] = matching;
        if (!shape) continue;
        shape.seen++;
        const marked = withMark(found.end);
        if (shape.oracle) {
          // The file as typed, plain: Markdown reads it otherwise than the view does.
          const typedFile = applyChanges(marked, [keyEdit(marked, found.key)]);
          expect(readAs(bodyOf(typedFile)), `${found.label}: as typed`).not.toBe(
            readAs(newestView(typedFile).text),
          );
        }
        if (shape.comment) {
          const commented = withComment(found.end);
          expect(refusal(commented, found.key, found.tracked, true), found.label).toMatch(
            /^A backslash can't stand right in front of the marker of Bo Chen's comment/,
          );
        }
      }
      for (const shape of shapes) expect(shape.seen, shape.why).toBeGreaterThan(0);
      // After a word, only a plain backslash is refused: not an `_`, a `~` or a `*`, an `x` or a backspace.
      const words = listed.filter(({ end }) => /^[A-Za-z0-9]+(?: [A-Za-z0-9]+)*$/.test(end));
      expect(words.filter(({ key }) => key !== '\\')).toEqual([]);
      expect(words.length).toBeGreaterThan(0);
      expect(total).toBeGreaterThan(800);
    });

    it('refuses a comment that would put its closer in front of a run that the mark follows', () => {
      // `*b**` is written, the run `**` after a letter. A comment over `*b` ends between the `b` and the
      // run, and the run is then after the `>` of a marker: the mark would keep it from closing the `*`.
      // Any writer holds to it, not only the keys: a comment over all of the text ends after the run.
      const start = file('| h | *b** |\n| - | - |\n| c | d |');
      const text = align(start, [0], 'right', bo, ['k3x9']).after;
      const cell = lastCell(text);
      expect(
        said(() =>
          addComment(
            text,
            { from: cell.from, to: cell.from + 2 },
            'A note.',
            context(ada, ['c2dd']),
          ),
        ),
      ).toMatch(WORDS('Bo Chen'));
      const whole = addComment(text, cell, 'A note.', context(ada, ['c2dd']));
      const after = applyChanges(text, whole.changes);
      expect(headerLine(after)).toMatch(/<!--cmt c2dd-->\*b\*\*<!--\/c2dd--><!--fmt k3x9/);
      expectDecided('a comment over all of it', after, [2, 2]);
    });

    it('refuses a plain edit that leaves a delimiter run after punctuation in front of the mark', () => {
      // `**a .` is written; typing the `*` that would close the emphasis puts a run after a full stop right
      // in front of the mark, and the rule of three then keeps it from closing: refused, and the cell is as it was.
      const start = file('| h | **a . |\n| - | - |\n| c | d |');
      const text = align(start, [0], 'right', bo, ['k3x9']).after;
      const end = lastCell(text).to;
      expect(
        said(() => typed(text, end, '*', null)),
        'plain',
      ).toMatch(WORDS('Bo Chen'));
      // Another character, and the same run after a letter, are written.
      for (const insert of ['x', ' ']) {
        const after = applyChanges(text, typed(text, end, insert, null));
        expect(problemsOf(parse(after)), insert).toEqual([]);
      }
      // A deletion that leaves the run in front of the mark: `**a .*x`, the `x` deleted.
      const run = align(file('| h | **a .*x |\n| - | - |\n| c | d |'), [0], 'right', bo, [
        'k3x9',
      ]).after;
      const x = at(run, 'x<!--fmt');
      expect(said(() => typed(run, x, '', null, x + 1))).toMatch(WORDS('Bo Chen'));
    });
  });
});

// The walk that writes the mark decides the changes in the header's last cell in every order (`placeHolds`). It
// is done on the header as a small file of its own, where that reads as the file does (`headerSlice`), and on the
// whole file where it can't. A decision of a whole file costs what the file costs, and the walk is up to 42
// decisions: on the header they cost what a header does. The two must give the same answer, for any table.
describe('the walk that writes the mark, on the header alone and on the whole file', () => {
  /** A table as the writer would find it, and the same with the mark and the new delimiter row. */
  interface Pair {
    before: string;
    after: string;
    tableFrom: number;
  }
  const LAYOUTS = ['full', 'no trailing pipe', 'bare', 'one cell'] as const;
  /** What the cells and the changes in them are made of: words, syntax, and the start or the end of a
   * construct that a row below or a line above could finish. */
  const TEXTS = ['a', 'b', 'x y', '*', '**', '_', '~', '\\', '.', ')', '(', '[', '[b]', '](c)'];
  const MORE = ['`', '`b`', '<b', '&amp', 'é', ' ', 'https://e.org/a', '<!--', '<!', '--'];
  const INTROS = [
    '',
    'Intro words.\n\n',
    'Intro with `code` and [a link](x).\n\n',
    'Unclosed `tick above.\n\n',
    'Text right above the table\n',
    'Text with a `tick right above\n',
    'An [open bracket right above\n',
  ];
  const OUTROS = ['', '\n\nOutro.', '\n\nOutro with `x` and [y](z).', '\n\n`Unclosed outro'];

  function randomPair(seed: number): Pair | undefined {
    const random = seeded(seed);
    const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
    const text = () => pick(random() < 0.8 ? TEXTS : MORE);
    const layout = pick(LAYOUTS);
    const ledger: Record<string, string> = {};
    const ids = ['c2dd', 'f3gg', 'h4jj', 'm5nn'];
    let changes = 0;
    const pieces: string[] = [];
    for (let i = 1 + Math.floor(random() * 5); i > 0; i--) {
      const id = ids[changes];
      const kind = Math.floor(random() * 4);
      if (kind === 0 || id === undefined || changes >= 3) {
        pieces.push(text());
        continue;
      }
      changes++;
      ledger[id] = pick(['ada', 'bo']);
      if (kind === 1) pieces.push(`<!--ins ${id}-->${text()}<!--/${id}-->`);
      else if (kind === 2) pieces.push(`<!--del ${id} ${encodePayload(text())}-->`);
      else pieces.push(`<!--sub ${id} ${encodePayload(text())}-->${text()}<!--/${id}-->`);
    }
    const commented = random() < 0.2;
    let cell = pieces.join('');
    if (commented) cell = `<!--cmt c9qf-->${cell}<!--/c9qf-->`;
    // A marker can't start a line, and the text of a header with no leading pipe starts its line.
    if (layout === 'one cell' && cell.startsWith('<!--')) cell = `x${cell}`;
    const threads = commented ? thread('c9qf', pick(['ada', 'bo'])) : [];
    const header = (mark: string) =>
      layout === 'full'
        ? `| h | ${cell}${mark} |`
        : layout === 'no trailing pipe'
          ? `| h | ${cell}${mark}`
          : layout === 'bare'
            ? `h | ${cell}${mark}`
            : ` ${cell}${mark} |`;
    const old =
      layout === 'full'
        ? '| --- | --- |'
        : layout === 'no trailing pipe'
          ? '| --- | ---'
          : layout === 'bare'
            ? '--- | ---'
            : ' --- |';
    const rows = Array.from({ length: Math.floor(random() * 3) }, () =>
      layout === 'full'
        ? `\n| ${text()} | ${text()} |`
        : layout === 'no trailing pipe'
          ? `\n| ${text()} | ${text()}`
          : layout === 'bare'
            ? `\n${text()} | ${text()}`
            : `\n ${text()} |`,
    ).join('');
    const elsewhere = random() < 0.3;
    if (elsewhere) ledger['z8bb'] = 'ada';
    const prose = elsewhere ? 'Elsewhere <!--ins z8bb-->new<!--/z8bb--> words.\n\n' : '';
    const intro = pick(INTROS);
    const outro = pick(OUTROS);
    const crlf = random() < 0.1;
    const build = (mark: string, delimiter: string, entries: Record<string, string>) => {
      const made = file(
        `${prose}${intro}${header(mark)}\n${delimiter}${rows}${outro}`,
        entries,
        threads,
      );
      return crlf ? made.replaceAll('\n', '\r\n') : made;
    };
    const before = build('', old, ledger);
    const table = readTables(before, parse(before))[0];
    if (!table || problemsOf(parse(before)).length > 0) return undefined;
    const spec = before.slice(table.delimiter.from, table.delimiter.to);
    const after = build(markFor(spec), spec.replace('---', ':--'), { ...ledger, k3x9: 'ada' });
    const placed = readTables(after, parse(after))[0];
    if (placed?.from !== table.from || problemsOf(parse(after)).length > 0) return undefined;
    if (!parse(after).marks.some((mark) => mark.id === 'k3x9')) return undefined;
    return { before, after, tableFrom: table.from };
  }

  const answer = (pair: Pair, whole: boolean): { said: string; where?: 'header' | 'file' } => {
    try {
      const where = placeHolds(pair.before, pair.after, 'k3x9', pair.tableFrom, whole);
      return { said: 'written', where };
    } catch (error) {
      if (!(error instanceof EditError)) throw error;
      return { said: error.message };
    }
  };

  it(
    'gives the same answer for random tables, whatever the cell, the rows and the lines around hold',
    { timeout: 60_000 },
    () => {
      const wanted = fuzzCount(500);
      const seen = { header: 0, whole: 0, written: 0, refused: 0 };
      const words = new Set<string>();
      let cases = 0;
      for (let seed = 1; cases < wanted && seed <= 40 * wanted; seed++) {
        const pair = randomPair(seed);
        if (!pair) continue;
        cases++;
        const onHeader =
          headerSlice(pair.before, pair.tableFrom) !== undefined &&
          headerSlice(pair.after, pair.tableFrom) !== undefined;
        const { said, where } = answer(pair, false);
        expect(said, `seed ${seed}: ${JSON.stringify(bodyOf(pair.after))}`).toBe(
          answer(pair, true).said,
        );
        // A walk that was done on the header started there.
        if (where === 'header') expect(onHeader).toBe(true);
        seen[onHeader ? 'header' : 'whole']++;
        seen[said === 'written' ? 'written' : 'refused']++;
        words.add(said);
      }
      // Both ways to walk are used, and both answers are given, or the check would be empty.
      expect(cases).toBe(wanted);
      expect(seen.header).toBeGreaterThan(wanted / 5);
      expect(seen.whole).toBeGreaterThan(wanted / 20);
      expect(seen.written).toBeGreaterThan(wanted / 5);
      expect(seen.refused).toBeGreaterThan(wanted / 20);
      expect([...words].toSorted()).toEqual(
        expect.arrayContaining(['written', PLACE, TOO_MANY].toSorted()),
      );
    },
  );

  it('walks the whole file where a state is not what the header says it is', () => {
    // Accepting the typing of `--` and rejecting the deletion of `>` leaves `-->` in the cell: neither view of the
    // header has it, and it could finish a comment that is begun in a row below.
    const marks = { c2dd: 'bo', f3gg: 'bo' };
    const pair = (cell: string) => {
      const before = file(`| h | ${cell} |\n| --- | --- |\n| a | b |`, marks);
      const after = file(`| h | ${cell}${markFor('| --- | --- |')} |\n| :-- | --- |\n| a | b |`, {
        ...marks,
        k3x9: 'ada',
      });
      return { before, after, tableFrom: readTables(before, parse(before))[0]?.from ?? -1 };
    };
    const brought = pair('a<!--ins c2dd-->--<!--/c2dd--><!--del f3gg >-->');
    expect(headerSlice(brought.before, brought.tableFrom)).toBeDefined();
    expect(headerSlice(brought.after, brought.tableFrom)).toBeDefined();
    expect(answer(brought, false)).toEqual({ said: 'written', where: 'file' });
    // The same header with other words is walked on the header, and on the file, with the same answer.
    const words = pair('a<!--ins c2dd-->b<!--/c2dd--><!--del f3gg c-->');
    expect(answer(words, false)).toEqual({ said: 'written', where: 'header' });
    expect(answer(words, true)).toEqual({ said: 'written', where: 'file' });
  });

  it('is the header, its delimiter row and the ledger of its marks, where the file reads like it', () => {
    const body = (cell: string, above = '') =>
      `Intro with \`code\` and [a link](x) <!--ins z8bb-->new<!--/z8bb-->.\n\n${above}| Fruit | ${cell} |\n| ----- | ----- |\n| a | b |\n| c | d |\n\nOutro with \`x\`.`;
    const marks = { z8bb: 'ada', c2dd: 'bo' };
    const text = file(body('Price<!--ins c2dd-->s<!--/c2dd-->'), marks);
    const slice = headerSlice(text, readTables(text, parse(text))[0]?.from ?? -1);
    expect(slice).toBeDefined();
    expect(slice).toContain('| Fruit | Price<!--ins c2dd-->s<!--/c2dd--> |\n| ----- | ----- |');
    for (const left of ['| a | b |', 'Intro', 'Outro', 'z8bb']) expect(slice).not.toContain(left);
    // Read as a file of its own: one table of two columns and the one change that it holds.
    const read = parse(slice ?? '');
    expect(problemsOf(read)).toEqual([]);
    expect(Object.keys(read.ledger.marks)).toEqual(['c2dd']);
    expect(readTables(slice ?? '', read).map((table) => table.rows[0]?.cells.length)).toEqual([2]);
    // A decision in it is the decision in the file, in the header.
    const accepted = applyChanges(slice ?? '', accept(slice ?? '', 'c2dd'));
    expect(accepted).toContain('| Fruit | Prices |');
    expect(applyChanges(slice ?? '', reject(slice ?? '', 'c2dd'))).toContain('| Fruit | Price |');
  });

  it('is nothing where something that is open in the header could be finished by the rest of the table', () => {
    const body = (cell: string, above = '') =>
      `${above}| Fruit | ${cell} |\n| ----- | ----- |\n| a | b |\n| c | d |`;
    const unreadable: [string, string][] = [
      ['a code span', body('`Price`')],
      ['a code span begun', body('Price`')],
      ['a link', body('[Price](x)')],
      ['an open bracket', body('[Price')],
      ['a backtick that a deletion would bring back', body('Price<!--del c2dd \\x60-->')],
      [
        'a backtick that a replacement would bring back',
        body('<!--sub c2dd \\x60-->Price<!--/c2dd-->'),
      ],
    ];
    for (const [what, text] of unreadable) {
      const file_ = file(text, { c2dd: 'bo' });
      expect(
        headerSlice(file_, readTables(file_, parse(file_))[0]?.from ?? -1),
        what,
      ).toBeUndefined();
    }
    // The text above a table, with a blank line or without, is the paragraph of another block: a table starts its own.
    for (const above of ['Text with a `tick.\n\n', 'Text with a `tick\n']) {
      const plain = file(body('Price', above));
      const slice = headerSlice(plain, readTables(plain, parse(plain))[0]?.from ?? -1);
      expect(slice, above).toBeDefined();
      expect(slice, above).not.toContain('tick');
    }
    const plain = file(body('Price'));
    // A change of another tool that has its opener above the table and its closer below it is not in the header.
    const spanned = file(`${MARK}\n\n${CENTERED}\n\n<!--/k3x9-->`, { k3x9: 'ada' });
    expect(
      headerSlice(spanned, readTables(spanned, parse(spanned))[0]?.from ?? -1),
    ).toBeUndefined();
    // No table starts there.
    expect(headerSlice(plain, 3)).toBeUndefined();
  });
});

// A merge can leave a column change and the mark of an alignment change in one table (format §7): two people
// changed it on branches and the text was joined. No operation writes both (each refuses while the other is
// pending), so these files are made by hand, or by an operation and a hand. The mark ends the header's last
// cell, and a decision that rewrites the columns keeps it there: where it stands when its cell stays the last,
// at the new last cell when its cell goes or stops being the last, its `SPEC` untouched. The one decision of such
// a file that can be refused is rejecting the mark while the table has columns that its old row doesn't (the
// words of `LOST`).
describe('a point alignment change beside a column change, as a merge leaves them (#281)', () => {
  const crlf = (text: string) => text.replace(/\n/g, '\r\n');
  const lines = (...rows: string[]) => rows.join('\n');
  const TWO = '| ----- | ----- |';
  const ORIGINAL_TWO = lines(
    '| Fruit | Count |',
    '| ----- | ----- |',
    '| Apples | 3 |',
    '| Pears | 5 |',
  );
  /** Three columns whose delimiter cells differ in width, and three whose cells don't. The old row that
   * the mark holds is positional, and the delimiter cell of a moved column travels with its column: with cells
   * of different widths, rejecting the mark before the move would change the original text, which the views'
   * check refuses, so the files of moves use the second, in which no decision of the pair is refused. */
  const PLAIN3 = lines(
    '| Fruit  | Count | Price |',
    '| ------ | ----- | ----- |',
    '| Apples | 3     | 1.20  |',
    '| Pears  | 5     | 0.90  |',
  );
  const OLD3 = '| ------ | ----- | ----- |';
  const FLAT3 = lines(
    '| Fruit | Count | Price |',
    '| ----- | ----- | ----- |',
    '| Apples | 3 | 1.20 |',
    '| Pears | 5 | 0.90 |',
  );
  const FLAT_OLD = '| ----- | ----- | ----- |';
  /** The ledger of a file of the operations with an entry more, in the file's own line breaks. */
  const entry = (text: string, id: string, by: string) =>
    text.replace(
      /marks:(\r?\n)/,
      (_, eol: string) => `marks:${eol}  ${id}: {by: ${by}, at: ${TIME}}${eol}`,
    );
  /** A file of the operations with Ada's change joined into it by hand: the text of its body replaced as
   * given (each must be there), and the entry of her mark. */
  const joined = (made: string, ...replaced: [string, string][]) => {
    let text = made;
    for (const [from, to] of replaced) {
      expect(text, from).toContain(from);
      text = text.replace(from, to);
    }
    return entry(text, 'k3x9', 'ada');
  };
  const decide = (text: string, how: typeof accept, id: string) =>
    applyChanges(text, how(text, id));
  /** What the views say of a file: the original, with the old row, and no marker in any of them, the
   * review view with one note of the mark. */
  const viewed = (text: string, original: string) => {
    expect(trim(originalView(text).text)).toBe(original);
    expect(originalView(text).text).not.toContain('<!--');
    expect(newestView(text).text).not.toContain('<!--');
    expect(originalViewOfText(text).text).not.toContain('<!--');
    expect(reviewView(text)).not.toContain('<!--');
    expect(reviewView(text).match(/\{>>\[k3x9 ada\]/g)).toHaveLength(1);
  };
  /** Only the rejection of the mark is refused, and only for its words. */
  const onlyTheMark = (refused: string[]) => {
    expect(refused.length).toBeGreaterThan(0);
    expect(refused.every((step) => step.endsWith(' rk3x9'))).toBe(true);
  };

  describe('Bo’s column inserted after the last, Ada’s mark at the end of the new last cell', () => {
    const INSERTED = file(
      lines(
        `| Fruit | Count | <!--ins c2dd col--> New${markFor(TWO)} |`,
        '| ----- | :---: | --- |',
        '| Apples | 3 |  |',
        '| Pears | 5 |  |',
      ),
      { c2dd: 'bo', k3x9: 'ada' },
    );
    const NARROW = lines(
      `| Fruit | Count${markFor(TWO)} |`,
      '| ----- | :---: |',
      '| Apples | 3 |',
      '| Pears | 5 |',
    );
    const CENTERED_TWO = ORIGINAL_TWO.replace('| ----- | ----- |', '| ----- | :---: |');

    it('keeps the mark when the column it ends is rejected, and rejecting it then gives the original byte for byte', () => {
      const rejected = decide(INSERTED, reject, 'c2dd');
      expect(trim(rejected)).toBe(NARROW);
      // The mark and its entry are there, once, and nothing of the column.
      expect(parse(rejected).marks.map((mark) => mark.id)).toEqual(['k3x9']);
      expect(Object.keys(parse(rejected).ledger.marks)).toEqual(['k3x9']);
      expect(problemsOf(parse(rejected))).toEqual([]);
      same(decide(rejected, reject, 'k3x9'), file(ORIGINAL_TWO));
      expect(trim(decide(rejected, accept, 'k3x9'))).toBe(CENTERED_TWO);
      expect(tableLeaves(rejected)).toEqual(tableLeaves(file(CENTERED_TWO)));
    });

    it('leaves the mark where it is when the column is accepted, and then it can only be accepted', () => {
      const accepted = decide(INSERTED, accept, 'c2dd');
      expect(trim(accepted)).toBe(trim(INSERTED).replace('<!--ins c2dd col--> ', ''));
      expect(parse(accepted).marks.map((mark) => mark.id)).toEqual(['k3x9']);
      expect(said(() => reject(accepted, 'k3x9'))).toBe(LOST);
      expect(trim(decide(accepted, accept, 'k3x9'))).toBe(
        lines(
          '| Fruit | Count | New |',
          '| ----- | :---: | --- |',
          '| Apples | 3 |  |',
          '| Pears | 5 |  |',
        ),
      );
    });

    it('refuses to reject the mark first, in the words that say it needs its columns, which is the one refusal', () => {
      expect(said(() => reject(INSERTED, 'k3x9'))).toBe(LOST);
      // Accepting it first takes the mark away, and the column is decided as it is.
      const first = decide(INSERTED, accept, 'k3x9');
      expect(trim(first)).toContain('| Fruit | Count | <!--ins c2dd col--> New |');
      expect(trim(decide(first, reject, 'c2dd'))).toBe(CENTERED_TWO);
    });

    it('is decided in every order: all alike, none stuck, each file read as its newest view', () => {
      expectEveryOrderAlike('inserted last', INSERTED, exactly);
      onlyTheMark(expectEveryOrderRead('inserted last', INSERTED));
      expect(trim(applyChanges(INSERTED, rejectAll(INSERTED)))).toBe(ORIGINAL_TWO);
      expect(trim(applyChanges(INSERTED, acceptAll(INSERTED)))).toBe(
        trim(newestView(INSERTED).text),
      );
    });

    it('is shown by the views once: the old row in the original, the new in the newest, no marker left', () => {
      viewed(INSERTED, ORIGINAL_TWO);
      expect(trim(newestView(INSERTED).text)).toBe(
        lines(
          '| Fruit | Count | New |',
          '| ----- | :---: | --- |',
          '| Apples | 3 |  |',
          '| Pears | 5 |  |',
        ),
      );
      // What a plain edit compares with has the markers hidden and nothing undone: no second mark.
      expect(trim(originalViewOfText(INSERTED).text)).toBe(CENTERED_TWO);
    });

    it('is the same in a CRLF file', () => {
      const text = crlf(INSERTED);
      const rejected = decide(text, reject, 'c2dd');
      expect(trim(rejected)).toBe(crlf(NARROW));
      same(decide(rejected, reject, 'k3x9'), crlf(file(ORIGINAL_TWO)));
      viewed(text, crlf(ORIGINAL_TWO));
      expectEveryOrderAlike('CRLF', text, exactly);
    });

    it('writes the point comment of a rejected column in front of the mark, where both end the cell', () => {
      const commented = file(
        lines(
          `| Fruit | Count | <!--ins c2dd col--> <!--cmt c9qf-->New<!--/c9qf-->${markFor(TWO)} |`,
          '| ----- | :---: | --- |',
          '| Apples | 3 |  |',
        ),
        { c2dd: 'bo', k3x9: 'ada' },
        thread('c9qf'),
      );
      const rejected = decide(commented, reject, 'c2dd');
      expect(trim(rejected).split('\n')[0]).toBe(`| Fruit | Count<!--cmt c9qf-->${markFor(TWO)} |`);
      expect(parse(rejected).ledger.comments.map((t) => t.id)).toEqual(['c9qf']);
      // The mark still ends the cell: it is read as the change, and rejecting it gives the old row back.
      const table = readTables(rejected, parse(rejected))[0];
      expect(table && alignMarkOf(parse(rejected), table)?.id).toBe('k3x9');
      expect(
        trim(decide(rejected, reject, 'k3x9'))
          .split('\n')
          .slice(0, 2),
      ).toEqual(['| Fruit | Count<!--cmt c9qf--> |', TWO]);
      expectEveryOrderAlike('a comment in the column', commented, exactly);
    });

    it('is typed in with Track Changes off without a second mark', () => {
      const at = INSERTED.indexOf('Apples') + 6;
      const typed = applyChanges(
        INSERTED,
        untrackedEdit(INSERTED, { from: at, to: at, insert: 'Q' }),
      );
      expect(typed).toContain('ApplesQ');
      expect(typed.match(/<!--fmt k3x9/g)).toHaveLength(1);
      expect(typed.match(/<!--ins c2dd col-->/g)).toHaveLength(1);
      expect(trim(decide(typed, reject, 'c2dd'))).toBe(NARROW.replace('Apples', 'ApplesQ'));
    });
  });

  describe('Bo’s last column deleted, Ada’s mark at the end of the new last cell', () => {
    const made = (table: string) =>
      edit(file(table), { kind: 'deleteCols', cols: [2] }, bo, ['m2bd']).after;
    const DELETED = joined(
      made(PLAIN3),
      ['| Count |', `| Count${markFor(OLD3)} |`],
      ['| ----- |\n', '| :---: |\n'],
    );
    const BACK = lines(
      `| Fruit  | Count | Price${markFor(OLD3)} |`,
      '| ------ | :---: | ----- |',
      '| Apples | 3     | 1.20  |',
      '| Pears  | 5     | 0.90  |',
    );

    it('writes the column back with the mark at the end of its header cell, and rejecting the mark then gives the original', () => {
      expect(parse(DELETED).marks.map((mark) => mark.id)).toEqual(['k3x9', 'm2bd']);
      const rejected = decide(DELETED, reject, 'm2bd');
      expect(trim(rejected)).toBe(BACK);
      expect(Object.keys(parse(rejected).ledger.marks)).toEqual(['k3x9']);
      same(decide(rejected, reject, 'k3x9'), file(PLAIN3));
    });

    it('removes the deletion line and leaves the mark where it is when the deletion is accepted', () => {
      const accepted = decide(DELETED, accept, 'm2bd');
      expect(trim(accepted)).toBe(
        lines(
          `| Fruit  | Count${markFor(OLD3)} |`,
          '| ------ | :---: |',
          '| Apples | 3     |',
          '| Pears  | 5     |',
        ),
      );
      expect(said(() => reject(accepted, 'k3x9'))).toBe(LOST);
      expect(said(() => reject(DELETED, 'k3x9'))).toBe(LOST);
    });

    it('is decided in every order, and shown by the views once', () => {
      expectEveryOrderAlike('deleted last', DELETED, exactly);
      onlyTheMark(expectEveryOrderRead('deleted last', DELETED));
      viewed(DELETED, PLAIN3);
      expect(trim(applyChanges(DELETED, rejectAll(DELETED)))).toBe(PLAIN3);
      expect(reviewView(DELETED)).toContain('{--Price--}{>>[m2bd bo] Deleted column<<}');
    });

    it('writes an empty header cell back with the mark after the first space of its padding', () => {
      const EMPTY3 = lines('| Fruit | Count |  |', '| ----- | ----- | --- |', '| Apples | 3 | x |');
      const old = '| ----- | ----- | --- |';
      const text = joined(
        made(EMPTY3),
        ['| Count |', `| Count${markFor(old)} |`],
        ['| ----- | ----- |\n', '| ----- | :---: |\n'],
      );
      const rejected = decide(text, reject, 'm2bd');
      expect(trim(rejected)).toBe(
        lines(
          `| Fruit | Count | ${markFor(old)} |`,
          '| ----- | :---: | --- |',
          '| Apples | 3 | x |',
        ),
      );
      same(decide(rejected, reject, 'k3x9'), file(EMPTY3));
      expectEveryOrderAlike('an empty cell back', text, exactly);
      expect(tableLeaves(rejected)).toEqual(tableLeaves(file(EMPTY3.replace('-----', ':---:'))));
    });
  });

  describe('Bo’s column moved to the end or from it, Ada’s mark at the end of the last cell', () => {
    const moved = (cols: number[], to: number) =>
      edit(file(FLAT3), { kind: 'moveCols', cols, to }, bo, ['c2dd', 'f3gg']).after;
    // Fruit moved after Price: the mark ends the moved column, and the delimiter cell of Count is the first.
    const TO_END = joined(
      moved([0], 3),
      ['Fruit |', `Fruit${markFor(FLAT_OLD)} |`],
      ['| ----- | ----- | ----- |', '| :---: | ----- | ----- |'],
    );
    // Price moved before Fruit: the mark ends Count, which stays the last.
    const FROM_END = joined(
      moved([2], 0),
      ['Count |', `Count${markFor(FLAT_OLD)} |`],
      ['| ----- | ----- | ----- |', '| ----- | ----- | :---: |'],
    );
    const BACK = lines(
      `| Fruit | Count | Price${markFor(FLAT_OLD)} |`,
      '| ----- | :---: | ----- |',
      '| Apples | 3 | 1.20 |',
      '| Pears | 5 | 0.90 |',
    );

    it('moves the mark from the moved column to the one that is last when the move is rejected', () => {
      for (const id of ['c2dd', 'f3gg']) {
        const rejected = decide(TO_END, reject, id);
        expect(trim(rejected), id).toBe(BACK);
        same(decide(rejected, reject, 'k3x9'), file(FLAT3));
      }
    });

    it('moves the mark to the column that goes back to the end, and leaves it when the move is accepted', () => {
      for (const id of ['c2dd', 'f3gg']) {
        const rejected = decide(FROM_END, reject, id);
        expect(trim(rejected), id).toBe(BACK);
        same(decide(rejected, reject, 'k3x9'), file(FLAT3));
      }
      const accepted = decide(FROM_END, accept, 'c2dd');
      expect(trim(accepted)).toContain(`| Fruit | Count${markFor(FLAT_OLD)} |`);
      expect(parse(accepted).marks.map((mark) => mark.id)).toEqual(['k3x9']);
      const kept = decide(TO_END, accept, 'f3gg');
      expect(trim(kept)).toContain(`| Count | Price | Fruit${markFor(FLAT_OLD)} |`);
      expect(parse(kept).marks.map((mark) => mark.id)).toEqual(['k3x9']);
    });

    it('keeps the mark when text typed with Track Changes off in the moved copy is written into both halves', () => {
      const at = TO_END.indexOf('Apples') + 3;
      const typed = applyChanges(TO_END, untrackedEdit(TO_END, { from: at, to: at, insert: 'QQ' }));
      expect(typed).toContain('AppQQles');
      expect(typed.match(/<!--fmt k3x9/g)).toHaveLength(1);
      const rejected = decide(typed, reject, 'c2dd');
      expect(trim(rejected)).toBe(BACK.replace('Apples', 'AppQQles'));
      same(decide(rejected, reject, 'k3x9'), file(FLAT3.replace('Apples', 'AppQQles')));
      expect(trim(decide(typed, accept, 'c2dd'))).toContain(`Fruit${markFor(FLAT_OLD)} |`);
      expectEveryOrderAlike('typed in the copy', typed, exactly);
    });

    it('is decided in every order with no decision refused, and shown by the views once', () => {
      for (const [name, text] of [
        ['to the end', TO_END],
        ['from the end', FROM_END],
      ] as const) {
        expectEveryOrderAlike(name, text, exactly);
        expect(expectNoDecisionRefused(name, text), name).toBeGreaterThan(4);
        expect(expectEveryOrderRead(name, text), name).toEqual([]);
        viewed(text, FLAT3);
        expect(trim(applyChanges(text, rejectAll(text))), name).toBe(FLAT3);
        expect(trim(applyChanges(text, acceptAll(text))), name).toBe(trim(newestView(text).text));
      }
    });
  });

  describe('two of Bo’s columns inserted together, Ada’s mark at the end of the last', () => {
    /** The mark ends the last cell of the header, as the reader of the table finds it. */
    const endsHeader = (text: string) => {
      const parsed = parse(text);
      const table = readTables(text, parsed)[0];
      const mark = table && alignMarkOf(parsed, table);
      expect(mark?.segments[0]?.open.from).toBe(table?.rows[0]?.cells.at(-1)?.textTo);
    };

    it('writes the mark after the text of the column before it, or after the marker of an empty one', () => {
      const original = lines('| Fruit | Count |', '| ----- | ----- |', '| Apples | 3 |');
      for (const [what, first, kept] of [
        ['text', '<!--ins c2dd col--> N1', `<!--ins c2dd col--> N1${markFor(TWO)}`],
        ['no text', '<!--ins c2dd col-->   ', `<!--ins c2dd col--> ${markFor(TWO)}  `],
      ] as const) {
        const text = file(
          lines(
            `| Fruit | Count | ${first} | <!--ins f4gg col--> N2${markFor(TWO)} |`,
            '| ----- | :---: | --- | --- |',
            '| Apples | 3 | a | b |',
          ),
          { c2dd: 'bo', k3x9: 'ada', f4gg: 'bo' },
        );
        const rejected = decide(text, reject, 'f4gg');
        expect(trim(rejected), what).toBe(
          lines(`| Fruit | Count | ${kept} |`, '| ----- | :---: | --- |', '| Apples | 3 | a |'),
        );
        endsHeader(rejected);
        // The other column goes, and the mark stays at the end of the last cell it ends.
        const other = decide(text, reject, 'c2dd');
        expect(trim(other).split('\n')[0], what).toBe(
          `| Fruit | Count | <!--ins f4gg col--> N2${markFor(TWO)} |`,
        );
        endsHeader(other);
        expect(trim(applyChanges(text, rejectAll(text))), what).toBe(original);
        expectEveryOrderAlike(what, text, exactly);
        viewed(text, original);
      }
    });
  });

  describe('Bo’s column inserted before the first, Ada’s mark at the end of the last cell', () => {
    const FIRST = joined(
      edit(file(PLAIN3), { kind: 'insertCols', after: 0 }, bo, ['c2dd']).after,
      ['Price |', `Price${markFor(OLD3)} |`],
      ['| --- | ------ | ----- | ----- |', '| --- | ------ | :---: | ----- |'],
    );

    it('leaves the mark at the end of the last cell, not at the first, whichever way the column is decided', () => {
      const rejected = decide(FIRST, reject, 'c2dd');
      expect(trim(rejected)).toBe(
        lines(
          `| Fruit  | Count | Price${markFor(OLD3)} |`,
          '| ------ | :---: | ----- |',
          '| Apples | 3     | 1.20  |',
          '| Pears  | 5     | 0.90  |',
        ),
      );
      same(decide(rejected, reject, 'k3x9'), file(PLAIN3));
      const accepted = decide(FIRST, accept, 'c2dd');
      expect(trim(accepted).split('\n')[0]).toBe(
        `|     | Fruit  | Count | Price${markFor(OLD3)} |`,
      );
      expect(said(() => reject(accepted, 'k3x9'))).toBe(LOST);
    });

    it('is decided in every order, and shown by the views once', () => {
      expectEveryOrderAlike('inserted first', FIRST, exactly);
      onlyTheMark(expectEveryOrderRead('inserted first', FIRST));
      viewed(FIRST, PLAIN3);
    });
  });

  describe('a column inserted before the first, and an inserted row with a comment in the cell that goes', () => {
    // The row's first cell is in the column that leaves: the marker of the row goes to the new first cell and the
    // comment becomes a point at the start of that cell's text, where the marker stands: marker, comment, text.
    const OLD = '| --- | --- | --- |';
    const body = (mark: string) =>
      lines(
        `| <!--ins c2dd col--> | ha | hb | hc${mark} |`,
        '| --- | --- | :-: | --- |',
        '|  | a1 | a2 | a3 |',
        '| <!--ins r5dd row--> n0<!--cmt c9qf--> | n1 | n2 | n3 |',
      );
    const WITH_ROW = file(
      body(markFor(OLD)),
      { c2dd: 'bo', k3x9: 'ada', r5dd: 'bo' },
      thread('c9qf'),
    );
    const CONTROL = file(body(''), { c2dd: 'bo', r5dd: 'bo' }, thread('c9qf'));
    const ROW = '| <!--ins r5dd row--> <!--cmt c9qf-->n1 | n2 | n3 |';

    it('writes the comment after the marker of the row and keeps the mark at the end of the header', () => {
      const rejected = decide(WITH_ROW, reject, 'c2dd');
      expect(trim(rejected)).toBe(
        lines(`| ha | hb | hc${markFor(OLD)} |`, '| --- | :-: | --- |', '| a1 | a2 | a3 |', ROW),
      );
      // The row is still the inserted one, the comment is one point, and the mark ends the header's last cell.
      const parsed = parse(rejected);
      const table = readTables(rejected, parsed)[0];
      expect(table?.rows[2]?.insertion?.id).toBe('r5dd');
      expect(parsed.ledger.comments.map((t) => t.id)).toEqual(['c9qf']);
      expect(table && alignMarkOf(parsed, table)?.segments[0]?.open.from).toBe(
        table?.rows[0]?.cells.at(-1)?.textTo,
      );
      // The file with no mark writes the same row: the mark is no reason for a different line.
      expect(
        trim(decide(CONTROL, reject, 'c2dd'))
          .split('\n')
          .at(-1),
      ).toBe(ROW);
      // Rejecting the mark then writes its old row back, and nothing else changes.
      expect(trim(decide(rejected, reject, 'k3x9'))).toBe(
        lines('| ha | hb | hc |', '| --- | --- | --- |', '| a1 | a2 | a3 |', ROW),
      );
    });

    it('is decided in every order, with the mark’s rejection the only one refused, and decided all at once', () => {
      expectEveryOrderAlike('a comment in the row', WITH_ROW, exactly);
      onlyTheMark(expectEveryOrderRead('a comment in the row', WITH_ROW));
      const everything = (text: string, how: typeof acceptAll) =>
        trim(applyChanges(text, how(text)));
      // The comment stays, as a point at the end of the row above the one that goes.
      expect(everything(WITH_ROW, rejectAll)).toBe(
        lines('| ha | hb | hc |', '| --- | --- | --- |', '| a1 | a2 | a3<!--cmt c9qf--> |'),
      );
      expect(everything(WITH_ROW, acceptAll).replace('<!--cmt c9qf-->', '')).toBe(
        trim(newestView(WITH_ROW).text),
      );
      viewed(WITH_ROW, lines('| ha | hb | hc |', '| --- | --- | --- |', '| a1 | a2 | a3 |'));
    });
  });

  describe('a header with no pipes at its edges', () => {
    const OLD = '----- | -----';
    const BARE = file(
      lines(
        `Fruit | Count | <!--ins c2dd col--> New${markFor(OLD)}`,
        '----- | :---: | ---',
        'Apples | 3 | a',
        'Pears | 5 | b',
      ),
      { c2dd: 'bo', k3x9: 'ada' },
    );

    it('puts the closing pipe that the row needs after the mark', () => {
      const rejected = decide(BARE, reject, 'c2dd');
      expect(trim(rejected)).toBe(
        lines(`Fruit | Count${markFor(OLD)} |`, '----- | :---: |', 'Apples | 3 |', 'Pears | 5 |'),
      );
      expect(problemsOf(parse(rejected))).toEqual([]);
      const both = decide(rejected, reject, 'k3x9');
      expect(tableLeaves(both)).toEqual(
        tableLeaves(file(lines('Fruit | Count', OLD, 'Apples | 3', 'Pears | 5'))),
      );
      // The mark ends the line where the column that goes had it, in the file that keeps it.
      const kept = decide(BARE, accept, 'c2dd');
      expect(trim(kept).split('\n')[0]).toBe(`Fruit | Count | New${markFor(OLD)}`);
    });

    it('is decided in every order', () => {
      expectEveryOrderAlike('a bare header', BARE, exactly);
      onlyTheMark(expectEveryOrderRead('a bare header', BARE));
      // The closing pipe that the rewrite of the columns wrote stays in both versions.
      viewed(BARE, lines('Fruit | Count |', OLD, 'Apples | 3 |', 'Pears | 5 |'));
    });
  });

  describe('a mark that a merge left in a row below the header', () => {
    const BELOW = file(
      lines(
        '| Fruit | Count | <!--ins c2dd col--> New |',
        '| ----- | :---: | --- |',
        `| Apples | 3 | a${markFor(TWO)} |`,
        '| Pears | 5 | b |',
      ),
      { c2dd: 'bo', k3x9: 'ada' },
    );

    it('stays in its own row when its column goes, and never moves into the header', () => {
      const rejected = decide(BELOW, reject, 'c2dd');
      expect(trim(rejected)).toBe(
        lines(
          '| Fruit | Count |',
          '| ----- | :---: |',
          `| Apples | 3${markFor(TWO)} |`,
          '| Pears | 5 |',
        ),
      );
      expect(parse(rejected).marks.map((mark) => mark.id)).toEqual(['k3x9']);
      same(
        decide(rejected, reject, 'k3x9'),
        file(lines('| Fruit | Count |', '| ----- | ----- |', '| Apples | 3 |', '| Pears | 5 |')),
      );
    });
  });

  describe('two tables, each with its own column and mark', () => {
    const first = lines(
      `| Fruit | Count | <!--ins c2dd col--> New${markFor(TWO)} |`,
      '| ----- | :---: | --- |',
      '| Apples | 3 |  |',
    );
    const second = lines(
      `| Veg | Qty | <!--ins m5nn col--> New${markFor(TWO).replace('k3x9', 'w8nn')} |`,
      '| --- | :-: | --- |',
      '| Leeks | 4 |  |',
    );
    const both = file(`${first}\n\nBetween the tables.\n\n${second}`, {
      c2dd: 'bo',
      k3x9: 'ada',
      m5nn: 'bo',
      w8nn: 'ada',
    });

    it('decides the columns of one and leaves the other as it was', () => {
      const one = decide(both, reject, 'c2dd');
      expect(trim(one)).toContain(`\n\nBetween the tables.\n\n${second}`);
      expect(trim(one)).toContain(`| Fruit | Count${markFor(TWO)} |`);
      const other = decide(both, reject, 'm5nn');
      expect(trim(other)).toContain(`${first}\n\nBetween the tables.\n\n`);
      expect(trim(other)).toContain(`| Veg | Qty${markFor(TWO).replace('k3x9', 'w8nn')} |`);
      expect(parse(applyChanges(both, rejectAll(both))).marks).toEqual([]);
    });
  });
  describe('joined by hand into random changes', () => {
    const POOL = ['c2dd', 'f3gg', 'h4jj', 'm5nn', 'b7cd', 'd8fg', 'g9hj', 'j2kl'];
    /** Ids for more changes: each operation draws the ones that are not in the file yet. */
    const MORE = [...POOL, 'n3pq', 'r4st', 't5vw', 'v6xz', 'w7zb', 'x8zc', 'z9bd', 'b2cf'];
    const styles: Record<string, (cells: string[]) => string> = {
      padded: (cells) => `| ${cells.join(' | ')} |`,
      compact: (cells) => `|${cells.join('|')}|`,
      bare: (cells) => cells.join(' | '),
      open: (cells) => `| ${cells.join(' | ')}`,
      lead: (cells) => `${cells.join(' | ')} |`,
    };
    const tidy = (view: string) => view.replace(/\s+$/, '');

    /**
     * A random table (five styles, LF or CRLF) changed by Bo, tracked, with Ada's mark joined in by hand at the end
     * of its header's last cell, `SPEC` the old row: Bo changes the columns once or twice. With `rich` the table
     * starts as the review's did, a row inserted or moved, a column put in (at the start, mostly) and a comment of
     * Ada's in the first cell of the pending row, which goes with that column, and more rows, columns and comments
     * follow. Undefined when no column change is left pending.
     */
    const randomMerge = (random: () => number, rich: boolean) => {
      const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
      const width = 2 + Math.floor(random() * 3);
      const line = styles[pick(Object.keys(styles))] as (cells: string[]) => string;
      const eol = random() < 0.25 ? '\r\n' : '\n';
      // The delimiter cells are alike, so that a moved column's cell is no other's, whatever the order.
      const spec = line(Array.from({ length: width }, () => '-----'));
      const original = [
        line(Array.from({ length: width }, (_, c) => `hdr${'abcd'[c]}`)),
        spec,
        ...Array.from({ length: 1 + Math.floor(random() * 3) }, (_, r) =>
          line(Array.from({ length: width }, (_, c) => `r${r}c${c}`)),
        ),
      ].join(eol);
      let text = file(original);
      const steps: string[] = [];
      const ids = () => [...(rich ? MORE : POOL)].sort(() => random() - 0.5);
      const tableOf = () => readTables(text, parse(text))[0];
      /** An operation of Bo's, tracked, or nothing where it is refused. */
      const operate = (op: TableOp) => {
        try {
          text = applyChanges(text, tableEdit(text, op, context(bo, ids())).changes);
          steps.push(JSON.stringify(op));
        } catch (error) {
          if (!(error instanceof EditError)) throw error;
        }
      };
      /** A comment of Ada's over `from` to `to`, or nothing where it is refused. */
      const comment = (from: number, to: number) => {
        try {
          text = applyChanges(
            text,
            addComment(text, { from, to }, 'A note.', context(ada, ids())).changes,
          );
          steps.push(`comment ${from}-${to}`);
        } catch (error) {
          if (!(error instanceof EditError)) throw error;
        }
      };
      if (rich && random() < 0.5) {
        const first = tableOf();
        const rows = first?.rows.length ?? 0;
        if (first && random() < 0.6) {
          operate({
            kind: 'insertRows',
            table: first.from,
            after: Math.floor(random() * rows),
            count: 1,
          });
        } else if (first && rows > 2) {
          const moved = 1 + Math.floor(random() * (rows - 1));
          operate({
            kind: 'moveRows',
            table: first.from,
            rows: [moved],
            to: 1 + Math.floor(random() * rows),
          });
        }
        const second = tableOf();
        if (second) {
          const after = random() < 0.7 ? 0 : Math.floor(random() * (second.aligns.length + 1));
          operate({ kind: 'insertCols', table: second.from, after, count: 1 });
        }
        const cell = tableOf()?.rows.find((row) => row.insertion)?.cells[0];
        if (cell) {
          const from = cell.textFrom + Math.floor(random() * (cell.textTo - cell.textFrom + 1));
          comment(from, random() < 0.5 ? from : Math.min(cell.textTo, from + 1));
        }
      }
      for (let step = 0; step < (rich ? 1 : 0) + 1 + Math.floor(random() * 2); step++) {
        const table = tableOf();
        if (!table) break;
        const columns = table.aligns.length;
        const rows = table.rows.length;
        const kinds = rich
          ? (['insertRows', 'moveRows', 'deleteRows', 'comment', 'comment'] as const)
          : ([] as const);
        const kind = pick([
          'insertCols',
          'insertCols',
          'deleteCols',
          'moveCols',
          'moveCols',
          ...kinds,
        ] as const);
        const bodyRow = () => 1 + Math.floor(random() * Math.max(1, rows - 1));
        if (kind === 'insertCols') {
          const after = Math.floor(random() * (columns + 1));
          operate({ kind, table: table.from, after, count: 1 + Math.floor(random() * 2) });
        } else if (kind === 'deleteCols') {
          operate({ kind, table: table.from, cols: [Math.floor(random() * columns)] });
        } else if (kind === 'moveCols') {
          const cols = [Math.floor(random() * columns)];
          operate({ kind, table: table.from, cols, to: Math.floor(random() * (columns + 1)) });
        } else if (kind === 'insertRows') {
          operate({ kind, table: table.from, after: Math.floor(random() * rows), count: 1 });
        } else if (kind === 'moveRows') {
          operate({
            kind,
            table: table.from,
            rows: [bodyRow()],
            to: 1 + Math.floor(random() * rows),
          });
        } else if (kind === 'deleteRows') {
          operate({ kind, table: table.from, rows: [bodyRow()] });
        } else {
          const target = pick(table.rows);
          const cell = pick(target.cells.slice(0, columns));
          const from = cell.textFrom + Math.floor(random() * (cell.textTo - cell.textFrom + 1));
          comment(
            from,
            random() < 0.4 ? from : Math.min(cell.textTo, from + 1 + Math.floor(random() * 2)),
          );
        }
      }
      const parsed = parse(text);
      const header = readTables(text, parsed)[0]?.rows[0];
      const last = header?.cells.at(-1);
      // Bo's own inserted column that he deleted again is gone, and a file of no column change has no marks.
      if (!/col-->|col=\d/.test(text) || !last || header?.insertion) return undefined;
      // Ada's change is joined in: her mark at the end of the header's last cell, its `SPEC` the old row.
      const merged = entry(
        text.slice(0, last.textTo) + markFor(spec) + text.slice(last.textTo),
        'k3x9',
        'ada',
      );
      const label = `${JSON.stringify(original)} ${steps.join(' ')}\n${bodyOf(merged)}`;
      return { original, merged, label };
    };

    it('is kept at the end of the header through every decision, which reads alike in every order', () => {
      const random = seeded(Number(process.env['REDLINES_SEED'] ?? 281));
      let used = 0;
      for (let n = 0; n < fuzzCount(60); n++) {
        const made = randomMerge(random, false);
        if (!made) continue;
        const { original, merged, label } = made;
        used++;
        // After each decision of a column the mark is there once, with its entry, and ends the last cell.
        const seen = new Set<string>();
        const walk = (state: string, path: string) => {
          if (seen.has(state)) return;
          seen.add(state);
          const parsed = parse(state);
          const table = readTables(state, parsed)[0];
          const mark = table && alignMarkOf(parsed, table);
          expect(
            parsed.marks.filter((m) => m.id === 'k3x9'),
            `${label}${path}`,
          ).toHaveLength(1);
          expect(parsed.ledger.marks['k3x9'], `${label}${path}`).toBeDefined();
          expect(mark?.segments[0]?.open.from, `${label}${path}`).toBe(
            table?.rows[0]?.cells.at(-1)?.textTo,
          );
          for (const { id, kind, payload } of parsed.marks) {
            if (
              !(kind === 'ins' ? payload === 'col' : kind === 'del' && /^col=/.test(payload ?? ''))
            ) {
              continue;
            }
            for (const [how, decideIt] of [
              ['accept', accept],
              ['reject', reject],
            ] as const) {
              try {
                walk(applyChanges(state, decideIt(state, id)), `${path} ${how} ${id}`);
              } catch (error) {
                if (!(error instanceof EditError)) throw error;
              }
            }
          }
        };
        walk(merged, '');
        expectEveryOrderAlike(label, merged, exactly);
        // Each file on the way reads as its newest view, and the only decision refused is the mark's.
        for (const step of expectEveryOrderRead(label, merged)) {
          expect(step, label).toMatch(/ rk3x9$/);
        }
        const rejected = applyChanges(merged, rejectAll(merged));
        expect(
          parse(rejected).marks.filter((mark) => mark.kind !== 'cmt'),
          label,
        ).toEqual([]);
        expect(tidy(originalView(rejected).text), label).toBe(tidy(originalView(merged).text));
        expect(JSON.stringify(blockLeaves(rejected)), label).toBe(
          JSON.stringify(blockLeaves(file(original))),
        );
        const accepted = applyChanges(merged, acceptAll(merged));
        expect(parse(accepted).marks, label).toEqual([]);
        expect(tidy(newestView(accepted).text), label).toBe(tidy(newestView(merged).text));
      }
      expect(used).toBeGreaterThan(fuzzCount(60) / 2);
    }, 120_000);

    it('is decided as the same file without it is, through every state that rows, columns and comments reach', () => {
      const random = seeded(Number(process.env['REDLINES_SEED'] ?? 281));
      /** The file without the mark of Ada's change and its entry: what the file reads and decides as but for it. */
      const without = (state: string) => {
        const open = parse(state).marks.find((mark) => mark.id === 'k3x9')?.segments[0]?.open;
        if (!open) return state;
        const bare = state.slice(0, open.from) + state.slice(open.to);
        return bare.replace(/ {2}k3x9: \{[^}]*\}\r?\n/, '');
      };
      /** Whether the original view of a file can't be read: its table has no column of the original left (an
       * inserted column pending, every other one deleted and accepted), and `originalView` throws. A file that may
       * hold indented code reads that view when a decision is made, and refuses it, with or without the mark; the
       * mark's `\x20` is enough to make the file one (`mayIndent`). */
      const noOriginal = (text: string) => {
        try {
          originalView(text);
          return false;
        } catch (error) {
          if (error instanceof EditError) return true;
          throw error;
        }
      };
      const attempt = (text: string, how: typeof accept, id: string) => {
        try {
          return applyChanges(text, how(text, id));
        } catch (error) {
          if (error instanceof EditError) return error;
          throw error;
        }
      };
      let used = 0;
      let withRowAndComment = 0;
      for (let n = 0; n < fuzzCount(60); n++) {
        const made = randomMerge(random, true);
        if (!made) continue;
        used++;
        const seen = new Set<string>();
        const walk = (state: string, path: string) => {
          if (seen.has(state) || noOriginal(state)) return;
          seen.add(state);
          const parsed = parse(state);
          const control = without(state);
          if (
            parsed.marks.some((mark) => mark.kind === 'ins' && mark.payload === 'row') &&
            parsed.ledger.comments.length > 0
          ) {
            withRowAndComment++;
          }
          for (const { id, kind } of parsed.marks) {
            if (kind === 'cmt' || kind === 'hl' || id === 'k3x9') continue;
            for (const [how, decideIt] of [
              ['accept', accept],
              ['reject', reject],
            ] as const) {
              const label = `${made.label}\nafter [${path}] ${how} ${id}\n${bodyOf(state)}`;
              const done = attempt(state, decideIt, id);
              const plain = attempt(control, decideIt, id);
              // A decision that the file without the mark allows, the file with it allows: no refusal is the mark's.
              if (done instanceof EditError) {
                if (typeof plain === 'string' && noOriginal(plain)) continue;
                expect(plain, `${label}: ${done.message}`).toBeInstanceOf(EditError);
                continue;
              }
              // And it writes what the file without the mark writes, but for the mark.
              if (typeof plain === 'string') {
                expect(tidy(bodyOf(without(done))), label).toBe(tidy(bodyOf(plain)));
              }
              walk(done, `${path} ${how} ${id}`);
            }
          }
        };
        walk(made.merged, '');
      }
      expect(used).toBeGreaterThan(fuzzCount(60) / 2);
      expect(withRowAndComment).toBeGreaterThan(0);
    }, 120_000);
  });
});
