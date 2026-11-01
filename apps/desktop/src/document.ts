// The open document: which file it is, whether it has unsaved edits, and what happens when the file
// changes on disk while it is open (for example when Claude edits it from the command line).

import type { Editor } from '@redlines/editor';
import { basename, type Host } from './host.ts';

export interface DocumentState {
  /** The file, or null for a document that was never saved. */
  path: string | null;
  name: string;
  /** The editor's text differs from the file's. */
  dirty: boolean;
  /** A message for the person, such as a conflict with the file on disk. */
  notice: string | null;
}

export const CHANGED_ON_DISK = 'This file changed on disk. Your unsaved edits are kept.';
const DELETED_ON_DISK = 'This file was moved or deleted. Save to keep it.';
const UNTITLED = 'Untitled';

export class DocumentController {
  readonly #host: Host;
  readonly #editor: Pick<Editor, 'getDoc' | 'setDoc'>;
  readonly #onState: (state: DocumentState) => void;
  #state: DocumentState = { path: null, name: UNTITLED, dirty: false, notice: null };
  /** The file's text as last read or written, or null when the file is gone. */
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
    let text: string;
    try {
      text = await this.#host.read(path);
    } catch (error) {
      this.#fail(`Couldn’t open ${basename(path)}.`, error);
      return;
    }
    this.#load(path, text);
  }

  async openWithDialog(): Promise<void> {
    if (!(await this.confirmDiscard())) return;
    try {
      const file = await this.#host.open();
      if (file) this.#load(file.path, file.text);
    } catch (error) {
      this.#fail('Couldn’t open the file.', error);
    }
  }

  /** Starts an empty, untitled document. */
  async create(): Promise<void> {
    if (await this.confirmDiscard()) this.#load(null, '');
  }

  /** Saves to the file, or asks where when there is none. Resolves to whether it saved. */
  async save(): Promise<boolean> {
    const path = this.#state.path;
    if (path === null) return this.saveAs();
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

  /** Called after every edit. Edits that bring back the file's text leave the document clean. */
  markEdited(): void {
    const dirty = this.#editor.getDoc() !== this.#disk;
    if (dirty !== this.#state.dirty) this.#update({ dirty });
  }

  /**
   * Called when the file changes on disk. Without unsaved edits the document reloads; with them,
   * the edits stay in the editor, the file stays as it is, and a notice says so.
   */
  async externalChange(): Promise<void> {
    const path = this.#state.path;
    if (path === null) return;
    let text: string;
    try {
      text = await this.#host.read(path);
    } catch {
      if (path !== this.#state.path) return;
      this.#disk = null;
      this.#update({ dirty: true, notice: DELETED_ON_DISK });
      return;
    }
    // The echo of our own save, or a change that came and went.
    if (path !== this.#state.path || text === this.#disk) return;
    this.#disk = text;
    if (text === this.#editor.getDoc()) {
      // The file now holds what the editor shows, such as a deleted file put back: no conflict.
      this.#update({ dirty: false, notice: null });
    } else if (this.#state.dirty) {
      this.#update({ notice: CHANGED_ON_DISK });
    } else {
      this.#editor.setDoc(text);
      this.#update({ dirty: false, notice: null });
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

  #load(path: string | null, text: string): void {
    // Set first: replacing the editor's text may report an edit, which compares against it.
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
        () => {
          // Without a watcher, changes on disk show up at the next open; nothing to tell anyone.
        },
      );
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
