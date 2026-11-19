import { describe, expect, it } from 'vitest';
import { readingMs, WORD_MS, wordsIn } from './reading.ts';

describe('the reading time', () => {
  it('is a base and the words at 200 a minute, which every caller shares', () => {
    expect(WORD_MS * 200).toBe(60_000);
    expect(wordsIn('one two  three\nfour')).toBe(4);
    expect(wordsIn('')).toBe(0);
    expect(readingMs('', 2000)).toBe(2000);
    expect(readingMs('one two three four', 4000)).toBe(4000 + 4 * WORD_MS);
  });
});
