// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import type { FileEntry, ProjectRoot } from '../host.ts';
import { createSidebar, sortEntries, type SidebarOptions } from './sidebar.ts';

const file = (name: string, folder = '/docs'): FileEntry => ({
  name,
  path: `${folder}/${name}`,
  isDir: false,
});
const dir = (name: string, folder = '/docs'): FileEntry => ({
  name,
  path: `${folder}/${name}`,
  isDir: true,
});

/**
 * Folders in memory, each by its path, with its entries by name; a name ending in `/` is a folder.
 * The listing asks which project a folder is in, as the app's does.
 */
function folders(tree: Record<string, string[]>) {
  return vi.fn((folder: string, root: string): Promise<FileEntry[]> => {
    const names = tree[folder];
    if (!names || !folder.startsWith(root)) return Promise.reject(new Error(`No ${folder}`));
    return Promise.resolve(
      names.map((name) =>
        name.endsWith('/') ? dir(name.slice(0, -1), folder) : file(name, folder),
      ),
    );
  });
}

const REPO: ProjectRoot = { folder: '/repo', isRepo: true, tooBroad: false };

function repoTree(): Record<string, string[]> {
  return {
    '/repo': ['package.json', 'src/', 'docs/', 'README.md'],
    '/repo/docs': ['images/', 'format.md', 'design.md'],
    '/repo/docs/images': ['logo.png', 'diagram.pdf', 'scans.zip'],
    '/repo/src': ['main.ts'],
  };
}

function setUp(tree = repoTree(), more: Partial<SidebarOptions> = {}) {
  const container = document.createElement('div');
  const list = folders(tree);
  const openDefault = vi.fn<(path: string) => Promise<void>>(() => Promise.resolve());
  const openFile = vi.fn();
  const notice = vi.fn();
  const sidebar = createSidebar(container, {
    host: { list, openDefault },
    openFile,
    notice,
    ...more,
  });
  const buttons = () => [...container.querySelectorAll<HTMLButtonElement>('button')];
  const button = (name: string) => {
    const found = buttons().find((b) => b.textContent === name);
    if (!found) throw new Error(`No ${name} in ${rows().join(', ')}`);
    return found;
  };
  /** The rows, indented by depth, folders with a `/` after them. */
  const rows = () =>
    [...container.querySelectorAll<HTMLElement>('li')].map((item) => {
      const row = item.querySelector<HTMLElement>('button') ?? item;
      const depth = Number(row.style.getPropertyValue('--rl-depth') || 0);
      const folder = row.getAttribute('aria-expanded') === null ? '' : '/';
      return '  '.repeat(depth) + (row.textContent ?? '') + folder;
    });
  const label = () => container.querySelector('.rl-sidebar-label')?.textContent;
  return { container, sidebar, list, openDefault, openFile, notice, button, rows, label, tree };
}

const metaClick = (button: HTMLElement) =>
  button.dispatchEvent(new MouseEvent('click', { metaKey: true, bubbles: true }));

