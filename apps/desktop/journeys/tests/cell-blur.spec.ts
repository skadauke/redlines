// A cell selection in an editor that has lost focus (#734): drawn as it is with the focus, with no
// bands between the rows. The focus goes to another input on the page, and the window blur is sent
// as the system sends it.

import type { Page } from '@playwright/test';
import { expect, test, type Journey } from '../src/journey.ts';

const TABLE = '| A | B | C |\n| - | - | - |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n| 7 | 8 | 9 |\n';

/** The paint of every selected cell, and what lies between the rows. */
const paint = (page: Page) =>
  page.evaluate(() => {
    const cells = [...document.querySelectorAll<HTMLElement>('.rl-tc')].filter((cell) =>
      cell.querySelector('.rl-sel'),
    );
    return {
      focused: document.activeElement?.className ?? '',
      cells: cells.length,
      fills: [
        ...new Set(
          cells.map((cell) => getComputedStyle(cell.querySelector('.rl-sel')!).backgroundColor),
        ),
      ],
      cellFills: [...new Set(cells.map((cell) => getComputedStyle(cell).backgroundColor))],
      selection: [
        ...new Set(
          [...document.querySelectorAll('.rl-trow, .rl-trow *')]
            .map((el) => getComputedStyle(el, '::selection').backgroundColor)
            .filter((color) => color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent'),
        ),
      ],
    };
  });

async function selectCells(j: Journey) {
  const from = await j.pointOf('1');
  const to = await j.pointOf('8');
  await j.drag({ x: from.x + 2, y: from.y }, { x: to.x + 2, y: to.y });
  await expect(j.page.locator('.rl-cell-selecting')).toHaveCount(1);
}

test.describe('a cell selection that has lost the focus @tables', () => {
  for (const scheme of ['light', 'dark'] as const) {
    for (const how of ['another input', 'window blur'] as const) {
      test(`is drawn as with the focus, with no bands (${how}, ${scheme})`, async ({ start }) => {
        const j = await start({
          doc: `Intro\n\n${TABLE}`,
          tracking: false,
          view: 'clean',
          scheme,
        });
        await j.settle();
        await selectCells(j);
        const focused = await paint(j.page);
        expect(focused.cells, 'a 2 by 3 block of cells').toBe(6);
        await j.shot(`cells-focused-${scheme}`);
        if (how === 'another input') {
          await j.page.evaluate(() => {
            const input = document.createElement('input');
            input.id = 'elsewhere';
            input.style.cssText = 'position:fixed;left:8px;bottom:8px;';
            document.body.append(input);
            input.focus();
          });
        } else {
          await j.page.evaluate(() => {
            (document.activeElement as HTMLElement | null)?.blur();
            window.dispatchEvent(new Event('blur'));
          });
        }
        await expect(j.page.locator('.cm-editor.cm-focused')).toHaveCount(0);
        const blurred = await paint(j.page);
        expect(blurred.cells, 'the cells are still selected').toBe(6);
        expect(blurred.fills, 'the same paint on the cells').toEqual(focused.fills);
        expect(blurred.cellFills, 'and on their grounds').toEqual(focused.cellFills);
        expect(blurred.selection, 'no page highlight bands between the rows').toEqual(
          focused.selection,
        );
        await j.shot(`cells-blurred-${how === 'window blur' ? 'window' : 'input'}-${scheme}`);
      });
    }
  }
});
