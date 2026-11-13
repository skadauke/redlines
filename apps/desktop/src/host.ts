// What the app needs from the machine it runs on: who you are, and files. In the Tauri app that is
// the file system and the native dialogs; in a plain browser (`pnpm dev`) it is a small in-memory
// folder holding sample.md, so the interface can be worked on without the native shell.

import {
  Channel,
  convertFileSrc,
  invoke,
  type InvokeArgs,
  type InvokeOptions,
} from '@tauri-apps/api/core';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { readText } from '@tauri-apps/plugin-clipboard-manager';
import { message, open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { exists, readFile, writeTextFile } from '@tauri-apps/plugin-fs';
import type { Author } from '@redlines/editor';
import { deriveHandle } from './handle.ts';
import { appIdentity, BROWSER_IDENTITY } from './identity.ts';
import type { FileEntry, Host as PluginHost, ProjectRoot } from '@redlines/plugin-api';
import { createProcesses, createRelay } from './agent-host.ts';
import { extension, isDocument } from './file-names.ts';
import { savedImageName } from './image-add.ts';
import sample from './sample.md?raw';

export type { FileEntry, ProjectRoot };

/** The answer to "Do you want to save the changes you made?". */
export type SaveChoice = 'save' | 'discard' | 'cancel';

/** The answer to "This file changed on disk since you opened it" when saving. */
export type OverwriteChoice = 'overwrite' | 'saveAs' | 'cancel';

/**
 * The images to add to a document (#308): files the app was given, which a drop on the window or
 * its panel gave it and which it keeps for the window by an id, never by a path the page names; or
 * image files the page holds, from a paste, or from a drop in a browser tab.
 */
export type ImageSource =
  { kind: 'given'; id: number } | { kind: 'files'; files: File[]; pasted: boolean };

/**
 * What adding images did: the paths the document links them by, relative to it, in order, and a
 * sentence to show the person for each image that couldn't be added (src-tauri/src/image_files.rs).
 */
export interface AddedImages {
  paths: string[];
  refused: string[];
}

/**
 * Image files dropped on the window, which the app keeps under `id`: how many, and where they
 * landed, in points from the top left of the window's page.
 */
export interface DroppedImages {
  id: number;
  count: number;
  x: number;
  y: number;
}

/** What a window was opened for: a file, and a line in it, or neither. */
export interface WindowStart {
  path: string | null;
  line: number | null;
}

export interface Host {
  identity(): Promise<Author>;
  /** Asks for a file to open and reads it; null when the dialog is cancelled. */
  open(): Promise<{ path: string; text: string } | null>;
  /** Reads a file; rejects with NotUtf8Error when it isn't UTF-8. */
  read(path: string): Promise<string>;
  write(path: string, text: string): Promise<void>;
  /**
   * Renames a file within its folder, which keeps the window's permission to use it. Rejects with
   * FileExistsError rather than replace a file.
   */
  rename(from: string, to: string): Promise<void>;
  /** Whether a file is there; false also for one the app may not ask about. */
  exists(path: string): Promise<boolean>;
  /** Shows the file in Finder. */
  reveal(path: string): Promise<void>;
  /** Prints the window's page, as it is shown (the system's print dialog). */
  print(): Promise<void>;
  /**
   * Asks where to save, starting from a file name or a full path, and writes the file there. For a
   * name alone, `folder` is where the dialog starts, if it is still there; without it, or when it
   * is gone, the dialog starts where macOS has it. A full path starts in its own folder.
   */
  saveAs(text: string, suggestedName: string, folder?: string | null): Promise<string | null>;
  /**
   * Calls `onChange` after the file changes on disk; resolves to a function that stops watching. In
   * the app, only the window's document, a file it may use, which the app watches for it.
   */
  watch(path: string, onChange: () => void): Promise<() => void>;
  /**
   * The folder an agent may read for the document at `documentPath`, which the file sidebar shows:
   * its repository's root, or else its own folder.
   */
  projectRoot(documentPath: string): Promise<ProjectRoot>;
  /**
   * The entries of `folder`, which must be inside the project folder `root`, with hidden ones and
   * those that git ignores left out.
   */
  list(folder: string, root: string): Promise<FileEntry[]>;
  /**
   * Opens an image or a PDF inside the project folder `root` in Preview (in its default app off
   * the Mac); rejects with a line to show the person.
   */
  openDefault(path: string, root: string): Promise<void>;
  /**
   * Lets the window read and write a document that the sidebar of a project a window shows
   * lists: the window may use only the files the person opened or saved. Rejects with a line to
   * show the person.
   */
  allowDocument(path: string): Promise<void>;
  /**
   * Lets the page load the images in the project folder of the document at `path`, which the
   * window must hold: true once it may, false when it may not (and no image loads).
   */
  allowImages(path: string): Promise<boolean>;
  /** The URL the page loads the file at `path` from, once `allowImages` is true; null if none. */
  imageUrl(path: string): string | null;
  /**
   * Forgets the documents remembered for Open Recent, but those the windows hold: the next launch
   * doesn't let the windows use them again.
   */
  forgetDocuments(): Promise<void>;
  /** Asks whether to save unsaved edits to the named document before they would be lost. */
  askToSave(name: string): Promise<SaveChoice>;
  /**
   * Asks whether to drop the comment or reply being written, which another document would take
   * away. Resolves to true to drop it, false to keep it.
   */
  askToDiscardDraft(): Promise<boolean>;
  /** Asks what to do when saving would replace changes made to the file elsewhere. */
  askToOverwrite(name: string): Promise<OverwriteChoice>;
  /**
   * Asks whether to save a document that has no file yet before an image is added to it, which is
   * saved beside the document. Resolves to true for Save…, false for Cancel.
   */
  askToSaveForImage(): Promise<boolean>;
  /**
   * Shows the system's panel for image files, and resolves to what was chosen, to be added to a
   * document (`addImages`), or to null when the person cancels.
   */
  chooseImages(): Promise<ImageSource | null>;
  /**
   * Saves the images of `source` in `folder`, which is inside the folder of the document at
   * `document` ('' for the folder itself), the document being the window's own. A name that is
   * taken gets a number: nothing is ever replaced, and a file that is dropped or chosen is copied,
   * never moved. Rejects with a sentence to show the person.
   */
  addImages(document: string, folder: string, source: ImageSource): Promise<AddedImages>;
  /**
   * Calls `onDrop` with each drop of image files on this window, and resolves to a function that
   * stops it. In the app, a drop of image files and nothing else is the window's to add to its
   * document; any other drop opens files, as it always did. A browser tab hears nothing here: its
   * page gets the drop itself (`EditorOptions.onImageFiles`).
   */
  listenForImageDrops(onDrop: (drop: DroppedImages) => void): Promise<() => void>;
  /** Opens a new window: empty, or for the file at `path`, showing `line` (counted from 1). */
  openWindow(path?: string, line?: number): Promise<void>;
  /** What this window was opened for. */
  windowStart(): Promise<WindowStart>;
  /** The clipboard's plain text, or an empty string when it holds none. Rejects when unreadable. */
  readClipboardText(): Promise<string>;
  /**
   * Calls `onOpen` with each file the app gives this window, of those it was asked to open on its
   * command line or by the system (`open -a Redlines plan.md`): those given before it was called,
   * and those given later. It waits for each to open before the next. A file that the app was asked
   * to open but could not let the window use goes to `onRefused`, with the reason, after the others
   * have opened.
   */
  listenForFiles(
    onOpen: (path: string) => void | Promise<void>,
    onRefused: (path: string, reason: string) => void,
  ): Promise<void>;
}

/** A file the app was asked to open, as the Rust side hands it over (`opened_files`). */
interface OpenedFile {
  path: string;
  /** Why the window may not use the file; null when it may. */
  error: string | null;
}

/** A file that isn't UTF-8 text: opening it would change its bytes (format §9.2). */
export class NotUtf8Error extends Error {
  constructor() {
    super('This file isn’t UTF-8 text, so Redlines can’t open it without changing it.');
    this.name = 'NotUtf8Error';
  }
}

/** A rename that would have replaced a file. */
export class FileExistsError extends Error {
  constructor(path: string) {
    super(`${path} already exists`);
    this.name = 'FileExistsError';
  }
}

/**
 * What the window says of a file that isn't a document, which Redlines doesn't open, however it is
 * asked to (src-tauri/src/project.rs says the same).
 */
export const NOT_A_DOCUMENT = 'Redlines opens Markdown and text files.';

/** What the window says when Save As was given a name that isn't a document's. */
export const SAVES_DOCUMENTS_ONLY = 'Redlines saves Markdown and text files.';

/** A file that isn't a document (format §9.1), which Redlines neither reads nor writes. */
export class NotADocumentError extends Error {
  constructor(message = NOT_A_DOCUMENT) {
    super(message);
    this.name = 'NotADocumentError';
  }
}

// The kinds of file, by name, are a module of their own, which the settings can load alone.
export { DOCUMENT_EXTENSIONS, isDocument, opensInDefaultApp } from './file-names.ts';

export function basename(path: string): string {
  return path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
}

/** The folder holding `path`: the disk's root for a file there, and '' for a bare file name. */
export function dirname(path: string): string {
  const separator = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return path.slice(0, separator === 0 ? 1 : Math.max(separator, 0));
}

/** The path of the file `name` in `folder`, written with the separator the folder's path uses. */
export function joinPath(folder: string, name: string): string {
  const separator = folder.includes('\\') && !folder.includes('/') ? '\\' : '/';
  return `${folder.replace(/[\\/]+$/, '')}${separator}${name}`;
}

export { deriveHandle };

/**
 * Decodes a file's bytes as UTF-8 so that writing the text back gives the same bytes (format §9.2):
 * a byte order mark stays as U+FEFF, and bytes that aren't UTF-8 throw NotUtf8Error instead of
 * becoming U+FFFD.
 */
export function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { ignoreBOM: true, fatal: true }).decode(bytes);
  } catch {
    throw new NotUtf8Error();
  }
}

