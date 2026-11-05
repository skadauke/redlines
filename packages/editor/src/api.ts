// The editor's public interface. Hosts (the desktop app, the React component, VS Code) and
// plugins such as @redlines/review use only what is here.

import type { EditorState, Extension } from '@codemirror/state';
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
   * Pending changes in document order, for the review bar: the insertions, deletions,
   * substitutions and inserted line breaks that the editor draws and decides. The halves of a
   * move are drawn but left out, because v0.1 doesn't accept or reject them.
   */
  changes: MarkRange[];
  /** The ids of the registered commands that say they are active here, in registered order. */
  activeCommands: readonly string[];
  /**
   * The ids of the registered commands that can run here, in registered order: those that say so,
   * and those with no `isEnabled`.
   */
  enabledCommands: readonly string[];
}

/**
 * Something to do, for the keyboard and for a host's menus: a plugin registers it, the core binds
 * its key, and a host with menus draws it from the registry, so it works the same from either.
 */
export interface EditorCommand {
  /** Unique, such as 'format.bold'. */
  id: string;
  title: string;
  /** CodeMirror notation, such as 'Mod-b'. The core binds it. */
  shortcut?: string;
  /** Where a host with menus shows it. */
  menu?: 'file' | 'edit' | 'format' | 'paragraph' | 'view';
  /** Items with different groups get a separator between them. */
  group?: string;
  /** Returns false when it did nothing. */
  run(editor: Editor): boolean;
  /** For a check mark in a menu. */
  isActive?(state: EditorState): boolean;
  isEnabled?(state: EditorState): boolean;
}

export interface CommandRegistry {
  /**
   * Adds commands and binds their shortcuts. Returns a function that takes them out. They stay when
   * another document is opened (`setDoc`).
   *
   * A command's key comes before the core's, and is the command's even when it did nothing.
   *
   * @throws Error when an id is taken, or a shortcut has a modifier CodeMirror can't read. Then none
   *   of them is added.
   */
  register(commands: readonly EditorCommand[]): () => void;
  /** The commands, in the order they were registered. */
  list(): readonly EditorCommand[];
  /**
   * Runs a command by id, as a menu does: not while focus is in a text field outside the editor.
   * Returns false when it did nothing: no such command, a disabled one, or one that did nothing.
   */
  run(id: string): boolean;
}

export interface EditorOptions {
  /** The file's text, with any line endings. */
  doc: string;
  author: Author;
  /** Default: 'redlines' when the document has redlines, else 'clean' (design §5.3). */
  view?: ViewMode;
  /**
   * Whether your edits start out tracked (design §5.4). Default: true when the ledger says
   * `tracking: everyone` (format §5.6).
   */
  tracking?: boolean;
  /** Extra CodeMirror extensions, such as @redlines/review's. */
  extensions?: Extension[];
  /** Called after every change to the document, with what `getDoc()` returns. */
  onChange?: (doc: string) => void;
  /** Called when the view, tracking, the pending changes or the state of a command change. */
  onUiState?: (state: EditorUiState) => void;
  /**
   * Called with a short message, written for people, when the editor refuses an edit, such as a
   * tracked change inside code, where its markers would not be read, typing in Raw while Track
   * Changes is on, or an Undo after the file changed on disk. Nothing was changed.
   */
  onNotice?: (message: string) => void;
}

export interface Editor {
  /** The CodeMirror view, for plugins. Its document always has LF line breaks. */
  readonly view: EditorView;
  /** The commands plugins add, which the core binds to keys and a host may show in its menus. */
  readonly commands: CommandRegistry;
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
   * lines that differ are replaced, each trimmed to the characters that differ, so the selection
   * and the scroll position stay where they are, and the reload is not an edit to undo. A reload
   * that changes the text starts the undo history over: the steps before it were made to the old
   * version, and undoing or redoing them over the new one could take an agent's work apart, so
   * there is nothing to undo or redo, and Undo and Redo say so through `onNotice`. Its transaction
   * is annotated `Transaction.remote` and the user event `reload`. The file's line ending is taken
   * from the new string. The view stays, even when the document loses its last redline, except
   * that a document that gains redlines while shown Clean switches to Redlines.
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
  /**
   * Turns Track Changes on or off (design §5.4). While it is on, what you type, delete, paste or
   * drop becomes tracked changes by `author`, with the markers and ledger entries the format
   * writes (format §3.6); a tracked change made in Clean switches the view to Redlines, and Raw is
   * read-only, where an edit says why through `onNotice`. While it is off, an edit is an edit of
   * the text itself (format §3.10): what you type joins no pending change, and what you delete is
   * gone, with the marks that have no text left; an edit with no legal form says why through
   * `onNotice`. On or off, outside Raw, Backspace and Delete never delete a marker.
   */
  setTracking(on: boolean): void;
  /**
   * Accepts a pending change by its mark id, in one step that Undo takes back.
   *
   * @throws EditError when there is no such change, when it is a comment, or when v0.1 doesn't
   *   decide its kind.
   */
  accept(id: string): void;
  /** Rejects a pending change by its mark id, as `accept` does. */
  reject(id: string): void;
  /**
   * Adds CodeMirror extensions after the editor was made, as a plugin such as @redlines/review
   * does. Like the extensions given in `EditorOptions`, they stay when another document is opened
   * (`setDoc`), with fresh state; extensions appended by a transaction belong to the document's
   * state and don't. Returns a function that takes them out again.
   */
  addExtension(extension: Extension): () => void;
  /**
   * Pastes `text`, the clipboard's plain text, at the selection, as Paste as Plain Text does: it
   * goes in through the same path as ⌘V, so it is the paster's own text in every view (see copy
   * and paste, design §5.10), and an insertion while Track Changes is on. The host reads the
   * clipboard, for which a page has no way that works from a menu.
   */
  pastePlain(text: string): void;
  focus(): void;
  /** Removes the editor from the page. */
  destroy(): void;
}
