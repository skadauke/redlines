import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { addComment } from './comments.ts';
import { EditError } from './errors.ts';
import { parse } from './parse.ts';
import { readTables } from './table.ts';
import { tableEdit } from './table-ops.ts';
import type { TableOp } from './table-ops.ts';
import {
  ada,
  bo,
  context,
  exactly,
  expectEveryOrderAlike,
  expectNoDecisionRefused,
  file,
} from './test-helpers.ts';

const FRUIT =
  '| Fruit  | Count |\n| ------ | ----- |\n| Apples | 3     |\n| Pears  | 5     |\n| Plums  | 7     |';
const BARE = 'Fruit | Count\n----- | -----\nApples | 3\nPears | 5\nPlums | 7';

/** The table of `text` after `op`, by ada. */
function edited(text: string, op: (table: number) => TableOp): string {
  const start = readTables(text, parse(text))[0]?.from ?? 0;
  return applyChanges(text, tableEdit(text, op(start), context(ada, ['m2bd', 'n3cd'])).changes);
}

const insert = (t: number): TableOp => ({
  kind: 'insertRows',
  table: t,
  after: 2,
  count: 1,
  texts: [['Kiwis', '9']],
});

describe('a comment in front of the mark of a pending row', { timeout: 60_000 }, () => {
  for (const [name, table] of [
    ['with outer pipes', FRUIT],
    ['without outer pipes', BARE],
  ] as const) {
    const base = file(`Intro words.\n\n${table}\n\nOutro words.`);
    const states: [string, string][] = [
      ['an inserted row', edited(base, insert)],
      ['a moved row', edited(base, (t) => ({ kind: 'moveRows', table: t, rows: [3], to: 0 }))],
    ];
    for (const [what, text] of states) {
      it(`leaves ${what} decidable at every offset of its start, ${name}`, () => {
        const row = readTables(text, parse(text))[0]?.rows.find((r) => r.insertion);
        const mark = row?.insertion?.segments[0]?.open;
        if (!row || !mark) throw new Error('no pending row');
        const textStart = mark.to + 1;
        let made = 0;
        for (let at = row.from; at <= textStart + 2; at++) {
          for (const range of [
            { from: at, to: at },
            { from: at, to: textStart + 4 },
          ]) {
            const label = `${what} ${name} ${JSON.stringify(range)}`;
            let changes;
            try {
              ({ changes } = addComment(text, range, 'Hm', context(bo, ['c9qf'])));
            } catch (error) {
              // The very start of a line of a table has no place for a marker, in any row.
              if (error instanceof EditError && at === row.from) continue;
              throw error;
            }
            const result = applyChanges(text, changes);
            made++;
            expect(expectNoDecisionRefused(label, result), label).toBeGreaterThan(0);
            expectEveryOrderAlike(label, result);
            expectEveryOrderAlike(`${label} exactly`, result, exactly);
          }
        }
        expect(made).toBeGreaterThan(4);
      });
    }
  }

  it('moves a point comment in front of the mark past it and its space', () => {
    const text = edited(file(`${FRUIT}\n`), insert);
    const mark = text.indexOf('<!--ins m2bd row-->');
    const { changes } = addComment(text, { from: mark, to: mark }, 'Hm', context(bo, ['c9qf']));
    expect(applyChanges(text, changes)).toContain('<!--ins m2bd row--> <!--cmt c9qf-->Kiwis');
  });
});