/**
 * The buttons of the question about a comment or reply that would be lost. The dialog makes the
 * first Return's and gives Escape to the button called Cancel, so the one that loses nothing comes
 * first and is called that; Discard is only ever a click.
 */
export const DISCARD_DRAFT_BUTTONS = { ok: 'Cancel', cancel: 'Discard' };

/**
 * The buttons of the question before an image is added to a document with no file. The dialog
 * makes the first Return's and gives Escape to the button called Cancel: Save… is the way on.
 */
export const SAVE_FOR_IMAGE_BUTTONS = { ok: 'Save…', cancel: 'Cancel' };

/** The sentence for a file that isn't an image the preview shows (src-tauri/src/image_files.rs). */
const notAnImage = (name: string) => `“${name}” isn’t an image Redlines can show.`;

/** Whether the answer to that question is Discard, the label of the button clicked. */
export function wantsDiscard(answer: string | undefined): boolean {
  return answer === 'Discard';
}

/**
 * The app's host as plugins see it: only the capabilities that exist so far (identity, and in the
 * app itself, processes and the relay). The rest (files, agents) are added here as the app gains
 * them.
 */
export function toPluginHost(host: Host): PluginHost {
  return {
    identity: { current: () => host.identity() },
    ...('__TAURI_INTERNALS__' in window
      ? { processes: createProcesses(), relay: createRelay() }
      : {}),
  };
}

