// Regression tests for format issues that the widening superseded (Epic #537, lane FX, slice 3):
// each was a refusal or a wrong write when it was filed (#448, #470, #478), and is now a fine write
// or a replacement of its unit, read alike in every order of decisions and decidable in each.

import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { rejectAll } from './decide.ts';
import { addHighlight } from './highlights.ts';
import { expectEveryOrderRead } from './oracle.ts';
import { parse } from './parse.ts';
import { readTables } from './table.ts';
import { tableEdit } from './table-ops.ts';
import type { TableOp } from './table-ops.ts';
import { ada, bo, bodyOf, context, expectNoDecisionRefused, file } from './test-helpers.ts';
import { trackedEdit, trackedEdits } from './track.ts';
import type { TextChange } from './types.ts';

const IDS = ['m1aa', 'm2bb', 'm3cc', 'm4dd', 'm5ee', 'm6ff', 'm7gg', 'm8hh'];
const at = (text: string, find: string, offset = 0) => text.indexOf(find) + offset;

describe('#448: an edit in the blank line of a break in a quote is written, not refused', () => {
  const quote = file('> a\n>\n> b');
  const blank = at(quote, '>\n> b');
  for (const insert of ['> ', 'x', '-', '# ']) {
    it(`replacing the blank line's > with ${JSON.stringify(insert)} reads alike in every order`, () => {
      const edit: TextChange = { from: blank, to: blank + 1, insert };
      const after = applyChanges(quote, trackedEdit(quote, edit, context(ada, IDS)));
      expectEveryOrderRead('448', after);
      // Rejecting what was written gives the quote back.
      expect(bodyOf(applyChanges(after, rejectAll(after))).trim()).toBe(bodyOf(quote).trim());
    });
  }

  it('two edits at once, in the blank line and in the next paragraph, are one replacement', () => {
    const edits: TextChange[] = [
      { from: blank, to: blank + 1, insert: '> ' },
      { from: blank + 2, to: blank + 4, insert: 'z' },
    ];
    const after = applyChanges(quote, trackedEdits(quote, edits, context(ada, IDS)).changes);
    expectEveryOrderRead('448 two', after);
  });

  it('no decision is refused next to an empty item with a pending split of the author', () => {
    expectNoDecisionRefused('448 split', file('> - a<!--split k3x9-->\n> - ', { k3x9: 'ada' }));
  });

  it('no decision is refused next to a pending change of another person', () => {
    expectNoDecisionRefused(
      '448 bold',
      file('> a <!--fmt k3x9 +bold-->**b**<!--/k3x9-->\n>\n> c<!--split m5nn-->\n> - ', {
        k3x9: 'bo',
        m5nn: 'ada',
      }),
    );
  });
});

function tableOp(text: string, op: Record<string, unknown>): TableOp {
  return { ...op, table: readTables(text, parse(text))[0]?.from ?? 0 } as unknown as TableOp;
}

describe('#470: Delete Table on a file that is only a table, and text typed near its marker', () => {
  const TABLE = '| Fruit | Count |\n| ----- | ----- |\n| Pears | 5     |';
  const cases: [string, string][] = [
    ['a lone table', TABLE],
    ['a lone table under front matter', `---\ntitle: T\n---\n\n${TABLE}`],
  ];
  for (const [name, body] of cases) {
    const start = file(body);
    const deleted = applyChanges(
      start,
      tableEdit(start, tableOp(start, { kind: 'deleteTable' }), context(ada, IDS)).changes,
    );
    const marker = at(deleted, '<!--del');
    const after = marker + deleted.slice(marker).indexOf('-->') + 3;
    const spots: [string, number][] = [
      ['above the marker', marker],
      ['right after the marker', after],
    ];
    for (const [where, position] of spots) {
      it(`${name}: typing ${where} reads alike in every order, and rejecting it all gives the table back`, () => {
        const typed = applyChanges(
          deleted,
          trackedEdit(
            deleted,
            { from: position, to: position, insert: 'x' },
            context(bo, IDS.slice(4)),
          ),
        );
        expectEveryOrderRead(`470 ${name} ${where}`, typed);
        const undone = applyChanges(typed, rejectAll(typed));
        expect(bodyOf(undone).trim()).toBe(body.trim());
        // The table is a table in the file where the typing is rejected and the deletion accepted too.
        expectNoDecisionRefused(`470 ${name} ${where}`, typed);
      });
    }
  }
});

describe('#478: a row move that reverses a highlight across rows is written, as a replacement of the table', () => {
  const plain = file('| a | b |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |\n| 5 | 6 |');
  const lit = applyChanges(
    plain,
    addHighlight(plain, { from: at(plain, '2'), to: at(plain, '3') + 1 }, context(bo, IDS)).changes,
  );

  for (const [name, op] of [
    ['row 2 up above the highlight', { kind: 'moveRows', rows: [2], to: 1 }],
    ['row 3 to the top of the body', { kind: 'moveRows', rows: [3], to: 1 }],
    ['row 2 to the end', { kind: 'moveRows', rows: [2], to: 4 }],
  ] as const) {
    it(`${name}: written, read alike in every order, and rejected back to the table before`, () => {
      const edit = tableEdit(lit, tableOp(lit, op), context(ada, IDS.slice(3)));
      const after = applyChanges(lit, edit.changes);
      expectEveryOrderRead(`478 ${name}`, after);
      expect(bodyOf(applyChanges(after, rejectAll(after))).trim()).toBe(bodyOf(lit).trim());
    });
  }
});
