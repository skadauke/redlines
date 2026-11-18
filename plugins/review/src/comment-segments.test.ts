// A comment with one segment per block and one id (format §4: a reader takes it, as other tools
// may write it, #1024): the rail shows it as one note, with a range for each segment, and deleting
// the thread removes every segment.
import { applyChanges, deleteThread, parse } from '@redlines/format';
import { describe, expect, it } from 'vitest';
import { notesIn } from './rail.ts';

const LEDGER = [
  '<!-- redlines',
  "# If git shows a merge conflict in this block, keep both sides. The order of entries doesn't matter.",
  'version: 1',
  'people:',
  '  ada: {name: Ada Lovelace}',
  'comments:',
  '  c8d2:',
  '    by: ada',
  '    at: 2026-10-13T22:40Z',
  '    text: |-',
  '      A note.',
  '-->',
  '',
].join('\n');
const BODY =
  'First <!--cmt c8d2-->para.<!--/c8d2-->\n\n<!--cmt c8d2-->\nSecond<!--/c8d2--> para.\n';
const written = `${BODY}\n${LEDGER}`;

describe('a comment with one segment per block', () => {
  it('is one note whose ranges are its segments', () => {
    const parsed = parse(written);
    expect(parsed.marks.map((mark) => mark.segments.length)).toEqual([2]);
    const notes = notesIn(parsed, []);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.ranges).toHaveLength(2);
    const [first, second] = notes[0]?.ranges ?? [];
    expect(written.slice(first?.from, first?.to)).toBe('para.');
    expect(written.slice(second?.from, second?.to)).toBe('Second');
  });

  it('is removed in every segment when the thread is deleted, and the text stays', () => {
    const removed = applyChanges(written, deleteThread(written, 'c8d2'));
    expect(parse(removed).marks).toEqual([]);
    expect(removed).not.toContain('cmt');
    expect(removed).toContain('First para.');
    expect(removed).toContain('Second para.');
  });
});