export { BROWSER_IDENTITY };

export function createHost(): Host {
  return '__TAURI_INTERNALS__' in window ? createTauriHost() : createBrowserHost();
}

/** What the open and save panels offer: the documents (`DOCUMENT_EXTENSIONS`). */
const PANEL_EXTENSIONS = ['md', 'markdown', 'qmd', 'Rmd', 'txt'];

/**
 * The panels' filter, with the extension of the document `name` first when there is one: the save
 * panel gives the first to a name typed without one, so a plain text file stays plain text.
 */
function panelFilters(name = '') {
  const own = isDocument(name) ? extension(name) : '';
  const first = PANEL_EXTENSIONS.filter((candidate) => candidate.toLowerCase() === own);
  const rest = PANEL_EXTENSIONS.filter((candidate) => candidate.toLowerCase() !== own);
  return [{ name: 'Markdown and text', extensions: [...first, ...rest] }];
}

/** How long Save waits to hear whether the default folder is there, before it goes without. */
const FOLDER_CHECK_MS = 1000;

/**
 * Where the save panel starts: a full path as it is, in its own folder; and for a name alone,
 * the name in `folder`, once the app says the folder is there (src-tauri/src/files.rs), else the
 * name alone, which leaves the folder to macOS, where it last saved. A folder the app can't be
 * asked about, or doesn't answer about within a moment, as one on a volume that has gone away
 * doesn't, is no reason to hold Save up.
 */
async function savePanelStart(name: string, folder: string | null | undefined): Promise<string> {
  if (!folder || basename(name) !== name) return name;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const there = await Promise.race([
      invoke<boolean>('folder_exists', { path: folder }),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), FOLDER_CHECK_MS);
      }),
    ]);
    return there ? joinPath(folder, name) : name;
  } catch {
    return name;
  } finally {
    clearTimeout(timer);
  }
}

