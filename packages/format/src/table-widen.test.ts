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
import { fineTableEdit as tableEdit, tableEdit as widenedOrFine } from './table-ops.ts';
import type { TableOp } from './table-ops.ts';
import { fineFormat, trackedFormat, trackedFormatRanges } from './formatting.ts';
import { widenedTableEdit } from './table-widen.ts';
import { ada, bo, bodyOf, context, file } from './test-helpers.ts';
import { newestView } from './views.ts';
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

describe('Delete Table beside the blocks that the table stands in', () => {
  const TABLE = '| A | B |\n| - | - |\n| a1 | b1 |\n| a2 | b2 |';
  const SHAPES: Record<string, string> = {
    'the whole text': TABLE,
    'under a fence': `\`\`\`\ncode\n\`\`\`\n${TABLE}`,
    'under a rule': `---\n${TABLE}`,
    'under indented code': `    code\n${TABLE}`,
    'under a line of text': `Some text\n${TABLE}`,
    'under a line of text, with text after': `Some text\n${TABLE}\n\nAfter.`,
    'under a heading with closing #s': `# Heading ##\n${TABLE}`,
    'under a heading with attributes': `# Heading {#id}\n${TABLE}`,
    'over a heading with closing #s': `${TABLE}\n# Heading ##\n`,
    'over a code block': `${TABLE}\n\`\`\`\ncode\n\`\`\`\n`,
    'over indented code': `${TABLE}\n\n    indented`,
  };

  it('is written, never refused, and reads alike in every order of decisions', () => {
    for (const [name, body] of Object.entries(SHAPES)) {
      const variants: Record<string, string>[] = /^Some/.test(body) ? [{}, { w8nn: 'bo' }] : [{}];
      for (const marks of variants) {
        // With another person's change in the text above, which stays pending in the old text.
        const text = file(
          marks.w8nn === undefined
            ? body
            : body.replace('Some text', 'Some <!--ins w8nn-->text<!--/w8nn-->'),
          marks,
        );
        const table = readTables(text, parse(text))[0]?.from;
        if (table === undefined) continue;
        const done = widenedOrFine(
          text,
          { kind: 'deleteTable', table },
          context(ada, ['k3x9', 'r2zd']),
        );
        const after = applyChanges(text, done.changes);
        expectEveryOrderRead(name, after);
        const id = parse(after).marks.find((mark) => mark.entry.by === 'ada')?.id ?? '';
        expect(bodyOf(applyChanges(after, reject(after, id))).trim(), name).toBe(
          bodyOf(text).trim(),
        );
      }
    }
  });
});

describe("a widened format change in a cell, over another person's pending marks", () => {
  // #797's guard keeps a refusal where the old text of a widened edit holds another person's mark;
  // a table's cell is exempt from it (`widenedCellFormat`). Every order of decisions reads alike.
  const HEAD = '| A | B |\n| - | - |\n';
  const BODIES: Record<string, string> = {
    'an insertion in the cell': `${HEAD}| x <!--ins w8nn-->new<!--/w8nn--> y | b1 |\n| a2 | b2 |`,
    'a deletion in the cell': `${HEAD}| x <!--del w8nn-->old<!--/w8nn--> y | b1 |\n| a2 | b2 |`,
    'a deletion and an insertion in the cell': `${HEAD}| x <!--ins w8nn-->new<!--/w8nn--> <!--del x4pp-->old<!--/x4pp--> y | b1 |\n| a2 | b2 |`,
    'an inserted row': `${HEAD}| a1 | b1 |\n| <!--ins w8nn row--> a2 | b2 |`,
  };

  it('is written, reads alike in every order, and rejects back to the cell it was', () => {
    let widened = 0;
    for (const [name, body] of Object.entries(BODIES)) {
      const marks: Record<string, string> = body.includes('x4pp')
        ? { w8nn: 'bo', x4pp: 'bo' }
        : { w8nn: 'bo' };
      const text = file(body, marks);
      const read = readTables(text, parse(text))[0];
      const cells = read?.rows.flatMap((one, r) => one.cells.map((_, c) => [r, c] as const)) ?? [];
      for (const [row, cell] of cells) {
        const spot = read?.rows[row]?.cells[cell];
        if (!spot || spot.textFrom === spot.textTo) continue;
        for (const format of ['bold', 'italic', 'code'] as const) {
          const op = { kind: 'inline', format, on: true } as const;
          const range = { from: spot.textFrom, to: spot.textTo };
          try {
            fineFormat(text, range, op, context(ada, ['k3x9', 'm2np']));
            continue;
          } catch (error) {
            if (!(error instanceof EditError)) throw error;
          }
          let made;
          try {
            made = trackedFormat(text, range, op, context(ada, ['k3x9', 'm2np']));
          } catch (error) {
            if (error instanceof EditError) continue;
            throw error;
          }
          widened++;
          const after = applyChanges(text, made.changes);
          const label = `${name}, ${row},${cell}, ${format}`;
          expectEveryOrderRead(label, after);
          const id = made.markIds[0] ?? '';
          expect(bodyOf(applyChanges(after, reject(after, id))).trim(), label).toBe(
            bodyOf(text).trim(),
          );
        }
      }
    }
    expect(widened).toBeGreaterThan(0);
  });
});

describe('two ranges that lie in one mark (#1093)', () => {
  // The collab-sim replay turned bold off over three tokens of one nested file and got a RangeError
  // from `applyChanges`: both ranges planned the same edits, and they were written twice.
  const bodies = {
    "a person's own insertion": '<!--ins k3x9-->**one two three**<!--/k3x9--> end',
    'a bold run in a mark of another person': '<!--sub w8nn-->**one two three**<!--/w8nn--> end',
  };
  for (const [name, body] of Object.entries(bodies)) {
    it(`takes bold off over both, once, in ${name}`, () => {
      const text = file(body, { k3x9: 'ada', w8nn: 'bo' });
      const ranges = [
        { from: text.indexOf('one'), to: text.indexOf('one') + 3 },
        { from: text.indexOf('three'), to: text.indexOf('three') + 5 },
      ];
      const op = { kind: 'inline', format: 'bold', on: false } as const;
      const made = trackedFormatRanges(text, ranges, op, context(ada, ['m2np', 'q3rs', 'z4tt']));
      const after = applyChanges(text, made.changes);
      expect(newestView(after).text.trim(), name).toBe('one two three end');
      if (made.markIds.length > 0) expectEveryOrderRead(name, after);
    });
  }
});
