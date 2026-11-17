// @vitest-environment happy-dom
// The shortcuts book (the Shortcuts pane of Preferences) lists the commands of the menu bar. The
// toolbar's menus hold registry commands by id, so a toolbar item with a key that the menu bar
// doesn't carry would work from the keyboard and be missing from the book, where it can't be
// changed or checked for a clash.

import { createEditor, type Author, type Editor } from '@redlines/editor';
import { createFormatting } from '@redlines/formatting';
import { createReview } from '@redlines/review';
import { createTables } from '@redlines/tables';
import { MENUS } from '@redlines/toolbar';
import { afterEach, expect, it } from 'vitest';
import { appMenuModel, type MenuCommands } from './menu-model.ts';
import { activatePlugins, DESKTOP_PLUGINS } from './plugins.ts';
import { shortcutEntries } from './shortcut-book.ts';
import { commandEntryId } from './shortcuts.ts';

const author: Author = { handle: 'ada', name: 'Ada Lovelace' };
const stops: (() => void)[] = [];

afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  document.body.replaceChildren();
});

function mount(): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, { doc: 'Some text.\n', author, tracking: false });
  const removeFormatting = createFormatting(editor, { author, notice: () => {} });
  const removeTables = createTables(editor, {});
  const review = createReview(editor, { author });
  const removePlugins = activatePlugins(editor, {}, DESKTOP_PLUGINS, { author });
  stops.push(() => {
    removePlugins();
    review.destroy();
    removeTables();
    removeFormatting();
    editor.destroy();
  });
  return editor;
}

it('lists every toolbar command that has a key in the shortcuts book', () => {
  const editor = mount();
  const book = shortcutEntries(appMenuModel({} as MenuCommands, editor.commands));
  const registered = new Map(editor.commands.list().map((command) => [command.id, command]));
  const missing: string[] = [];
  let checked = 0;
  for (const menu of MENUS) {
    for (const item of menu.rows.flat()) {
      const command = registered.get(item.command);
      const key = command && (command.defaultShortcut ?? command.shortcut);
      if (!command || !key) continue;
      checked++;
      const entry = book.find((each) => each.id === commandEntryId(command.id));
      if (!entry || !entry.default) missing.push(`${menu.label}: ${item.command} (${key})`);
    }
  }
  // The toolbar's keys are the formatting commands' (Bold, Link…), the lists' and the review's.
  expect(checked).toBeGreaterThan(10);
  expect(missing).toEqual([]);
});