/** Runs one of the app's commands, and rejects with the sentence it refused with. */
async function appCommand<T>(
  command: string,
  args?: InvokeArgs,
  options?: InvokeOptions,
): Promise<T> {
  try {
    if (options) return await invoke<T>(command, args, options);
    if (args !== undefined) return await invoke<T>(command, args);
    return await invoke<T>(command);
  } catch (error) {
    throw new Error(String(error), { cause: error });
  }
}

/**
 * Sends the image files the page holds, a paste's or a drop's in a window that gets them itself, to
 * the app, one after another so that two of a name never meet. Each goes as its bytes, with the
 * rest in headers, written as percent codes (src-tauri/src/image_files.rs: add_pasted_image). What
 * the app refuses is a sentence for the person, not a failure of the rest.
 */
async function sendImageData(
  document: string,
  folder: string,
  files: File[],
  pasted: boolean,
): Promise<AddedImages> {
  const now = new Date();
  const added: AddedImages = { paths: [], refused: [] };
  for (const file of files) {
    const name = savedImageName(file, pasted, now);
    if (name === null) {
      added.refused.push(notAnImage(file.name));
      continue;
    }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const sent = await appCommand<AddedImages>('add_pasted_image', bytes, {
        headers: {
          'x-redlines-document': encodeURIComponent(document),
          'x-redlines-folder': encodeURIComponent(folder),
          'x-redlines-name': encodeURIComponent(name),
        },
      });
      added.paths.push(...sent.paths);
      added.refused.push(...sent.refused);
    } catch (error) {
      added.refused.push(error instanceof Error ? error.message : String(error));
    }
  }
  return added;
}

function createTauriHost(): Host {
  const write = (path: string, text: string) => writeTextFile(path, text);
  return {
    identity: appIdentity,
    async open() {
      const path = await openDialog({ multiple: false, directory: false, filters: panelFilters() });
      if (!path) return null;
      // The Mac's panel enables every file whose type conforms to one it offers, such as a script,
      // a log or a Terminal command for plain text's: a file that isn't a document isn't read.
      if (!isDocument(path)) throw new NotADocumentError();
      return { path, text: decodeText(await readFile(path)) };
    },
    read: async (path) => decodeText(await readFile(path)),
    write,
    async rename(from, to) {
      try {
        await invoke('rename_file', { from, to });
      } catch (error) {
        // The app says "exists" for a name that is taken, and anything else in words.
        throw error === 'exists' ? new FileExistsError(to) : new Error(String(error));
      }
    },
    exists: (path) => exists(path),
    reveal: (path) => invoke('reveal_in_finder', { path }),
    print: () => invoke('print_window'),
    async saveAs(text, suggestedName, folder) {
      const filters = panelFilters(suggestedName);
      const defaultPath = await savePanelStart(suggestedName, folder);
      const path = await saveDialog({ defaultPath, filters });
      if (!path) return null;
      // The panel takes a name whose type conforms to one it offers, a script's for plain text's,
      // and off the Mac a name with no extension: nothing is written to a file that isn't a
      // document.
      if (!isDocument(path)) throw new NotADocumentError(SAVES_DOCUMENTS_ONLY);
      await write(path, text);
      return path;
    },
    watch: watchDocument,
    // src-tauri/src/project.rs.
    projectRoot: (path) => invoke<ProjectRoot>('project_root', { path }),
    list: (folder, root) => invoke<FileEntry[]>('list_folder', { root, folder }),
    openDefault: async (path, root) => {
      await invoke('open_default', { root, path });
    },
    allowDocument: async (path) => {
      await invoke('allow_document', { path });
    },
    allowImages: (path) => invoke<boolean>('show_images', { path }),
    imageUrl: (path) => convertFileSrc(path),
    forgetDocuments: async () => {
      await invoke('forget_documents');
    },
    async askToSave(name) {
      const answer = await message("Your changes will be lost if you don't save them.", {
        title: `Do you want to save the changes you made to “${name}”?`,
        kind: 'warning',
        buttons: { yes: 'Save', no: 'Don’t Save', cancel: 'Cancel' },
      });
      return answer === 'Save' ? 'save' : answer === 'Don’t Save' ? 'discard' : 'cancel';
    },
    async askToDiscardDraft() {
      const answer = await message('A comment or reply you haven’t posted will be lost.', {
        title: 'Do you want to discard what you wrote?',
        kind: 'warning',
        buttons: DISCARD_DRAFT_BUTTONS,
      });
      return wantsDiscard(answer);
    },
    async askToOverwrite(name) {
      // Save As… is the default button: the choice that loses nothing.
      const answer = await message(
        'Saving now replaces those changes with yours. You can save your version as a new file instead.',
        {
          title: `“${name}” changed on disk since you opened it.`,
          kind: 'warning',
          buttons: { yes: 'Save As…', no: 'Overwrite', cancel: 'Cancel' },
        },
      );
      return answer === 'Save As…' ? 'saveAs' : answer === 'Overwrite' ? 'overwrite' : 'cancel';
    },
    async askToSaveForImage() {
      const answer = await message(
        'An image is saved beside its document, so the document has to be saved first.',
        {
          title: 'Do you want to save this document before adding the image?',
          kind: 'info',
          buttons: SAVE_FOR_IMAGE_BUTTONS,
        },
      );
      return answer === SAVE_FOR_IMAGE_BUTTONS.ok;
    },
    async chooseImages() {
      // The app shows the panel and keeps what is chosen: the page gets an id, never a path.
      const given = await appCommand<{ id: number } | null>('pick_images');
      return given ? { kind: 'given', id: given.id } : null;
    },
    async addImages(document, folder, source) {
      if (source.kind === 'given') {
        return appCommand<AddedImages>('add_images', { id: source.id, document, folder });
      }
      return sendImageData(document, folder, source.files, source.pasted);
    },
    listenForImageDrops: (onDrop) =>
      getCurrentWebviewWindow().listen<DroppedImages>('images-dropped', ({ payload }) =>
        onDrop(payload),
      ),
    async openWindow(path, line) {
      await invoke('open_window', { path: path ?? null, line: line ?? null });
    },
    windowStart: () => invoke<WindowStart>('window_start'),
    // Through the app: the menu bar is not a gesture in the page, which the page's own clipboard
    // access would need.
    readClipboardText: () => readText(),
    async listenForFiles(onOpen, onRefused) {
      // The app keeps the files until they are taken, so an event missed while starting loses
      // nothing.
      const take = async () => {
        const files = await invoke<OpenedFile[]>('opened_files');
        // Opening a file clears the notice that is showing, so the files that could not be
        // allowed are reported once the others are open, for the notice to stay.
        for (const { path, error } of files) if (error === null) await onOpen(path);
        for (const { path, error } of files) if (error !== null) onRefused(path, error);
      };
      // This window's own: the plain `listen` would hear what is sent to the others too.
      await getCurrentWebviewWindow().listen('opened', () => void take());
      await take();
    },
  };
}

