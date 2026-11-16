// Resizing an image (#526): while the pointer is over it, a handle shows on its left and on its right
// edge; a drag on either resizes it, its aspect kept; the size is in the file as an `<img>` tag's
// width, and a document that holds it draws it so again; one Undo takes the size back. With Track
// Changes on the new size is a substitution of the image. The page has no files: its development
// build has a stand-in for them (`window.__redlinesImages`, `DevImages` in `src/host.ts`).

import type { Locator, Page } from '@playwright/test';
import { expect, test, type Journey, type Start } from '../src/journey.ts';

declare global {
  interface Window {
    /** The development page's stand-in for the files images are in. */
    __redlinesImages?: { opened: string[]; replace(path: string, blob: Blob): void };
  }
}

const DOC = [
  'Intro line before the picture.',
  '',
  '![A red square](red.png)',
  '',
  'The end.',
  '',
].join('\n');

/** Saves a flat-colored image `width` × `height` at `path`, as another app would. */
async function save(page: Page, path: string, color: string, width: number, height: number) {
  await page.evaluate(
    async ({ path, color, width, height }) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d')!;
      context.fillStyle = color;
      context.fillRect(0, 0, width, height);
      context.fillStyle = '#fff';
      context.font = '28px sans-serif';
      context.fillText(`${width} × ${height}`, 24, height / 2);
      const blob = await new Promise<Blob>((done) => canvas.toBlob((b) => done(b!), 'image/png'));
      window.__redlinesImages!.replace(path, blob);
    },
    { path, color, width, height },
  );
}

/** The drawn image's width on the page, in px. */
const width = (image: Locator) => image.evaluate((img) => img.getBoundingClientRect().width);

/** A document with the picture, the caret away from it so that it is drawn, ready to resize. */
async function open(
  start: Start,
  tracking: boolean,
  doc = DOC,
  scheme: 'light' | 'dark' = 'light',
) {
  const j = await start({ tracking: false, view: 'redlines', scheme });
  // The picture is 400 px wide as it is drawn at any text size (a width is in px at 100%).
  const scale = j.options.textSize;
  await save(j.page, 'red.png', '#c0392b', 400 / scale, 200 / scale);
  await j.page.evaluate((text) => window.__redlines!.editor.setDoc(text), doc);
  await j.caretAtEnd();
  if (tracking) await j.page.evaluate(() => window.__redlines!.editor.setTracking(true));
  const image = j.page.locator('.rl-image img');
  await expect(image).toHaveCount(1);
  await expect.poll(() => width(image)).toBeGreaterThan(100);
  return { j, image, scale };
}

/** Drags the handle on `side` of the image by `dx` px, as a person does: down, moves, up. */
async function drag(j: Journey, side: 'left' | 'right', dx: number) {
  const image = j.page.locator('.rl-image img');
  await image.hover();
  const handle = j.page.locator(`.rl-image-handle-${side}`);
  const box = (await handle.boundingBox())!;
  const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await j.page.mouse.move(at.x, at.y);
  await j.page.mouse.down();
  await j.page.mouse.move(at.x + dx / 2, at.y, { steps: 4 });
  await j.page.mouse.move(at.x + dx, at.y, { steps: 4 });
  return { at, release: () => j.page.mouse.up() };
}

