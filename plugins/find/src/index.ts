// Find and replace in the text a reader sees (spec: Menus). The document holds markers and a ledger
// that a reader never sees, so find searches the newest view of it and maps matches back to the
// document. Replacing is an edit like typing, so Track Changes records it as substitutions.

import type { Editor, EditorCommand } from '@redlines/editor';
import type { Plugin } from '@redlines/plugin-api';
import { findBar } from './bar.ts';
import { findState, selectedText, setFind, step } from './search.ts';

/**
 * Adds find and replace to an editor, with its commands: Find ⌘F, Find Next ⌘G, Find Previous ⇧⌘G,
 * Find and Replace ⌥⌘F and Use Selection for Find ⌘E, in the Edit menu. Returns a function that
 * takes it out again.
 */
export function createFind(editor: Editor): () => void {
  const { view } = editor;
  const bar = findBar(editor);
  const removeBar = editor.addExtension(bar.extension);

  /** Opens the bar, with or without the replace row, and puts the caret in its find box, or in its replace box when asked for the row. */
  const open = (replace: boolean) => {
    view.dispatch({ effects: setFind.of({ open: true, replace: replace || undefined }) });
    bar.focus(replace);
    return true;
  };
  /** Moves to the next or previous match, opening the bar first if it was closed. */
  const move = (dir: 1 | -1) => {
    if (!findState(view.state).open) view.dispatch({ effects: setFind.of({ open: true }) });
    if (!findState(view.state).query) return open(false);
    return step(view, dir);
  };

  // All of them run while focus is in the bar's own boxes, as the menu items are chosen there.
  const command = (
    fields: Omit<EditorCommand, 'menu' | 'group' | 'runsInFields'>,
  ): EditorCommand => ({
    menu: 'edit',
    group: 'find',
    runsInFields: true,
    ...fields,
  });
  const removeCommands = editor.commands.register([
    command({ id: 'find.open', title: 'Find', shortcut: 'Mod-f', run: () => open(false) }),
    command({ id: 'find.next', title: 'Find Next', shortcut: 'Mod-g', run: () => move(1) }),
    command({
      id: 'find.previous',
      title: 'Find Previous',
      shortcut: 'Mod-Shift-g',
      run: () => move(-1),
    }),
    command({
      id: 'find.replace',
      title: 'Find and Replace',
      shortcut: 'Mod-Alt-f',
      run: () => open(true),
    }),
    command({
      id: 'find.useSelection',
      title: 'Use Selection for Find',
      shortcut: 'Mod-e',
      run: () => {
        const query = selectedText(view.state);
        if (!query) return false;
        view.dispatch({ effects: setFind.of({ open: true, query }) });
        return true;
      },
    }),
  ]);

  return () => {
    removeCommands();
    removeBar();
  };
}

export const plugin: Plugin = {
  manifest: {
    id: 'redlines.find',
    name: 'Find and replace',
    version: '0.0.0',
    needs: ['document:read', 'document:edit'],
    contributes: {
      commands: [
        { id: 'find.open', title: 'Find', shortcut: 'Mod-f' },
        { id: 'find.next', title: 'Find Next', shortcut: 'Mod-g' },
        { id: 'find.previous', title: 'Find Previous', shortcut: 'Mod-Shift-g' },
        { id: 'find.replace', title: 'Find and Replace', shortcut: 'Mod-Alt-f' },
        { id: 'find.useSelection', title: 'Use Selection for Find', shortcut: 'Mod-e' },
      ],
    },
  },
  activate: (context) => createFind(context.editor as Editor),
};
