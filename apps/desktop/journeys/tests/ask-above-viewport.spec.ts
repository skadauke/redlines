// A selection that starts above the viewport (#384): where the Ask bubble goes, and whether the
// page jumps to it.

import { expect, test } from '../src/journey.ts';

test.describe('Ask, with the selection starting above the window', () => {
  test('puts the bubble in view and keeps the page where the person is reading', async ({
    start,
  }) => {
    const paragraphs = Array.from({ length: 90 }, (_, i) => `Paragraph ${i + 1} of the plan.`);
    const j = await start({ doc: `${paragraphs.join('\n\n')}\n`, tracking: false, view: 'clean' });
    const text = await j.text();
    // From the start of paragraph 3 to the end of paragraph 45: the caret, and the view, at the end.
    await j.place(text.indexOf('Paragraph 3 of'), text.indexOf('Paragraph 45 of') + 16);
    // The view follows the end of the selection, as it does for a person who dragged down.
    // Lines far down are drawn at estimated heights until they are measured, so the first scroll can
    // stop short (387 px on CI): scroll until the end of the selection is in the window.
    const end = j.page.getByText('Paragraph 45 of the plan.');
    await expect(async () => {
      await end.scrollIntoViewIfNeeded();
      await j.settle();
      const box = await end.boundingBox();
      expect(box, 'the end of the selection is drawn').not.toBeNull();
      expect(box!.y + box!.height, 'the end is below the top of the window').toBeGreaterThan(0);
      expect(box!.y, 'the end is above the bottom of the window').toBeLessThan(
        j.page.viewportSize()!.height,
      );
    }).toPass({ timeout: 10_000 });
    // The pane the text scrolls in: the nearest ancestor of the editor that scrolls.
    const scrolled = () =>
      j.page.evaluate(() => {
        for (
          let el = document.querySelector('.cm-editor')?.parentElement;
          el;
          el = el.parentElement
        ) {
          if (
            el.scrollHeight > el.clientHeight + 10 &&
            /auto|scroll/.test(getComputedStyle(el).overflowY)
          ) {
            return el.scrollTop;
          }
        }
        return -1;
      });
    const before = await scrolled();
    // The setup holds in any window size: the page is scrolled, and the selection's start is above
    // the top of the window (the line's place in the window, not a pixel count of the scroll).
    expect(before, 'the view is down the page').toBeGreaterThan(0);
    const startAbove = await j.page.evaluate((from) => {
      const { view } = window.__redlines!.editor;
      // No coordinates means the line is not drawn at all: far above the window.
      return view.coordsAtPos(from)?.bottom ?? -1;
    }, text.indexOf('Paragraph 3 of'));
    expect(startAbove, 'the selection starts above the window').toBeLessThan(0);
    await j.press('Alt+Meta+a');
    const bubble = j.page.locator('.rl-qa');
    await expect(bubble).toBeVisible();
    await j.settle();
    const box = await bubble.boundingBox();
    const view = j.page.viewportSize();
    expect(box, 'the bubble has a place').not.toBeNull();
    expect(box!.y + box!.height, 'the bubble is not above the window').toBeGreaterThan(0);
    expect(box!.y, 'the bubble is not below the window').toBeLessThan(view!.height);
    const after = await scrolled();
    expect(
      Math.abs(after - before),
      `the page did not jump (${before} -> ${after}, bubble at ${box!.y})`,
    ).toBeLessThan(400);
    await j.shot('ask-selection-above-viewport');
  });
});
