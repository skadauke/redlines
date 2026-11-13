import { describe, expect, it } from 'vitest';
import { micromark } from 'micromark';
import { gfm, gfmHtml } from 'micromark-extension-gfm';
import { chunkEngine, chunkHeader, markdownToHtml, withoutComments } from './markdown.ts';

describe('markdownToHtml', () => {
  it('draws Markdown, with GitHub’s extensions', () => {
    const html = markdownToHtml(
      '# Title\n\nSome *emphasis*, **strong**, ~~struck~~ and `code`, with a [link](https://example.com).\n\n- [x] done\n- [ ] not\n\nwww.example.org\n',
    );
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<em>emphasis</em>');
    expect(html).toContain('<strong>strong</strong>');
    expect(html).toContain('<del>struck</del>');
    expect(html).toContain('<code>code</code>');
    expect(html).toContain('<a href="https://example.com">link</a>');
    expect(html).toContain(
      '<li class="rl-task"><input type="checkbox" disabled="" checked="" /> done</li>',
    );
    expect(html).toContain('<li class="rl-task"><input type="checkbox" disabled="" /> not</li>');
    expect(html).toContain('<a href="http://www.example.org">www.example.org</a>');
  });

  it('draws footnotes', () => {
    const html = markdownToHtml('Text.[^1]\n\n[^1]: The note.\n');
    expect(html).toContain('<sup><a href="#user-content-fn-1"');
    expect(html).toContain('<section data-footnotes');
  });

  describe('a table', () => {
    const html = markdownToHtml('| a | b |\n| :- | -: |\n| 1 | 2 |\n');

    it('sits in a box that scrolls', () => {
      expect(html).toMatch(/^<div class="rl-tbl-scroll"><table>[\s\S]*<\/table><\/div>\n?$/);
    });

    it('keeps the alignment of its columns', () => {
      expect(html).toContain('<th align="left">a</th>');
      expect(html).toContain('<td align="right">2</td>');
    });
  });

  describe('raw HTML', () => {
    it('is text, never live', () => {
      const html = markdownToHtml(
        'A <script>alert(1)</script> and <b onclick="x()">bold</b>.\n\n<div onclick="x()">\nblock\n</div>\n',
      );
      expect(html).not.toMatch(/<script|<b |<div/);
      expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
      expect(html).toContain('&lt;div onclick=&quot;x()&quot;&gt;');
    });

    it('is never an image', () => {
      const html = markdownToHtml(
        '<img src="https://example.com/x.png" onerror="alert(1)">\n\nx <img src=y> z\n',
      );
      expect(html).not.toContain('<img');
      expect(html).toContain('&lt;img src=&quot;https://example.com/x.png&quot;');
    });

    it('keeps no address that could run or load a script', () => {
      const html = markdownToHtml(
        '[a](javascript:alert(1)) [b](data:text/html,x) [c](vbscript:x) [d](file:///etc/passwd)',
      );
      expect(html).not.toMatch(/javascript:|data:|vbscript:|file:/);
    });
  });

  describe('an image', () => {
    it('is its alt text, and no file is loaded', () => {
      const html = markdownToHtml(
        'Before ![A red caret](https://example.com/icon.png "The icon") after.\n',
      );
      expect(html).toBe('<p>Before <span class="rl-image">A red caret</span> after.</p>\n');
    });

    it('is its alt text from a reference, a local path and a data URL too', () => {
      const html = markdownToHtml(
        '![one][r] ![two](./two.png) ![three](data:image/png;base64,AAAA)\n\n[r]: https://example.com/r.png\n',
      );
      expect(html).not.toContain('<img');
      expect(html).toContain('<span class="rl-image">one</span>');
      expect(html).toContain('<span class="rl-image">two</span>');
      expect(html).toContain('<span class="rl-image">three</span>');
    });

    it('escapes what its alt text holds', () => {
      const html = markdownToHtml('![a "quoted" <b>word</b> & more](x.png)\n');
      expect(html).not.toContain('<b>');
      expect(html).toContain(
        '<span class="rl-image">a &quot;quoted&quot; &lt;b&gt;word&lt;/b&gt; &amp; more</span>',
      );
    });

    it('can be a link’s text', () => {
      const html = markdownToHtml('[![alt](x.png)](https://example.com)\n');
      expect(html).toBe(
        '<p><a href="https://example.com"><span class="rl-image">alt</span></a></p>\n',
      );
    });
  });

  describe('an HTML comment', () => {
    it('is not shown', () => {
      expect(markdownToHtml('One <!-- hidden --> two.\n')).toBe('<p>One  two.</p>\n');
      expect(markdownToHtml('<!-- a note -->\n\nText.\n')).not.toContain('note');
    });

    it('is not shown over several lines', () => {
      const html = markdownToHtml('Before.\n\n<!--\na note\nover lines\n-->\n\nAfter.\n');
      expect(html).not.toMatch(/note|lines|--/);
      expect(html).toContain('<p>Before.</p>');
      expect(html).toContain('<p>After.</p>');
    });

    it('is not shown among Redlines’ markers', () => {
      const html = markdownToHtml(
        'We will ship the <!--ins k3x9-->new <!--/k3x9-->importer.<!--del w2rf  Old.-->\n',
      );
      expect(html).toBe('<p>We will ship the new importer.</p>\n');
    });

    it('leaves the text after it on its line', () => {
      expect(markdownToHtml('<!-- note --> after\n')).toContain('after');
    });

    it('is code in code', () => {
      const html = markdownToHtml(
        '```html\n<!-- not a comment -->\n```\n\nA `<!-- span -->` here.\n',
      );
      expect(html).toContain('&lt;!-- not a comment --&gt;');
      expect(html).toContain('<code>&lt;!-- span --&gt;</code>');
    });
  });

  describe('a fenced chunk of R Markdown or Quarto', () => {
    const chunk = (info: string) => markdownToHtml(`\`\`\`${info}\ncode()\n\`\`\`\n`);

    it('keeps what its braces hold as a line over its code', () => {
      expect(chunk('{r setup, include=FALSE}')).toBe(
        '<pre><code class="language-r" data-chunk="r setup, include=FALSE">code()\n</code></pre>\n',
      );
      expect(chunk('{r, echo=FALSE}')).toContain('class="language-r" data-chunk="r, echo=FALSE"');
      expect(chunk('{r}')).toContain('class="language-r" data-chunk="r"');
      expect(chunk('{python}')).toContain('class="language-python" data-chunk="python"');
      expect(chunk('{{r}}')).toContain('class="language-r" data-chunk="r"');
    });

    it('escapes it', () => {
      expect(chunk('{r label="a<b", x=\'&\'}')).toContain(
        'data-chunk="r label=&quot;a&lt;b&quot;, x=\'&amp;\'"',
      );
    });

    it('shows Pandoc’s attributes as the line, with no language', () => {
      expect(chunk('{.python .numberLines}')).toBe(
        '<pre><code data-chunk=".python .numberLines">code()\n</code></pre>\n',
      );
    });

    it('leaves other fences as they were', () => {
      expect(chunk('js')).toBe('<pre><code class="language-js">code()\n</code></pre>\n');
      expect(chunk('')).toBe('<pre><code>code()\n</code></pre>\n');
      expect(chunk('js title="a.js"')).toBe(
        '<pre><code class="language-js">code()\n</code></pre>\n',
      );
    });

    it('gives only the opening fence a header, and each chunk its own', () => {
      const html = markdownToHtml('```{r a}\n1\n```\n\n```\nplain\n```\n\n```{r b}\n2\n```\n');
      expect(html.match(/data-chunk=/g)).toHaveLength(2);
      expect(html).toContain('data-chunk="r a"');
      expect(html).toContain('data-chunk="r b"');
    });

    it('keeps a tilde fence and a longer one', () => {
      expect(markdownToHtml('~~~{r x}\n1\n~~~\n')).toContain('data-chunk="r x"');
      expect(markdownToHtml('````{r y}\n```\n````\n')).toContain('data-chunk="r y"');
    });
  });
});

