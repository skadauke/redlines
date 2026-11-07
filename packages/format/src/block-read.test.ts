import { micromark } from 'micromark';
import { describe, expect, it } from 'vitest';
import { readBlocks, sameBlocks } from './block-read.ts';
import { fuzzCount, seeded } from './random-docs.ts';

/** The HTML that CommonMark (micromark) makes of a text. */
const html = (text: string) => micromark(text, { allowDangerousHtml: true });

/** Characters that JavaScript takes for white space and CommonMark for text: a no-break space, an
 * ideographic space, a byte order mark, an em space, a vertical tab, a form feed, a line
 * separator. */
const WHITE_SPACE = ['\u00a0', '\u3000', '\ufeff', '\u2003', '\u000b', '\u000c', '\u2028'];

/** The blocks of a text, one line each: path, kind and text. */
const read = (text: string) =>
  readBlocks(text)?.map(({ path, kind, text }) => `${path} ${kind} ${JSON.stringify(text)}`);

/** Whether the text reads the same with its first blank line as without it. */
const alike = (text: string) => {
  const at = text.indexOf('\n\n');
  return sameBlocks(text.slice(0, at), '\n\n', '\n', text.slice(at + 2));
};

describe('readBlocks', () => {
  it('reads each block, its kind, its text and the containers it is in', () => {
    expect(read('> A long quote that\nwraps lazily.\n\n> Another quote.')).toEqual([
      'q0 quote ""',
      'q0 paragraph "A long quote that\\nwraps lazily."',
      'q1 quote ""',
      'q1 paragraph "Another quote."',
    ]);
    expect(read('> A long quote that\nwraps lazily.\n> Another quote.')).toEqual([
      'q0 quote ""',
      'q0 paragraph "A long quote that\\nwraps lazily.\\nAnother quote."',
    ]);
    expect(read('- a\n  > b\nlazy\n\n  c\n# Head\n```js\nx\n\ny\n```\n    code')).toEqual([
      'i0 item "-"',
      'i0 paragraph "a"',
      'i0q1 quote ""',
      'i0q1 paragraph "b\\nlazy"',
      'i0 paragraph "c"',
      ' h1 "Head"',
      ' fence "js\\nx\\n\\ny"',
      ' code "code"',
    ]);
    expect(read('Setext\n===\n\n<div>\nx\n</div>\n\n1. one\n2. two')).toEqual([
      ' h1 "Setext"',
      ' html "<div>\\nx\\n</div>"',
      'i0 item "1."',
      'i0 paragraph "one"',
      'i1 item "2."',
      'i1 paragraph "two"',
    ]);
  });

  it('reads a line that only looks like a block as a line of the paragraph above', () => {
    expect(read('One two.\n```a`b`')).toEqual([' paragraph "One two.\\n```a`b`"']);
    expect(read('One two.\n<!-x')).toEqual([' paragraph "One two.\\n<!-x"']);
    expect(read('One two.\n<span>x</span>')).toEqual([' paragraph "One two.\\n<span>x</span>"']);
    expect(read('One two.\n2. two')).toEqual([' paragraph "One two.\\n2. two"']);
    expect(read('One two.\n    code')).toEqual([' paragraph "One two.\\ncode"']);
  });

  it('gives nothing for what it does not read', () => {
    for (const text of [
      'One\ttwo.',
      '- \n  one',
      '-     code',
      '> a\n===',
      '<custom-tag>\nx',
      '```\nopen',
      '<!--\nopen',
      // A carriage return alone ends a line for micromark.
      'a\rb',
      'a\n\rb',
    ]) {
      expect(readBlocks(text), JSON.stringify(text)).toBeUndefined();
    }
  });

  it('reads a line of other white space as a line of text, as CommonMark does (#129)', () => {
    // Only spaces and tabs make a line blank: a no-break space, an ideographic or em space, a byte
    // order mark, a vertical tab, a form feed or a line separator is text, and the line goes on
    // with the paragraph above, lazily or not. They were taken for blank lines.
    for (const ws of WHITE_SPACE) {
      const label = JSON.stringify(ws);
      expect(read(`> a\n${ws}`), label).toEqual([
        'q0 quote ""',
        `q0 paragraph ${JSON.stringify(`a\n${ws}`)}`,
      ]);
      expect(read(`a\n${ws}\n===`), label).toEqual([` h1 ${JSON.stringify(`a\n${ws}`)}`]);
      expect(read(`a\n    ${ws}`), label).toEqual([` paragraph ${JSON.stringify(`a\n${ws}`)}`]);
    }
    // A carriage return and a line feed end one line, as a line feed does.
    expect(read('> a\r\nlazy\r\n\r\n> q')).toEqual(read('> a\nlazy\n\n> q'));
  });
});

