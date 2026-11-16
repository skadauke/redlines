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

  test('a menu opens on a click, opaque, with the bar in the order Ask | Insert · Review · Format · Edit', async ({
    start,
  }) => {
    const j = await start({ doc: DOC, tracking: false, view: 'clean' });
    await j.caretAfter('brown');
    await wrench(j).click();
    const names = await toolbar(j).locator('.rl-toolbar-top').allTextContents();
    expect(names.map((name) => name.trim())).toEqual([
      'Ask',
      'Insert',
      'Review',
      'List',
      'Format',
      'Edit',
    ]);
    await j.shot('bar');
    const insert = toolbar(j).locator('.rl-toolbar-top', { hasText: 'Insert' });
    await insert.click();
    const menu = toolbar(j).locator('.rl-toolbar-menu:not([hidden])');
    await expect(menu).toBeVisible();
    expect(await isOpaque(menu)).toBe(true);
    // It opens over the bar, never on it: the bar docked at the bottom, the menu above.
    const [bar, open] = await Promise.all([
      toolbar(j).locator('.rl-toolbar-bar').boundingBox(),
      menu.boundingBox(),
    ]);
    expect(open!.y + open!.height).toBeLessThanOrEqual(bar!.y);
    await j.shot('insert-menu');
    // Hovering to another menu switches.
    await toolbar(j).locator('.rl-toolbar-top', { hasText: 'Format' }).hover();
    await expect(menu.locator('.rl-toolbar-menu-head')).toHaveText('Format');
    await j.shot('format-menu');
    await j.press('Escape');
    await expect(menu).toBeHidden();
    await expect(toolbar(j)).toBeVisible();
  });

  test('a grayed item says why, and Review holds Accept and Reject on one line', async ({
    start,
  }) => {
    const j = await start({ doc: DOC, tracking: true, view: 'redlines' });
    await j.caretAfter('quick');
    await j.type(' very');
    await j.caretAfter('lazy');
    await wrench(j).click();
    await toolbar(j).locator('.rl-toolbar-top', { hasText: 'Review' }).click();
    const accept = toolbar(j).locator('[data-command="change.accept"]');
    await expect(accept).toHaveAttribute('aria-disabled', 'true');
    await accept.hover();
    await expect(j.page.locator('.rl-toolbar-tip')).toContainText('tracked change');
    await j.shot('review-grayed');
    await j.caretAfter('very');
    await expect(accept).toHaveAttribute('aria-disabled', 'false');
    const [a, r] = await Promise.all([
      accept.boundingBox(),
      toolbar(j).locator('[data-command="change.reject"]').boundingBox(),
    ]);
    expect(Math.abs(a!.y - r!.y)).toBeLessThan(2);
    await j.shot('review-open');
  });

  test('fades while typing and returns when the pointer moves', async ({ start }) => {
    const j = await start({ doc: DOC, tracking: false, view: 'clean' });
    await wrench(j).click();
    await j.caretAfter('quick');
    await j.type('x');
    await expect(toolbar(j)).toHaveCSS('opacity', '0');
    await j.shot('faded');
    await j.page.mouse.move(300, 300);
    await j.page.mouse.move(310, 305);
    await expect(toolbar(j)).toHaveCSS('opacity', '1');
  });

  test('does not cover the last lines of the document', async ({ start }) => {
    const long = Array.from({ length: 60 }, (_, i) => `Paragraph number ${i + 1} of the text.`);
    const j = await start({ doc: `${long.join('\n\n')}\n`, tracking: false, view: 'clean' });
    await wrench(j).click();
    await j.page.keyboard.press('Meta+ArrowDown');
    await j.caretAtEnd();
    await j.page.evaluate(() => {
      const scroller = document.querySelector('.rl-scroller')!;
      scroller.scrollTop = scroller.scrollHeight;
    });
    const [bar, last] = await Promise.all([
      toolbar(j).boundingBox(),
      j.page.getByText('Paragraph number 60').boundingBox(),
    ]);
    expect(last!.y + last!.height).toBeLessThanOrEqual(bar!.y);
    await j.shot('end-of-document');
  });

  // #552: the Table menu is in the bar only in a table, two sides, and follows the selection.
  test('the Table menu shows Row and Column side by side and follows the selection', async ({
    start,
  }) => {
    const table = '| A | B |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |\n';
    const j = await start({ doc: `Intro\n\n${table}\nAfter\n`, tracking: false, view: 'clean' });
    await j.caretAfter('Intro');
    await wrench(j).click();
    await expect(toolbar(j).locator('.rl-toolbar-top[data-menu="table"]')).toHaveCount(0);
    await j.caretAfter('3');
    const top = toolbar(j).locator('.rl-toolbar-top[data-menu="table"]');
    await expect(top).toBeVisible();
    await top.click();
    const menu = toolbar(j).locator('.rl-toolbar-menu:not([hidden])');
    await expect(menu.locator('.rl-toolbar-menu-head')).toHaveText('Table · Row 3, column 1');
    expect(await isOpaque(menu)).toBe(true);
    await j.shot('table-caret');
    // The two sides of a line are level.
    const [above, left] = await Promise.all([
      menu.locator('[data-command="table.insertRowAbove"]').boundingBox(),
      menu.locator('[data-command="table.insertColumnLeft"]').boundingBox(),
    ]);
    expect(Math.abs(above!.y - left!.y)).toBeLessThan(2);
    // Select a row: the Column side dims.
    await menu.locator('[data-command="table.selectRow"]').click();
    await top.click();
    await expect(menu.locator('.rl-toolbar-menu-head')).toHaveText('Row 3 selected');
    await expect(menu.locator('[data-command="table.insertColumnLeft"]')).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await expect(menu.locator('[data-command="table.insertRowBelow"]')).toHaveAttribute(
      'aria-disabled',
      'false',
    );
    await j.shot('table-row-selected');
    // Alignment writes the delimiter row.
    await menu.locator('[data-command="table.alignRight"]').click();
    expect(await j.text()).toContain('| -: | -: |');
    await top.click();
    await menu.locator('[data-command="table.deleteTable"]').click();
    expect(await j.text()).not.toContain('| A |');
  });
});
