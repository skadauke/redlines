// The release workflow's update manifest (scripts/update-manifest.ts): it checks the update's
// signature as the app's updater will, and writes latest.json. The signatures here are minisign's
// own test vectors, made with the example key from its documentation, over the bytes "test".

import { describe, expect, it } from 'vitest';
import { signedVersion, updateManifest, verifySignature } from '../scripts/update-manifest.ts';

/** A file as Tauri writes a key or a signature: the whole minisign file, in base64. */
const wrap = (file: string) => Buffer.from(file).toString('base64');

const PUBLIC_KEY = wrap(
  'untrusted comment: minisign public key E7620F1842B4E81F\n' +
    'RWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3\n',
);

const PREHASHED = wrap(
  'untrusted comment: signature from minisign secret key\n' +
    'RUQf6LRCGA9i559r3g7V1qNyJDApGip8MfqcadIgT9CuhV3EMhHoN1mGTkUidF/z7SrlQgXdy8ofjb7bNJJylDOocrCo8KLzZwo=\n' +
    'trusted comment: timestamp:1556193335\tfile:test\n' +
    'y/rUw2y8/hOUYjZU71eHp/Wo1KZ40fGy2VJEDl34XMJM+TX48Ss/17u3IvIfbVR1FkZZSNCisQbuQY+bHwhEBg==\n',
);

const LEGACY = wrap(
  'untrusted comment: signature from minisign secret key\n' +
    'RWQf6LRCGA9i59SLOFxz6NxvASXDJeRtuZykwQepbDEGt87ig1BNpWaVWuNrm73YiIiJbq71Wi+dP9eKL8OC351vwIasSSbXxwA=\n' +
    'trusted comment: timestamp:1555779966\tfile:test\n' +
    'QtKMXWyYcwdpZAlPF7tE2ENJkRd1ujvKjlj1m9RtHTBnZPa5WKU5uWRs5GoP5M/VqE81QFuMKI5k/SfNQUaOAA==\n',
);

const data = new TextEncoder().encode('test');

describe('the update manifest', () => {
  it('accepts a signature made with the key, and reads its trusted comment', () => {
    expect(verifySignature(data, PREHASHED, PUBLIC_KEY)).toBe('timestamp:1556193335\tfile:test');
    expect(verifySignature(data, LEGACY, PUBLIC_KEY)).toBe('timestamp:1555779966\tfile:test');
  });

  it('refuses other bytes, another key and a changed trusted comment', () => {
    expect(() => verifySignature(new TextEncoder().encode('Test'), PREHASHED, PUBLIC_KEY)).toThrow(
      /signature/,
    );
    const otherKey = wrap(
      'untrusted comment: minisign public key 14675B478C16ED38\n' +
        'RWQ47RaMR1tnFITGDZj6Wz9neFSluI6NWMifPoYoixKKJuIRxi0Pyqfe\n',
    );
    expect(() => verifySignature(data, PREHASHED, otherKey)).toThrow(/key/);
    const changed = wrap(
      Buffer.from(PREHASHED, 'base64')
        .toString('utf8')
        .replace('file:test', 'file:test\tversion:9.9.9'),
    );
    expect(() => verifySignature(data, changed, PUBLIC_KEY)).toThrow(/trusted comment/);
    expect(() => verifySignature(data, 'not a signature', PUBLIC_KEY)).toThrow();
  });

  it('reads the version a signature was made for', () => {
    expect(signedVersion('timestamp:1700000000\tfile:Redlines.app.tar.gz\tversion:0.1.0')).toBe(
      '0.1.0',
    );
    expect(signedVersion('timestamp:1556193335\tfile:test')).toBeNull();
  });

  it('offers the universal app to Apple silicon and Intel', () => {
    const manifest = updateManifest({
      version: '0.1.0',
      notes: 'https://github.com/skadauke/redlines/releases/tag/v0.1.0',
      pubDate: '2026-11-01T14:30:00Z',
      url: 'https://github.com/skadauke/redlines/releases/download/v0.1.0/Redlines-macOS.app.tar.gz',
      signature: PREHASHED,
    });
    const platform = {
      signature: PREHASHED,
      url: 'https://github.com/skadauke/redlines/releases/download/v0.1.0/Redlines-macOS.app.tar.gz',
    };
    expect(manifest).toEqual({
      version: '0.1.0',
      notes: 'https://github.com/skadauke/redlines/releases/tag/v0.1.0',
      pub_date: '2026-11-01T14:30:00Z',
      platforms: { 'darwin-aarch64': platform, 'darwin-x86_64': platform },
    });
  });
});
