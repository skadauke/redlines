// What Quarto draws in the preview of a `.qmd` file (#1216): attributes as chips, a table's caption,
// references as their targets' labels, and subscripts and superscripts; Markdown files and code are
// left as they are.

import { describe, expect, it } from 'vitest';
import { renderPreview } from './render.ts';
import { targetsOf } from './quarto.ts';

const FIXTURE = [
  '---',
  'title: "Quarto"',
  'number-sections: true',
  '---',
  '',
  '# Introduction {#sec-intro}',
  '',
  'The method is in @sec-methods, the sketch is @fig-sketch, and the owners are in @tbl-owners. Water is H~2~O, a square is x^2^, `H~2~O` is code, and ~~this~~ is struck.',
  '',
  '# Methods {#sec-methods}',
  '',
  '![A pencil sketch](sketch.png){#fig-sketch}',
  '',
  '| Milestone | Owner |',
  '|-----------|-------|',
  '| Review    | Ada   |',
  '',
  ': Who owns what {#tbl-owners}',
  '',
].join('\n');

/** The body of a page, without its style sheet and fonts. */
const bodyOf = (html: string) => html.slice(html.indexOf('<body'));

/** The text of the body of a page, with no tags. */
const textOf = (html: string) =>
  html
    .slice(html.indexOf('<body'))
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&');

describe('the targets of a Quarto file', () => {
  it('are numbered in the order of the document, and sections as the file asks', () => {
    const targets = targetsOf(FIXTURE);
    expect(targets.get('fig-sketch')).toBe('Figure 1');
    expect(targets.get('tbl-owners')).toBe('Table 1');
    expect(targets.get('sec-intro')).toBe('Section 1');
    expect(targets.get('sec-methods')).toBe('Section 2');
    // With no `number-sections`, a section is named by its title.
    expect(targetsOf('# Intro {#sec-intro}\n').get('sec-intro')).toBe('Intro');
  });
});

describe('the preview of a .qmd file', () => {
  const page = bodyOf(renderPreview(FIXTURE, 'quarto.qmd'));

  it('draws attributes as a chip, and shows no braces', () => {
    expect(page).toContain('<span class="rl-attr-chip">#sec-intro</span>');
    expect(page).toContain('<span class="rl-attr-chip">#fig-sketch</span>');
    expect(textOf(page)).not.toContain('{#');
  });

  it('draws the table’s caption, with its label', () => {
    expect(page).toContain(
      '<p class="rl-caption"><span class="rl-caption-label">Table 1:</span> Who owns what',
    );
    expect(textOf(page)).not.toMatch(/^: /m);
  });

  it('draws references as their labels, and leaves a missing target as it is', () => {
    expect(page).toContain('<span class="rl-xref">Section 2</span>');
    expect(page).toContain('<span class="rl-xref">Figure 1</span>');
    expect(page).toContain('<span class="rl-xref">Table 1</span>');
    expect(textOf(renderPreview('See @fig-none.\n', 'x.qmd'))).toContain('@fig-none');
  });

  it('draws subscripts and superscripts, and not in code or strikethrough', () => {
    expect(page).toContain('H<sub>2</sub>O');
    expect(page).toContain('x<sup>2</sup>');
    expect(page).toContain('<code>H~2~O</code>');
    expect(page).toContain('<del>this</del>');
  });

  it('leaves a Markdown file as it was', () => {
    const md = bodyOf(renderPreview(FIXTURE, 'quarto.md'));
    expect(md).not.toContain('rl-xref');
    expect(md).not.toContain('<sub>');
    expect(textOf(md)).toContain('{#sec-intro}');
  });
});
