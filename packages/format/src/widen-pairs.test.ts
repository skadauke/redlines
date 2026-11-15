// The pair model, widened (format §3.12; design §2.6): every first operation of Ada's on a small
// table (insert, delete or move a row or a column, align), then every second of Bo's, so that the
// table holds two people's pending changes; then Ada rewrites the whole table as another shape.
// The replacement of the table keeps Bo's changes in its old text (Ada's own fold into it). For
// every table the file reads as its newest view in micromark, rejecting the replacement gives the
// table back, accepting it gives the new table, and deciding any mark in the old text decides it
// there as it would be decided in the file.

import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { accept, reject, rejectMarks } from './decide.ts';
import { EditError } from './errors.ts';
import { expectEveryOrderRead } from './oracle.ts';
import { parse } from './parse.ts';
import { payloadMarksOf } from './payload-marks.ts';
import { tableEdit } from './table-ops.ts';
import type { TableOp } from './table-ops.ts';
import { readTables } from './table.ts';
import { ada, bo, bodyOf, context, file } from './test-helpers.ts';
import { newestView, originalView } from './views.ts';
import { widen } from './widen.ts';

const BODY = [
  '| A | B | C |',
  '| - | - | - |',
  '| a1 | b1 | c1 |',
  '| a2 | b2 | c2 |',
  '| a3 | b3 | c3 |',
];
const START = file(`Intro.\n\n${BODY.join('\n')}\n\nOutro.`);
const NEW = ['| A | B |', '| - | - |', '| z | y |'].join('\n');

type Shape = Record<string, unknown> & { kind: string };

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
    for (const align of ['center', 'right'] as const) all.push({ kind: 'align', cols: [c], align });
  }
  return all;
}

const IDS = ['k3x9', 'w8nn', 'p5qm', 'q6rs'];
const MORE = ['c2dd', 'f3gg', 'h4jj', 'm5nn'];

function run(text: string, shape: Shape, who: 'ada' | 'bo', ids: string[]): string | null {
  const table = readTables(text, parse(text))[0]?.from ?? 0;
  try {
    const done = tableEdit(
      text,
      { ...shape, table, count: 1 } as unknown as TableOp,
      context(who === 'ada' ? ada : bo, ids),
    );
    return applyChanges(text, done.changes);
  } catch (error) {
    if (error instanceof EditError) return null;
    throw error;
  }
}

describe('Ada rewrites a table that two people changed', () => {
  it('keeps Bo’s changes in the old text, and reads alike in every order', () => {
    const documents: string[] = [];
    for (const first of shapes(4, 3)) {
      const one = run(START, first, 'ada', IDS);
      if (!one) continue;
      documents.push(one);
      const read = readTables(one, parse(one))[0];
      for (const second of shapes(read?.rows.length ?? 0, read?.aligns.length ?? 0)) {
        const two = run(one, second, 'bo', MORE);
        if (two) documents.push(two);
      }
    }
    // Every table in a default run, a third of them when the run is short.
    const every = process.env['REDLINES_PAIRS'] === 'all' ? 1 : 3;
    const stats = { tables: 0, written: 0, untrackable: 0, nested: 0 };
    for (const [index, text] of documents.entries()) {
      if (index % every !== 0) continue;
      stats.tables++;
      const view = newestView(text).text;
      const from = view.indexOf('|');
      const to = view.indexOf('\n\nOutro.');
      if (from < 0 || to < 0) continue;
      const label = `table ${index}`;
      let done;
      try {
        done = widen(text, [{ from, to, insert: NEW }], context(ada, ['r2zd']));
      } catch (error) {
        if (error instanceof Error && error.name === 'Untrackable') {
          stats.untrackable++;
          continue;
        }
        throw error;
      }
      stats.written++;
      expect(done.unit.kind, label).toBe('table');
      const after = done.text;
      expect(parse(after).warnings, label).toEqual([]);
      expect(newestView(after).text.replace(/\n+$/, ''), label).toBe(`Intro.\n\n${NEW}\n\nOutro.`);
      expect(originalView(after).text, label).toBe(originalView(text).text);
      // Ada's own changes fold into the replacement: rejecting it gives the table without them.
      const base =
        done.folded.length === 0 ? text : applyChanges(text, rejectMarks(text, done.folded));
      expect(applyChanges(after, reject(after, done.id)), label).toBe(base);
      const accepted = applyChanges(after, accept(after, done.id));
      expect(bodyOf(accepted).replace(/\n+$/, ''), label).toBe(`Intro.\n\n${NEW}\n\nOutro.`);
      // Deciding a mark in the old text decides it there, as it is decided in the file.
      const rejected = applyChanges(after, reject(after, done.id));
      for (const { mark } of payloadMarksOf(parse(after))) {
        if (mark.kind === 'cmt' || mark.kind === 'hl') continue;
        stats.nested++;
        for (const how of [accept, reject]) {
          const attempt = (go: () => string): string | null => {
            try {
              return go();
            } catch (error) {
              if (error instanceof EditError) return null;
              throw error;
            }
          };
          const through = attempt(() => {
            const inside = applyChanges(after, how(after, mark.id));
            return applyChanges(inside, reject(inside, done.id));
          });
          const direct = attempt(() => applyChanges(rejected, how(rejected, mark.id)));
          if (through !== null && direct !== null) {
            expect(through.replace(/\s+$/gm, ''), `${label}: ${how.name} ${mark.id}`).toBe(
              direct.replace(/\s+$/gm, ''),
            );
          }
        }
      }
      expectEveryOrderRead(label, after);
    }
    console.log(JSON.stringify({ documents: documents.length, ...stats }));
    // Most of the tables can be written as a replacement.
    expect(stats.written).toBeGreaterThan(stats.tables / 2);
  }, 180_000);
});
