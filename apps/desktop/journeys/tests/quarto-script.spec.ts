// Pandoc's subscript and superscript are drawn raised and lowered in a .qmd (#1176), in every look,
// and left as text in a .md file.

import { expect, test } from '../src/journey.ts';

const DOC = [
  'Water is H~2~O, and a square is x^2^.',
  '',
  'Strikethrough ~~stays~~ as it was, and `H~2~O` in code is code.',
  '',
  'Last.',
  '',
].join('\n');

test.describe('subscript and superscript @blocks', () => {
  for (const view of ['redlines', 'simple', 'clean'] as const) {
    test(`H~2~O and x^2^ are drawn in a qmd, in ${view}`, async ({ start }) => {
      const j = await start({ doc: DOC, file: 'chem.qmd', tracking: false, view });
      await j.caretAtEnd();
      expect(await j.page.locator('.rl-sub').allInnerTexts()).toEqual(['2']);
      expect(await j.page.locator('.rl-sup').allInnerTexts()).toEqual(['2']);
      const line = await j.page.locator('.cm-line').first().innerText();
      expect(line).toBe('Water is H2O, and a square is x2.');
      await j.shot(`quarto-script-${view}`);
    });
  }

  test('are text in a md file', async ({ start }) => {
    const j = await start({ doc: DOC, file: 'chem.md', tracking: false, view: 'clean' });
    await j.caretAtEnd();
    expect(await j.page.locator('.rl-sub, .rl-sup').count()).toBe(0);
  });
});