describe('chunkEngine', () => {
  it('names the engine of a chunk', () => {
    expect(chunkEngine('{r')).toBe('r');
    expect(chunkEngine('{r,')).toBe('r');
    expect(chunkEngine('{r}')).toBe('r');
    expect(chunkEngine('{ python }')).toBe('python');
    expect(chunkEngine('{{bash}}')).toBe('bash');
    expect(chunkEngine('{c++}')).toBe('c++');
  });

  it('names none for what is not a chunk', () => {
    expect(chunkEngine('js')).toBeNull();
    expect(chunkEngine('{.python}')).toBeNull();
    expect(chunkEngine('{}')).toBeNull();
  });
});

describe('chunkHeader', () => {
  it('is the info string without its braces', () => {
    expect(chunkHeader('{r setup, include=FALSE}')).toBe('r setup, include=FALSE');
    expect(chunkHeader('{r}')).toBe('r');
    expect(chunkHeader('{{r}} ')).toBe('r');
    expect(chunkHeader('{ python }')).toBe('python');
  });
});

describe('withoutComments', () => {
  it('takes comments out, and says whether one is open', () => {
    expect(withoutComments('a<!-- b -->c', false)).toEqual({ text: 'ac', inside: false });
    expect(withoutComments('a<!-- b', false)).toEqual({ text: 'a', inside: true });
    expect(withoutComments(' c --> d', true)).toEqual({ text: ' d', inside: false });
    expect(withoutComments('still inside', true)).toEqual({ text: '', inside: true });
    expect(withoutComments('<!--a--><!--b-->x<!--c', false)).toEqual({ text: 'x', inside: true });
    expect(withoutComments('', false)).toEqual({ text: '', inside: false });
  });
});

