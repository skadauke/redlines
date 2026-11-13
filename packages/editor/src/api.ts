// The editor's public interface. Hosts (the desktop app, the React component, VS Code) and
// plugins such as @redlines/review use only what is here.

import type { Language, LanguageDescription } from '@codemirror/language';
import type { EditorState, Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { Handle, MarkRange, Parsed, Range } from '@redlines/format';

/** How the document is shown (design §5.3). */
export type ViewMode = 'clean' | 'simple' | 'redlines' | 'raw';

/**
 * The two views that show a review: Simple (deletions hidden, insertions plain, change bars and
 * comments) and Redlines. The one chosen last is the one the editor switches to when it picks a
 * view for you.
 */
export type MarkupView = 'simple' | 'redlines';

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
  /** The markup view chosen last, which an automatic switch shows. */
  markupView: MarkupView;
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
  /**
   * The current title of each registered command whose title reads the state, by id: `Delete 2
   * Rows`. A command with a plain title is not in it.
   */
  commandTitles: Readonly<Record<string, string>>;
  /** What Undo would take back, for the Edit menu ("Typing", "Claude’s Changes"), or null for nothing, or a step with no name. */
  undo: string | null;
  /** What Redo would bring back, likewise. */
  redo: string | null;
  /** Whether there is a step to undo: the Edit menu's Undo is enabled only then. */
  canUndo: boolean;
  /** Whether there is a step to redo. */
  canRedo: boolean;
}

/**
 * Something to do, for the keyboard and for a host's menus: a plugin registers it, the core binds
 * its key, and a host with menus draws it from the registry, so it works the same from either.
 */
export interface EditorCommand {
  /** Unique, such as 'format.bold'. */
  id: string;
  /**
   * The menu item's text. A function reads the state, for a title that counts the selection
   * (`Delete 3 Rows`); the UI state reports it (`EditorUiState.commandTitles`), and a menu that
   * draws items from the registry follows it.
   */
  title: string | ((state: EditorState) => string);
  /** CodeMirror notation, such as 'Mod-b'. The core binds it. */
  shortcut?: string;
  /** Where a host with menus shows it. */
  menu?: 'file' | 'edit' | 'format' | 'paragraph' | 'table' | 'view';
  /** Items with different groups get a separator between them. */
  group?: string;
  /**
   * Whether a menu may run it while focus is in a text field outside the editor, such as find's
   * own box, which then handles its keys itself. Default: false.
   */
  runsInFields?: boolean;
  /**
   * Whether its key goes on to the core's binding when the command is disabled or did nothing, as
   * ⌘↩ does outside a table, where it is Return at the end of a block. Default: false, a key
   * belongs to its command.
   */
  keyFallsThrough?: boolean;
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
   * Runs a command by id, as a menu does: not while focus is in a text field outside the editor,
   * unless the command says it `runsInFields`.
   * Returns false when it did nothing: no such command, a disabled one, or one that did nothing.
   */
  run(id: string): boolean;
}

/** Someone this machine has met and the author color (2 to 8) they were given (design §5.5). */
export interface MetPerson {
  handle: string;
  color: number;
}

