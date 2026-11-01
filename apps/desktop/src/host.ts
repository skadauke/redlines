// What the app needs from the machine it runs on: who you are, and files. In the Tauri app that is
// the file system and the native dialogs; in a plain browser (`pnpm dev`) it is a small in-memory
// folder holding sample.md, so the interface can be worked on without the native shell.

import { invoke } from '@tauri-apps/api/core';
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

export interface Host {
  identity(): Promise<Author>;
  /** Asks for a file to open and reads it; null when the dialog is cancelled. */
  open(): Promise<{ path: string; text: string } | null>;
  read(path: string): Promise<string>;
  write(path: string, text: string): Promise<void>;
  /** Asks where to save, starting from a file name or a full path, and writes the file there. */
  saveAs(text: string, suggestedName: string): Promise<string | null>;
  /** Calls `onChange` after the file changes on disk; resolves to a function that stops watching. */
  watch(path: string, onChange: () => void): Promise<() => void>;
  list(folder: string): Promise<FileEntry[]>;
  /** Asks whether to save unsaved edits to the named document before they would be lost. */
  askToSave(name: string): Promise<SaveChoice>;
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
const RESERVED_HANDLES = new Set([
  'y',
  'n',
  'yes',
  'no',
  'on',
  'off',
  'true',
  'false',
  'null',
  'unknown',
]);

/**
 * A handle from the email's local part, else from the name (format §5.3): lowercase letters,
 * digits, `-` and `_`, starting with a letter. Accents are dropped; any other run of characters
 * becomes `-`. Falls back to `me` when neither gives a usable handle.
 */
export function deriveHandle(name: string, email?: string | null): Handle {
  const at = email?.lastIndexOf('@') ?? -1;
  const local = email && at >= 0 ? email.slice(0, at) : (email ?? '');
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
 * Decodes a file's bytes as UTF-8, keeping a byte order mark as U+FEFF so that writing the text
 * back gives the same bytes (format §9.2).
 */
export function decodeText(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
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
      watch(
        path,
        (event) => {
          // Reads show up as access events on some systems; reloading on them would loop.
          if (!isAccess(event)) onChange();
        },
        { delayMs: 200 },
      ),
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
  };
}

function isAccess(event: WatchEvent): boolean {
  return typeof event.type === 'object' && 'access' in event.type;
}

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
    identity: () => Promise.resolve({ handle: 'you', name: 'You' }),
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
    askToSave: (name) =>
      Promise.resolve(
        window.confirm(`Save the changes you made to “${name}”?`) ? 'save' : 'discard',
      ),
  };
}
