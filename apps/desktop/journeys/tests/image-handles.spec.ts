// A click on a picture (#1195): a very faint outline, one set of handles, and they appear in place:
// not in the margin for a moment, and not drawn again when the click selects the picture.
// The page has no files: its development build has a stand-in for them (`window.__redlinesImages`).

import type { Page } from '@playwright/test';
import { expect, test, type Scheme, type Start } from '../src/journey.ts';

declare global {
  interface Window {
    /** The development page's stand-in for the files images are in. */
    __redlinesImages?: { opened: string[]; replace(path: string, blob: Blob): void };
  }
}

const DOC = 'Intro line before the picture.\n\n![A red square](red.png)\n\nThe end.\n';

async function save(page: Page, width: number, height: number) {
  await page.evaluate(
    async ({ width, height }) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d')!;
      context.fillStyle = '#c0392b';
      context.fillRect(0, 0, width, height);
      const blob = await new Promise<Blob>((done) => canvas.toBlob((b) => done(b!), 'image/png'));
      window.__redlinesImages!.replace('red.png', blob);
    },
    { width, height },
  );
}

async function open(start: Start, width: number, scheme: Scheme) {
  const j = await start({ tracking: false, view: 'redlines', scheme });
  const scale = j.options.textSize;
  await save(j.page, width / scale, width / 2 / scale);
  await j.page.evaluate((text) => window.__redlines!.editor.setDoc(text), DOC);
  await j.caretAtEnd();
  const image = j.page.locator('.rl-image img');
  await expect(image).toHaveCount(1);
  await expect
    .poll(() => image.evaluate((img) => img.getBoundingClientRect().width))
    .toBeGreaterThan(100);
  return { j, image };
}

/** Each handle's box, as `left,right`, and how many handles and pictures there are. */
const handles = (page: Page) =>
  page.evaluate(() => ({
    pictures: document.querySelectorAll('.rl-image').length,
    handles: document.querySelectorAll('.rl-image-handle').length,
    boxes: [...document.querySelectorAll('.rl-image-handle')].map((h) => {
      const box = h.getBoundingClientRect();
      return `${Math.round(box.left)},${Math.round(box.right)}`;
    }),
    column: (() => {
      const line = document
        .querySelector('.rl-image')!
        .closest('.cm-line')!
        .getBoundingClientRect();
      return { left: Math.round(line.left), right: Math.round(line.right) };
    })(),
  }));

test.describe('selecting a picture @blocks', () => {
  for (const scheme of ['light', 'dark'] as const) {
    for (const [name, width] of [
      ['a picture inside the column', 400],
      ['a column-wide picture', 1400],
    ] as const) {
      test(`${name}: one set of handles, in place from the click on, and a faint outline (${scheme})`, async ({
        start,
      }) => {
        const { j, image } = await open(start, width, scheme);
        const wide = width > 1000;
        await image.click();
        await expect(j.page.locator('.rl-image-selected')).toHaveCount(1);
        const first = await handles(j.page);
        expect(first.pictures, 'one picture is drawn').toBe(1);
        expect(first.handles, 'with one set of handles: a left one and a right one').toBe(2);
        if (wide) {
          for (const box of first.boxes) {
            const [left, right] = box.split(',').map(Number) as [number, number];
            expect(left, 'a handle is not in the margin').toBeGreaterThanOrEqual(first.column.left);
            expect(right, 'a handle is not in the margin').toBeLessThanOrEqual(first.column.right);
          }
        }
        await j.page.waitForTimeout(150);
        const later = await handles(j.page);
        expect(later.boxes, 'the handles did not jump after the click').toEqual(first.boxes);
        // A moving pointer moves nothing either.
        const at = (await image.boundingBox())!;
        await j.page.mouse.move(at.x + 20, at.y + 20);
        await j.page.mouse.move(at.x + 40, at.y + 30);
        expect((await handles(j.page)).boxes).toEqual(first.boxes);
        const outline = await image.evaluate((img) => getComputedStyle(img).outlineWidth);
        expect(outline, 'the outline is a hairline').toBe('1px');
        await j.shot(`picture-selected-${wide ? 'wide' : 'normal'}-${scheme}`);
      });
    }
  }

  // The siblings: the table's grips, as the picture's handles are to look (#1199).
  for (const scheme of ['light', 'dark'] as const) {
    test(`beside the table's grips, for the look review (${scheme})`, async ({ start }) => {
      const j = await start({
        doc: 'Intro\n\n| A | B |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |\n',
        tracking: false,
        view: 'clean',
        scheme,
      });
      await j.settle();
      await j.hover('1');
      await expect(j.page.locator('.rl-grip').first()).toBeVisible();
      await j.shot(`table-grips-${scheme}`);
    });
  }
});
