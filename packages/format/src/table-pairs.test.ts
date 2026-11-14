// The pair model (format §3.7, rules 2 and 3): every pair of operations on rows and columns by two
// people, at every place of a small table, the second tracked or plain. A pair that is allowed reads
// the same in every order of decisions, judged exactly, and a pair that is refused says why.
import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { acceptAll, rejectAll } from './decide.ts';
import { EditError } from './errors.ts';
import { expectEveryOrderRead } from './oracle.ts';
import { parse } from './parse.ts';
import { ALIGN_FIRST, tableEdit, untrackedTableEdit } from './table-ops.ts';
import type { TableOp } from './table-ops.ts';
import { readTables } from './table.ts';
import type { TableAlign } from './table.ts';
import type { TextChange } from './types.ts';
import {
  bo,
  ada,
  bodyOf,
  context,
  expectEveryOrderAlike,
  expectNoDecisionRefused,
  expectPointHolds,
  file,
  exactly,
  pendingPoint,
} from './test-helpers.ts';
import { newestView, originalView } from './views.ts';

const BODY = [
  '| A | B | C |',
  '| - | - | - |',
  '| a1 | b1 | c1 |',
  '| a2 | b2 | c2 |',
  '| a3 | b3 | c3 |',
];
const START = file(BODY.join('\n'));
// The same table with colons in its delimiter row: the pairs also start from one that is aligned.
const COLON = file(
  BODY.map((line) => line.replace('| - | - | - |', '| :- | -: | :-: |')).join('\n'),
);
const ROWS = 4;
const COLUMNS = 3;

type Shape =
  | { kind: 'insertRows'; after: number }
  | { kind: 'deleteRows'; rows: number[] }
  | { kind: 'moveRows'; rows: number[]; to: number }
  | { kind: 'insertCols'; after: number }
  | { kind: 'deleteCols'; cols: number[] }
  | { kind: 'moveCols'; cols: number[]; to: number }
  | { kind: 'align'; cols: number[]; align: TableAlign }
  | { kind: 'deleteTable' };

function shapes(rows: number, columns: number): Shape[] {
  const all: Shape[] = [];
  for (let after = -1; after < rows; after++) all.push({ kind: 'insertRows', after });
  for (let r = 0; r < rows; r++) all.push({ kind: 'deleteRows', rows: [r] });
  for (let r = 0; r < rows; r++) {
    for (let to = 0; to <= rows; to++) {
      if (to !== r && to !== r + 1) all.push({ kind: 'moveRows', rows: [r], to });
    }
  }
  for (let after = 0; after <= columns; after++) all.push({ kind: 'insertCols', after });
  for (let c = 0; c < columns; c++) all.push({ kind: 'deleteCols', cols: [c] });
  for (let c = 0; c < columns; c++) {
    for (let to = 0; to <= columns; to++) {
      if (to !== c && to !== c + 1) all.push({ kind: 'moveCols', cols: [c], to });
    }
  }
  for (let c = 0; c < columns; c++) {
    for (const align of ['center', 'right', ''] as const)
      all.push({ kind: 'align', cols: [c], align });
  }
  // The whole table: after it there is no table for another operation, so it is only ever the second.
  all.push({ kind: 'deleteTable' });
  return all;
}

/** Whether a row operation touches the header, where a pending alignment change has its mark (format §3.7, rule 5):
 * rows inserted above it, the header deleted, or a move that includes it or goes to the top. */
const touchesHeader = (shape: Shape): boolean =>
  (shape.kind === 'insertRows' && shape.after < 0) ||
  (shape.kind === 'deleteRows' && shape.rows.includes(0)) ||
  (shape.kind === 'moveRows' && (shape.rows.includes(0) || shape.to === 0));

const REFUSALS = [
  /^Delete the table instead\.$/,
  /pending change is in this row\. Decide it first\.$/,
  /row is pending\. Decide it first\.$/,
  /^Accept or reject the column changes in this table first\.$/,
  /^Accept or reject the row changes in this table first\.$/,
  /^The rows are already there\.$/,
  /^The columns are already there\.$/,
  /column is pending\. Decide it first\.$/,
  /pending change is in this column\. Decide it first\.$/,
  /alignment change is pending\. Decide it first\.$/,
  /^The columns are already aligned that way\.$/,
  /^Accept or reject the alignment change in this table first\.$/,
  // Rule 6: the whole table goes only where no other person's change is in it.
  /'s pending change is in this table\. Decide it first\.$/,
];

