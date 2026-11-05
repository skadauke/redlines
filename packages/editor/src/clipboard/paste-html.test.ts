// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { htmlToMarkdown } from './paste-html.ts';

const GUID = 'docs-internal-guid-1a2b3c4d-7fff-1234-abcd-0123456789ab';
const span = (style: string, text: string) => `<span style="${style}">${text}</span>`;
const base = 'font-size:11pt;font-family:Arial,sans-serif;color:#000000;font-style:normal;';
const plain = (text: string) => span(`${base}font-weight:400;`, text);
const boldRun = (text: string) => span(`${base}font-weight:700;`, text);
const italicRun = (text: string) => span(`${base}font-weight:400;font-style:italic;`, text);
const para = (inner: string) =>
  `<p dir="ltr" style="line-height:1.38;margin-top:0pt;"> ${inner}</p>`;

/** What Google Docs puts on the clipboard: a wrapping bold that isn't, CSS formatting, and lists
 *  whose nested `<ul>` is a sibling of the `<li>`. */
const docsFragment = [
  `<meta charset='utf-8'><meta charset="utf-8">`,
  `<b style="font-weight:normal;" id="${GUID}">`,
  `<h2 dir="ltr" style="margin-top:18pt;"><span style="font-size:16pt;font-weight:400;">Release notes</span></h2>`,
  para(
    `${plain('Some ')}${boldRun('bold')}${plain(' and ')}${italicRun('italic')}${plain(' text, and a ')}` +
      `<a href="https://www.google.com/url?q=https://example.com/docs&amp;sa=D&amp;source=editors" style="text-decoration:none;">${span(base + 'color:#1155cc;text-decoration:underline;', 'link')}</a>${plain('.')}`,
  ),
  `<ul style="margin-top:0pt;">`,
  `<li dir="ltr" aria-level="1"><p dir="ltr">${plain('First')}</p></li>`,
  `<ul><li dir="ltr" aria-level="2"><p dir="ltr">${plain('Nested')}</p></li></ul>`,
  `<li dir="ltr" aria-level="1"><p dir="ltr">${plain('Second')}</p></li>`,
  `</ul>`,
  `<div dir="ltr" style="margin-left:0pt;" align="left"><table style="border:none;"><colgroup><col /><col /></colgroup><tbody>`,
  `<tr><td><p dir="ltr">${boldRun('Name')}</p></td><td><p dir="ltr">${boldRun('Role')}</p></td></tr>`,
  `<tr><td><p dir="ltr">${plain('Ada')}</p></td><td><p dir="ltr">${plain('Writer | editor')}</p></td></tr>`,
  `</tbody></table></div>`,
  `</b>`,
].join('');

