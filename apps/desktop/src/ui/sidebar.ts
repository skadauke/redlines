// The file sidebar (design §5.1): the open document's project, which is its repository or else its
// own folder, as a tree opened down to the document. It lists the folders and the documents
// (Markdown and plain text), the only files Redlines opens, leaving out hidden ones and what git
// ignores, and reads a folder only when it is opened. Documents come first and open in this window,
// or in a new one with ⌘-click or while a run is live. Hidden by default.

import { documentKind } from '../file-names.ts';
import {
  basename,
  dirname,
  isDocument,
  type FileEntry,
  type Host,
  type ProjectRoot,
} from '../host.ts';
import { isImageName } from '../image-add.ts';
import { icon } from './icons.ts';
import { createSidebarResize } from './sidebar-resize.ts';

/**
 * The media query for a page too narrow to hold the sidebar beside it (the sidebar's 240 px, and a
 * page of at least 360): a window under 600 CSS px, as a zoomed small window is. The sidebar then
 * covers the left of the page instead of pushing it (styles.css), and closes when a document is
 * chosen in it (main.ts).
 */
export const SIDEBAR_COVERS = '(max-width: 599.98px)';

export interface SidebarOptions {
  host: Pick<Host, 'list' | 'allowDocument'>;
  /** Opens a document, in this window or in a new one. */
  openFile(path: string, how: { newWindow: boolean }): void;
  /**
   * Whether a run is live in this window. A click then opens a new window, so that the run's edits
   * never land in another document.
   */
  isRunLive?: () => boolean;
  /**
   * Whether text and code files (Plain-only documents) are listed. Off, only the one that is open
   * is. Default: listed.
   */
  showPlainOnly?: () => boolean;
  /** Tells the person what went wrong, in one line. */
  notice(message: string): void;
  /**
   * Where an image dragged out of the sidebar goes (#681, #1198): the pointer is over the page at
   * the client point (`over`), is let go there (`drop`, with the image's path), or leaves (`leave`).
   * The row is dragged with the pointer, not as an HTML drag, which the app's web view never
   * delivers to the page. Default: none, and the rows can't be dragged.
   */
  imageDrag?: {
    over(at: { x: number; y: number }): void;
    drop(at: { x: number; y: number }, path: string): void;
    leave(): void;
  };
  /** The edge was dragged: keep the width (#680). */
  onResize?(width: number): void;
  /** The edge was dragged shut: close the sidebar, as ⌃⌘S does. */
  onClose?(): void;
  /**
   * The chat panel (#1194): with it the sidebar has a second view, Chat, beside Files, switched by
   * a control at its head. Without it the sidebar has only the file list, as it did.
   */
  chat?: HTMLElement;
  /** The view changed, from the control or from `setView`. */
  onView?(view: SidebarView): void;
  /**
   * The foot (#1194): the person's name, a settings button and a report-a-bug button. Without it
   * the sidebar has no foot.
   */
  foot?: {
    /** The name to show, as the app knows the person. */
    name(): string;
    /** Opens Preferences. */
    settings(): void;
    /** Opens the problem report. */
    report(): void;
  };
}

/** What the sidebar lists: the project's files, or the document's chat. */
type SidebarView = 'files' | 'chat';

/** A saved document, and the project it is in. */
interface SidebarDocument {
  path: string;
  root: ProjectRoot;
}

