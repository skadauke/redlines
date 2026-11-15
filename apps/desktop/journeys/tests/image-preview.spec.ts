// A double-click on an image opens its file in Preview, and a save there shows in the document. The
// page has no Preview: its development build has a stand-in (`window.__redlinesImages`) that records
// the path asked for, and replaces an image's bytes the way a save in Preview does. What the real
// Preview round trip does is checked in the app, by hand (see the pull request).

import type { Page } from '@playwright/test';
import { expect, test } from '../src/journey.ts';

declare global {
  interface Window {
    /** The development page's stand-in for Preview (`DevImages` in `src/host.ts`). */
    __redlinesImages?: { opened: string[]; replace(path: string, blob: Blob): void };
  }
}

const DOC = [
  'Intro line before the pictures.',
  '',
  '![A red square](red.png)',
  '',
  'Words ![A green one](green.png) between.',
  '',
  'The end.',
  '',
].join('\n');

/** Saves a flat-colored image of the page's own making at `path`, as another app would. */
async function save(page: Page, path: string, color: string, width: number): Promise<void> {
  await page.evaluate(
    async ({ path, color, width }) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = 90;
      const context = canvas.getContext('2d')!;
      context.fillStyle = color;
      context.fillRect(0, 0, width, 90);
      const blob = await new Promise<Blob>((done) => canvas.toBlob((b) => done(b!), 'image/png'));
      window.__redlinesImages!.replace(path, blob);
    },
    { path, color, width },
  );
}

/** What the first image and the second load from. */
const sources = (page: Page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll('.rl-image img'), (img) => img.getAttribute('src')),
  );

test.describe('images in Preview @blocks', () => {
  test('a double-click opens the image in Preview, and a save there refreshes that image alone', async ({
    start,
  }) => {
    const j = await start({ tracking: false, view: 'redlines' });
    await save(j.page, 'red.png', '#c0392b', 220);
    await save(j.page, 'green.png', '#27ae60', 120);
    await j.page.evaluate((doc) => window.__redlines!.editor.setDoc(doc), DOC);
    await j.caretAtEnd();
    await expect(j.page.locator('.rl-image img')).toHaveCount(2);
    await expect.poll(async () => (await sources(j.page)).every(Boolean)).toBe(true);
    const text = await j.text();
    const before = await sources(j.page);
    await j.shot('image-before-save');

    // A double-click on the first image asks the host to open its file, and selects no word.
    await j.page.locator('.rl-image img').first().dblclick();
    await expect
      .poll(() => j.page.evaluate(() => window.__redlinesImages!.opened))
      .toEqual(['red.png']);
    expect(await j.selectedText(), 'no word is selected').toBe('');
    await j.shot('image-double-clicked');

    // The person saves it in Preview and comes back to the window.
    await j.caretAtEnd();
    await expect(j.page.locator('.rl-image img')).toHaveCount(2);
    await save(j.page, 'red.png', '#2c5fc0', 220);
    await j.page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect
      .poll(async () => (await sources(j.page))[0], 'the saved image loads from its new file')
      .not.toBe(before[0]);
    expect((await sources(j.page))[1], 'the other image is as it was').toBe(before[1]);
    expect(await j.text(), 'the file never changes for it').toBe(text);
    await j.shot('image-after-save');
    const pixel = await j.page.evaluate(async () => {
      const img = document.querySelector<HTMLImageElement>('.rl-image img')!;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d')!;
      context.drawImage(img, 10, 10, 1, 1, 0, 0, 1, 1);
      return Array.from(context.getImageData(0, 0, 1, 1).data);
    });
    expect(pixel[2]! > pixel[0]!, 'the first image is the new, blue one').toBe(true);
  });

  test('a double-click on a remote image does nothing', async ({ start }) => {
    const j = await start({ tracking: false, view: 'redlines' });
    await j.page.evaluate(
      (doc) => window.__redlines!.editor.setDoc(doc),
      'Words ![A cat](https://example.com/cat.png) end\n',
    );
    await j.caretAtEnd();
    const image = j.page.locator('.rl-image');
    await expect(image).toHaveCount(1);
    await image.dblclick();
    expect(await j.page.evaluate(() => window.__redlinesImages!.opened)).toEqual([]);
    expect(await j.selectedText(), 'no word is selected').toBe('');
  });
});
