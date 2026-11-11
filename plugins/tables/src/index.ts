// Table editing, as commands of the registry (design: tables, "Rows and columns"): the Table menu
// and the keys that go with its items. The table itself, its layout, its keys and its pointer are the
// editor core's (`packages/editor/src/table`), because a table is source text that the caret has to
// step through; this plugin holds what a menu draws. Insert Row Below is the first of them, and the
// others join it as rows and columns can be selected, moved and deleted.

import {
  type Editor,
  type EditorCommand,
  insertRowBelow,
  selectionInTable,
} from '@redlines/editor';
import type { Plugin } from '@redlines/plugin-api';

export interface TablesOptions {
  /** Shows a one-line message for what can't be done. Nothing is changed then. */
  notice(message: string): void;
}

/**
 * Registers the Table menu's commands and returns a function that takes them out again. Register
 * before the menu bar is drawn, as every plugin with commands does.
 */
export function createTables(editor: Editor, options: TablesOptions): () => void {
  void options;
  const commands: EditorCommand[] = [
    {
      id: 'table.insertRowBelow',
      title: 'Insert Row Below',
      shortcut: 'Mod-Enter',
      menu: 'table',
      group: 'rows',
      // Outside a table ⌘↩ is the editor's own: Return at the end of a block.
      keyFallsThrough: true,
      isEnabled: selectionInTable,
      run: (target) => insertRowBelow(target.view),
    },
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
      commands: [{ id: 'table.insertRowBelow', title: 'Insert Row Below', shortcut: 'Mod-Enter' }],
    },
  },
  activate: (context) =>
    createTables(context.editor as Editor, { notice: (message) => context.notice(message) }),
};