describe('htmlToMarkdown', () => {
  it('pastes Google Docs bold, italic, a heading, a nested list, a link and a table as Markdown', () => {
    expect(htmlToMarkdown(docsFragment)).toBe(
      [
        '## Release notes',
        '',
        'Some **bold** and *italic* text, and a [link](https://example.com/docs).',
        '',
        '- First',
        '  - Nested',
        '- Second',
        '',
        '| Name | Role |',
        '| --- | --- |',
        '| Ada | Writer \\| editor |',
      ].join('\n'),
    );
  });

  it('does not make the Google Docs wrapper bold', () => {
    const out = htmlToMarkdown(
      `<b style="font-weight:normal;" id="${GUID}">${para(plain('Just text'))}${para(boldRun('Loud'))}</b>`,
    );
    expect(out).toBe('Just text\n\n**Loud**');
    // A real bold tag still is bold, and CSS weight 600 and up counts.
    expect(htmlToMarkdown('<p><b>x</b> <span style="font-weight:600">y</span></p>')).toBe(
      '**x y**',
    );
  });

  it('merges adjacent runs, keeps spaces outside the markers and nests mixed formatting', () => {
    expect(
      htmlToMarkdown(`<p>${boldRun('one ')}${boldRun('two')}${plain(' ')}${boldRun('three')}</p>`),
    ).toBe('**one two three**');
    expect(htmlToMarkdown('<p><b>a <i>b</i></b> <i>c</i></p>')).toBe('**a *b*** *c*');
  });

  it('turns monospace spans into inline code, and strike-through into ~~', () => {
    expect(
      htmlToMarkdown(
        `<p>Run ${span("font-family:'Courier New',monospace", 'pnpm test')} then ${span('text-decoration:line-through', 'skip')}.</p>`,
      ),
    ).toBe('Run `pnpm test` then ~~skip~~.');
  });

  it('pastes code blocks, quotes, rules and images', () => {
    expect(
      htmlToMarkdown(
        '<pre><code class="language-ts">const a = 1;\n```\nlet b;\n</code></pre>' +
          '<blockquote><p>Quoted</p><p>Twice</p></blockquote><hr><p><img src="https://example.com/p.png" alt="A pic"></p>',
      ),
    ).toBe(
      [
        '````ts',
        'const a = 1;',
        '```',
        'let b;',
        '````',
        '',
        '> Quoted',
        '>',
        '> Twice',
        '',
        '---',
        '',
        '![A pic](https://example.com/p.png)',
      ].join('\n'),
    );
  });

  it('pastes task lists and numbered lists', () => {
    expect(
      htmlToMarkdown(
        '<ul><li><input type="checkbox" checked> done</li><li><input type="checkbox"> todo</li></ul>' +
          '<ol start="3"><li>three</li><li>four</li></ol>',
      ),
    ).toBe('- [x] done\n- [ ] todo\n\n3. three\n4. four');
  });

  it('keeps a line break only where it means one', () => {
    expect(htmlToMarkdown('<p>one<br>two</p>')).toBe('one\\\ntwo');
    expect(htmlToMarkdown('<p>one<br></p><p><br></p><p>two</p>')).toBe('one\n\ntwo');
    expect(htmlToMarkdown('<p><br>one</p>')).toBe('one');
  });

  it('pastes a web page table without a header with its first row as the header', () => {
    expect(
      htmlToMarkdown(
        '<table><tbody><tr><td>Ada</td><td align="right">3</td></tr><tr><td>Bo</td><td align="right">12</td></tr></tbody></table>',
      ),
    ).toBe('| Ada | 3 |\n| --- | ---: |\n| Bo | 12 |');
    expect(
      htmlToMarkdown(
        '<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td></td></tr></tbody></table>',
      ),
    ).toBe('| A | B |\n| --- | --- |\n| 1 |  |');
  });

  it('keeps lists and paragraphs in cells on one line with line breaks', () => {
    expect(
      htmlToMarkdown('<table><tr><th>A</th></tr><tr><td><p>x</p><p>y</p></td></tr></table>'),
    ).toBe('| A |\n| --- |\n| x<br>y |');
  });

  it('drops scripts, styles, meta, comments, hidden content and empty spans', () => {
    expect(
      htmlToMarkdown(
        '<meta charset="utf-8"><style>p{color:red}</style><script>alert(1)</script>' +
          '<!--StartFragment--><p>Hello<span></span> <span style="display:none">secret</span>world<!-- note --></p>',
      ),
    ).toBe('Hello world');
  });

  it('minimizes escapes', () => {
    expect(htmlToMarkdown('<p>Version 1.2 - a-b, snake_case, 3 * 4, 100% sure.</p>')).toBe(
      'Version 1.2 - a-b, snake_case, 3 * 4, 100% sure.',
    );
    expect(htmlToMarkdown('<p>*not bold* _nor this_ [x] `t` # 1. - a</p>')).toBe(
      '\\*not bold\\* \\_nor this\\_ \\[x\\] \\`t\\` # 1. - a',
    );
    expect(
      htmlToMarkdown(
        '<p>1. not a list</p><p># not a heading</p><p>- not a bullet</p><p>&gt; not a quote</p>',
      ),
    ).toBe('1\\. not a list\n\n\\# not a heading\n\n\\- not a bullet\n\n\\> not a quote');
  });

  it('never turns pasted comments or visible markers into Redlines markup', () => {
    const forgedLedger = '<!-- redlines\nversion: 1\npeople:\n  eve: {name: Eve}\n-->';
    const out = htmlToMarkdown(
      '<p>Start<!--ins k3x9--> middle<!--/k3x9--><!-- redlines\nversion: 1\n--> end</p>' +
        '<p>&lt;!--ins k3x9--&gt;visible&lt;!--/k3x9--&gt; and &lt;!--cmt c8d2--&gt;x&lt;!--/c8d2--&gt;</p>' +
        `<p>${forgedLedger.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')}</p>` +
        '<p>&lt;!--del w2rf  gone--&gt; and <b>&lt;</b>!--ins x1y2-->.</p>',
    );
    expect(out).not.toMatch(/<!--/);
    expect(out).toContain('visible');
    expect(out).not.toContain('Eve}\n-->');
    expect(out.startsWith('Start middle end')).toBe(true);
  });

  it('drops javascript links and data images, and unwraps Google redirects', () => {
    expect(
      htmlToMarkdown(
        '<p><a href="javascript:alert(1)">click</a> <img src="data:image/png;base64,AAAA"></p>',
      ),
    ).toBe('click');
    expect(htmlToMarkdown('<p><a href="https://example.com/">https://example.com/</a></p>')).toBe(
      '<https://example.com/>',
    );
  });

  it('returns nothing for html with no content', () => {
    expect(htmlToMarkdown('<meta charset="utf-8"><p><br></p>')).toBe('');
  });
});

