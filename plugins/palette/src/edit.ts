// Cut, Copy and Paste, as the palette's Edit group has them. The Edit menu's items are the system's
// own, which the menu bar sends to the page; the palette is in the page, so its items are commands of
// the registry like the others, and a host says how they reach the clipboard. They have no keys of
// their own: ⌘X, ⌘C and ⌘V are the system's, and the palette only shows them.

import type { EditorState } from '@codemirror/state';
import type { Editor, EditorCommand } from '@redlines/editor';

/** How the Edit items reach the clipboard. A host gives what its page can do. */
export interface PaletteClipboard {
  /** Cuts the selection, as ⌘X does. */
  cut(): void | Promise<void>;
  /** Copies the selection, as ⌘C does. */
  copy(): void | Promise<void>;
  /**
   * Pastes the clipboard at the selection: the host's own Paste where it has one, which is what
   * ⌘V is, and otherwise the clipboard's text.
   */
  paste(): void | Promise<void>;
}

/**
 * A clipboard for a page: Cut and Copy are the editing commands the editor's `cut` and `copy`
 * handlers answer, which the page runs for a press of the palette (a gesture it allows).
 *
 * Paste is the host's own where it has one (`paste`: the Mac's own `paste:` to the page, which WebKit
 * answers with a paste event that carries the clipboard's HTML), so that the editor converts what a
 * web page or Word put there to Markdown, as ⌘V does. It is the fallback's turn when the host has
 * none, or says nothing took it (an empty clipboard, or nothing to take the action), or fails: Paste
 * then reads the clipboard's text through the host, which a page cannot do from a menu without
 * WebKit's own Paste confirmation, and pastes it as ⇧⌘V does: through the editor's own path, as the
 * paster's insertion while Track Changes is on. A clipboard with no text says so, by rejecting.
 */
export function pageClipboard(
  editor: Editor,
  readText: () => Promise<string>,
  paste?: () => Promise<boolean>,
): PaletteClipboard {
  const doc = editor.view.dom.ownerDocument;
  const copying = (what: 'cut' | 'copy') => () => {
    editor.focus();
    if (!doc.execCommand(what)) throw new Error(`The page wouldn't ${what}`);
  };
  return {
    cut: copying('cut'),
    copy: copying('copy'),
    paste: async () => {
      if (paste) {
        // The keyboard is in the document, as for the Mac's own Paste.
        editor.focus();
        const taken = await paste().catch((error: unknown) => {
          // Not for the person: the text is pasted instead. But a grant or a command gone missing
          // would otherwise lose the conversion of HTML without a word.
          console.error('The host could not paste', error);
          return false;
        });
        if (taken) return;
      }
      const text = await readText();
      if (!text) throw new Error('The clipboard has no text');
      editor.pastePlain(text);
    },
  };
}

/** Whether the selection holds text: what Cut and Copy have to work on. */
const hasSelection = (state: EditorState) => state.selection.ranges.some((range) => !range.empty);

/** The commands of the Edit group, which a registry may not hold already: they have no menu. */
export function editCommands(
  clipboard: PaletteClipboard,
  failed: (what: 'cut' | 'copy' | 'paste', error: unknown) => void,
): EditorCommand[] {
  const run = (what: 'cut' | 'copy' | 'paste') => () => {
    try {
      void Promise.resolve(clipboard[what]()).catch((error: unknown) => failed(what, error));
    } catch (error) {
      failed(what, error);
      return false;
    }
    return true;
  };
  return [
    { id: 'edit.cut', title: 'Cut', run: run('cut'), isEnabled: hasSelection },
    { id: 'edit.copy', title: 'Copy', run: run('copy'), isEnabled: hasSelection },
    { id: 'edit.paste', title: 'Paste', run: run('paste') },
  ];
}
