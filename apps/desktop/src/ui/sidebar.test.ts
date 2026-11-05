// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import type { FileEntry } from '../host.ts';
import { createSidebar, sortEntries } from './sidebar.ts';

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

describe('sidebar', () => {
  it('lists Markdown files first, then folders, in natural order', () => {
    const entries = [
      dir('notes'),
      file('plan 10.md'),
      file('image.png'),
      file('.hidden.md'),
      dir('.git'),
      file('plan 9.md'),
      file('Analysis.Rmd'),
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
    ]);
  });

  it('opens a file when it is clicked, and marks the open one', async () => {
    const container = document.createElement('div');
    const list = vi.fn((folder: string) =>
      Promise.resolve(folder === '/docs' ? [file('a.md'), file('b.md')] : []),
    );
    const openFile = vi.fn();
    const sidebar = createSidebar(container, { host: { list }, openFile });
    sidebar.setDocument('/docs/a.md');
    expect(list).not.toHaveBeenCalled();
    sidebar.setOpen(true);
    await sidebar.refresh();
    const buttons = [...container.querySelectorAll('button')];
    expect(buttons.map((b) => b.textContent)).toEqual(['a.md', 'b.md']);
    expect(buttons[0]?.getAttribute('aria-current')).toBe('page');
    buttons[1]?.click();
    expect(openFile).toHaveBeenCalledWith('/docs/b.md', { newWindow: false });
  });

  it('opens a file in a new window with ⌘-click', async () => {
    const container = document.createElement('div');
    const list = vi.fn((folder: string) =>
      Promise.resolve(folder === '/docs' ? [file('a.md'), dir('notes')] : []),
    );
    const openFile = vi.fn();
    const sidebar = createSidebar(container, { host: { list }, openFile });
    sidebar.setDocument('/docs/a.md');
    sidebar.setOpen(true);
    await sidebar.refresh();
    const [a, notes] = container.querySelectorAll('button');
    a?.dispatchEvent(new MouseEvent('click', { metaKey: true, bubbles: true }));
    expect(openFile).toHaveBeenCalledWith('/docs/a.md', { newWindow: true });
    // A folder has no document to open: ⌘-click opens it in the list, as a click does.
    notes?.dispatchEvent(new MouseEvent('click', { metaKey: true, bubbles: true }));
    expect(openFile).toHaveBeenCalledOnce();
  });

  it('routes a sidebar click to a new window while a run is live', async () => {
    const container = document.createElement('div');
    const list = vi.fn(() => Promise.resolve([file('a.md'), file('b.md')]));
    const openFile = vi.fn();
    let live = true;
    const sidebar = createSidebar(container, {
      host: { list },
      openFile,
      isRunLive: () => live,
    });
    sidebar.setDocument('/docs/a.md');
    sidebar.setOpen(true);
    await sidebar.refresh();
    const [, b] = container.querySelectorAll('button');
    // The run's tools act on this document, so nothing may take its place.
    b?.click();
    expect(openFile).toHaveBeenLastCalledWith('/docs/b.md', { newWindow: true });
    live = false;
    b?.click();
    expect(openFile).toHaveBeenLastCalledWith('/docs/b.md', { newWindow: false });
  });
});
