// The table's handles (#1199): drawn as the picture's resize handles are, and the select-table handle
// drags the whole table to drop it before or after other blocks, as blocks are moved.

import type { Page } from '@playwright/test';
import { expect, test, type Journey, type Scheme } from '../src/journey.ts';

const TABLE = '| A | B |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |\n';
const DOC = `First paragraph.\n\n${TABLE}\nLast paragraph.\n`;

/** The pill of a handle: its size, ground and shadow. */
const pill = (page: Page, selector: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((el) => {
      const style = getComputedStyle(el, '::before');
      const own = getComputedStyle(el);
      return { ground: style.backgroundColor, shadow: style.boxShadow, own: own.boxShadow };
    });

async function open(start: (o: object) => Promise<Journey>, scheme: Scheme, tracking = false) {
  const j = await start({ doc: DOC, tracking, view: tracking ? 'redlines' : 'clean', scheme });
  await j.settle();
  await j.hover('1');
  await expect(j.page.locator('.rl-table-select')).toBeVisible();
  return j;
}

test.describe('table handles @tables', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`the grips and the select-table handle are drawn as the picture handles (${scheme})`, async ({
      start,
    }) => {
      const j = await open(start, scheme);
      const grip = await pill(j.page, '.rl-grip');
      expect(grip.ground, 'a white pill').toBe('rgb(255, 255, 255)');
      expect(grip.shadow, 'with the picture handle’s hairline and shadow').toContain(
        'rgba(0, 0, 0, 0.55) 0px 0px 0px 1px',
      );
      const select = await j.page.locator('.rl-table-select').evaluate((el) => ({
        ground: getComputedStyle(el).backgroundColor,
        svg: el.querySelector('svg') !== null,
      }));
      expect(select.ground).toBe('rgb(255, 255, 255)');
      expect(select.svg, 'with a move icon').toBe(true);
      await j.shot(`table-handles-${scheme}`);
    });
  }

  for (const scheme of ['light', 'dark'] as const) {
    test(`beside a picture's handles, for the look review (${scheme})`, async ({ start }) => {
      const j = await start({
        tracking: false,
        view: 'redlines',
        scheme,
      });
      await j.page.evaluate(async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 400;
        canvas.height = 150;
        const context = canvas.getContext('2d')!;
        context.fillStyle = '#c0392b';
        context.fillRect(0, 0, 400, 150);
        const blob = await new Promise<Blob>((done) => canvas.toBlob((b) => done(b!), 'image/png'));
        (
          window as unknown as { __redlinesImages: { replace(p: string, b: Blob): void } }
        ).__redlinesImages.replace('red.png', blob);
        window.__redlines!.editor.setDoc(
          `![A red square](red.png)\n\n| A | B |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |\n`,
        );
      });
      await j.caretAtEnd();
      const image = j.page.locator('.rl-image img');
      await expect
        .poll(() => image.evaluate((img) => img.getBoundingClientRect().width))
        .toBeGreaterThan(100);
      await image.click();
      await j.hover('1');
      await expect(j.page.locator('.rl-grip').first()).toBeVisible();
      await expect(j.page.locator('.rl-image-handle').first()).toBeVisible();
      await j.shot(`picture-and-table-handles-${scheme}`);
    });
  }

  test('a drag from the select-table handle moves the whole table, and Undo puts it back', async ({
    start,
  }) => {
    const j = await open(start, 'light');
    const handle = (await j.page.locator('.rl-table-select').boundingBox())!;
    const first = (await j.page
      .locator('.cm-content .cm-line', { hasText: 'First paragraph' })
      .boundingBox())!;
    await j.page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await j.page.mouse.down();
    await j.page.mouse.move(handle.x + 10, handle.y - 40, { steps: 6 });
    await j.page.mouse.move(first.x + 40, first.y - 4, { steps: 8 });
    await expect(j.page.locator('.rl-drop-line'), 'a line shows where it will go').toHaveCount(1);
    await j.shot('table-dragging');
    await j.page.mouse.up();
    expect(await j.text(), 'the table is before the first paragraph').toBe(
      `${TABLE}\nFirst paragraph.\n\nLast paragraph.\n`
        .replace(/^/, '')
        .replace('\nFirst', '\nFirst'),
    );
    await j.press('Meta+z');
    expect(await j.text()).toBe(DOC);
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`a grip's menu is used from the keyboard, and the chosen item looks like one under the pointer (${scheme})`, async ({
      start,
    }) => {
      const j = await open(start, scheme);
      await j.page.locator('.rl-grip').first().click({ button: 'right' });
      const menu = j.page.locator('.rl-grip-menu');
      await expect(menu).toBeVisible();
      await j.press('ArrowDown');
      await j.press('ArrowDown');
      const chosen = j.page.locator('.rl-grip-item:focus');
      await expect(chosen, 'the second item is chosen').toHaveText('Insert Row Below');
      const background = (locator: typeof chosen) =>
        locator.evaluate((el) => getComputedStyle(el).backgroundColor);
      const byKeys = await background(chosen);
      await j.shot(`grip-menu-keys-${scheme}`);
      // The same item under the pointer.
      await j.page.mouse.move(0, 0);
      await j.page.locator('.rl-grip-item', { hasText: 'Delete Table' }).hover();
      const hovered = await background(
        j.page.locator('.rl-grip-item', { hasText: 'Delete Table' }),
      );
      expect(byKeys, 'chosen with the keys looks as under the pointer').toBe(hovered);
      await j.press('Escape');
      await expect(menu).toBeHidden();
      // Return runs the chosen item.
      await j.hover('1');
      await j.page.locator('.rl-grip').first().click({ button: 'right' });
      await j.press('ArrowDown');
      await j.press('ArrowDown');
      await j.press('Enter');
      await expect(menu).toBeHidden();
      expect(await j.text(), 'a row was inserted below the first').toMatch(
        /\| 1 \| 2 \|\n\|\s+\|\s+\|\n\| 3 \| 4 \|/,
      );
    });
  }

  test('a click on the select-table handle still selects the table, and Escape gives a drag up', async ({
    start,
  }) => {
    const j = await open(start, 'light');
    const handle = (await j.page.locator('.rl-table-select').boundingBox())!;
    const at = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 };
    await j.page.mouse.click(at.x, at.y);
    await expect(j.page.locator('.rl-sel').first(), 'the cells are selected').toBeVisible();
    await j.hover('1');
    const again = (await j.page.locator('.rl-table-select').boundingBox())!;
    await j.page.mouse.move(again.x + 8, again.y + 8);
    await j.page.mouse.down();
    await j.page.mouse.move(again.x + 8, again.y - 60, { steps: 6 });
    await j.page.keyboard.press('Escape');
    await j.page.mouse.up();
    expect(await j.text()).toBe(DOC);
  });

  test('with Track Changes on, a moved table is one tracked move', async ({ start }) => {
    const j = await open(start, 'light', true);
    const handle = (await j.page.locator('.rl-table-select').boundingBox())!;
    const last = (await j.page
      .locator('.cm-content .cm-line', { hasText: 'Last paragraph' })
      .boundingBox())!;
    await j.page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await j.page.mouse.down();
    await j.page.mouse.move(handle.x + 10, handle.y + 40, { steps: 6 });
    await j.page.mouse.move(last.x + 40, last.y + last.height + 8, { steps: 8 });
    await j.page.mouse.up();
    const text = await j.text();
    expect(text, 'the table is written again after the last paragraph').toMatch(
      /Last paragraph\.[\s\S]*\| A \| B \|/,
    );
    expect(text).toMatch(/<!--(?:ins|del|sub|move)/);
  });
});
