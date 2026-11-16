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

test.describe('Review Changes starts at once @views', () => {
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

const panel = (j: Journey) => j.page.locator('.rl-review-panel');

/** The panel's box and the box of what is marked as the current change, in the window. */
const boxes = (j: Journey) =>
  j.page.evaluate(() => {
    const rect = (el: Element | null) => {
      const r = el?.getBoundingClientRect();
      return r ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null;
    };
    const marks = [...document.querySelectorAll('.rl-review-current')].map(rect);
    return {
      panel: rect(document.querySelector('.rl-review-panel')),
      change: marks[0] ?? null,
      window: { width: innerWidth, height: innerHeight },
      focus: document.activeElement?.className ?? '',
    };
  });

const overlap = (
  a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number },
) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

test.describe('the Review Changes panel @views', () => {
  test('sits beside the change, never over it, and inside the window', async ({ start }) => {
    const j = await withChanges(start);
    for (const after of ['Alpha', 'Eta', 'Kappa']) {
      await j.caretAfter(after);
      await j.page.keyboard.press('ControlOrMeta+Alt+]');
      await reviewChanges(j);
      const { panel: p, change, window: w } = await boxes(j);
      expect(p, 'the panel is drawn').not.toBeNull();
      expect(change, 'the change is marked').not.toBeNull();
      expect(overlap(p!, change!), `the panel covers the change after ${after}`).toBe(false);
      expect(p!.left).toBeGreaterThanOrEqual(0);
      expect(p!.right).toBeLessThanOrEqual(w.width);
      expect(p!.top).toBeGreaterThanOrEqual(0);
      expect(p!.bottom).toBeLessThanOrEqual(w.height);
      await j.page.keyboard.press('Escape');
    }
    await reviewChanges(j);
    await j.shot('review-panel-first');
  });

  test('its buttons sit on two aligned rows, never wrapping (#665)', async ({ start }) => {
    const j = await withChanges(start);
    await reviewChanges(j);
    const rows = await j.page.evaluate(() => {
      const box = (selector: string) => {
        const r = document.querySelector(selector)!.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      };
      return {
        panel: box('.rl-review-panel'),
        accept: box('.rl-rp-actions button:nth-child(1)'),
        reject: box('.rl-rp-actions button:nth-child(2)'),
        comment: box('.rl-rp-actions button:nth-child(3)'),
        previous: box('.rl-rp-nav button:nth-child(1)'),
        next: box('.rl-rp-nav button:nth-child(2)'),
      };
    });
    await j.shot('review-panel-rows');
    expect(rows.reject.top, 'Accept, Reject and Comment share a line').toBe(rows.accept.top);
    expect(rows.comment.top).toBe(rows.accept.top);
    expect(rows.next.top, 'Previous and Next share the next').toBe(rows.previous.top);
    expect(rows.previous.top).toBeGreaterThan(rows.accept.bottom);
    expect(rows.previous.left, 'Previous is under Accept').toBe(rows.accept.left);
    expect(rows.next.right, 'Next is under Comment').toBe(rows.comment.right);
    expect(rows.comment.right).toBeLessThanOrEqual(rows.panel.right);
  });

  test('takes the keyboard, and A, R, C and the arrows do the review', async ({ start }) => {
    const j = await withChanges(start);
    await reviewChanges(j);
    expect((await boxes(j)).focus, 'the panel has the keyboard').toContain('rl-review-panel');
    expect(await count(j)).toBe('Change 1 of 4');
    await j.press('ArrowRight');
    expect(await count(j)).toBe('Change 2 of 4');
    await j.press('ArrowLeft');
    await j.press('ArrowRight');
    // A accepts the second and moves on to the third.
    await j.press('a');
    expect(await count(j)).toBe('Change 2 of 3');
    expect(await j.text()).toContain('Delta two epsilon');
    expect((await boxes(j)).focus, 'the keyboard is on the panel after a change').toContain(
      'rl-review-panel',
    );
    // R rejects the third: its words go.
    await j.press('r');
    expect(await j.text()).not.toContain('three');
    expect(await count(j)).toBe('Change 2 of 2');
    // C opens the field, and typing in it is typing.
    await j.press('c');
    await j.type('Why four? and a r');
    await j.shot('review-panel-comment');
    await j.press('Enter');
    expect(await j.text()).toContain('Why four? and a r');
    expect(await j.text(), 'the change itself is still pending').toContain('<!--ins');
    await j.press('Escape');
    await expect(panel(j)).toHaveCount(0);
  });

  test('the Comment button asks about the change, and the last decision says there are no more', async ({
    start,
  }) => {
    const j = await withChanges(start);
    await reviewChanges(j);
    await panel(j).getByRole('button', { name: 'Comment' }).click();
    await panel(j).locator('textarea').fill('Is this needed?');
    await panel(j).getByRole('button', { name: 'Comment' }).click();
    expect(await j.text()).toContain('Is this needed?');
    for (let i = 0; i < 4; i++) await j.press('a');
    await expect(panel(j)).toContainText('No more changes to review.');
    await j.shot('review-panel-done');
    await panel(j).getByRole('button', { name: 'Done' }).click();
    await expect(panel(j)).toHaveCount(0);
  });

  test('is dragged by its title and stays where it was put', async ({ start }) => {
    const j = await withChanges(start);
    await reviewChanges(j);
    const before = (await boxes(j)).panel!;
    const title = panel(j).locator('.rl-rp-title');
    const at = (await title.boundingBox())!;
    await j.drag({ x: at.x + 10, y: at.y + 8 }, { x: at.x - 90, y: at.y + 148 });
    const after = (await boxes(j)).panel!;
    expect(Math.round(after.left - before.left)).toBe(-100);
    expect(Math.round(after.top - before.top)).toBe(140);
    await j.press('ArrowRight');
    const next = (await boxes(j)).panel!;
    expect(next.left, 'it stays where it was put').toBeCloseTo(after.left, 0);
    expect(next.top).toBeCloseTo(after.top, 0);
    await j.shot('review-panel-dragged');
  });

  test('a click into the document gives the keyboard back to the document', async ({ start }) => {
    const j = await withChanges(start);
    await reviewChanges(j);
    await j.click('Nu xi');
    await j.press('a');
    expect(await j.text(), 'typing is typing: A is a letter in the document').toMatch(
      /\n\s*a<!--\/\w+-->Nu xi/,
    );
    await expect(panel(j), 'the panel stays open').toHaveCount(1);
  });
});