function run(
  text: string,
  shape: Shape,
  who: 'ada' | 'bo' | 'plain',
  ids: string[],
): string | EditError {
  const table = readTables(text, parse(text))[0]?.from ?? 0;
  const op = { ...shape, table, count: 1 } as TableOp;
  try {
    const done =
      who === 'plain'
        ? untrackedTableEdit(text, op)
        : tableEdit(text, op, context(who === 'ada' ? ada : bo, ids));
    return applyChanges(text, done.changes);
  } catch (error) {
    if (error instanceof EditError) return error;
    throw error;
  }
}

/** The two files of a pair that start it: with no alignment in its columns, and with some. */
const STARTS = [
  [START, 'a table with no alignment'],
  [COLON, 'a table whose columns have one'],
] as const;
const SECONDS = [
  ['bo', 'a second person, tracked'],
  ['plain', 'a second person, Track Changes off'],
  ['ada', 'the same person'],
] as const;
const FIRST_IDS = ['k3x9', 'w8nn', 'p5qm', 'q6rs'];
const SECOND_IDS = ['c2dd', 'f3gg', 'h4jj', 'm5nn'];

/** A pair that is allowed reads the same in every order of decisions, judged exactly, has no decision refused,
 * and accepting or rejecting all of it gives the newest or the original view; with every change tracked the
 * original view is the table it started as. */
function expectPairSound(name: string, two: string, from: string, secondBy: string): void {
  expectEveryOrderAlike(name, two, exactly);
  expectNoDecisionRefused(name, two);
  expectPointHolds(name, two);
  const all = (decide: (text: string) => TextChange[]) => {
    try {
      return applyChanges(two, decide(two)).replace(/\s+$/, '');
    } catch (error) {
      throw new Error(`${name}: ${String(error)}\n${two}`, { cause: error });
    }
  };
  expect(all(acceptAll), `${name}: accept all`).toBe(newestView(two).text.replace(/\s+$/, ''));
  expect(all(rejectAll), `${name}: reject all`).toBe(originalView(two).text.replace(/\s+$/, ''));
  // Every change tracked: the original view is the table it started as, alignment included, and
  // the newest view's table is as wide as its header.
  if (secondBy !== 'plain') {
    expect(originalView(two).text.replace(/\s+$/, ''), `${name}: the original`).toBe(
      bodyOf(from).replace(/\s+$/, ''),
    );
  }
}

describe('the pair model for rows and columns', () => {
  const grid = shapes(ROWS, COLUMNS);
  for (const [secondBy, label] of SECONDS) {
    for (const [from, where] of STARTS) {
      it(`reads alike in every order: ${label}, from ${where}`, () => {
        let allowed = 0;
        for (const first of grid) {
          if (first.kind === 'deleteTable') continue;
          const one = run(from, first, 'ada', FIRST_IDS);
          if (one instanceof EditError) continue;
          const read = readTables(one, parse(one))[0];
          const rows = read?.rows.length ?? 0;
          for (const second of shapes(rows, read?.aligns.length ?? 0)) {
            const name = `${JSON.stringify(first)} then ${JSON.stringify(second)}`;
            const two = run(one, second, secondBy, SECOND_IDS);
            if (two instanceof EditError) {
              expect(
                REFUSALS.some((r) => r.test(two.message)),
                `${name}: ${two.message}`,
              ).toBe(true);
              continue;
            }
            allowed++;
            expectPairSound(name, two, from, secondBy);
          }
        }
        expect(allowed).toBeGreaterThan(100);
        // Every pair at every place, decided in every order: a few seconds here, more on a busy runner.
      }, 120_000);
    }
  }
});

