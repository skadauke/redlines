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
      expect(tbl.x - (g.x + g.width), 'close to the table').toBeLessThanOrEqual(8);
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

  // #519, decided 2026-11-15: one handle per row and per column, a small pill in the margin close to
  // the table's edge; it grows when the pointer is over it; the row's and the column's look alike;
  // a click selects, a right-click opens the menu.
  test("the handles are pills close to the table that grow under the pointer, a row's and a column's alike", async ({
    start,
  }) => {
    const j = await start({ doc: `Intro\n\n${MOVE}`, tracking: false, view: 'clean' });
    await j.settle();
    const pill = (sel: string) =>
      j.page.evaluate((s) => {
        const el = document.querySelector<HTMLElement>(s);
        if (!el) return null;
        const style = getComputedStyle(el, '::before');
        return {
          width: parseFloat(style.width),
          height: parseFloat(style.height),
          fill: style.backgroundColor,
          border: style.borderTopColor,
          radius: style.borderTopLeftRadius,
          box: {
            right: el.getBoundingClientRect().right,
            bottom: el.getBoundingClientRect().bottom,
          },
        };
      }, sel);
    const tbl = (await j.page.locator('.rl-tbl').first().boundingBox())!;
    await j.hover('3');
    const row = j.page.locator('.rl-grip').first();
    const col = j.page.locator('.rl-col-grip').first();
    await expect(row, 'a row handle shows over the table').toBeVisible();
    await expect(col, 'a column handle shows over the table').toBeVisible();
    const rowAt = (await pill('.rl-grip'))!;
    const colAt = (await pill('.rl-col-grip'))!;
    // Close to the table's edges, not floating off.
    expect(
      tbl.x - rowAt.box.right,
      "the row handle is at the table's left edge",
    ).toBeLessThanOrEqual(4);
    expect(rowAt.box.right).toBeLessThanOrEqual(tbl.x);
    expect(
      tbl.y - colAt.box.bottom,
      "the column handle is at the table's top edge",
    ).toBeLessThanOrEqual(4);
    expect(colAt.box.bottom).toBeLessThanOrEqual(tbl.y);
    // Alike: the same paint and shape, the one turned.
    expect(colAt.fill).toBe(rowAt.fill);
    expect(colAt.border).toBe(rowAt.border);
    expect(colAt.radius).toBe(rowAt.radius);
    expect([colAt.width, colAt.height]).toEqual([rowAt.height, rowAt.width]);
    await j.shot('handles-at-rest');
    // They grow a little under the pointer.
    await row.hover();
    await expect
      .poll(async () => (await pill('.rl-grip'))!.width, { message: 'the row handle grows' })
      .toBeGreaterThan(rowAt.width);
    await expect.poll(async () => (await pill('.rl-grip'))!.width).toBe(rowAt.width + 3);
    const rowGrown = (await pill('.rl-grip'))!;
    expect(rowGrown.width, 'the row handle grows').toBeGreaterThan(rowAt.width);
    expect(rowGrown.height).toBeGreaterThan(rowAt.height);
    expect(rowGrown.width, 'a little').toBeLessThanOrEqual(rowAt.width + 6);
    await j.shot('row-handle-grown');
    await j.hover('3');
    await col.hover();
    await expect.poll(async () => (await pill('.rl-col-grip'))!.width).toBeGreaterThan(colAt.width);
    const colGrown = (await pill('.rl-col-grip'))!;
    expect(colGrown.width, 'the column handle grows').toBeGreaterThan(colAt.width);
    expect(colGrown.height).toBeGreaterThan(colAt.height);
    await j.shot('column-handle-grown');
    // They go when the pointer leaves the table.
    await j.page.mouse.move(2, 2);
    await expect(row).toBeHidden();
    await expect(col).toBeHidden();
  });

  test('a click on a column handle selects the column, and a right-click opens its menu, with no Move submenu', async ({
    start,
  }) => {
    const j = await start({ doc: `Intro\n\n${MOVE}`, tracking: false, view: 'clean' });
    await j.settle();
    await j.hover('1');
    const col = j.page.locator('.rl-col-grip').first();
    await col.click();
    await expect(j.page.locator('.rl-grip-menu'), 'a left-click opens none').toBeHidden();
    // The column's four cells: the header and three rows.
    expect(await selected(j.page), 'the click selects the column').toBe(4);
    await j.shot('column-handle-clicked');
    await j.hover('2');
    await col.click({ button: 'right' });
    const menu = j.page.locator('.rl-grip-menu');
    await expect(menu, 'a right-click opens the menu').toBeVisible();
    expect(await isOpaque(menu), 'the menu is opaque').toBe(true);
    await expect(menu.locator('[aria-haspopup]'), 'no submenu').toHaveCount(0);
    await j.shot('column-handle-menu');
  });

  // #622, decided 2026-11-15: Add column (right of the table, over the rightmost column), Add row
  // (below it, over the bottom row) and a corner widget that selects the table.
  for (const tracking of [false, true]) {
    const mode = `Track Changes ${tracking ? 'on' : 'off'}`;
    const view = tracking ? 'redlines' : 'clean';
    test(`Add column, Add row and Select table widgets at the table's edges, ${mode}`, async ({
      start,
    }) => {
      const j = await start({ doc: `Intro\n\n${MOVE}`, tracking, view });
      await j.settle();
      const box = async (sel: string) => (await j.page.locator(sel).first().boundingBox())!;
      // A cell of a row by its place (the markers of tracked edits hold digits of their own).
      const cell = (row: number) =>
        j.page.locator('.rl-trow:not(.rl-ghost)').nth(row).locator('.rl-tc').first();
      const addCol = j.page.locator('.rl-edge-col');
      const addRow = j.page.locator('.rl-edge-row');
      const corner = j.page.locator('.rl-table-select');
      const tbl = await box('.rl-tbl');
      // Over the first column: none of Add column; the corner widget shows with the table's handles.
      await j.hover('1');
      await expect(addCol, 'Add column is not shown over the first column').toBeHidden();
      await expect(corner, 'the corner widget shows over the table').toBeVisible();
      const c = await box('.rl-table-select');
      expect(c.x + c.width, 'the corner widget is left of the table').toBeLessThanOrEqual(tbl.x);
      expect(c.y + c.height, 'and above it').toBeLessThanOrEqual(tbl.y);
      expect(tbl.x - (c.x + c.width), 'close to the corner').toBeLessThanOrEqual(4);
      // Over the rightmost column: Add column, just right of the table.
      await j.hover('2');
      await expect(addCol, 'Add column is shown over the last column').toBeVisible();
      const a = await box('.rl-edge-col');
      expect(a.x, 'just right of the table').toBeGreaterThanOrEqual(tbl.x + tbl.width);
      expect(a.x - (tbl.x + tbl.width), 'close to the table').toBeLessThanOrEqual(6);
      expect(a.height, 'as tall as the table').toBeGreaterThan(tbl.height - 4);
      await j.shot('add-column-widget');
      // Reached from the table, it keeps showing, and a click adds a column at the end.
      await addCol.hover();
      await expect(addCol).toBeVisible();
      await expect(j.page.locator('.rl-grip-hint')).toHaveText(/Add a column/);
      await addCol.click();
      expect(await j.cmText(), 'a column is added at the end').toMatch(/\| A \| B \|[^|\n]*\|/);
      await expect(j.page.locator('.rl-th .rl-tc[data-col]')).toHaveCount(3);
      // Over the bottom row: Add row, just below the table.
      await j.hover(cell(-1));
      await expect(addRow, 'Add row is shown over the bottom row').toBeVisible();
      const tbl2 = await box('.rl-tbl');
      const r = await box('.rl-edge-row');
      expect(r.y - (tbl2.y + tbl2.height), 'just below the table').toBeLessThanOrEqual(6);
      expect(r.y).toBeGreaterThanOrEqual(tbl2.y + tbl2.height);
      await j.shot('add-row-widget');
      await j.hover(cell(2));
      await expect(addRow, 'Add row is not shown over a middle row').toBeHidden();
      await j.hover(cell(-1));
      const rows = (await j.cmText()).split('\n').filter((l) => l.startsWith('|')).length;
      await addRow.click();
      const after = (await j.cmText()).split('\n').filter((l) => l.startsWith('|')).length;
      expect(after, 'a row is added at the end').toBe(rows + 1);
      // The corner widget selects the table.
      await j.hover(cell(1));
      await corner.click();
      expect(await selected(j.page), 'the whole table is selected').toBeGreaterThanOrEqual(10);
      await j.shot('table-selected-by-widget');
      // With Track Changes on the added row and column are the tracked insertions the Table menu makes.
      const file = await j.text();
      if (tracking) expect(file, 'the additions are tracked insertions').toContain('<!--ins ');
      else expect(file).not.toContain('<!--ins ');
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
    // The line between the columns stands 8 px left of where the cells touch.
    await j.page.mouse.move(head.right - 8, head.top + 4);
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

  // #671: a new table's header cells are empty, with a faint placeholder the file doesn't hold, and
  // the caret in the first.
  for (const scheme of ['light', 'dark'] as const) {
    test(`Insert Table gives empty header cells with a placeholder, the caret in the first (${scheme}) @tables`, async ({
      start,
    }) => {
      const j = await start({ doc: 'Intro\n\n', tracking: false, view: 'clean', scheme });
      await j.caretAtEnd();
      await j.press('ControlOrMeta+Alt+t');
      await j.settle();
      expect(await j.text(), 'the header cells are empty in the file').toContain(
        '|  |  |\n| --- | --- |\n|  |  |',
      );
      expect(await j.text(), 'the placeholder is not in the file').not.toContain('Header');
      const placeholders = () =>
        j.page.evaluate(() =>
          [...document.querySelectorAll('.rl-th .rl-tc-fill')].map(
            (el) => getComputedStyle(el, '::before').content,
          ),
        );
      expect(await placeholders(), 'both header cells draw it').toEqual(['"Header"', '"Header"']);
      await j.shot(`new-table-${scheme}`);
      await j.type('Name');
      expect(await j.text(), 'typing names the first column').toContain('| Name |  |');
      await j.settle();
      expect(await placeholders(), 'only the empty cell still draws it').toEqual(['"Header"']);
      await j.shot(`new-table-named-${scheme}`);
    });
  }

  // #673: the vertical edges that belong to a column (the tint of its cells, the handles over it) stand
  // on the faint column lines, not on the cell boxes, which are half a gap to the right of them.
  for (const scheme of ['light', 'dark'] as const) {
    test(`the column handles stand on the column lines, a column's tint between them (${scheme}) @tables`, async ({
      start,
    }) => {
      const doc = '| Milestone | Owner | Date |\n| - | - | - |\n| Beta | Bob | April 3 |\n';
      const j = await start({ doc: `Intro\n\n${doc}`, tracking: false, view: 'clean', scheme });
      await j.settle();
      // The lines: half the padding right of the cell before, left of each cell but the first.
      const lines = await j.page.evaluate(() =>
        [...document.querySelectorAll('.rl-th .rl-tc[data-col]')].map((cell, i, all) => {
          const before = all[i - 1];
          const gap = before ? Number.parseFloat(getComputedStyle(before).paddingRight) / 2 : 0;
          const box = cell.getBoundingClientRect();
          return { left: box.left - gap, right: box.right };
        }),
      );
      expect(lines.length).toBe(3);
      // The + between the first two columns is on the line, not on the cells' touching edges.
      const head = (await j.page.locator('.rl-th .rl-tc').first().boundingBox())!;
      await j.page.mouse.move(lines[1]!.left, head.y + 4);
      const plus = j.page.locator('.rl-col-plus');
      await expect(plus).toBeVisible();
      const plusBox = (await plus.boundingBox())!;
      expect(
        Math.abs(plusBox.x + plusBox.width / 2 - lines[1]!.left),
        'the + stands on the column line',
      ).toBeLessThanOrEqual(1.5);
      // The column's handle is centred between its lines.
      await j.hover('Owner');
      const grip = (await j.page.locator('.rl-col-grip').boundingBox())!;
      const middle = (lines[1]!.left + lines[2]!.left) / 2;
      expect(
        Math.abs(grip.x + grip.width / 2 - middle),
        "the handle is centred between its column's lines",
      ).toBeLessThanOrEqual(1.5);
      await j.page.locator('.rl-col-grip').click();
      await j.shot(`column-tint-${scheme}`);
      await j.hover('Date');
      await expect(j.page.locator('.rl-edge-col')).toBeVisible();
      await j.shot(`column-tint-add-column-${scheme}`);
    });
  }

  // #522, decided 2026-11-15: a selection of cells, rows, columns or the table is a flat tint in the
  // editor's own selection blue, with no outline, over every cell it reaches, whether or not a
  // tracked change has tinted the cell.
  test('a table selected after tracked additions is one flat tint in the text selection blue, no outline', async ({
    start,
  }) => {
    const doc = '| Name | Role |\n| - | - |\n| Ada | Editor |\n| Grace | Reviewer |\n';
    const j = await start({ doc: `Intro text here\n\n${doc}`, tracking: true, view: 'redlines' });
    await j.settle();
    const rowsOf = () => j.page.locator('.rl-trow:not(.rl-ghost)');
    await j.hover(rowsOf().last().locator('.rl-tc').first());
    await j.page.locator('.rl-edge-row').click();
    await j.hover(rowsOf().nth(1).locator('.rl-tc').last());
    await j.page.locator('.rl-edge-col').click();
    await j.type('new');
    // Text inserted in a cell that was there: its change is the author's colour, which must not
    // stay on the blue when it is selected.
    await j.caretAfter('Ada');
    await j.type('xyz');
    await expect(j.page.locator('.rl-ins-row'), 'the added row is a tinted insertion').toHaveCount(
      1,
    );
    await expect(j.page.locator('.rl-ins-col').first(), 'the added column is tinted').toBeVisible();
    await j.hover(rowsOf().nth(1).locator('.rl-tc').first());
    await j.page.locator('.rl-table-select').click();
    await expect(j.page.locator('.rl-cell-selecting')).toHaveCount(1);
    const paint = await j.page.evaluate(() => {
      const probe = document.createElement('span');
      probe.style.backgroundColor = 'Highlight';
      probe.style.color = 'HighlightText';
      (document.querySelector('.cm-editor') ?? document.body).append(probe);
      const selection = getComputedStyle(probe).backgroundColor;
      const ink = getComputedStyle(probe).color;
      probe.remove();
      const cells = [...document.querySelectorAll<HTMLElement>('.rl-trow:not(.rl-ghost) > .rl-tc')];
      return {
        selection,
        inks: [...document.querySelectorAll<HTMLElement>('.rl-tc:has(.rl-sel) .rl-ins')].map(
          (el) => ({ color: getComputedStyle(el).color, ink }),
        ),
        cells: cells.map((cell) => {
          const style = getComputedStyle(cell);
          return {
            // The tint is painted from column line to column line (#673): a gradient over the box, and a
            // block before it over the gap; the cell's own fill (a change's tint) is not drawn.
            fill: style.backgroundImage,
            under: style.backgroundColor,
            outline: style.outlineStyle,
            shadow: style.boxShadow,
            border: style.borderTopStyle,
          };
        }),
      };
    });
    expect(paint.cells.length, 'four rows of three cells').toBe(12);
    for (const [i, cell] of paint.cells.entries()) {
      expect(cell.fill, `cell ${i} has the selection blue`).toContain(paint.selection);
      expect(cell.under, `cell ${i} shows no change's tint under it`).toBe('rgba(0, 0, 0, 0)');
      expect(cell.outline, `cell ${i} has no outline`).toBe('none');
      expect(cell.shadow, `cell ${i} has no shadow`).toBe('none');
    }
    expect(paint.inks.length, 'a change inside a selected cell is drawn').toBeGreaterThan(0);
    for (const one of paint.inks) {
      expect(one.color, 'changed text inside a selected cell takes the ink').toBe(one.ink);
    }
    await j.shot('cells-table-after-tracked-additions');
  });

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
