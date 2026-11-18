// A comment across blocks is one segment per block with one id (format §4, #1024): the rail shows
// it as one note, with a range for each segment.
import { addComment, applyChanges, parse } from '@redlines/format';
import { describe, expect, it } from 'vitest';
import { notesIn } from './rail.ts';

describe('a comment across blocks', () => {
  it('is one note whose ranges are its segments', () => {
    const body = 'First para.\n\nSecond para.\n';
    const ctx = {
      author: { handle: 'ada', name: 'Ada Lovelace', email: 'ada@example.org' },
      time: '2026-10-13T22:30Z',
      random: (n: number) => Uint8Array.from({ length: n }, (_, i) => 7 + i * 13),
    };
    const from = body.indexOf('para');
    const to = body.indexOf('Second') + 3;
    const written = applyChanges(body, addComment(body, { from, to }, 'x', ctx).changes);
    const parsed = parse(written);
    expect(parsed.marks.map((mark) => mark.segments.length)).toEqual([2]);
    const notes = notesIn(parsed, []);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.ranges).toHaveLength(2);
    const [first, second] = notes[0]?.ranges ?? [];
    expect(written.slice(first?.from, first?.to)).toBe('para.');
    expect(written.slice(second?.from, second?.to)).toBe('Sec');
  });
});
