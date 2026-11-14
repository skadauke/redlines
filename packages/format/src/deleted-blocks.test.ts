import { describe, expect, it } from 'vitest';
import { deletedBlocks, deletedTable } from './deleted-blocks.ts';
import type { DeletedBlock, DeletedBlocksContext } from './deleted-blocks.ts';
import { parse } from './parse.ts';
import { file } from './test-helpers.ts';
import type { Segment } from './types.ts';

/** The blocks the first mark of a body holds, with the text before its opener on its line. */
function blocksOf(body: string, context: DeletedBlocksContext = {}, marks = { k3x9: 'ada' }) {
  const text = file(body, marks);
  const mark = parse(text).marks[0]!;
  const segment = mark.segments[0]!;
  const lineStart = text.lastIndexOf('\n', segment.open.from - 1) + 1;
  const lead = text.slice(lineStart, segment.open.from);
  return deletedBlocks(mark.segments, { lead, ...context });
}

const summary = (blocks: ReturnType<typeof blocksOf>) =>
  blocks?.map((block) => [block.kind, block.text]);

describe('deletedBlocks', () => {
  it('reads a paragraph, with the text and no prefix', () => {
    expect(summary(blocksOf('One.\n\n<!--del k3x9 Two.\\n\\n-->\n\nThree.'))).toEqual([
      [{ kind: 'paragraph' }, 'Two.'],
    ]);
  });

  it('reads a heading with its level, in the kind', () => {
    expect(summary(blocksOf('<!--del k3x9 ## Head\\n\\n-->\n\nPara.'))).toEqual([
      [{ kind: 'heading', level: 2 }, 'Head'],
    ]);
    expect(summary(blocksOf('<!--del k3x9 ###### Deep\\n\\n-->\n\nPara.'))?.[0]?.[0]).toEqual({
      kind: 'heading',
      level: 6,
    });
  });

  it('reads an item with its marker, in front of the next item or of its own', () => {
    // The prefix of the next item takes the place of the deleted one's, outside the marker.
    const middle = blocksOf('- one\n- <!--del k3x9 two\\n- -->\n  three');
    expect(summary(middle)).toEqual([[{ kind: 'item', marker: '-', indent: 0, width: 2 }, 'two']]);
    const numbered = blocksOf('1. one\n2. <!--del k3x9 two\\n3. -->\n   three');
    expect(summary(numbered)).toEqual([
      [{ kind: 'item', marker: '2.', indent: 0, width: 3 }, 'two'],
    ]);
    // Its own prefix, in the payload, at the end of the text.
    const last = blocksOf('- one\n- two<!--del k3x9 \\n- three-->', { atEnd: true });
    expect(summary(last)).toEqual([[{ kind: 'item', marker: '-', indent: 0, width: 2 }, 'three']]);
  });

  it('reads a quote, code, a table and a rule as what they are', () => {
    expect(summary(blocksOf('<!--del k3x9 > quoted\\n> on\\n\\n-->\n\nAfter.'))).toEqual([
      [{ kind: 'quote' }, 'quoted on'],
    ]);
    expect(summary(blocksOf('<!--del k3x9 ```js\\na\\n\\nb\\n```\\n\\n-->\n\nAfter.'))).toEqual([
      [{ kind: 'code', language: 'js' }, 'a\n\nb'],
    ]);
    // A table keeps its text as its source lines, and has its own kind (below).
    expect(
      summary(blocksOf('<!--del k3x9 | a | b |\\n| - | - |\\n| 1 | 2 |\\n\\n-->\n\nAfter.'))?.map(
        ([kind, text]) => [(kind as { kind: string }).kind, text],
      ),
    ).toEqual([['table', '| a | b | | - | - | | 1 | 2 |']]);
    expect(summary(blocksOf('<!--del k3x9 ---\\n\\n-->\n\nAfter.'))).toEqual([
      [{ kind: 'other' }, '---'],
    ]);
  });

  it('reads an empty pair of fences as a code block with no lines', () => {
    const blocks = blocksOf('<!--del k3x9 ```\\n```\\n\\n-->\n\nAfter.');
    expect(blocks?.map((block) => [block.kind, block.text])).toEqual([
      [{ kind: 'code', language: '' }, ''],
    ]);
  });

  it('gives several blocks as several', () => {
    expect(
      summary(
        blocksOf('One.\n\n<!--del k3x9 Two.\\n\\n## Three\\n\\n- four\\n- five\\n\\n-->\n\nSix.'),
      ),
    ).toEqual([
      [{ kind: 'paragraph' }, 'Two.'],
      [{ kind: 'heading', level: 2 }, 'Three'],
      [{ kind: 'item', marker: '-', indent: 0, width: 2 }, 'four'],
      [{ kind: 'item', marker: '-', indent: 0, width: 2 }, 'five'],
    ]);
  });

  it('joins the lines of a block with a space', () => {
    expect(summary(blocksOf('<!--del k3x9 One\\ntwo\\nthree.\\n\\n-->\n\nAfter.'))).toEqual([
      [{ kind: 'paragraph' }, 'One two three.'],
    ]);
  });

  it('reads a block deleted at the end of the text, from the break in front of it', () => {
    expect(summary(blocksOf('One.\n\nTwo.<!--del k3x9 \\n\\nThree.-->', { atEnd: true }))).toEqual([
      [{ kind: 'paragraph' }, 'Three.'],
    ]);
    // Anywhere else it is not whole: text follows it.
    expect(blocksOf('One.\n\nTwo.<!--del k3x9 \\n\\nThree.-->', { atEnd: false })).toBeNull();
  });

  it('is null for a deletion that is not whole blocks', () => {
    // Part of a paragraph, and a deletion from the middle of one block into another.
    expect(blocksOf('One <!--del k3x9 two-->three.')).toBeNull();
    expect(
      blocksOf(
        'Alpha one <!--del k3x9 two three.\\n\\n## Middle heading\\n\\nGamma four -->five six.',
      ),
    ).toBeNull();
    // The opener alone on its line, but the deletion is a few words of the block after it.
    expect(blocksOf('One.\n\n<!--del k3x9 Note: -->\n\nThe importer ships.')).toBeNull();
    // A join: a break and a prefix.
    expect(blocksOf('Para<!--del k3x9 \\n\\n## -->Heading text', { atEnd: true })).toBeNull();
    expect(blocksOf('Para<!--del k3x9 \\n\\n-->Heading text', { atEnd: true })).toBeNull();
  });

  it("keeps the blocks as they are around another person's deletion inside them", () => {
    const text = file(
      'One.\n\n<!--del k3x9 Two -->\n\n<!--del m4m4 words-->\n\n<!--del k3x9  end.\\n\\n-->\n\nThree.',
      { k3x9: 'ada', m4m4: 'bo' },
    );
    const parsed = parse(text);
    const segments: Segment[] = parsed.marks
      .flatMap((mark) => mark.segments)
      .sort((a, b) => a.open.from - b.open.from);
    const blocks = deletedBlocks(segments);
    expect(blocks?.map((block) => block.text)).toEqual(['Two words end.']);
    // The pieces say where each stretch starts in the payloads put together.
    const joined = segments.map((segment) => segment.payload).join('');
    for (const piece of blocks![0]!.pieces)
      expect(joined.startsWith(piece.text, piece.at)).toBe(true);
  });
});

