// Clicking an image (#675): it is selected, drawn as the image with an outline and its handles, and its
// Markdown or HTML stays hidden; the caret moves past it with the arrows, and Backspace takes it out.
// The page has no files: its development build has a stand-in for them (`window.__redlinesImages`).

import type { Page } from '@playwright/test';
import { expect, test, type Journey, type Scheme } from '../src/journey.ts';

declare global {
  interface Window {
    /** The development page's stand-in for the files images are in. */
    __redlinesImages?: { opened: string[]; replace(path: string, blob: Blob): void };
  }
}

const MARKDOWN = '![A red square](red.png)';
const HTML = '<img src="red.png" alt="A red square" width="200">';

const doc = (image: string) => `Intro line before the picture.\n\n${image}\n\nThe end.\n`;

/** Saves a flat-colored image at `path`, as another app would. */
async function save(page: Page, path: string, color: string, width: number, height: number) {
  await page.evaluate(
    async ({ path, color, width, height }) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d')!;
      context.fillStyle = color;
      context.fillRect(0, 0, width, height);
      const blob = await new Promise<Blob>((done) => canvas.toBlob((b) => done(b!), 'image/png'));
      window.__redlinesImages!.replace(path, blob);
    },
    { path, color, width, height },
  );
}

async function open(
  start: (options?: { tracking?: boolean; view?: 'redlines'; scheme?: Scheme }) => Promise<Journey>,
  image: string,
  scheme: Scheme = 'light',
) {
  const j = await start({ tracking: false, view: 'redlines', scheme });
  await save(j.page, 'red.png', '#c0392b', 400, 200);
  await j.page.evaluate((text) => window.__redlines!.editor.setDoc(text), doc(image));
  await j.caretAtEnd();
  await expect(j.page.locator('.rl-image img')).toHaveCount(1);
  await expect
    .poll(() =>
      j.page.locator('.rl-image img').evaluate((img) => img.getBoundingClientRect().width),
    )
    .toBeGreaterThan(100);
  return j;
}

/** What the page shows of the document, as text. */
const shown = (j: Journey) => j.page.locator('.cm-content').innerText();

test.describe('selecting an image @blocks', () => {
  for (const [name, image] of [
    ['a Markdown image', MARKDOWN],
    ['an HTML image', HTML],
  ] as const) {
    for (const scheme of ['light', 'dark'] as const) {
      test(`a click selects ${name}, its source stays hidden (${scheme})`, async ({ start }) => {
        const j = await open(start, image, scheme);
        await j.page.locator('.rl-image img').click();
        await expect(j.page.locator('.rl-image-selected'), 'the image is selected').toHaveCount(1);
        await expect(j.page.locator('.rl-image img'), 'and still drawn').toHaveCount(1);
        expect(await j.selectedText(), 'the selection is the image').toBe(image);
        const text = await shown(j);
        expect(text, 'its source is not shown').not.toContain('red.png');
        expect(text).not.toContain('![');
        for (const handle of await j.page.locator('.rl-image-handle').all()) {
          await expect(handle, 'its handles show').toHaveCSS('opacity', '1');
        }
        await j.shot(`image-selected-${name.includes('HTML') ? 'html' : 'markdown'}-${scheme}`);
      });
    }
  }

  test('the arrows move the caret past the image, which stays drawn', async ({ start }) => {
    const j = await open(start, MARKDOWN);
    const text = await j.text();
    const from = text.indexOf(MARKDOWN);
    const to = from + MARKDOWN.length;
    await j.page.locator('.rl-image img').click();
    await j.press('ArrowRight');
    expect((await j.caret()).head, 'Right ends the selection after the image').toBe(to);
    await expect(j.page.locator('.rl-image img')).toHaveCount(1);
    expect(await shown(j), 'the caret beside it does not show its source').not.toContain('red.png');
    await j.press('ArrowRight');
    expect(
      (await j.caret()).head,
      'and the next Right goes on into the next paragraph',
    ).toBeGreaterThan(to);
    await j.press('ArrowLeft');
    await j.press('ArrowLeft');
    expect((await j.caret()).head, 'Left steps back over the whole image at once').toBe(from);
    await expect(j.page.locator('.rl-image img')).toHaveCount(1);
    expect(await shown(j)).not.toContain('red.png');
  });

  test('a drag that starts on the image selects across text, as before', async ({ start }) => {
    const j = await open(start, MARKDOWN);
    const box = (await j.page.locator('.rl-image img').boundingBox())!;
    const end = await j.pointOf('The end');
    await j.drag(
      { x: box.x + box.width / 2, y: box.y + box.height / 2 },
      { x: end.x + 20, y: end.y },
    );
    const head = (await j.caret()).head;
    expect(head, 'the selection runs on into the text').toBeGreaterThan(
      (await j.text()).indexOf('The end'),
    );
  });

  test('Backspace on a selected image takes it out, and Undo brings it back', async ({ start }) => {
    const j = await open(start, MARKDOWN);
    await j.page.locator('.rl-image img').click();
    await j.press('Backspace');
    expect(await j.text(), 'the image is gone from the file').not.toContain('red.png');
    await expect(j.page.locator('.rl-image img')).toHaveCount(0);
    await j.press('ControlOrMeta+z');
    expect(await j.text()).toContain(MARKDOWN);
    await expect(j.page.locator('.rl-image img')).toHaveCount(1);
  });
});