/**
 * Calls `onChange` after the window's document at `path` changes on disk, and resolves to a function
 * that stops watching. The app watches, not the page, which may watch nothing itself
 * (src-tauri/src/watch.rs): it watches the document through its folder, so that a file replaced by
 * a rename stays watched, and the file a link names too, and tells of changes to that file alone, a
 * moment after each. It refuses a file the window may not use, and stops when the window closes.
 */
async function watchDocument(path: string, onChange: () => void): Promise<() => void> {
  let watching = true;
  const changes = new Channel<null>();
  changes.onmessage = () => {
    // The app may be telling of a change as the watch stops.
    if (watching) onChange();
  };
  const id = await invoke<number>('watch_document', { path, onChange: changes });
  return () => {
    if (!watching) return;
    watching = false;
    invoke('unwatch_document', { id }).catch((error: unknown) => {
      console.warn(`Could not stop watching ${basename(path)}`, error);
    });
  };
}

/** `name`, or `name-2`, `name-3` and on before its extension, whichever `taken` doesn't say is. */
function numbered(name: string, taken: (name: string) => boolean): string {
  const dot = name.lastIndexOf('.');
  const [stem, ending] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
  for (let number = 1; ; number++) {
    const candidate = number === 1 ? name : `${stem}-${number}${ending}`;
    if (!taken(candidate)) return candidate;
  }
}

