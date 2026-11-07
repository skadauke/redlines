import { micromark } from 'micromark';
import { describe, expect, it } from 'vitest';
import { readBlocks, sameBlocks } from './block-read.ts';
import { fuzzCount, seeded } from './random-docs.ts';

/** The HTML that CommonMark (micromark) makes of a text. */
const html = (text: string) => micromark(text, { allowDangerousHtml: true });

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
    ]) {
      expect(readBlocks(text), JSON.stringify(text)).toBeUndefined();
    }
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
