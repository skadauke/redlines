// #1208: the sheet of every interface element, taken through its states (at rest, hovered, chosen
// with the keys, selected, dragged) in Redlines, Clean and Simple, in the light and the dark theme,
// for the look sweep's screenshots; and families of siblings held to agree in their computed styles.
// The page is the dev page's sheet (apps/desktop/src/sheet-check.ts, `?sheet-check`); the specimens,
// the families and the disagreements that stand today (KNOWN, each with its issue) are in
// src/sheet.ts. Besides each element's picture, a run writes one contact sheet per family and view
// (`sheet-<family>-<view>.png`): the family's specimens in rows, their states in columns.

import { readFileSync } from 'node:fs';
import { expect, test, type Journey, type ViewName } from '../src/journey.ts';
import { shotName, writeShot } from '../src/shots.ts';
import {
  disagreements,
  judgeDisagreements,
  release,
  SPECIMENS,
  STATES,
  styleOf,
  type Disagreement,
  type State,
  type Style,
} from '../src/sheet.ts';

const VIEWS: ViewName[] = ['redlines', 'clean', 'simple'];

/** The window around an element, for its picture. */
async function around(j: Journey, selector: string, pad = 60) {
  const box = await j.page.locator(selector).filter({ visible: true }).first().boundingBox();
  if (!box) return undefined;
  const x = Math.max(0, box.x - pad);
  const y = Math.max(0, box.y - pad);
  return {
    x,
    y,
    width: Math.max(160, Math.min(1280 - x, box.width + pad * 2)),
    height: Math.max(100, Math.min(800 - y, box.height + pad * 2)),
  };
}

type Cells = Record<string, Partial<Record<State, string>>>;

/** One picture of a family: a row for each specimen, a column for each state. */
async function contactSheet(
  j: Journey,
  info: Parameters<typeof writeShot>[1],
  name: string,
  rows: Cells,
  dark: boolean,
) {
  const page = await j.page.context().newPage();
  try {
    const cell = (state: State, path: string | undefined) =>
      path
        ? `<td><img src="data:image/png;base64,${readFileSync(path).toString('base64')}"></td>`
        : `<td class="none">${state === 'rest' ? '' : 'none'}</td>`;
    const html = `<!doctype html><meta charset=utf-8><style>
      body{margin:12px;font:13px -apple-system,system-ui,sans-serif;background:${dark ? '#1c1c1e' : '#fff'};color:${dark ? '#ddd' : '#333'}}
      table{border-collapse:separate;border-spacing:8px}
      th,td{vertical-align:top;text-align:left;font-weight:600}
      td.none{color:#999;font-weight:400;vertical-align:middle}
      img{display:block;max-width:360px;border:1px solid ${dark ? '#444' : '#ddd'}}
    </style><table><tr><th></th>${STATES.map((s) => `<th>${s}</th>`).join('')}</tr>
    ${Object.entries(rows)
      .map(
        ([row, cells]) =>
          `<tr><th>${row}</th>${STATES.map((s) => cell(s, cells[s])).join('')}</tr>`,
      )
      .join('')}</table>`;
    await page.setContent(html);
    await page.setViewportSize({ width: 1280, height: 800 });
    const size = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
    }));
    await writeShot(page, info, shotName(name, j.options), {
      clip: { x: 0, y: 0, width: size.width, height: size.height },
    });
  } finally {
    await page.close();
  }
}

test.describe('the sheet of every interface element (#1208) @views @tables @blocks', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`every element, in every state and view, in the ${scheme} theme`, async ({
      start,
    }, info) => {
      test.setTimeout(5 * 60_000);
      const j = await start({ scheme });
      j.page.setDefaultTimeout(3000);
      const lines: string[] = [];
      j.page.on('console', (message) => {
        if (message.text().startsWith('SHEET-CHECK')) lines.push(message.text());
      });
      await j.page.goto('/?sheet-check');
      await expect
        .poll(() => lines.some((line) => line.includes('done')), { timeout: 20_000 })
        .toBe(true);
      expect(
        lines.filter((line) => line.includes('FAIL')),
        'the sheet draws every part',
      ).toEqual([]);

      const styles: Record<string, Style | null> = {};
      const unreached: string[] = [];
      const found: Disagreement[] = [];
      for (const view of VIEWS) {
        await j.page.evaluate((v) => window.__redlines!.editor.setViewMode(v), view);
        await j.settle();
        const sheets = new Map<string, Cells>();
        for (const specimen of SPECIMENS) {
          if (specimen.views && !specimen.views.includes(view)) continue;
          const row: Cells[string] = {};
          for (const state of STATES) {
            const reach = specimen.reach[state];
            if (!reach) continue;
            try {
              await reach(j);
              await j.settle();
            } catch (error) {
              unreached.push(`${view}/${specimen.name}/${state}: ${String(error).split('\n')[0]}`);
              await release(j.page);
              continue;
            }
            const style = await styleOf(j.page, specimen, state);
            styles[`${view}/${specimen.name}/${state}`] = style;
            const name = `${view}-${specimen.name}-${state}`;
            if (style === null && specimen.mayVanish?.includes(state)) {
              row[state] = await j.shot(name);
            } else if (style === null) {
              unreached.push(`${view}/${specimen.name}/${state}: the element isn't there`);
            } else {
              const clip = specimen.frame
                ? await around(j, specimen.frame, 16)
                : await around(j, specimen.selectorFor?.[state] ?? specimen.selector);
              row[state] = await j.shot(name, clip ? { clip } : {});
            }
            await release(j.page);
          }
          sheets.set(specimen.family, { ...sheets.get(specimen.family), [specimen.name]: row });
        }
        for (const [family, rows] of sheets) {
          await contactSheet(j, info, `sheet-${family}-${view}`, rows, scheme === 'dark');
        }
        found.push(...disagreements(styles, view));
      }

      expect(unreached, 'every state is reached').toEqual([]);
      // The same disagreement in each view is one.
      const once = [
        ...new Map(found.map((d) => [`${d.family}/${d.prop}/${d.detail}`, d])).values(),
      ];
      const { unknown, gone } = judgeDisagreements(once);
      expect(unknown, 'siblings that disagree and no open issue knows').toEqual([]);
      expect(gone, 'known disagreements that were fixed').toEqual([]);
    });
  }
});
