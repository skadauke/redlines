import { describe, expect, it } from 'vitest';
import {
  assess,
  assign,
  displayKey,
  explain,
  keyOf,
  menuKey,
  ariaKey,
  normalizeKey,
  recordKey,
  type ShortcutEntry,
} from './shortcuts.ts';

const entry = (id: string, key: string | null, extra: Partial<ShortcutEntry> = {}) => ({
  id,
  menu: 'Format',
  title: id,
  default: key === null ? null : normalizeKey(key),
  ...extra,
});

const entries = [
  entry('Italic', 'Mod-i'),
  entry('Bold', 'Mod-b'),
  entry('Palette', 'Mod-Shift-p'),
  entry('Accept', null),
  entry('Quit', 'Mod-q', { locked: true }),
];

describe('normalizeKey', () => {
  it('writes ⌘⇧P and ⇧⌘P as one key, in either notation', () => {
    expect(normalizeKey('Mod-Shift-P')).toBe('Shift-Mod-p');
    expect(normalizeKey('Shift-Mod-p')).toBe('Shift-Mod-p');
    expect(normalizeKey('Shift+CmdOrCtrl+P')).toBe('Shift-Mod-p');
    expect(normalizeKey('CmdOrCtrl+Shift+P')).toBe('Shift-Mod-p');
  });

  it('keeps a minus, a plus and named keys', () => {
    expect(normalizeKey('Mod--')).toBe('Mod--');
    expect(normalizeKey('CmdOrCtrl+-')).toBe('Mod--');
    expect(normalizeKey('Ctrl+Cmd+=')).toBe('Ctrl-Mod-=');
    expect(normalizeKey('Alt-Return')).toBe('Alt-Enter');
  });

  it('writes the menu bar’s notation and the Mac’s glyphs', () => {
    expect(menuKey('Shift-Mod-p')).toBe('Shift+CmdOrCtrl+P');
    expect(menuKey('Ctrl-ArrowUp')).toBe('Ctrl+ArrowUp');
    expect(ariaKey('Mod-Alt-1')).toBe('Alt+Meta+1');
    expect(ariaKey('Shift-Mod-e')).toBe('Shift+Meta+E');
    expect(displayKey('Mod-Shift-p')).toBe('⇧⌘P');
    expect(displayKey('Alt-Enter')).toBe('⌥↩');
  });
});

describe('assess', () => {
  it('says a free key is free, and a command’s own key is its own', () => {
    expect(assess(entries, {}, 'Bold', 'Mod-Alt-j').kind).toBe('free');
    expect(assess(entries, {}, 'Bold', 'Mod-b').kind).toBe('same');
  });

  it('asks about a key in use, in whatever order its modifiers are written', () => {
    const result = assess(entries, {}, 'Bold', 'Mod-i');
    expect(result).toMatchObject({ kind: 'conflict', with: { id: 'Italic' } });
    expect(explain(result, 'Mod-i')).toBe('⌘I is Italic’s.');
    expect(assess(entries, {}, 'Bold', 'Mod-P').kind).toBe('free');
    expect(assess(entries, {}, 'Bold', 'Shift-Mod-p').kind).toBe('conflict');
    expect(assess(entries, {}, 'Bold', 'Mod-Shift-p').kind).toBe('conflict');
  });

  it('refuses the keys macOS keeps, and the system’s Cut, Copy and Paste', () => {
    for (const key of ['Mod-q', 'Mod-h', 'Mod-m', 'Mod-Space', 'Ctrl-ArrowUp', 'Ctrl-ArrowDown']) {
      expect(assess(entries, {}, 'Bold', key).kind).toBe('reserved');
    }
    expect(assess(entries, {}, 'Bold', 'Mod-c').kind).toBe('reserved');
    expect(explain(assess(entries, {}, 'Bold', 'Mod-h'), 'Mod-h')).toBe(
      '⌘H is kept by macOS for Hide.',
    );
  });

  it('needs ⌘, ⌃ or ⌥', () => {
    expect(assess(entries, {}, 'Bold', 'k').kind).toBe('needs-modifier');
    expect(assess(entries, {}, 'Bold', 'Shift-k').kind).toBe('needs-modifier');
    expect(assess(entries, {}, 'Bold', 'Alt-Shift-k').kind).toBe('free');
  });

  it('sees a key that was changed, not the default it left', () => {
    const overrides = { Italic: 'Mod-Alt-i' };
    expect(assess(entries, overrides, 'Bold', 'Mod-i').kind).toBe('free');
    expect(assess(entries, overrides, 'Bold', 'Mod-Alt-i').kind).toBe('conflict');
  });
});

describe('assign', () => {
  it('Replace leaves the other command with no key', () => {
    const next = assign(entries, {}, 'Bold', 'Mod-i');
    expect(next).toEqual({ Bold: 'Mod-i', Italic: '' });
    expect(keyOf(entries, next, 'Italic')).toBeNull();
    expect(keyOf(entries, next, 'Bold')).toBe('Mod-i');
  });

  it('a command given its own key back has no override', () => {
    const changed = assign(entries, {}, 'Bold', 'Mod-Alt-j');
    expect(assign(entries, changed, 'Bold', 'Mod-b')).toEqual({});
  });

  it('clears a key with "" and gives a keyless command one', () => {
    expect(assign(entries, {}, 'Bold', null)).toEqual({ Bold: '' });
    expect(assign(entries, {}, 'Accept', 'Mod-Alt-a')).toEqual({ Accept: 'Alt-Mod-a' });
    expect(assign(entries, { Accept: 'Mod-Alt-a' }, 'Accept', null)).toEqual({});
  });

  it('refuses reserved keys and locked commands, and changes nothing', () => {
    const none = {};
    expect(assign(entries, none, 'Bold', 'Mod-q')).toBe(none);
    expect(assign(entries, none, 'Quit', 'Mod-Alt-q')).toBe(none);
    expect(assign(entries, none, 'Bold', 'Mod-q')).toBe(none);
  });
});

describe('recordKey', () => {
  const press = (code: string, mods: Partial<Record<string, boolean>> = {}) =>
    recordKey({
      code,
      metaKey: !!mods['meta'],
      ctrlKey: !!mods['ctrl'],
      altKey: !!mods['alt'],
      shiftKey: !!mods['shift'],
    });

  it('reads a key by its position, whatever Option typed', () => {
    expect(press('KeyP', { meta: true, shift: true })).toEqual({ kind: 'key', key: 'Shift-Mod-p' });
    expect(press('Digit4', { meta: true, alt: true })).toEqual({ kind: 'key', key: 'Alt-Mod-4' });
    expect(press('Enter', { alt: true })).toEqual({ kind: 'key', key: 'Alt-Enter' });
    expect(press('BracketRight', { meta: true, alt: true })).toEqual({
      kind: 'key',
      key: 'Alt-Mod-]',
    });
  });

  it('Esc cancels, ⌫ clears, and a modifier alone waits', () => {
    expect(press('Escape')).toEqual({ kind: 'cancel' });
    expect(press('Backspace')).toEqual({ kind: 'clear' });
    expect(press('MetaLeft', { meta: true })).toEqual({ kind: 'wait' });
  });
});
