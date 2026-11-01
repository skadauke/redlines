// @vitest-environment happy-dom
import type { WatchEvent } from '@tauri-apps/plugin-fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHost, isAboutFile, watchFile, type FileEvent } from './host.ts';

// The events the file system plugin reports, as its watcher (the `notify` crate) serializes them.
const modified = (...paths: string[]): FileEvent => ({
  type: { modify: { kind: 'data', mode: 'content' } },
  paths,
});
const renamed = (mode: 'from' | 'to' | 'both', ...paths: string[]): FileEvent => ({
  type: { modify: { kind: 'rename', mode } },
  paths,
});
const created = (...paths: string[]): FileEvent => ({ type: { create: { kind: 'file' } }, paths });
const removed = (...paths: string[]): FileEvent => ({ type: { remove: { kind: 'file' } }, paths });
const read = (...paths: string[]): FileEvent => ({
  type: { access: { kind: 'close', mode: 'read' } },
  paths,
});

describe('isAboutFile', () => {
  it('is true for changes to the file', () => {
    expect(isAboutFile(modified('/docs/plan.md'), 'plan.md')).toBe(true);
    expect(isAboutFile(created('/docs/plan.md'), 'plan.md')).toBe(true);
    expect(isAboutFile(removed('/docs/plan.md'), 'plan.md')).toBe(true);
  });

  it('is true when another file is renamed over it, as the command line writes', () => {
    const temporary = '/docs/.plan.md.1a2b3c4d.tmp';
    expect(isAboutFile(renamed('both', temporary, '/docs/plan.md'), 'plan.md')).toBe(true);
    expect(isAboutFile(renamed('to', '/docs/plan.md'), 'plan.md')).toBe(true);
    // A rename away is a change too: the file is gone.
    expect(isAboutFile(renamed('from', '/docs/plan.md'), 'plan.md')).toBe(true);
  });

  it('is false for the other files in the folder, even those named after it', () => {
    for (const other of [
      '/docs/other.md',
      '/docs/.plan.md.1a2b3c4d.tmp',
      '/docs/plan.md.bak',
      '/docs/old-plan.md',
      '/docs/.DS_Store',
    ]) {
      expect(isAboutFile(modified(other), 'plan.md')).toBe(false);
      expect(isAboutFile(renamed('from', other), 'plan.md')).toBe(false);
    }
  });

  it('is false for reads of the file, which reloading would only make again', () => {
    expect(isAboutFile(read('/docs/plan.md'), 'plan.md')).toBe(false);
    expect(isAboutFile({ type: { access: { kind: 'open', mode: 'any' } }, paths: [] }, 'x')).toBe(
      false,
    );
  });

  it('is true for an event without a path: events were lost, so the file may have changed', () => {
    expect(isAboutFile({ type: 'other', paths: [] }, 'plan.md')).toBe(true);
    expect(isAboutFile({ type: 'any', paths: [] }, 'plan.md')).toBe(true);
  });

  it('takes the file system’s view of a name: case and Unicode form do not matter', () => {
    // macOS keeps the case a file was made with and stores accents in their decomposed form, but
    // finds the file by either.
    expect(isAboutFile(modified('/docs/Plan.MD'), 'plan.md')).toBe(true);
    expect(isAboutFile(modified('/docs/cafe\u0301.md'), 'caf\u00e9.md')).toBe(true);
    expect(isAboutFile(modified('/docs/caf\u00e9.md'), 'cafe\u0301.md')).toBe(true);
  });

  it('finds the name in a Windows path', () => {
    expect(isAboutFile(modified('C:\\docs\\plan.md'), 'plan.md')).toBe(true);
    expect(isAboutFile(modified('C:\\docs\\other.md'), 'plan.md')).toBe(false);
  });
});

/** The file system plugin's watch, which records what is watched; tests send it events. */
function fakeWatch(refuse: (path: string) => boolean = () => false) {
  const watching = new Map<string, (event: WatchEvent) => void>();
  const watchPath = vi.fn((path: string, onEvent: (event: WatchEvent) => void) => {
    if (refuse(path)) return Promise.reject(new Error(`forbidden path: ${path}`));
    watching.set(path, onEvent);
    return Promise.resolve(() => void watching.delete(path));
  });
  const send = (path: string, event: FileEvent) => watching.get(path)?.({ ...event, attrs: {} });
  return { watching, watchPath, send };
}

