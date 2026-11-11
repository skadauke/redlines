// Table editing, as commands of the registry (design: tables, "Rows and columns"): the Table menu
// and the keys that go with its items. The table itself, its layout, its keys and its pointer are the
// editor core's (`packages/editor/src/table`), because a table is source text that the caret has to
// step through; this plugin holds what a menu draws. Insert Row Below is the first of them, and the
// others join it as rows and columns can be selected, moved and deleted.

import {
  alignCols,
  caretAlign,
  colTitles,
  type Editor,
  type EditorCommand,
  deleteCols,
  deleteRows,
  headInTable,
  insertCols,
  insertRows,
  moveCols,
  moveRows,
  rowTitles,
  selectRect,
  type TableScope,
} from '@redlines/editor';
import type { Plugin } from '@redlines/plugin-api';
import { tableGrips } from './grips.ts';
import type { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

/** The alignments a column has, as commands. */
const ALIGNS = [
  { id: 'table.alignLeft', title: 'Align Left', align: 'left' },
  { id: 'table.alignCenter', title: 'Align Center', align: 'center' },
  { id: 'table.alignRight', title: 'Align Right', align: 'right' },
  { id: 'table.alignDefault', title: 'Default Alignment', align: '' },
] as const;

/**
 * Registers the Table menu's commands and returns a function that takes them out again. Register
 * before the menu bar is drawn, as every plugin with commands does.
 */
export function createTables(editor: Editor): () => void {
  const removeGrips = editor.addExtension(tableGrips());
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
    row(
      'table.insertColumnLeft',
      colTitles.insertLeft,
      'Alt-Mod-ArrowLeft',
      (view) => insertCols(view, true),
      'columns',
    ),
    row(
      'table.insertColumnRight',
      colTitles.insertRight,
      'Alt-Mod-ArrowRight',
      (view) => insertCols(view, false),
      'columns',
    ),
    row('table.deleteColumn', colTitles.delete, 'Ctrl-Meta-Backspace', deleteCols, 'columns'),
    // Moving columns has no default key: Alt with the arrows is the word and the row.
    {
      id: 'table.moveColumnLeft',
      title: colTitles.moveLeft,
      menu: 'table',
      group: 'move',
      isEnabled: headInTable,
      run: (target) => moveCols(target.view, true),
    },
    {
      id: 'table.moveColumnRight',
      title: colTitles.moveRight,
      menu: 'table',
      group: 'move',
      isEnabled: headInTable,
      run: (target) => moveCols(target.view, false),
    },
    // The selected columns' alignment, checked for the caret's column. No default key: Word's keys
    // align the paragraph, and a table's alignment is its column's.
    ...ALIGNS.map(({ id, title, align }): EditorCommand => ({
      id,
      title,
      menu: 'table',
      group: 'align',
      isEnabled: headInTable,
      isActive: (state) => caretAlign(state) === align,
      run: (target) => alignCols(target.view, align),
    })),
    select('table.selectCell', 'Select Cell', 'cell'),
    // ⌃L is CodeMirror's select line elsewhere; in a table it selects the row.
    select('table.selectRow', 'Select Row', 'row', 'Ctrl-l'),
    select('table.selectColumn', 'Select Column', 'column'),
    select('table.selectTable', 'Select Table', 'table'),
  ];
  const removeCommands = editor.commands.register(commands);
  return () => {
    removeCommands();
    removeGrips();
  };
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
        {
          id: 'table.insertColumnLeft',
          title: 'Insert Column Left',
          shortcut: 'Alt-Mod-ArrowLeft',
        },
        {
          id: 'table.insertColumnRight',
          title: 'Insert Column Right',
          shortcut: 'Alt-Mod-ArrowRight',
        },
        { id: 'table.deleteColumn', title: 'Delete Column', shortcut: 'Ctrl-Meta-Backspace' },
        { id: 'table.moveColumnLeft', title: 'Move Column Left' },
        { id: 'table.moveColumnRight', title: 'Move Column Right' },
        { id: 'table.alignLeft', title: 'Align Left' },
        { id: 'table.alignCenter', title: 'Align Center' },
        { id: 'table.alignRight', title: 'Align Right' },
        { id: 'table.alignDefault', title: 'Default Alignment' },
        { id: 'table.selectCell', title: 'Select Cell' },
        { id: 'table.selectRow', title: 'Select Row', shortcut: 'Ctrl-l' },
        { id: 'table.selectColumn', title: 'Select Column' },
        { id: 'table.selectTable', title: 'Select Table' },
      ],
    },
  },
  activate: (context) => createTables(context.editor as Editor),
};