// A tracked alignment change is a mark at the end of the header's last cell (format §3.7, rule 5), and the rows
// that touch the header, or the columns, are held to it. The pairs below are those that hold one, over the whole
// grid, and each is judged by the words it is refused with.
describe('the pair model with an alignment change pending', () => {
  /** Ada's tracked alignment of the column `col`: the table with her change pending, or undefined where the columns
   * are as asked already. */
  const alignedBy = (text: string, col: number, align: TableAlign, who: 'ada' | 'bo' = 'ada') => {
    const done = run(text, { kind: 'align', cols: [col], align }, who, FIRST_IDS);
    return done instanceof EditError ? undefined : done;
  };
  const ALIGNS: [number, TableAlign][] = [0, 1, 2].flatMap((col) =>
    (['center', 'right', ''] as const).map((align): [number, TableAlign] => [col, align]),
  );
  const ROW_OPS = ['insertRows', 'deleteRows', 'moveRows'];
  const COLUMN_OPS = ['insertCols', 'deleteCols', 'moveCols'];

  it('refuses a row operation on the header beside an alignment change, in either order', () => {
    let after = 0;
    let before = 0;
    let allowed = 0;
    for (const [from] of STARTS) {
      for (const [secondBy] of SECONDS) {
        for (const [col, align] of ALIGNS) {
          // The change first, then a row operation: one that touches the header is refused, tracked or plain,
          // with the alignment words, and one that does not is written.
          const one = alignedBy(from, col, align);
          if (one === undefined) continue;
          const rows = readTables(one, parse(one))[0]?.rows.length ?? 0;
          for (const second of shapes(rows, COLUMNS).filter((s) => ROW_OPS.includes(s.kind))) {
            const name = `${JSON.stringify([col, align])} then ${JSON.stringify(second)} by ${secondBy}`;
            const two = run(one, second, secondBy, SECOND_IDS);
            if (touchesHeader(second)) {
              expect(two, name).toBeInstanceOf(EditError);
              expect((two as EditError).message, name).toBe(ALIGN_FIRST);
              after++;
            } else {
              expect(two, name).not.toBeInstanceOf(EditError);
              allowed++;
            }
          }
        }
        // A row operation on the header first, then a tracked alignment change: refused, with the words of the
        // row changes, because the mark would stand in a header that is itself pending. With Track Changes off no
        // mark is written, and the alignment is written.
        for (const first of shapes(ROWS, COLUMNS).filter((s) => ROW_OPS.includes(s.kind))) {
          const one = run(from, first, 'ada', FIRST_IDS);
          if (one instanceof EditError) continue;
          for (const [col, align] of ALIGNS) {
            const name = `${JSON.stringify(first)} then ${JSON.stringify([col, align])} by ${secondBy}`;
            const two = run(one, { kind: 'align', cols: [col], align }, secondBy, SECOND_IDS);
            if (secondBy !== 'plain' && touchesHeader(first)) {
              expect(two, name).toBeInstanceOf(EditError);
              expect((two as EditError).message, name).toBe(
                'Accept or reject the row changes in this table first.',
              );
              before++;
            } else if (two instanceof EditError) {
              // Nothing else may refuse it but the columns being as asked.
              expect(two.message, name).toBe('The columns are already aligned that way.');
            } else {
              expectEveryOrderAlike(name, two, exactly);
              expectNoDecisionRefused(name, two);
            }
          }
        }
      }
    }
    expect(after).toBeGreaterThan(60);
    expect(before).toBeGreaterThan(30);
    expect(allowed).toBeGreaterThan(60);
  }, 120_000);

  it('allows a plain column operation beside it, and reads alike', () => {
    let allowed = 0;
    let kept = 0;
    for (const [from, where] of STARTS) {
      for (const [col, align] of ALIGNS) {
        const one = alignedBy(from, col, align);
        if (one === undefined) continue;
        const columns = readTables(one, parse(one))[0]?.aligns.length ?? 0;
        for (const second of shapes(ROWS, columns).filter((s) => COLUMN_OPS.includes(s.kind))) {
          const name = `${where}: ${JSON.stringify([col, align])} then ${JSON.stringify(second)}, plain`;
          const two = run(one, second, 'plain', SECOND_IDS);
          expect(two, name).not.toBeInstanceOf(EditError);
          if (two instanceof EditError) continue;
          allowed++;
          expectPairSound(name, two, from, 'plain');
          // Every state of every order reads as micromark reads its newest view, and no decision is refused.
          expect(expectEveryOrderRead(name, two), name).toEqual([]);
          // The change is kept in step with the columns, or goes where the old and the new alignment are the same.
          if (pendingPoint(two) !== undefined) kept++;
        }
      }
    }
    expect(allowed).toBeGreaterThan(150);
    expect(kept).toBeGreaterThan(100);
  }, 120_000);

  it('every allowed pair that holds an alignment change has no decision refused', () => {
    let held = 0;
    for (const [secondBy] of SECONDS) {
      for (const [from] of STARTS) {
        for (const first of shapes(ROWS, COLUMNS)) {
          if (first.kind === 'deleteTable') continue;
          const one = run(from, first, 'ada', FIRST_IDS);
          if (one instanceof EditError) continue;
          const read = readTables(one, parse(one))[0];
          for (const second of shapes(read?.rows.length ?? 0, read?.aligns.length ?? 0)) {
            const two = run(one, second, secondBy, SECOND_IDS);
            if (two instanceof EditError || !/<!--fmt \w{4} align=/.test(two)) continue;
            held++;
            // No option: no refusal is allowed, not even one that the file has without its alignment change.
            expectNoDecisionRefused(
              `${JSON.stringify(first)} then ${JSON.stringify(second)} by ${secondBy}`,
              two,
            );
          }
        }
      }
    }
    expect(held).toBeGreaterThan(40);
  }, 120_000);

  it('deletes the table beside an alignment change: another person’s is refused with rule 6’s words, your own is folded in', () => {
    let refused = 0;
    let folded = 0;
    for (const [from, where] of STARTS) {
      for (const [col, align] of ALIGNS) {
        const name = `${where}: ${JSON.stringify([col, align])}`;
        // Bo's change is pending, and Ada can't take the table with it.
        const theirs = alignedBy(from, col, align, 'bo');
        if (theirs === undefined) continue;
        const stopped = run(theirs, { kind: 'deleteTable' }, 'ada', SECOND_IDS);
        expect(stopped, name).toBeInstanceOf(EditError);
        expect((stopped as EditError).message, name).toBe(
          "Bo Chen's pending change is in this table. Decide it first.",
        );
        refused++;
        // With Track Changes off the table goes as text, with what was pending in it.
        const plain = run(theirs, { kind: 'deleteTable' }, 'plain', SECOND_IDS);
        expect(plain, name).not.toBeInstanceOf(EditError);
        // Her own change is folded into the deletion: it is written, and rejecting all of it gives back the table
        // as it was, with the old delimiter row and no mark.
        const own = alignedBy(from, col, align);
        if (own === undefined) continue;
        const done = run(own, { kind: 'deleteTable' }, 'ada', SECOND_IDS);
        expect(done, name).not.toBeInstanceOf(EditError);
        if (done instanceof EditError) continue;
        expectEveryOrderAlike(name, done, exactly);
        expectNoDecisionRefused(name, done);
        expect(readTables(newestView(done).text, parse(newestView(done).text)), name).toHaveLength(
          0,
        );
        const rejected = applyChanges(done, rejectAll(done));
        expect(bodyOf(rejected).replace(/\s+$/, ''), `${name}: reject all`).toBe(
          bodyOf(from).replace(/\s+$/, ''),
        );
        expect(rejected, name).not.toContain('align=');
        expect(
          parse(rejected).marks.filter((mark) => mark.kind !== 'cmt'),
          name,
        ).toEqual([]);
        folded++;
      }
    }
    expect(refused).toBeGreaterThan(10);
    expect(folded).toBeGreaterThan(10);
  }, 120_000);

  it('writes into a cell that a short row lacks beside an alignment change, and reads alike', () => {
    // `| a1 |` has one cell of the three, and typing into the second or the third writes its pipes, plain, and then
    // the text, as typing in a cell is written (format §3.7, "A cell a row lacks").
    const short = file(
      ['| A | B | C |', '| - | - | - |', '| a1 |', '| a2 | b2 |', '| a3 | b3 | c3 |'].join('\n'),
    );
    let written = 0;
    for (const [col, align] of [
      [0, 'center'],
      [2, 'right'],
      [1, ''],
    ] as const) {
      const one = alignedBy(short, col, align === '' ? 'left' : align);
      expect(one, `${col} ${align}`).toBeDefined();
      if (one === undefined) continue;
      const table = readTables(one, parse(one))[0]?.from ?? 0;
      for (const [who, row, at, text] of [
        ['bo', 1, 1, 'x'],
        ['bo', 1, 2, 'x'],
        ['ada', 1, 1, 'x'],
        ['plain', 1, 2, 'x'],
        ['bo', 1, 1, undefined],
        ['plain', 1, 2, undefined],
        ['bo', 2, 2, 'x'],
        ['plain', 2, 2, 'x'],
      ] as const) {
        const name = `align ${col} ${align}, then ${who} types ${JSON.stringify(text)} in cell ${at} of row ${row}`;
        const op: TableOp = { kind: 'fillCells', table, row, col: at, ...(text ? { text } : {}) };
        let two: string;
        try {
          const done =
            who === 'plain'
              ? untrackedTableEdit(one, op)
              : tableEdit(one, op, context(who === 'ada' ? ada : bo, SECOND_IDS));
          two = applyChanges(one, done.changes);
        } catch (error) {
          throw new Error(`${name}: ${String(error)}\n${one}`, { cause: error });
        }
        written++;
        // The pipes are written plain, in both versions (rule 7), so the original view has them: it is not the table
        // as it started, whoever typed.
        expectPairSound(name, two, short, 'plain');
        expect(expectEveryOrderRead(name, two), name).toEqual([]);
        // The row has its cells now, and the mark still ends the header.
        expect(readTables(two, parse(two))[0]?.rows[row]?.cells.length, name).toBeGreaterThan(at);
        expect(pendingPoint(two)?.ends, name).toBe(true);
      }
    }
    expect(written).toBe(24);
  }, 120_000);
});