/** The one table of a deletion's blocks: its kind. */
function tableOf(body: string, context: DeletedBlocksContext = {}) {
  const blocks = blocksOf(body, context);
  const [block] = blocks ?? [];
  expect(blocks).toHaveLength(1);
  expect(block?.kind.kind).toBe('table');
  return block?.kind as Extract<DeletedBlock['kind'], { kind: 'table' }>;
}

/** A cell's text read back from the payload, where the cell says it starts. */
const textsOf = (kind: ReturnType<typeof tableOf>) =>
  kind.rows.map((row) => row.map((cell) => cell.text));

describe('a deleted table', () => {
  const TABLE = '| a | b |\\n| :- | -: |\\n| 1 | 2 |\\n| 3 | 4 |';

  it('is a table kind: its rows as written, the header first, and the delimiter row’s alignments', () => {
    const kind = tableOf(`One.\n\n<!--del k3x9 ${TABLE}\\n\\n-->\n\nAfter.`);
    expect(textsOf(kind)).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ]);
    expect(kind.aligns).toEqual(['left', 'right']);
    expect(kind.columns).toBe(2);
    // The rows are the header's and the body's: the delimiter row is no row.
    expect(kind.rowCount).toBe(3);
  });

  it('says where each cell starts, in the payloads put together', () => {
    const text = file(`One.\n\n<!--del k3x9 ${TABLE}\\n\\n-->\n\nAfter.`, { k3x9: 'ada' });
    const mark = parse(text).marks[0]!;
    const blocks = deletedBlocks(mark.segments);
    const kind = blocks?.[0]?.kind as ReturnType<typeof tableOf>;
    const joined = mark.segments.map((segment) => segment.payload).join('');
    for (const cell of kind.rows.flat()) expect(joined.startsWith(cell.text, cell.at)).toBe(true);
  });

  it('gives a cell as it is written: a pipe stays escaped and a line break stays <br>', () => {
    // In the marker the payload's `\|` is written `\\\|`, as `encodePayload` writes it.
    const kind = tableOf(
      'One.\n\n<!--del k3x9 | a \\\\\\| b | c<br>d |\\n| - | - |\\n| `x` | **y** |\\n\\n-->\n\nAfter.',
    );
    expect(textsOf(kind)).toEqual([
      ['a \\| b', 'c<br>d'],
      ['`x`', '**y**'],
    ]);
  });

  it('reads a table whose rows have no pipes at their ends, which GFM shows as a table', () => {
    for (const table of [
      'a | b\\n--- | ---\\n1 | 2',
      'a | b |\\n--- | --- |\\n1 | 2 |',
      '| a | b\\n| --- | ---\\n| 1 | 2',
    ]) {
      const kind = tableOf(`One.\n\n<!--del k3x9 ${table}\\n\\n-->\n\nAfter.`);
      expect(textsOf(kind), table).toEqual([
        ['a', 'b'],
        ['1', '2'],
      ]);
    }
  });

  it('counts the columns the header has, and keeps the cells of a ragged row as written', () => {
    const kind = tableOf(
      'One.\n\n<!--del k3x9 | a | b |\\n| - | - |\\n| short |\\n| 1 | 2 | 3 |\\n\\n-->\n\nAfter.',
    );
    expect(kind.columns).toBe(2);
    expect(textsOf(kind)).toEqual([['a', 'b'], ['short'], ['1', '2', '3']]);
  });

  it('is a table of a header alone', () => {
    const kind = tableOf('One.\n\n<!--del k3x9 | a | b |\\n| - | - |\\n\\n-->\n\nAfter.');
    expect(kind.rowCount).toBe(1);
    expect(textsOf(kind)).toEqual([['a', 'b']]);
  });

  it('is read in the form at the end of the text, behind the block above', () => {
    const kind = tableOf(`One.<!--del k3x9 \\n\\n${TABLE}-->`, { atEnd: true });
    expect(textsOf(kind)[0]).toEqual(['a', 'b']);
    expect(kind.rowCount).toBe(3);
  });

  it('is read from the payload alone when it is all the text, which no break is in', () => {
    // `deleteTable` writes a table that is the only block as its text, with no break at either end.
    const body = `<!--del k3x9 ${TABLE}-->`;
    expect(blocksOf(body, { atEnd: true })).toBeNull();
    const kind = tableOf(body, { atEnd: true, alone: true });
    expect(textsOf(kind)[0]).toEqual(['a', 'b']);
    expect(kind.rowCount).toBe(3);
    // Where the text goes on, or the block is not the whole text, it is not asked for.
    expect(blocksOf(body, { alone: true })).toBeNull();
    // Another kind of block is read the same, and the view that draws it chooses.
    expect(
      blocksOf('<!--del k3x9 Only.-->', { atEnd: true, alone: true })?.map((b) => b.kind.kind),
    ).toEqual(['paragraph']);
  });

  it('gives the cells of the first rows only when asked, and counts them all', () => {
    const rows = Array.from({ length: 20 }, (_, i) => `| r${i} | x |`).join('\\n');
    const kind = tableOf(
      `One.\n\n<!--del k3x9 | h | h |\\n| - | - |\\n${rows}\\n\\n-->\n\nAfter.`,
      { tableRows: 8 },
    );
    expect(kind.rowCount).toBe(21);
    expect(textsOf(kind)).toHaveLength(8);
    expect(textsOf(kind)[7]).toEqual(['r6', 'x']);
    // With no limit, all of them.
    const all = tableOf(`One.\n\n<!--del k3x9 | h | h |\\n| - | - |\\n${rows}\\n\\n-->\n\nAfter.`);
    expect(textsOf(all)).toHaveLength(21);
  });

  it('stands among other blocks as one block of its own', () => {
    const blocks = blocksOf(
      'One.\n\n<!--del k3x9 Intro.\\n\\n| a | b |\\n| - | - |\\n| 1 | 2 |\\n\\n## Head\\n\\n-->\n\nAfter.',
    );
    expect(blocks?.map((block) => block.kind.kind)).toEqual(['paragraph', 'table', 'heading']);
    expect(blocks?.[1]?.text).toBe('| a | b | | - | - | | 1 | 2 |');
  });

  it('ends at the text under it that starts a block of its own, and at a text line right above', () => {
    const above = blocksOf(
      'One.\n\n<!--del k3x9 Intro\\n| a | b |\\n| - | - |\\n| 1 | 2 |\\n\\n-->\n\nAfter.',
    );
    expect(above?.map((block) => block.kind.kind)).toEqual(['paragraph', 'table']);
    const below = blocksOf(
      'One.\n\n<!--del k3x9 | a | b |\\n| - | - |\\n| 1 | 2 |\\n# Head\\n\\n-->\n\nAfter.',
    );
    expect(below?.map((block) => block.kind.kind)).toEqual(['table', 'heading']);
  });

  it('keeps the source of a table that is not one: no delimiter row, or one with other cells', () => {
    for (const body of ['| a | b |\\n| c | d |', '| a | b |\\n| - |\\n| 1 | 2 |']) {
      const blocks = blocksOf(`One.\n\n<!--del k3x9 ${body}\\n\\n-->\n\nAfter.`);
      expect(
        blocks?.map((block) => block.kind.kind),
        body,
      ).not.toContain('table');
    }
  });

  it('is no table in a paragraph that has pipes in it, or a line of dashes', () => {
    for (const body of ['a | b | c', 'a | b\\n- | -', 'a | b\\n--- | --- | ---']) {
      const blocks = blocksOf(`One.\n\n<!--del k3x9 ${body}\\n\\n-->\n\nAfter.`);
      expect(
        blocks?.map((block) => block.kind.kind),
        body,
      ).not.toContain('table');
    }
  });

  it('is no table in a quote or a list item, which stay source', () => {
    const quote = blocksOf('One.\n\n<!--del k3x9 > | a |\\n> | - |\\n> | 1 |\\n\\n-->\n\nAfter.');
    expect(quote?.map((block) => block.kind.kind)).toEqual(['quote']);
    // (The marker after a bullet: the first line has the prefix in front of it.)
    const item = blocksOf('- one\n- <!--del k3x9 | a |\\n  | - |\\n  | 1 |\\n- -->\n  three');
    expect(item?.map((block) => block.kind.kind)).not.toContain('table');
    expect(item?.[0]?.kind.kind).toBe('item');
  });

  it('is no table in a code block, which keeps its lines', () => {
    const blocks = blocksOf(
      'One.\n\n<!--del k3x9 ```\\n| a | b |\\n| - | - |\\n```\\n\\n-->\n\nAfter.',
    );
    expect(blocks?.map((block) => block.kind.kind)).toEqual(['code']);
  });

  it('is read across the deletions of other people inside it, with each cell where it starts', () => {
    const text = file(
      'One.\n\n<!--del k3x9 | a | b |\\n| - | - |\\n| 1 | -->\n\n<!--del m4m4 two-->\n\n<!--del k3x9  |\\n\\n-->\n\nThree.',
      { k3x9: 'ada', m4m4: 'bo' },
    );
    const segments: Segment[] = parse(text)
      .marks.flatMap((mark) => mark.segments)
      .sort((a, b) => a.open.from - b.open.from);
    const kind = deletedBlocks(segments)?.[0]?.kind as ReturnType<typeof tableOf>;
    expect(textsOf(kind)).toEqual([
      ['a', 'b'],
      ['1', 'two'],
    ]);
    const joined = segments.map((segment) => segment.payload).join('');
    const two = kind.rows[1]![1]!;
    expect(joined.slice(two.at, two.at + two.text.length)).toBe('two');
  });

  it('is given the same for the same text again, which a keystroke elsewhere asks for', () => {
    const body = `One.\n\n<!--del k3x9 ${TABLE}\\n\\n-->\n\nAfter.`;
    expect(blocksOf(body)).toEqual(blocksOf(body));
  });
});

