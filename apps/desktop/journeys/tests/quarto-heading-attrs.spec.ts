// A Quarto heading's attributes are a small, quiet chip after the text, never at heading size
// (#1170), beside the cross-reference chips they are the target of.

import { expect, test } from '../src/journey.ts';

const DOC = [
  '---',
  'title: "Chips"',
  '---',
  '',
  '# Introduction {#sec-intro}',
  '',
  'The method is in @sec-methods, and a <span>chip</span> of HTML is here.',
  '',
  '## Methods {#sec-methods .unnumbered}',
  '',
  'A paragraph under the heading.',
  '',
  '<!-- redlines',
  'version: 1',
  'tracking: everyone',
  'people:',
  '  ada: {name: Ada}',
  '-->',
  '',
].join('\n');

test.describe('quarto heading attributes @blocks', () => {
  for (const view of ['redlines', 'simple', 'clean'] as const) {
    test(`a heading's attributes are a small chip, in ${view}`, async ({ start }) => {
      const j = await start({ doc: DOC, file: 'build.qmd', tracking: false, view });
      await j.caretAtEnd();
      const chips = await j.page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('.rl-attr-chip')].map((chip) => ({
          text: chip.textContent,
          size: parseFloat(getComputedStyle(chip).fontSize),
          weight: getComputedStyle(chip).fontWeight,
          heading: parseFloat(getComputedStyle(chip.closest('.cm-line')!).fontSize),
        })),
      );
      expect(chips.map((chip) => chip.text)).toEqual(['#sec-intro', '#sec-methods .unnumbered']);
      for (const chip of chips) {
        expect(chip.size, 'smaller than its heading').toBeLessThan(chip.heading);
        expect(chip.size, 'not below the interface minimum').toBeGreaterThanOrEqual(12);
        expect(chip.weight).toBe('400');
      }
      expect(await j.page.locator('.cm-content').innerText()).not.toContain('{#');
      await j.shot(`quarto-heading-chip-${view}`);
    });
  }
});
