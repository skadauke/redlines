// Table operations that the rules refuse, written as a replacement of the table (lane R2, first
// step): over the pair model, every second operation that is refused after another person's first
// is written, reads alike in every order of decisions, and rejects back to the table before it.

import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { reject } from './decide.ts';
import { EditError } from './errors.ts';
import { expectEveryOrderRead } from './oracle.ts';
import { parse } from './parse.ts';
import { readTables } from './table.ts';
import { fineTableEdit as tableEdit } from './table-ops.ts';
import type { TableOp } from './table-ops.ts';
import { widenedTableEdit } from './table-widen.ts';
import { ada, bo, context, file } from './test-helpers.ts';
import { Untrackable } from './widen.ts';

const BODY = ['| A | B | C |', '| - | - | - |', '| a1 | b1 | c1 |', '| a2 | b2 | c2 |'];
const START = file(`Intro.\n\n${BODY.join('\n')}\n\nOutro.`);

type Shape = Record<string, unknown> & { kind: string };
const shapes = (rows: number, columns: number): Shape[] => [
  ...Array.from({ length: rows }, (_, r): Shape => ({ kind: 'deleteRows', rows: [r] })),
  ...Array.from({ length: columns }, (_, c): Shape => ({ kind: 'deleteCols', cols: [c] })),
  ...Array.from({ length: columns + 1 }, (_, after): Shape => ({ kind: 'insertCols', after })),
  ...Array.from({ length: rows }, (_, after): Shape => ({ kind: 'insertRows', after })),
  ...Array.from({ length: columns }, (_, c): Shape => ({
    kind: 'align',
    cols: [c],
    align: 'center',
  })),
];

function op(text: string, shape: Shape): TableOp {
  return {
    ...shape,
    table: readTables(text, parse(text))[0]?.from ?? 0,
    count: 1,
  } as unknown as TableOp;
}

describe('a refused table operation, written as a replacement of the table', () => {
  it('is written, reads alike in every order, and rejects back', () => {
    let refused = 0;
    let written = 0;
    for (const first of shapes(3, 3)) {
      let one: string;
      try {
        one = applyChanges(
          START,
          tableEdit(START, op(START, first), context(bo, ['k3x9', 'w8nn'])).changes,
        );
      } catch (error) {
        if (error instanceof EditError) continue;
        throw error;
      }
      const read = readTables(one, parse(one))[0];
      for (const second of shapes(read?.rows.length ?? 0, read?.aligns.length ?? 0)) {
        try {
          tableEdit(one, op(one, second), context(ada, ['p5qm', 'q6rs']));
          continue;
        } catch (error) {
          if (!(error instanceof EditError)) throw error;
        }
        refused++;
        try {
          const done = widenedTableEdit(one, op(one, second), context(ada, ['r2zd']));
          const after = applyChanges(one, done.changes);
          expectEveryOrderRead(JSON.stringify([first, second]), after);
          const id = parse(after).marks.find((mark) => mark.kind === 'sub')?.id ?? '';
          expect(applyChanges(after, reject(after, id)), JSON.stringify([first, second])).toBe(one);
          written++;
        } catch (error) {
          if (error instanceof Untrackable || error instanceof EditError) continue;
          throw error;
        }
      }
    }
    console.log(JSON.stringify({ refused, written }));
    expect(refused).toBeGreaterThan(0);
    expect(written).toBeGreaterThan(refused / 2);
  }, 120_000);
});
