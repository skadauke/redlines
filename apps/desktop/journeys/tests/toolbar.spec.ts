// The toolbar (#504, #685): away until summoned, shown by the title bar's wrench at the bottom
// center, by ⇧⌘P at the caret and by a right-click at the pointer.

import { expect, test, type Journey } from '../src/journey.ts';
import { isOpaque } from '../src/contrast.ts';

const DOC = 'The quick brown fox jumps over the lazy dog.\n\nA second paragraph of text.\n';

const toolbar = (j: Journey) => j.page.locator('.rl-toolbar');
const wrench = (j: Journey) => j.page.locator('.rl-wrench-button');

test.describe('the toolbar @views', () => {
  test('is away until it is summoned, and the wrench is left of the eye', async ({ start }) => {
    const j = await start({ doc: DOC, tracking: false, view: 'clean' });
    await expect(toolbar(j)).toBeHidden();
    await expect(wrench(j)).toHaveAttribute('aria-pressed', 'false');
    const [w, eye] = await Promise.all([
      wrench(j).boundingBox(),
      j.page.getByRole('button', { name: 'View', exact: true }).boundingBox(),
    ]);
    expect(w!.x + w!.width).toBeLessThanOrEqual(eye!.x);
    await j.shot('away');
  });

  test('the wrench docks it at the bottom center, and again puts it away', async ({ start }) => {
    const j = await start({ doc: DOC, tracking: false, view: 'clean' });
    await wrench(j).click();
    await expect(toolbar(j)).toBeVisible();
    await expect(wrench(j)).toHaveAttribute('aria-pressed', 'true');
    const box = (await toolbar(j).boundingBox())!;
    const { width, height } = j.page.viewportSize()!;
    expect(Math.abs(box.x + box.width / 2 - width / 2)).toBeLessThan(2);
    expect(height - (box.y + box.height)).toBeGreaterThan(4);
    expect(height - (box.y + box.height)).toBeLessThan(40);
    expect(await isOpaque(toolbar(j))).toBe(true);
    await j.shot('docked');
    // It stays while the person writes and clicks in the text.
    await j.click('quick');
    await j.type('X');
    await expect(toolbar(j)).toBeVisible();
    await wrench(j).click();
    await expect(toolbar(j)).toBeHidden();
    await expect(wrench(j)).toHaveAttribute('aria-pressed', 'false');
  });

  test('⇧⌘P shows it at the caret, and the wrench follows', async ({ start }) => {
    const j = await start({ doc: DOC, tracking: false, view: 'clean' });
    await j.caretAfter('brown');
    await j.press('Meta+Shift+P');
    await expect(toolbar(j)).toBeVisible();
    await expect(wrench(j)).toHaveAttribute('aria-pressed', 'true');
    await expect(toolbar(j)).not.toHaveClass(/rl-toolbar-docked/);
    await j.shot('at-the-caret');
    await j.press('Escape');
    await expect(toolbar(j)).toBeHidden();
    await expect(wrench(j)).toHaveAttribute('aria-pressed', 'false');
  });

  test('a right-click shows it at the pointer, and typing puts it away', async ({ start }) => {
    const j = await start({ doc: DOC, tracking: false, view: 'clean' });
    await j.page.getByText('second paragraph').click({ button: 'right' });
    await expect(toolbar(j)).toBeVisible();
    await expect(toolbar(j)).not.toHaveClass(/rl-toolbar-docked/);
    await j.shot('at-the-pointer');
    await j.page.keyboard.type('x');
    await expect(toolbar(j)).toBeHidden();
  });
});
