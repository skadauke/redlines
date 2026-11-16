// An image file dragged from the sidebar lands between blocks, linked by its path (#681).

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
    // The page's drag events, as WebKit sends them for a drag that starts on the row: the row sets
    // the data, and the document is over and then dropped on.
    const data = await j.page.evaluateHandle(() => new DataTransfer());
    await image.dispatchEvent('dragstart', { dataTransfer: data });
    const content = j.page.locator('.cm-content');
    await content.dispatchEvent('dragover', {
      dataTransfer: data,
      clientX: at.x,
      clientY: at.y,
    });
    await expect(j.page.locator('.rl-drop-line')).toHaveCount(1);
    await j.shot('image-drag-line');
    await content.dispatchEvent('drop', { dataTransfer: data, clientX: at.x, clientY: at.y });

    await expect(j.page.locator('.rl-drop-line')).toHaveCount(0);
    expect(await j.text()).toBe(
      'First paragraph of the plan.\n\n![](red.png)\n\nSecond paragraph, after a gap.\n',
    );
    await expect(j.page.locator('.cm-content img:not(.cm-widgetBuffer)').first()).toBeVisible();
    await j.shot('image-dropped');
    // Undo takes it back in one step.
    await j.press('Meta+z');
    expect(await j.text()).toBe(DOC);
  });
});
