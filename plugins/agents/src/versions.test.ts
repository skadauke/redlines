import { describe, expect, it } from 'vitest';
import { isNewer } from './versions.ts';

describe('isNewer', () => {
  it('compares x.y.z by number, not by text', () => {
    expect(isNewer('2.1.401', '2.1.400')).toBe(true);
    expect(isNewer('2.10.0', '2.9.9')).toBe(true);
    expect(isNewer('3.0.0', '2.99.99')).toBe(true);
    expect(isNewer('2.1.400', '2.1.400')).toBe(false);
    expect(isNewer('2.1.399', '2.1.400')).toBe(false);
    expect(isNewer('0.9.0', '0.10.0')).toBe(false);
  });

  it('calls nothing newer that is not x.y.z', () => {
    expect(isNewer('3.0.0-beta.1', '2.0.0')).toBe(false);
    expect(isNewer('3.0', '2.0.0')).toBe(false);
    expect(isNewer('3.0.0', 'unknown')).toBe(false);
  });
});
