import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sha256 } from './sha256.ts';

describe('sha256', () => {
  it('matches the published vectors', () => {
    expect(sha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('matches node on text of every length around the block size, and on non-ASCII', () => {
    for (let n = 0; n < 200; n++) {
      const text = 'aé€𝄞x'.repeat(n).slice(0, n);
      expect(sha256(text)).toBe(createHash('sha256').update(text).digest('hex'));
    }
  });
});
