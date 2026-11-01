import { describe, expect, it } from 'vitest';
import { lineChanges } from './diff.ts';

/** Applies changes, given in the old text's offsets, in order. */
function apply(text: string, changes: { from: number; to: number; insert: string }[]): string {
  let result = '';
  let pos = 0;
  for (const change of changes) {
    result += text.slice(pos, change.from) + change.insert;
    pos = change.to;
  }
  return result + text.slice(pos);
}

const lines = (n: number) => Array.from({ length: n }, (_, i) => `Line ${i + 1}.`).join('\n');

describe('lineChanges', () => {
  it('finds nothing to change in equal texts', () => {
    expect(lineChanges('One\nTwo\n', 'One\nTwo\n')).toEqual([]);
  });

  it('changes each edited stretch on its own, trimmed to what differs', () => {
    const before = lines(60);
    const after = before.replace('Line 2.', 'Line two.').replace('Line 58.', 'Line 58, edited.');
    const changes = lineChanges(before, after);
    expect(changes).toEqual([
      { from: before.indexOf('2.'), to: before.indexOf('2.') + 1, insert: 'two' },
      { from: before.indexOf('58.') + 2, to: before.indexOf('58.') + 2, insert: ', edited' },
    ]);
    expect(apply(before, changes)).toBe(after);
  });

  it('inserts and deletes whole lines', () => {
    const before = 'a\nb\nc\nd\n';
    const after = 'a\nnew\nb\nd\n';
    const changes = lineChanges(before, after);
    expect(changes).toEqual([
      { from: 2, to: 2, insert: 'new\n' },
      { from: 4, to: 6, insert: '' },
    ]);
    expect(apply(before, changes)).toBe(after);
  });

  it('never splits a surrogate pair', () => {
    expect(lineChanges('Ship it 😀 now', 'Ship it 😁 now')).toEqual([
      { from: 8, to: 10, insert: '😁' },
    ]);
    // The pair's low half differs, and so does the text after it.
    expect(lineChanges('a😀b', 'a😁c')).toEqual([{ from: 1, to: 4, insert: '😁c' }]);
  });

  it('still turns one text into the other past its limit of edits', () => {
    const before = Array.from({ length: 3000 }, (_, i) => `a${i}`).join('\n');
    const after = Array.from({ length: 3000 }, (_, i) => (i % 2 ? `b${i}` : `a${i}`)).join('\n');
    expect(apply(before, lineChanges(before, after))).toBe(after);
  });
});