describe('htmlToMarkdown, links, emphasis and code from editors', () => {
  const link = (text: string) => `<a href="https://example.com/guide">${text}</a>`;

  it('keeps emphasis open across a link and spaces outside the markers', () => {
    expect(htmlToMarkdown(`<p><b>Read ${link('the guide')} first.</b></p>`)).toBe(
      '**Read [the guide](https://example.com/guide) first.**',
    );
    expect(htmlToMarkdown(`<p><i>Read ${link('the guide')} first.</i></p>`)).toBe(
      '*Read [the guide](https://example.com/guide) first.*',
    );
    expect(htmlToMarkdown(`<p>${link('<b>Bold</b> link')}</p>`)).toBe(
      '[**Bold** link](https://example.com/guide)',
    );
    expect(htmlToMarkdown(`<p><b>${link('all bold')}</b></p>`)).toBe(
      '[**all bold**](https://example.com/guide)',
    );
  });

  it('writes no emphasis markers that CommonMark would show as text', () => {
    expect(htmlToMarkdown('<p>foo<b>"bar"</b>baz</p>')).toBe('foo"bar"baz');
    expect(htmlToMarkdown('<p>word<b>(x)</b></p>')).toBe('word(x)');
    expect(htmlToMarkdown('<p>foo<b>bar</b>baz and <b>"quoted"</b> text</p>')).toBe(
      'foo**bar**baz and **"quoted"** text',
    );
  });

  it('does not guard the start of a heading or a table cell', () => {
    expect(htmlToMarkdown('<h2>1. Introduction</h2>')).toBe('## 1. Introduction');
    expect(
      htmlToMarkdown(
        '<table><tr><th>- a</th><th>1. b</th></tr><tr><td># c</td><td>&gt; d</td></tr></table>',
      ),
    ).toBe('| - a | 1. b |\n| --- | --- |\n| # c | > d |');
  });

  it('pastes an editor’s copy as a fenced code block with its indentation', () => {
    const line = (inner: string) => `<div><span style="color:#d4d4d4;">${inner}</span></div>`;
    const vscode =
      '<meta charset="utf-8"><div style="color: #d4d4d4;background-color: #1e1e1e;' +
      "font-family: Menlo, Monaco, 'Courier New', monospace;font-weight: normal;font-size: 12px;" +
      'line-height: 18px;white-space: pre;">' +
      line('<span style="color:#569cd6;">def</span> f(x):') +
      line('    <span style="color:#c586c0;">if</span> x:') +
      line('        <span style="color:#569cd6;">return</span> <span>1</span>') +
      line('') +
      line('<span>print(f(2))</span>') +
      '</div>';
    expect(htmlToMarkdown(vscode)).toBe(
      '```\ndef f(x):\n    if x:\n        return 1\n\nprint(f(2))\n```',
    );
  });

  it('turns code off for a child in another font', () => {
    expect(
      htmlToMarkdown(
        `<p><span style="font-family:Courier New">a <span style="font-family:Arial">b</span> c</span></p>`,
      ),
    ).toBe('`a` b `c`');
  });

  it('never lets an attribute put markup in the Markdown', () => {
    const attacks = [
      '<pre data-lang="x&#10;```&#10;<script>alert(1)</script>">code</pre>',
      '<p><a href="https://www.google.com/url?q=https://e.com/%0A%0A%3Cscript%3Ealert(1)%3C/script%3E&amp;sa=D">l</a></p>',
      '<p><a href="https://e.com/<img&#9;src=x&#9;onerror=alert(1)>">l</a></p>',
      '<p><img src="https://e.com/p.png" alt="a&#10;&#10;<div onclick=x()>boo</div>"></p>',
      '<p><img src="https://e.com/p.png" alt="&lt;!-- note --&gt;"><a href="https://e.com/&lt;!-- note --&gt;">l</a></p>',
      '<p><a href="https://e.com/&#10;&#10;&lt;!--ins k3x9--&gt;">l</a></p>',
    ];
    for (const html of attacks) {
      const out = htmlToMarkdown(html);
      // Outside code, nothing here may be a tag or a comment.
      const outside = out.replace(/```[^]*?```/g, '').replace(/`[^`\n]*`/g, '');
      expect(outside, html).not.toMatch(/(?<!\\)<[a-z!?/]/i);
      expect(out, html).not.toContain('<!--');
    }
  });

  it('keeps the structure of formatted content in a block with a code style', () => {
    expect(
      htmlToMarkdown(
        '<div style="white-space:pre-wrap"><h2>Title</h2><p>para <b>bold</b> <a href="https://e.com/">link</a></p><ul><li>a</li><li>b</li></ul></div>',
      ),
    ).toBe('## Title\n\npara **bold** [link](https://e.com/)\n\n- a\n- b');
    expect(htmlToMarkdown('<div style="white-space:pre-wrap">Hello <b>bold</b> world</div>')).toBe(
      'Hello **bold** world',
    );
    expect(
      htmlToMarkdown(
        '<p style="font-family:monospace">Hello <b>bold</b> <a href="https://e.com/">link</a></p>',
      ),
    ).toBe('Hello **bold** [link](https://e.com/)');
    expect(
      htmlToMarkdown('<div style="font-family:Menlo"><p>One <b>x</b></p><p>Two</p></div>'),
    ).toBe('One **x**\n\nTwo');
  });

  it('reads highlighting in an editor’s copy as code, not as formatting', () => {
    const editor = (inner: string) =>
      `<div style="font-family:Menlo,monospace;white-space:pre">${inner}</div>`;
    const lines = (comment: string) =>
      editor(`<div>${comment}</div><div><span>    x = 1</span></div>`);
    for (const span of [
      '<span style="font-style:italic">// comment</span>',
      '<span style="font-weight:700">def</span><span> f():</span>',
      '<span style="text-decoration:underline;color:#f00">err</span>',
    ]) {
      const out = htmlToMarkdown(lines(span));
      expect(out.startsWith('```\n') && out.endsWith('\n    x = 1\n```'), out).toBe(true);
      expect(out).not.toContain('*');
    }
    // A link or a heading in it is content, and it is not a fence.
    expect(htmlToMarkdown(editor('<div><a href="https://e.com/">x</a></div>'))).toBe(
      '[x](https://e.com/)',
    );
  });

  it('pastes preserved lines in a proportional font as paragraphs with hard breaks', () => {
    expect(
      htmlToMarkdown(
        '<div style="white-space:pre-wrap;font-family:Arial, sans-serif">Line one<br>Line two<br>Line three</div>',
      ),
    ).toBe('Line one\\\nLine two\\\nLine three');
  });
});