/** A host for a plain browser tab: one folder in memory, starting with sample.md. */
function createBrowserHost(): Host {
  const files = new Map<string, string>([['sample.md', sample]]);
  // The images added in this tab, by the path a document links them by, and the addresses the page
  // loads them from, each made once, or the preview would draw an image again at every look.
  const images = new Map<string, Blob>();
  const imageUrls = new Map<string, string>();
  const read = (path: string) => {
    const text = files.get(path);
    return text === undefined
      ? Promise.reject(new Error(`${path} does not exist`))
      : Promise.resolve(text);
  };
  return {
    identity: () => Promise.resolve(BROWSER_IDENTITY),
    open: async () => ({ path: 'sample.md', text: await read('sample.md') }),
    read,
    write: (path, text) => {
      files.set(path, text);
      return Promise.resolve();
    },
    rename: (from, to) => {
      const text = files.get(from);
      if (text === undefined) return Promise.reject(new Error(`${from} does not exist`));
      if (files.has(to)) return Promise.reject(new FileExistsError(to));
      files.set(to, text);
      files.delete(from);
      return Promise.resolve();
    },
    exists: (path) => Promise.resolve(files.has(path)),
    // There is no Finder in a tab.
    reveal: () => Promise.resolve(),
    print: () => {
      window.print();
      return Promise.resolve();
    },
    saveAs: (text, suggestedName) => {
      const path = basename(suggestedName);
      files.set(path, text);
      return Promise.resolve(path);
    },
    watch: () => Promise.resolve(() => {}),
    // One folder, with no name and no repository.
    projectRoot: () => Promise.resolve({ folder: '', isRepo: false, tooBroad: false }),
    list: () =>
      Promise.resolve([...files.keys()].map((name) => ({ name, path: name, isDir: false }))),
    openDefault: () =>
      Promise.reject(new Error('A browser tab has no other apps to open files in.')),
    // Every file of the folder is the tab's own, and it remembers nothing.
    allowDocument: () => Promise.resolve(),
    // The images added in this tab are in its memory, in the folder of the document.
    allowImages: () => Promise.resolve(true),
    imageUrl: (path) => {
      const image = images.get(path);
      if (!image) return null;
      const known = imageUrls.get(path);
      if (known) return known;
      const url = URL.createObjectURL(image);
      imageUrls.set(path, url);
      return url;
    },
    forgetDocuments: () => Promise.resolve(),
    // The page's dialog has two buttons, so there is no way to discard here: Cancel keeps the
    // changes, as it does in the app's own dialog.
    askToSave: (name) =>
      Promise.resolve(
        window.confirm(`Save the changes you made to “${name}”?`) ? 'save' : 'cancel',
      ),
    askToDiscardDraft: () =>
      Promise.resolve(window.confirm('Discard a comment or reply you haven’t posted?')),
    askToSaveForImage: () =>
      Promise.resolve(
        window.confirm('Save this document first? An image is saved beside its document.'),
      ),
    // The browser's own panel, which gives the files themselves.
    chooseImages: () =>
      new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.multiple = true;
        input.addEventListener('change', () => {
          const chosen = Array.from(input.files ?? []);
          resolve(chosen.length ? { kind: 'files', files: chosen, pasted: false } : null);
        });
        input.addEventListener('cancel', () => resolve(null));
        input.click();
      }),
    addImages: (_document, folder, source) => {
      if (source.kind === 'given') {
        return Promise.reject(new Error('A browser tab is given no files by the system.'));
      }
      const added: AddedImages = { paths: [], refused: [] };
      const now = new Date();
      for (const file of source.files) {
        const name = savedImageName(file, source.pasted, now);
        if (name === null) {
          added.refused.push(notAnImage(file.name));
          continue;
        }
        // A name that is taken gets a number: nothing is replaced, as in the app.
        const made = numbered(name, (candidate) =>
          images.has(folder ? `${folder}/${candidate}` : candidate),
        );
        const path = folder ? `${folder}/${made}` : made;
        images.set(path, file);
        added.paths.push(path);
      }
      return Promise.resolve(added);
    },
    // A drop reaches the page itself in a tab (`EditorOptions.onImageFiles`).
    listenForImageDrops: () => Promise.resolve(() => {}),
    askToOverwrite: (name) =>
      Promise.resolve(
        window.confirm(`“${name}” changed since you opened it. Overwrite it?`)
          ? 'overwrite'
          : 'cancel',
      ),
    // Another tab, with its own folder in memory: it starts from sample.md, whatever was asked.
    openWindow: () => {
      window.open(location.href);
      return Promise.resolve();
    },
    windowStart: () => Promise.resolve({ path: null, line: null }),
    readClipboardText: () => navigator.clipboard.readText(),
    // A browser tab is never asked to open a file.
    listenForFiles: () => Promise.resolve(),
  };
}
