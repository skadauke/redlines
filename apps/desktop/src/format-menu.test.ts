// @vitest-environment happy-dom
// The Format and Paragraph menus, as the app builds them (main.ts): the formatting commands, then
// the review interface and the other plugins. Every row has its command, its key and its state,
// and no key is bound twice across the whole menu bar and the registry.

import { createEditor, type Author, type Editor } from '@redlines/editor';
import { createFormatting } from '@redlines/formatting';
import { createReview } from '@redlines/review';
import { afterEach, expect, it } from 'vitest';
import {
  acceleratorFor,
  appMenuModel,
  type ActionRow,
  type MenuCommands,
  type MenuModel,
  type MenuRow,
  type MenuState,
} from './menu-model.ts';
import { activatePlugins, DESKTOP_PLUGINS } from './plugins.ts';

const author: Author = { handle: 'ada', name: 'Ada Lovelace' };
const mac = /Mac/.test(navigator.platform);

interface App {
  editor: Editor;
  model: MenuModel;
  stop: () => void;
}

const apps: App[] = [];

/** Builds the editor with the plugins in main.ts's order. */
function mount(doc: string): App {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, { doc, author, tracking: false });
  const removeFormatting = createFormatting(editor, { author, notice: () => {} });
  const review = createReview(editor, { author });
  const removePlugins = activatePlugins(editor, {}, DESKTOP_PLUGINS, { author });
  const app = {
    editor,
    model: appMenuModel({} as MenuCommands, editor.commands),
    stop: () => {
      removePlugins();
      review.destroy();
      removeFormatting();
      editor.destroy();
    },
  };
  apps.push(app);
  return app;
}

afterEach(() => {
  for (const app of apps.splice(0)) app.stop();
  document.body.replaceChildren();
});

const isAction = (row: MenuRow): row is ActionRow => 'action' in row;
const label = (row: MenuRow) => ('text' in row ? row.text : 'item' in row ? row.item : '');
const rowsOf = (model: MenuModel, title: string) =>
  model.menus.find((menu) => menu.title === title)?.rows ?? [];

/** A shortcut or accelerator in one spelling: sorted modifiers, upper-case key. */
function normalized(accelerator: string): string {
  const parts = accelerator.split(/\+(?!$)/);
  const key = parts.pop() ?? '';
  return [...parts.map((part) => part.toLowerCase()).sort(), key.toUpperCase()].join('+');
}

const STATE = {
  sidebarOpen: false,
  hasFile: false,
  recent: [],
  view: 'redlines',
  tracking: false,
  hasRedlines: false,
  viewing: false,
};

it('puts Format and Paragraph between Edit and View', () => {
  const { model } = mount('Some text.\n');
  const titles = model.menus.map((menu) => menu.title);
  expect(titles.slice(titles.indexOf('Edit'), titles.indexOf('View') + 1)).toEqual([
    'Edit',
    'Format',
    'Paragraph',
    'View',
  ]);
});

it('lists the Format rows with their keys, set apart by group, Add Comment last', () => {
  const { model } = mount('Some text.\n');
  const rows = rowsOf(model, 'Format');
  expect(rows.map((row) => (isAction(row) ? [row.text, row.accelerator] : label(row)))).toEqual([
    ['Bold', 'CmdOrCtrl+B'],
    ['Italic', 'CmdOrCtrl+I'],
    ['Code', 'Ctrl+`'],
    ['Strikethrough', 'Ctrl+Shift+`'],
    'Separator',
    ['Link…', 'CmdOrCtrl+K'],
    'Separator',
    ['Clear Formatting', 'CmdOrCtrl+\\'],
    'Separator',
    ['Add Comment', 'CmdOrCtrl+Alt+M'],
  ]);
});

