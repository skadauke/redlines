import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { markdownToHtml } from './markdown.ts';
import { renderPreview } from './render.ts';

const fixture = (name: string) =>
  readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');

describe('Pandoc divs', () => {
  it('draws a callout as a labelled box, and not as text with its fences', () => {
    const html = markdownToHtml('::: {.callout-note}\nA callout, with *emphasis*.\n:::\n');
    expect(html).toContain('<div class="rl-callout rl-callout-note">');
    expect(html).toContain('<p class="rl-callout-label">Note</p>');
    expect(html).toContain('<p>A callout, with <em>emphasis</em>.</p>');
    expect(html).not.toContain(':::');
    expect(html.split('<div').length).toBe(html.split('</div>').length);
  });

  it.each([
    ['note', 'Note'],
    ['tip', 'Tip'],
    ['warning', 'Warning'],
    ['important', 'Important'],
    ['caution', 'Caution'],
  ])('labels .callout-%s as %s', (kind, label) => {
    const html = markdownToHtml(`::: {.callout-${kind}}\nText.\n:::\n`);
    expect(html).toContain(`<p class="rl-callout-label">${label}</p>`);
  });

  it('labels a callout with its title, escaped', () => {
    const html = markdownToHtml('::: {.callout-tip title="Use <b> & more"}\nText.\n:::\n');
    expect(html).toContain('<p class="rl-callout-label">Use &lt;b&gt; &amp; more</p>');
  });

  it('takes a bare class as Pandoc does', () => {
    expect(markdownToHtml('::: callout-warning\nText.\n:::\n')).toContain('rl-callout-warning');
  });

  it('draws any other div as its text', () => {
    const html = markdownToHtml('::: {.columns}\n::: {.column width="50%"}\nLeft.\n:::\n:::\n');
    expect(html).toBe('<p>Left.</p>\n');
  });

  it('draws what a callout holds as Markdown, with blocks', () => {
    const html = markdownToHtml('::: {.callout-note}\n## Title\n\n- one\n- two\n:::\n');
    expect(html).toContain('<h2>Title</h2>');
    expect(html).toContain('<li>two</li>');
  });

  it('nests callouts and divs, and keeps the text around them', () => {
    const html = markdownToHtml(
      'Before.\n::: {.callout-note}\nIn.\n::: {.callout-tip}\nInner.\n:::\n:::\nAfter.\n',
    );
    expect(html).toMatch(/<p>Before\.<\/p>\n<div class="rl-callout rl-callout-note">/);
    expect(html).toMatch(/Inner\.<\/p>\n?<\/div><\/div>\n?<\/div><\/div>\n?<p>After\.<\/p>/);
    expect(html.split('<div').length).toBe(html.split('</div>').length);
  });

  it('closes a callout that the text leaves open', () => {
    const html = markdownToHtml('::: {.callout-note}\nNo end.\n');
    expect(html).toContain('No end.');
    expect(html.split('<div').length).toBe(html.split('</div>').length);
  });

  it('leaves a closing fence with nothing open, and a fence with prose, as text', () => {
    expect(markdownToHtml('Text.\n\n:::\n')).toContain(':::');
    expect(markdownToHtml('::: some words here\n')).toContain('::: some words here');
    expect(markdownToHtml('::: {.callout-note\n')).toContain('::: {.callout-note');
  });

  it('ignores a fence in a code block, fenced or indented, or in a comment', () => {
    for (const source of [
      '```\n::: {.callout-note}\nx\n:::\n```\n',
      '~~~\n::: {.callout-note}\n~~~\n',
      '    ::: {.callout-note}\n',
      '<!--\n::: {.callout-note}\n-->\n',
    ]) {
      expect(markdownToHtml(source), source).not.toContain('rl-callout');
    }
    expect(markdownToHtml('```\n::: {.callout-note}\n```\n')).toContain('::: {.callout-note}');
    expect(markdownToHtml('<!--\n::: {.callout-note}\n-->\n').trim()).toBe('');
  });

  it('draws a fence after a comment, and after code, that has ended', () => {
    const html = markdownToHtml('<!-- a\nb -->\n```\nx\n```\n::: {.callout-note}\nIn.\n:::\n');
    expect(html).toContain('rl-callout-note');
  });

  it('does not open a box inside a list or a quote', () => {
    const html = markdownToHtml(
      '- item\n  ::: {.callout-note}\n  x\n  :::\n\n> ::: {.callout-note}\n',
    );
    expect(html).not.toContain('rl-callout');
  });

  it('is not fooled by a comment sign in a code span, or a class in a title', () => {
    const span = markdownToHtml('A `<!--` span.\n\n::: {.callout-note}\nIn.\n:::\n');
    expect(span).toContain('rl-callout-note');
    const title = markdownToHtml('::: {.columns title="see .callout-tip"}\nIn.\n:::\n');
    expect(title).not.toContain('rl-callout');
  });

  it('draws no unbalanced box when a mark falls inside a raw HTML block', () => {
    const html = markdownToHtml('<pre>\n::: {.callout-note}\nIn.\n:::\n');
    expect(html).not.toContain('rl-callout');
    expect(html.split('<div').length).toBe(html.split('</div>').length);
  });

  it('works on CRLF text', () => {
    const html = markdownToHtml('::: {.callout-note}\r\nA.\r\n:::\r\n');
    expect(html).toContain('rl-callout-note');
    expect(html).not.toContain(':::');
  });

  it('is no way to make a page with a script, or to leave a mark behind', () => {
    const html = markdownToHtml('::: {.callout-note title="<script>x</script>"}\nrldiv0z\n:::\n');
    expect(html).not.toContain('<script');
    expect(html).toContain('rldiv0z');
  });

  it('draws the fixtures: the callout, the columns, and the code that holds a fence', () => {
    const html = renderPreview(fixture('divs.qmd'), 'divs.qmd');
    expect(html).toContain('<p class="rl-callout-label">Mind the gap</p>');
    expect(html).toContain('<li>two</li>');
    expect(html).toContain('<p>Left.</p>');
    expect(html).toContain('<p>Right.</p>');
    expect(html).toContain('::: {.callout-tip}');
    expect(html).not.toContain('{.column');
    const front = renderPreview(fixture('frontmatter.qmd'), 'frontmatter.qmd');
    expect(front).toContain('<p class="rl-callout-label">Note</p>');
    expect(front).not.toContain('::: {.callout-note}');
  });
});
