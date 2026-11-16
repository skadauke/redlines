// The check of the Markdown twins against GitHub (#690): a block of HTML and the twin that
// `htmlTwin` writes for it are rendered with micromark 4.0.2 and GFM, the project's reference for
// GitHub's renderer, and must draw the same: the same elements, the same text, the same attributes.
// What the two forms may differ in is what HTML itself ignores or implies: the white space between
// tags, the `thead` and `tbody` that a table's rows sit in, the paragraph that Markdown puts in a
// quote, and the line break that ends a fence's code.

import { htmlTwin } from '@redlines/format';
import type { ElementContent, Root } from 'hast';
import { fromHtml } from 'hast-util-from-html';
import { gfm, gfmHtml } from 'micromark-extension-gfm';
import { micromark } from 'micromark';
import { describe, expect, it } from 'vitest';

function render(markdown: string): string {
  return micromark(markdown, {
    allowDangerousHtml: true,
    extensions: [gfm()],
    htmlExtensions: [gfmHtml()],
  });
}

const GROUPS = new Set(['thead', 'tbody']);
const INLINE = new Set(
  'b strong i em code tt kbd samp var s strike del ins sub sup mark small abbr dfn cite q time span bdo a br'.split(
    ' ',
  ),
);

/** A tree reduced to what is drawn: elements, attributes and text, in the order they come. */
function reduce(nodes: ElementContent[], inPre = false): unknown[] {
  const out: unknown[] = [];
  for (const node of nodes) {
    if (node.type === 'text') {
      const text = inPre ? node.value : node.value.replace(/\s+/g, ' ');
      if (!inPre && text.trim() === '') continue;
      out.push(inPre ? text : text);
    } else if (node.type === 'element') {
      const children = reduce(node.children, inPre || node.tagName === 'pre');
      if (GROUPS.has(node.tagName)) {
        out.push(...children);
        continue;
      }
      const properties = { ...node.properties };
      let kids = children;
      // The newline that ends a fence's text is not drawn (the code ends where `</pre>` is).
      if (node.tagName === 'code' && inPre && typeof kids.at(-1) === 'string') {
        kids = [...kids.slice(0, -1), (kids.at(-1) as string).replace(/\n$/, '')];
      }
      // Markdown puts a quote's text in a paragraph; the HTML says it bare. The page draws the same.
      if (
        node.tagName === 'blockquote' &&
        !node.children.some((child) => child.type === 'element' && child.tagName === 'p')
      ) {
        kids = [{ tag: 'p', properties: {}, kids: tidy(kids) }];
      }
      out.push({ tag: node.tagName, properties, kids: tidy(kids) });
    }
  }
  return out;
}

/** Trims the white space at the ends of an element's text, which HTML does not draw. */
function tidy(kids: unknown[]): unknown[] {
  const block = (kid: unknown) =>
    typeof kid === 'object' && kid !== null && !INLINE.has((kid as { tag: string }).tag);
  const copy = kids.map((kid, i) => {
    if (typeof kid !== 'string') return kid;
    let text = kid;
    if (i === 0 || block(kids[i - 1])) text = text.trimStart();
    if (i === kids.length - 1 || block(kids[i + 1])) text = text.trimEnd();
    return text;
  });
  return copy.filter((kid) => kid !== '');
}

function drawn(html: string): unknown {
  const tree: Root = fromHtml(html, { fragment: true });
  return reduce(tree.children as ElementContent[]);
}

/** Asserts that `block`'s twin exists and draws as `block` does. */
function same(block: string): string {
  const read = htmlTwin(block);
  if (!('twin' in read)) throw new Error(`no twin for ${block}: ${read.reason}`);
  expect(drawn(render(read.twin.markdown)), `${block}\n=>\n${read.twin.markdown}`).toEqual(
    drawn(render(block)),
  );
  return read.twin.markdown;
}

const none = (block: string) => {
  const read = htmlTwin(block);
  expect('reason' in read, `${block} has no twin`).toBe(true);
};

