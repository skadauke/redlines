// The eye's menu: the views, and what it says about a file with no changes.

import { expect, test, type Journey } from '../src/journey.ts';
import { isOpaque } from '../src/contrast.ts';

/**
 * Opens the eye's menu, which opens on hover after a short pause, and returns its items by their
 * label (the text before the shortcut).
 */
async function openEye(j: Journey) {
  await j.page.getByRole('button', { name: 'View', exact: true }).hover();
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
    expect(await isOpaque(j.page.locator('.rl-menu').filter({ visible: true }))).toBe(true);
  });

  test('in a file with no changes, Redlines is disabled in the eye, and Clean and Raw are not', async ({
    start,
  }) => {
    const j = await start({ doc: 'Hello\n', tracking: false });
    const eye = await openEye(j);
    await expect(eye.item('Redlines'), 'the Redlines row is there').toHaveCount(1);
    await expect(eye.item('Redlines'), 'Redlines is disabled').toBeDisabled();
    await expect(eye.item('Clean')).toBeEnabled();
    await expect(eye.item('Raw')).toBeEnabled();
    await j.shot('eye-menu-no-changes');
  });

  test('in a file with changes, Redlines can be chosen in the eye', async ({ start }) => {
    const j = await start({ doc: 'Hello\n', tracking: true, view: 'clean' });
    await j.caretAtEnd();
    await j.press('ArrowUp');
    await j.type('x');
    const eye = await openEye(j);
    await expect(eye.item('Redlines')).toBeEnabled();
    await j.shot('eye-menu-with-changes');
  });

  test('the eye has no Simple Look row, and Raw is below a separator', async ({ start }) => {
    const j = await start({ doc: 'Hello\n', tracking: false });
    const eye = await openEye(j);
    await expect(eye.item('Clean'), 'the menu is open').toHaveCount(1);
    await expect(eye.item('Simple Look'), 'no Simple Look row').toHaveCount(0);
    // Clean, Redlines, a separator, Raw.
    const order = await j.page.evaluate(() =>
      [...document.querySelectorAll('.rl-menu')]
        .filter((menu) => (menu as HTMLElement).offsetParent !== null)
        .flatMap((menu) =>
          [...menu.children]
            .filter((el) => el.matches('[role^="menuitem"], [role="separator"]'))
            .map((el) =>
              el.matches('[role="separator"]')
                ? '—'
                : (el.querySelector('.rl-menu-label')?.textContent ?? ''),
            ),
        ),
    );
    expect(order.slice(0, 4)).toEqual(['Clean', 'Redlines', '—', 'Raw']);
    expect(order.includes('Simple Look')).toBe(false);
  });

  test('a click on the eye shows that it did something: the pupil is red for a moment', async ({
    start,
  }) => {
    const j = await start({ doc: 'Hello\n', tracking: false });
    const eye = j.page.getByRole('button', { name: 'View', exact: true });
    const pupil = () =>
      eye.evaluate((button) => getComputedStyle(button.querySelector('circle')!).fill);
    const rest = await pupil();
    await eye.click();
    expect(await pupil(), 'the pupil is red after the click').not.toBe(rest);
    await j.shot('eye-clicked');
    await expect(eye).not.toHaveClass(/rl-eye-flash/);
    expect(await pupil(), 'and as it was after a moment').toBe(rest);
  });
});
