// @vitest-environment happy-dom
// The review interface's commands in the app's menus: main.ts creates it after any plugin with
// commands in the Format menu, because a menu lists its commands in the order they were registered.

import { createEditor, type Author } from '@redlines/editor';
import { createReview } from '@redlines/review';
import { afterEach, expect, it } from 'vitest';
import { appMenuModel, type ActionRow, type MenuCommands } from './menu-model.ts';

const author: Author = { handle: 'ada', name: 'Ada Lovelace' };

afterEach(() => document.body.replaceChildren());

it('has Add Comment and Highlight last in the Format menu, with their keys, and they work', () => {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, { doc: 'Some text.', author });
  editor.commands.register([
    { id: 'format.bold', title: 'Bold', menu: 'format', group: 'inline', run: () => true },
  ]);
  const review = createReview(editor, { author });

  const model = appMenuModel({} as MenuCommands, editor.commands);
  const rows = model.menus.find(({ title }) => title === 'Format')?.rows ?? [];
  // The two are one group, with no separator between them.
  expect(rows.map((row) => ('text' in row ? row.text : 'item' in row ? row.item : ''))).toEqual([
    'Bold',
    'Separator',
    'Add Comment',
    'Highlight',
  ]);
  const [comment, highlight] = rows.slice(-2) as ActionRow[];
  expect(comment!.accelerator).toBe('CmdOrCtrl+Alt+M');
  expect(highlight!.accelerator).toBe('CmdOrCtrl+Shift+H');
  // Highlight makes a highlight on the word at the caret, and its title then says it can be taken
  // away.
  expect(editor.getParsed().marks).toEqual([]);
  highlight!.action();
  expect(editor.getParsed().marks.map((mark) => mark.kind)).toEqual(['hl']);
  expect(editor.getUiState().commandTitles['highlight.toggle']).toBe('Remove Highlight');
  comment!.action();
  expect(editor.view.dom.querySelector('.rl-note textarea')).not.toBeNull();

  review.destroy();
  editor.destroy();
});