export interface EditorOptions {
  /** The file's text, with any line endings. */
  doc: string;
  author: Author;
  /** Default: the markup view when the document has redlines, else 'clean' (design §5.3). */
  view?: ViewMode;
  /**
   * The keys that show Simple and Redlines, as the host writes them (⌥⌘2 and ⌥⌘3 in the desktop
   * app), which the hint on a change bar names. Default: none, and the hint names no keys, as in
   * an embed with no such shortcuts.
   */
  viewKeys?: { simple?: string; redlines?: string };
  /**
   * The markup view the editor shows where it picks one for you: when a document with redlines
   * opens, and when a tracked change or a comment is made in Clean. Default: 'redlines'. The host
   * is told when the person chooses another (`EditorUiState.markupView`).
   */
  markupView?: MarkupView;
  /**
   * Whether your edits start out tracked (design §5.4). Default: true when the ledger says
   * `tracking: everyone` (format §5.6).
   */
  tracking?: boolean;
  /**
   * Whether turning Track Changes on or off is written to the document, as `tracking: everyone` in
   * its ledger (format §5.6), so that the file remembers it, and is edited like by any change.
   * Default: false, and `setTracking` changes only this editor's state, for a host with no file.
   */
  saveTracking?: boolean;
  /**
   * How typing helps. Default: the browser's own spell check and nothing else. The help goes
   * through the normal input path, so Track Changes records it like any typing.
   */
  typing?: EditorTyping;
  /**
   * Asks the host for the system's correction of a word that Return or Shift-Return ends (design
   * §5.1): WebKit corrects only around text it types itself, and the editor handles these keys on
   * its own. `before` is the text of the block up to the word, for its language. The answer is the
   * corrected word, or null; it is made, as WebKit's corrections are, only if the word is still
   * exactly where it was. Asked only while `typing.spellCheck` is on, of a word in prose, and
   * never in Raw. Default: none, and nothing is asked.
   */
  correctWord?: (word: string, before: string) => Promise<string | null>;
  /**
   * Whether an inserted or a deleted line break shows its mark in Redlines (design §5.5): a small
   * pilcrow (¶) at the break, or a struck one for each line break deleted. Default: false, and the
   * change bar marks the line; deleted text that held line breaks is drawn with a space between
   * the words they parted.
   */
  showLineBreakMarks?: boolean;
  /**
   * Finds the language of a fenced code block from its info string (the word after the opening
   * fence), so that the block is parsed, and colored once the language loads. Default: none, and
   * code stays plain. @redlines/code provides it, with the colors.
   */
  codeLanguages?: (info: string) => Language | LanguageDescription | null;
  /**
   * Opens a link's address, for a ⌘-click on a link (Ctrl-click off a Mac): the host decides how, in
   * the browser or the mail app. Only `http`, `https` and `mailto` addresses reach it (a `www.`
   * address is the web's), and a hint on the link names the click after the title bar's pause.
   * Default: none, and a link is text like any other: no click opens it and no hint shows.
   */
  openLink?: (address: string) => void;
  /**
   * Turns the path of a local image, as written in the document and decoded (`img/a b.png`), into
   * a URL the page can load, or null to show the image's alt text. The host knows where the
   * document is and which folders the page may load from. Default: none, and a local image shows
   * its alt text. A URL is loaded as it is, except inside a pending change, where it is never
   * fetched (and shows its alt text) until the change is accepted; a local image inside one loads.
   */
  resolveImage?: (src: string) => string | null;
  /**
   * The people this machine has met, in the order of meeting, each with their author color
   * (design §5.5): a person keeps their color in every document. Default: none, and colors come
   * from handles alone, so the same people look the same in a document wherever it is opened.
   */
  people?: readonly MetPerson[];
  /**
   * Called, once for each person, with the handles of people in a document whom `people` has no
   * color for, so that the host records them (in order) and hands the new record back with
   * `setPeople`. Never called without `people`. `meetPeople` makes the new record.
   */
  onNewPeople?: (handles: string[]) => void;
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
  /**
   * Called when Undo or Redo, by key or through `undo()` and `redo()`, finds nothing to take and
   * nothing to say: the host beeps, as the Mac does. The key is taken all the same, so that it
   * never reaches the page's own undo.
   */
  onNothingToUndo?: (redo: boolean) => void;
}

/** An agent's edit, for the history: what it is part of, and who made it (design: What a step is). */
export interface AgentStep {
  /**
   * A run's id, or a change on disk's. Edits of one group join one step while nothing of yours
   * comes between.
   */
  group: string;
  /** The agent as people read it: 'Claude', or 'Claude and Codex' for a change on disk by both. */
  agent: string;
}

