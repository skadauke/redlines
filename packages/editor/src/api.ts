// The editor's public interface. Hosts (the desktop app, the React component, VS Code) and
// plugins such as @redlines/review use only what is here.

import type { Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { Handle, MarkRange, Parsed } from '@redlines/format';

/** How the document is shown (design §5.3). */
export type ViewMode = 'clean' | 'redlines' | 'raw';

/** The person editing, whose changes and comments carry this identity. */
export interface Author {
  handle: Handle;
  name: string;
  email?: string;
  agent?: boolean;
  for?: Handle;
}

/** What the host's controls need to show. */
export interface EditorUiState {
  view: ViewMode;
  /** Whether your edits are tracked (design §5.4). */
  tracking: boolean;
  /**
   * The file has redlines (design §5.3): pending changes, highlights or comment threads. Marks
   * the editor doesn't draw yet, such as format changes, don't count.
   */
  hasRedlines: boolean;
  /**
   * Pending changes in document order, for the review bar: the insertions, deletions and
   * substitutions that the editor draws and decides.
   */
  changes: MarkRange[];
}

export interface EditorOptions {
  /** The file's text, with any line endings. */
  doc: string;
  author: Author;
  /** Default: 'redlines' when the document has redlines, else 'clean' (design §5.3). */
  view?: ViewMode;
  /** Default: true when the ledger says `tracking: everyone` (format §5.6). */
  tracking?: boolean;
  /** Extra CodeMirror extensions, such as @redlines/review's. */
  extensions?: Extension[];
  /** Called after every change to the document, with what `getDoc()` returns. */
  onChange?: (doc: string) => void;
  /** Called when the view, tracking or the pending changes change. */
  onUiState?: (state: EditorUiState) => void;
}

export interface Editor {
  /** The CodeMirror view, for plugins. Its document always has LF line breaks. */
  readonly view: EditorView;
  /**
   * The file's text. While the document is unchanged since it was loaded or last set, this is
   * the string the editor was given, byte for byte, whatever its line endings. After an edit,
   * each line break the file had keeps its own style (format §9.2), and each new one is written
   * in the file's line ending: the style of the given string's first line break, or LF when it
   * had none.
   */
  getDoc(): string;
  /**
   * Replaces the whole document and clears the undo history, as when a file is opened. The
   * file's line ending is taken from the new string, and the view and Track Changes start over
   * from their defaults: Redlines when the document has redlines, else Clean, and tracking on
   * when the file asks for it (`tracking: everyone`).
   */
  setDoc(doc: string): void;
  /**
   * Brings in a new version of the same file, such as one an agent changed on disk. Only the
   * lines that differ are replaced, each trimmed to the characters that differ, so the selection,
   * the scroll position and the undo history stay where they are, and the reload is not an edit
   * to undo. Its transaction is annotated `Transaction.remote` and the user event `reload`. The
   * file's line ending is taken from the new string. The view stays, except that a document that
   * gains redlines while shown Clean switches to Redlines, and one that loses them all while
   * shown Redlines switches to Clean.
   */
  reloadDoc(doc: string): void;
  /**
   * The parse of the document as CodeMirror holds it, with LF line breaks, so its offsets are
   * CodeMirror positions. Its `text` matches `getDoc()` only when all the file's line breaks
   * are LF.
   */
  getParsed(): Parsed;
  getUiState(): EditorUiState;
  setViewMode(mode: ViewMode): void;
  setTracking(on: boolean): void;
  /** Accepts a pending change by its mark id. */
  accept(id: string): void;
  /** Rejects a pending change by its mark id. */
  reject(id: string): void;
  focus(): void;
  /** Removes the editor from the page. */
  destroy(): void;
}
