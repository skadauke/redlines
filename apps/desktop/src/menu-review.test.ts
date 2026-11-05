// @vitest-environment happy-dom
// The review interface's command in the app's menus: main.ts creates it after any plugin with
// commands in the Format menu, because a menu lists its commands in the order they were registered.

import { createEditor, type Author } from '@redlines/editor';
import { createReview } from '@redlines/review';
import { afterEach, expect, it } from 'vitest';
import { appMenuModel, type ActionRow, type MenuCommands } from './menu-model.ts';

const author: Author = { handle: 'ada', name: 'Ada Lovelace' };

afterEach(() => document.body.replaceChildren());

it('has Add Comment last in the Format menu, with its key, and it opens the box', () => {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, { doc: 'Some text.', author });
  editor.commands.register([
    { id: 'format.bold', title: 'Bold', menu: 'format', group: 'inline', run: () => true },
  ]);
  const review = createReview(editor, { author });

  const model = appMenuModel({} as MenuCommands, editor.commands);
  const rows = model.menus.find(({ title }) => title === 'Format')?.rows ?? [];
  expect(rows.map((row) => ('text' in row ? row.text : 'item' in row ? row.item : ''))).toEqual([
    'Bold',
    'Separator',
    'Add Comment',
  ]);
  const row = rows.at(-1) as ActionRow;
  expect(row.accelerator).toBe('CmdOrCtrl+Alt+M');
  row.action();
  expect(editor.view.dom.querySelector('.rl-note textarea')).not.toBeNull();

  review.destroy();
  editor.destroy();
});
