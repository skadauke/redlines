// A Quarto table's caption is drawn as a caption, with its label and its attributes as a chip, and
// not as source (#1212), in every look.

import { expect, test } from '../src/journey.ts';

const DOC = [
  '# Methods {#sec-methods}',
  '',
  'Who owns what is in @tbl-owners.',
  '',
  '| Milestone | Owner |',
  '|-----------|-------|',
  '| Review    | Ada   |',
  '| Beta      | Bo    |',
  '',
  ': Who owns what {#tbl-owners}',
  '',
  'A paragraph after the table.',
  '',
].join('\n');

test.describe('quarto table captions @tables', () => {
  for (const view of ['redlines', 'simple', 'clean'] as const) {
    test(`a table's caption is drawn as one, in ${view}`, async ({ start }) => {
      const j = await start({ doc: DOC, file: 'build.qmd', tracking: false, view });
      await j.caretAtEnd();
      const caption = await j.page.evaluate(() => {
        const line = document.querySelector('.rl-table-caption');
        return {
          text: line?.textContent ?? null,
          chip: line?.querySelector('.rl-attr-chip')?.textContent ?? null,
        };
      });
      expect(caption.text).toBe('Table 1: #tbl-owners'.replace('#tbl-owners', 'Who owns what #tbl-owners'));
      expect(caption.chip).toBe('#tbl-owners');
      expect(await j.page.locator('.cm-content').innerText()).not.toContain('{#tbl');
      await j.shot(`quarto-table-caption-${view}`);
    });
  }
});
