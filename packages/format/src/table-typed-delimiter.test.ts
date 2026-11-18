// A delimiter typed in a table's cell, away from the delimiters that are there, pairs with a run beside a marker of
// another person's: the cell's table is replaced, as a paragraph is, and the file reads as its view (#490, #265).

import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { addComment } from './comments.ts';
import { expectEveryOrderRead, readsAsNewest } from './oracle.ts';
import { ada, bo, context, file } from './test-helpers.ts';
import { marksOfTablesAt } from './table-settle.ts';
import { trackedEdit } from './track.ts';

const ids = ['g9hj', 'k3x9'];
const rest = '  |  *b*  |\n| --- | --- |\n|  alpha  |  x y  |';

describe('a delimiter typed in a cell beside another person’s change', () => {
  const bold = file(`|  ca<!--fmt n3pq +bold-->**f**<!--/n3pq-->é${rest}`, { n3pq: 'bo' });
  const inserted = file(`|  a<!--ins n3pq -->*f*<!--/n3pq-->é${rest}`, { n3pq: 'bo' });

  const typed = (text: string, from: number, to: number, insert: string) => {
    const after = applyChanges(text, trackedEdit(text, { from, to, insert }, context(ada, ids)));
    expect(readsAsNewest(after)).toBe(true);
    expectEveryOrderRead('typed', after);
  };

  it('`**` before a word that holds a pending bold', () => {
    typed(bold, 3, 3, '**');
    typed(bold, 2, 3, '**');
  }, 60_000);

  it('`*` before a pending insertion of an italic', () => {
    typed(inserted, 2, 3, '*');
    typed(inserted, 3, 3, '*');
  }, 60_000);
});

describe('a backslash at the end of a row, and a comment inside another person’s replacement of the table', () => {
  it('writes a space typed after a trailing backslash so that it reads alike', () => {
    // `REDLINES_FUZZ=300 REDLINES_SEED=45` of the alignment suite: the backslash and the line break read as a hard break
    // in the file, and as text in the view, once a marker stands between them.
    const text = file(
      'Intro words.\r\n\r\nalpha|b|b\\\r\n ----- | :-: | ----- \r\n11||café\r\nx|x y|x\r\n\r\nOutro words.',
      {},
    );
    const at = text.indexOf('b\\\r') + 2;
    const after = applyChanges(
      text,
      trackedEdit(text, { from: at, to: at, insert: ' ' }, context(bo, ['m5nn', 'g9hj'])),
    );
    expect(readsAsNewest(after)).toBe(true);
    expectEveryOrderRead('space', after);
  }, 60_000);

  it('places a comment next to an inner `*` of a replaced table so that it reads alike', () => {
    // The replacement of the whole table is the only change that covers the comment: no mark stands inside the table.
    // A comment's marker right after the `*` between two letters makes the run no opener once the replacement is
    // accepted, so the comment's start moves (seed 54 of the alignment suite is the same shape).
    const text = file(
      'Intro words.\n\n<!--sub h4jj \\| a \\|\\n\\| :-: \\|\\n\\| b \\|\\n-->\n\n| a*b*c |\n| --: |\n| b |\n<!--/h4jj-->\nOutro words.',
      { h4jj: 'bo' },
    );
    const from = text.indexOf('b*c');
    const to = from + 3;
    expect([...marksOfTablesAt(text, { from, to })]).toEqual(['h4jj']);
    const { changes } = addComment(text, { from, to }, 'A note.', context(ada, ['f3gg']));
    const commented = applyChanges(text, changes);
    expect(readsAsNewest(commented)).toBe(true);
    expectEveryOrderRead('commented', commented);
  }, 60_000);
});
