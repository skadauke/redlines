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
  const rows = (edit?.rows ?? []).filter(isAction);
  expect(rows.map((row) => [row.text, row.accelerator])).toEqual([
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
