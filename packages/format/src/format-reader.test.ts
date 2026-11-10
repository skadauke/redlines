import { micromark } from 'micromark';
import { gfmStrikethrough, gfmStrikethroughHtml } from 'micromark-extension-gfm-strikethrough';
import { describe, expect, it } from 'vitest';
import { isOlderPunctuation, isPunctuation, plainBody } from './format-reader.ts';
import { fuzzCount, seeded } from './random-docs.ts';

/** The text of a paragraph as micromark reads it: its tags taken out, its white space squashed. */
const micromarkText = (text: string) =>
  micromark(text, { extensions: [gfmStrikethrough()], htmlExtensions: [gfmStrikethroughHtml()] })
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** The text of a paragraph as the editor reads it, on both readings of punctuation. */
const editorText = (text: string) => [
  plainBody(text, isPunctuation),
  plainBody(text, isOlderPunctuation),
];

describe('the emphasis reading (format §2.6)', () => {
  it('checks the rule of three against what is left of each run, as micromark does (#140)', () => {
    // `**` after `word` takes two of the three `*` before it. One is left, and `x**y` can open and
    // close: 1 + 2 is a multiple of three, so micromark leaves `**` as text.
    for (const text of [
      '- six ***word** hereone x**y z',
      'six ***word** hereone x**y z',
      'a ***b** c**d e',
      'a ****b** c*d e',
      'a ___b__ c__d e',
    ]) {
      const expected = micromarkText(text);
      expect(editorText(text), text).toEqual([expected, expected]);
    }
  });

  it('reads runs of stars and underscores between words as micromark does', () => {
    // Words, spaces, a full stop and runs of `*` or `_`, in random order: the editor's reading of emphasis is
    // micromark's, character for character.
    const pieces = ['a', 'bc', ' ', ' ', '.', '*', '**', '***', '_', '__', '___', '****'];
    for (let seed = 1; seed <= fuzzCount(3000); seed++) {
      const random = seeded(seed);
      const length = 3 + Math.floor(random() * 12);
      let text = 'w';
      for (let i = 0; i < length; i++) text += pieces[Math.floor(random() * pieces.length)] ?? '';
      text += 'z';
      const expected = micromarkText(text);
      expect(editorText(text), `seed ${seed}: ${text}`).toEqual([expected, expected]);
    }
  });

  it('reads tildes mixed with stars and underscores as micromark with GFM does (#238)', () => {
    const known = 'w! ~**_***)****~~*****~~ z';
    const pieces = [
      'a',
      'bc',
      ' ',
      '.',
      '!',
      ')',
      '*',
      '**',
      '***',
      '_',
      '__',
      '~',
      '~~',
      '~~~',
      '****',
    ];
    const texts = [known];
    for (let seed = 1; seed <= fuzzCount(3000); seed++) {
      const random = seeded(seed);
      const length = 3 + Math.floor(random() * 12);
      let text = 'w';
      for (let i = 0; i < length; i++) text += pieces[Math.floor(random() * pieces.length)] ?? '';
      texts.push(text + 'z');
    }
    const bad: string[] = [];
    for (const text of texts) {
      const expected = micromarkText(text);
      const got = editorText(text);
      if (got[0] !== expected || got[1] !== expected) bad.push(text);
    }
    expect(bad.slice(0, 8), `${bad.length} of ${texts.length} differ`).toEqual([]);
  });
});
