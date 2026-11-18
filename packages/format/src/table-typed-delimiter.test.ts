// A delimiter typed in a table's cell, away from the delimiters that are there, pairs with a run beside another
// person's marker: the cell's table is replaced, as a paragraph is, and the file reads as its view (#490, #265).

import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { expectEveryOrderRead, readsAsNewest } from './oracle.ts';
import { ada, context, file } from './test-helpers.ts';
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
