import { describe, expect, it } from 'vitest';
import { blockLeaves } from './test-helpers.ts';

describe('blockLeaves, the oracle of how a file reads (format §9.1)', () => {
  it('reads a GitHub table as a table, cell by cell', () => {
    const text = 'Intro.\n\n| a | b |\n| --- | --- |\n| c *d* | e |\n';
    expect(blockLeaves(text)).toEqual([
      { chain: [], kind: 'p', text: 'Intro.' },
      { chain: [], kind: 'table', text: 'a | b || c d | e' },
    ]);
  });

  it('tells a table from the paragraph it is when its delimiter row is gone', () => {
    const table = blockLeaves('| a | b |\n| --- | --- |\n| c | d |\n');
    const paragraph = blockLeaves('| a | b |\n| c | d |\n');
    expect(table.map((leaf) => leaf.kind)).toEqual(['table']);
    expect(paragraph.map((leaf) => leaf.kind)).toEqual(['p']);
  });

  it('tells cells apart when a pipe moves between them', () => {
    expect(blockLeaves('| a b | c |\n| - | - |\n')).not.toEqual(
      blockLeaves('| a | b c |\n| - | - |\n'),
    );
  });

  it('reads a table in a list item and in a quote, in its containers', () => {
    expect(blockLeaves('- | a |\n  | - |\n  | b |\n')).toEqual([
      { chain: ['ul', 'li'], kind: 'table', text: 'a || b' },
    ]);
    expect(blockLeaves('> | a |\n> | - |\n')).toEqual([
      { chain: ['blockquote'], kind: 'table', text: 'a' },
    ]);
  });

  it('reads GFM strikethrough, as the editor does, so its tildes are no text', () => {
    expect(blockLeaves('a ~~b~~ c ~d~\n')).toEqual([{ chain: [], kind: 'p', text: 'a b c d' }]);
    expect(blockLeaves('a ~~~b~~~\n')).toEqual([{ chain: [], kind: 'p', text: 'a ~~~b~~~' }]);
  });
});
