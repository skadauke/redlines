// An image file dragged from the sidebar lands between blocks, linked by its path (#681, #1198: with
// the pointer, since the app's web view sends the page no HTML drag events).

import { expect, test } from '../src/journey.ts';

declare global {
  interface Window {
    /** The development page's stand-in for Preview (`DevImages` in `src/host.ts`). */
    __redlinesImages?: { opened: string[]; replace(path: string, blob: Blob): void };
  }
}

const DOC = ['First paragraph of the plan.', '', 'Second paragraph, after a gap.', ''].join('\n');

test.describe('an image dragged from the sidebar', () => {
  test('shows the line between blocks, and lands there as a block of its own', async ({
    start,
  }) => {
    const j = await start({ doc: DOC, tracking: false, view: 'clean' });
    await j.page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 160;
      canvas.height = 90;
      const context = canvas.getContext('2d')!;
      context.fillStyle = '#c0392b';
      context.fillRect(0, 0, 160, 90);
      const blob = await new Promise<Blob>((done) => canvas.toBlob((b) => done(b!), 'image/png'));
      window.__redlinesImages!.replace('red.png', blob);
    });
    // Saved, so that the document has a folder, which the sidebar shows.
    await j.press('Meta+s');
    await j.press('Control+Meta+s');
    const image = j.page.locator('.rl-sidebar-image', { hasText: 'red.png' });
    await expect(image).toBeVisible();

    // Between the two paragraphs.
    const second = await j.page
      .locator('.cm-content .cm-line', { hasText: 'Second' })
      .boundingBox();
    if (!second) throw new Error('No second paragraph');
    const at = { x: second.x + 40, y: second.y - 4 };
    // A real pointer drag, which is all the app's web view lets the page have: press on the row, move
    // out over the document, and let go (#1198). The HTML drag events never reach the page there.
    const row = (await image.boundingBox())!;
    await j.page.mouse.move(row.x + row.width / 2, row.y + row.height / 2);
    await j.page.mouse.down();
    await j.page.mouse.move(at.x - 100, at.y + 10, { steps: 6 });
    await j.page.mouse.move(at.x, at.y, { steps: 6 });
    await expect(j.page.locator('.rl-sidebar-drag'), 'its name follows the pointer').toHaveText(
      'red.png',
    );
    await expect(j.page.locator('.rl-drop-line')).toHaveCount(1);
    await j.shot('image-drag-line');
    await j.page.mouse.up();

    await expect(j.page.locator('.rl-drop-line')).toHaveCount(0);
    await expect(j.page.locator('.rl-sidebar-drag')).toHaveCount(0);
    expect(await j.text()).toBe(
      'First paragraph of the plan.\n\n![](red.png)\n\nSecond paragraph, after a gap.\n',
    );
    await expect(j.page.locator('.cm-content img:not(.cm-widgetBuffer)').first()).toBeVisible();
    await j.shot('image-dropped');
    // Undo takes it back in one step.
    await j.press('Meta+z');
    expect(await j.text()).toBe(DOC);
  });

  test('a drag let go over the sidebar, or given up with Escape, writes nothing', async ({
    start,
  }) => {
    const j = await start({ doc: DOC, tracking: false, view: 'clean' });
    await j.page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 160;
      canvas.height = 90;
      const blob = await new Promise<Blob>((done) => canvas.toBlob((b) => done(b!), 'image/png'));
      window.__redlinesImages!.replace('red.png', blob);
    });
    await j.press('Meta+s');
    await j.press('Control+Meta+s');
    const image = j.page.locator('.rl-sidebar-image', { hasText: 'red.png' });
    await expect(image).toBeVisible();
    const row = (await image.boundingBox())!;
    const second = (await j.page
      .locator('.cm-content .cm-line', { hasText: 'Second' })
      .boundingBox())!;
    const start0 = { x: row.x + row.width / 2, y: row.y + row.height / 2 };
    // Let go over the sidebar itself.
    await j.page.mouse.move(start0.x, start0.y);
    await j.page.mouse.down();
    await j.page.mouse.move(start0.x + 10, start0.y + 40, { steps: 4 });
    await expect(j.page.locator('.rl-drop-line')).toHaveCount(0);
    await j.page.mouse.up();
    expect(await j.text()).toBe(DOC);
    // Escape over the document.
    await j.page.mouse.move(start0.x, start0.y);
    await j.page.mouse.down();
    await j.page.mouse.move(second.x + 40, second.y - 4, { steps: 8 });
    await expect(j.page.locator('.rl-drop-line')).toHaveCount(1);
    await j.page.keyboard.press('Escape');
    await expect(j.page.locator('.rl-drop-line')).toHaveCount(0);
    await j.page.mouse.up();
    expect(await j.text()).toBe(DOC);
  });
});
