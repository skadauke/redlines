// A link's hover hint.

import { expect, test } from '../src/journey.ts';
import { contrastOf } from '../src/contrast.ts';

const DOC = 'See [the site](https://example.org) now.\n';

test.describe('links @links', () => {
  test('hovering a link shows a hint that says ⌘-click to open', async ({ start }) => {
    const j = await start({ doc: DOC, tracking: false, view: 'clean' });
    await j.hover('the site');
    const hint = j.page.locator('.rl-link-hint');
    await expect(hint).toBeVisible();
    await j.shot('link-hint');
    // On the first line of the page, the hint is on the screen and clear of the title bar.
    const box = await hint.boundingBox();
    expect(box && box.y, 'the hint is on the screen').toBeGreaterThanOrEqual(0);
    const bar = await j.page.locator('.rl-titlebar').first().boundingBox();
    if (box && bar)
      expect(box.y, 'the hint is below the title bar').toBeGreaterThanOrEqual(
        bar.y + bar.height - 1,
      );
    // ⌘ on a Mac (the editor says Ctrl elsewhere), which is where the journeys run.
    await expect(hint.locator('.rl-link-hint-do')).toHaveText('⌘-click to open');
    await expect(hint.locator('.rl-link-hint-address')).toHaveText('https://example.org');
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`the link hint's text has a contrast of 4.5:1, ${scheme}`, async ({ start }) => {
      const j = await start({ doc: DOC, tracking: false, view: 'clean', scheme });
      await j.hover('the site');
      const hint = j.page.locator('.rl-link-hint');
      await expect(hint).toBeVisible();
      await j.shot('link-hint-contrast');
      // It was white on CodeMirror's light gray (1.1:1).
      expect(
        await contrastOf(hint.locator('.rl-link-hint-do')),
        'the hint is readable',
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        await contrastOf(hint.locator('.rl-link-hint-address')),
        'the hint is readable',
      ).toBeGreaterThanOrEqual(4.5);
    });
  }
});
