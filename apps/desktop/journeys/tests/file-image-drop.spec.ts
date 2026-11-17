// An image file dragged in from Finder lands between blocks, on the same drop line as one dragged from
// the sidebar, never in the middle of a paragraph (#674).

import { expect, test } from '../src/journey.ts';

const DOC = ['First paragraph of the plan.', '', 'Second paragraph, after a gap.', ''].join('\n');

test.describe('an image file dropped from Finder', () => {
  test('shows the line between blocks, and lands there, not in the middle of text', async ({
    start,
  }) => {
    const j = await start({ doc: DOC, tracking: false, view: 'clean' });
    // Saved, so that the document has a folder for the image.
    await j.press('Meta+s');
    await j.press('Control+Meta+s');
    const first = await j.page
      .locator('.cm-content .cm-line', { hasText: 'First paragraph' })
      .boundingBox();
    if (!first) throw new Error('No first paragraph');
    // In the middle of the first paragraph's words, nearer the first gap than any other.
    const at = { x: first.x + 60, y: first.y + first.height / 2 };
    const data = await j.page.evaluateHandle(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 160;
      canvas.height = 90;
      const context = canvas.getContext('2d')!;
      context.fillStyle = '#c0392b';
      context.fillRect(0, 0, 160, 90);
      const blob = await new Promise<Blob>((done) => canvas.toBlob((b) => done(b!), 'image/png'));
      const transfer = new DataTransfer();
      transfer.items.add(new File([blob], 'red.png', { type: 'image/png' }));
      return transfer;
    });
    const content = j.page.locator('.cm-content');
    await content.dispatchEvent('dragover', { dataTransfer: data, clientX: at.x, clientY: at.y });
    await expect(j.page.locator('.rl-drop-line'), 'the same line as the sidebar draws').toHaveCount(
      1,
    );
    await j.shot('file-drag-line');
    await content.dispatchEvent('drop', { dataTransfer: data, clientX: at.x, clientY: at.y });
    await expect(j.page.locator('.rl-drop-line')).toHaveCount(0);
    await expect(j.page.locator('.cm-content img:not(.cm-widgetBuffer)').first()).toBeVisible();
    await j.shot('file-dropped');
    const text = await j.text();
    // Both paragraphs are whole, and the link is a block of its own between or around them.
    expect(text).toContain('First paragraph of the plan.');
    expect(text).toContain('Second paragraph, after a gap.');
    expect(text).toMatch(/(^|\n\n)!\[\]\([^)]*red[^)]*\.png\)(\n\n|\n?$)/);
  });
});
