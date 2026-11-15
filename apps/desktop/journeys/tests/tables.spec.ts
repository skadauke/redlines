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

  known(519, 'the row grip menu is opaque', /the menu is opaque/, async ({ start }) => {
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
    // Today its background is transparent: the table's text shows through it.
    expect(await isOpaque(menu), 'the menu is opaque').toBe(true);
  });

  known(519, 'a row grip has a hover hint', /the grip has a hint/, async ({ start }) => {
    const j = await start({ doc: `Intro\n\n${TABLE}`, tracking: false, view: 'clean' });
    await j.settle();
    await j.hover('1');
    const grip = j.page.locator('.rl-grip').first();
    await expect(grip, 'the grip is drawn').toBeVisible();
    const hint = (await grip.getAttribute('title')) ?? (await grip.getAttribute('aria-label'));
    expect(hint, 'the grip has a hint').toBeTruthy();
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
