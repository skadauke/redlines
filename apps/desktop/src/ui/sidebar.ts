// The file sidebar (design §5.1): the open document's project, which is its repository or else its
// own folder, as a tree opened down to the document. It lists the folders and the documents
// (Markdown and plain text), the only files Redlines opens, leaving out hidden ones and what git
// ignores, and reads a folder only when it is opened. Documents come first and open in this window,
// or in a new one with ⌘-click or while a run is live. Hidden by default.

import {
  basename,
  dirname,
  isDocument,
  type FileEntry,
  type Host,
  type ProjectRoot,
} from '../host.ts';
import { icon } from './icons.ts';

export interface SidebarOptions {
  host: Pick<Host, 'list' | 'allowDocument'>;
  /** Opens a document, in this window or in a new one. */
  openFile(path: string, how: { newWindow: boolean }): void;
  /**
   * Whether a run is live in this window. A click then opens a new window, so that the run's edits
   * never land in another document.
   */
  isRunLive?: () => boolean;
  /** Tells the person what went wrong, in one line. */
  notice(message: string): void;
}

/** A saved document, and the project it is in. */
export interface SidebarDocument {
  path: string;
  root: ProjectRoot;
}

export interface Sidebar {
  setOpen(open: boolean): void;
  /**
   * Shows the project of a document, with the folders down to it open and the document marked;
   * null for an untitled one.
   */
  setDocument(document: SidebarDocument | null): void;
  /** Reads the folders in view again, for files added or removed meanwhile. */
  refresh(): Promise<void>;
  destroy(): void;
}

/** Natural order: "plan 9" before "plan 10", and case aside. */
const NAMES = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/**
 * The documents, then the folders, each in natural order: hidden ones, and every other file, are
 * left out.
 */
export function sortEntries(entries: FileEntry[]): FileEntry[] {
  const byName = (a: FileEntry, b: FileEntry) => NAMES.compare(a.name, b.name);
  const visible = entries.filter((entry) => !entry.name.startsWith('.')).sort(byName);
  return [
    ...visible.filter((entry) => !entry.isDir && isDocument(entry.name)),
    ...visible.filter((entry) => entry.isDir),
  ];
}

/** The folders from `root`, which is left out, down to the one holding `path`. */
function foldersDownTo(path: string, root: string): string[] {
  const folders: string[] = [];
  for (let folder = dirname(path); folder !== root;) {
    const above = dirname(folder);
    // Not inside the root after all.
    if (folder.length <= root.length || above === folder) return [];
    folders.push(folder);
    folder = above;
  }
  return folders;
}

