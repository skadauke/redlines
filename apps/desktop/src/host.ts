// What the app needs from the machine it runs on: who you are, and files. In the Tauri app that is
// the file system and the native dialogs; in a plain browser (`pnpm dev`) it is a small in-memory
// folder holding sample.md, so the interface can be worked on without the native shell.

import { Channel, convertFileSrc, invoke } from '@tauri-apps/api/core';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { readText } from '@tauri-apps/plugin-clipboard-manager';
import { message, open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { exists, readFile, writeTextFile } from '@tauri-apps/plugin-fs';
import type { Author } from '@redlines/editor';
import { deriveHandle } from './handle.ts';
import type { FileEntry, Host as PluginHost, ProjectRoot } from '@redlines/plugin-api';
import { createProcesses, createRelay } from './agent-host.ts';
import sample from './sample.md?raw';

export type { FileEntry, ProjectRoot };

/** The answer to "Do you want to save the changes you made?". */
export type SaveChoice = 'save' | 'discard' | 'cancel';

/** The answer to "This file changed on disk since you opened it" when saving. */
export type OverwriteChoice = 'overwrite' | 'saveAs' | 'cancel';

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
  /**
   * Reads a file for the viewer: the text, or `tooLarge` for one over `limit` bytes, which is
   * not decoded. In the app, only a file the person opened, or one the sidebar of a project a
   * window shows lists, and none over 2 MB (src-tauri/src/project.rs). Rejects with NotUtf8Error
   * when it isn't UTF-8.
   */
  readCapped(path: string, limit: number): Promise<{ text: string } | { tooLarge: true }>;
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
  /** Asks where to save, starting from a file name or a full path, and writes the file there. */
  saveAs(text: string, suggestedName: string): Promise<string | null>;
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
 * The extensions of the documents Redlines opens (format §9.1), lowercase: Markdown, its R Markdown
 * and Quarto dialects, and plain text, which is read as Markdown is.
 */
export const DOCUMENT_EXTENSIONS: readonly string[] = ['md', 'markdown', 'qmd', 'rmd', 'txt'];

/** Whether a file is a document, which Redlines opens and edits, by its name. */
export function isDocument(name: string): boolean {
  return DOCUMENT_EXTENSIONS.includes(extension(name));
}

/**
 * What the window says of a file that isn't a document, which Redlines doesn't open, however it is
 * asked to (src-tauri/src/project.rs says the same).
 */
export const NOT_A_DOCUMENT = 'Redlines opens Markdown and text files.';

/** A file name's extension, lowercase, or '' for a name without one. */
function extension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/** The extensions of the other plain text files: code, settings and data, lowercase. */
const TEXT_EXTENSIONS: ReadonlySet<string> = new Set(
  (
    'text log csv tsv json jsonc json5 jsonl yaml yml toml ini cfg conf xml html htm css scss ' +
    'sass less js mjs cjs jsx ts mts cts tsx vue svelte py rb rs go java kt kts swift c h cc cpp ' +
    'cxx hpp hh m mm cs fs php pl pm r lua sh bash zsh fish ps1 bat sql graphql gql proto tex bib ' +
    'rst adoc org diff patch lock'
  ).split(' '),
);

/** Plain text files known by their whole name, which have no extension. */
const TEXT_NAMES: ReadonlySet<string> = new Set(
  (
    'makefile dockerfile containerfile justfile procfile gemfile rakefile license licence copying ' +
    'notice authors codeowners readme changelog'
  ).split(' '),
);

/**
 * What a file is, by its name: a document, which Redlines edits; other plain text, such as code; or
 * anything else, such as an image or a PDF, which opens in its default app.
 */
export function fileKind(name: string): 'document' | 'text' | 'other' {
  if (isDocument(name)) return 'document';
  if (TEXT_EXTENSIONS.has(extension(name)) || TEXT_NAMES.has(name.toLowerCase())) return 'text';
  return 'other';
}

/**
 * The extensions, lowercase, of the files that a link in a document opens in another app, Preview
 * on the Mac: images and PDFs. The app checks again, by the file a link names
 * (src-tauri/src/project.rs).
 */
const DEFAULT_APP_EXTENSIONS: ReadonlySet<string> = new Set(
  'png jpg jpeg gif webp heic tiff bmp pdf'.split(' '),
);

/** Whether a link opens a file in its default app, by its name: an image or a PDF. */
export function opensInDefaultApp(name: string): boolean {
  return DEFAULT_APP_EXTENSIONS.has(extension(name));
}

export function basename(path: string): string {
  return path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
}

/** The folder holding `path`: the disk's root for a file there, and '' for a bare file name. */
export function dirname(path: string): string {
  const separator = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return path.slice(0, separator === 0 ? 1 : Math.max(separator, 0));
}

export { deriveHandle };

/**
 * Decodes a file's bytes as UTF-8 so that writing the text back gives the same bytes (format §9.2):
 * a byte order mark stays as U+FEFF, and bytes that aren't UTF-8 throw NotUtf8Error instead of
 * becoming U+FFFD.
 */
export function decodeCapped(
  bytes: Uint8Array,
  limit: number,
): { text: string } | { tooLarge: true } {
  return bytes.byteLength > limit ? { tooLarge: true } : { text: decodeText(bytes) };
}

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

export function createHost(): Host {
  return '__TAURI_INTERNALS__' in window ? createTauriHost() : createBrowserHost();
}

/** What the open and save dialogs offer: the documents (`DOCUMENT_EXTENSIONS`). */
const FILTERS = [
  { name: 'Markdown and text', extensions: ['md', 'markdown', 'qmd', 'Rmd', 'txt'] },
];

/** What the app says for a file too large for the viewer (src-tauri/src/project.rs). */
const TOO_LARGE = 'too-large';

function createTauriHost(): Host {
  const write = (path: string, text: string) => writeTextFile(path, text);
  return {
    async identity() {
      const { name, email } = await invoke<{ name: string; email: string | null }>('identity');
      return { handle: deriveHandle(name, email), name, ...(email ? { email } : {}) };
    },
    async open() {
      const path = await openDialog({ multiple: false, directory: false, filters: FILTERS });
      return path ? { path, text: decodeText(await readFile(path)) } : null;
    },
    read: async (path) => decodeText(await readFile(path)),
    // Through the app, which reads only a file the window may see, and sends its bytes as they
    // are, so that they are decoded as a document's are. It says "too-large" for one over 2 MB,
    // which it doesn't read.
    async readCapped(path, limit) {
      let bytes: ArrayBuffer;
      try {
        bytes = await invoke<ArrayBuffer>('read_project_file', { path });
      } catch (error) {
        if (error === TOO_LARGE) return { tooLarge: true };
        throw error;
      }
      return decodeCapped(new Uint8Array(bytes), limit);
    },
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
    async saveAs(text, suggestedName) {
      const path = await saveDialog({ defaultPath: suggestedName, filters: FILTERS });
      if (path) await write(path, text);
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

/**
 * The person using the app in a plain browser tab: Ada, who wrote the welcome document with the
 * others, so that her changes in it show as yours.
 */
export const BROWSER_IDENTITY: Author = {
  handle: 'ada',
  name: 'Ada Lovelace',
  email: 'ada@example.org',
};

/** A host for a plain browser tab: one folder in memory, starting with sample.md. */
function createBrowserHost(): Host {
  const files = new Map<string, string>([['sample.md', sample]]);
  // Under `pnpm dev`, a source file to look at in the viewer. Left out of the built app.
  const sources = new Map<string, () => Promise<string>>(
    import.meta.env.DEV && import.meta.env.MODE !== 'test'
      ? [['main.ts', () => import('./main.ts?raw').then((m) => m.default)]]
      : [],
  );
  const readCapped: Host['readCapped'] = async (path, limit) => {
    const text = await read(path);
    return text.length > limit ? { tooLarge: true } : { text };
  };
  const read = (path: string) => {
    const text = files.get(path);
    if (text !== undefined) return Promise.resolve(text);
    return sources.get(path)?.() ?? Promise.reject(new Error(`${path} does not exist`));
  };
  return {
    identity: () => Promise.resolve(BROWSER_IDENTITY),
    open: async () => ({ path: 'sample.md', text: await read('sample.md') }),
    read,
    readCapped,
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
      Promise.resolve(
        [...files.keys(), ...sources.keys()].map((name) => ({ name, path: name, isDir: false })),
      ),
    openDefault: () =>
      Promise.reject(new Error('A browser tab has no other apps to open files in.')),
    // Every file of the folder is the tab's own, and it remembers nothing.
    allowDocument: () => Promise.resolve(),
    // A tab has no folder to load images from.
    allowImages: () => Promise.resolve(false),
    imageUrl: () => null,
    forgetDocuments: () => Promise.resolve(),
    // The page's dialog has two buttons, so there is no way to discard here: Cancel keeps the
    // changes, as it does in the app's own dialog.
    askToSave: (name) =>
      Promise.resolve(
        window.confirm(`Save the changes you made to “${name}”?`) ? 'save' : 'cancel',
      ),
    askToDiscardDraft: () =>
      Promise.resolve(window.confirm('Discard a comment or reply you haven’t posted?')),
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
