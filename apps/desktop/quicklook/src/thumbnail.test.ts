// What a Finder thumbnail draws: the blocks at the start of a document, in the Clean view.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { blocksOf, MAX_BLOCKS, MAX_TEXT, plain, thumbnailBlocks, type Block } from './thumbnail.ts';

const fixture = (name: string) =>
  readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');

/** The text of every block, as one string, to say what a thumbnail doesn't hold. */
function everything(blocks: Block[]): string {
  return blocks
    .map((block) => {
      if (block.kind === 'table') return block.rows.flat().join(' ');
      return 'text' in block ? block.text : '';
    })
    .join('\n');
}

describe('plain', () => {
  it('takes the marks off the words', () => {
    expect(plain('A *plain* line, with **bold**, ~~struck~~ and `code`.')).toBe(
      'A plain line, with bold, struck and code.',
    );
    expect(
      plain('A [link](https://example.com/x), an ![image](a.png "T") and <https://example.org>.'),
    ).toBe('A link, an image and https://example.org.');
    expect(plain('A [reference][1] and an ![alt][2].')).toBe('A reference and an alt.');
  });

  it('keeps an underscore that is inside a word, and takes one that marks emphasis', () => {
    expect(plain('A snake_case_name is a word, and _this_ is stressed.')).toBe(
      'A snake_case_name is a word, and this is stressed.',
    );
    expect(plain('__Strong__ and **strong**')).toBe('Strong and strong');
  });

  it('leaves a star that stands alone, and the escapes and entities of the text', () => {
    expect(plain('2 * 3 * 4 and \\*not emphasis\\* &amp; &lt;b&gt;')).toBe(
      '2 * 3 * 4 and *not emphasis* & <b>',
    );
  });

  it('drops the tags and the comments, and keeps what is between them', () => {
    expect(
      plain('A <b>bold</b> word, a <!--cmt c8d2-->comment<!--/c8d2--> and <img src="x.png">.'),
    ).toBe('A bold word, a comment and .');
  });
});

describe('the blocks at the start of a document', () => {
  it('reads headings, paragraphs, lists, quotes, code and rules', () => {
    const blocks = blocksOf(fixture('plain.md'));
    expect(blocks.slice(0, 5)).toEqual([
      { kind: 'heading', level: 1, text: 'Field notes' },
      {
        kind: 'paragraph',
        text: 'A plain Markdown file, with bold, struck text, inline code, a link and an autolink: https://example.org.',
      },
      { kind: 'heading', level: 2, text: 'Lists' },
      { kind: 'item', depth: 0, marker: '•', text: 'First item' },
      { kind: 'item', depth: 0, marker: '•', text: 'Second item, with a nested list:' },
    ]);
    expect(
      blocks
        .filter((block) => block.kind === 'item')
        .map((block) => [block.depth, block.marker, block.text]),
    ).toEqual([
      [0, '•', 'First item'],
      [0, '•', 'Second item, with a nested list:'],
      [1, '•', 'Nested one'],
      [1, '•', 'Nested two'],
      [0, '☑', 'A task that is done'],
      [0, '☐', 'A task that is not'],
      [0, '1.', 'One'],
      [0, '2.', 'Two'],
      [0, '3.', 'Three'],
    ]);
    expect(blocks).toContainEqual({
      kind: 'quote',
      text: 'A quotation, set apart from the text around it. Its second paragraph.',
    });
    expect(blocks).toContainEqual({
      kind: 'code',
      text: 'export function greet(name: string): string {\n  return `Hello, ${name}`;\n}',
    });
    expect(blocks).toContainEqual({
      kind: 'paragraph',
      text: 'An image: A red caret on warm paper',
    });
    expect(blocks).toContainEqual({ kind: 'rule' });
    // The comment on a line of its own is nothing, and what stands before and after it is read.
    expect(everything(blocks)).not.toContain('only the author sees');
  });

  it('reads a table as its first rows, a few columns of it, with each cell cut short', () => {
    const blocks = blocksOf(fixture('table.md'));
    expect(blocks[0]).toEqual({ kind: 'heading', level: 1, text: 'Results' });
    expect(blocks[1]).toEqual({
      kind: 'table',
      rows: [
        ['Method', 'Runs', 'Mean (ms)', 'Notes'],
        ['Baseline', '12', '41.2', 'The current importer'],
        ['Streaming', '12', '18.9', 'Faster, but needs care'],
        ['Cached', '3', '2.4', 'One run per file'],
      ],
    });
    const second = blocks.filter((block) => block.kind === 'table')[1];
    expect(second?.kind === 'table' && second.rows[0]).toEqual(['Name', 'Description']);
    expect(second?.kind === 'table' && second.rows[1]?.[1]?.length).toBeLessThanOrEqual(41);
    expect(second?.kind === 'table' && second.rows[1]?.[1]?.endsWith('…')).toBe(true);
    expect(second?.kind === 'table' && second.rows[2]).toEqual(['two', 'Short.']);
  });

  it('reads a heading under its text, and a rule on its own', () => {
    expect(blocksOf('Title\n=====\n\nSub\n---\n\nText\n\n***\n\nMore\n')).toEqual([
      { kind: 'heading', level: 1, text: 'Title' },
      { kind: 'heading', level: 2, text: 'Sub' },
      { kind: 'paragraph', text: 'Text' },
      { kind: 'rule' },
      { kind: 'paragraph', text: 'More' },
    ]);
  });

  it('holds the lines of a paragraph as one, and of a quote as one', () => {
    expect(blocksOf('One line\nand the next\n\n> A\n> quote\n')).toEqual([
      { kind: 'paragraph', text: 'One line and the next' },
      { kind: 'quote', text: 'A quote' },
    ]);
  });

  it('keeps what is indented under an item with the item', () => {
    expect(blocksOf('- An item\n  that goes on\n- Another\n')).toEqual([
      { kind: 'item', depth: 0, marker: '•', text: 'An item that goes on' },
      { kind: 'item', depth: 0, marker: '•', text: 'Another' },
    ]);
  });

  it('shows a code block as its first lines, and a chunk by its code and not its header', () => {
    const lines = Array.from({ length: 20 }, (_, n) => `line ${n}`).join('\n');
    const [block] = blocksOf(`\`\`\`{r setup, include=FALSE}\n${lines}\n\`\`\`\n`);
    expect(block).toEqual({ kind: 'code', text: lines.split('\n').slice(0, 6).join('\n') });
    // A fence of tildes, and one that is never closed.
    expect(blocksOf('~~~\nA\n~~~\n\nAfter')).toEqual([
      { kind: 'code', text: 'A' },
      { kind: 'paragraph', text: 'After' },
    ]);
    expect(blocksOf('```\nA\nB')).toEqual([{ kind: 'code', text: 'A\nB' }]);
  });
});

