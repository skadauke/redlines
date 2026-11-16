import { describe, expect, it, vi } from 'vitest';
import type { ActionRow, MenuModel } from './menu-model.ts';
import { createShortcutBook, shortcutEntries } from './shortcut-book.ts';

const row = (id: string, accelerator?: string): ActionRow => ({
  id,
  text: id.split('/').pop() ?? id,
  action: () => {},
  ...(accelerator ? { accelerator } : {}),
});

const model: MenuModel = {
  menus: [
    {
      title: 'File',
      rows: [row('File/Save', 'CmdOrCtrl+S'), row('File/Rename')],
    },
    {
      title: 'Redlines',
      rows: [row('Redlines/Quit Redlines', 'CmdOrCtrl+Q'), row('command:italic', 'CmdOrCtrl+I')],
    },
  ],
};

function bookOf(initial = {}) {
  const save = vi.fn();
  const book = createShortcutBook(initial, save);
  book.setEntries(shortcutEntries(model));
  return { book, save };
}

describe('shortcutEntries', () => {
  it('lists every row of the menus, with its default key', () => {
    expect(shortcutEntries(model).map(({ id, default: key }) => [id, key])).toEqual([
      ['File/Save', 'Mod-s'],
      ['File/Rename', null],
      ['Redlines/Quit Redlines', 'Mod-q'],
      ['command:italic', 'Mod-i'],
    ]);
  });

  it('locks Quit', () => {
    expect(shortcutEntries(model).find(({ id }) => id.includes('Quit'))?.locked).toBe(true);
  });
});

describe('the shortcut book', () => {
  it('gives a menu row the person’s key over its own, and a cleared key none', () => {
    const { book, save } = bookOf();
    const save1 = model.menus[0]?.rows[0] as ActionRow;
    expect(book.acceleratorOf(save1)).toBe('CmdOrCtrl+S');
    book.assign('File/Save', 'Mod-Alt-s');
    expect(book.acceleratorOf(save1)).toBe('Alt+CmdOrCtrl+S');
    expect(save).toHaveBeenLastCalledWith({ 'File/Save': 'Alt-Mod-s' });
    book.assign('File/Save', null);
    expect(book.acceleratorOf(save1)).toBeUndefined();
  });

  it('gives a registered command the person’s key, and tells the registry', () => {
    const { book } = bookOf();
    const heard = vi.fn();
    book.commandKeys.subscribe(heard);
    expect(book.commandKeys.keyOf('italic', 'Mod-i')).toBe('Mod-i');
    book.assign('command:italic', 'Mod-Alt-j');
    expect(book.commandKeys.keyOf('italic', 'Mod-i')).toBe('Alt-Mod-j');
    expect(heard).toHaveBeenCalledOnce();
    book.assign('command:italic', null);
    expect(book.commandKeys.keyOf('italic', 'Mod-i')).toBeUndefined();
  });

  it('Replace takes a key from its owner, and Reset All gives every key back', () => {
    const { book } = bookOf();
    book.assign('File/Rename', 'Mod-s');
    expect(book.keyOf('File/Save')).toBeNull();
    expect(book.keyOf('File/Rename')).toBe('Mod-s');
    book.resetAll();
    expect(book.keyOf('File/Save')).toBe('Mod-s');
    expect(book.keyOf('File/Rename')).toBeNull();
  });

  it('keeps nothing for a refused key, and says nothing changed', () => {
    const { book, save } = bookOf();
    const heard = vi.fn();
    book.subscribe(heard);
    book.assign('File/Save', 'Mod-q');
    book.assign('Redlines/Quit Redlines', 'Mod-Alt-q');
    expect(save).not.toHaveBeenCalled();
    expect(heard).not.toHaveBeenCalled();
  });

  it('follows what another window kept, without keeping it again', () => {
    const { book, save } = bookOf();
    const heard = vi.fn();
    book.subscribe(heard);
    book.load({ 'File/Rename': 'Mod-Alt-r' });
    expect(book.keyOf('File/Rename')).toBe('Alt-Mod-r');
    expect(heard).toHaveBeenCalledOnce();
    expect(save).not.toHaveBeenCalled();
  });
});
