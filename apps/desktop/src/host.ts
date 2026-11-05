// What the app needs from the machine it runs on: who you are, and files. In the Tauri app that is
// the file system and the native dialogs; in a plain browser (`pnpm dev`) it is a small in-memory
// folder holding sample.md, so the interface can be worked on without the native shell.

import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { readText } from '@tauri-apps/plugin-clipboard-manager';
import { message, open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { exists, readFile, watch, writeTextFile, type WatchEvent } from '@tauri-apps/plugin-fs';
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
  /** Calls `onChange` after the file changes on disk; resolves to a function that stops watching. */
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
   * Opens an image or a PDF inside the project folder `root` in the app the system opens it with;
   * rejects with a line to show the person.
   */
  openDefault(path: string, root: string): Promise<void>;
  /** Asks whether to save unsaved edits to the named document before they would be lost. */
  askToSave(name: string): Promise<SaveChoice>;
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

/** The extensions of the files Redlines opens (format §9.1), lowercase. */
export const MARKDOWN_EXTENSIONS: readonly string[] = ['md', 'markdown', 'qmd', 'rmd'];

export function isMarkdown(name: string): boolean {
  return MARKDOWN_EXTENSIONS.includes(extension(name));
}

/** A file name's extension, lowercase, or '' for a name without one. */
function extension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/** The extensions of plain text files other than Markdown: code, settings and data, lowercase. */
const TEXT_EXTENSIONS: ReadonlySet<string> = new Set(
  (
    'txt text log csv tsv json jsonc json5 jsonl yaml yml toml ini cfg conf xml html htm css scss ' +
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
 * What a file is, by its name: Markdown, which Redlines edits; other plain text, such as code; or
 * anything else, such as an image or a PDF, which opens in its default app.
 */
export function fileKind(name: string): 'markdown' | 'text' | 'other' {
  if (isMarkdown(name)) return 'markdown';
  if (TEXT_EXTENSIONS.has(extension(name)) || TEXT_NAMES.has(name.toLowerCase())) return 'text';
  return 'other';
}

/**
 * The extensions, lowercase, of the files that open in their default app: images and PDFs. The app
 * checks again, by the file a link names (src-tauri/src/project.rs).
 */
const DEFAULT_APP_EXTENSIONS: ReadonlySet<string> = new Set(
  'png jpg jpeg gif webp heic tiff bmp pdf'.split(' '),
);

/** Whether a file opens in its default app, by its name: an image or a PDF. */
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
export function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { ignoreBOM: true, fatal: true }).decode(bytes);
  } catch {
    throw new NotUtf8Error();
  }
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
    watch: (path, onChange) =>
      watchFile(
        path,
        onChange,
        (watched, onEvent) => watch(watched, onEvent, { delayMs: 200 }),
        (file) => invoke<string>('real_path', { path: file }),
      ),
    // src-tauri/src/project.rs.
    projectRoot: (path) => invoke<ProjectRoot>('project_root', { path }),
    list: (folder, root) => invoke<FileEntry[]>('list_folder', { root, folder }),
    openDefault: async (path, root) => {
      await invoke('open_default', { root, path });
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

/** Watches a path and reports its events: the file system plugin's `watch`. */
export type WatchPath = (path: string, onEvent: (event: WatchEvent) => void) => Promise<() => void>;

/**
 * How long the events of a change are gathered before it is reported. A change shows as several
 * events, and a file watched in two places reports it twice.
 */
export const CHANGE_GATHER_MS = 50;

/**
 * Calls `onChange` when the file at `path` changes, and resolves to a function that stops
 * watching. `watchPath` watches a path and reports its events; `realPath` says which file a path
 * really is, with every link in it followed.
 *
 * Each file is watched through its folder, picking the file out of the events by its name. A watch
 * on the file itself stays with the file it found. A file that an editor or the `redlines` command
 * line replaces by writing a new one beside it and renaming that over it is a different file, and
 * on Linux (inotify) the first rename ends the watch, so that only the first change would be seen.
 *
 * A link is followed by the command line, which writes the file the link names, in that file's
 * folder and under that file's name, where the link's own folder sees nothing. So both are
 * watched: the link, for when it is replaced, and the file it names.
 *
 * A file that was opened from outside the home folder, or a hidden folder, is allowed by itself
 * and not its folder, so the folder can't be watched: the file is watched itself then, which sees
 * what the system lets a watch on a file see.
 */
export async function watchFile(
  path: string,
  onChange: () => void,
  watchPath: WatchPath,
  realPath: (path: string) => Promise<string> = (file) => Promise.resolve(file),
): Promise<() => void> {
  const real = await realPath(path).catch((error: unknown) => {
    console.warn(`Could not find where ${basename(path)} really is`, error);
    return path;
  });
  const files = real === path ? [path] : [path, real];

  const changes = gather(onChange);
  const failed: { file: string; error: unknown }[] = [];
  const watches = await Promise.all(
    files.map((file) =>
      watchOne(file, changes.report, watchPath).catch((error: unknown) => {
        failed.push({ file, error });
        return null;
      }),
    ),
  );
  const stops = watches.filter((stop) => stop !== null);
  // What can be watched is enough: the other name the file goes by is only one more way to hear
  // of a change.
  if (stops.length === 0) throw failed[0]?.error;
  for (const { file, error } of failed) console.warn(`Could not watch ${file}`, error);

  return () => {
    for (const stop of stops) stop();
    changes.cancel();
  };
}

/** Watches one file: through its folder when that can be watched, and else itself. */
async function watchOne(
  file: string,
  changed: () => void,
  watchPath: WatchPath,
): Promise<() => void> {
  const name = basename(file);
  const folder = dirname(file);
  if (folder !== '') {
    try {
      return await watchPath(folder, (event) => {
        if (isAboutFile(event, name)) changed();
      });
    } catch (error) {
      console.warn(`Could not watch the folder of ${name}, watching the file itself`, error);
    }
  }
  // Every event of a watch on the file is about it, whatever name it carries: watching a link, the
  // system reports the file the link names.
  return watchPath(file, (event) => {
    if (!isAccess(event)) changed();
  });
}

/** Turns the calls of a burst into one call of `onChange`, a moment after the first. */
function gather(onChange: () => void): { report: () => void; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    report: () => {
      timer ??= setTimeout(() => {
        timer = undefined;
        onChange();
      }, CHANGE_GATHER_MS);
    },
    cancel: () => {
      clearTimeout(timer);
      timer = undefined;
    },
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
