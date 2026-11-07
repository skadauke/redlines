import { Text } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { anchorAgain, aroundAnchor, type KeptAnchor } from './anchors.ts';

const text = (doc: string) => Text.of(doc.split('\n'));

/** An anchor on `word` in `doc`, kept with a copy of `doc`. */
function kept(doc: string, word: string, at = 0): KeptAnchor {
  const from = doc.indexOf(word, at);
  expect(from).toBeGreaterThanOrEqual(0);
  return { from, to: from + word.length, doc };
}

const on = (doc: string, { from, to }: { from: number; to: number }) => doc.slice(from, to);

describe('an anchor kept between sessions', () => {
  const before = 'Top.\n\nAlpha beta importer gamma delta.\n\nEnd.';

  it('is where it was in the same document', () => {
    expect(anchorAgain(kept(before, 'importer'), text(before))).toEqual({
      from: before.indexOf('importer'),
      to: before.indexOf('importer') + 8,
    });
  });

  it('keeps saying its text changed, in the same document', () => {
    const anchor = { ...kept(before, 'importer'), changed: true as const };
    expect(anchorAgain(anchor, text(before)).changed).toBe(true);
  });

  it('finds its text again when the document changed elsewhere', () => {
    const after = 'A new top line.\nAnd another.\n\nAlpha beta importer gamma delta.\n\nThe end.';
    const anchor = anchorAgain(kept(before, 'importer'), text(after));
    expect(on(after, anchor)).toBe('importer');
    expect(anchor.changed).toBeUndefined();
  });

  it('finds its text again when the rest of its line changed', () => {
    const after = 'Top.\n\nAlpha BETA importer gamma DELTA.\n\nEnd.';
    const anchor = anchorAgain(kept(before, 'importer'), text(after));
    expect(on(after, anchor)).toBe('importer');
    expect(anchor.changed).toBeUndefined();
  });

  it('is on what replaced its text, in whole words, and says so, when the text changed', () => {
    const after = 'Top.\n\nAlpha BETA exporter gamma DELTA.\n\nEnd.';
    const anchor = anchorAgain(kept(before, 'importer'), text(after));
    expect(anchor.changed).toBe(true);
    expect(on(after, anchor)).toBe('BETA exporter gamma DELTA');
  });

  it('says so rather than follow a repeated word to another place', () => {
    const doc = 'Intro. The importer reads files. The importer writes logs. End.';
    const after = 'Intro. The importer writes logs. The importer checks names. End.';
    expect(anchorAgain(kept(doc, 'importer', 20), text(after)).changed).toBe(true);
  });

  it('keeps a point where it maps, with nothing to lose', () => {
    const doc = 'One.  Two.';
    const anchor = anchorAgain({ from: 5, to: 5, doc }, text(`Zero. ${doc}`));
    expect(anchor).toEqual({ from: 11, to: 11 });
  });

  describe('without a copy of a long document', () => {
    const keptAround = (doc: string, word: string): KeptAnchor => {
      const from = doc.indexOf(word);
      const range = { from, to: from + word.length };
      return { ...range, around: aroundAnchor(range, text(doc)) };
    };

    it('is where it was with the same text around it', () => {
      const after = before.replace('End.', 'The end.');
      expect(anchorAgain(keptAround(before, 'importer'), text(after))).toEqual({
        from: before.indexOf('importer'),
        to: before.indexOf('importer') + 8,
      });
    });

    it('says its text changed when it is not', () => {
      const after = before.replace('Top.', 'A new top.');
      const anchor = anchorAgain(keptAround(before, 'importer'), text(after));
      expect(anchor.changed).toBe(true);
      expect(anchor.to).toBeLessThanOrEqual(after.length);
    });

    it('stays inside a document that got shorter', () => {
      const anchor = anchorAgain(keptAround(before, 'End'), text('Top.'));
      expect(anchor.changed).toBe(true);
      expect(anchor.from).toBeLessThanOrEqual(4);
      expect(anchor.to).toBeLessThanOrEqual(4);
    });
  });
});
