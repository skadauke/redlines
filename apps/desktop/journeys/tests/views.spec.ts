// The eye's menu: the views, and what it says about a file with no changes.

import { expect, known, test, type Journey } from '../src/journey.ts';
import { isOpaque } from '../src/contrast.ts';

/**
 * Opens the eye's menu, which opens on hover after a short pause, and returns its items by their
 * label (the text before the shortcut).
 */
async function openEye(j: Journey) {
  await j.page.getByRole('button', { name: 'View' }).hover();
  const items = j.page.locator('.rl-menu-item').filter({ visible: true });
  await expect(items.first()).toBeVisible();
  return {
    items,
    item: (label: string) => items.filter({ hasText: new RegExp(`^${label}`) }),
  };
}

test.describe('the eye @views', () => {
  test('the eye opens a menu of views, and it is opaque @smoke', async ({ start }) => {
    const j = await start({ doc: 'Hello\n', tracking: false });
    const eye = await openEye(j);
    await j.shot('eye-menu');
    for (const label of ['Clean', 'Redlines', 'Raw']) await expect(eye.item(label)).toHaveCount(1);
    expect(await isOpaque(j.page.locator('.rl-menu-item').first().locator('..'))).toBe(true);
  });

  known(499, 'in a file with no changes, Redlines is disabled in the eye', async ({ start }) => {
    const j = await start({ doc: 'Hello\n', tracking: false });
    const eye = await openEye(j);
    // Today Redlines can be chosen in a file with nothing to show.
    await expect(eye.item('Redlines')).toBeDisabled();
  });

  known(499, 'the eye has no Simple Look row', async ({ start }) => {
    const j = await start({ doc: 'Hello\n', tracking: false });
    const eye = await openEye(j);
    await expect(eye.item('Simple Look')).toHaveCount(0);
  });
});
