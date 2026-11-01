import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';

describe('applyChanges', () => {
  it('applies sorted changes in offsets of the original', () => {
    expect(
      applyChanges('abcdef', [
        { from: 1, to: 3, insert: 'X' },
        { from: 3, to: 3, insert: 'Y' },
        { from: 5, to: 6, insert: '' },
      ]),
    ).toBe('aXYde');
  });

  it('returns the text when there are no changes', () => {
    expect(applyChanges('abc', [])).toBe('abc');
  });

  it('rejects changes that are out of order, overlap or lie outside the text', () => {
    expect(() =>
      applyChanges('abcdef', [
        { from: 3, to: 4, insert: '' },
        { from: 1, to: 2, insert: '' },
      ]),
    ).toThrow(RangeError);
    expect(() =>
      applyChanges('abcdef', [
        { from: 1, to: 4, insert: '' },
        { from: 3, to: 5, insert: '' },
      ]),
    ).toThrow(RangeError);
    expect(() => applyChanges('abc', [{ from: 2, to: 4, insert: '' }])).toThrow(RangeError);
    expect(() => applyChanges('abc', [{ from: 2, to: 1, insert: '' }])).toThrow(RangeError);
  });
});
