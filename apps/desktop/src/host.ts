// What the app needs from the machine it runs on: who you are, and files. In the Tauri app that is
// the file system and the native dialogs; in a plain browser (`pnpm dev`) it is a small in-memory
// folder holding sample.md, so the interface can be worked on without the native shell.

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { message, open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { readDir, readFile, watch, writeTextFile, type WatchEvent } from '@tauri-apps/plugin-fs';
import type { Author } from '@redlines/editor';
import type { Handle } from '@redlines/format';
import sample from './sample.md?raw';

export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
}

/** The answer to "Do you want to save the changes you made?". */
export type SaveChoice = 'save' | 'discard' | 'cancel';

/** The answer to "This file changed on disk since you opened it" when saving. */
export type OverwriteChoice = 'overwrite' | 'saveAs' | 'cancel';

export interface Host {
  identity(): Promise<Author>;
  /** Asks for a file to open and reads it; null when the dialog is cancelled. */
  open(): Promise<{ path: string; text: string } | null>;
  /** Reads a file; rejects with NotUtf8Error when it isn't UTF-8. */
  read(path: string): Promise<string>;
  write(path: string, text: string): Promise<void>;
  /** Asks where to save, starting from a file name or a full path, and writes the file there. */
  saveAs(text: string, suggestedName: string): Promise<string | null>;
  /** Calls `onChange` after the file changes on disk; resolves to a function that stops watching. */
  watch(path: string, onChange: () => void): Promise<() => void>;
  list(folder: string): Promise<FileEntry[]>;
  /** Asks whether to save unsaved edits to the named document before they would be lost. */
  askToSave(name: string): Promise<SaveChoice>;
  /** Asks what to do when saving would replace changes made to the file elsewhere. */
  askToOverwrite(name: string): Promise<OverwriteChoice>;
  /**
   * Calls `onOpen` with each file the app is asked to open, on its command line or by the system
   * (`open -a Redlines plan.md`): those asked for before it was called, and those asked for later.
   * A file that the app was asked to open but could not let the window use goes to `onRefused`,
   * with the reason, instead.
   */
  listenForFiles(
    onOpen: (path: string) => void,
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

/** The extensions of the files Redlines opens (format §9.1), lowercase. */
export const MARKDOWN_EXTENSIONS: readonly string[] = ['md', 'markdown', 'qmd', 'rmd'];

export function isMarkdown(name: string): boolean {
  const dot = name.lastIndexOf('.');
  return dot > 0 && MARKDOWN_EXTENSIONS.includes(name.slice(dot + 1).toLowerCase());
}

export function basename(path: string): string {
  return path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
}

/** The folder holding `path`, or '' for a bare file name. */
export function dirname(path: string): string {
  return path.slice(0, Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'), 0));
}

// Words YAML 1.1 reads as booleans or null, and the author nobody recorded (format §2.4).
const RESERVED_HANDLES = new Set('y n yes no on off true false null unknown'.split(' '));

/**
 * A handle from the email's local part, else from the name (format §5.3): lowercase letters,
 * digits, `-` and `_`, starting with a letter. Accents are dropped; any other run of characters
 * becomes `-`. Falls back to `me` when neither gives a usable handle.
 */
export function deriveHandle(name: string, email?: string | null): Handle {
  const local = email?.split('@')[0] ?? '';
  return toHandle(local) || toHandle(name) || 'me';
}

function toHandle(text: string): string {
  const handle = text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[^a-z]+/, '')
    .replace(/[-_]+$/, '');
  return RESERVED_HANDLES.has(handle) ? '' : handle;
}

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

export function createHost(): Host {
  return '__TAURI_INTERNALS__' in window ? createTauriHost() : createBrowserHost();
}

const FILTERS = [{ name: 'Markdown', extensions: ['md', 'markdown', 'qmd', 'Rmd'] }];

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
    write,
    async saveAs(text, suggestedName) {
      const path = await saveDialog({ defaultPath: suggestedName, filters: FILTERS });
      if (path) await write(path, text);
      return path;
    },
    watch: (path, onChange) =>
      watchFile(path, onChange, (watched, onEvent) => watch(watched, onEvent, { delayMs: 200 })),
    async list(folder) {
      const entries = await readDir(folder);
      const separator = folder.endsWith('/') ? '' : '/';
      return entries.map((entry) => ({
        name: entry.name,
        path: folder + separator + entry.name,
        isDir: entry.isDirectory,
      }));
    },
    async askToSave(name) {
      const answer = await message("Your changes will be lost if you don't save them.", {
        title: `Do you want to save the changes you made to “${name}”?`,
        kind: 'warning',
        buttons: { yes: 'Save', no: 'Don’t Save', cancel: 'Cancel' },
      });
      return answer === 'Save' ? 'save' : answer === 'Don’t Save' ? 'discard' : 'cancel';
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
    async listenForFiles(onOpen, onRefused) {
      // The app keeps the files until they are taken, so an event missed while starting loses
      // nothing.
      const take = async () => {
        for (const { path, error } of await invoke<OpenedFile[]>('opened_files')) {
          if (error === null) onOpen(path);
          else onRefused(path, error);
        }
      };
      await listen('opened', () => void take());
      await take();
    },
  };
}

/** What watching a file needs to know about a file system event. */
export type FileEvent = Pick<WatchEvent, 'type' | 'paths'>;

function isAccess(event: FileEvent): boolean {
  return typeof event.type === 'object' && 'access' in event.type;
}

/** A file name as the file system compares it: macOS ignores case and the Unicode form. */
const comparable = (name: string) => name.normalize('NFC').toLowerCase();

/**
 * Whether an event from watching a file's folder is about the file named `name`: a change to it,
 * or to the file renamed over it or away from it. Other files in the folder, and reads of the
 * file, are not. An event without a path says that events were lost, so the file may have
 * changed, and counts.
 */
export function isAboutFile(event: FileEvent, name: string): boolean {
  // Reads show up as access events on some systems; reloading on them would loop.
  if (isAccess(event)) return false;
  if (event.paths.length === 0) return true;
  const wanted = comparable(name);
  return event.paths.some((path) => comparable(basename(path)) === wanted);
}

/**
 * Calls `onChange` when the file at `path` changes, and resolves to a function that stops
 * watching. `watchPath` watches a path and reports its events.
 *
 * It watches the file's folder, and picks out the file by its name in the events. A watch on the
 * file itself stays with the file it found. A file that an editor or the `redlines` command line
 * replaces by writing a new one beside it and renaming that over it is a different file, and on
 * Linux (inotify) the first rename ends the watch, so that only the first change would be seen.
 *
 * A file that was opened from outside the home folder, or a hidden folder, is allowed by itself
 * and not its folder, so the folder can't be watched: the file is watched itself then, which sees
 * what the system lets a watch on a file see.
 */
export async function watchFile(
  path: string,
  onChange: () => void,
  watchPath: (path: string, onEvent: (event: WatchEvent) => void) => Promise<() => void>,
): Promise<() => void> {
  const name = basename(path);
  const onEvent = (event: WatchEvent) => {
    if (isAboutFile(event, name)) onChange();
  };
  const folder = dirname(path);
  if (folder !== '') {
    try {
      return await watchPath(folder, onEvent);
    } catch (error) {
      console.warn(`Could not watch the folder of ${name}, watching the file itself`, error);
    }
  }
  return watchPath(path, onEvent);
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
    saveAs: (text, suggestedName) => {
      const path = basename(suggestedName);
      files.set(path, text);
      return Promise.resolve(path);
    },
    watch: () => Promise.resolve(() => {}),
    list: () =>
      Promise.resolve([...files.keys()].map((name) => ({ name, path: name, isDir: false }))),
    // The page's dialog has two buttons, so there is no way to discard here: Cancel keeps the
    // changes, as it does in the app's own dialog.
    askToSave: (name) =>
      Promise.resolve(
        window.confirm(`Save the changes you made to “${name}”?`) ? 'save' : 'cancel',
      ),
    askToOverwrite: (name) =>
      Promise.resolve(
        window.confirm(`“${name}” changed since you opened it. Overwrite it?`)
          ? 'overwrite'
          : 'cancel',
      ),
    // A browser tab is never asked to open a file.
    listenForFiles: () => Promise.resolve(),
  };
}