/** How typing helps (Preferences, Editor). */
export interface EditorTyping {
  /** The browser's spell check underlines. */
  spellCheck: boolean;
  /** Curly quotes, and an em dash for two hyphens, except in code and in Raw. */
  smartPunctuation: boolean;
  /** Closing brackets and backticks as you type them, except in code and in Raw. */
  closePairs: boolean;
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
   * from their defaults: the view the ledger says (`view: clean` or `view: redlines`, format
   * §5.6) or else the markup view when the document has redlines and Clean when it has none, and
   * tracking on when the file asks for it (`tracking: everyone`).
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
   * from the new string. It is for changes on disk; an agent's edit is `applyAgentEdit`. The view
   * stays, even when the document loses its last redline, except that a document that gains
   * redlines while shown Clean switches to Redlines.
   */
  reloadDoc(doc: string): void;
  /**
   * Brings in an agent's edit: the whole new text of the file, which the agent's tool worked out
   * from `getDoc()`. As a reload, only the lines that differ are replaced, and the selection and the
   * scroll stay where the text stayed; unlike one, it is a step to undo, joined to the newest step
   * when that is `step.group`'s, and Track Changes leaves it as it is. `getDoc()` is then `next`
   * byte for byte; Undo gives back the text before, byte for byte, and Redo `next`.
   */
  applyAgentEdit(next: string, step: AgentStep): void;
  /**
   * The parse of the document as CodeMirror holds it, with LF line breaks, so its offsets are
   * CodeMirror positions. Its `text` matches `getDoc()` only when all the file's line breaks
   * are LF.
   */
  getParsed(): Parsed;
  getUiState(): EditorUiState;
  /** Shows a view. Choosing Simple or Redlines also makes it the markup view. */
  setViewMode(mode: ViewMode): void;
  /**
   * Changes the markup view that an automatic switch shows, such as when the person chose another
   * in another window. It never changes the view that is shown: only a choice made here does.
   */
  setMarkupView(mode: MarkupView): void;
  /**
   * Turns Track Changes on or off (design §5.4). While it is on, what you type, delete, paste or
   * drop becomes tracked changes by `author`, with the markers and ledger entries the format
   * writes (format §3.6); a tracked change made in Clean switches the view to Redlines, and Raw is
   * read-only, where an edit says why through `onNotice`. While it is off, an edit is an edit of
   * the text itself (format §3.10): what you type joins no pending change, and what you delete is
   * gone, with the marks that have no text left; an edit with no legal form says why through
   * `onNotice`. On or off, outside Raw, Backspace and Delete never delete a marker.
   *
   * With `saveTracking`, the switch is written to the document (format §5.6): the ledger gains or
   * loses `tracking: everyone`, in a step of its own that Undo takes back with Track Changes
   * itself, and `onChange` hears of it. A file that can't take a ledger refuses it, says why
   * through `onNotice`, and stays as it was.
   *
   * `options.inFile` says whether this switch is written to the document: by default as the
   * `saveTracking` option says, and `false` keeps it to this editor, for a Track Changes that is a
   * person's own preference and not the file's (new documents that start tracked).
   *
   * @returns false when the file refused, and Track Changes is as it was.
   */
  setTracking(on: boolean, options?: { inFile?: boolean }): boolean;
  /**
   * Writes the view the document is in to its ledger, as `view: clean` or `view: redlines` (format
   * §5.6): for the host to call when it saves the file, so that the document opens in it. Simple
   * is written as Redlines, and Raw leaves the view the file had. A view alone is no reason for a
   * ledger, so a file with none gets none, and a ledger that can't be read is left as it is. It is
   * no step of its own: it joins the newest step, which Undo then takes back with it, and steps to
   * redo, which that drops, are gone. With every step taken back there is none to join, and it waits
   * for the next save. It is made in no empty paragraph's place, so a save never loses a blank line.
   * Switching views never calls it: only a save does.
   */
  recordView(): void;
  /** Changes how typing helps, in this document and the ones opened later. */
  setTyping(typing: EditorTyping): void;
  /**
   * Shows or hides the marks of line breaks (see `EditorOptions.showLineBreakMarks`), at once, in
   * this document and the ones opened later.
   */
  setShowLineBreakMarks(show: boolean): void;
  /** Changes who makes the edits from now on, such as when the name in Preferences changes. */
  setAuthor(author: Author): void;
  /** Hands the editor a new record of the people met (see `EditorOptions.people`). */
  setPeople(people: readonly MetPerson[]): void;
  /**
   * Accepts a pending change by its mark id, in one step that Undo takes back. Given several ids,
   * such as the marks of one suggestion, it accepts them all in that one step, or none.
   *
   * @throws EditError when there is no such change, when it is a comment, or when v0.1 doesn't
   *   decide its kind.
   */
  accept(id: string | readonly string[]): void;
  /** Rejects a pending change by its mark id, as `accept` does. */
  reject(id: string | readonly string[]): void;
  /**
   * Adds CodeMirror extensions after the editor was made, as a plugin such as @redlines/review
   * does. Like the extensions given in `EditorOptions`, they stay when another document is opened
   * (`setDoc`), with fresh state; extensions appended by a transaction belong to the document's
   * state and don't. Returns a function that takes them out again.
   */
  addExtension(extension: Extension): () => void;
  /**
   * Shows a line of the file, counted from 1, with the caret at its start, as a citation of it asks.
   * A line past either end of the document is that end. Nothing in the file changes.
   */
  scrollToLine(line: number): void;
  /**
   * Pastes `text`, the clipboard's plain text, at the selection, as Paste as Plain Text does: it
   * goes in through the same path as ⌘V, so it is the paster's own text in every view (see copy
   * and paste, design §5.10), and an insertion while Track Changes is on. The host reads the
   * clipboard, for which a page has no way that works from a menu.
   */
  pastePlain(text: string): void;
  /**
   * The word at a position of the document, as the host's spell checker is asked about it: letters
   * with an apostrophe inside, read from the text the page shows (a hidden marker inside the word
   * doesn't part it), with `before`, the block's text up to it. Null between words, for a word with
   * a digit in it, and where the Mac doesn't spell check: in code, a URL, front matter and Raw. The
   * formatting palette asks it for the word under a right-click.
   */
  wordAt(pos: number): { from: number; to: number; word: string; before: string } | null;
  /**
   * Makes a spelling suggestion the person picked: the text of `at`, which must read `replaced`, is
   * made `text`, as the Mac's own corrections are made (design §5.1): as typing, in a step of its
   * own that Undo takes back, with the caret after it. With Track Changes on, a word of the
   * person's own pending insertion changes the insertion's text, and other text becomes a tracked
   * change of the part that differs. Returns false, changing nothing, where the page shows other
   * text than `replaced`.
   */
  pickCorrection(at: Range, replaced: string, text: string): boolean;
  /**
   * Undo, as ⌘Z does it: the newest step of the history is taken back, and when there is none the
   * reason is said through `onNotice` (Raw read-only, or the history started over by a reload), or
   * else `onNothingToUndo` is called. Returns whether it did or said something.
   */
  undo(): boolean;
  /** Redo, likewise. */
  redo(): boolean;
  /** Draws the images again, for a host whose `resolveImage` would answer differently now. */
  refreshImages(): void;
  focus(): void;
  /** Removes the editor from the page. */
  destroy(): void;
}
