import { describe, expect, it } from 'vitest';
import { ariaShortcut, formatShortcut } from './shortcuts.ts';

describe('formatShortcut', () => {
  it('writes a shortcut as the Mac does: ⌃⌥⇧⌘, then the key', () => {
    expect(formatShortcut('Mod-b')).toBe('⌘B');
    expect(formatShortcut('Mod-Alt-t')).toBe('⌥⌘T');
    expect(formatShortcut('Mod-Shift-u')).toBe('⇧⌘U');
    expect(formatShortcut('Ctrl-Shift-`')).toBe('⌃⇧`');
    expect(formatShortcut('Ctrl-Alt-Shift-Mod-x')).toBe('⌃⌥⇧⌘X');
  });

  it('reads the modifiers CodeMirror reads, in any case and order', () => {
    expect(formatShortcut('alt-mod-m')).toBe('⌥⌘M');
    expect(formatShortcut('Cmd-k')).toBe('⌘K');
    expect(formatShortcut('Meta-k')).toBe('⌘K');
    expect(formatShortcut('Control-`')).toBe('⌃`');
    expect(formatShortcut('Shift-Mod-g')).toBe('⇧⌘G');
  });

  it('keeps keys that are signs, and the key after a trailing dash', () => {
    expect(formatShortcut('Mod-\\')).toBe('⌘\\');
    expect(formatShortcut('Mod-]')).toBe('⌘]');
    expect(formatShortcut('Mod-[')).toBe('⌘[');
    expect(formatShortcut('Mod--')).toBe('⌘-');
    expect(formatShortcut('Mod-1')).toBe('⌘1');
  });

  it('names the keys the Mac draws as symbols', () => {
    expect(formatShortcut('Mod-Enter')).toBe('⌘↩');
    expect(formatShortcut('Mod-Alt-Backspace')).toBe('⌥⌘⌫');
    expect(formatShortcut('Mod-Alt-ArrowUp')).toBe('⌥⌘↑');
    expect(formatShortcut('Alt-ArrowDown')).toBe('⌥↓');
    expect(formatShortcut('Escape')).toBe('⎋');
    expect(formatShortcut('Tab')).toBe('⇥');
  });
});

describe('ariaShortcut', () => {
  it('writes the shortcut as aria-keyshortcuts does', () => {
    expect(ariaShortcut('Mod-b')).toBe('Meta+B');
    expect(ariaShortcut('Mod-Alt-t')).toBe('Alt+Meta+T');
    expect(ariaShortcut('Ctrl-Shift-`')).toBe('Control+Shift+`');
    expect(ariaShortcut('Mod-Enter')).toBe('Meta+Enter');
  });
});
