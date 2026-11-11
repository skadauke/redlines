import { describe, expect, it } from 'vitest';
import { deletedBlocks } from './deleted-blocks.ts';
import type { DeletedBlocksContext } from './deleted-blocks.ts';
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
      [{ kind: 'other' }, '```js a b ```'],
    ]);
    expect(
      summary(blocksOf('<!--del k3x9 | a | b |\\n| - | - |\\n| 1 | 2 |\\n\\n-->\n\nAfter.')),
    ).toEqual([[{ kind: 'other' }, '| a | b | | - | - | | 1 | 2 |']]);
    expect(summary(blocksOf('<!--del k3x9 ---\\n\\n-->\n\nAfter.'))).toEqual([
      [{ kind: 'other' }, '---'],
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
