// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { fontStack, markdownToHtml } from './copy-html.ts';

const html = (markdown: string) => markdownToHtml(markdown);

describe('markdownToHtml', () => {
  it('copies subscript and superscript as live tags, and any other tag as text', () => {
    const out = html('H<sub>2</sub>O, x<sup>*n*</sup>, <SUB>no</SUB> and <u>no</u>.');
    expect(out).toContain('H<sub>2</sub>O, x<sup><em>n</em></sup>,');
    expect(out).toContain('&lt;SUB&gt;no&lt;/SUB&gt; and &lt;u&gt;no&lt;/u&gt;.');
  });

  it('copies a heading, a list, bold, a link and a table as HTML with the twins in font-family', () => {
    const out = html(
      [
        '# Plan',
        '',
        'Some **bold** and *italic* and ~~gone~~ and `code` with [a link](https://example.com/a?b=1&c=2).',
        '',
        '- one',
        '  - nested',
        '- two',
        '',
        '1. first',
        '2. second',
        '',
        '| Name | Count |',
        '| --- | ---: |',
        '| Ada | 3 |',
      ].join('\n'),
    );
    expect(out).toContain('<h1>Plan</h1>');
    expect(out).toContain('<strong>bold</strong>');
    expect(out).toContain('<em>italic</em>');
    expect(out).toContain('<del>gone</del>');
    expect(out).toContain(
      '<code style="font-family:&quot;Courier New&quot;, Cousine, monospace">code</code>',
    );
    expect(out).toContain('<a href="https://example.com/a?b=1&amp;c=2">a link</a>');
    expect(out).toContain('<ul><li>one<ul><li>nested</li></ul></li><li>two</li></ul>');
    expect(out).toContain('<ol><li>first</li><li>second</li></ol>');
    expect(out).toContain(
      '<thead><tr><th>Name</th><th style="text-align:right">Count</th></tr></thead>',
    );
    expect(out).toContain(
      '<tbody><tr><td>Ada</td><td style="text-align:right">3</td></tr></tbody>',
    );
    // The wrapper names the theme's font, its metric-compatible twin and a generic family.
    expect(
      out.startsWith('<div data-redlines style="font-family:Calibri, Carlito, sans-serif">'),
    ).toBe(true);
    expect(out.endsWith('</div>')).toBe(true);
    expect(out).not.toContain('class=');
    expect(out).not.toContain('<!--');
  });

  it('names the twins of each bundled font, in an order that works for the first name a target has', () => {
    expect(fontStack("'Carlito', sans-serif")).toBe('Calibri, Carlito, sans-serif');
    expect(fontStack("'Gelasio', serif")).toBe('Georgia, Gelasio, serif');
    expect(fontStack("'Cousine', monospace")).toBe('"Courier New", Cousine, monospace');
    expect(fontStack('')).toBe('Calibri, Carlito, sans-serif');
  });

  it('copies code blocks, quotes, rules, images and task lists', () => {
    const out = html(
      [
        '```ts',
        'const a = 1 < 2;',
        '```',
        '',
        '> quoted **text**',
        '',
        '---',
        '',
        '![alt text](https://example.com/p.png)',
        '',
        '- [x] done',
        '- [ ] todo',
      ].join('\n'),
    );
    expect(out).toContain(
      '<pre style="font-family:&quot;Courier New&quot;, Cousine, monospace"><code class="language-ts">const a = 1 &lt; 2;</code></pre>',
    );
    expect(out).toContain(
      '<blockquote><p>quoted <strong>bold</strong></p></blockquote>'.replace('bold', 'text'),
    );
    expect(out).toContain('<hr>');
    expect(out).toContain('<img src="https://example.com/p.png" alt="alt text">');
    expect(out).toContain('<li>\u2611 done</li>');
    expect(out).toContain('<li>\u2610 todo</li>');
    expect(out).not.toContain('<input');
  });

  it('escapes raw HTML in the source instead of copying it live', () => {
    const out = html(
      'A <script>alert(1)</script> and <b onclick="x()">bold</b>.\n\n<div>block</div>\n\n<!-- note -->',
    );
    expect(out).not.toContain('<script');
    expect(out).not.toContain('<b ');
    expect(out).not.toContain('<div>block');
    expect(out).not.toContain('<!--');
    expect(out).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(out).toContain('&lt;div&gt;block&lt;/div&gt;');
  });

  it('does not copy a javascript link live', () => {
    const out = html('[x](javascript:alert(1)) and ![y](javascript:alert(2))');
    expect(out).not.toContain('javascript:');
  });

  it('copies a selection that cuts through a block as well-formed HTML', () => {
    const doc = new DOMParser().parseFromString(
      html('item two\n- item three\n  - deep\n\n| a | b |\n| c | d |'),
      'text/html',
    );
    expect(doc.body.querySelectorAll('ul').length).toBeGreaterThan(0);
    expect(doc.body.textContent).toContain('item two');
    expect(doc.body.textContent).toContain('deep');
  });

  it('writes the addresses of links as readers have them', () => {
    const out = html(
      [
        'See [a](https://e.com/?a=1&amp;b=2), [b][spec], [spec], [c][] and the note[^1].',
        'Bare www.example.com and mail me@example.com, or <you@example.com>.',
        '',
        '[spec]: https://example.com/spec "Title"',
        '[c]: <https://example.com/a\\_b>',
        '[^1]: A footnote.',
      ].join('\n'),
    );
    expect(out).toContain('<a href="https://e.com/?a=1&amp;b=2">a</a>');
    expect(out).toContain('<a href="https://example.com/spec">b</a>');
    expect(out).toContain('<a href="https://example.com/spec">spec</a>');
    expect(out).toContain('<a href="https://example.com/a_b">c</a>');
    expect(out).toContain('<a href="https://www.example.com">www.example.com</a>');
    expect(out).toContain('<a href="mailto:me@example.com">me@example.com</a>');
    expect(out).toContain('<a href="mailto:you@example.com">you@example.com</a>');
    expect(out).toContain('the note[^1]');
  });

  it('copies a footnote as text, even with a one-word definition', () => {
    const out = html('The note[^1] is here.\n\n[^1]: note');
    expect(out).toContain('The note[^1] is here.');
    expect(out).toContain('<p>[^1]: note</p>');
    expect(out).not.toContain('<a ');
  });
});
