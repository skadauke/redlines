import { describe, expect, it } from 'vitest';
import { isId, newId } from './ids.ts';

const FIRST = 'bcdfghjkmnpqrstvwxz';
const REST = 'bcdfghjkmnpqrstvwxz23456789';

/** Stands in for `crypto.getRandomValues`, handing out the given bytes in order. */
function bytes(...values: number[]): (n: number) => Uint8Array {
  return (n) => {
    if (values.length < n) throw new Error('Out of bytes');
    return Uint8Array.from(values.splice(0, n));
  };
}

function* everyId(): Generator<string> {
  for (const a of FIRST) {
    for (const b of REST) {
      for (const c of REST) {
        for (const d of REST) yield a + b + c + d;
      }
    }
  }
}

describe('newId', () => {
  it('draws a consonant, then three consonants or digits', () => {
    for (let i = 0; i < 1000; i++) {
      expect(newId(new Set())).toMatch(/^[bcdfghjkmnpqrstvwxz][bcdfghjkmnpqrstvwxz2-9]{3}$/);
    }
  });

  it('draws every character about equally often', () => {
    const draws = 40_000;
    const positions = [FIRST, REST, REST, REST].map((alphabet) => ({
      alphabet,
      seen: new Map<string, number>(),
    }));
    for (let i = 0; i < draws; i++) {
      const id = newId(new Set());
      positions.forEach(({ seen }, p) => {
        const c = id.charAt(p);
        seen.set(c, (seen.get(c) ?? 0) + 1);
      });
    }
    for (const { alphabet, seen } of positions) {
      expect([...seen.keys()].sort()).toEqual([...alphabet].sort());
      // Within 20% of the expected count: more than 7 standard deviations either way.
      const expected = draws / alphabet.length;
      for (const count of seen.values()) {
        expect(count).toBeGreaterThan(expected * 0.8);
        expect(count).toBeLessThan(expected * 1.2);
      }
    }
  });

  it('maps every accepted byte to a character and redraws the rest', () => {
    // 247 = 13 × 19 and 243 = 9 × 27: the first bytes that would favor some characters.
    expect(newId(new Set(), bytes(0, 0, 0, 0))).toBe('bbbb');
    expect(newId(new Set(), bytes(246, 242, 242, 242))).toBe('z999');
    expect(newId(new Set(), bytes(247, 0, 243, 1, 255, 2, 3))).toBe('bcdf');
    // 245 is accepted for the first character only.
    expect(newId(new Set(), bytes(245, 245, 4, 5, 6))).toBe('xghj');
  });

  it('draws again while the id is taken', () => {
    const random = bytes(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1);
    expect(newId(new Set(['bbbb']), random)).toBe('bbbc');
  });

  it('throws instead of looping forever when every id is taken', () => {
    const all = new Set(everyId());
    expect(all.size).toBe(373_977);
    expect(() => newId(all)).toThrow('taken');
  });
});

describe('isId', () => {
  it.each(['k3x9', 'p7qd', 'bbbb', 'z999'])('accepts %j', (s) => {
    expect(isId(s)).toBe(true);
  });

  // Wrong length or case, a vowel, a digit first, 0, 1, l and o, and punctuation.
  it.each(['', 'k3x', 'k3x99', 'K3X9', 'p7qa', '3kx9', 'k0x9', 'k1x9', 'klx9', 'kox9', 'k-x9'])(
    'rejects %j',
    (s) => {
      expect(isId(s)).toBe(false);
    },
  );
});
