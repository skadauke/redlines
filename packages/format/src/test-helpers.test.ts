import { describe, expect, it } from 'vitest';
import { CheckFailed, blockLeaves, failsFirstWithout, file, named } from './test-helpers.ts';

describe('blockLeaves, the oracle of how a file reads (format §9.1)', () => {
  it('reads a GitHub table as a table, cell by cell', () => {
    const text = 'Intro.\n\n| a | b |\n| --- | --- |\n| c *d* | e |\n';
    expect(blockLeaves(text)).toEqual([
      { chain: [], kind: 'p', text: 'Intro.' },
      {
        chain: [],
        kind: 'table',
        text: 'a | b || c d | e',
        rows: [
          ['a', 'b'],
          ['c d', 'e'],
        ],
      },
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
      { chain: ['ul', 'li'], kind: 'table', text: 'a || b', rows: [['a'], ['b']] },
    ]);
    expect(blockLeaves('> | a |\n> | - |\n')).toEqual([
      { chain: ['blockquote'], kind: 'table', text: 'a', rows: [['a']] },
    ]);
  });

  it('reads GFM strikethrough, as the editor does, so its tildes are no text', () => {
    expect(blockLeaves('a ~~b~~ c ~d~\n')).toEqual([{ chain: [], kind: 'p', text: 'a b c d' }]);
    expect(blockLeaves('a ~~~b~~~\n')).toEqual([{ chain: [], kind: 'p', text: 'a ~~~b~~~' }]);
  });

  describe('a table as one block with its cells', () => {
    const rowsOf = (text: string) => blockLeaves(text).find((leaf) => leaf.kind === 'table')?.rows;

    it('reads a pipe table as one block with its cells', () => {
      const leaves = blockLeaves('| a | b |\n| - | - |\n| c | d |');
      expect(leaves).toHaveLength(1);
      expect(leaves[0]?.kind).toBe('table');
      expect(rowsOf('| a | b |\n| - | - |\n| c | d |')).toEqual([
        ['a', 'b'],
        ['c', 'd'],
      ]);
    });

    it('reads a row with fewer cells with empty cells after it', () => {
      expect(rowsOf('| a | b | c |\n| - | - | - |\n| d |')).toEqual([
        ['a', 'b', 'c'],
        ['d', '', ''],
      ]);
    });

    it('reads \\| as a pipe in a cell and a pipe in a code span as a cell break', () => {
      expect(rowsOf('| a | b |\n| - | - |\n| x \\| y | z |')).toEqual([
        ['a', 'b'],
        ['x | y', 'z'],
      ]);
      expect(rowsOf('| a | b |\n| - | - |\n| `x | y` | z |')?.[1]).toEqual(['`x', 'y`']);
    });

    it('reads a row with marked first cell as a cell', () => {
      expect(rowsOf('| Fruit | Count |\n| - | - |\n| <!--ins k3x9 row--> Pears | 5 |')).toEqual([
        ['Fruit', 'Count'],
        ['Pears', '5'],
      ]);
    });
  });
});

describe('failsFirstWithout, what excuses a failure of a random suite as older than the alignment change', () => {
  const MARK = '<!--fmt k3x9 align=\\|\\x20-\\x20\\|-->';
  const state = (extra = '') => file(`| h${MARK} |\n| - |\n| c${extra} |`, { k3x9: 'ada' });
  /** What a suite's checks do: stop at the first to fail, with the name it is known by. */
  const failed = (run: (text: string) => void, text: string): unknown => {
    try {
      run(text);
    } catch (error) {
      return error;
    }
    return undefined;
  };

  it('excuses a failure that the file without the mark has first as well', () => {
    // The file fails the second check with or without the mark, and passes the first with and without it.
    const run = (text: string) => {
      named('the first check', () => expect(text).not.toContain('XX'));
      named('the second check', () => expect(text).not.toContain('YY'));
    };
    const text = state(' YY');
    const error = failed(run, text);
    expect(error).toBeInstanceOf(CheckFailed);
    expect((error as CheckFailed).check).toBe('the second check');
    expect(failsFirstWithout(error, text, run)).toBe(true);
  });

  it('does not excuse a failure that the mark makes: the file without it passes', () => {
    const run = (text: string) =>
      named('the check', () => expect(text).not.toContain('<!--fmt k3x9'));
    const text = state();
    expect(failsFirstWithout(failed(run, text), text, run)).toBe(false);
  });

  it('does not excuse a failure when the file without the mark fails another check first', () => {
    // With the mark the first check passes (it asks for the mark) and the second fails; without it the first fails.
    const run = (text: string) => {
      named('the first check', () => expect(text).toContain('<!--fmt k3x9'));
      named('the second check', () => expect(text).not.toContain('YY'));
    };
    const text = state(' YY');
    const error = failed(run, text);
    expect((error as CheckFailed).check).toBe('the second check');
    expect(failsFirstWithout(error, text, run)).toBe(false);
  });

  it('does not excuse a failure that no check named, or one that another check named', () => {
    const run = (text: string) => {
      named('the check', () => expect(text).not.toContain('YY'));
    };
    const text = state(' YY');
    // The same text fails in the control, but a failure that no check named is no failure to compare.
    expect(failsFirstWithout(new Error('YY'), text, run)).toBe(false);
    expect(failsFirstWithout(undefined, text, run)).toBe(false);
    // Another name for the same failure is another check.
    expect(failsFirstWithout(new CheckFailed('another check', new Error('YY')), text, run)).toBe(
      false,
    );
    expect(failsFirstWithout(failed(run, text), text, run)).toBe(true);
  });
});
