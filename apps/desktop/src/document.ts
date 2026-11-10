// The open document: which file it is, whether it has unsaved edits, and what happens when the file
// changes on disk while it is open (for example when Claude edits it from the command line).
//
// Two texts are kept apart: the base, which the editor last synced with the file (by opening,
// reloading or saving it), and the disk, the file's text when last seen. Unsaved edits are changes
// from the base. Neither side is ever overwritten without asking: a change on disk reloads the
// document only when it has no unsaved edits, and Save looks at the disk again before writing.
//
// An agent's edits in a run arrive here too (`applyAgentEdit`): they show at once as steps to undo,
// and while there are no unsaved edits each is written to the file as it lands, so the file holds
// what the screen shows (design: Where the tools run, Saving).
//
// A change on disk that is nothing but the work of the author's agents, such as Claude for Ada
// writing with the `redlines` command line in a terminal, is a step too, which Undo takes back
// (`agentWorkOf`). Any other change on disk is a reload, which starts the history over.

import type { AgentStep, Editor } from '@redlines/editor';
import { agentWorkOf, type Handle } from '@redlines/format';
import {
  basename,
  dirname,
  FileExistsError,
  isDocument,
  NOT_A_DOCUMENT,
  NotADocumentError,
  NotUtf8Error,
  type Host,
} from './host.ts';

export interface DocumentState {
  /** The file, or null for a document that was never saved. */
  path: string | null;
  name: string;
  /** The editor's text differs from the base: there are unsaved edits. */
  dirty: boolean;
  /** A message for the person, such as a conflict with the file on disk. */
  notice: string | null;
  /**
   * An agent's edits are being written to the file: nothing is unsaved, but it isn't on disk yet,
   * so quitting must wait for it.
   */
  writing: boolean;
}

export const CHANGED_ON_DISK = 'This file changed on disk. Your unsaved edits are kept.';
export const DELETED_ON_DISK = 'This file was moved or deleted. Save to keep it.';
export const NOT_WATCHED =
  'Redlines can’t watch this file for changes. Reopen it to see changes made elsewhere.';
/**
 * Shown once when a file that asks everyone to track changes (`tracking: everyone`, format §5.6)
 * opens, for the editor starts it with Track Changes on (design §5.4). Anyone can still turn
 * tracking off, and the notice makes that a deliberate choice.
 */
export const TRACKING_FOR_EVERYONE =
  'Track Changes is on, because this file asks everyone to track their changes.';
const CHANGED_NOT_UTF8 = 'This file changed on disk and is no longer UTF-8 text.';
const UNTITLED = 'Untitled';

/** What the controller needs of the editor. */
type DocumentEditor = Pick<
  Editor,
  'getDoc' | 'getParsed' | 'setDoc' | 'reloadDoc' | 'applyAgentEdit'
>;

export interface DocumentOptions {
  /**
   * Whether an agent's run is live in this window. Its tools act on this document, so nothing may
   * replace it meanwhile: a file to open goes to a new window, as for a window in use.
   */
  isRunLive?: () => boolean;
  /**
   * Whether a comment or a reply is being written in the editor, with text in its box. Another
   * document would drop it, so opening one asks first, and a file opens in a new window instead
   * of here when the window is otherwise untouched.
   */
  hasDraft?: () => boolean;
  /**
   * Another document is about to be set in the editor, which draws it at once: the path it will
   * have (null for one not saved), before the state that says so.
   */
  onLoading?: (path: string | null) => void;
  /**
   * The handle this window writes as: a change on disk that is its agents' work alone is a step.
   * Without it, none is.
   */
  author?: () => Handle;
}

/** What reading the file found: its text, no file, or bytes that aren't UTF-8. */
const GONE = Symbol('gone');
const NOT_UTF8 = Symbol('not UTF-8');
type DiskRead = string | typeof GONE | typeof NOT_UTF8;

