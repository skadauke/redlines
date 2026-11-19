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
import { DOCUMENT_EXTENSIONS, extension, isDocument } from './file-names.ts';
import { savedImageName } from './image-add.ts';
import { originalFile } from './office-picture.ts';
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

/**
 * What a window was opened for: a file, and a line in it; or text, for an Untitled document that
 * holds it; or none of these.
 */
export interface WindowStart {
  path: string | null;
  line: number | null;
  /** The window was opened to join the session of `path`, whose text it takes from its leader. */
  session?: boolean;
  /**
   * The text of the Untitled document the window starts with, which is unsaved: never an empty
   * string, and null for a window opened for a file or for nothing. A page that reloads asks again
   * and is told the same, so it starts with the text again, for as long as the window has no file:
   * the app lets the text go once the window says its document is one.
   */
  text: string | null;
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
   * Asks where to save the window's printed page as a PDF and writes it there, paginated as the
   * print dialog would: the path, or null when the person cancels. The page must be ready first
   * (print.ts).
   */
  exportPdf(name: string, folder?: string | null): Promise<string | null>;
  /**
   * Asks where to save, starting from a file name or a full path, and writes the file there. For a
   * name alone, `folder` is where the dialog starts, if it is still there; without it, or when it
   * is gone, the dialog starts where macOS has it. A full path starts in its own folder.
   */
  saveAs(text: string, suggestedName: string, folder?: string | null): Promise<string | null>;
  /**
   * Asks for a Word file (.docx) and reads its bytes; null when the dialog is cancelled. In the
   * development page, a file picker.
   */
  openDocx(): Promise<{ name: string; bytes: Uint8Array } | null>;
  /**
   * Asks where to save a Word file, starting from `suggestedName` in `folder` (as `saveAs` does),
   * and writes the bytes there. Resolves to the name it was saved as, or null when the dialog is
   * cancelled. In the development page the browser downloads it.
   */
  exportWord(
    bytes: Uint8Array,
    suggestedName: string,
    folder?: string | null,
  ): Promise<string | null>;
  /**
   * Calls `onChange` after the file changes on disk; resolves to a function that stops watching. In
   * the app, only the window's document, a file it may use, which the app watches for it.
   */
  watch(path: string, onChange: () => void): Promise<() => void>;
  /**
   * The folder an agent may read for the document at `documentPath`, which the file sidebar shows:
   * its repository's root, or else its own folder. In the app, only for a document the person
   * opened or saved; any other path rejects with a line that says nothing of whether it is there.
   */
  projectRoot(documentPath: string): Promise<ProjectRoot>;
  /**
   * The entries of `folder`, which must be inside the project folder `root`, with hidden ones and
   * those that git ignores left out. In the app, only for a project folder a sidebar shows.
   */
  list(folder: string, root: string): Promise<FileEntry[]>;
  /**
   * Opens an image or a PDF inside the project folder `root` in Preview (in its default app off
   * the Mac); rejects with a line to show the person. In the app, `root` must be a project folder
   * a sidebar shows, and the file below no hidden name.
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
   * The stamp of each image file, in order: one text that changes when the file is saved again
   * (`src/image-watch.ts`). Null for a file the page may not load or that isn't there.
   */
  imageStamps(paths: string[]): Promise<(string | null)[]>;
  /**
   * The width and height in px of each image file, in order, read from its header: null for a file
   * the page may not load, that isn't there, or whose format isn't read. The preview holds the
   * room of an image before it loads from it.
   */
  imageSizes(paths: string[]): Promise<({ width: number; height: number } | null)[]>;
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
   * saved in the project’s folder for images. Resolves to true for Save…, false for Cancel.
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
  /**
   * Opens a new window: empty, or for the file at `path`, showing `line` (counted from 1), or for
   * an Untitled document that holds `text`, which is unsaved. A window opens for a file or for
   * text, not both: the app refuses that, and this rejects with its reason.
   */
  openWindow(path?: string, line?: number, text?: string, session?: boolean): Promise<void>;
  /** What this window was opened for. */
  windowStart(): Promise<WindowStart>;
  /** The clipboard's plain text, or an empty string when it holds none. Rejects when unreadable. */
  readClipboardText(): Promise<string>;
  /**
   * Pastes the clipboard into the document as the Mac's own Paste does (`paste:` to the window's
   * first responder), so that the page gets a paste event with the clipboard's HTML as well as its
   * text, which the editor converts to Markdown as ⌘V does. Resolves to whether something took it.
   * A browser tab has none: it reads text alone (`readClipboardText`).
   */
  pasteInDocument?(): Promise<boolean>;
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

/** The media type of a Word file. */
const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** What the open and save panels offer: the documents (`DOCUMENT_EXTENSIONS`). */
const PANEL_EXTENSIONS = DOCUMENT_EXTENSIONS;

/**
 * The panels' filter, with the extension of the document `name` first when there is one: the save
 * panel gives the first to a name typed without one, so a plain text file stays plain text.
 */
function panelFilters(name = '') {
  const own = isDocument(name) ? extension(name) : '';
  const first = PANEL_EXTENSIONS.filter((candidate) => candidate.toLowerCase() === own);
  const rest = PANEL_EXTENSIONS.filter((candidate) => candidate.toLowerCase() !== own);
  return [{ name: 'Markdown, text and code', extensions: [...first, ...rest] }];
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

/** Word's drawing package from the pasteboard (src-tauri/src/office_picture.rs), or null. */
async function readOfficePackage(): Promise<Uint8Array | null> {
  const bytes = await invoke<ArrayBuffer>('read_office_picture');
  return bytes.byteLength > 0 ? new Uint8Array(bytes) : null;
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
  for (const given of files) {
    // A picture copied in Word comes at the size it has on the page; Word's own drawing format on the
    // pasteboard holds the original (#1182). The paste is the picture alone, and the original has to
    // be that picture, or the picture stays as it came.
    const file =
      (pasted && files.length === 1 ? await originalFile(given, readOfficePackage) : null) ?? given;
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

/**
 * Writes bytes to a file the window may write: the one the save panel just returned, which the
 * dialog added to its scope. The file plugin's text command writes the body it is given as it is,
 * so the window needs no other write permission (`fs:allow-write-file` would be a broader one).
 */
export function writeBytes(path: string, bytes: Uint8Array): Promise<void> {
  return invoke('plugin:fs|write_text_file', bytes, {
    headers: { path: encodeURIComponent(path) },
  });
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
    exportPdf: (name, folder) =>
      invoke<string | null>('export_pdf', { name, folder: folder ?? null }),
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
    async openDocx() {
      const path = await openDialog({
        multiple: false,
        directory: false,
        filters: [{ name: 'Word document', extensions: ['docx'] }],
      });
      if (!path) return null;
      return { name: basename(path), bytes: await readFile(path) };
    },
    async exportWord(bytes, suggestedName, folder) {
      const defaultPath = await savePanelStart(suggestedName, folder);
      const path = await saveDialog({
        defaultPath,
        filters: [{ name: 'Word document', extensions: ['docx'] }],
      });
      if (!path) return null;
      // Written where the panel said: only that path is in the window's scope. The Mac's panel
      // adds the extension itself.
      await writeBytes(path, bytes);
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
    imageStamps: (paths) => invoke<(string | null)[]>('image_stamps', { paths }),
    imageSizes: async (paths) =>
      (await invoke<([number, number] | null)[]>('image_sizes', { paths })).map((size) =>
        size ? { width: size[0], height: size[1] } : null,
      ),
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
        'An image is saved in the project’s folder for images, so the document has to be saved first.',
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
    async openWindow(path, line, text, session) {
      await invoke('open_window', {
        path: path ?? null,
        line: line ?? null,
        text: text ?? null,
        ...(session ? { session } : {}),
      });
    },
    windowStart: () => invoke<WindowStart>('window_start'),
    // Through the app: the menu bar is not a gesture in the page, which the page's own clipboard
    // access would need.
    readClipboardText: () => readText(),
    pasteInDocument: () => invoke<boolean>('paste_in_field'),
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

/**
 * Debug only, in the development page: stands in for Preview, which a page has none of
 * (`apps/desktop/journeys`). An image opened in it is recorded, and one saved again there is
 * replaced, the way a save in Preview changes the file.
 */
export interface DevImages {
  /** The paths asked to open in another app, in order. */
  opened: string[];
  /** Saves the image at `path` again, with other bytes. */
  replace(path: string, blob: Blob): void;
}

declare global {
  interface Window {
    __redlinesImages?: DevImages;
  }
}

/** A host for a plain browser tab: one folder in memory, starting with sample.md. */
function createBrowserHost(): Host {
  const files = new Map<string, string>([['sample.md', sample]]);
  // The images added in this tab, by the path a document links them by, and the addresses the page
  // loads them from, each made once, or the preview would draw an image again at every look.
  const images = new Map<string, Blob>();
  const imageUrls = new Map<string, string>();
  /** How many times each image was saved again, which only the development page does. */
  const stamps = new Map<string, number>();
  const dev: DevImages | null = import.meta.env.DEV
    ? {
        opened: [],
        replace(path, blob) {
          images.set(path, blob);
          const url = imageUrls.get(path);
          if (url) URL.revokeObjectURL(url);
          imageUrls.delete(path);
          stamps.set(path, (stamps.get(path) ?? 0) + 1);
        },
      }
    : null;
  if (dev) window.__redlinesImages = dev;
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
    // A tab has no panel of its own to write a file with: the browser's print dialog saves a PDF.
    exportPdf: () => {
      window.print();
      return Promise.resolve(null);
    },
    saveAs: (text, suggestedName) => {
      const path = basename(suggestedName);
      files.set(path, text);
      return Promise.resolve(path);
    },
    openDocx: () =>
      new Promise((resolve, reject) => {
        // A tab has no open panel of the app's: the page's own file picker.
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.docx';
        input.addEventListener('cancel', () => resolve(null));
        input.addEventListener('change', () => {
          const file = input.files?.[0];
          if (!file) return resolve(null);
          file
            .arrayBuffer()
            .then((buffer) => resolve({ name: file.name, bytes: new Uint8Array(buffer) }), reject);
        });
        input.click();
      }),
    exportWord: (bytes, suggestedName) => {
      // A tab has no save panel: the browser downloads the file.
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: DOCX_TYPE }));
      const link = document.createElement('a');
      link.href = url;
      link.download = suggestedName;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return Promise.resolve(suggestedName);
    },
    watch: () => Promise.resolve(() => {}),
    // One folder, with no name and no repository.
    projectRoot: () => Promise.resolve({ folder: '', isRepo: false, tooBroad: false }),
    // The images added in this tab are files of the folder too, to be dragged into the document.
    list: () =>
      Promise.resolve(
        [...files.keys(), ...images.keys()].map((name) => ({ name, path: name, isDir: false })),
      ),
    // The development page has a stand-in for Preview (`DevImages`); a tab has no other apps.
    openDefault: (path) => {
      if (!dev)
        return Promise.reject(new Error('A browser tab has no other apps to open files in.'));
      dev.opened.push(path);
      return Promise.resolve();
    },
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
    imageStamps: (paths) =>
      Promise.resolve(
        paths.map((path) => (images.has(path) ? String(stamps.get(path) ?? 0) : null)),
      ),
    imageSizes: (paths) => Promise.resolve(paths.map(() => null)),
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
        window.confirm(
          'Save this document first? An image is saved in the project’s folder for images.',
        ),
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
    // Another tab, with its own folder in memory: it starts from sample.md, whatever was asked (a
    // file or a line), so no tab is ever opened for either (`windowStart`). It can't be given text,
    // which it would lose without a word: the request is refused, as the app refuses what it can't
    // open. An empty text is none, as it is for the app.
    openWindow: (path, _line, text, session) => {
      if (text) return Promise.reject(new Error('A browser tab can’t be opened for text.'));
      // Another tab on the same document: it joins the session of this one (src/session-tabs.ts).
      window.open(
        session && path ? `${location.pathname}?join=${encodeURIComponent(path)}` : location.href,
      );
      return Promise.resolve();
    },
    windowStart: () => Promise.resolve({ path: null, line: null, text: null }),
    readClipboardText: () => navigator.clipboard.readText(),
    // A browser tab is never asked to open a file.
    listenForFiles: () => Promise.resolve(),
  };
}
