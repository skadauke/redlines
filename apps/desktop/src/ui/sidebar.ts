// The file sidebar (design §5.1): the open document's folder, Markdown files first and then
// folders, which open in place. Choosing a file opens it in this window. Hidden by default.

import { basename, dirname, isMarkdown, type FileEntry, type Host } from '../host.ts';
import { icon } from './icons.ts';

export interface SidebarOptions {
  host: Pick<Host, 'list'>;
  openFile(path: string): void;
}

export interface Sidebar {
  setOpen(open: boolean): void;
  /** Shows the folder of the document at `path`, marking the document; null for an untitled one. */
  setDocument(path: string | null): void;
  /** Lists the folder again, for files added or removed meanwhile. */
  refresh(): Promise<void>;
  destroy(): void;
}

/** Markdown files, then folders, each in natural order; hidden files and other files are left out. */
export function sortEntries(entries: FileEntry[]): FileEntry[] {
  const byName = (a: FileEntry, b: FileEntry) =>
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  const visible = entries.filter((entry) => !entry.name.startsWith('.'));
  return [
    ...visible.filter((entry) => !entry.isDir && isMarkdown(entry.name)).sort(byName),
    ...visible.filter((entry) => entry.isDir).sort(byName),
  ];
}

export function createSidebar(container: HTMLElement, options: SidebarOptions): Sidebar {
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
  let current: string | null = null;
  let folder: string | null = null;
  /** Folders opened in the list, kept across refreshes. */
  const expanded = new Set<string>();
  /** Bumped on every render, so that a slow listing can't overwrite a newer one. */
  let generation = 0;

  const render = async () => {
    const mine = ++generation;
    if (folder === null) {
      label.textContent = '';
      list.replaceChildren(message('Save the document to see its folder here.'));
      return;
    }
    label.textContent = basename(folder) || 'Files';
    const rows = await renderFolder(folder, 0);
    if (mine === generation) list.replaceChildren(...rows);
  };

  const renderFolder = async (path: string, depth: number): Promise<HTMLLIElement[]> => {
    let entries: FileEntry[];
    try {
      entries = sortEntries(await options.host.list(path));
    } catch {
      return [message('This folder can’t be read.', depth)];
    }
    if (entries.length === 0 && depth === 0) return [message('No Markdown files here.')];
    const rows: HTMLLIElement[] = [];
    for (const entry of entries) {
      rows.push(row(entry, depth));
      if (entry.isDir && expanded.has(entry.path))
        rows.push(...(await renderFolder(entry.path, depth + 1)));
    }
    return rows;
  };

  const row = (entry: FileEntry, depth: number): HTMLLIElement => {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = entry.isDir ? 'rl-sidebar-item rl-sidebar-folder' : 'rl-sidebar-item';
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
    button.addEventListener('click', () => {
      if (!entry.isDir) return options.openFile(entry.path);
      if (expanded.has(entry.path)) expanded.delete(entry.path);
      else expanded.add(entry.path);
      void render();
    });
    item.append(button);
    return item;
  };

  return {
    setOpen(next) {
      if (next === open) return;
      open = next;
      aside.inert = !open;
      if (open) void render();
    },
    setDocument(path) {
      current = path;
      const next = path === null ? null : dirname(path);
      if (next !== folder) expanded.clear();
      folder = next;
      if (open) void render();
    },
    async refresh() {
      if (open) await render();
    },
    destroy() {
      generation++;
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
