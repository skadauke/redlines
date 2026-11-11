// Table editing, as commands of the registry (design: tables, "Rows and columns"): the Table menu
// and the keys that go with its items. The table itself, its layout, its keys and its pointer are the
// editor core's (`packages/editor/src/table`), because a table is source text that the caret has to
// step through; this plugin holds what a menu draws. Insert Row Below is the first of them, and the
// others join it as rows and columns can be selected, moved and deleted.

import {
  type Editor,
  type EditorCommand,
  headInTable,
  insertRowBelow,
  selectRect,
  type TableScope,
} from '@redlines/editor';
import type { Plugin } from '@redlines/plugin-api';

/**
 * Registers the Table menu's commands and returns a function that takes them out again. Register
 * before the menu bar is drawn, as every plugin with commands does.
 */
export function createTables(editor: Editor): () => void {
  const select = (
    id: string,
    title: string,
    scope: TableScope,
    shortcut?: string,
  ): EditorCommand => ({
    id,
    title,
    ...(shortcut ? { shortcut, keyFallsThrough: true } : {}),
    menu: 'table',
    group: 'select',
    isEnabled: headInTable,
    run: (target) => selectRect(target.view, scope),
  });
  const commands: EditorCommand[] = [
    {
      id: 'table.insertRowBelow',
      title: 'Insert Row Below',
      shortcut: 'Mod-Enter',
      menu: 'table',
      group: 'rows',
      // Outside a table ⌘↩ is the editor's own: Return at the end of a block.
      keyFallsThrough: true,
      // The command works from the caret's row: enabled where the head is in a cell.
      isEnabled: headInTable,
      run: (target) => insertRowBelow(target.view),
    },
    select('table.selectCell', 'Select Cell', 'cell'),
    // ⌃L is CodeMirror's select line elsewhere; in a table it selects the row.
    select('table.selectRow', 'Select Row', 'row', 'Ctrl-l'),
    select('table.selectColumn', 'Select Column', 'column'),
    select('table.selectTable', 'Select Table', 'table'),
  ];
  return editor.commands.register(commands);
}

export const plugin: Plugin = {
  manifest: {
    id: 'redlines.tables',
    name: 'Tables',
    version: '0.0.0',
    needs: ['document:read', 'document:edit'],
    contributes: {
      commands: [
        { id: 'table.insertRowBelow', title: 'Insert Row Below', shortcut: 'Mod-Enter' },
        { id: 'table.selectCell', title: 'Select Cell' },
        { id: 'table.selectRow', title: 'Select Row', shortcut: 'Ctrl-l' },
        { id: 'table.selectColumn', title: 'Select Column' },
        { id: 'table.selectTable', title: 'Select Table' },
      ],
    },
  },
  activate: (context) => createTables(context.editor as Editor),
};