test.describe('resizing an image @blocks', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`the handles show just outside the two edges while the pointer is over the image (${scheme})`, async ({
      start,
    }) => {
      const { j, image } = await open(start, false, DOC, scheme);
      const handles = j.page.locator('.rl-image-handle');
      await expect(handles).toHaveCount(2);
      // Away from the image they are drawn but not shown.
      await j.page.mouse.move(2, 2);
      for (const handle of await handles.all()) await expect(handle).toHaveCSS('opacity', '0');
      await j.shot(`image-resize-at-rest-${scheme}`);
      await image.hover();
      for (const handle of await handles.all()) await expect(handle).toHaveCSS('opacity', '1');
      // Beside the image's own left and right edges, and nowhere else: never over the picture (#676).
      const [box, left, right] = await Promise.all([
        image.boundingBox(),
        j.page.locator('.rl-image-handle-left').boundingBox(),
        j.page.locator('.rl-image-handle-right').boundingBox(),
      ]);
      expect(
        Math.abs(left!.x + left!.width - box!.x),
        'the left handle ends at the left edge',
      ).toBeLessThan(2);
      expect(
        Math.abs(right!.x - (box!.x + box!.width)),
        'the right handle starts at the right edge',
      ).toBeLessThan(2);
      expect(left!.width, 'wide enough to grab').toBeGreaterThanOrEqual(12);
      await j.shot(`image-resize-hover-${scheme}`);
    });
  }

  test('an image as wide as the column has its handles in the margin, where they can be grabbed', async ({
    start,
  }) => {
    const j = await start({ tracking: false, view: 'redlines' });
    await save(j.page, 'red.png', '#c0392b', 1600, 300);
    await j.page.evaluate((text) => window.__redlines!.editor.setDoc(text), DOC);
    await j.caretAtEnd();
    const image = j.page.locator('.rl-image img');
    await expect.poll(() => width(image)).toBeGreaterThan(600);
    await image.hover();
    for (const side of ['left', 'right'] as const) {
      const box = (await j.page.locator(`.rl-image-handle-${side}`).boundingBox())!;
      const top = await j.page.evaluate(
        ({ x, y }) => document.elementFromPoint(x, y)?.className ?? '',
        { x: box.x + box.width / 2, y: box.y + box.height / 2 },
      );
      expect(top, `the ${side} handle is what is under the pointer on it`).toContain(
        'rl-image-handle',
      );
    }
    await j.shot('image-resize-full-column');
  });

  test('a drag resizes the image, the size is in the file, and one Undo takes it back', async ({
    start,
  }) => {
    const { j, image, scale } = await open(start, false);
    const before = await width(image);
    expect(await j.text()).toContain('![A red square](red.png)');

    // A centered image grows at both edges, so its edge follows the pointer at half the width.
    const held = await drag(j, 'right', -100);
    await j.shot('image-resize-dragging');
    // Live: the image is narrower before anything is written, and the file is as it was.
    await expect.poll(() => width(image)).toBeCloseTo(before - 200, -1);
    expect(await j.text()).toContain('![A red square](red.png)');
    await held.release();

    const text = await j.text();
    const written = /<img src="red\.png" alt="A red square" width="(\d+)">/.exec(text);
    expect(written, `the file holds the tag: ${text}`).not.toBeNull();
    const size = Number(written![1]);
    expect(
      Math.abs(size * scale - (before - 200)),
      'the width written, at the text size, is the width drawn',
    ).toBeLessThan(4 * scale);
    await expect.poll(() => width(image)).toBeCloseTo(size * scale, -1);
    // The aspect is kept: the picture is twice as wide as high.
    const box = (await image.boundingBox())!;
    expect(Math.abs(box.width / box.height - 2)).toBeLessThan(0.05);
    await j.shot('image-resize-done');

    // One Undo gives the old size back, and one Redo the new one.
    await j.press('ControlOrMeta+z');
    expect(await j.text()).toContain('![A red square](red.png)');
    await expect.poll(() => width(image)).toBeCloseTo(before, -1);
    await j.press('ControlOrMeta+Shift+z');
    expect(await j.text()).toBe(text);

    // A document that holds the tag draws it at that size: a reload keeps it.
    await j.page.evaluate((doc) => window.__redlines!.editor.setDoc(doc), text);
    await j.caretAtEnd();
    await expect.poll(() => width(j.page.locator('.rl-image img'))).toBeCloseTo(size * scale, -1);
    await j.shot('image-resize-reloaded');
  });

  test('the left handle drags the other way, and a drag to the image’s own size gives it back', async ({
    start,
  }) => {
    const { j, image, scale } = await open(
      start,
      false,
      DOC.replace('![A red square](red.png)', '<img src="red.png" alt="A red square" width="150">'),
    );
    await expect.poll(() => width(image)).toBeCloseTo(150 * scale, -1);
    // Dragging the left handle to the left makes it wider.
    let held = await drag(j, 'left', -60);
    await held.release();
    const wider = Number(/width="(\d+)"/.exec(await j.text())![1]) * scale;
    expect(wider).toBeGreaterThan(250);
    // Dragged back to 400 px, the size of the picture, it is `![]()` again.
    held = await drag(j, 'right', (400 - wider) / 2);
    await held.release();
    expect(await j.text()).toContain('![A red square](red.png)');
    await j.shot('image-resize-own-size');
  });

  test('with Track Changes on the new size is a substitution of the image', async ({ start }) => {
    const { j, image } = await open(start, true);
    const held = await drag(j, 'right', -80);
    await held.release();
    const text = await j.text();
    expect(text).toMatch(/<!--sub \w{4} !\[A red square\]\(red\.png\)-->/);
    expect(text).toMatch(/<img src="red\.png" alt="A red square" width="\d+">/);
    await expect.poll(() => width(image)).toBeLessThan(300);
    await j.shot('image-resize-tracked');
  });
});
