// The pair model for rows (format §3.7, rules 2 and 3): every pair of row operations by two people,
// at every place of a small table, the second tracked or plain. A pair that is allowed reads the same
// in every order of decisions, judged exactly, and a pair that is refused says why.
import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { acceptAll, rejectAll } from './decide.ts';
import { EditError } from './errors.ts';
import { parse } from './parse.ts';
import { tableEdit, untrackedTableEdit } from './table-ops.ts';
import type { TableOp } from './table-ops.ts';
import { readTables } from './table.ts';
import { bo, ada, context, expectEveryOrderAlike, file, exactly } from './test-helpers.ts';
import { newestView, originalView } from './views.ts';

const BODY = [
  '| A | B | C |',
  '| - | - | - |',
  '| a1 | b1 | c1 |',
  '| a2 | b2 | c2 |',
  '| a3 | b3 | c3 |',
];
const START = file(BODY.join('\n'));
const ROWS = 4;

type Shape =
  | { kind: 'insertRows'; after: number }
  | { kind: 'deleteRows'; rows: number[] }
  | { kind: 'moveRows'; rows: number[]; to: number };

function shapes(rows: number): Shape[] {
  const all: Shape[] = [];
  for (let after = -1; after < rows; after++) all.push({ kind: 'insertRows', after });
  for (let r = 0; r < rows; r++) all.push({ kind: 'deleteRows', rows: [r] });
  for (let r = 0; r < rows; r++) {
    for (let to = 0; to <= rows; to++) {
      if (to !== r && to !== r + 1) all.push({ kind: 'moveRows', rows: [r], to });
    }
  }
  return all;
}

const REFUSALS = [
  /^Delete the table instead\.$/,
  /pending change is in this row\. Decide it first\.$/,
  /row is pending\. Decide it first\.$/,
  /^Accept or reject the column changes in this table first\.$/,
  /^The rows are already there\.$/,
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

describe('the pair model for rows', () => {
  const grid = shapes(ROWS);
  for (const [secondBy, label] of [
    ['bo', 'a second person, tracked'],
    ['plain', 'a second person, Track Changes off'],
    ['ada', 'the same person'],
  ] as const) {
    it(`reads alike in every order: ${label}`, () => {
      let allowed = 0;
      for (const first of grid) {
        const one = run(START, first, 'ada', ['k3x9', 'w8nn', 'p5qm', 'q6rs']);
        if (one instanceof EditError) continue;
        const rows = readTables(one, parse(one))[0]?.rows.length ?? 0;
        for (const second of shapes(rows)) {
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
          expect(applyChanges(two, acceptAll(two)).replace(/\s+$/, ''), `${name}: accept all`).toBe(
            newestView(two).text.replace(/\s+$/, ''),
          );
          expect(applyChanges(two, rejectAll(two)).replace(/\s+$/, ''), `${name}: reject all`).toBe(
            originalView(two).text.replace(/\s+$/, ''),
          );
        }
      }
      expect(allowed).toBeGreaterThan(100);
    });
  }
});
