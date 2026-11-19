// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';
import {
  createDevLog,
  documentHash,
  keyName,
  KEYS_KEPT,
  type DevLogKind,
  type DevLogLink,
} from './dev-log.ts';

function link(enabled: boolean) {
  const lines: [DevLogKind, string][] = [];
  const made: DevLogLink = {
    enabled: () => Promise.resolve(enabled),
    write: (kind, detail) => {
      lines.push([kind, detail]);
      return Promise.resolve();
    },
    reveal: vi.fn(() => Promise.resolve()),
  };
  return { made, lines };
}

const STATE = {
  text: 'Secret words',
  selection: { from: 2, to: 5 },
  view: 'redlines',
  tracking: true,
};

describe('the dev log (#1205)', () => {
  it('does nothing in a release build, which the app says has no log, and in a tab with none', async () => {
    const { made, lines } = link(false);
    for (const log of [await createDevLog(made), await createDevLog(null)]) {
      expect(log.enabled).toBe(false);
      log.log('alert', 'anything');
      await log.writeNote('odd', STATE);
      log.watchKeys(document)();
    }
    expect(lines).toEqual([]);
  });

  it('keeps lines in a dev build', async () => {
    const { made, lines } = link(true);
    const log = await createDevLog(made);
    expect(log.enabled).toBe(true);
    log.log('refusal', 'Can’t track a change in code');
    expect(lines).toEqual([['refusal', 'Can’t track a change in code']]);
  });

  it('writes a note with a snapshot that holds a hash, the selection and the last keys, and no text', async () => {
    const { made, lines } = link(true);
    const log = await createDevLog(made);
    const stop = log.watchKeys(document);
    for (const key of ['s', 'e', 'Enter'])
      document.dispatchEvent(new KeyboardEvent('keydown', { key }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true }));
    await log.writeNote('the caret jumped', STATE);
    stop();
    expect(lines[0]).toEqual(['note', 'the caret jumped']);
    const [kind, snapshot] = lines[1]!;
    expect(kind).toBe('snapshot');
    expect(snapshot).toContain(`document ${await documentHash(STATE.text)}`);
    expect(snapshot).toContain('selection 2-5');
    expect(snapshot).toContain('last keys char char Return ⌘Z');
    expect(snapshot).not.toContain('Secret');
  });

  it('logs no letter of a word that is typed, by key or by code', async () => {
    const { made, lines } = link(true);
    const log = await createDevLog(made);
    const stop = log.watchKeys(document);
    for (const key of 'hunter2 ok!') {
      const code = /[a-z]/i.test(key)
        ? `Key${key.toUpperCase()}`
        : key === ' '
          ? 'Space'
          : 'Digit2';
      document.dispatchEvent(new KeyboardEvent('keydown', { key, code }));
    }
    await log.writeNote('typed', STATE);
    stop();
    const keys = /last keys (.*)$/.exec(lines[1]![1])![1]!;
    // 11 keys, and each is the word `char` and nothing else.
    expect(keys.split(' ')).toEqual(Array<string>(11).fill('char'));
  });

  it('names a key, never the character typed, and keeps the last dozen', () => {
    expect(keyName({ key: 'a' })).toBe('char');
    expect(keyName({ key: 'A', shiftKey: true })).toBe('char');
    expect(keyName({ key: 'Backspace' })).toBe('Backspace');
    expect(keyName({ key: 'k', ctrlKey: true, shiftKey: true })).toBe('⌃⇧K');
    expect(KEYS_KEPT).toBe(12);
  });
});
