// The open document: which file it is, whether it has unsaved edits, and what happens when the file
// changes on disk while it is open (for example when Claude edits it from the command line).
//
// Two texts are kept apart: the base, which the editor last synced with the file (by opening,
// reloading or saving it), and the disk, the file's text when last seen. Unsaved edits are changes
// from the base. Neither side is ever overwritten without asking: a change on disk reloads the
// document only when it has no unsaved edits, and Save looks at the disk again before writing.

import type { Editor } from '@redlines/editor';
import { basename, NotUtf8Error, type Host } from './host.ts';

export interface DocumentState {
  /** The file, or null for a document that was never saved. */
  path: string | null;
  name: string;
  /** The editor's text differs from the base: there are unsaved edits. */
  dirty: boolean;
  /** A message for the person, such as a conflict with the file on disk. */
  notice: string | null;
}

export const CHANGED_ON_DISK = 'This file changed on disk. Your unsaved edits are kept.';
export const DELETED_ON_DISK = 'This file was moved or deleted. Save to keep it.';
export const NOT_WATCHED =
  'Redlines can’t watch this file for changes. Reopen it to see changes made elsewhere.';
const CHANGED_NOT_UTF8 = 'This file changed on disk and is no longer UTF-8 text.';
const UNTITLED = 'Untitled';

/** What reading the file found: its text, no file, or bytes that aren't UTF-8. */
const GONE = Symbol('gone');
const NOT_UTF8 = Symbol('not UTF-8');
type DiskRead = string | typeof GONE | typeof NOT_UTF8;

export class DocumentController {
  readonly #host: Host;
  readonly #editor: Pick<Editor, 'getDoc' | 'setDoc'>;
  readonly #onState: (state: DocumentState) => void;
  #state: DocumentState = { path: null, name: UNTITLED, dirty: false, notice: null };
  /** The text the editor last synced with the file. */
  #base = '';
  /** The file's text when last read or written, or null when it is gone or unreadable. */
  #disk: string | null = '';
  #unwatch: (() => void) | null = null;

  constructor(
    host: Host,
    editor: Pick<Editor, 'getDoc' | 'setDoc'>,
    onState: (state: DocumentState) => void,
  ) {
    this.#host = host;
    this.#editor = editor;
    this.#onState = onState;
  }

  get state(): DocumentState {
    return this.#state;
  }

  /** Opens a file in place of the current document, after asking about unsaved edits. */
  async open(path: string): Promise<void> {
    if (!(await this.confirmDiscard())) return;
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

  async openWithDialog(): Promise<void> {
    if (!(await this.confirmDiscard())) return;
    const before = this.#editor.getDoc();
    let file: { path: string; text: string } | null;
    try {
      file = await this.#host.open();
    } catch (error) {
      this.#failToOpen('the file', error);
      return;
    }
    if (file && (await this.#stillReplaceable(before))) this.#load(file.path, file.text);
  }

  /** Starts an empty, untitled document. */
  async create(): Promise<void> {
    if (await this.confirmDiscard()) this.#load(null, '');
  }

  /**
   * Saves the unsaved edits, or asks where when there is no file yet. When the file changed on
   * disk since the editor last synced with it, asks first whether to overwrite it. Resolves to
   * whether the edits are saved.
   */
  async save(): Promise<boolean> {
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
      this.#fail(`Couldn’t save ${this.#state.name}.`, error);
      return false;
    }
    if (path === null) return false;
    const moved = path !== this.#state.path;
    this.#saved(path, text);
    if (moved) this.#watch(path);
    return true;
  }

  /**
   * Called after every edit with the editor's text. Edits that bring back the base leave the
   * document clean.
   */
  markEdited(text: string = this.#editor.getDoc()): void {
    const dirty = text !== this.#base;
    if (dirty !== this.#state.dirty) this.#update({ dirty });
  }

  /**
   * Called when the file changes on disk. Without unsaved edits the document reloads; with them,
   * the edits stay in the editor, the file stays as it is, and a notice says so.
   */
  async externalChange(): Promise<void> {
    const path = this.#state.path;
    if (path === null) return;
    const text = await this.#read(path);
    if (path !== this.#state.path) return;
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
      this.#editor.setDoc(text);
      this.#update({ dirty: false, notice: null });
    } else {
      // A file changed back to the base is no conflict.
      this.#update({ notice: text === this.#base ? null : CHANGED_ON_DISK });
    }
  }

  dismissNotice(): void {
    if (this.#state.notice !== null) this.#update({ notice: null });
  }

  /**
   * Before unsaved edits would be lost, asks whether to save them. Resolves to whether to go on:
   * false when the person cancels or the save doesn't happen.
   */
  async confirmDiscard(): Promise<boolean> {
    if (!this.#state.dirty) return true;
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
    // Set first: replacing the editor's text may report an edit, which compares against it.
    this.#base = text;
    this.#disk = text;
    this.#editor.setDoc(text);
    this.#state = {
      path,
      name: path === null ? UNTITLED : basename(path),
      dirty: false,
      notice: null,
    };
    this.#onState(this.#state);
    this.#watch(path);
  }

  #saved(path: string, text: string): void {
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
    this.#fail(error instanceof NotUtf8Error ? error.message : `Couldn’t open ${name}.`, error);
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
