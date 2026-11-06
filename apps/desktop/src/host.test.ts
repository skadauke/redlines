// @vitest-environment happy-dom
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { exists, type WatchEvent } from '@tauri-apps/plugin-fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHANGE_GATHER_MS,
  createHost,
  dirname,
  fileKind,
  isAboutFile,
  NotUtf8Error,
  opensInDefaultApp,
  toPluginHost,
  watchFile,
  type FileEvent,
} from './host.ts';

// The calls into the app's Rust side, which a test does not have.
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
// Each window hears only what is sent to it: the plain `listen` hears every window's events too.
const listen = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/webviewWindow', () => ({
  getCurrentWebviewWindow: vi.fn(() => ({ listen })),
}));
// The file system plugin's own calls, which go to the app's Rust side too.
vi.mock('@tauri-apps/plugin-fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tauri-apps/plugin-fs')>()),
  exists: vi.fn(),
}));

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

describe('dirname', () => {
  it('gives the folder holding a path, the disk’s root for a file there', () => {
    expect(dirname('/docs/plan.md')).toBe('/docs');
    expect(dirname('/plan.md')).toBe('/');
    expect(dirname('plan.md')).toBe('');
    expect(dirname('C:\\docs\\plan.md')).toBe('C:\\docs');
  });
});

describe('opensInDefaultApp', () => {
  it('is true for images and PDFs alone', () => {
    const names = ['logo.png', 'Photo.JPG', 'scan.jpeg', 'paper.pdf', 'IMG_1.heic', 'a.tiff'];
    expect(names.filter(opensInDefaultApp)).toEqual(names);
    const others = ['run.terminal', 'home.webloc', 'notes.txt', 'plan.md', 'icon.svg', 'png'];
    expect(others.filter(opensInDefaultApp)).toEqual([]);
  });
});

