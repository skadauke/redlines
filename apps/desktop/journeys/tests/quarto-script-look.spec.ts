// The look of subscript and superscript (#1176): set as typeset text, beside plain text, in a
// heading and in a link, and the line's height doesn't change.

import { expect, test } from '../src/journey.ts';

const DOC = [
  '# Heading with x^2^ and H~2~O',
  '',
  'Plain text: x2 and H2O, and a [link to x2 and H2O](https://example.org).',
  '',
  'Plain again: x2 and H2O, and a [link to x2 and H2O](https://example.org).',
  '',
  'Scripted text: x^2^ and H~2~O, and a [link to x^2^ and H~2~O](https://example.org).',
  '',
].join('\n');

test.describe('subscript and superscript look @blocks', () => {
  test('are set like typeset text, in a paragraph, a heading and a link', async ({ start }) => {
    const j = await start({ doc: DOC, file: 'look.qmd', tracking: false, view: 'clean' });
    await j.caretAfter('Heading');
    const m = await j.page.evaluate(() => {
      const lines = [...document.querySelectorAll<HTMLElement>('.cm-line')];
      const find = (start: string) => lines.find((l) => (l.textContent ?? '').startsWith(start))!;
      const heights = [
        0,
        find('Plain again').getBoundingClientRect().height,
        find('Scripted').getBoundingClientRect().height,
      ];
      const sup = find('Scripted').querySelector<HTMLElement>('.rl-sup')!;
      const base = sup.parentElement!;
      const sr = sup.getBoundingClientRect();
      let prev: Node | null = sup.previousSibling;
      while (prev && !(prev.nodeType === 3 && (prev.textContent ?? '') !== '')) {
        prev = prev.previousSibling;
      }
      const range = document.createRange();
      range.setStart(prev!, (prev!.textContent ?? '').length - 1);
      range.setEnd(prev!, (prev!.textContent ?? '').length);
      const br = range.getBoundingClientRect();
      return {
        heights,
        ratio:
          parseFloat(getComputedStyle(sup).fontSize) / parseFloat(getComputedStyle(base).fontSize),
        gap: sr.left - br.right,
        inLink: document.querySelectorAll('a .rl-sup, .rl-link .rl-sup, .rl-sup').length,
        inHeading: document.querySelectorAll('.rl-h1 .rl-sup').length,
      };
    });
    expect(m.ratio).toBeCloseTo(0.75, 1);
    expect(Math.abs(m.gap), 'no space between the base and the script').toBeLessThan(1.5);
    expect(m.inHeading).toBe(1);
    // The line with scripts is as high as the line of plain text.
    expect(Math.abs(m.heights[2]! - m.heights[1]!)).toBeLessThan(1.5);
    await j.shot('quarto-script-look');
  });
});
