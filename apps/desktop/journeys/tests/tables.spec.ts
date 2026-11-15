// Tables: adding one, its grips and their menu, and typing over cells.

import { expect, known, test } from '../src/journey.ts';
import { isOpaque } from '../src/contrast.ts';

const TABLE = '| A | B |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |\n';

test.describe('tables @tables', () => {
  test('a table added with Track Changes off is drawn @smoke', async ({ start }) => {
    const j = await start({ doc: 'Intro\n\n', tracking: false, view: 'redlines' });
    await j.caretAtEnd();
    await j.paste(TABLE);
    expect(await j.cmText()).toContain('| A | B |');
    await expect(j.page.locator('.rl-tbl')).toHaveCount(1);
    await j.shot('table-added-plain');
  });

  // Fixed by #546 (it was #517: with Track Changes on the table showed as raw Markdown); a journey
  // kept as its guard.
  test('a table added with Track Changes on is drawn, not raw', async ({ start }) => {
    const j = await start({ doc: 'Intro\n\n', tracking: true, view: 'redlines' });
    await j.caretAtEnd();
    await j.paste(TABLE);
    expect(await j.cmText()).toContain('| A | B |');
    await j.shot('table-added-tracked');
    await expect(j.page.locator('.rl-tbl'), 'the table is drawn').toHaveCount(1);
  });

  known(
    519,
    'a row grip opens its menu on a right-click, and a left-click opens none',
    /right-click opens the menu/,
    async ({ start }) => {
      const j = await start({ doc: `Intro\n\n${TABLE}`, tracking: false, view: 'clean' });
      await j.settle();
      await j.hover('1');
      const grip = j.page.locator('.rl-grip').first();
      await expect(grip).toBeVisible();
      await grip.click({ button: 'right' });
      // Today a right-click does nothing; the menu opens on a left-click.
      await expect(j.page.locator('.rl-grip-menu'), 'right-click opens the menu').toBeVisible();
      await j.page.keyboard.press('Escape');
      await j.hover('1');
      await grip.click();
      await expect(j.page.locator('.rl-grip-menu'), 'left-click opens none').toBeHidden();
    },
  );

  // The grip's menu is opaque (its background named a token that did not exist), and the grips and
  // the + have hints after the title bar's delay (the table's look, #518 and #519's hints).
  test('the row grip menu is opaque', async ({ start }) => {
    const j = await start({ doc: `Intro\n\n${TABLE}`, tracking: false, view: 'clean' });
    await j.settle();
    await j.hover('1');
    const grip = j.page.locator('.rl-grip').first();
    const menu = j.page.locator('.rl-grip-menu');
    // The menu opens on a right-click once #519 is fixed, and on a left-click until then.
    await grip.click({ button: 'right' });
    if (!(await menu.isVisible())) await grip.click();
    await expect(menu, 'the menu opens').toBeVisible();
    await j.shot('row-grip-menu');
    expect(await isOpaque(menu), 'the menu is opaque').toBe(true);
  });

  test('the grips and the + have hover hints', async ({ start }) => {
    const j = await start({ doc: `Intro\n\n${TABLE}`, tracking: false, view: 'clean' });
    await j.settle();
    await j.hover('1');
    const grip = j.page.locator('.rl-grip').first();
    await expect(grip, 'the grip is drawn').toBeVisible();
    const tip = j.page.locator('.rl-grip-hint');
    await expect(tip, 'no hint before the pointer rests').toBeHidden();
    await grip.hover();
    await expect(tip, 'the grip has a hint').toHaveText(/move the row/);
    await j.shot('row-grip-hint');
    await j.page.mouse.move(2, 2);
    await expect(tip, 'the hint goes when the pointer leaves').toBeHidden();
  });

  test('the table header has the body size and faint lines divide the columns', async ({
    start,
  }) => {
    const j = await start({ doc: `Intro\n\n${TABLE}`, tracking: false, view: 'clean' });
    await j.settle();
    const sizes = await j.page.evaluate(() => {
      const size = (el: Element | null) => (el ? getComputedStyle(el).fontSize : '');
      return {
        header: size(document.querySelector('.rl-th .rl-tc')),
        body: size(document.querySelector('.rl-trow:not(.rl-th) .rl-tc')),
        divider: getComputedStyle(
          document.querySelectorAll('.rl-th .rl-tc')[1] as Element,
          '::after',
        ).borderLeftWidth,
        first: getComputedStyle(document.querySelector('.rl-th .rl-tc') as Element, '::after')
          .borderLeftWidth,
      };
    });
    expect(sizes.header, 'the header uses the body size').toBe(sizes.body);
    expect(sizes.divider, 'a line divides the columns').toBe('1px');
    expect(sizes.first, 'none before the first column').toBe('0px');
    await j.shot('table-look');
    await j.baseline('table-look');
  });

  test('the column lines leave a table of three columns its widths', async ({ start }) => {
    const wide = '| Alpha | Extraordinarily | Gamma |\n| - | - | - |\n| one | two | three |\n';
    const j = await start({ doc: `Intro\n\n${wide}`, tracking: false, view: 'clean' });
    await j.settle();
    const overflow = await j.page.evaluate(
      () =>
        [...document.querySelectorAll<HTMLElement>('.rl-tc')].filter(
          (cell) => cell.scrollWidth > cell.clientWidth + 1,
        ).length,
    );
    expect(overflow, 'no cell is narrower than its longest word').toBe(0);
    await j.shot('table-three-columns');
  });

  for (const tracking of [false, true]) {
    known(
      521,
      `typing over a rectangle of cells clears only the top-left cell, Track Changes ${tracking ? 'on' : 'off'}`,
      /the other cells are left alone/,
      async ({ start }) => {
        const j = await start({ doc: `Intro\n\n${TABLE}`, tracking, view: 'redlines' });
        await j.settle();
        const from = await j.pointOf('1');
        const to = await j.pointOf('4');
        await j.drag({ x: from.x + 2, y: from.y }, { x: to.x + 2, y: to.y });
        await j.shot('cells-selected');
        await j.type('z', 'burst');
        await j.shot('cells-typed');
        // The others keep their text. Today every other cell of the rectangle is cleared (struck,
        // with Track Changes on: no deletion at all is right).
        if (tracking) {
          expect((await j.text()).includes('<!--del'), 'the other cells are left alone').toBe(
            false,
          );
        } else {
          const drawn = await j.page.locator('.rl-tc').allInnerTexts();
          expect(
            drawn.map((cell) => cell.trim()),
            'the other cells are left alone',
          ).toEqual(['A', 'B', 'z', '2', '3', '4']);
        }
      },
    );
  }
});
