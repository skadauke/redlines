// Math in the preview of a Quarto file (#1216): formulas are typeset as MathML, and dollar signs that
// are not math, and code, are left as they are.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { putMath, takeMath } from './math.ts';
import { renderPreview } from './render.ts';

const FIXTURE = readFileSync(new URL('../fixtures/math.qmd', import.meta.url), 'utf8');
const bodyOf = (html: string) => html.slice(html.indexOf('<body'));
const textOf = (html: string) =>
  bodyOf(html)
    .replace(/<math[\s\S]*?<\/math>/g, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&');

describe('formulas taken out of the text', () => {
  it('reads inline math and displays, with the labels', () => {
    const { text, formulas } = takeMath(
      'Mass $m$ and $$ E = mc^2 $$ {#eq-mass} and\n\n$$\nx_1\n+ y\n$$ {#eq-two}\n',
    );
    expect(formulas).toEqual([
      { tex: 'm', display: false },
      { tex: 'E = mc^2', display: true, label: 'eq-mass' },
      { tex: 'x_1\n+ y', display: true, label: 'eq-two' },
    ]);
    // Words that nothing reads as markup stand in, so no emphasis is made of `_` or `*`.
    expect(text).not.toContain('$');
    expect(text).not.toContain('x_1');
    expect(text).toMatch(/Mass RLMATHQX[a-j]+XQ and RLMATHQX[a-j]+XQ and/);
  });

  it('leaves money, escaped dollars, code and a fence as text', () => {
    const source = [
      'It costs $5 and $6, \\$x\\$ and `$c$`, and a $ lone one.',
      '',
      '```r',
      'x <- "$a$ and $$b$$"',
      '```',
    ].join('\n');
    expect(takeMath(source)).toMatchObject({ text: source, formulas: [] });
  });

  it('puts a formula back as MathML, with the number of its equation', () => {
    const taken = takeMath('$$ a^2 $$ {#eq-sq}');
    const html = putMath(`<p>${taken.text}</p>`, taken, new Map([['eq-sq', 'Equation 3']]));
    expect(html).toContain('<math');
    expect(html).toContain('class="rl-math rl-math-display"');
    expect(html).toContain('<span class="rl-math-number">(3)</span>');
    expect(html).not.toContain('RLMATHQX');
  });
});

describe('the preview of a .qmd file with math', () => {
  const page = renderPreview(FIXTURE, 'math.qmd');
  const body = bodyOf(page);

  it('typesets inline and display formulas as MathML', () => {
    expect(body.match(/<math/g)?.length).toBe(4);
    expect(body).toContain('<span class="rl-math">');
    expect(body).toContain('class="rl-math rl-math-display"');
    expect(body).toContain('<msup>');
    expect(body).toContain('<mfrac>');
  });

  it('shows no dollar signs that are math, no braces of a label and no stand-in word', () => {
    const text = textOf(page);
    expect(text).not.toContain('$$');
    expect(text).not.toContain('{#eq-');
    expect(text).not.toContain('RLMATHQX');
    expect(text).toContain('It costs $5 and $6 here');
    expect(text).toContain('`$x$` is code'.replace(/`/g, ''));
  });

  it('numbers the displays and names them in the references', () => {
    expect(body).toContain('<span class="rl-math-number">(1)</span>');
    expect(body).toContain('<span class="rl-math-number">(2)</span>');
    expect(body).toContain('<span class="rl-xref">Equation 1</span>');
  });

  it('draws a formula that Temml can’t read as its source, and no script', () => {
    const html = renderPreview('A $\\notacommand{x}$ here.\n', 'bad.qmd');
    expect(bodyOf(html)).toContain('notacommand');
    expect(bodyOf(html)).not.toContain('<script');
  });

  it('leaves a Markdown file’s dollars alone', () => {
    const html = renderPreview('A $x^2$ here.\n', 'plain.md');
    expect(bodyOf(html)).not.toContain('<math');
    expect(textOf(html)).toContain('$x^2$');
  });

  it('reads a display across lines in a file with CRLF line ends', () => {
    const { formulas } = takeMath('Intro\r\n\r\n$$\r\nx_1\r\n$$ {#eq-c}\r\n');
    expect(formulas).toEqual([{ tex: 'x_1', display: true, label: 'eq-c' }]);
    const html = renderPreview('Intro\r\n\r\n$$\r\nx_1\r\n$$ {#eq-c}\r\n', 'crlf.qmd');
    expect(bodyOf(html)).toContain('class="rl-math rl-math-display"');
    expect(textOf(html)).not.toContain('$$');
    // A lone CR ends a line too.
    expect(takeMath('A\r$$\rx\r$$\r').formulas).toHaveLength(1);
  });

  it('never takes a stand-in word that the text itself holds for a formula', () => {
    const own = 'The word RLMATHQXaXQ is the text’s own, and so is RLMATHQXQaXQ. Also $x$ here.';
    const html = renderPreview(own, 'own.qmd');
    expect(textOf(html)).toContain('RLMATHQXaXQ is the text’s own');
    expect(textOf(html)).toContain('RLMATHQXQaXQ');
    expect(bodyOf(html).match(/<math/g)).toHaveLength(1);
  });

  it('writes no live address, whatever a formula asks for (Temml’s trust stays off)', () => {
    const tex = [
      '$\\href{javascript:alert(1)}{x}$',
      '$\\url{https://example.com}$',
      '$\\href{https://example.com}{y}$',
      '$\\includegraphics{a.png}$',
      '$\\htmlId{a}{x}$',
      '$\\style{color:red}{x}$',
    ].join(' and ');
    const body = bodyOf(renderPreview(`${tex}\n`, 'trust.qmd'));
    expect(body).not.toMatch(/href\s*=/i);
    expect(body).not.toMatch(/\ssrc\s*=/i);
    expect(body).not.toMatch(/<(?:a|img|script|iframe)\b/i);
    expect(body).not.toContain('javascript:alert(1)}');
  });
});