describe('sameBlocks', () => {
  it('reads the blocks the same without a blank line where CommonMark renders them the same (#129)', () => {
    for (const [text, same] of [
      ['One two.\n\n# Head', true],
      ['One two.\n\n> q', true],
      ['> a\nlazy\n\n# Head', true],
      ['- a\nlazy\n\n> q', true],
      ['- One two.\n\n# Head', true],
      ['One two.\n\n```\ncode\n```', true],
      ['One two.\n\n<?php x ?>', true],
      ['> A long quote that\nwraps lazily.\n\n> Another quote.', false],
      ['> > a\nlazy\n\n> q', false],
      ['> - a\nlazy\n\n> q', false],
      ['One two.\n\n```a`b`', false],
      ['One two.\n\n<!-x', false],
      ['One two.\n\n---', false],
      ['- One two.\n\n- Three.', false],
      ['- One two.\n\n  # Head', false],
    ] as const) {
      expect(alike(text), JSON.stringify(text)).toBe(same);
      if (same) expect(html(text.replace('\n\n', '\n')), JSON.stringify(text)).toBe(html(text));
    }
  });

  it('reads a line of other white space as text, and a carriage return alone as a line end (#129)', () => {
    // A line of a no-break space (or another character that JavaScript takes for white space) above
    // the blank line is a line of text: the quote above goes on with the quote below, the paragraph
    // becomes a heading or takes the code in. A carriage return alone ends a line, so a lazy line
    // after it is a line of its own. None of them reads the same without the blank line.
    for (const ws of WHITE_SPACE) {
      for (const [head, tail] of [
        [`> a\n${ws}`, '> q'],
        [`> a\n${ws}`, '> > q'],
        [`- a\n${ws}`, '- b'],
        [`> - a\n${ws}`, '> q'],
        [`a\n${ws}`, '==='],
        [`a\n${ws}`, '---'],
        [`a\n${ws}`, '    code'],
        [`> A long quote\n${ws}`, '> Another.'],
      ] as const) {
        const label = JSON.stringify(`${head}\n\n${tail}`);
        expect(html(`${head}\n${tail}`), label).not.toBe(html(`${head}\n\n${tail}`));
        expect(sameBlocks(head, '\n\n', '\n', tail), label).toBe(false);
      }
    }
    for (const [head, tail] of [
      ['a\n- > a\n\rb', '---'],
      ['- a\n\rb', '---'],
    ] as const) {
      const label = JSON.stringify(`${head}\n\n${tail}`);
      expect(html(`${head}\n${tail}`), label).not.toBe(html(`${head}\n\n${tail}`));
      expect(sameBlocks(head, '\n\n', '\n', tail), label).toBe(false);
    }
  });

  it('reads alike only what CommonMark renders the same, in random texts (#129)', () => {
    // Random lines, a blank line among them: wherever the blocks read the same without the blank
    // line, micromark renders the two texts the same.
    const LINES = [
      'One two.',
      'lazy',
      'more words',
      '> q',
      '> > q',
      '>',
      '> - item',
      '- > q',
      '- item',
      '* item',
      '1. item',
      '2. item',
      '  - nested',
      '  text',
      '    code',
      '# Head',
      '## Two #',
      '#',
      '***',
      '---',
      '===',
      '___',
      '```',
      '```js',
      '```a`b`',
      '~~~',
      '<div>',
      '</div>',
      '<!-- c -->',
      '<!--',
      '-->',
      '<!-x',
      '<?php',
      '?>',
      '<![CDATA[ x ]]>',
      '<span>x</span>',
      '<pre>',
      '</pre>',
      '| a | b |',
      '[a]: /u',
      'One two.\\',
      'One two.  ',
      '-',
      '1.',
      '>     code',
      // What JavaScript takes for white space and CommonMark for text, and carriage returns.
      ...WHITE_SPACE,
      ...WHITE_SPACE.map((ws) => `a${ws}`),
      '\u00a0text',
      ' \u00a0',
      '>\u00a0q',
      '-\u00a0x',
      '\r',
      '\rb',
      'x\ry',
      'line\r',
    ];
    const texts = fuzzCount(3000);
    let same = 0;
    for (let seed = 1; seed <= texts; seed++) {
      const random = seeded(seed * 7919);
      const below = (n: number) => Math.floor(random() * n);
      const lines = Array.from({ length: 2 + below(7) }, () => LINES[below(LINES.length)] ?? '');
      const at = 1 + below(lines.length - 1);
      const head = lines.slice(0, at).join('\n');
      const tail = lines.slice(at).join('\n');
      if (!sameBlocks(head, '\n\n', '\n', tail)) continue;
      same++;
      const label = JSON.stringify(`${head}\n\n${tail}`);
      expect(html(`${head}\n${tail}`), label).toBe(html(`${head}\n\n${tail}`));
    }
    expect(same).toBeGreaterThan(texts / 10);
  });
});
