// The toolbar (#504, #685): away until summoned, shown by ⇧⌘P at the caret and by a right-click at
// the pointer, or docked at the bottom center by the preference (`j.dockToolbar`).

import { expect, test, type Journey } from '../src/journey.ts';
import { isOpaque } from '../src/contrast.ts';

const DOC = 'The quick brown fox jumps over the lazy dog.\n\nA second paragraph of text.\n';

const toolbar = (j: Journey) => j.page.locator('.rl-toolbar');

test.describe('the toolbar @views', () => {
  test('is away until it is summoned, and the title bar has no button for it', async ({
    start,
  }) => {
    const j = await start({ doc: DOC, tracking: false, view: 'clean' });
    await expect(toolbar(j)).toBeHidden();
    await expect(j.page.locator('.rl-wrench-button')).toHaveCount(0);
    await j.shot('away');
  });

  test('docked (the preference), it is at the bottom center and stays while the person writes', async ({
    start,
  }) => {
    const j = await start({ doc: DOC, tracking: false, view: 'clean' });
    await j.dockToolbar();
    await expect(toolbar(j)).toBeVisible();
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
    await j.dockToolbar(false);
    await expect(toolbar(j)).toBeHidden();
  });

  test('⇧⌘P shows it at the caret', async ({ start }) => {
    const j = await start({ doc: DOC, tracking: false, view: 'clean' });
    await j.caretAfter('brown');
    await j.press('Meta+Shift+P');
    await expect(toolbar(j)).toBeVisible();
    await expect(toolbar(j)).not.toHaveClass(/rl-toolbar-docked/);
    await j.shot('at-the-caret');
    await j.press('Escape');
    await expect(toolbar(j)).toBeHidden();
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
    await j.dockToolbar();
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
    await j.dockToolbar();
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
    await j.dockToolbar();
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
    await j.dockToolbar();
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
    await j.dockToolbar();
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
    // Alignment, from a caret, writes the delimiter row (with a row selected it dims, as Column does).
    await expect(menu.locator('[data-command="table.alignRight"]')).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await j.press('Escape');
    await j.caretAfter('4');
    await top.click();
    await menu.locator('[data-command="table.alignRight"]').click();
    expect(await j.text()).toContain('| - | -: |');
    await top.click();
    await menu.locator('[data-command="table.deleteTable"]').click();
    expect(await j.text()).not.toContain('| A |');
  });

  // #553: the Image menu is in the bar only where an image is picked: Align, Size, Edit in Preview.
  test('the Image menu aligns and sizes the picked image, and opens it in Preview', async ({
    start,
  }) => {
    const j = await start({ tracking: false, view: 'redlines' });
    await j.page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 400;
      canvas.height = 200;
      const context = canvas.getContext('2d')!;
      context.fillStyle = '#c0392b';
      context.fillRect(0, 0, 400, 200);
      const blob = await new Promise<Blob>((done) => canvas.toBlob((b) => done(b!), 'image/png'));
      (
        window as unknown as { __redlinesImages: { replace(path: string, blob: Blob): void } }
      ).__redlinesImages.replace('red.png', blob);
      window.__redlines!.editor.setDoc(
        'Before the picture.\n\n![A red square](red.png)\n\nAfter.\n',
      );
    });
    await j.caretAfter('Before');
    await j.dockToolbar();
    const top = toolbar(j).locator('.rl-toolbar-top[data-menu="image"]');
    await expect(top).toHaveCount(0);
    await j.page.locator('.rl-image img').click();
    await expect(top).toBeVisible();
    await top.click();
    const menu = toolbar(j).locator('.rl-toolbar-menu:not([hidden])');
    await expect(menu.locator('.rl-toolbar-menu-head')).toHaveText('Image');
    expect(await isOpaque(menu)).toBe(true);
    await expect(menu.locator('[data-command="image.align.center"]')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await j.shot('image-menu');
    await menu.locator('[data-command="image.align.right"]').click();
    expect(await j.text()).toContain('align="right"');
    // The image the caret is in is drawn as its source; the menu follows the caret.
    await top.click();
    await expect(menu.locator('[data-command="image.align.right"]')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await menu.locator('[data-command="image.size.medium"]').click();
    expect(await j.text()).toContain('width=');
    await top.click();
    await j.shot('image-menu-after');
    await menu.locator('[data-command="image.edit"]').click();
    const opened = await j.page.evaluate(
      () =>
        (window as unknown as { __redlinesImages: { opened: string[] } }).__redlinesImages.opened,
    );
    expect(opened.at(-1)).toContain('red.png');
    // Away from the image, the menu is gone from the bar.
    await j.caretAfter('After');
    await expect(top).toHaveCount(0);
  });
});
