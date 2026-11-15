// Tables: adding one, its grips and their menu, and typing over cells.

import { expect, known, test } from '../src/journey.ts';
import { contrastOf, isOpaque } from '../src/contrast.ts';
import type { Journey } from '../src/journey.ts';

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
    test(`typing over a rectangle of cells clears only the top-left cell, Track Changes ${tracking ? 'on' : 'off'}`, async ({
      start,
    }) => {
      const j = await start({ doc: `Intro\n\n${TABLE}`, tracking, view: 'redlines' });
      await j.settle();
      const from = await j.pointOf('1');
      const to = await j.pointOf('4');
      await j.drag({ x: from.x + 2, y: from.y }, { x: to.x + 2, y: to.y });
      await j.shot('cells-selected');
      await j.type('z', 'burst');
      await j.shot('cells-typed');
      // The others keep their text; with Track Changes on, the one cell is a tracked edit.
      if (tracking) {
        const text = await j.text();
        expect(text.match(/<!--(sub|del|ins) /g), 'one cell is edited').toHaveLength(1);
        expect(text, 'the other cells are left alone').toContain('| 2 |\n| 3 | 4 |');
      } else {
        const drawn = await j.page.locator('.rl-tc').allInnerTexts();
        expect(
          drawn.map((cell) => cell.trim()),
          'the other cells are left alone',
        ).toEqual(['A', 'B', 'z', '2', '3', '4']);
      }
    });
  }

  // #520: adding a column gives the widths a reload of the resulting text gives (no jump after a
  // reload), whichever way the column is added; and so does deleting one.
  const SHAPES: Record<string, { table: string; caret: string }> = {
    two: { table: '| Name | Notes |\n| - | - |\n| Ada | x |\n', caret: 'Ada' },
    five: {
      table:
        '| Name | Role | City | Note | Id |\n| - | - | - | - | - |\n| Ada | Mathematician and the first programmer | London | x | 1 |\n| Bo | y | Paris | A long note with many words that will want a lot of room on the page | 22 |\n',
      caret: 'Ada',
    },
    wide: {
      table: `| Alpha | Beta | Gamma |\n| - | - | - |\n| ${'word '.repeat(30)}| ${'text '.repeat(30)}| ${'more '.repeat(30)}|\n`,
      caret: 'Alpha',
    },
  };
  const widthsOf = (page: import('@playwright/test').Page) =>
    page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('.rl-th .rl-tc')].map(
        (cell) => cell.getBoundingClientRect().width,
      ),
    );
  for (const [name, shape] of Object.entries(SHAPES)) {
    for (const edit of ['add', 'delete'] as const) {
      test(`${edit === 'add' ? 'a new column' : 'a deleted column'} has the widths a reload gives, ${name} @tables`, async ({
        start,
      }) => {
        const doc = `Intro\n\n${shape.table}`;
        const j = await start({ doc, tracking: false, view: 'clean' });
        await j.settle();
        const before = await widthsOf(j.page);
        await j.shot(`columns-${name}-${edit}-before`);
        await j.caretAfter(shape.caret);
        await j.press(edit === 'add' ? 'Alt+Meta+ArrowRight' : 'Control+Meta+Backspace');
        await j.settle();
        const text = await j.text();
        expect(text, 'the table changed').not.toBe(doc);
        const changed = await widthsOf(j.page);
        expect(changed.length, 'a column more or less').toBe(
          before.length + (edit === 'add' ? 1 : -1),
        );
        await j.shot(`columns-${name}-${edit}-after`);
        const again = await start({ doc: text, tracking: false, view: 'clean' });
        await again.settle();
        const reloaded = await widthsOf(again.page);
        await again.shot(`columns-${name}-${edit}-reloaded`);
        expect(reloaded.length).toBe(changed.length);
        reloaded.forEach((width, i) => {
          expect(
            Math.abs(width - (changed[i] ?? 0)),
            `column ${i}: ${changed[i]} after the change, ${width} after a reload`,
          ).toBeLessThanOrEqual(1);
        });
      });
    }
  }

  // #522: a selection of cells is one even highlight in each cell; the page's own text highlight is
  // not drawn over it or beside it (it was: boxes on the hidden pipes' widgets, offset from the cell).
  const selections: Record<string, (j: Journey) => Promise<void>> = {
    rectangle: async (j) => {
      const from = await j.pointOf('1');
      const to = await j.pointOf('4');
      await j.drag({ x: from.x + 2, y: from.y }, { x: to.x + 2, y: to.y });
    },
    row: async (j) => {
      await j.hover('1');
      await j.page.locator('.rl-grip').first().click();
      await j.page.keyboard.press('Escape');
    },
    column: async (j) => {
      await j.hover('A');
      await j.page.locator('.rl-col-grip').click();
      await j.page.keyboard.press('Escape');
    },
    table: async (j) => {
      await j.caretAfter('1');
      await j.press('ControlOrMeta+a');
      await j.press('ControlOrMeta+a');
    },
  };
  for (const [name, select] of Object.entries(selections)) {
    test(`selected cells (${name}) are one even highlight @tables`, async ({ start }) => {
      const j = await start({ doc: `Intro\n\n${TABLE}`, tracking: false, view: 'clean' });
      await j.settle();
      await select(j);
      const marked = j.page.locator('.rl-sel');
      expect(await marked.count(), 'cells are selected').toBeGreaterThan(0);
      // Nothing in the table's rows draws the page's own highlight.
      const drawn = await j.page.evaluate(() =>
        [...document.querySelectorAll('.rl-trow, .rl-trow *')].map(
          (el) => getComputedStyle(el, '::selection').backgroundColor,
        ),
      );
      expect(
        drawn.filter((color) => color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent'),
        "no text highlight in the table's rows",
      ).toEqual([]);
      for (let i = 0; i < (await marked.count()); i++) {
        expect(
          await contrastOf(marked.nth(i)),
          `text in selected cell ${i} is readable`,
        ).toBeGreaterThanOrEqual(4.5);
      }
      await j.shot(`cells-${name}`);
      if (name === 'row' || name === 'table') await j.baseline(`cells-${name}`);
    });
  }

  test("a text selection inside one cell is the page's highlight and no cell is selected", async ({
    start,
  }) => {
    const wide = '| A | B |\n| - | - |\n| alpha beta gamma | 2 |\n';
    const j = await start({ doc: `Intro\n\n${wide}`, tracking: false, view: 'clean' });
    await j.settle();
    await j.selectText('beta');
    await expect(j.page.locator('.rl-sel'), 'no cell is selected').toHaveCount(0);
    expect(await j.selectedText()).toBe('beta');
    await j.baseline('text-in-cell');
  });
});
