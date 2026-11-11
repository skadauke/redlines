// The pair model (format §3.7, rules 2 and 3): every pair of operations on rows and columns by two
// people, at every place of a small table, the second tracked or plain. A pair that is allowed reads
// the same in every order of decisions, judged exactly, and a pair that is refused says why.
import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { acceptAll, rejectAll } from './decide.ts';
import { EditError } from './errors.ts';
import { parse } from './parse.ts';
import { tableEdit, untrackedTableEdit } from './table-ops.ts';
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
  file,
  exactly,
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
  | { kind: 'align'; cols: number[]; align: TableAlign };

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
  return all;
}

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

describe('the pair model for rows and columns', () => {
  const grid = shapes(ROWS, COLUMNS);
  for (const [secondBy, label] of [
    ['bo', 'a second person, tracked'],
    ['plain', 'a second person, Track Changes off'],
    ['ada', 'the same person'],
  ] as const) {
    for (const [from, where] of [
      [START, 'a table with no alignment'],
      [COLON, 'a table whose columns have one'],
    ] as const) {
      it(`reads alike in every order: ${label}, from ${where}`, () => {
        let allowed = 0;
        for (const first of grid) {
          const one = run(from, first, 'ada', ['k3x9', 'w8nn', 'p5qm', 'q6rs']);
          if (one instanceof EditError) continue;
          const read = readTables(one, parse(one))[0];
          const rows = read?.rows.length ?? 0;
          for (const second of shapes(rows, read?.aligns.length ?? 0)) {
            const name = `${JSON.stringify(first)} then ${JSON.stringify(second)}`;
            const two = run(one, second, secondBy, ['c2dd', 'f3gg', 'h4jj', 'm5nn']);
            if (two instanceof EditError) {
              expect(
                REFUSALS.some((r) => r.test(two.message)),
                `${name}: ${two.message}`,
              ).toBe(true);
              continue;
            }
            allowed++;
            expectEveryOrderAlike(name, two, exactly);
            expectNoDecisionRefused(name, two);
            const all = (decide: (text: string) => TextChange[]) => {
              try {
                return applyChanges(two, decide(two)).replace(/\s+$/, '');
              } catch (error) {
                throw new Error(`${name}: ${String(error)}\n${two}`, { cause: error });
              }
            };
            expect(all(acceptAll), `${name}: accept all`).toBe(
              newestView(two).text.replace(/\s+$/, ''),
            );
            expect(all(rejectAll), `${name}: reject all`).toBe(
              originalView(two).text.replace(/\s+$/, ''),
            );
            // Every change tracked: the original view is the table it started as, alignment included, and
            // the newest view's table is as wide as its header.
            if (secondBy !== 'plain') {
              expect(originalView(two).text.replace(/\s+$/, ''), `${name}: the original`).toBe(
                bodyOf(from).replace(/\s+$/, ''),
              );
            }
          }
        }
        expect(allowed).toBeGreaterThan(100);
        // Every pair at every place, decided in every order: a few seconds here, more on a busy runner.
      }, 120_000);
    }
  }
});
