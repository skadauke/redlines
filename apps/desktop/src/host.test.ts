// @vitest-environment happy-dom
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { exists } from '@tauri-apps/plugin-fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createHost,
  DISCARD_DRAFT_BUTTONS,
  dirname,
  fileKind,
  NotUtf8Error,
  opensInDefaultApp,
  toPluginHost,
  wantsDiscard,
} from './host.ts';

// The calls into the app's Rust side, which a test does not have. A channel is a holder for
// `onmessage`; the test takes the channel out of the call and plays Rust's part.
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  Channel: class {
    onmessage: (message: unknown) => void = () => {};
  },
}));
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

  it('discards a draft only when Discard itself was clicked', () => {
    // The first button is Return's, and the one called Cancel is Escape's: both keep the draft.
    expect(DISCARD_DRAFT_BUTTONS).toEqual({ ok: 'Cancel', cancel: 'Discard' });
    expect(wantsDiscard('Discard')).toBe(true);
    expect(wantsDiscard('Cancel')).toBe(false);
    expect(wantsDiscard(undefined)).toBe(false);
    expect(wantsDiscard('Ok')).toBe(false);
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

  describe('watching the document', () => {
    /** The channel the app was given to report changes through, in the latest watch. */
    const changes = () => {
      const call = vi
        .mocked(invoke)
        .mock.calls.findLast(([command]) => command === 'watch_document');
      return (call?.[1] as { onChange: { onmessage: (message: null) => void } }).onChange;
    };

    it('asks the app to watch it, and reports each change the app tells of', async () => {
      vi.mocked(invoke).mockResolvedValue(7);
      const onChange = vi.fn();
      await createHost().watch('/docs/plan.md', onChange);
      // src-tauri/src/watch.rs: watch_document, which watches the file's folder, not the page.
      expect(invoke).toHaveBeenCalledWith('watch_document', {
        path: '/docs/plan.md',
        onChange: changes(),
      });
      expect(onChange).not.toHaveBeenCalled();
      changes().onmessage(null);
      changes().onmessage(null);
      expect(onChange).toHaveBeenCalledTimes(2);
    });

    it('stops through the app, once, and reports nothing after', async () => {
      vi.mocked(invoke).mockResolvedValue(7);
      const onChange = vi.fn();
      const stop = await createHost().watch('/docs/plan.md', onChange);
      const channel = changes();
      stop();
      expect(invoke).toHaveBeenLastCalledWith('unwatch_document', { id: 7 });
      // A change the app was already telling of as the watch stopped.
      channel.onmessage(null);
      expect(onChange).not.toHaveBeenCalled();
      stop();
      expect(
        vi.mocked(invoke).mock.calls.filter(([command]) => command === 'unwatch_document'),
      ).toHaveLength(1);
    });

    it('fails when the app won’t watch the file, so that the window says so', async () => {
      vi.mocked(invoke).mockRejectedValue('/docs/plan.md: not a file this window may use');
      await expect(createHost().watch('/docs/plan.md', vi.fn())).rejects.toBe(
        '/docs/plan.md: not a file this window may use',
      );
    });

    it('says in the console when the app could not stop watching, and goes on', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.mocked(invoke).mockResolvedValueOnce(7).mockRejectedValueOnce(new Error('gone'));
      const stop = await createHost().watch('/docs/plan.md', vi.fn());
      stop();
      await vi.waitFor(() => expect(warn).toHaveBeenCalledOnce());
      warn.mockRestore();
    });
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
