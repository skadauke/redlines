// An edit against an emphasis delimiter in a paragraph that holds another person's marks, written as
// a replacement of the paragraph where the fine form reads otherwise than the newest view in some
// order of decisions (#299, #265; format §3.12). micromark, with GFM, is the oracle.

import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { expectSound, readsAsNewest } from './oracle.ts';
import { ada, bodyOf, context, file } from './test-helpers.ts';
import { trackedEdits } from './track.ts';
import { newestView, originalView } from './views.ts';

/** `body` with Bo's marks (`k3x9`), and the edit of the source range `[from, to]` by `insert`. */
function type(body: string, from: number, to: number, insert: string) {
  const before = file(body, { k3x9: 'bo' });
  const changes = trackedEdits(
    before,
    [{ from, to, insert }],
    context(ada, ['m2bd', 'n8fx', 'p7qd']),
  ).changes;
  return { before, after: applyChanges(before, changes) };
}

function expectWhole(before: string, after: string, edited: string, label: string): void {
  expect(readsAsNewest(after), label).toBe(true);
  expect(newestView(after).text.replace(/\n+$/, ''), label).toBe(edited);
  expect(originalView(after).text, label).toBe(originalView(before).text);
  expectSound(label, after);
}

describe('typing over a delimiter of a pending bold (#299)', () => {
  const body = 'A <!--fmt k3x9 +bold-->**word**<!--/k3x9--> b.';
  const open = body.indexOf('**word');

  it('writes the paragraph as a replacement, where the fine form reads otherwise', () => {
    for (const [from, to, insert, edited] of [
      // The second `*` of the opener replaced, or deleted.
      [open + 1, open + 2, 'x', 'A *xword** b.'],
      [open + 1, open + 2, '', 'A *word** b.'],
      // The first `*` of the closer replaced, or deleted.
      [open + 6, open + 7, 'x', 'A **wordx* b.'],
    ] as const) {
      const label = JSON.stringify([from - open, to - open, insert]);
      const { before, after } = type(body, from, to, insert);
      expect(bodyOf(after), label).toMatch(/^<!--sub m2bd A /);
      expectWhole(before, after, edited, label);
    }
  });

  it('keeps the fine form where it reads alike', () => {
    const { before, after } = type(body, open, open + 1, 'x');
    expect(bodyOf(after)).toContain('<!--sub m2bd **w-->');
    expectWhole(before, after, 'A x*word** b.', 'the first `*`');
    // The first `*` of the closer deleted: the change takes the letter in front of it, so the run it
    // leaves closes the bold as the views read it, in every order (since #896's flanking rules).
    const closer = type(body, open + 6, open + 7, '');
    expect(bodyOf(closer.after)).toContain('<!--sub m2bd d**-->d*<!--/m2bd-->');
    expectWhole(
      closer.before,
      closer.after,
      'A **word* b.',
      'the first `*` of the closer, deleted',
    );
  });
});

describe("a delimiter run pasted next to another person's pending split or deletion (#265)", () => {
  it('is written as a replacement of the blocks that hold their split', () => {
    const body = 'Start *one <!--split k3x9-->\n\ntwo* End';
    const at = body.indexOf('<!--split');
    const { before, after } = type(body, at, at, '***_');
    expect(bodyOf(after)).toMatch(/^<!--sub m2bd Start \*one <!-\\-split k3x9-\\->/);
    expectWhole(before, after, 'Start *one ***_\n\ntwo* End', 'a split');
  });
});

describe("a delimiter typed after a letter, beside another person's pending bold (#265)", () => {
  it('is written as a replacement of the paragraph, never over the text of their format change', () => {
    const body = 'x ca<!--fmt k3x9 +bold-->**f**<!--/k3x9-->é';
    const at = body.length;
    for (const [insert, edited] of [
      ['_', 'x ca**f**é_'],
      ['**', 'x ca**f**é**'],
      ['*', 'x ca**f**é*'],
      ['~~', 'x ca**f**é~~'],
    ] as const) {
      const { before, after } = type(`${body}z`, at, at, insert);
      expect(bodyOf(after), insert).toMatch(/^<!--sub m2bd x ca<!-\\-fmt k3x9 \+bold-\\->/);
      expectWhole(before, after, `${edited}z`, insert);
    }
  }, 60_000);
});
