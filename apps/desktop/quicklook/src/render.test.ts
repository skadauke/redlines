import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MAX_CHARS, firstPart, renderPreview } from './render.ts';

const fixture = (name: string) =>
  readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');

/** What is inside the document of a page. */
const documentOf = (html: string) =>
  /<article class="rl-doc">\n([\s\S]*)<\/article>/.exec(html)?.[1] ?? '';
const noticeOf = (html: string) => /<p class="rl-notice">(.*?)<\/p>/.exec(html)?.[1];
/** The line under the document, that says it was cut short. */
const afterOf = (html: string) => /<p class="rl-notice rl-notice-after">(.*?)<\/p>/.exec(html)?.[1];

describe('renderPreview', () => {
  describe('a plain file', () => {
    const html = renderPreview(fixture('plain.md'), 'plain.md');

    it('is the document, drawn', () => {
      expect(html).toContain('<h1>Field notes</h1>');
      expect(html).toContain('<h2>Lists</h2>');
      expect(html).toContain('<li>Nested one</li>');
      expect(html).toContain('<blockquote>');
      expect(html).toContain('<hr />');
      expect(html).toContain('<code class="language-ts">');
    });

    it('has no line about changes, and shows no comment of the author’s', () => {
      expect(noticeOf(html)).toBeUndefined();
      expect(html).not.toContain('only the author sees');
    });

    it('shows no raw HTML live, and loads no image', () => {
      expect(html).not.toMatch(/<script|<img|<[^>]*onerror/);
      expect(html).toContain("&lt;script&gt;alert('no')&lt;/script&gt;");
      expect(html).toContain('<span class="rl-image">A red caret on warm paper</span>');
    });

    it('is titled with the file’s name, escaped', () => {
      expect(html).toContain('<title>plain.md</title>');
      expect(renderPreview('x', 'a<b>&"c".md')).toContain(
        '<title>a&lt;b&gt;&amp;&quot;c&quot;.md</title>',
      );
    });
  });

  describe('a file with tracked changes and comments', () => {
    const source = fixture('redlines.md');
    const html = renderPreview(source, 'redlines.md');

    it('says what is waiting, once, above the document', () => {
      expect(noticeOf(html)).toBe(
        '3 changes and 1 comment by Ada Lovelace, Claude and Bo Chen. Open in Redlines to review them.',
      );
      expect(html.indexOf('<p class="rl-notice">')).toBeLessThan(
        html.indexOf('<article class="rl-doc">'),
      );
      expect(html.match(/<p class="rl-notice">/g)).toHaveLength(1);
    });

    it('shows the newest text, with every change accepted', () => {
      expect(documentOf(html)).toBe(
        '<h1>Launch plan</h1>\n<p>We will ship the new importer in April, after the security review.</p>\n<p>A second paragraph, which nobody has touched.</p>\n',
      );
    });

    it('shows no marker, no deleted text and no ledger', () => {
      expect(html).not.toMatch(/<!--|k3x9|c8d2|March|The old exporter|Who signs off|version: 1/);
    });

    it('reads as the file does in a reader that knows no markers', () => {
      // The format's promise (oracle.ts): the markers are comments, so the file reads as its newest view.
      expect(documentOf(html)).toBe(
        documentOf(renderPreview(source.replace(/<!--[\s\S]*?-->/g, ''), 'x.md')).replace(
          'March',
          'April',
        ),
      );
    });

    it('escapes what a name holds', () => {
      const named = source.replace('name: Ada Lovelace', 'name: "<b>Ada</b> & Co"');
      expect(noticeOf(renderPreview(named, 'x.md'))).toContain('&lt;b&gt;Ada&lt;/b&gt; &amp; Co');
    });
  });

  describe('front matter', () => {
    it('is shown plainly, over the document', () => {
      const html = renderPreview(fixture('frontmatter.qmd'), 'frontmatter.qmd');
      expect(html).toContain(
        '<pre class="rl-frontmatter">---\ntitle: &quot;Penguin bills&quot;\nauthor: Ada Lovelace',
      );
      expect(html).toContain('code-fold: true\n---</pre>');
      expect(documentOf(html).startsWith('<pre class="rl-frontmatter">')).toBe(true);
      // The rest is the document: the rule that closes the front matter is not drawn again.
      expect(documentOf(html)).toContain('<h2>Setup</h2>');
      expect(documentOf(html)).not.toContain('<hr');
    });

    it('is not read as a rule and a heading', () => {
      const html = renderPreview('---\ntitle: A\n---\n\nText.\n', 'x.md');
      expect(documentOf(html)).toBe(
        '<pre class="rl-frontmatter">---\ntitle: A\n---</pre>\n<p>Text.</p>\n',
      );
    });

    it('is also what a Markdown file starts with, when the YAML closes with three dots', () => {
      expect(renderPreview('---\na: 1\n...\n\nText.\n', 'x.md')).toContain('a: 1\n...</pre>');
    });

    it('is not front matter when the file starts with a rule and a blank line', () => {
      const html = renderPreview('---\n\nText.\n\n---\n', 'x.md');
      expect(html).not.toContain('rl-frontmatter">');
      expect(documentOf(html)).toContain('<hr />');
    });

    it('comes after the line about changes', () => {
      const source = `---\ntitle: A\n---\n\nA <!--ins k3x9-->new <!--/k3x9-->word.\n\n<!-- redlines\nversion: 1\npeople:\n  ada: {name: Ada}\nmarks:\n  k3x9: {by: ada, at: 2026-10-13T22:30Z}\ncomments: []\n-->\n`;
      const html = renderPreview(source, 'x.md');
      expect(noticeOf(html)).toBe('1 change by Ada. Open in Redlines to review it.');
      expect(html.indexOf('<p class="rl-notice">')).toBeLessThan(
        html.indexOf('<pre class="rl-frontmatter">'),
      );
    });
  });

  describe('R Markdown and Quarto', () => {
    it('keeps the options of each chunk, plainly', () => {
      const html = renderPreview(fixture('analysis.Rmd'), 'analysis.Rmd');
      expect(html).toContain('<pre class="rl-frontmatter">---\ntitle: &quot;Weekly report&quot;');
      expect(html).toContain('data-chunk="r, echo=FALSE, message=FALSE"');
      expect(html).toContain('summary(cars)');
      expect(html).toContain('<code>r 1 + 1</code>');
    });
  });

  describe('a table', () => {
    it('is drawn with its alignment', () => {
      const html = renderPreview(fixture('table.md'), 'table.md');
      expect(html.match(/<table>/g)).toHaveLength(2);
      expect(html).toContain('<th align="right">Runs</th>');
      expect(html).toContain('<td align="center">41.2</td>');
      expect(html).toContain('<em>current</em>');
    });
  });

  describe('a long file', () => {
    const paragraph = 'A paragraph of text, which is not very long, but is one of many.\n\n';
    const long = `# Long\n\n${paragraph.repeat(Math.ceil((MAX_CHARS * 2) / paragraph.length))}Last paragraph.\n`;
    const html = renderPreview(long, 'long.md');

    it('is shown as far as its last paragraph under the limit, and says so', () => {
      expect(html).toContain('<h1>Long</h1>');
      expect(html).not.toContain('Last paragraph.');
      const shown = documentOf(html);
      expect(shown.length).toBeLessThan(MAX_CHARS * 1.3);
      expect(afterOf(html)).toBe(
        'This preview shows the first part of a long document. Open it in Redlines to read all of it.',
      );
      // The cut is between paragraphs, so that no paragraph is cut in two.
      expect(shown.endsWith('</p>\n')).toBe(true);
    });

    it('is shown whole just under the limit', () => {
      const body = 'x'.repeat(100) + '\n\n';
      const text = body.repeat(Math.floor((MAX_CHARS - 10) / body.length));
      expect(afterOf(renderPreview(text, 'x.md'))).toBeUndefined();
    });

    it('still says what is waiting in it, which is read from all of it', () => {
      const source = `A <!--ins k3x9-->new <!--/k3x9-->word.\n\n${paragraph.repeat(Math.ceil(MAX_CHARS / paragraph.length) + 5)}\n<!-- redlines\nversion: 1\npeople:\n  ada: {name: Ada}\nmarks:\n  k3x9: {by: ada, at: 2026-10-13T22:30Z}\ncomments: []\n-->\n`;
      const result = renderPreview(source, 'x.md');
      expect(noticeOf(result)).toBe('1 change by Ada. Open in Redlines to review it.');
      expect(afterOf(result)).toBeDefined();
    });

    it('is shown as far as it was given, when the host gave only its start', () => {
      const result = renderPreview('A <!--ins k3x9-->new <!--/k3x9-->word.\n', 'x.md', true);
      // Its ledger is not there, so nobody can be named.
      expect(noticeOf(result)).toBeUndefined();
      expect(afterOf(result)).toBeDefined();
    });
  });

  describe('the page', () => {
    const html = renderPreview('Text.\n', 'x.md');

    it('has no script, and nothing that loads', () => {
      expect(html).not.toMatch(/<script|<link|<iframe|<object|<embed|<img|<form|@import/i);
      // Every address in the page is a data URL of a font.
      for (const [, url] of html.matchAll(/url\(([^)]*)\)/g)) {
        expect(url).toMatch(/^data:font\/woff2;base64,/);
      }
      expect(html).not.toMatch(/https?:\/\//);
    });

    it('says in its own words that nothing loads', () => {
      expect(html).toContain(
        `content="default-src 'none'; style-src 'unsafe-inline'; font-src data:"`,
      );
    });

    it('follows the Mac in dark mode', () => {
      expect(html).toContain('<meta name="color-scheme" content="light dark">');
      expect(html).toContain('@media (prefers-color-scheme: dark)');
    });

    it('draws a file with nothing in it', () => {
      expect(documentOf(renderPreview('', 'empty.md'))).toBe('');
    });

    it('draws a file with a ledger that is broken', () => {
      const broken =
        'A <!--ins k3x9-->new <!--/k3x9-->word.\n\n<!-- redlines\nversion: 1\npeople: [[[\n-->\n';
      expect(documentOf(renderPreview(broken, 'x.md'))).toBe('<p>A new word.</p>\n');
    });

    it('draws a file with CRLF line breaks', () => {
      expect(documentOf(renderPreview('# A\r\n\r\nB\r\nC\r\n', 'x.md'))).toBe(
        '<h1>A</h1>\r\n<p>B\r\nC</p>\r\n',
      );
    });
  });
});

describe('firstPart', () => {
  it('is the text when it fits', () => {
    expect(firstPart('a\n\nb', 10)).toBe('a\n\nb');
  });

  it('cuts at the last blank line under the limit', () => {
    expect(firstPart('aaaa\n\nbbbb\n\ncccc', 12)).toBe('aaaa\n\nbbbb');
  });

  it('cuts at the limit when the second half has no blank line', () => {
    expect(firstPart('a\n\n' + 'b'.repeat(30), 20)).toBe('a\n\n' + 'b'.repeat(17));
  });
});