interface Sidebar {
  setOpen(open: boolean): void;
  /** Shows the file list or the chat (ignored without a chat panel). */
  setView(view: SidebarView): void;
  readonly view: SidebarView;
  /** Draws the foot's name again, after Preferences changed it. */
  refreshFoot(): void;
  /** The width to draw, in CSS px (a stored one is made right). */
  setWidth(width: number): void;
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
 * The documents, then the images, which are dragged into a document, then the folders, each in
 * natural order: hidden ones, and every other file, are left out.
 */
export function sortEntries(entries: FileEntry[]): FileEntry[] {
  const byName = (a: FileEntry, b: FileEntry) => NAMES.compare(a.name, b.name);
  const visible = entries.filter((entry) => !entry.name.startsWith('.')).sort(byName);
  return [
    ...visible.filter((entry) => !entry.isDir && isDocument(entry.name)),
    ...visible.filter(
      (entry) => !entry.isDir && !isDocument(entry.name) && isImageName(entry.name),
    ),
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
  aside.append(head);
  const tabs = document.createElement('div');
  const filesTab = document.createElement('button');
  const chatTab = document.createElement('button');
  let view: SidebarView = 'files';
  if (options.chat) {
    tabs.className = 'rl-sidebar-tabs';
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Sidebar');
    for (const [button, name, which] of [
      [filesTab, 'Files', 'files'],
      [chatTab, 'Chat', 'chat'],
    ] as const) {
      button.type = 'button';
      button.className = 'rl-sidebar-tab';
      button.setAttribute('role', 'tab');
      button.id = `rl-sidebar-tab-${which}`;
      button.setAttribute('aria-controls', `rl-sidebar-panel-${which}`);
      button.textContent = name;
      button.addEventListener('click', () => show(which));
      tabs.append(button);
    }
    tabs.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      show(view === 'files' ? 'chat' : 'files', true);
    });
    aside.append(tabs);
  }
  aside.append(label, list);
  if (options.chat) {
    // Each tab names the panel it shows, and each panel the tab that shows it.
    list.id = 'rl-sidebar-panel-files';
    list.setAttribute('role', 'tabpanel');
    list.setAttribute('aria-labelledby', 'rl-sidebar-tab-files');
    options.chat.id = 'rl-sidebar-panel-chat';
    options.chat.setAttribute('role', 'tabpanel');
    options.chat.setAttribute('aria-labelledby', 'rl-sidebar-tab-chat');
    options.chat.hidden = true;
    aside.append(options.chat);
  }
  const foot = document.createElement('div');
  const footName = document.createElement('button');
  if (options.foot) {
    foot.className = 'rl-sidebar-foot';
    footName.type = 'button';
    footName.className = 'rl-sidebar-foot-name';
    footName.title = 'Your name, in Preferences';
    footName.addEventListener('click', () => options.foot?.settings());
    const settings = document.createElement('button');
    settings.type = 'button';
    settings.className = 'rl-sidebar-foot-button';
    settings.title = 'Preferences';
    settings.setAttribute('aria-label', 'Preferences');
    settings.append(icon('general', 16));
    settings.addEventListener('click', () => options.foot?.settings());
    const report = document.createElement('button');
    report.type = 'button';
    report.className = 'rl-sidebar-foot-button';
    report.title = 'Report a problem';
    report.setAttribute('aria-label', 'Report a problem');
    report.append(icon('bug', 16));
    report.addEventListener('click', () => options.foot?.report());
    foot.append(footName, settings, report);
    aside.append(foot);
  }
  const drawFoot = () => {
    if (!options.foot) return;
    const name = options.foot.name();
    const initial = document.createElement('span');
    initial.className = 'rl-sidebar-foot-initial';
    initial.textContent = [...name.trim()][0]?.toUpperCase() ?? '';
    initial.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    text.className = 'rl-sidebar-foot-text';
    text.textContent = name;
    footName.replaceChildren(initial, text);
    footName.setAttribute('aria-label', `${name}: Preferences`);
  };
  /** Shows a view: the file list under its label, or the chat. */
  function show(next: SidebarView, focus = false): void {
    if (!options.chat) return;
    view = next;
    label.hidden = list.hidden = next !== 'files';
    options.chat.hidden = next !== 'chat';
    for (const [button, which] of [
      [filesTab, 'files'],
      [chatTab, 'chat'],
    ] as const) {
      const on = which === next;
      button.setAttribute('aria-selected', String(on));
      button.tabIndex = on ? 0 : -1;
      if (on && focus) button.focus();
    }
    options.onView?.(next);
  }
  show('files');
  drawFoot();
  const resize = createSidebarResize({
    aside,
    app: container,
    onResize: (width) => options.onResize?.(width),
    onClose: () => options.onClose?.(),
  });
  // Closed, it is out of the tab order and hidden from assistive technology.
  aside.inert = true;
  container.prepend(aside);

