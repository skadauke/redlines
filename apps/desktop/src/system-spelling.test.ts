// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

import { checkSpellingAgain, systemSpelling } from './system-spelling.ts';

afterEach(() => invoke.mockReset());

describe('systemSpelling', () => {
  const make = (enabled = true) => {
    const learned = vi.fn();
    return { learned, spelling: systemSpelling({ enabled: () => enabled, learned }) };
  };

  it('asks the app for a word’s suggestions, with the text before it, and gives its answer', async () => {
    invoke.mockResolvedValue(['world', 'word']);
    const { spelling } = make();
    expect(await spelling.suggest('wrold', 'Hello ')).toEqual(['world', 'word']);
    expect(invoke).toHaveBeenCalledWith('spelling_suggestions', {
      word: 'wrold',
      before: 'Hello ',
    });
  });

  it('gives nothing for a word that is spelled right, or when the app cannot be asked', async () => {
    const { spelling } = make();
    invoke.mockResolvedValueOnce(null);
    expect(await spelling.suggest('world', '')).toBeNull();
    invoke.mockRejectedValueOnce(new Error('no checker'));
    expect(await spelling.suggest('wrold', '')).toBeNull();
  });

  it('follows Preferences’ spell check', () => {
    expect(make(true).spelling.enabled()).toBe(true);
    expect(make(false).spelling.enabled()).toBe(false);
  });

  it('adds a word to the dictionary, and tells the page once it has', async () => {
    invoke.mockResolvedValue(undefined);
    const { spelling, learned } = make();
    await spelling.learn?.('wrold');
    expect(invoke).toHaveBeenCalledWith('spelling_learn', { word: 'wrold' });
    expect(learned).toHaveBeenCalledTimes(1);
  });

  it('does not say it learned a word the app could not', async () => {
    invoke.mockRejectedValue(new Error('no'));
    const { spelling, learned } = make();
    await expect(spelling.learn?.('wrold')).rejects.toThrow('no');
    expect(learned).not.toHaveBeenCalled();
  });
});

describe('checkSpellingAgain', () => {
  it.each([true, false])(
    'sets spellcheck the other way and back from %s, which makes WebKit look again',
    (was) => {
      const content = document.createElement('div');
      const writes: boolean[] = [];
      let value = was;
      Object.defineProperty(content, 'spellcheck', {
        configurable: true,
        get: () => value,
        set: (next: boolean) => {
          writes.push(next);
          value = next;
        },
      });
      checkSpellingAgain(content);
      expect(writes).toEqual([!was, was]);
      // The attribute ends as it was.
      expect(value).toBe(was);
    },
  );
});