describe('headings', () => {
  it('draws h1 to h6 as the heading', () => {
    for (let level = 1; level <= 6; level++) {
      same(`<h${level}>A title</h${level}>`);
    }
    expect(same('<h2>Plain &amp; simple</h2>')).toBe('## Plain &amp; simple');
    expect(same('<h3>The <b>bold</b> and <code>code</code> one</h3>')).toBe(
      '### The <b>bold</b> and <code>code</code> one',
    );
    same('<h1>  Spaced  </h1>');
    same('<h2>C# in 2026: what, why?</h2>');
  });

  it('has no twin when Markdown would read the text as something', () => {
    none('<h2>*Not* emphasis</h2>');
    none('<h2>snake_case_name</h2>');
    none('<h2>See [the guide]</h2>');
    none('<h2>Use `code`</h2>');
    none('<h2>a | b</h2>');
    none('<h2>www.example.com</h2>');
    none('<h2>Visit https://example.com</h2>');
    none('<h2>ask me@home</h2>');
    none('<h2>~~gone~~</h2>');
    none('<h2>Costs $5 and $6</h2>');
    none('<h2>- not a bullet</h2>');
    none('<h2>1. not a list</h2>');
    none('<h2>Trailing #</h2>');
    none('<h2>a \\ b</h2>');
    none('<h2>x < y</h2>');
    none('<h2></h2>');
    none('<h2 align="center">Centered</h2>');
    none('<h2 id="x">Anchored</h2>');
    none('<h2>Two<br>lines</h2>'.replace('<br>', '\n'));
    none('<h2><u>Underlined</u></h2>');
    none('<h2><b>Unclosed</h2>');
    none('<h2><img src="x.png"></h2>');
  });
});

describe('rules', () => {
  it('draws <hr> as ---', () => {
    expect(same('<hr>')).toBe('---');
    same('<hr/>');
    same('<hr />');
  });
  it('has no twin with attributes', () => {
    none('<hr width="50%">');
    none('<hr>\ntext after it');
  });
  it('uses *** under a line of text, where --- would underline it', () => {
    const read = htmlTwin('<hr>', { afterText: true });
    expect(read).toEqual({ twin: { kind: 'rule', markdown: '***', what: '<hr> rule' } });
    const text = render('text\n***');
    expect(text).toContain('<hr />');
  });
});

describe('code blocks', () => {
  it('draws pre with code as a fence', () => {
    same('<pre><code>one line</code></pre>');
    same('<pre><code>if (a &lt; b &amp;&amp; c &gt; d) {\n  go();\n}</code></pre>');
    same('<pre><code>first\n\nafter a blank line</code></pre>');
    same('<pre><code>a ``` fence inside</code></pre>');
    expect(same('<pre><code>x &lt; y</code></pre>')).toBe('```\nx < y\n```');
  });
  it('has no twin for anything else', () => {
    none('<pre>plain pre</pre>');
    none('<pre><code class="language-js">x</code></pre>');
    none('<pre><code>text with <b>tags</b></code></pre>');
    none('<pre><code>ends with a newline\n</code></pre>');
    none('<pre><code></code></pre>');
    none('<pre><code>&nbsp;</code></pre>');
  });
});

describe('quotes', () => {
  it('draws blockquote as a quote', () => {
    expect(same('<blockquote>One line</blockquote>')).toBe('> One line');
    same('<blockquote>\nTwo\nlines\n</blockquote>');
    same('<blockquote><p>First</p><p>Second</p></blockquote>');
    same('<blockquote>\n<p>First</p>\n<p>With <i>tags</i></p>\n</blockquote>');
  });
  it('has no twin otherwise', () => {
    none('<blockquote cite="x">One</blockquote>');
    none('<blockquote>*One*</blockquote>');
    none('<blockquote>\n- not a list\n</blockquote>');
    none('<blockquote></blockquote>');
    none('<blockquote><p>One</p>stray</blockquote>');
  });
});

describe('lists', () => {
  it('draws ul and ol as lists', () => {
    expect(same('<ul>\n  <li>a</li>\n  <li>b</li>\n</ul>')).toBe('- a\n- b');
    expect(same('<ol><li>one</li><li>two</li></ol>')).toBe('1. one\n2. two');
    expect(same('<ol start="3"><li>three</li><li>four</li></ol>')).toBe('3. three\n4. four');
    same('<ul><li>with <b>bold</b> and <a href="https://example.com/a">a link</a></li></ul>');
    same('<ul>\n<li>a<ul><li>b</li><li>c</li></ul></li>\n<li>d</li>\n</ul>');
    same('<ol>\n<li>a<ol><li>b</li></ol></li>\n</ol>');
    same('<ul><li>a<ol><li>b</li></ol></li></ul>');
    none('<ul><li>a<ol start="2"><li>b</li></ol></li></ul>');
  });
  it('has no twin otherwise', () => {
    none('<ul class="x"><li>a</li></ul>');
    none('<ul><li id="x">a</li></ul>');
    none('<ul><li><p>a</p></li></ul>');
    none('<ul><li>*a*</li></ul>');
    none('<ul><li></li></ul>');
    none('<ul></ul>');
    none('<ul><li>a</li>text</ul>');
    none('<ol start="x"><li>a</li></ol>');
    none('<ul>\n<li>a\nb</li>\n</ul>');
  });
  it('wants a blank line above a numbered list that does not start at 1', () => {
    expect('reason' in htmlTwin('<ol start="3"><li>a</li></ol>', { afterText: true })).toBe(true);
    expect('twin' in htmlTwin('<ol><li>a</li></ol>', { afterText: true })).toBe(true);
  });
});

