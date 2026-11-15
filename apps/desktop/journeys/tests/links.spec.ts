// A link's hover hint.

import { expect, known, test } from '../src/journey.ts';
import { contrastOf } from '../src/contrast.ts';

const DOC = 'See [the site](https://example.org) now.\n';

test.describe('links @links', () => {
  test('hovering a link shows a hint that says ⌘-click to open', async ({ start }) => {
    const j = await start({ doc: DOC, tracking: false, view: 'clean' });
    await j.hover('the site');
    const hint = j.page.locator('.rl-link-hint');
    await expect(hint).toBeVisible();
    await j.shot('link-hint');
    // ⌘ on a Mac (the editor says Ctrl elsewhere), which is where the journeys run.
    await expect(hint.locator('.rl-link-hint-do')).toHaveText('⌘-click to open');
    await expect(hint.locator('.rl-link-hint-address')).toHaveText('https://example.org');
  });

  for (const scheme of ['light', 'dark'] as const) {
    known(
      533,
      `the link hint's text has a contrast of 4.5:1, ${scheme}`,
      /the hint is readable/,
      async ({ start }) => {
        const j = await start({ doc: DOC, tracking: false, view: 'clean', scheme });
        await j.hover('the site');
        const hint = j.page.locator('.rl-link-hint');
        await expect(hint).toBeVisible();
        await j.shot('link-hint-contrast');
        // Today it is white on a light gray (1.1:1).
        expect(
          await contrastOf(hint.locator('.rl-link-hint-do')),
          'the hint is readable',
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          await contrastOf(hint.locator('.rl-link-hint-address')),
          'the hint is readable',
        ).toBeGreaterThanOrEqual(4.5);
      },
    );
  }
});