export function createSidebar(container: HTMLElement, options: SidebarOptions): Sidebar {
  const isRunLive = options.isRunLive ?? (() => false);
  const aside = document.createElement('aside');
  aside.className = 'rl-sidebar';
  aside.setAttribute('aria-label', 'Files');
  const head = document.createElement('div');
  head.className = 'rl-sidebar-head';
  // The space beside the window buttons drags the window, as the title bar does.
  head.dataset['tauriDragRegion'] = '';
  const label = document.createElement('div');
  label.className = 'rl-sidebar-label';
  const list = document.createElement('ul');
  list.className = 'rl-sidebar-list';
  aside.append(head, label, list);
  // Closed, it is out of the tab order and hidden from assistive technology.
  aside.inert = true;
  container.prepend(aside);

  let open = false;
  /** The document's file, which is marked. */
  let current: string | null = null;
  /** The folder at the top: the project's, or the document's own when the project is too broad. */
  let shown: string | null = null;
  /** Folders opened in the list, kept across refreshes. */
  const expanded = new Set<string>();
  /** What each folder held when it was last read; null for one that can't be read. */
  const listings = new Map<string, FileEntry[] | null>();
  /** The latest read of each folder, so that an older one that finishes late is dropped. */
  const latestRead = new Map<string, number>();
  let reads = 0;
  /** The files chosen, counted, so that only the last one opens. */
  let clicks = 0;
  /** Bumped when another folder is shown, so that what was read for the last one is dropped. */
  let epoch = 0;

  const read = async (folder: string, root: string) => {
    const mine = epoch;
    const ticket = ++reads;
    latestRead.set(folder, ticket);
    let entries: FileEntry[] | null;
    try {
      entries = sortEntries(await options.host.list(folder, root));
    } catch {
      entries = null;
    }
    if (mine === epoch && latestRead.get(folder) === ticket) listings.set(folder, entries);
  };

  /**
   * Reads the shown folder and the open folders in view, a level at a time, and draws them: all of
   * them when `fresh`, and otherwise only those not read yet.
   */
  const load = async (fresh: boolean) => {
    const root = shown;
    const mine = epoch;
    let level = root === null ? [] : [root];
    while (root !== null && level.length > 0) {
      await Promise.all(
        level.filter((folder) => fresh || !listings.has(folder)).map((f) => read(f, root)),
      );
      if (mine !== epoch) return;
      level = level.flatMap((folder) =>
        (listings.get(folder) ?? [])
          .filter((entry) => entry.isDir && expanded.has(entry.path))
          .map((entry) => entry.path),
      );
    }
    draw();
  };

  /** The read of every folder in view, shared by those who ask for one while it runs. */
  let reloading: Promise<void> | null = null;
  const reload = () =>
    (reloading ??= load(true).finally(() => {
      reloading = null;
    }));

  const draw = () => {
    if (shown === null) {
      label.textContent = '';
      list.replaceChildren(message('Save the document to see its folder here.'));
      return;
    }
    label.textContent = basename(shown) || 'Files';
    // Drawing the list again keeps the keyboard where it was.
    const active = document.activeElement;
    const focused =
      active instanceof HTMLElement && list.contains(active) ? active.dataset['path'] : undefined;
    list.replaceChildren(...rowsOf(shown, 0));
    if (focused !== undefined) {
      for (const button of list.querySelectorAll('button')) {
        if (button.dataset['path'] === focused) button.focus();
      }
    }
  };

  const rowsOf = (folder: string, depth: number): HTMLLIElement[] => {
    const entries = listings.get(folder);
    // Not read yet: it shows once it is.
    if (entries === undefined) return [];
    if (entries === null) return [message('This folder can’t be read.', depth)];
    if (entries.length === 0 && depth === 0) return [message('No files here.')];
    return entries.flatMap((entry) => [
      row(entry, depth),
      ...(entry.isDir && expanded.has(entry.path) ? rowsOf(entry.path, depth + 1) : []),
    ]);
  };

  const row = (entry: FileEntry, depth: number): HTMLLIElement => {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = entry.isDir ? 'rl-sidebar-item rl-sidebar-folder' : 'rl-sidebar-item';
    button.dataset['path'] = entry.path;
    button.style.setProperty('--rl-depth', String(depth));
    if (entry.isDir) {
      button.setAttribute('aria-expanded', String(expanded.has(entry.path)));
      button.append(icon('chevron', 12));
    }
    const name = document.createElement('span');
    name.className = 'rl-sidebar-name';
    name.textContent = entry.name;
    button.append(name);
    if (entry.path === current) button.setAttribute('aria-current', 'page');
    button.addEventListener('click', (event) => {
      if (entry.isDir) toggle(entry.path);
      else choose(entry, event.metaKey);
    });
    item.append(button);
    return item;
  };

  const toggle = (folder: string) => {
    if (expanded.delete(folder)) return draw();
    expanded.add(folder);
    // Read again: what it held when it was last open may have changed since.
    listings.delete(folder);
    draw();
    void load(false);
  };

  /**
   * Opens a document, the only file listed, once the app lets the window use it, which it does
   * for a file the sidebar shows: the window may read and write only the files the person opened.
   * The last click is the one that counts: a document the app is still allowing opens only if no
   * other file was chosen meanwhile.
   */
  const choose = (entry: FileEntry, metaKey: boolean) => {
    const click = ++clicks;
    const newWindow = metaKey || isRunLive();
    options.host.allowDocument(entry.path).then(
      () => {
        if (click === clicks) options.openFile(entry.path, { newWindow });
      },
      (error: unknown) => {
        // The app's own line when it has one.
        if (click === clicks) {
          options.notice(typeof error === 'string' ? error : `Couldn’t open “${entry.name}”.`);
        }
      },
    );
  };

  return {
    setOpen(next) {
      if (next === open) return;
      open = next;
      aside.inert = !open;
      if (open) void reload();
    },
    setDocument(next) {
      // A file saved into a folder that was read before it was there: read the folder again.
      if (next !== null && next.path !== current) listings.delete(dirname(next.path));
      current = next?.path ?? null;
      const folder =
        next === null ? null : next.root.tooBroad ? dirname(next.path) : next.root.folder;
      if (folder !== shown) {
        epoch++;
        shown = folder;
        expanded.clear();
        listings.clear();
        latestRead.clear();
      }
      if (next !== null && folder !== null) {
        for (const above of foldersDownTo(next.path, folder)) expanded.add(above);
      }
      if (open) void load(false);
    },
    async refresh() {
      if (open) await reload();
    },
    destroy() {
      epoch++;
      aside.remove();
    },
  };
}

function message(text: string, depth = 0): HTMLLIElement {
  const item = document.createElement('li');
  item.className = 'rl-sidebar-message';
  item.style.setProperty('--rl-depth', String(depth));
  item.textContent = text;
  return item;
}