describe('tables', () => {
  it('draws a simple table as a table', () => {
    expect(
      same(
        '<table>\n<thead><tr><th>A</th><th>B</th></tr></thead>\n<tbody><tr><td>1</td><td>2</td></tr></tbody>\n</table>',
      ),
    ).toBe('| A | B |\n| --- | --- |\n| 1 | 2 |');
    same('<table><tr><th>A</th></tr><tr><td>1</td></tr><tr><td>2</td></tr></table>');
    same('<table><tr><th>A</th><th>B</th></tr></table>');
    same(
      '<table><tr><th align="center">A</th><th align="right">B</th><th>C</th></tr><tr><td align="center">1</td><td align="right">2</td><td>3</td></tr></table>',
    );
    same('<table><tr><th>A</th><th>B</th></tr><tr><td>one <b>bold</b></td><td></td></tr></table>');
    same('<table><tr><th>A</th></tr><tr><td>line<br>break</td></tr></table>');
  });
  it('has no twin otherwise', () => {
    none('<table><caption>c</caption><tr><th>A</th></tr></table>');
    none('<table><tr><th colspan="2">A</th></tr></table>');
    none('<table><tr><td>A</td></tr></table>');
    none('<table><tr><th>A</th><th>B</th></tr><tr><td>1</td></tr></table>');
    none('<table><tr><th>A</th></tr><tr><th>B</th></tr></table>');
    none('<table><tr><th>A</th></tr><tr><td>a | b</td></tr></table>');
    none('<table><tr><th align="center">A</th></tr><tr><td>1</td></tr></table>');
    none('<table><tr><th>A</th></tr><tr><td><img src="x.png"></td></tr></table>');
    none('<table border="1"><tr><th>A</th></tr></table>');
    none('<table><tr><th>A</th></tr><tfoot><tr><td>x</td></tr></tfoot></table>');
  });
  it('wants a blank line above', () => {
    expect('reason' in htmlTwin('<table><tr><th>A</th></tr></table>', { afterText: true })).toBe(
      true,
    );
  });
});

describe('what has no twin at all', () => {
  it('says so for other HTML and for marks of changes', () => {
    none('<div>text</div>');
    none('<p>text</p>');
    none('<h2>Title<!--ins abcd-->x<!--/abcd--></h2>');
    none('<!-- comment -->');
  });
});

// A random sweep: pieces of text, some plain and some that Markdown reads, put in each shape. Where
// a twin is given, it must draw the same.
describe('random shapes', () => {
  const pieces = [
    'word',
    'two words',
    'C# 11',
    'a-b',
    '1 + 1 = 2',
    '&amp;',
    '&lt;tag&gt;',
    '<b>bold</b>',
    '<em>x</em> and <code>y</code>',
    'a_b_c',
    '*star*',
    '[x](y)',
    '`tick`',
    '2. two',
    '+ plus',
    '# hash',
    'www.x.org',
    'a | b',
    '> q',
    '1) one',
    '~tilde~',
    'done.',
    '(paren)',
    "it's",
    'a: b',
    '$5',
    'x@y',
    '<br>',
    '<u>u</u>',
    '',
  ];
  let seed = 7;
  const random = (n: number) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  };
  const piece = () => pieces[random(pieces.length)] as string;
  const shapes: Array<() => string> = [
    () => `<h${1 + random(6)}>${piece()}</h${1 + random(6)}>`,
    () => {
      const level = 1 + random(6);
      return `<h${level}>${piece()} ${piece()}</h${level}>`;
    },
    () => `<ul><li>${piece()}</li><li>${piece()}</li></ul>`,
    () => `<ol><li>${piece()}</li><li>${piece()}<ul><li>${piece()}</li></ul></li></ol>`,
    () => `<blockquote>${piece()}</blockquote>`,
    () => `<blockquote><p>${piece()}</p><p>${piece()}</p></blockquote>`,
    () =>
      `<table><tr><th>${piece()}</th><th>${piece()}</th></tr><tr><td>${piece()}</td><td>${piece()}</td></tr></table>`,
    () => `<pre><code>${piece()}\n${piece()}</code></pre>`,
  ];
  it('keeps every twin it gives exact', { timeout: 60_000 }, () => {
    let twins = 0;
    for (let i = 0; i < 600; i++) {
      const block = (shapes[random(shapes.length)] as () => string)();
      const read = htmlTwin(block);
      if (!('twin' in read)) continue;
      twins++;
      expect(drawn(render(read.twin.markdown)), `${block}\n=>\n${read.twin.markdown}`).toEqual(
        drawn(render(block)),
      );
    }
    expect(twins).toBeGreaterThan(50);
  });
});