describe('deletedTable', () => {
  const TABLE = '| a | b |\n| :- | -: |\n| 1 | 2 |\n| 3 | 4 |';

  it('says how many columns and rows the payload’s one table has, in each form', () => {
    // In front of the block after it, behind the block above, and alone in the text.
    for (const payload of [`${TABLE}\n\n`, `\n\n${TABLE}`, TABLE]) {
      expect(deletedTable(payload), JSON.stringify(payload)).toEqual({ columns: 2, rows: 3 });
    }
    expect(deletedTable('| a | b | c |\n| - | - | - |\n\n')).toEqual({ columns: 3, rows: 1 });
    // The prefix of the block after it is no text of the payload, as for the blocks.
    expect(deletedTable(`${TABLE}\n\n> `)).toEqual({ columns: 2, rows: 3 });
    expect(deletedTable('a | b\n--- | ---\n1 | 2\n\n')).toEqual({ columns: 2, rows: 2 });
  });

  it('is null for a payload that is more than one table, or less', () => {
    expect(deletedTable(`Intro.\n\n${TABLE}\n\n`)).toBeNull();
    expect(deletedTable(`${TABLE}\n\nOutro.\n\n`)).toBeNull();
    expect(deletedTable(`${TABLE}\n\n${TABLE}\n\n`)).toBeNull();
    expect(deletedTable('Not a table.\n\n')).toBeNull();
    expect(deletedTable('| a | b |\n| c | d |\n\n')).toBeNull();
    expect(deletedTable('')).toBeNull();
  });
});
