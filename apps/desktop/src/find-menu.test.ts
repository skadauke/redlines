// @vitest-environment happy-dom
import { createEditor } from '@redlines/editor';
import { afterEach, expect, it } from 'vitest';
import { appMenuModel, type ActionRow, type MenuCommands, type MenuRow } from './menu-model.ts';
import { activatePlugins, DESKTOP_PLUGINS } from './plugins.ts';

afterEach(() => document.body.replaceChildren());

const isAction = (row: MenuRow): row is ActionRow => 'action' in row;

it('puts find in the Edit menu, and Find Next works with focus in the find bar', () => {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, {
    doc: 'cat, cat, cat.\n',
    author: { handle: 'ada', name: 'Ada Lovelace' },
  });
  const stop = activatePlugins(editor, {}, DESKTOP_PLUGINS);
  const model = appMenuModel({} as MenuCommands, editor.commands);
  const edit = model.menus.find((menu) => menu.title === 'Edit');
  const all = edit?.rows ?? [];
  // The Edit menu reads: the Mac's items, Paste as Plain Text, then the find items, set apart.
  expect(all.map((row) => ('item' in row ? row.item : 'text' in row ? row.text : ''))).toEqual([
    'Undo',
    'Redo',
    'Separator',
    'Cut',
    'Copy',
    'Paste',
    'Paste as Plain Text',
    'SelectAll',
    'Separator',
    'Find',
    'Find Next',
    'Find Previous',
    'Find and Replace',
    'Use Selection for Find',
  ]);
  const rows = all.filter(isAction);
  const findRows = rows.filter((row) => row.text !== 'Paste as Plain Text');
  expect(findRows.map((row) => [row.text, row.accelerator])).toEqual([
    ['Find', 'CmdOrCtrl+F'],
    ['Find Next', 'CmdOrCtrl+G'],
    ['Find Previous', 'CmdOrCtrl+Shift+G'],
    ['Find and Replace', 'CmdOrCtrl+Alt+F'],
    ['Use Selection for Find', 'CmdOrCtrl+E'],
  ]);

  const item = (text: string) => rows.find((row) => row.text === text)!;
  item('Find').action();
  const box = editor.view.dom.querySelector<HTMLInputElement>('.rl-find-query')!;
  box.value = 'cat';
  box.dispatchEvent(new Event('input', { bubbles: true }));
  expect(document.activeElement).toBe(box);

  item('Find Next').action();
  item('Find Next').action();
  expect(editor.view.state.selection.main.from).toBe(5);
  item('Find Previous').action();
  expect(editor.view.state.selection.main.from).toBe(0);
  expect(document.activeElement).toBe(box);
  stop();
  editor.destroy();
});
