// Table editing, as commands of the registry (design: tables, "Rows and columns"): the Table menu
// and the keys that go with its items. The table itself, its layout, its keys and its pointer are the
// editor core's (`packages/editor/src/table`), because a table is source text that the caret has to
// step through; this plugin holds what a menu draws. Insert Row Below is the first of them, and the
// others join it as rows and columns can be selected, moved and deleted.

import {
  type Editor,
  type EditorCommand,
  deleteRows,
  headInTable,
  insertRows,
  moveRows,
  rowTitles,
  selectRect,
  type TableScope,
} from '@redlines/editor';
import type { Plugin } from '@redlines/plugin-api';
import type { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

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
  /** A command on the rows the selection touches: its title counts them. Outside a table its key is
   * the editor's own (⌥↑ moves a line, ⌘↩ ends a block). */
  const row = (
    id: string,
    title: (state: EditorState) => string,
    shortcut: string,
    run: (view: EditorView) => boolean,
    group = 'rows',
  ): EditorCommand => ({
    id,
    title,
    shortcut,
    keyFallsThrough: true,
    menu: 'table',
    group,
    isEnabled: headInTable,
    run: (target) => run(target.view),
  });
  const commands: EditorCommand[] = [
    row('table.insertRowAbove', rowTitles.insertAbove, 'Alt-Mod-ArrowUp', (view) =>
      insertRows(view, true),
    ),
    // ⌘↩ is the editor's own key for the same, which in a table inserts the rows too.
    row('table.insertRowBelow', rowTitles.insertBelow, 'Alt-Mod-ArrowDown', (view) =>
      insertRows(view, false),
    ),
    row('table.deleteRow', rowTitles.delete, 'Alt-Mod-Backspace', deleteRows),
    row('table.moveRowUp', rowTitles.moveUp, 'Alt-ArrowUp', (view) => moveRows(view, true), 'move'),
    row(
      'table.moveRowDown',
      rowTitles.moveDown,
      'Alt-ArrowDown',
      (view) => moveRows(view, false),
      'move',
    ),
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
        { id: 'table.insertRowAbove', title: 'Insert Row Above', shortcut: 'Alt-Mod-ArrowUp' },
        { id: 'table.insertRowBelow', title: 'Insert Row Below', shortcut: 'Alt-Mod-ArrowDown' },
        { id: 'table.deleteRow', title: 'Delete Row', shortcut: 'Alt-Mod-Backspace' },
        { id: 'table.moveRowUp', title: 'Move Row Up', shortcut: 'Alt-ArrowUp' },
        { id: 'table.moveRowDown', title: 'Move Row Down', shortcut: 'Alt-ArrowDown' },
        { id: 'table.selectCell', title: 'Select Cell' },
        { id: 'table.selectRow', title: 'Select Row', shortcut: 'Ctrl-l' },
        { id: 'table.selectColumn', title: 'Select Column' },
        { id: 'table.selectTable', title: 'Select Table' },
      ],
    },
  },
  activate: (context) => createTables(context.editor as Editor),
};
