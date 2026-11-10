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

/** What `routeHistory` reaches for. */
export interface HistoryRoute {
  /** The editor: its element, and its Undo and Redo (true when they did or said something). */
  editor: { dom: Element; undo: () => boolean; redo: () => boolean };
  active: () => Element | null;
  windowHasKeys: () => boolean;
  /** The app's window: asks it to send Undo or Redo to the field that has the keys (in Tauri). */
  askApp: ((redo: boolean) => Promise<boolean>) | null;
  /** The page's own undo, where there is no app (a browser). */
  pageUndo: (redo: boolean) => void;
  beep: () => void;
  /** Said when the app couldn't be asked. */
  fail: (error: unknown) => void;
}

/**
 * The Edit menu's Undo or Redo: the editor's history in the document; with the keys in a text field,
 * here or in Preferences, the field's own undo, which the app asks of the window that has the keys,
 * as the Mac's own items do, with a beep when nothing took it. A field in the middle of composing
 * text (an input method) is handled as it was before the items were the app's own.
 */
export function routeHistory(route: HistoryRoute, redo: boolean): void {
  if (historyIsDocuments(route.editor.dom, route.active(), route.windowHasKeys())) {
    if (redo) route.editor.redo();
    else route.editor.undo();
    return;
  }
  if (!route.askApp) {
    route.pageUndo(redo);
    return;
  }
  route.askApp(redo).then(
    (taken) => {
      if (!taken) route.beep();
    },
    (error: unknown) => route.fail(error),
  );
}