describe('fileKind', () => {
  it('tells Markdown, other text and anything else apart by the name', () => {
    const kinds = (names: string[]) => names.map((name) => [name, fileKind(name)]);
    const all = (names: string[], kind: string) => names.map((name) => [name, kind]);
    const markdown = ['plan.md', 'Notes.MARKDOWN', 'slides.qmd', 'analysis.Rmd'];
    expect(kinds(markdown)).toEqual(all(markdown, 'markdown'));
    const text = [
      'main.ts',
      'Cargo.toml',
      'package.json',
      'notes.txt',
      'build.rs',
      'styles.CSS',
      'Makefile',
      'LICENSE',
      'Dockerfile',
    ];
    expect(kinds(text)).toEqual(all(text, 'text'));
    // A name alone, such as a program's, says nothing of what the file holds.
    const other = ['logo.png', 'paper.pdf', 'archive.zip', 'icon.svg', 'build-redlines', 'md'];
    expect(kinds(other)).toEqual(all(other, 'other'));
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

  it('discards a draft when OK is chosen, and keeps it when Cancel is', async () => {
    const host = createHost();
    confirm.mockReturnValue(true);
    expect(await host.askToDiscardDraft()).toBe(true);
    confirm.mockReturnValue(false);
    expect(await host.askToDiscardDraft()).toBe(false);
  });

  it('lists its folder in memory, the project of every document in it', async () => {
    const host = createHost();
    expect(await host.projectRoot('sample.md')).toEqual({
      folder: '',
      isRepo: false,
      tooBroad: false,
    });
    expect(await host.list('', '')).toEqual([
      { name: 'sample.md', path: 'sample.md', isDir: false },
    ]);
    expect(await host.exists('sample.md')).toBe(true);
    expect(await host.exists('missing.md')).toBe(false);
    // It has no other apps to open a file in.
    await expect(host.openDefault('logo.png', '')).rejects.toThrow();
  });

  it('lets the window use the files of its folder in memory, and remembers nothing', async () => {
    const host = createHost();
    await host.allowDocument('sample.md');
    await host.forgetDocuments();
    expect(await host.readCapped('sample.md', 1e6)).toEqual({ text: await host.read('sample.md') });
  });
});

describe('the host in the app', () => {
  beforeEach(() => {
    vi.stubGlobal('__TAURI_INTERNALS__', {});
    listen.mockResolvedValue(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(invoke).mockReset();
    listen.mockReset();
  });

  it('opens a new window, for a file and a line if it is given them', async () => {
    vi.mocked(invoke).mockResolvedValue('doc-1');
    const host = createHost();
    await host.openWindow();
    await host.openWindow('/docs/plan.md');
    await host.openWindow('/docs/plan.md', 42);
    // src-tauri/src/windows.rs: open_window.
    expect(invoke).toHaveBeenNthCalledWith(1, 'open_window', { path: null, line: null });
    expect(invoke).toHaveBeenNthCalledWith(2, 'open_window', {
      path: '/docs/plan.md',
      line: null,
    });
    expect(invoke).toHaveBeenNthCalledWith(3, 'open_window', { path: '/docs/plan.md', line: 42 });
  });

  it('finds the project folder of a document', async () => {
    const root = { folder: '/repo', isRepo: true, tooBroad: false };
    vi.mocked(invoke).mockResolvedValue(root);
    expect(await createHost().projectRoot('/repo/docs/plan.md')).toEqual(root);
    // src-tauri/src/project.rs: project_root.
    expect(invoke).toHaveBeenCalledWith('project_root', { path: '/repo/docs/plan.md' });
  });

  it('lists a folder within its project, and opens a file in its default app', async () => {
    const entries = [{ name: 'plan.md', path: '/repo/docs/plan.md', isDir: false }];
    vi.mocked(invoke).mockResolvedValue(entries);
    const host = createHost();
    expect(await host.list('/repo/docs', '/repo')).toEqual(entries);
    // src-tauri/src/project.rs: list_folder and open_default.
    expect(invoke).toHaveBeenCalledWith('list_folder', { root: '/repo', folder: '/repo/docs' });
    vi.mocked(invoke).mockResolvedValue(null);
    await host.openDefault('/repo/logo.png', '/repo');
    expect(invoke).toHaveBeenCalledWith('open_default', { root: '/repo', path: '/repo/logo.png' });
  });

  it('lets the window use a Markdown file the sidebar shows, once the app allows it', async () => {
    vi.mocked(invoke).mockResolvedValue(null);
    await createHost().allowDocument('/repo/docs/plan.md');
    // src-tauri/src/project.rs: allow_document.
    expect(invoke).toHaveBeenCalledWith('allow_document', { path: '/repo/docs/plan.md' });
    vi.mocked(invoke).mockRejectedValue('Couldn’t open “plan.md”.');
    await expect(createHost().allowDocument('/repo/docs/plan.md')).rejects.toBe(
      'Couldn’t open “plan.md”.',
    );
  });

  it('lets the page load the images of a project, once the app allows it', async () => {
    vi.mocked(invoke).mockResolvedValue(true);
    expect(await createHost().allowImages('/repo/docs/plan.md')).toBe(true);
    // src-tauri/src/project.rs: show_images.
    expect(invoke).toHaveBeenCalledWith('show_images', { path: '/repo/docs/plan.md' });
  });

  it('forgets the remembered documents through the app', async () => {
    vi.mocked(invoke).mockResolvedValue(null);
    await createHost().forgetDocuments();
    // src-tauri/src/file_scope.rs: forget_documents.
    expect(invoke).toHaveBeenCalledWith('forget_documents');
  });

  it('reads a file for the viewer through the app, as text that keeps its bytes', async () => {
    const text = '\uFEFFconst a = 1;\r\n';
    vi.mocked(invoke).mockResolvedValue(new TextEncoder().encode(text).buffer);
    expect(await createHost().readCapped('/repo/src/main.ts', 100)).toEqual({ text });
    // src-tauri/src/project.rs: read_project_file, which sends the file's bytes as they are.
    expect(invoke).toHaveBeenCalledWith('read_project_file', { path: '/repo/src/main.ts' });
    // Over the viewer's own limit, it isn't decoded.
    expect(await createHost().readCapped('/repo/src/main.ts', 4)).toEqual({ tooLarge: true });
    vi.mocked(invoke).mockResolvedValue(new Uint8Array([0x66, 0xff, 0x6f]).buffer);
    await expect(createHost().readCapped('/repo/logo.bin', 100)).rejects.toBeInstanceOf(
      NotUtf8Error,
    );
    // The app reads no file over 2 MB, and says so.
    vi.mocked(invoke).mockRejectedValue('too-large');
    expect(await createHost().readCapped('/repo/big.log', 100)).toEqual({ tooLarge: true });
    vi.mocked(invoke).mockRejectedValue('Couldn’t open “.env”.');
    await expect(createHost().readCapped('/repo/.env', 100)).rejects.toBe('Couldn’t open “.env”.');
  });

  it('asks the file system whether a file is there', async () => {
    vi.mocked(exists).mockResolvedValue(true);
    expect(await createHost().exists('/repo/src/main.ts')).toBe(true);
    expect(exists).toHaveBeenCalledWith('/repo/src/main.ts');
  });

  it('asks the app what this window was opened for', async () => {
    vi.mocked(invoke).mockResolvedValue({ path: '/docs/plan.md', line: 42 });
    expect(await createHost().windowStart()).toEqual({ path: '/docs/plan.md', line: 42 });
    // src-tauri/src/windows.rs: window_start.
    expect(invoke).toHaveBeenCalledWith('window_start');
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
    expect(getCurrentWebviewWindow).toHaveBeenCalled();
    expect(listen).toHaveBeenCalledWith('opened', expect.any(Function));

    vi.mocked(invoke).mockResolvedValueOnce([
      { path: '/docs/later.md', error: null },
      { path: '/docs/refused.md', error: 'no' },
    ]);
    const [, onOpened] = (listen.mock.calls[0] ?? []) as unknown[];
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
