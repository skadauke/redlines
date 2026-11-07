import { Text } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { anchorAgain, contextOf, type KeptAnchor } from './anchors.ts';

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
    const keptAround = (doc: string, word: string, at = 0): KeptAnchor => {
      const from = doc.indexOf(word, at);
      const range = { from, to: from + word.length };
      return { ...range, ...contextOf(range, text(doc)) };
    };
    const point = (doc: string, from: number): KeptAnchor => ({
      from,
      to: from,
      ...contextOf({ from, to: from }, text(doc)),
    });

    it('keeps its text and some of what is around it', () => {
      const doc = 'x'.repeat(50) + ' importer ' + 'y'.repeat(50);
      expect(contextOf({ from: 51, to: 59 }, text(doc))).toEqual({
        quote: 'importer',
        before: 'x'.repeat(31) + ' ',
        after: ' ' + 'y'.repeat(31),
      });
    });

    it('is where it was with the same text around it', () => {
      const after = `${before}\n\nA last line, out of reach.`;
      expect(anchorAgain(keptAround(before, 'importer'), text(after))).toEqual({
        from: before.indexOf('importer'),
        to: before.indexOf('importer') + 8,
      });
    });

    it('is found by its text alone, when what is around it changed and it is there once', () => {
      const after = before.replace('Alpha beta', 'ALPHA BETA').replace('End.', 'The end.');
      const anchor = anchorAgain(keptAround(before, 'importer'), text(after));
      expect(on(after, anchor)).toBe('importer');
      expect(anchor.changed).toBeUndefined();
    });

    it('says so when what is around it changed and its text is there more than once', () => {
      const doc = 'The importer reads. The importer writes.';
      const kept = keptAround(doc, 'importer', 10);
      expect(anchorAgain(kept, text('The importer reads. An importer logs.')).changed).toBe(true);
    });

    it('says so when its text is there once but grew into a longer word', () => {
      const after = before.replace('Alpha beta importer', 'ALPHA importers');
      expect(anchorAgain(keptAround(before, 'importer'), text(after)).changed).toBe(true);
    });

    it('is found by its text and what is around it when the document changed before it', () => {
      const after = `A new first line.\n\n${before}`;
      const anchor = anchorAgain(keptAround(before, 'importer'), text(after));
      expect(on(after, anchor)).toBe('importer');
      expect(anchor.changed).toBeUndefined();
    });

    it('is found at the nearest place with the same text around it', () => {
      const line = 'The importer reads files.\n';
      const doc = line.repeat(3);
      const kept = keptAround(doc, 'importer', line.length);
      const anchor = anchorAgain(kept, text(`Hi.\n${doc}`));
      expect(anchor.from).toBe(4 + line.length + 4);
      expect(anchor.changed).toBeUndefined();
    });

    it('says its text changed when its text, with what is around it, is nowhere', () => {
      const after = before.replace('importer', 'exporter');
      const anchor = anchorAgain(keptAround(before, 'importer'), text(after));
      expect(anchor.changed).toBe(true);
      expect(on(after, anchor)).toBe('exporter');
    });

    it('finds a point by what is around it, and never stays on other text unsaid', () => {
      const doc = 'One.  Two.';
      const moved = anchorAgain(point(doc, 5), text(`Zero. ${doc}`));
      expect(moved).toEqual({ from: 11, to: 11 });
      const lost = anchorAgain(point(doc, 5), text('Zero. One. Two and three.'));
      expect(lost.changed).toBe(true);
    });

    it('stays inside a document that got shorter', () => {
      const anchor = anchorAgain(keptAround(before, 'End'), text('Top.'));
      expect(anchor.changed).toBe(true);
      expect(anchor.from).toBeLessThanOrEqual(4);
      expect(anchor.to).toBeLessThanOrEqual(4);
    });
  });
});
