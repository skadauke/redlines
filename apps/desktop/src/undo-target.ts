// Whose history the Edit menu's Undo and Redo take back. The document's own is the editor's, which
// the app titles and enables the items from; a text field has its own (a comment box, the find bar,
// a field of Preferences), which the app can't see, and Undo and Redo go to it as they always did.

/** Whether `element` is a field that takes text, as a person types in it. */
function takesText(element: Element): boolean {
  if (element instanceof HTMLTextAreaElement) return true;
  if (element instanceof HTMLInputElement) {
    return ![
      'button',
      'checkbox',
      'color',
      'file',
      'image',
      'radio',
      'range',
      'reset',
      'submit',
    ].includes(element.type);
  }
  return element instanceof HTMLElement && element.isContentEditable;
}

/**
 * Whether Undo and Redo are the document's: this window has the keys (`windowHasKeys`; a menu bar
 * that is this window's serves Preferences too, whose fields are in no page of this one), and no
 * text field outside the editor has the focus in it.
 */
export function historyIsDocuments(
  editor: Element,
  active: Element | null,
  windowHasKeys: boolean,
): boolean {
  if (!windowHasKeys) return false;
  if (!active || editor.contains(active)) return true;
  return !takesText(active);
}