describe('sidebar', () => {
  it('lists Markdown files and folders first, then the other files, each in natural order', () => {
    const entries = [
      dir('notes'),
      file('plan 10.md'),
      file('image.png'),
      file('.hidden.md'),
      dir('.git'),
      file('plan 9.md'),
      file('Analysis.Rmd'),
      file('LICENSE'),
      dir('Archive'),
      file('slides.qmd'),
    ];
    expect(sortEntries(entries).map((entry) => entry.name)).toEqual([
      'Analysis.Rmd',
      'plan 9.md',
      'plan 10.md',
      'slides.qmd',
      'Archive',
      'notes',
      'image.png',
      'LICENSE',
    ]);
  });

  it('roots at the repo and expands down to the open document', async () => {
    const { sidebar, list, rows, label, button } = setUp();
    sidebar.setDocument({ path: '/repo/docs/design.md', root: REPO });
    // Closed, it reads nothing.
    expect(list).not.toHaveBeenCalled();
    sidebar.setOpen(true);
    await sidebar.refresh();
    expect(label()).toBe('repo');
    expect(rows()).toEqual([
      'README.md',
      'docs/',
      '  design.md',
      '  format.md',
      '  images/',
      'src/',
      'package.json',
    ]);
    expect(button('docs').getAttribute('aria-expanded')).toBe('true');
    expect(button('src').getAttribute('aria-expanded')).toBe('false');
    expect(button('design.md').getAttribute('aria-current')).toBe('page');
    expect(button('README.md').hasAttribute('aria-current')).toBe(false);
    // Every folder is read within the project.
    for (const [, root] of list.mock.calls) expect(root).toBe('/repo');
  });

  it("lists the document's own folder when the root is too broad", async () => {
    const { sidebar, list, rows, label } = setUp({
      '/Users/ada': ['Library/', 'notes/'],
      '/Users/ada/notes': ['plan.md', 'trip/'],
    });
    sidebar.setDocument({
      path: '/Users/ada/notes/plan.md',
      root: { folder: '/Users/ada', isRepo: false, tooBroad: true },
    });
    sidebar.setOpen(true);
    await sidebar.refresh();
    expect(label()).toBe('notes');
    expect(rows()).toEqual(['plan.md', 'trip/']);
    expect(list.mock.calls).toEqual([['/Users/ada/notes', '/Users/ada/notes']]);
  });

  it('reads a folder only when expanded', async () => {
    const { sidebar, list, rows, button } = setUp();
    sidebar.setDocument({ path: '/repo/docs/design.md', root: REPO });
    sidebar.setOpen(true);
    await sidebar.refresh();
    const read = () => list.mock.calls.map(([folder]) => folder);
    expect(new Set(read())).toEqual(new Set(['/repo', '/repo/docs']));

    list.mockClear();
    button('src').click();
    await vi.waitFor(() => expect(rows()).toContain('  main.ts'));
    // Only the folder that opened: the others are as they were read.
    expect(read()).toEqual(['/repo/src']);

    // Closing a folder reads nothing.
    list.mockClear();
    button('src').click();
    expect(rows()).not.toContain('  main.ts');
    expect(button('src').getAttribute('aria-expanded')).toBe('false');
    expect(list).not.toHaveBeenCalled();
  });

  it('reads the folders in view again on refresh, keeping those that are open', async () => {
    const { sidebar, rows, button, tree } = setUp();
    sidebar.setDocument({ path: '/repo/docs/design.md', root: REPO });
    sidebar.setOpen(true);
    await sidebar.refresh();
    button('src').click();
    await vi.waitFor(() => expect(rows()).toContain('  main.ts'));
    tree['/repo/src']?.push('agents.ts');
    tree['/repo/docs']?.push('plan.md');
    await sidebar.refresh();
    expect(rows()).toEqual([
      'README.md',
      'docs/',
      '  design.md',
      '  format.md',
      '  plan.md',
      '  images/',
      'src/',
      '  agents.ts',
      '  main.ts',
      'package.json',
    ]);
  });

  it('keeps the open folders when another document in the project opens', async () => {
    const { sidebar, rows, button, list } = setUp();
    sidebar.setDocument({ path: '/repo/README.md', root: REPO });
    sidebar.setOpen(true);
    await sidebar.refresh();
    expect(rows()).toEqual(['README.md', 'docs/', 'src/', 'package.json']);
    button('src').click();
    await vi.waitFor(() => expect(rows()).toContain('  main.ts'));

    sidebar.setDocument({ path: '/repo/docs/design.md', root: REPO });
    await vi.waitFor(() => expect(rows()).toContain('  design.md'));
    expect(rows()).toContain('  main.ts');
    expect(button('design.md').getAttribute('aria-current')).toBe('page');

    // Another project starts with only the way down to its document open.
    list.mockClear();
    sidebar.setDocument({
      path: '/elsewhere/plan.md',
      root: { folder: '/elsewhere', isRepo: false, tooBroad: false },
    });
    await vi.waitFor(() => expect(list).toHaveBeenCalledWith('/elsewhere', '/elsewhere'));
  });

  it('marks other files one step grayer', async () => {
    const { sidebar, button } = setUp();
    sidebar.setDocument({ path: '/repo/README.md', root: REPO });
    sidebar.setOpen(true);
    await sidebar.refresh();
    expect(button('package.json').classList).toContain('rl-sidebar-other');
    expect(button('README.md').classList).not.toContain('rl-sidebar-other');
    expect(button('docs').classList).not.toContain('rl-sidebar-other');
  });

  it('opens Markdown here and a new window with ⌘-click', async () => {
    const { sidebar, button, openFile, openDefault } = setUp();
    sidebar.setDocument({ path: '/repo/docs/design.md', root: REPO });
    sidebar.setOpen(true);
    await sidebar.refresh();
    button('README.md').click();
    expect(openFile).toHaveBeenLastCalledWith('/repo/README.md', { newWindow: false });
    metaClick(button('format.md'));
    expect(openFile).toHaveBeenLastCalledWith('/repo/docs/format.md', { newWindow: true });
    // A folder has no document to open: ⌘-click opens it in the list, as a click does.
    metaClick(button('src'));
    expect(openFile).toHaveBeenCalledTimes(2);
    expect(openDefault).not.toHaveBeenCalled();
  });

  it('opens images and PDFs in their default app, and text files in the viewer', async () => {
    const { sidebar, button, rows, openFile, openDefault, notice } = setUp();
    sidebar.setDocument({ path: '/repo/docs/design.md', root: REPO });
    sidebar.setOpen(true);
    await sidebar.refresh();
    button('images').click();
    await vi.waitFor(() => expect(rows()).toContain('    logo.png'));
    button('logo.png').click();
    // Within the project, which the app checks the file against.
    expect(openDefault).toHaveBeenLastCalledWith('/repo/docs/images/logo.png', '/repo');
    metaClick(button('diagram.pdf'));
    expect(openDefault).toHaveBeenLastCalledWith('/repo/docs/images/diagram.pdf', '/repo');
    // Text files open as Markdown ones do: here, or in a new window with ⌘-click.
    button('package.json').click();
    expect(openFile).toHaveBeenLastCalledWith('/repo/package.json', { newWindow: false });
    metaClick(button('package.json'));
    expect(openFile).toHaveBeenLastCalledWith('/repo/package.json', { newWindow: true });
    expect(openDefault).toHaveBeenCalledTimes(2);

    // What went wrong is one line.
    openDefault.mockRejectedValueOnce('Redlines opens Markdown, images and PDFs.');
    button('logo.png').click();
    await vi.waitFor(() =>
      expect(notice).toHaveBeenCalledWith('Redlines opens Markdown, images and PDFs.'),
    );
    openDefault.mockRejectedValueOnce(new Error('no'));
    button('logo.png').click();
    await vi.waitFor(() => expect(notice).toHaveBeenLastCalledWith('Couldn’t open “logo.png”.'));
  });

  it('does nothing for any other file, and says so when the pointer rests on it', async () => {
    const { sidebar, button, rows, openFile, openDefault, notice } = setUp();
    sidebar.setDocument({ path: '/repo/docs/design.md', root: REPO });
    sidebar.setOpen(true);
    await sidebar.refresh();
    button('images').click();
    await vi.waitFor(() => expect(rows()).toContain('    scans.zip'));
    expect(button('scans.zip').title).toBe('Redlines opens Markdown, text, images and PDFs');
    button('scans.zip').click();
    metaClick(button('scans.zip'));
    expect(openDefault).not.toHaveBeenCalled();
    expect(openFile).not.toHaveBeenCalled();
    expect(notice).not.toHaveBeenCalled();
    for (const name of ['design.md', 'package.json', 'logo.png', 'diagram.pdf', 'images']) {
      expect(button(name).title, name).toBe('');
    }
  });

  it('reads the document’s folder again when a file saved into it becomes the document', async () => {
    const { sidebar, rows, button, tree, list } = setUp();
    sidebar.setDocument({ path: '/repo/docs/design.md', root: REPO });
    sidebar.setOpen(true);
    await sidebar.refresh();
    // Save As into the folder in view: the file is there before the window's focus comes back.
    tree['/repo/docs']?.push('plan.md');
    list.mockClear();
    sidebar.setDocument({ path: '/repo/docs/plan.md', root: REPO });
    await vi.waitFor(() => expect(rows()).toContain('  plan.md'));
    expect(button('plan.md').getAttribute('aria-current')).toBe('page');
    expect(list.mock.calls.map(([folder]) => folder)).toEqual(['/repo/docs']);
  });

  it('shows the disk’s root for a document there', async () => {
    const { sidebar, rows, label, list } = setUp({ '/': ['Users/', 'plan.md'] });
    sidebar.setDocument({ path: '/plan.md', root: { folder: '/', isRepo: false, tooBroad: true } });
    sidebar.setOpen(true);
    await sidebar.refresh();
    expect(list.mock.calls).toEqual([['/', '/']]);
    expect(rows()).toEqual(['plan.md', 'Users/']);
    expect(label()).toBe('Files');
  });

  it('opens a new window instead of replacing the document while a run is live', async () => {
    let live = true;
    const { sidebar, button, openFile } = setUp(repoTree(), { isRunLive: () => live });
    sidebar.setDocument({ path: '/repo/docs/design.md', root: REPO });
    sidebar.setOpen(true);
    await sidebar.refresh();
    button('README.md').click();
    expect(openFile).toHaveBeenLastCalledWith('/repo/README.md', { newWindow: true });
    live = false;
    button('README.md').click();
    expect(openFile).toHaveBeenLastCalledWith('/repo/README.md', { newWindow: false });
  });

  it('says so when a folder can’t be read, and asks to save an untitled document', async () => {
    const { sidebar, rows } = setUp({ '/repo': ['docs/'] });
    sidebar.setDocument({ path: '/repo/docs/design.md', root: REPO });
    sidebar.setOpen(true);
    await sidebar.refresh();
    expect(rows()).toEqual(['docs/', '  This folder can’t be read.']);
    sidebar.setDocument(null);
    await sidebar.refresh();
    expect(rows()).toEqual(['Save the document to see its folder here.']);
  });
});
