// A comment or a typed key in a table's cell, next to the delimiters of another person's pending bold: every order of
// decisions reads alike (micromark), as it does in a paragraph (#490, #265). The comment's ends stand where the run
// is not cut, and a typed `*` is written as a replacement of the cell.

import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { addComment } from './comments.ts';
import { addHighlight } from './highlights.ts';
import { expectEveryOrderRead, readsAsNewest } from './oracle.ts';
import { ada, bo, context, file } from './test-helpers.ts';
import { trackedEdit } from './track.ts';
import { newestView } from './views.ts';

describe('a table cell next to another person’s pending bold (#490)', () => {
  const bold = file(
    '|  ca<!--fmt n3pq +bold-->**f**<!--/n3pq-->é  |\n| --- |\n|  alpha  |\n|  café  |',
    { n3pq: 'bo' },
  );

  it('keeps a comment over the text of the bold from cutting its opening run', () => {
    // The comment starts at the `f`, after the bold's `**`: its marker there makes the run no opener once the bold
    // is accepted, and Markdown then shows `ca**f**é`.
    const from = bold.indexOf('f**<!--/n3pq');
    const to = bold.indexOf('é') + 1;
    const { changes } = addComment(bold, { from, to }, 'A note.', context(ada, ['f3gg']));
    const after = applyChanges(bold, changes);
    expect(readsAsNewest(after)).toBe(true);
    expectEveryOrderRead('comment', after);
  }, 60_000);

  it('does the same for a highlight', () => {
    const from = bold.indexOf('f**<!--/n3pq');
    const to = bold.indexOf('é') + 1;
    const { changes } = addHighlight(bold, { from, to }, context(ada, ['f3gg']));
    const after = applyChanges(bold, changes);
    expect(readsAsNewest(after)).toBe(true);
    expectEveryOrderRead('highlight', after);
  }, 60_000);

  it('writes a `*` typed after the closing `*` of a cell with an alignment change as the cell’s replacement', () => {
    const text = file(
      '|  café  |  *b*<!--fmt t5vw align=\\|\\x20-\\-:\\x20\\|\\x20-\\-\\-\\x20\\|-->  |\n| --: | :-: |\n|  café  |  11  |\n|  x y  |  café  |',
      { t5vw: 'bo' },
    );
    const at = text.indexOf('*<!--fmt') + 1;
    const after = applyChanges(
      text,
      trackedEdit(text, { from: at, to: at, insert: '*' }, context(bo, ['g9hj', 'k3x9'])),
    );
    expect(newestView(after).text).toContain('*b**');
    expect(readsAsNewest(after)).toBe(true);
    expectEveryOrderRead('typed', after);
  }, 60_000);
});
