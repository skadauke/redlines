// Tables: adding one, its grips and their menu, and typing over cells.

import { expect, test } from '../src/journey.ts';
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

  // #519: a click on a grip selects its row, a right-click opens the menu, a drag moves the row.
  test('a row grip opens its menu on a right-click, and a left-click selects the row and opens none', async ({
    start,
  }) => {
    const j = await start({ doc: `Intro\n\n${TABLE}`, tracking: false, view: 'clean' });
    await j.settle();
    await j.hover('1');
    const grip = j.page.locator('.rl-grip').first();
    await expect(grip).toBeVisible();
    await grip.click();
    await expect(j.page.locator('.rl-grip-menu'), 'left-click opens none').toBeHidden();
    await expect(j.page.locator('.rl-sel').first(), 'the click selects the row').toBeVisible();
    await j.shot('row-grip-clicked');
    await j.hover('3');
    await grip.click({ button: 'right' });
    await expect(j.page.locator('.rl-grip-menu'), 'right-click opens the menu').toBeVisible();
    await j.page.keyboard.press('Escape');
    await expect(j.page.locator('.rl-grip-menu')).toBeHidden();
  });

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

  // Menus that only refuse are disabled: Move Row Up at the first row, Move Row Down at the last.
  test('the row grip menu disables Move Row Up at the first row and Move Row Down at the last', async ({
    start,
  }) => {
    const j = await start({ doc: `Intro\n\n${TABLE}`, tracking: false, view: 'clean' });
    await j.settle();
    const grip = j.page.locator('.rl-grip').first();
    const menu = j.page.locator('.rl-grip-menu');
    const item = (name: string) =>
      menu.locator('.rl-grip-item', { hasText: new RegExp(`^${name}$`) });
    await j.hover('A');
    await grip.click({ button: 'right' });
    await expect(menu).toBeVisible();
    await expect(item('Move Row Up'), 'disabled at the first row').toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await expect(item('Move Row Down')).not.toHaveAttribute('aria-disabled', 'true');
    await j.shot('row-grip-menu-first-row');
    await j.page.keyboard.press('Escape');
    await j.hover('3');
    await grip.click({ button: 'right' });
    await expect(menu).toBeVisible();
    await expect(item('Move Row Down'), 'disabled at the last row').toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await expect(item('Move Row Up')).not.toHaveAttribute('aria-disabled', 'true');
    await j.shot('row-grip-menu-last-row');
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

  // #519: moving rows and columns by their grips. No cell is highlighted while a drag lasts; the drop
  // line is a thick gray one that shows only where the row or column would go, never at its own place.
  const MOVE = '| A | B |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |\n| 5 | 6 |\n';
  const MOVE3 = '| A | B | C |\n| - | - | - |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n';
  type Pg = import('@playwright/test').Page;
  const selected = (page: Pg) => page.locator('.rl-sel').count();
  /** The drop line's box and paint, and the token it should be painted in. */
  const dropLine = (page: Pg) =>
    page.evaluate(() => {
      const line = document.querySelector<HTMLElement>('.rl-drop-line');
      if (!line) return null;
      const probe = document.createElement('span');
      probe.style.color = 'var(--rl-ink-2)';
      document.body.append(probe);
      const token = getComputedStyle(probe).color;
      probe.remove();
      const box = line.getBoundingClientRect();
      return {
        shown: !line.hidden && getComputedStyle(line).display !== 'none',
        paint: getComputedStyle(line).backgroundColor,
        token,
        width: box.width,
        height: box.height,
        boundary: line.dataset['boundary'],
      };
    });

  for (const tracking of [false, true]) {
    const mode = `Track Changes ${tracking ? 'on' : 'off'}`;
    const view = tracking ? 'redlines' : 'clean';

    test(`dragging a row highlights nothing, and draws a thick gray line only at a real target, ${mode}`, async ({
      start,
    }) => {
      const j = await start({ doc: `Intro\n\n${MOVE}`, tracking, view });
      await j.settle();
      // A row selected by a click before: it is not highlighted during the drag.
      await j.hover('5');
      await j.page.locator('.rl-grip').first().click();
      expect(await selected(j.page), 'the click highlights the row').toBeGreaterThan(0);
      await j.hover('1');
      const grip = j.page.locator('.rl-grip').first();
      const box = (await grip.boundingBox())!;
      const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      const last = await j.pointOf('5');
      await j.page.mouse.move(at.x, at.y);
      await j.page.mouse.down();
      // Over its own place first: the pointer has moved, and there is no line.
      await j.page.mouse.move(at.x + 30, at.y + 4, { steps: 4 });
      expect(await selected(j.page), 'nothing is highlighted in a drag').toBe(0);
      expect(await dropLine(j.page), 'no line at its own place').toMatchObject({ shown: false });
      await j.shot('row-drag-own-place');
      // Below the last row: a line.
      await j.page.mouse.move(at.x + 30, last.y + 30, { steps: 10 });
      const line = await dropLine(j.page);
      expect(line, 'a line at the target').toMatchObject({ shown: true });
      expect(line?.paint, 'the line is the theme gray').toBe(line?.token);
      expect(line?.height, 'a thick line').toBeGreaterThanOrEqual(3);
      expect(await selected(j.page), 'nothing is highlighted in a drag').toBe(0);
      await j.shot('row-drag-target');
      await j.page.mouse.up();
      await j.settle();
      const text = await j.text();
      if (tracking) expect(text).toMatch(/<!--del \w+ row=1 /);
      else expect(text).toContain('| 3 | 4 |\n| 5 | 6 |\n| 1 | 2 |');
      expect(await dropLine(j.page), 'the line goes at the drop').toBeNull();
      await j.shot('row-dropped');
    });

    test(`a row dropped at its own place changes nothing, ${mode}`, async ({ start }) => {
      const doc = `Intro\n\n${MOVE}`;
      const j = await start({ doc, tracking, view });
      await j.settle();
      await j.hover('3');
      const box = (await j.page.locator('.rl-grip').first().boundingBox())!;
      const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      const row = await j.pointOf('3');
      await j.page.mouse.move(at.x, at.y);
      await j.page.mouse.down();
      await j.page.mouse.move(at.x + 20, row.y + 6, { steps: 6 });
      expect(await dropLine(j.page)).toMatchObject({ shown: false });
      await j.page.mouse.up();
      await j.settle();
      expect(await j.text(), 'the document is as it was').toBe(doc);
    });

    test(`dragging a column highlights nothing, and draws a thick gray vertical line only at a real target, ${mode}`, async ({
      start,
    }) => {
      const j = await start({ doc: `Intro\n\n${MOVE3}`, tracking, view });
      await j.settle();
      await j.hover('1');
      const cells = await j.page.evaluate(() =>
        [...document.querySelectorAll('.rl-th .rl-tc')].map((c) => {
          const r = c.getBoundingClientRect();
          return { left: r.left, right: r.right, top: r.top };
        }),
      );
      const first = cells[0]!;
      const third = cells[2]!;
      await j.page.mouse.move(first.left + 30, first.top + 10);
      const grip = j.page.locator('.rl-col-grip').first();
      await expect(grip).toBeVisible();
      const box = (await grip.boundingBox())!;
      const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      await j.page.mouse.move(at.x, at.y);
      await j.page.mouse.down();
      await j.page.mouse.move(at.x + 12, at.y, { steps: 3 });
      expect(await selected(j.page), 'nothing is highlighted in a drag').toBe(0);
      expect(await dropLine(j.page), 'no line at its own place').toMatchObject({ shown: false });
      await j.page.mouse.move(third.right - 6, at.y, { steps: 10 });
      const line = await dropLine(j.page);
      expect(line, 'a line at the target').toMatchObject({ shown: true });
      expect(line?.paint, 'the line is the theme gray').toBe(line?.token);
      expect(line?.width, 'a thick line').toBeGreaterThanOrEqual(3);
      await j.shot('column-drag-target');
      await j.page.mouse.up();
      await j.settle();
      const text = await j.text();
      if (tracking) expect(text).toMatch(/<!--del \w+ col=/);
      else expect(text).toContain('| B | C | A |');
    });
  }

  // The grips stay reachable, close to the table's edge, when the margins are narrow: a narrow
  // window, and a large text size (a window zoom narrows the window in the same way).
  for (const [width, textSize] of [
    [480, 1],
    [640, 1],
    [640, 2],
  ] as const) {
    test(`the grips stay beside the table in a window ${width} px wide at ${textSize * 100}%, with their hints and menu`, async ({
      start,
      page,
    }) => {
      await page.setViewportSize({ width, height: 700 });
      const j = await start({ doc: `Intro\n\n${MOVE}`, tracking: false, view: 'clean', textSize });
      await j.settle();
      await j.hover('3');
      const grip = j.page.locator('.rl-grip').first();
      await expect(grip).toBeVisible();
      const tbl = (await j.page.locator('.rl-tbl').first().boundingBox())!;
      const g = (await grip.boundingBox())!;
      expect(g.x, 'inside the window').toBeGreaterThanOrEqual(4);
      expect(g.x + g.width, 'not over the table').toBeLessThanOrEqual(tbl.x);
      expect(tbl.x - (g.x + g.width), 'close to the table').toBeLessThanOrEqual(30);
      // The pointer reaches it from the table, and it hints and opens its menu.
      await grip.hover();
      await expect(j.page.locator('.rl-grip-hint')).toHaveText(/move the row/);
      await j.shot(`narrow-${width}-grip-hint`);
      await grip.click({ button: 'right' });
      const menu = j.page.locator('.rl-grip-menu');
      await expect(menu).toBeVisible();
      const m = (await menu.boundingBox())!;
      expect(m.x, 'the menu is inside the window').toBeGreaterThanOrEqual(0);
      expect(m.x + m.width, 'the menu is inside the window').toBeLessThanOrEqual(width);
      await j.shot(`narrow-${width}-grip-menu`);
    });
  }

  test('the + and the column grip have hover hints too', async ({ start }) => {
    const j = await start({ doc: `Intro\n\n${MOVE}`, tracking: false, view: 'clean' });
    await j.settle();
    const tip = j.page.locator('.rl-grip-hint');
    const cells = await j.page.evaluate(() =>
      [...document.querySelectorAll('.rl-th .rl-tc')].map((c) => {
        const r = c.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      }),
    );
    const head = cells[0]!;
    // The column grip, above the column.
    await j.page.mouse.move(head.left + 40, head.top + 10);
    const colGrip = j.page.locator('.rl-col-grip');
    await expect(colGrip).toBeVisible();
    await colGrip.hover();
    await expect(tip, 'the column grip has a hint').toHaveText(/move the column/);
    // The + between rows: in the strip left of the table, at the boundary under the header.
    await j.page.mouse.move(head.left - 10, head.bottom);
    const plus = j.page.locator('.rl-plus');
    await expect(plus).toBeVisible();
    await plus.hover();
    await expect(tip, 'the + between rows has a hint').toHaveText(/Add a row/);
    // The + between columns: at the boundary between the first two, in the strip above the table.
    await j.page.mouse.move(head.right, head.top + 4);
    const colPlus = j.page.locator('.rl-col-plus');
    await expect(colPlus).toBeVisible();
    await colPlus.hover();
    await expect(tip, 'the + between columns has a hint').toHaveText(/Add a column/);
    await j.shot('column-plus-hint');
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

  // #520: typing in a table moves the widths after a pause (about 300 ms), not on each key, and
  // they end as a reload of the same text gives them.
  test('typing a long word into a narrow column widens it after a pause, as a reload does @tables', async ({
    start,
  }) => {
    const doc = 'Intro\n\n| Name | Notes |\n| - | - |\n| Ada | x |\n';
    const j = await start({ doc, tracking: false, view: 'clean' });
    await j.settle();
    const before = await widthsOf(j.page);
    await j.caretAfter('Ada');
    await j.shot('widths-typing-before');
    await j.type('xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
    await j.page.waitForTimeout(700);
    await j.settle();
    const typed = await widthsOf(j.page);
    await j.shot('widths-typing-after');
    expect(typed[0], 'the column widened while the caret stayed in the table').toBeGreaterThan(
      (before[0] ?? 0) + 20,
    );
    const again = await start({ doc: await j.text(), tracking: false, view: 'clean' });
    await again.settle();
    const reloaded = await widthsOf(again.page);
    reloaded.forEach((width, i) => {
      expect(
        Math.abs(width - (typed[i] ?? 0)),
        `column ${i}: ${typed[i]} after typing, ${width} after a reload`,
      ).toBeLessThanOrEqual(1);
    });
  });

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
    },
    column: async (j) => {
      await j.hover('A');
      await j.page.locator('.rl-col-grip').click();
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

  test('a rectangle over an empty cell leaves no page highlight in it', async ({ start }) => {
    const gap = '| A | B |\n| - | - |\n| 1 |  |\n| 3 | 4 |\n';
    const j = await start({ doc: `Intro\n\n${gap}`, tracking: false, view: 'clean' });
    await j.settle();
    const from = await j.pointOf('1');
    const to = await j.pointOf('4');
    await j.drag({ x: from.x + 2, y: from.y }, { x: to.x + 2, y: to.y });
    await expect(
      j.page.locator('.rl-cell-selecting'),
      'the editor knows cells are selected',
    ).toHaveCount(1);
    const drawn = await j.page.evaluate(() =>
      [...document.querySelectorAll('.rl-trow, .rl-trow *')]
        .map((el) => getComputedStyle(el, '::selection').backgroundColor)
        .filter((color) => color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent'),
    );
    expect(drawn, "no text highlight in the table's rows").toEqual([]);
    await j.shot('cells-rectangle-empty');
  });

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