export class DocumentController {
  readonly #host: Host;
  readonly #editor: DocumentEditor;
  readonly #onState: (state: DocumentState) => void;
  #state: DocumentState = {
    path: null,
    name: UNTITLED,
    dirty: false,
    notice: null,
    writing: false,
  };
  /** The text the editor last synced with the file. */
  #base = '';
  /** The file's text when last read or written, or null when it is gone or unreadable. */
  #disk: string | null = '';
  #unwatch: (() => void) | null = null;
  /** The question about unsaved edits, while it is up. */
  #question: Promise<boolean> | null = null;
  #savedAt: Date | null = null;
  readonly #isRunLive: () => boolean;
  readonly #hasDraft: () => boolean;
  readonly #onLoading: (path: string | null) => void;
  readonly #author: (() => Handle) | null;
  /** Counts the document's changes on disk that became steps, for each its own group. */
  #diskSteps = 0;
  /** Counts the documents this window has held: a new one each time another replaces it. */
  #generation = 0;
  /** Agent edits being written to the file, one after another. */
  #agentWrites: Promise<void> = Promise.resolve();
  /** How many agent edits are waiting to be written, or being written. */
  #agentPending = 0;

  constructor(
    host: Host,
    editor: DocumentEditor,
    onState: (state: DocumentState) => void,
    options: DocumentOptions = {},
  ) {
    this.#host = host;
    this.#editor = editor;
    this.#onState = onState;
    this.#isRunLive = options.isRunLive ?? (() => false);
    this.#hasDraft = options.hasDraft ?? (() => false);
    this.#onLoading = options.onLoading ?? (() => {});
    this.#author = options.author ?? null;
  }

  /**
   * Bumped whenever another document replaces this one (opening, New), and not when the same one
   * reloads or is saved: a run started in one document can tell it is no longer there.
   */
  get generation(): number {
    return this.#generation;
  }

  /** When the document was last written to a file, in this window; null if it hasn't been. */
  get savedAt(): Date | null {
    return this.#savedAt;
  }

  get state(): DocumentState {
    return this.#state;
  }

  /**
   * The window holds nothing yet: an empty document that was never saved, for a file to take. Not
   * while a run is live, whose document must stay, or while a comment is being written, which
   * stays with its document.
   */
  get untouched(): boolean {
    return (
      this.#state.path === null && !this.#state.dirty && !this.#isRunLive() && !this.#hasDraft()
    );
  }

  /**
   * Opens a file in place of the current document, after asking about unsaved edits. A file that
   * isn't a document opens nothing, and says so: nothing is asked of the document that is open.
   */
  async open(path: string): Promise<void> {
    if (!isDocument(path)) return this.#fail(NOT_A_DOCUMENT, path);
    if (!(await this.#confirmReplace())) return;
    const before = this.#editor.getDoc();
    let text: string;
    try {
      text = await this.#host.read(path);
    } catch (error) {
      this.#failToOpen(basename(path), error);
      return;
    }
    if (await this.#stillReplaceable(before)) this.#load(path, text);
  }

  /**
   * Says in a notice that the file at `path` can't be opened, such as one that the app was asked
   * to open but the window may not use; for a file that isn't a document, that Redlines doesn't
   * open it, as the app says too for a folder named like one. Any other reason, which is
   * technical, goes to the console.
   */
  couldNotOpen(path: string, reason: unknown): void {
    if (isDocument(path) && reason !== NOT_A_DOCUMENT) this.#failToOpen(basename(path), reason);
    else this.#fail(NOT_A_DOCUMENT, reason);
  }

  /**
   * Asks for a file and opens it: here while this window is untouched, and otherwise in a new
   * window, for there is one document per window. It looks after the dialog, so what was typed
   * meanwhile stays.
   */
  async openWithDialog(): Promise<void> {
    let file: { path: string; text: string } | null;
    try {
      file = await this.#host.open();
    } catch (error) {
      this.#failToOpen('the file', error);
      return;
    }
    if (!file) return;
    // The panel lets through any file of a type that conforms to plain text's, which the host
    // refuses before reading it; the same for a host that reads it anyway.
    if (!isDocument(file.path)) return this.#fail(NOT_A_DOCUMENT, file.path);
    if (this.untouched) {
      this.#load(file.path, file.text);
      return;
    }
    await this.#host.openWindow(file.path).catch((error: unknown) => {
      this.#failToOpen(basename(file.path), error);
    });
  }

  /** Starts an empty, untitled document. */
  async create(): Promise<void> {
    if (await this.#confirmReplace()) this.#load(null, '');
  }

  /**
   * Saves the unsaved edits, or asks where when there is no file yet. When the file changed on
   * disk since the editor last synced with it, asks first whether to overwrite it. Resolves to
   * whether the edits are saved.
   */
  async save(): Promise<boolean> {
    // An agent's edit being written changes the file this compares with.
    await this.#agentWrites;
    const path = this.#state.path;
    if (path === null) return this.saveAs();
    // Nothing to write, unless the file is gone: then Save puts it back.
    if (!this.#state.dirty && this.#disk !== null) return true;
    // The watcher may not have reported a change yet, or ever: look at the disk now.
    const current = await this.#read(path);
    if (current !== GONE && current !== this.#base) {
      const choice = await this.#host.askToOverwrite(this.#state.name);
      if (choice === 'cancel') return false;
      if (choice === 'saveAs') return this.saveAs();
    }
    const text = this.#editor.getDoc();
    try {
      await this.#host.write(path, text);
    } catch (error) {
      this.#fail(`Couldn’t save ${this.#state.name}.`, error);
      return false;
    }
    this.#saved(path, text);
    return true;
  }

  /** Asks where to save, then saves there. Resolves to whether it saved. */
  async saveAs(): Promise<boolean> {
    const text = this.#editor.getDoc();
    let path: string | null;
    try {
      path = await this.#host.saveAs(text, this.#state.path ?? `${this.#state.name}.md`);
    } catch (error) {
      // A name that isn't a document's says so, and nothing was written.
      const why =
        error instanceof NotADocumentError ? error.message : `Couldn’t save ${this.#state.name}.`;
      this.#fail(why, error);
      return false;
    }
    if (path === null) return false;
    const moved = path !== this.#state.path;
    this.#saved(path, text);
    if (moved) this.#watch(path);
    return true;
  }

  /**
   * Gives the file another name in its folder. The edits, the undo history and the watch stay with
   * the document. A document with no file has no name to change, so Save As asks for one. Resolves
   * to whether the document now has the name (also when it already did); a notice says why not.
   */
  async rename(newName: string): Promise<boolean> {
    const path = this.#state.path;
    if (path === null) return this.saveAs();
    const typed = newName.trim();
    if (typed === '') return false;
    if (!isFileName(typed)) {
      this.#update({ notice: `“${typed}” isn’t a name a file can have.` });
      return false;
    }
    const wanted = withExtension(typed, this.#state.name);
    if (wanted === this.#state.name) return true;
    const folder = dirname(path);
    const target = `${folder}${folder.endsWith('/') ? '' : '/'}${wanted}`;
    try {
      await this.#host.rename(path, target);
    } catch (error) {
      if (error instanceof FileExistsError) {
        this.#update({ notice: `There is already a file called ${wanted}.` });
      } else {
        this.#fail(`Couldn’t rename ${this.#state.name}.`, error);
      }
      return false;
    }
    // Another file may have been opened while the file was renamed.
    if (this.#state.path !== path) return true;
    this.#update({ path: target, name: wanted });
    this.#watch(target);
    return true;
  }

  /**
   * Called after every edit with the editor's text. Edits that bring back the base leave the
   * document clean. When the file changed on disk while there were edits, and they are undone,
   * no edits are left to keep: the file as it is now becomes the text, as it does for a document
   * without edits, and the notice that spoke of the edits goes.
   */
  markEdited(text: string = this.#editor.getDoc()): void {
    const dirty = text !== this.#base;
    const disk = this.#disk;
    // While an agent's edits are being written, the disk is behind the base on purpose.
    if (!dirty && disk !== null && disk !== this.#base && this.#agentPending === 0) {
      this.#base = disk;
      this.#takeFromDisk(disk);
      this.#update({ dirty: false, notice: null });
      return;
    }
    if (dirty !== this.#state.dirty) this.#update({ dirty });
  }

  /**
   * Called when the file changes on disk. Without unsaved edits the document reloads; with them,
   * the edits stay in the editor, the file stays as it is, and a notice says so.
   */
  async externalChange(): Promise<void> {
    // The change may be an agent's edit landing while a later one is already on screen: look once
    // they are all on disk, when the echo of one is known for what it is.
    if (this.#agentPending > 0) await this.#agentEditsWritten();
    const path = this.#state.path;
    if (path === null) return;
    const text = await this.#read(path);
    if (path === this.#state.path) this.#sawOnDisk(text);
  }

  /** What the document does about what its file was just found to hold. */
  #sawOnDisk(text: DiskRead): void {
    if (text === GONE || text === NOT_UTF8) {
      // The document stays as it is, with or without edits, and Save writes it back.
      this.#disk = null;
      this.#update({ notice: text === GONE ? DELETED_ON_DISK : CHANGED_NOT_UTF8 });
      return;
    }
    // The echo of our own save, or nothing new.
    if (text === this.#disk) return;
    this.#disk = text;
    if (text === this.#editor.getDoc()) {
      // The file now holds what the editor shows, such as a deleted file put back.
      this.#base = text;
      this.#update({ dirty: false, notice: null });
    } else if (!this.#state.dirty) {
      this.#base = text;
      this.#takeFromDisk(text);
      this.#update({ dirty: false, notice: null });
    } else {
      // A file changed back to the base is no conflict.
      this.#update({ notice: text === this.#base ? null : CHANGED_ON_DISK });
    }
  }

  /**
   * Shows the file's `text` in place of the editor's, which has no unsaved edits. When the change
   * is nothing but the work of the author's agents, it is a step of theirs, one per change on disk,
   * which Undo takes back; any other change is a reload, which starts the history over. Asked once
   * per change on disk, never per keystroke.
   */
  #takeFromDisk(text: string): void {
    const work = this.#agentWorkOn(text);
    if (work) {
      this.#diskSteps++;
      try {
        this.#editor.applyAgentEdit(text, { group: `disk-${this.#diskSteps}`, agent: work.agent });
        return;
      } catch (error) {
        // The editor must show the file it now counts as saved: a reload, as for any change.
        console.error('Could not take the change on disk as a step', error);
      }
    }
    this.#editor.reloadDoc(text);
  }

  /** Whose work alone turns the editor's text into `text`: the author's agents', or null. */
  #agentWorkOn(text: string): { agent: string } | null {
    if (!this.#author) return null;
    try {
      return agentWorkOf(this.#editor.getDoc(), text, this.#author());
    } catch (error) {
      // A change that can't be told apart is a change from outside, as before.
      console.error('Could not tell whose change on disk this is', error);
      return null;
    }
  }

  /**
   * An agent's edit in a run: the whole new text, from the text the editor has now. It shows at
   * once, keeping the caret and the scroll, as a step of `step`'s that Undo takes back. While
   * the document has a file and no unsaved edits, it is also written to the file, and the document
   * stays clean; otherwise it joins the unsaved edits, and Save writes both. Edits are written in
   * the order they came, and never over a file that changed elsewhere meanwhile, which instead
   * leaves them unsaved, with the notice that says so. Resolves once it is written, or isn't to be.
   */
  applyAgentEdit(next: string, step: AgentStep): Promise<void> {
    const path = this.#state.path;
    if (path === null || this.#state.dirty || this.#disk === null) {
      this.#editor.applyAgentEdit(next, step);
      return Promise.resolve();
    }
    // Set first: the edit reports an edit, which compares against it, and must find a write
    // pending.
    const before = this.#base;
    this.#base = next;
    this.#pending(1);
    try {
      this.#editor.applyAgentEdit(next, step);
    } catch (error) {
      // Nothing changed, and nothing is to be written.
      this.#base = before;
      this.#pending(-1);
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
    const written = this.#agentWrites.then(() => this.#writeAgentEdit(path, next));
    // A write that went wrong doesn't hold up the next, or Save.
    this.#agentWrites = written.catch(() => {});
    return written;
  }

  async #writeAgentEdit(path: string, next: string): Promise<void> {
    try {
      // A later agent edit, a save or another document came since: this text isn't the one to
      // write, or is written already.
      const current = () => this.#state.path === path && this.#base === next;
      if (!current()) return;
      const disk = await this.#read(path);
      if (!current()) return;
      if (disk !== this.#disk) {
        // Changed elsewhere, and the watcher hasn't said so yet: the edits stay, unsaved.
        if (this.#disk !== null) this.#base = this.#disk;
        this.#update({ dirty: this.#editor.getDoc() !== this.#base });
        this.#sawOnDisk(disk);
        return;
      }
      await this.#host.write(path, next);
      this.#disk = next;
      this.#savedAt = new Date();
      this.#update({ dirty: this.#editor.getDoc() !== this.#base });
    } catch (error) {
      if (this.#state.path === path && this.#disk !== null) this.#base = this.#disk;
      this.#fail(`Couldn’t save ${this.#state.name}.`, error);
      this.#update({ dirty: this.#editor.getDoc() !== this.#base });
    } finally {
      this.#pending(-1);
    }
  }

  /** Counts an agent edit waiting to be written, or one that no longer is, and says when it's busy. */
  #pending(by: 1 | -1): void {
    this.#agentPending += by;
    const writing = this.#agentPending > 0;
    if (writing !== this.#state.writing) this.#update({ writing });
  }

  /** Resolves once no agent edit is waiting to be written or being written, also ones that came
   * meanwhile. */
  async #agentEditsWritten(): Promise<void> {
    while (this.#agentPending > 0) await this.#agentWrites;
  }

  /** Dismisses the notice, or only the one that says `only`, so that another one stays. */
  dismissNotice(only?: string): void {
    const { notice } = this.#state;
    if (notice !== null && (only === undefined || notice === only)) this.#update({ notice: null });
  }

  /**
   * Before another document replaces this one: asks about unsaved edits, then about a comment being
   * written, which the new document would drop with the editor's state. Resolves to whether to go
   * on. The question about a comment is the host's, and its answer is for this one drop only.
   */
  async #confirmReplace(): Promise<boolean> {
    if (!(await this.confirmDiscard())) return false;
    return !this.#hasDraft() || this.#host.askToDiscardDraft();
  }

  /**
   * Before unsaved edits would be lost, asks whether to save them. Resolves to whether to go on:
   * false when the person cancels or the save doesn't happen. There is one question at a time, and
   * all who ask while it is up share its answer: the app quitting while the close button's question
   * is up doesn't stack a second, which closing the window would leave unanswered.
   */
  async confirmDiscard(): Promise<boolean> {
    // An agent's edit being written looks saved already: it is only once it is on disk.
    if (this.#agentPending > 0) await this.#agentEditsWritten();
    if (!this.#state.dirty) return true;
    this.#question ??= this.#askAboutEdits().finally(() => {
      this.#question = null;
    });
    return this.#question;
  }

  /**
   * Before the app quits: waits for agent edits being written, and if unsaved edits are left, brings
   * the window forward with `toFront` and asks about them. Resolves to whether to go on. A window
   * writing an agent's edits reports itself busy (`writing`), so quitting asks it this.
   */
  async confirmQuit(toFront: () => Promise<void>): Promise<boolean> {
    if (this.#agentPending > 0) await this.#agentEditsWritten();
    if (!this.#state.dirty) return true;
    try {
      await toFront();
    } catch (error) {
      // The question is what matters, and it shows on the window wherever that is.
      console.warn('Could not bring the window to the front', error);
    }
    return this.confirmDiscard();
  }

  async #askAboutEdits(): Promise<boolean> {
    const choice = await this.#host.askToSave(this.#state.name);
    if (choice === 'save') return this.save();
    return choice === 'discard';
  }

  /** Stops watching the file. */
  dispose(): void {
    this.#unwatch?.();
    this.#unwatch = null;
  }

  /**
   * After a slow read, checks that nothing was typed meanwhile, or asks about it; text typed
   * during the read is never replaced unseen.
   */
  async #stillReplaceable(before: string): Promise<boolean> {
    return this.#editor.getDoc() === before || this.confirmDiscard();
  }

  async #read(path: string): Promise<DiskRead> {
    try {
      return await this.#host.read(path);
    } catch (error) {
      return error instanceof NotUtf8Error ? NOT_UTF8 : GONE;
    }
  }

  #load(path: string | null, text: string): void {
    this.#generation++;
    this.#diskSteps = 0;
    // Set first: replacing the editor's text may report an edit, which compares against it.
    this.#base = text;
    this.#disk = text;
    this.#savedAt = null;
    this.#onLoading(path);
    this.#editor.setDoc(text);
    const everyone = this.#editor.getParsed().ledger.tracking === 'everyone';
    this.#state = {
      path,
      name: path === null ? UNTITLED : basename(path),
      dirty: false,
      notice: everyone ? TRACKING_FOR_EVERYONE : null,
      writing: this.#agentPending > 0,
    };
    this.#onState(this.#state);
    this.#watch(path);
  }

  #saved(path: string, text: string): void {
    this.#savedAt = new Date();
    this.#base = text;
    this.#disk = text;
    this.#update({
      path,
      name: basename(path),
      // Typing may have gone on while the file was written.
      dirty: this.#editor.getDoc() !== text,
      notice: null,
    });
  }

  #watch(path: string | null): void {
    this.dispose();
    if (path === null) return;
    this.#host
      .watch(path, () => void this.externalChange())
      .then(
        (unwatch) => {
          // Another file may have been opened while the watcher started.
          if (this.#state.path === path && this.#unwatch === null) this.#unwatch = unwatch;
          else unwatch();
        },
        (error: unknown) => {
          console.error(NOT_WATCHED, error);
          if (this.#state.path === path) this.#update({ notice: NOT_WATCHED });
        },
      );
  }

  #failToOpen(name: string, error: unknown): void {
    const said = error instanceof NotUtf8Error || error instanceof NotADocumentError;
    this.#fail(said ? error.message : `Couldn’t open ${name}.`, error);
  }

  /** Says in a notice what didn't work; the details, often technical, go to the console. */
  #fail(message: string, error: unknown): void {
    console.error(message, error);
    this.#update({ notice: message });
  }

  #update(change: Partial<DocumentState>): void {
    this.#state = { ...this.#state, ...change };
    this.#onState(this.#state);
  }
}

/**
 * `name` as typed, which stays a document's name: as it is when it ends in a document's extension,
 * and otherwise with the extension of `current` after the words typed, so that for `plan.md`
 * `notes` is `notes.md` and `notes.ts` is `notes.ts.md`, and for `notes.txt` `v1.2 notes` is
 * `v1.2 notes.txt`.
 */
function withExtension(name: string, current: string): string {
  const dot = current.lastIndexOf('.');
  return isDocument(name) || dot <= 0 ? name : name + current.slice(dot);
}

function isFileName(name: string): boolean {
  return name !== '.' && name !== '..' && !/[/\\\0]/.test(name);
}