describe('comments', () => {
  it('are not blocks: not on a line of their own, nor over lines, nor inside a paragraph', () => {
    const text = [
      'First',
      '',
      '<!-- one line -->',
      '',
      '<!-- over',
      'lines -->',
      '',
      '<!--cmt c1-->Anchored<!--/c1--> text, and <!--cmt c2-->more<!--/c2--> of it.',
      '',
      '<!-- redlines',
      'version: 1',
      'comments: []',
      '-->',
    ].join('\n');
    expect(blocksOf(text)).toEqual([
      { kind: 'paragraph', text: 'First' },
      { kind: 'paragraph', text: 'Anchored text, and more of it.' },
    ]);
  });

  it('are text in a code block', () => {
    expect(blocksOf('```html\n<!-- not a comment -->\n<p>x</p>\n```\n')).toEqual([
      { kind: 'code', text: '<!-- not a comment -->\n<p>x</p>' },
    ]);
  });
});

describe('the Clean view of a document', () => {
  it('has every change accepted, and nothing of the markers, the comments or the ledger', () => {
    const blocks = thumbnailBlocks(fixture('redlines.md'));
    expect(blocks).toEqual([
      { kind: 'heading', level: 1, text: 'Launch plan' },
      {
        kind: 'paragraph',
        text: 'We will ship the new importer in April, after the security review.',
      },
      { kind: 'paragraph', text: 'A second paragraph, which nobody has touched.' },
    ]);
    const all = everything(blocks);
    for (const unwanted of [
      'March',
      'exporter',
      'k3x9',
      'redlines',
      'version',
      'people',
      'Who signs off',
    ]) {
      expect(all).not.toContain(unwanted);
    }
  });

  it('has no front matter, and shows the chunks of R Markdown and Quarto as code', () => {
    const quarto = thumbnailBlocks(fixture('frontmatter.qmd'));
    expect(quarto[0]).toEqual({ kind: 'heading', level: 2, text: 'Setup' });
    expect(everything(quarto)).not.toContain('Penguin bills');
    expect(
      quarto.filter((block) => block.kind === 'code').map((block) => block.text.split('\n')[0]),
    ).toEqual(['library(palmerpenguins)', '#| label: fig-bills']);
    expect(thumbnailBlocks(fixture('analysis.Rmd'))).toEqual([
      { kind: 'heading', level: 1, text: 'Summary' },
      { kind: 'paragraph', text: "Last week's numbers, with the code that made them." },
      { kind: 'code', text: 'summary(cars)' },
      { kind: 'paragraph', text: 'Inline code, r 1 + 1, stays code.' },
    ]);
  });

  it('is the same for lines that end with CRLF', () => {
    const text = fixture('plain.md');
    expect(thumbnailBlocks(text.replace(/\n/g, '\r\n'))).toEqual(thumbnailBlocks(text));
  });

  it('says nothing for a file with nothing in it, and never throws on what it is given', () => {
    expect(thumbnailBlocks('')).toEqual([]);
    expect(thumbnailBlocks('\n\n   \n')).toEqual([]);
    for (const odd of [
      '<!--',
      '-->',
      '```',
      '| a |\n| - |',
      '> ',
      '- ',
      '#',
      '***\n---\n===',
      '<!--ins k3x9-->open',
      '\u0000�',
    ]) {
      expect(() => thumbnailBlocks(odd)).not.toThrow();
    }
  });
});

describe('what a thumbnail asks for', () => {
  it('stops at the most blocks, and at the most text, and cuts a long paragraph short', () => {
    const many = Array.from({ length: 200 }, (_, n) => `Paragraph ${n}`).join('\n\n');
    expect(blocksOf(many)).toHaveLength(MAX_BLOCKS);

    const long = `${'A fairly long sentence that goes on. '.repeat(40)}`;
    const [clipped] = blocksOf(long);
    expect(clipped?.kind === 'paragraph' && clipped.text.length).toBeLessThanOrEqual(361);
    expect(clipped?.kind === 'paragraph' && clipped.text.endsWith('…')).toBe(true);

    const wide = blocksOf(Array.from({ length: 60 }, () => long).join('\n\n'));
    expect(everything(wide).length).toBeLessThan(MAX_TEXT + 400);
  });

  it('reads a large file as fast as a small one, for it stops where a page ends', () => {
    const section =
      '## A section\n\nA paragraph of text, which goes on for a while.\n\n- one\n- two\n\n';
    const large = `${section.repeat(40_000)}`;
    expect(large.length).toBeGreaterThan(2_000_000);
    const started = performance.now();
    const blocks = blocksOf(large);
    expect(blocks).toHaveLength(MAX_BLOCKS);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});
