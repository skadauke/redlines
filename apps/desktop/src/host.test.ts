// @vitest-environment happy-dom
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { WatchEvent } from '@tauri-apps/plugin-fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHANGE_GATHER_MS,
  createHost,
  isAboutFile,
  toPluginHost,
  watchFile,
  type FileEvent,
} from './host.ts';

// The calls into the app's Rust side, which a test does not have.
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));

// The events the file system plugin reports, as its watcher (the `notify` crate) serializes them.
const modified = (...paths: string[]): FileEvent => ({
  type: { modify: { kind: 'data', mode: 'content' } },
  paths,
});
const renamed = (mode: 'any' | 'from' | 'to' | 'both', ...paths: string[]): FileEvent => ({
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

/**
 * The file system plugin's watch, which records what is watched; tests send events to the watches
 * of a path. `refuse` says which paths it won't watch, as the scope does for a folder that isn't
 * allowed.
 */
function fakeWatch(refuse: (path: string) => boolean = () => false) {
  const watches: { path: string; onEvent: (event: WatchEvent) => void }[] = [];
  const watchPath = vi.fn((path: string, onEvent: (event: WatchEvent) => void) => {
    if (refuse(path)) return Promise.reject(new Error(`forbidden path: ${path}`));
    const watch = { path, onEvent };
    watches.push(watch);
    return Promise.resolve(() => void watches.splice(watches.indexOf(watch), 1));
  });
  const send = (path: string, event: FileEvent) => {
    for (const watch of watches.filter((w) => w.path === path)) {
      watch.onEvent({ ...event, attrs: {} });
    }
  };
  const watching = () => watches.map((watch) => watch.path).sort();
  return { watching, watchPath, send };
}

describe('watchFile', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  /** Lets the events of a change be gathered and reported. */
  const gather = () => vi.advanceTimersByTime(CHANGE_GATHER_MS);

  it('watches the file’s folder, which survives the file being replaced by a rename', async () => {
    const { watching, watchPath } = fakeWatch();
    await watchFile('/docs/plan.md', vi.fn(), watchPath);
    // A watch on the file itself stays with the file it found (on Linux, inotify), so the
    // command line's first atomic write would end it.
    expect(watching()).toEqual(['/docs']);
    expect(watchPath).toHaveBeenCalledTimes(1);
  });

  it('reports changes to the file, as many times as it changes', async () => {
    const { watchPath, send } = fakeWatch();
    const onChange = vi.fn();
    await watchFile('/docs/plan.md', onChange, watchPath);

    send('/docs', modified('/docs/other.md'));
    send('/docs', created('/docs/.plan.md.1a2b3c4d.tmp'));
    send('/docs', read('/docs/plan.md'));
    gather();
    expect(onChange).not.toHaveBeenCalled();

    send('/docs', renamed('both', '/docs/.plan.md.1a2b3c4d.tmp', '/docs/plan.md'));
    gather();
    expect(onChange).toHaveBeenCalledTimes(1);
    send('/docs', renamed('both', '/docs/.plan.md.5e6f7a8b.tmp', '/docs/plan.md'));
    gather();
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('reports the several events of one change once', async () => {
    // What macOS reported for one replacement of the file: the temporary file's events, and the
    // file's own, one after the other.
    const { watchPath, send } = fakeWatch();
    const onChange = vi.fn();
    await watchFile('/docs/plan.md', onChange, watchPath);
    send('/docs', created('/docs/.plan.md.00000001.tmp'));
    send('/docs', renamed('any', '/docs/.plan.md.00000001.tmp'));
    send('/docs', created('/docs/plan.md'));
    send('/docs', renamed('any', '/docs/plan.md'));
    send('/docs', modified('/docs/plan.md'));
    expect(onChange).not.toHaveBeenCalled();
    gather();
    expect(onChange).toHaveBeenCalledTimes(1);
    gather();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('finds the file in the real paths the system reports, which can differ from its own', async () => {
    // On macOS, FSEvents reports /private/tmp/docs/plan.md for the file opened as /tmp/docs/plan.md,
    // and a replacement shows as a rename of the file's name, without the temporary file's.
    const { watchPath, send } = fakeWatch();
    const onChange = vi.fn();
    await watchFile('/tmp/docs/plan.md', onChange, watchPath);
    send('/tmp/docs', renamed('any', '/private/tmp/docs/.plan.md.00000001.tmp'));
    gather();
    expect(onChange).not.toHaveBeenCalled();
    send('/tmp/docs', renamed('any', '/private/tmp/docs/plan.md'));
    gather();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('stops watching when told to, and drops a change it has not reported yet', async () => {
    const { watching, watchPath, send } = fakeWatch();
    const onChange = vi.fn();
    const stop = await watchFile('/docs/plan.md', onChange, watchPath);
    send('/docs', modified('/docs/plan.md'));
    stop();
    expect(watching()).toEqual([]);
    gather();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('watches the file itself when its folder may not be watched', async () => {
    // A file opened from outside the home folder is allowed by itself, not its folder.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { watching, watchPath, send } = fakeWatch((path) => path === '/Volumes/work');
    const onChange = vi.fn();
    const stop = await watchFile('/Volumes/work/plan.md', onChange, watchPath);
    expect(watching()).toEqual(['/Volumes/work/plan.md']);
    expect(warn).toHaveBeenCalled();

    send('/Volumes/work/plan.md', modified('/Volumes/work/plan.md'));
    gather();
    expect(onChange).toHaveBeenCalledTimes(1);
    stop();
    expect(watching()).toEqual([]);
  });

  it('takes every event of the file watch for the file, whatever path it carries', async () => {
    // Watching a link, the system reports the file the link names, which can have another name.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { watchPath, send } = fakeWatch((path) => path === '/Volumes/work');
    const onChange = vi.fn();
    await watchFile('/Volumes/work/plan.md', onChange, watchPath);
    send('/Volumes/work/plan.md', renamed('any', '/Volumes/elsewhere/real-2026.md'));
    gather();
    expect(onChange).toHaveBeenCalledTimes(1);
    // Reads are still not changes.
    send('/Volumes/work/plan.md', read('/Volumes/elsewhere/real-2026.md'));
    gather();
    expect(onChange).toHaveBeenCalledTimes(1);
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
    expect(watching()).toEqual(['plan.md']);
  });

  describe('through a link', () => {
    // The command line follows a link, so it writes the file the link names, in that file's folder
    // and under that file's name, and the link's own folder sees nothing.
    const resolving = (links: Record<string, string>) => (path: string) =>
      Promise.resolve(links[path] ?? path);

    it('watches the folder of a file that is not a link once', async () => {
      const { watching, watchPath } = fakeWatch();
      await watchFile('/docs/plan.md', vi.fn(), watchPath, resolving({}));
      expect(watching()).toEqual(['/docs']);
    });

    it('sees a link to a file in another folder through that folder', async () => {
      const { watching, watchPath, send } = fakeWatch();
      const onChange = vi.fn();
      await watchFile(
        '/notes/plan.md',
        onChange,
        watchPath,
        resolving({ '/notes/plan.md': '/work/plan.md' }),
      );
      expect(watching()).toEqual(['/notes', '/work']);

      // The link's folder hears nothing of the replacement.
      send('/work', renamed('any', '/work/.plan.md.00000001.tmp'));
      gather();
      expect(onChange).not.toHaveBeenCalled();
      send('/work', renamed('any', '/work/plan.md'));
      gather();
      expect(onChange).toHaveBeenCalledTimes(1);
      send('/work', renamed('any', '/work/plan.md'));
      gather();
      expect(onChange).toHaveBeenCalledTimes(2);
    });

    it('sees a link to a file of another name in the same folder', async () => {
      const { watchPath, send } = fakeWatch();
      const onChange = vi.fn();
      await watchFile(
        '/docs/plan.md',
        onChange,
        watchPath,
        resolving({ '/docs/plan.md': '/docs/real-2026.md' }),
      );
      // The events carry the target's name, and the other file's are still no business of ours.
      send('/docs', renamed('any', '/docs/.real-2026.md.00000001.tmp'));
      send('/docs', renamed('any', '/docs/other.md'));
      gather();
      expect(onChange).not.toHaveBeenCalled();
      send('/docs', renamed('any', '/docs/real-2026.md'));
      gather();
      expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('still sees the link itself being replaced', async () => {
      const { watchPath, send } = fakeWatch();
      const onChange = vi.fn();
      await watchFile(
        '/docs/plan.md',
        onChange,
        watchPath,
        resolving({ '/docs/plan.md': '/docs/real-2026.md' }),
      );
      send('/docs', renamed('any', '/docs/plan.md'));
      gather();
      expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('reports a change once when the file is watched under two spellings of its path', async () => {
      // /tmp is a link to /private/tmp on macOS, so the folder is watched twice.
      const { watching, watchPath, send } = fakeWatch();
      const onChange = vi.fn();
      await watchFile(
        '/tmp/docs/plan.md',
        onChange,
        watchPath,
        resolving({ '/tmp/docs/plan.md': '/private/tmp/docs/plan.md' }),
      );
      expect(watching()).toEqual(['/private/tmp/docs', '/tmp/docs']);
      for (const folder of ['/tmp/docs', '/private/tmp/docs']) {
        send(folder, renamed('any', '/private/tmp/docs/plan.md'));
      }
      gather();
      expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('watches the link alone when its target can not be found, and says so', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { watching, watchPath } = fakeWatch();
      await watchFile('/docs/plan.md', vi.fn(), watchPath, () => Promise.reject(new Error('gone')));
      expect(watching()).toEqual(['/docs']);
      // Silently, a failure of the call would leave a link unwatched without a word.
      expect(warn).toHaveBeenCalledOnce();
    });

    it('keeps watching what it can when the target can not be watched', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { watching, watchPath, send } = fakeWatch((path) => path.startsWith('/secret'));
      const onChange = vi.fn();
      await watchFile(
        '/notes/plan.md',
        onChange,
        watchPath,
        resolving({ '/notes/plan.md': '/secret/plan.md' }),
      );
      expect(watching()).toEqual(['/notes']);
      expect(warn).toHaveBeenCalled();
      send('/notes', modified('/notes/plan.md'));
      gather();
      expect(onChange).toHaveBeenCalledTimes(1);
    });
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

describe('the host in the app', () => {
  beforeEach(() => {
    vi.stubGlobal('__TAURI_INTERNALS__', {});
    vi.mocked(listen).mockResolvedValue(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(invoke).mockReset();
    vi.mocked(listen).mockReset();
  });

  it('opens the files the app was asked to open, and reports those it could not allow', async () => {
    vi.mocked(invoke).mockResolvedValueOnce([
      { path: '/docs/plan.md', error: null },
      { path: '/docs/notes.md', error: 'the path can’t be allowed' },
      { path: '/docs/ideas.md', error: null },
    ]);
    const opened: string[] = [];
    const refused: [string, string][] = [];
    await createHost().listenForFiles(
      (path) => void opened.push(path),
      (path, reason) => void refused.push([path, reason]),
    );
    expect(invoke).toHaveBeenCalledWith('opened_files');
    expect(opened).toEqual(['/docs/plan.md', '/docs/ideas.md']);
    expect(refused).toEqual([['/docs/notes.md', 'the path can’t be allowed']]);
  });

  it('opens the files first, and then reports those it could not allow', async () => {
    // Opening a file clears the notice that is showing, so a refusal reported before it, or while
    // it is still opening, would be gone as soon as the person could read it.
    vi.mocked(invoke).mockResolvedValueOnce([
      { path: '/docs/refused.md', error: 'no' },
      { path: '/docs/plan.md', error: null },
      { path: '/docs/ideas.md', error: null },
    ]);
    const calls: string[] = [];
    await createHost().listenForFiles(
      async (path) => {
        calls.push(`opening ${path}`);
        await new Promise((resolve) => setTimeout(resolve, 5));
        calls.push(`opened ${path}`);
      },
      (path) => calls.push(`refused ${path}`),
    );
    expect(calls).toEqual([
      'opening /docs/plan.md',
      'opened /docs/plan.md',
      'opening /docs/ideas.md',
      'opened /docs/ideas.md',
      'refused /docs/refused.md',
    ]);
  });

  it('takes the files asked for later as well, when the app says so', async () => {
    vi.mocked(invoke).mockResolvedValueOnce([]);
    const opened: string[] = [];
    const refused: string[] = [];
    await createHost().listenForFiles(
      (path) => void opened.push(path),
      (path) => void refused.push(path),
    );
    expect(listen).toHaveBeenCalledWith('opened', expect.any(Function));

    vi.mocked(invoke).mockResolvedValueOnce([
      { path: '/docs/later.md', error: null },
      { path: '/docs/refused.md', error: 'no' },
    ]);
    const [, onOpened] = vi.mocked(listen).mock.calls[0] ?? [];
    (onOpened as () => void)();
    await vi.waitFor(() => expect(opened).toEqual(['/docs/later.md']));
    expect(refused).toEqual(['/docs/refused.md']);
  });
});

describe('toPluginHost', () => {
  it('gives plugins the identity and no capability the app lacks', async () => {
    const ada = { handle: 'ada', name: 'Ada' };
    const host = toPluginHost({ ...createHost(), identity: () => Promise.resolve(ada) });
    expect(await host.identity?.current()).toEqual(ada);
    expect(host.files).toBeUndefined();
    expect(host.processes).toBeUndefined();
    expect(host.relay).toBeUndefined();
  });

  it('gives plugins programs to run and a relay in the app, and only there', () => {
    const tauri = window as unknown as Record<string, unknown>;
    tauri['__TAURI_INTERNALS__'] = {};
    try {
      const host = toPluginHost(createHost());
      expect(host.processes).toBeDefined();
      expect(host.relay).toBeDefined();
    } finally {
      delete tauri['__TAURI_INTERNALS__'];
    }
  });
});
