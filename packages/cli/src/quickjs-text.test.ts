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
    } finally {
      Object.assign(globalThis, { TextEncoder: native.enc, TextDecoder: native.dec });
    }
  });
});
