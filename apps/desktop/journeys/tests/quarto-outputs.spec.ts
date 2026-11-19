// The outputs that come with a Quarto file, under the chunks that made them: read from the project's
// freeze file, read-only, labeled as from the last run, and as stale for a chunk whose code has changed since it ran.
// The page has a folder in memory (`window.__redlinesFiles`) and a stand-in for picture files
// (`window.__redlinesImages`); nothing runs.

import type { Page } from '@playwright/test';
import { expect, test } from '../src/journey.ts';

declare global {
  interface Window {
    /** The development page's folder in memory, and its stand-in for picture files. */
    __redlinesFiles?: { write(path: string, text: string): void };
    __redlinesImages?: { opened: string[]; replace(path: string, blob: Blob): void };
  }
}

const FENCE = '```';

const DOC = [
  '---',
  'title: A study',
  '---',
  '',
  '# Results',
  '',
  'The sum of the first three numbers.',
  '',
  FENCE + '{r}',
  'x <- 1:3',
  'sum(x)',
  FENCE,
  '',
  'And a plot of them.',
  '',
  FENCE + '{r}',
  '#| label: fig-plot',
  'plot(x)',
  FENCE,
  '',
  'A chunk that was never run.',
  '',
  FENCE + '{r}',
  'never_run()',
  FENCE,
  '',
].join('\n');

const FROZEN = [
  '::: {.cell}',
  '',
  FENCE + '{.r .cell-code}',
  'x <- 1:3',
  'sum(x)',
  FENCE,
  '',
  '::: {.cell-output .cell-output-stdout}',
  FENCE,
  '[1] 6',
  FENCE,
  ':::',
  ':::',
  '',
  '::: {#fig-plot .cell}',
  '',
  FENCE + '{.r .cell-code}',
  'plot(x)',
  FENCE,
  '',
  '::: {.cell-output-display}',
  '![A scatter plot of x](study_files/figure-html/fig-plot-output-1.png){#fig-plot}',
  ':::',
  ':::',
  '',
].join('\n');

/** Puts the freeze file and its figure where the project keeps them. */
async function freeze(page: Page) {
  await page.evaluate(
    async ({ json }) => {
      window.__redlinesFiles!.write('_freeze/study/execute-results/html.json', json);
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 320;
      const context = canvas.getContext('2d')!;
      context.fillStyle = '#f4f4f6';
      context.fillRect(0, 0, 640, 320);
      context.fillStyle = '#1b6ec2';
      for (const [x, y] of [
        [80, 240],
        [200, 160],
        [320, 100],
        [440, 150],
        [560, 60],
      ] as const) {
        context.beginPath();
        context.arc(x, y, 12, 0, Math.PI * 2);
        context.fill();
      }
      const blob = await new Promise<Blob>((done) => canvas.toBlob((b) => done(b!), 'image/png'));
      window.__redlinesImages!.replace('_freeze/study/figure-html/fig-plot-output-1.png', blob);
    },
    { json: JSON.stringify({ hash: 'kept as a note', result: { markdown: FROZEN } }) },
  );
  // The editor reads again when the window is looked at again.
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
}

test.describe('the outputs that come with a Quarto file @views', () => {
  test('are shown under their chunks, from the last run', async ({ start }) => {
    const j = await start({ doc: DOC, file: 'study.qmd', tracking: false, view: 'clean' });
    await freeze(j.page);
    const blocks = j.page.locator('.rl-output');
    await expect(blocks).toHaveCount(2);
    await expect(blocks.first().locator('.rl-output-label')).toHaveText('Output from the last run');
    await expect(blocks.first()).toContainText('[1] 6');
    await expect(blocks.nth(1).locator('img')).toBeVisible();
    // Read-only, and under the chunk, in the order of the file.
    const [chunk, output] = await j.page.evaluate(() => {
      const first = document.querySelector('.rl-output')!;
      const codeLines = [...document.querySelectorAll('.rl-codeblock')];
      return [
        codeLines.at(2)!.getBoundingClientRect().bottom,
        first.getBoundingClientRect().top,
      ] as const;
    });
    expect(output).toBeGreaterThanOrEqual(chunk - 1);
    await j.shot('quarto-outputs');
  });

  test('say stale for the chunk whose code has changed since it ran, and only for that one', async ({
    start,
  }) => {
    const edited = DOC.replace('plot(x)', 'plot(x, col = 2)');
    const j = await start({ doc: edited, file: 'study.qmd', tracking: false, view: 'clean' });
    await freeze(j.page);
    const labels = j.page.locator('.rl-output .rl-output-label');
    await expect(labels).toHaveCount(2);
    await expect(labels.first()).toHaveText('Output from the last run');
    await expect(labels.nth(1)).toHaveText('Output from the last run, stale');
    await j.shot('quarto-outputs-stale');
  });

  test('show nothing without a freeze file', async ({ start }) => {
    const j = await start({ doc: DOC, file: 'study.qmd', tracking: false, view: 'clean' });
    await j.page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await j.page.waitForTimeout(300);
    await expect(j.page.locator('.rl-output')).toHaveCount(0);
  });
});
