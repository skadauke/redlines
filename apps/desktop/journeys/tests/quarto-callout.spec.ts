// A Quarto callout whose title holds a tracked change draws the title as text, with no mark
// showing, in every look (#1169), beside the GitHub alert it must match.

import { expect, test } from '../src/journey.ts';

const DOC = [
  '# Introduction',
  '',
  '::: {.callout-note}',
  '## A note',
  '',
  'A note says something the reader should know.',
  ':::',
  '',
  '::: {.callout-tip}',
  '## A <!--ins zjh9-->useful <!--/zjh9-->tip',
  '',
  'A tip says something that helps.',
  ':::',
  '',
  '> [!TIP]',
  '> The alert beside them.',
  '',
  '<!-- redlines',
  'version: 1',
  'tracking: everyone',
  'people:',
  '  ada: {name: Ada}',
  '  bo: {name: Bo}',
  'marks:',
  '  zjh9: {by: bo, at: 2026-11-18T02:59Z}',
  '-->',
  '',
].join('\n');

test.describe('quarto callout titles @blocks', () => {
  for (const view of ['redlines', 'simple', 'clean'] as const) {
    test(`a tracked word in a callout's title, in ${view}`, async ({ start }) => {
      const j = await start({ doc: DOC, file: 'build.qmd', tracking: false, view });
      await j.caretAtEnd();
      const names = await j.page.evaluate(() =>
        [...document.querySelectorAll('.rl-quarto-head .rl-callout-name')].map(
          (name) => name.textContent,
        ),
      );
      expect(names, 'the titles of the callouts').toEqual(['A note', 'A useful tip']);
      expect(await j.page.locator('body').innerText()).not.toContain('<!--');
      await j.shot(`quarto-callout-title-${view}`);
    });
  }
});
