// A div that is not a callout is drawn as a small chip for its opening fence and nothing for its
// closing one (#1213), in every look, beside a callout.

import { expect, test } from '../src/journey.ts';

const DOC = [
  '---',
  'title: "Divs"',
  '---',
  '',
  '::: {.callout-warning title="Mind the gap"}',
  'A callout with a title.',
  ':::',
  '',
  '::: {.columns}',
  '::: {.column width="50%"}',
  'Left.',
  ':::',
  '::: {.column width="50%"}',
  'Right.',
  ':::',
  ':::',
  '',
  'After the columns.',
  '',
].join('\n');

test.describe('quarto divs @blocks', () => {
  for (const view of ['redlines', 'simple', 'clean'] as const) {
    test(`a div that is not a callout is a chip, in ${view}`, async ({ start }) => {
      const j = await start({ doc: DOC, file: 'divs.qmd', tracking: false, view });
      await j.caretAtEnd();
      const chips = await j.page.evaluate(() =>
        [...document.querySelectorAll('.rl-div-chip')].map((chip) => chip.textContent),
      );
      expect(chips).toEqual(['columns', 'column width=50%', 'column width=50%']);
      const text = await j.page.locator('.cm-content').innerText();
      expect(text).not.toContain(':::');
      expect(text).not.toContain('{.');
      await j.shot(`quarto-div-${view}`);
    });
  }
});