describe('a list item', () => {
  it('says whether it starts with a task’s box', () => {
    const html = markdownToHtml('- [x] done\n- [ ] not\n- plain\n');
    expect(html).toContain(
      '<li class="rl-task"><input type="checkbox" disabled="" checked="" /> done</li>',
    );
    expect(html).toContain('<li class="rl-task"><input type="checkbox" disabled="" /> not</li>');
    expect(html).toContain('<li>plain</li>');
  });

  it('says whether it is in a loose list', () => {
    const html = markdownToHtml('- one\n\n- two\n\n- [x] three\n');
    expect(html).toContain('<li class="rl-loose">\n<p>one</p>');
    expect(html).toContain(
      '<li class="rl-loose rl-task">\n<p><input type="checkbox" disabled="" checked="" /> three</p>',
    );
    expect(markdownToHtml('- one\n- two\n')).not.toContain('rl-loose');
  });

  it('is never made by the text of a document', () => {
    expect(markdownToHtml('A <li><input type="checkbox"> here\n')).not.toContain('rl-task');
  });
});

describe('markdownToHtml, where the text has nothing of what it changes', () => {
  // What micromark makes of text with no table, task, image, comment or braced fence is what the
  // preview makes of it, byte for byte, but for the class of a loose item: its handlers repeat
  // micromark's, and the fences' were once a count short, which put a blank line at the end of every
  // fence in a list or a quote.
  const inputs = [
    '# A title\n\nA paragraph with *emphasis*, **strength** and `code`.\n',
    '```js\ncode\n```\n',
    '```\nno language\n```\n\nafter\n',
    '~~~ts\nlet x = 1;\n~~~\n',
    '````md\n```\nnested\n```\n````\n',
    '```js\nnever closed\n',
    '- item\n\n  ```js\n  code\n  ```\n',
    '- item\n  ```js\n  code\n  ```\n- next\n',
    '- item\n  ```js\n  never closed\n',
    '> quoted\n>\n> ```js\n> code\n> ```\n',
    '> ```js\n> never closed\n',
    '1. one\n   ```\n   code\n   ```\n2. two\n',
    '    indented code\n\nafter\n',
    'A line  \nwith a hard break and a\\\nbackslash one.\n',
    '> a quote\n> over two lines\n\n---\n\n- a\n- b\n  - c\n',
    'Raw <b>HTML</b> and <div>blocks</div> are text.\n\n<div>\nblock\n</div>\n',
    '[a link](https://example.com "title") and <https://example.org> and https://example.net\n',
    'Setext\n======\n\nSetext two\n----------\n',
    '~~struck~~ text and a footnote.[^1]\n\n[^1]: The note.\n',
    '',
    '\n\n',
  ];

  it.each(inputs)('draws %j as micromark does', (source) => {
    expect(markdownToHtml(source).replaceAll(' class="rl-loose"', '')).toBe(
      micromark(source, { extensions: [gfm()], htmlExtensions: [gfmHtml()] }),
    );
  });
});
