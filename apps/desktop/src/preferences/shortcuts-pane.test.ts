// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../settings.ts';
import type { ShortcutEntry } from '../shortcuts.ts';
import { forgetShortcutsFilter, renderShortcutsPane } from './shortcuts-pane.ts';

afterEach(() => {
  document.body.replaceChildren();
  forgetShortcutsFilter();
});

const ENTRIES: ShortcutEntry[] = [
  { id: 'Format/Bold', menu: 'Format', title: 'Bold', default: 'Mod-b' },
  { id: 'Format/Italic', menu: 'Format', title: 'Italic', default: 'Mod-i' },
  { id: 'Edit/Find', menu: 'Edit', title: 'Find', default: 'Mod-f' },
  { id: 'Edit/Highlight', menu: 'Edit', title: 'Highlight', default: null },
  {
    id: 'Redlines/Quit Redlines',
    menu: 'Redlines',
    title: 'Quit Redlines',
    default: 'Mod-q',
    locked: true,
  },
];

function draw(entries: ShortcutEntry[] = ENTRIES) {
  let settings: Settings = { ...DEFAULT_SETTINGS };
  const update = vi.fn((change: Partial<Settings>) => {
    settings = { ...settings, ...change };
  });
  const deps = { settings: () => settings, update, shortcutEntries: () => entries };
  const container = document.createElement('div');
  document.body.append(container);
  const tidy = renderShortcutsPane(container, deps);
  return { container, tidy, shortcuts: () => settings.shortcuts };
}

const row = (container: HTMLElement, title: string) =>
  container.querySelector<HTMLElement>(`[data-row="${title}"]`)!;
const keyOfRow = (container: HTMLElement, title: string) =>
  row(container, title).querySelector<HTMLElement>('.rl-pref-key')!;
const buttonNamed = (container: HTMLElement, name: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === name)!;

/** Presses a key in the window, as the browser does. */
function press(code: string, modifiers: Partial<KeyboardEventInit> = {}) {
  const event = new KeyboardEvent('keydown', {
    code,
    bubbles: true,
    cancelable: true,
    ...modifiers,
  });
  window.dispatchEvent(event);
  return event;
}

describe('the Shortcuts pane', () => {
  it('lists every command under its menu with its key, in the menus’ order', () => {
    const { container } = draw();
    const heads = [...container.querySelectorAll('h2')].map((h) => h.textContent);
    expect(heads).toEqual(['Format', 'Edit', 'Redlines']);
    expect(keyOfRow(container, 'Bold').textContent).toBe('⌘B');
    expect(keyOfRow(container, 'Highlight').textContent).toBe('Add key');
  });

  it('says there is nothing to list before a document window has published its commands', () => {
    const { container } = draw([]);
    expect(container.textContent).toContain('Open a document first');
  });

  it('records a key: a click, then the keys, and the command has it', () => {
    const { container, shortcuts } = draw();
    keyOfRow(container, 'Highlight').click();
    expect(container.querySelector('.rl-pref-krec')?.textContent).toContain(
      'Type the new shortcut',
    );
    press('KeyH', { metaKey: true, shiftKey: true });
    expect(shortcuts()).toEqual({ 'Edit/Highlight': 'Shift-Mod-h' });
    expect(keyOfRow(container, 'Highlight').textContent).toBe('⇧⌘H');
    expect(container.querySelector('.rl-pref-krec')).toBeNull();
  });

  it('refuses a key without ⌘, ⌃ or ⌥ and a key macOS keeps, in the row, and goes on listening', () => {
    const { container, shortcuts } = draw();
    keyOfRow(container, 'Highlight').click();
    press('KeyH');
    expect(container.querySelector('.rl-pref-krec')?.textContent).toContain('needs ⌘, ⌃ or ⌥');
    press('KeyQ', { metaKey: true });
    expect(container.querySelector('.rl-pref-krec')?.textContent).toContain('kept by macOS');
    expect(shortcuts()).toEqual({});
    press('KeyJ', { metaKey: true, altKey: true });
    expect(shortcuts()).toEqual({ 'Edit/Highlight': 'Alt-Mod-j' });
  });

  it('asks before taking a key from another command, and Replace leaves that one with none', () => {
    const { container, shortcuts } = draw();
    keyOfRow(container, 'Bold').click();
    press('KeyI', { metaKey: true });
    expect(container.querySelector('.rl-pref-krec')?.textContent).toContain('⌘I is Italic’s.');
    expect(shortcuts()).toEqual({});
    buttonNamed(container, 'Replace').click();
    expect(shortcuts()).toEqual({ 'Format/Bold': 'Mod-i', 'Format/Italic': '' });
    expect(keyOfRow(container, 'Italic').textContent).toBe('Add key');
  });

  it('Cancel and Esc leave everything as it was', () => {
    const { container, shortcuts } = draw();
    keyOfRow(container, 'Bold').click();
    press('KeyI', { metaKey: true });
    buttonNamed(container, 'Cancel').click();
    expect(shortcuts()).toEqual({});
    keyOfRow(container, 'Bold').click();
    press('Escape');
    expect(container.querySelector('.rl-pref-krec')).toBeNull();
    expect(shortcuts()).toEqual({});
  });

  it('clears a key with Backspace', () => {
    const { container, shortcuts } = draw();
    keyOfRow(container, 'Find').click();
    press('Backspace');
    expect(shortcuts()).toEqual({ 'Edit/Find': '' });
    expect(keyOfRow(container, 'Find').textContent).toBe('Add key');
  });

  it('keeps the app’s Quit as it is', () => {
    const { container } = draw();
    const quit = keyOfRow(container, 'Quit Redlines');
    expect(quit.tagName).toBe('SPAN');
    expect(quit.title).toContain('can’t be changed');
  });

  it('filters by name, menu and key, and says when nothing matches', () => {
    const { container } = draw();
    const field = container.querySelector<HTMLInputElement>('.rl-pref-kfilter')!;
    const rows = () =>
      [...container.querySelectorAll('[data-row]')].map((r) => r.getAttribute('data-row'));
    const type = (text: string) => {
      field.value = text;
      field.dispatchEvent(new Event('input'));
    };
    type('ital');
    expect(rows()).toEqual(['Italic']);
    type('edit');
    expect(rows()).toEqual(['Find', 'Highlight']);
    type('⌘b');
    expect(rows()).toEqual(['Bold']);
    type('zzz');
    expect(container.textContent).toContain('Nothing matches.');
  });

  it('Reset All gives every command its own key again, and is off when there is nothing to reset', () => {
    const { container, shortcuts } = draw();
    expect(buttonNamed(container, 'Reset All').disabled).toBe(true);
    keyOfRow(container, 'Find').click();
    press('Backspace');
    expect(buttonNamed(container, 'Reset All').disabled).toBe(false);
    buttonNamed(container, 'Reset All').click();
    expect(shortcuts()).toEqual({});
    expect(keyOfRow(container, 'Find').textContent).toBe('⌘F');
  });

  it('stops listening for keys when it is tidied up', () => {
    const { container, tidy } = draw();
    keyOfRow(container, 'Highlight').click();
    tidy();
    expect(press('KeyH', { metaKey: true }).defaultPrevented).toBe(false);
  });
});