describe('watchFile', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('watches the file’s folder, which survives the file being replaced by a rename', async () => {
    const { watching, watchPath } = fakeWatch();
    await watchFile('/docs/plan.md', vi.fn(), watchPath);
    // A watch on the file itself stays with the file it found (on Linux, inotify), so the
    // command line's first atomic write would end it.
    expect([...watching.keys()]).toEqual(['/docs']);
    expect(watchPath).toHaveBeenCalledTimes(1);
  });

  it('reports changes to the file, as many times as it changes', async () => {
    const { watchPath, send } = fakeWatch();
    const onChange = vi.fn();
    await watchFile('/docs/plan.md', onChange, watchPath);

    send('/docs', modified('/docs/other.md'));
    send('/docs', created('/docs/.plan.md.1a2b3c4d.tmp'));
    send('/docs', read('/docs/plan.md'));
    expect(onChange).not.toHaveBeenCalled();

    send('/docs', renamed('both', '/docs/.plan.md.1a2b3c4d.tmp', '/docs/plan.md'));
    expect(onChange).toHaveBeenCalledTimes(1);
    send('/docs', renamed('both', '/docs/.plan.md.5e6f7a8b.tmp', '/docs/plan.md'));
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('stops watching when told to', async () => {
    const { watching, watchPath } = fakeWatch();
    const stop = await watchFile('/docs/plan.md', vi.fn(), watchPath);
    stop();
    expect(watching.size).toBe(0);
  });

  it('watches the file itself when its folder may not be watched', async () => {
    // A file opened from outside the home folder is allowed by itself, not its folder.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { watching, watchPath, send } = fakeWatch((path) => path === '/Volumes/work');
    const onChange = vi.fn();
    const stop = await watchFile('/Volumes/work/plan.md', onChange, watchPath);
    expect([...watching.keys()]).toEqual(['/Volumes/work/plan.md']);
    expect(warn).toHaveBeenCalled();

    send('/Volumes/work/plan.md', modified('/Volumes/work/plan.md'));
    expect(onChange).toHaveBeenCalledTimes(1);
    stop();
    expect(watching.size).toBe(0);
  });

  it('fails when neither the folder nor the file can be watched', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { watchPath } = fakeWatch(() => true);
    await expect(watchFile('/docs/plan.md', vi.fn(), watchPath)).rejects.toThrow(
      'forbidden path: /docs/plan.md',
    );
  });

  it('watches a file given without a folder itself', async () => {
    const { watching, watchPath } = fakeWatch();
    await watchFile('plan.md', vi.fn(), watchPath);
    expect([...watching.keys()]).toEqual(['plan.md']);
  });
});

describe('the host in a browser tab', () => {
  // The page's own dialog, which has two buttons, OK and Cancel.
  const confirm = vi.fn<(message?: string) => boolean>();
  beforeEach(() => {
    vi.stubGlobal('confirm', confirm);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    confirm.mockReset();
  });

  it('saves the changes when OK is chosen, and keeps them when Cancel is', async () => {
    const host = createHost();

    confirm.mockReturnValue(true);
    expect(await host.askToSave('plan.md')).toBe('save');
    expect(confirm).toHaveBeenLastCalledWith('Save the changes you made to “plan.md”?');

    // Cancel is "never mind", not "throw them away".
    confirm.mockReturnValue(false);
    expect(await host.askToSave('plan.md')).toBe('cancel');
  });

  it('overwrites a changed file when OK is chosen, and leaves it when Cancel is', async () => {
    const host = createHost();
    confirm.mockReturnValue(true);
    expect(await host.askToOverwrite('plan.md')).toBe('overwrite');
    confirm.mockReturnValue(false);
    expect(await host.askToOverwrite('plan.md')).toBe('cancel');
  });
});
