import { describe, expect, it } from 'vitest';
import { emojiFor, emojiMatches } from './lookup.ts';

describe('the names of emoji (#312)', () => {
  it('knows gemoji’s names, with their digits, plus and minus signs, and every alias', () => {
    expect(emojiFor('tent')).toBe('⛺');
    expect(emojiFor('smile')).toBe('😄');
    expect(emojiFor('+1')).toBe('👍');
    expect(emojiFor('thumbsup')).toBe('👍');
    expect(emojiFor('-1')).toBe('👎');
    expect(emojiFor('100')).toBe('💯');
    expect(emojiFor('1234')).toBe('🔢');
    expect(emojiFor('8ball')).toBe('🎱');
    expect(emojiFor('t-rex')).toBe('🦖');
    expect(emojiFor('x')).toBe('❌');
    expect(emojiFor('laughing')).toBe(emojiFor('satisfied'));
  });

  it('knows no name it was not given, in any case', () => {
    expect(emojiFor('not_an_emoji')).toBeUndefined();
    expect(emojiFor('')).toBeUndefined();
    expect(emojiFor('Tent')).toBeUndefined();
    expect(emojiFor('constructor')).toBeUndefined();
    expect(emojiFor('__proto__')).toBeUndefined();
  });

  it('offers names that start with the query first, an exact name before them', () => {
    const rows = emojiMatches('smi').map((row) => row.name);
    // In gemoji's order, which puts the faces first.
    expect(rows.slice(0, 2)).toEqual(['smiley', 'smile']);
    expect(rows).toHaveLength(8);
    expect(rows.every((name) => name.startsWith('smi'))).toBe(true);
    expect(emojiMatches('tent')[0]).toEqual({ name: 'tent', char: '⛺' });
    expect(emojiMatches('heart').map((row) => row.name)[0]).toBe('heart');
  });

  it('then names that have the query as a word, one row for each emoji, and at most the limit', () => {
    const rows = emojiMatches('up', 40).map((row) => row.name);
    expect(rows).toContain('arrow_up');
    expect(rows.indexOf('up')).toBeLessThan(rows.indexOf('arrow_up'));
    expect(new Set(rows).size).toBe(rows.length);
    expect(emojiMatches('a', 3)).toHaveLength(3);
    const chars = emojiMatches('lau', 40).map((row) => row.char);
    expect(new Set(chars).size).toBe(chars.length);
  });

  it('offers nothing for an empty query or one that matches no name', () => {
    expect(emojiMatches('')).toEqual([]);
    expect(emojiMatches('zzzzqx')).toEqual([]);
  });

  it('matches in any case', () => {
    expect(emojiMatches('SMI')).toEqual(emojiMatches('smi'));
  });
});
