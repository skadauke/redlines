// Review Changes (#502, first part): it starts at once, on the document's first change or the first
// the selection touches, and marks the current change in the text and on its bar.

import { expect, test, type Journey } from '../src/journey.ts';

const DOC = [
  'Alpha beta gamma.',
  '',
  'Delta epsilon zeta.',
  '',
  'Eta theta iota.',
  '',
  'Kappa lambda mu.',
  '',
  'Nu xi omicron.',
  '',
].join('\n');

/** A document with a tracked insertion in each of its first four paragraphs, in Redlines. */
async function withChanges(start: (o: object) => Promise<Journey>) {
  const j = await start({ doc: DOC, tracking: true, view: 'redlines' });
  for (const [after, text] of [
    ['Alpha', ' one'],
    ['Delta', ' two'],
    ['Eta', ' three'],
    ['Kappa', ' four'],
  ] as const) {
    await j.caretAfter(after);
    await j.type(text);
  }
  return j;
}

/** Review Changes from the Review menu (the pen), as a person chooses it. */
async function reviewChanges(j: Journey) {
  await j.page.locator('.rl-control').last().hover();
  await j.page.getByRole('menuitem', { name: /Review changes/i }).click();
  await j.settle();
}

const count = (j: Journey) => j.page.locator('.rl-bar-count').textContent();

/** What is marked as the current change, in the text. */
const marked = (j: Journey) => j.page.locator('.rl-review-current').allTextContents();

/** The widths of the bars drawn, and which is current. */
const barWidths = (j: Journey) =>
  j.page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.rl-bar-seg')].map((s) => ({
      width: s.getBoundingClientRect().width,
      current: s.classList.contains('rl-bar-current'),
    })),
  );

test.describe('Review Changes starts at once @review', () => {
  test('with the caret in the middle, it goes to the first change and marks it', async ({
    start,
  }) => {
    const j = await withChanges(start);
    await j.caretAfter('theta');
    await j.shot('review-before');
    await reviewChanges(j);
    expect(await count(j)).toBe('Change 1 of 4');
    expect(await marked(j)).toEqual([' one']);
    const caret = await j.caret();
    expect(caret.anchor, 'nothing is selected').toBe(caret.head);
    expect(caret.lineText).toContain('Alpha');
    const bars = await barWidths(j);
    expect(bars.map((b) => b.current)).toEqual([true, false, false, false]);
    expect(bars[0]!.width, 'the current bar is wider').toBeGreaterThan(bars[1]!.width);
    await j.shot('review-first-change');
  });

  test('with a selection over the third change, it goes there and the selection goes', async ({
    start,
  }) => {
    const j = await withChanges(start);
    await j.place(await j.offsetAfter('Eta'), await j.offsetAfter('theta'));
    expect((await j.selectedText()).length).toBeGreaterThan(0);
    await reviewChanges(j);
    expect(await count(j)).toBe('Change 3 of 4');
    expect(await marked(j)).toEqual([' three']);
    const caret = await j.caret();
    expect(caret.anchor, 'the selection is gone').toBe(caret.head);
    expect(await j.page.evaluate(() => getSelection()?.toString())).toBe('');
    await j.shot('review-selection-third');
  });

  test('Next, Previous and close move the mark, then take it away', async ({ start }) => {
    const j = await withChanges(start);
    await reviewChanges(j);
    await j.page.getByRole('button', { name: 'Next change' }).click();
    expect(await count(j)).toBe('Change 2 of 4');
    expect(await marked(j)).toEqual([' two']);
    await j.shot('review-next');
    await j.page.getByRole('button', { name: 'Previous change' }).click();
    await j.page.getByRole('button', { name: 'Previous change' }).click();
    expect(await count(j)).toBe('Change 4 of 4');
    expect(await marked(j)).toEqual([' four']);
    await j.page.getByRole('button', { name: 'Close' }).click();
    await j.settle();
    expect(await marked(j)).toEqual([]);
    expect((await barWidths(j)).some((b) => b.current)).toBe(false);
    await j.shot('review-closed');
  });
});