  let open = false;
  /** The document's file, which is marked. */
  let current: string | null = null;
  /** The folder at the top: the project's; none when the project is too broad (#451). */
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
      list.replaceChildren(
        message(
          current === null
            ? 'Save the document to see its folder here.'
            : 'This file is in your home folder or above, so it opens on its own.',
        ),
      );
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
    const hidden = (entry: FileEntry) =>
      !entry.isDir &&
      options.showPlainOnly?.() === false &&
      documentKind(entry.name) === 'plain-only' &&
      entry.path !== current;
    const listed = entries.filter((entry) => !hidden(entry));
    if (listed.length === 0 && depth === 0) return [message('No files here.')];
    return listed.flatMap((entry) => [
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
    // A text or code file is in the secondary ink: its suffix says what it is, and it has no review.
    if (!entry.isDir && documentKind(entry.name) === 'plain-only') {
      button.classList.add('rl-sidebar-plain');
    }
    if (entry.path === current) button.setAttribute('aria-current', 'page');
    if (!entry.isDir && !isDocument(entry.name)) {
      // An image is not opened: it is dragged into the document, which links it by its path (#681).
      button.classList.add('rl-sidebar-image');
      if (options.imageDrag) {
        button.title = 'Drag into the document to insert it';
        button.addEventListener('pointerdown', (event) => beginImageDrag(event, button, entry));
      }
    } else {
      button.addEventListener('click', (event) => {
        if (entry.isDir) toggle(entry.path);
        else choose(entry, event.metaKey);
      });
    }
    item.append(button);
    return item;
  };

  /** Ends the image drag that is going on, if any. */
  let endDrag: (() => void) | null = null;

  /**
   * A press on an image row, and the pointer's drag from it (#1198): past a few pixels a label
   * follows the pointer, the document shows where the image would go, and letting go there writes
   * the link. A press that goes nowhere does nothing, and Escape gives the drag up.
   */
  const beginImageDrag = (press: PointerEvent, button: HTMLElement, entry: FileEntry) => {
    const target = options.imageDrag;
    if (!target || press.button !== 0 || endDrag) return;
    const start = { x: press.clientX, y: press.clientY };
    let label: HTMLElement | null = null;
    const at = (event: PointerEvent) => ({ x: event.clientX, y: event.clientY });
    const move = (event: PointerEvent) => {
      if (!label) {
        if (Math.hypot(event.clientX - start.x, event.clientY - start.y) < 4) return;
        label = document.createElement('div');
        label.className = 'rl-sidebar-drag';
        label.textContent = entry.name;
        label.setAttribute('aria-hidden', 'true');
        document.body.append(label);
        document.body.classList.add('rl-image-dragging');
      }
      label.style.left = `${event.clientX + 12}px`;
      label.style.top = `${event.clientY + 12}px`;
      target.over(at(event));
    };
    const finish = (event: PointerEvent | null) => {
      const dragged = label !== null;
      cleanup();
      if (!dragged) return;
      if (event) target.drop(at(event), entry.path);
      else target.leave();
    };
    const up = (event: PointerEvent) => finish(event);
    const cancel = () => finish(null);
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancel();
    };
    // A click after a drag is no click: the row does nothing either way.
    const cleanup = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', key, true);
      label?.remove();
      label = null;
      document.body.classList.remove('rl-image-dragging');
      endDrag = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', key, true);
    endDrag = () => {
      cleanup();
      target.leave();
    };
    button.focus();
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
    setWidth(width) {
      resize.setWidth(width);
    },
    setView(next) {
      if (next !== view) show(next);
    },
    get view() {
      return view;
    },
    refreshFoot: drawFoot,
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
      // The home folder, or a folder above it, is no project: the file opens on its own.
      const folder = next === null || next.root.tooBroad ? null : next.root.folder;
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
      endDrag?.();
      resize.destroy();
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
