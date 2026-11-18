import { describe, expect, it } from 'vitest';

describe('the UTF-8 that QuickJS lacks', () => {
  it('encodes and decodes as the platform does, and refuses bad bytes when told to', async () => {
    const native = { enc: globalThis.TextEncoder, dec: globalThis.TextDecoder };
    // Remove the native ones so that the module installs its own.
    Reflect.deleteProperty(globalThis, 'TextEncoder');
    Reflect.deleteProperty(globalThis, 'TextDecoder');
    try {
      await import('./quickjs-text.ts');
      const mine = { enc: new globalThis.TextEncoder(), dec: globalThis.TextDecoder };
      expect(globalThis.TextEncoder).not.toBe(native.enc);
      for (const text of ['', 'abc', 'é€', 'a😀b', 'x\u0000y', '﻿bom']) {
        const bytes = mine.enc.encode(text);
        expect([...bytes]).toEqual([...new native.enc().encode(text)]);
        expect(new mine.dec('utf-8', { ignoreBOM: true }).decode(bytes)).toBe(text);
      }
      expect(mine.enc.encode('\ud800')).toEqual(new native.enc().encode('\ud800'));
      const bad = Uint8Array.from([0x61, 0xc3, 0x28, 0xff, 0xe2, 0x82]);
      expect(new mine.dec().decode(bad)).toBe(new native.dec().decode(bad));
      expect(() => new mine.dec('utf-8', { fatal: true }).decode(bad)).toThrow();
      expect(new mine.dec().decode(Uint8Array.from([0xef, 0xbb, 0xbf, 0x61]))).toBe('a');
      // The WHATWG cases: one U+FFFD for each maximal invalid prefix of a sequence.
      const cases: [number[], string][] = [
        [[0xe1, 0x80, 0x41], '\ufffdA'],
        [[0xf0, 0x80, 0x80, 0x41], '\ufffd\ufffd\ufffdA'],
        [[0xf0, 0x90, 0x80, 0x41], '\ufffdA'],
        [[0xed, 0xa0, 0x80], '\ufffd\ufffd\ufffd'],
        [[0xf4, 0x90, 0x80, 0x80], '\ufffd\ufffd\ufffd\ufffd'],
        [[0xe0, 0x80, 0x80], '\ufffd\ufffd\ufffd'],
        [[0xc0, 0xaf], '\ufffd\ufffd'],
        [[0xf8, 0x88, 0x80], '\ufffd\ufffd\ufffd'],
        [[0xe2, 0x82], '\ufffd'],
        [[0xf0, 0x9f, 0x98], '\ufffd'],
        [[0xf0, 0x9f, 0x98, 0x41], '\ufffdA'],
        [[0x80, 0xbf], '\ufffd\ufffd'],
        [[0xc3, 0xc3, 0xa9], '\ufffd\u00e9'],
      ];
      for (const [input, want] of cases) {
        const bytes = Uint8Array.from(input);
        expect(new mine.dec().decode(bytes)).toBe(want);
        expect(new mine.dec().decode(bytes)).toBe(new native.dec().decode(bytes));
      }
      // Every three-byte string over the interesting bytes agrees with the platform.
      const pool = [
        0x41, 0x80, 0x8f, 0x90, 0x9f, 0xa0, 0xbf, 0xc0, 0xc2, 0xe0, 0xed, 0xf0, 0xf4, 0xf5,
      ];
      for (const a of pool)
        for (const b of pool)
          for (const c of pool) {
            const bytes = Uint8Array.from([a, b, c]);
            expect(new mine.dec().decode(bytes)).toBe(new native.dec().decode(bytes));
          }
    } finally {
      Object.assign(globalThis, { TextEncoder: native.enc, TextDecoder: native.dec });
    }
  });
});