it('lists the Paragraph rows with their keys, set apart by group', () => {
  const { model } = mount('Some text.\n');
  const rows = rowsOf(model, 'Paragraph');
  expect(rows.map((row) => (isAction(row) ? [row.text, row.accelerator] : label(row)))).toEqual([
    ['Body', 'CmdOrCtrl+0'],
    ['Heading 1', 'CmdOrCtrl+1'],
    ['Heading 2', 'CmdOrCtrl+2'],
    ['Heading 3', 'CmdOrCtrl+3'],
    ['Heading 4', 'CmdOrCtrl+4'],
    ['Heading 5', 'CmdOrCtrl+5'],
    ['Heading 6', 'CmdOrCtrl+6'],
    'Separator',
    ['Quote', 'CmdOrCtrl+Alt+Q'],
    ['Bulleted List', 'CmdOrCtrl+Alt+U'],
    ['Numbered List', 'CmdOrCtrl+Alt+O'],
    ['Task List', 'CmdOrCtrl+Alt+X'],
    'Separator',
    ['Code Block', 'CmdOrCtrl+Alt+C'],
    ['Table', 'CmdOrCtrl+Alt+T'],
    ['Horizontal Rule', undefined],
    'Separator',
    ['Indent', 'CmdOrCtrl+]'],
    ['Outdent', 'CmdOrCtrl+['],
  ]);
});

it('gives every row its command, key and state, and runs the command from the row', () => {
  const { editor, model } = mount('Some text.\n');
  const commands = editor.commands.list();
  const ui = editor.getUiState();
  const state = { ...STATE, ...ui } satisfies MenuState;
  for (const title of ['Format', 'Paragraph']) {
    for (const row of rowsOf(model, title).filter(isAction)) {
      const command = commands.find((candidate) => candidate.title === row.text);
      expect(command, `${title}: ${row.text} has a command`).toBeDefined();
      expect(command?.menu).toBe(title.toLowerCase());
      expect(row.accelerator).toBe(
        command?.shortcut ? acceleratorFor(command.shortcut) : undefined,
      );
      // The key is the editor's: the menu bar's item must not also handle it.
      expect(row.keyInMenuOnly).toBe(true);
      // Chosen from the menu, the command runs through the registry.
      expect(row.enabled ? row.enabled(state) : true, `${row.text} is enabled`).toBe(true);
      if (command?.isActive) expect(row.checked).toBeDefined();
    }
  }
});

it('checks the rows that hold at the caret', () => {
  const { editor, model } = mount('# Title\n\nSome **bold** text.\n');
  const checked = () => {
    const state = { ...STATE, ...editor.getUiState() } satisfies MenuState;
    return ['Format', 'Paragraph'].flatMap((title) =>
      rowsOf(model, title)
        .filter(isAction)
        .filter((row) => row.checked?.(state))
        .map((row) => row.text),
    );
  };
  editor.view.dispatch({ selection: { anchor: 3 } });
  expect(checked()).toEqual(['Heading 1']);
  editor.view.dispatch({ selection: { anchor: 18 } });
  expect(checked()).toEqual(['Bold', 'Body']);
});

it('binds no key twice across the menu bar and the registry', () => {
  const { editor, model } = mount('Some text.\n');
  const seen = new Map<string, string>();
  const bind = (key: string, owner: string) => {
    const known = seen.get(normalized(key));
    expect(known, `${key} is bound by ${known} and by ${owner}`).toBeUndefined();
    seen.set(normalized(key), owner);
  };
  for (const menu of model.menus) {
    for (const row of menu.rows.filter(isAction)) {
      if (row.accelerator) bind(row.accelerator, `${menu.title} > ${row.text}`);
    }
  }
  // Every registered shortcut is in a menu, so none is bound outside one that the menu would meet.
  for (const command of editor.commands.list()) {
    if (command.shortcut) {
      expect(seen.get(normalized(acceleratorFor(command.shortcut)))).toContain(command.title);
    }
  }
});

it('runs a command once from its key', () => {
  const { editor } = mount('One two three.\n');
  editor.view.dispatch({ selection: { anchor: 5 } });
  editor.view.contentDOM.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'b',
      ctrlKey: !mac,
      metaKey: mac,
      bubbles: true,
      cancelable: true,
    }),
  );
  expect(editor.getDoc()).toBe('One **two** three.\n');
});
