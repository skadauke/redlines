// Cross-references and citations are text with a fine dotted underline (#1172): a click puts the
// caret there and shows the source, ⌘-click goes to the target and scrolls the whole of it into view.

import { expect, test } from '../src/journey.ts';

const FILLER = Array.from({ length: 40 }, (_, i) => `Filler paragraph ${i + 1}, to scroll past.`);

const DOC = [
  '---',
  'title: "Links"',
  'number-sections: true',
  '---',
  '',
  '# Introduction {#sec-intro}',
  '',
  'The method is in @sec-methods, the sketch is @fig-sketch, the owners are in @tbl-owners and the mass in @eq-mass. It follows Knuth [@knuth1984] and @lamport1994.',
  '',
  ...FILLER.flatMap((line) => [line, '']),
  '# Methods {#sec-methods}',
  '',
  '| Milestone | Owner |',
  '|-----------|-------|',
  '| Review    | Ada   |',
  '| Beta      | Bo    |',
  '| Release   | Cy    |',
  '',
  ': Who owns what {#tbl-owners}',
  '',
  '$$ E = mc^2 $$ {#eq-mass}',
  '',
  '![A pencil sketch](sketch.png){#fig-sketch}',
  '',
  ...FILLER.flatMap((line) => [line, '']),
  'The end.',
  '',
].join('\n');

test.describe('quarto links @blocks', () => {
  test('references and citations are underlined text, and a ⌘-click shows the whole target', async ({
    start,
  }) => {
    const j = await start({ doc: DOC, file: 'links.qmd', tracking: false, view: 'clean' });
    // Plain text with a dotted underline, never a chip.
    const style = await j.page.evaluate(() => {
      const el = document.querySelector<HTMLElement>('.rl-xref')!;
      const css = getComputedStyle(el);
      return {
        text: el.textContent,
        line: css.textDecorationLine,
        style: css.textDecorationStyle,
        background: css.backgroundColor,
      };
    });
    expect(style.line).toContain('underline');
    expect(style.style).toBe('dotted');
    expect(style.background).toBe('rgba(0, 0, 0, 0)');
    expect(
      await j.page
        .locator('.rl-cite')
        .first()
        .evaluate((el) => getComputedStyle(el).textDecorationStyle),
    ).toBe('dotted');
    await j.shot('quarto-links-top');

    // A click puts the caret in the reference and shows its source.
    await j.page.locator('.rl-xref', { hasText: 'Table 1' }).click();
    expect(await j.page.locator('.cm-content').innerText()).toContain('@tbl-owners');

    // ⌘-click goes to the table and its caption, both in view.
    await j.page.locator('.rl-xref', { hasText: 'Equation 1' }).click();
    await j.caretAfter('The method is in');
    await j.page.locator('.rl-xref', { hasText: 'Table 1' }).click({ modifiers: ['Meta'] });
    await j.settle();
    const inView = await j.page.evaluate(() => {
      const scroller = document.querySelector('.rl-scroller')!.getBoundingClientRect();
      const lines = [...document.querySelectorAll<HTMLElement>('.cm-line, .rl-trow')];
      const inside = (needle: string) => {
        const el = lines.find((line) => (line.textContent ?? '').includes(needle));
        if (!el) return null;
        const box = el.getBoundingClientRect();
        return box.top >= scroller.top - 1 && box.bottom <= scroller.bottom + 1;
      };
      return { header: inside('Milestone'), last: inside('Cy'), caption: inside('Who owns what') };
    });
    expect(inView).toEqual({ header: true, last: true, caption: true });
    await j.shot('quarto-links-table');
  });
});
