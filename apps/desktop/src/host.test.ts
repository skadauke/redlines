// @vitest-environment happy-dom
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { exists, readFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createHost,
  DISCARD_DRAFT_BUTTONS,
  dirname,
  isDocument,
  joinPath,
  NOT_A_DOCUMENT,
  NotADocumentError,
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
  readFile: vi.fn(),
  writeTextFile: vi.fn(),
}));
// The open and save dialogs, which the app draws.
const dialog = vi.hoisted(() => ({
  open: vi.fn<(options: unknown) => Promise<string | null>>(),
  save: vi.fn<(options: unknown) => Promise<string | null>>(),
  message: vi.fn(),
}));
vi.mock('@tauri-apps/plugin-dialog', () => dialog);

describe('dirname', () => {
  it('gives the folder holding a path, the disk’s root for a file there', () => {
    expect(dirname('/docs/plan.md')).toBe('/docs');
    expect(dirname('/plan.md')).toBe('/');
    expect(dirname('plan.md')).toBe('');
    expect(dirname('C:\\docs\\plan.md')).toBe('C:\\docs');
  });
});

describe('joinPath', () => {
  it('puts a file name in a folder, once between them, in the separator the folder uses', () => {
    expect(joinPath('/docs', 'plan.md')).toBe('/docs/plan.md');
    expect(joinPath('/docs/', 'plan.md')).toBe('/docs/plan.md');
    expect(joinPath('/', 'plan.md')).toBe('/plan.md');
    expect(joinPath('C:\\docs', 'plan.md')).toBe('C:\\docs\\plan.md');
    expect(joinPath('C:\\docs\\', 'plan.md')).toBe('C:\\docs\\plan.md');
    expect(joinPath('C:\\', 'plan.md')).toBe('C:\\plan.md');
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

describe('isDocument', () => {
  it('is true for Markdown, its R Markdown and Quarto dialects, and plain text', () => {
    const documents = [
      'plan.md',
      'Notes.MARKDOWN',
      'slides.qmd',
      'analysis.Rmd',
      'notes.txt',
      'README.TXT',
      'release.notes.txt',
    ];
    expect(documents.filter(isDocument)).toEqual(documents);
  });

  it('goes by the file’s own name in a full path, as the app does, never by its folder’s', () => {
    expect(isDocument('/docs/notes.txt')).toBe(true);
    expect(isDocument('/Users/ada/my.notes/README')).toBe(false);
    // A hidden file whose whole name is an extension has none, in the app too.
    expect(isDocument('/docs/.txt')).toBe(false);
    expect(opensInDefaultApp('/docs/.png')).toBe(false);
  });

  it('is false for any other file, and for a name that is only an extension', () => {
    const others = [
      'main.ts',
      'package.json',
      'notes.text',
      'notes.txt.bak',
      'logo.png',
      'paper.pdf',
      'Makefile',
      'txt',
      '.txt',
      'md',
    ];
    expect(others.filter(isDocument)).toEqual([]);
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
    expect(await host.read('sample.md')).toContain('Redlines');
  });

  it('was opened for no file, no line and no text: a tab starts from sample.md', async () => {
    const host = createHost();
    expect(await host.windowStart()).toEqual({ path: null, line: null, text: null });
    // Another tab starts from sample.md, whatever it was asked for.
    const open = vi.fn<(url?: string | URL) => Window | null>(() => null);
    vi.stubGlobal('open', open);
    await host.openWindow();
    await host.openWindow('sample.md', 3);
    expect(open).toHaveBeenCalledTimes(2);
    expect(open).toHaveBeenCalledWith(location.href);
    expect(await host.windowStart()).toEqual({ path: null, line: null, text: null });
  });

  it('opens no tab for text, which a tab can’t be given, and says so', async () => {
    const open = vi.fn<(url?: string | URL) => Window | null>(() => null);
    vi.stubGlobal('open', open);
    const host = createHost();
    await expect(host.openWindow(undefined, undefined, '# The answer\n')).rejects.toThrow(
      'A browser tab can’t be opened for text.',
    );
    expect(open).not.toHaveBeenCalled();
    // An empty text is none, as it is for the app.
    await host.openWindow(undefined, undefined, '');
    expect(open).toHaveBeenCalledOnce();
  });

  it('has no Paste of its own to give: a tab reads the clipboard’s text', () => {
    expect(createHost().pasteInDocument).toBeUndefined();
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

  it('opens a new window, for a file and a line, or for text, if it is given them', async () => {
    vi.mocked(invoke).mockResolvedValue('doc-1');
    const host = createHost();
    await host.openWindow();
    await host.openWindow('/docs/plan.md');
    await host.openWindow('/docs/plan.md', 42);
    await host.openWindow(undefined, undefined, '# The answer\n\nIt is 42.\n');
    // src-tauri/src/windows.rs: open_window.
    expect(invoke).toHaveBeenNthCalledWith(1, 'open_window', {
      path: null,
      line: null,
      text: null,
    });
    expect(invoke).toHaveBeenNthCalledWith(2, 'open_window', {
      path: '/docs/plan.md',
      line: null,
      text: null,
    });
    expect(invoke).toHaveBeenNthCalledWith(3, 'open_window', {
      path: '/docs/plan.md',
      line: 42,
      text: null,
    });
    expect(invoke).toHaveBeenNthCalledWith(4, 'open_window', {
      path: null,
      line: null,
      text: '# The answer\n\nIt is 42.\n',
    });
  });

  it('pastes into the document through the app, which sends the Mac’s own Paste', async () => {
    vi.mocked(invoke).mockResolvedValue(true);
    expect(await createHost().pasteInDocument?.()).toBe(true);
    expect(invoke).toHaveBeenCalledWith('paste_in_field');
    // Nothing took it: the page falls back to the clipboard's text.
    vi.mocked(invoke).mockResolvedValue(false);
    expect(await createHost().pasteInDocument?.()).toBe(false);
  });

  it('passes the text on as it is, to the byte, whatever it holds', async () => {
    vi.mocked(invoke).mockResolvedValue('doc-1');
    const text = '\uFEFF# Café 🚀\r\n\r\n    code\r\n\n';
    await createHost().openWindow(undefined, undefined, text);
    expect(invoke).toHaveBeenCalledWith('open_window', { path: null, line: null, text });
    // An empty text is the app's to treat as none (src-tauri/src/windows.rs: WindowStart::new).
    await createHost().openWindow(undefined, undefined, '');
    expect(invoke).toHaveBeenLastCalledWith('open_window', { path: null, line: null, text: '' });
  });

  it('rejects with the app’s reason when it won’t open the window', async () => {
    const reason = 'A window opens for a file or for text, not both. Ask for one of them.';
    vi.mocked(invoke).mockRejectedValue(reason);
    await expect(createHost().openWindow('/docs/plan.md', undefined, 'Text')).rejects.toBe(reason);
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

  it('asks the file system whether a file is there', async () => {
    vi.mocked(exists).mockResolvedValue(true);
    expect(await createHost().exists('/repo/src/main.ts')).toBe(true);
    expect(exists).toHaveBeenCalledWith('/repo/src/main.ts');
  });

  describe('the open and save dialogs', () => {
    /** The extensions a dialog's filters let the person pick, in lower case. */
    const offered = (options: unknown) =>
      new Set(
        (options as { filters: { extensions: string[] }[] }).filters.flatMap((filter) =>
          filter.extensions.map((extension) => extension.toLowerCase()),
        ),
      );
    const DOCUMENTS = new Set(['md', 'markdown', 'qmd', 'rmd', 'txt']);

    afterEach(() => {
      dialog.open.mockReset();
      dialog.save.mockReset();
      vi.mocked(readFile).mockReset();
      vi.mocked(writeTextFile).mockReset();
    });

    it('opens a plain text file as it opens Markdown, its bytes as they are', async () => {
      dialog.open.mockResolvedValue('/docs/notes.txt');
      vi.mocked(readFile).mockResolvedValue(new TextEncoder().encode('﻿One\r\nTwo'));
      expect(await createHost().open()).toEqual({ path: '/docs/notes.txt', text: '﻿One\r\nTwo' });
      expect(readFile).toHaveBeenCalledWith('/docs/notes.txt');
      const [options] = dialog.open.mock.calls[0] ?? [];
      expect(options).toMatchObject({ multiple: false, directory: false });
      // Markdown, R Markdown, Quarto and plain text, and nothing else.
      expect(offered(options)).toEqual(DOCUMENTS);
    });

    it('saves where the person says, keeping a plain text file’s .txt', async () => {
      dialog.save.mockResolvedValue('/docs/notes.txt');
      vi.mocked(writeTextFile).mockResolvedValue();
      expect(await createHost().saveAs('One\r\n', '/docs/notes.txt')).toBe('/docs/notes.txt');
      const [options] = dialog.save.mock.calls[0] ?? [];
      // The dialog starts from the file's own name, and takes its extension.
      expect(options).toMatchObject({ defaultPath: '/docs/notes.txt' });
      expect(offered(options)).toEqual(DOCUMENTS);
      expect(writeTextFile).toHaveBeenCalledWith('/docs/notes.txt', 'One\r\n');
    });

    describe('the default folder for new documents', () => {
      const startedAt = () => {
        const [options] = dialog.save.mock.calls[0] ?? [];
        return (options as { defaultPath: string }).defaultPath;
      };

      it('starts the dialog of a name alone in the folder, once the app says it is there', async () => {
        dialog.save.mockResolvedValue(null);
        vi.mocked(invoke).mockResolvedValueOnce(true);
        await createHost().saveAs('Text', 'Untitled.md', '/Users/ada/Notes');
        // src-tauri/src/files.rs: folder_exists.
        expect(invoke).toHaveBeenCalledWith('folder_exists', { path: '/Users/ada/Notes' });
        expect(startedAt()).toBe('/Users/ada/Notes/Untitled.md');
      });

      it('starts as it does without a folder when the folder is gone', async () => {
        dialog.save.mockResolvedValue(null);
        vi.mocked(invoke).mockResolvedValueOnce(false);
        await createHost().saveAs('Text', 'Untitled.md', '/Users/ada/Gone');
        expect(startedAt()).toBe('Untitled.md');
      });

      it('starts as it does without a folder when the app cannot say, and saves all the same', async () => {
        dialog.save.mockResolvedValue('/docs/Untitled.md');
        vi.mocked(writeTextFile).mockResolvedValue();
        vi.mocked(invoke).mockRejectedValueOnce('no');
        expect(await createHost().saveAs('Text', 'Untitled.md', '/Users/ada/Notes')).toBe(
          '/docs/Untitled.md',
        );
        expect(startedAt()).toBe('Untitled.md');
      });

      it('asks nothing for a saved document, whose dialog starts in its own folder', async () => {
        dialog.save.mockResolvedValue(null);
        await createHost().saveAs('One', '/docs/notes.md', null);
        await createHost().saveAs('One', '/docs/notes.md');
        expect(invoke).not.toHaveBeenCalled();
        expect(startedAt()).toBe('/docs/notes.md');
      });

      it('never puts a full path under the folder, even one that was given with it', async () => {
        dialog.save.mockResolvedValue(null);
        vi.mocked(invoke).mockResolvedValue(true);
        await createHost().saveAs('One', '/docs/notes.md', '/Users/ada/Notes');
        expect(startedAt()).toBe('/docs/notes.md');
      });

      it('writes the folder’s name once, whether it ends in a slash or is the disk’s root', async () => {
        dialog.save.mockResolvedValue(null);
        vi.mocked(invoke).mockResolvedValue(true);
        await createHost().saveAs('Text', 'Untitled.md', '/Users/ada/Notes/');
        expect(startedAt()).toBe('/Users/ada/Notes/Untitled.md');
        dialog.save.mockClear();
        await createHost().saveAs('Text', 'Untitled.md', '/');
        expect(startedAt()).toBe('/Untitled.md');
      });

      it('does not wait for a folder that doesn’t answer, which would hold Save up', async () => {
        vi.useFakeTimers();
        try {
          dialog.save.mockResolvedValue(null);
          // A volume that has gone away leaves the question unanswered.
          vi.mocked(invoke).mockReturnValueOnce(new Promise(() => {}));
          const saving = createHost().saveAs('Text', 'Untitled.md', '/Volumes/Gone/Notes');
          await vi.advanceTimersByTimeAsync(5000);
          await saving;
          expect(startedAt()).toBe('Untitled.md');
        } finally {
          vi.useRealTimers();
        }
      });
    });

    it('reads no file the Open panel picked that isn’t a document', async () => {
      // On the Mac the panel enables every file whose type conforms to plain text's, `.txt`'s:
      // scripts, source files, logs, a Terminal `.command`.
      for (const picked of ['/repo/run.command', '/repo/build.py', '/repo/Makefile']) {
        dialog.open.mockResolvedValueOnce(picked);
        const opening = createHost().open();
        await expect(opening).rejects.toBeInstanceOf(NotADocumentError);
        await expect(opening).rejects.toThrow(NOT_A_DOCUMENT);
      }
      expect(readFile).not.toHaveBeenCalled();
    });

    it('offers a document’s own extension first, which a name typed without one takes', async () => {
      dialog.save.mockResolvedValue(null);
      const first = async (suggested: string) => {
        dialog.save.mockClear();
        await createHost().saveAs('Text', suggested);
        const [options] = dialog.save.mock.calls[0] ?? [];
        const filters = (options as { filters: { extensions: string[] }[] }).filters;
        // Still the documents alone, whatever comes first.
        expect(offered(options)).toEqual(DOCUMENTS);
        return filters[0]?.extensions[0];
      };
      expect(await first('/docs/notes.txt')).toBe('txt');
      expect(await first('/docs/NOTES.TXT')).toBe('txt');
      expect(await first('/docs/analysis.Rmd')).toBe('Rmd');
      expect(await first('/docs/talk.qmd')).toBe('qmd');
      expect(await first('Untitled.md')).toBe('md');
      // Cancelled: nothing is written.
      expect(writeTextFile).not.toHaveBeenCalled();
    });

    it('writes nothing where Save As was given a name that isn’t a document’s', async () => {
      // The panel takes a name whose type conforms to one it offers, such as a script's for plain
      // text, and, off the Mac, a name with no extension at all.
      for (const chosen of ['/docs/notes.py', '/docs/notes']) {
        dialog.save.mockResolvedValueOnce(chosen);
        const saving = createHost().saveAs('One\n', '/docs/notes.txt');
        await expect(saving).rejects.toBeInstanceOf(NotADocumentError);
        await expect(saving).rejects.toThrow('Redlines saves Markdown and text files.');
      }
      expect(writeTextFile).not.toHaveBeenCalled();
    });
  });

  it('asks the app what this window was opened for', async () => {
    vi.mocked(invoke).mockResolvedValue({ path: '/docs/plan.md', line: 42, text: null });
    expect(await createHost().windowStart()).toEqual({
      path: '/docs/plan.md',
      line: 42,
      text: null,
    });
    // src-tauri/src/windows.rs: window_start.
    expect(invoke).toHaveBeenCalledWith('window_start');
  });

  it('is told the text of a window opened for text, each time it asks', async () => {
    const start = { path: null, line: null, text: '# The answer\n\nIt is 42.\n' };
    vi.mocked(invoke).mockResolvedValue(start);
    const host = createHost();
    // A page that reloads asks again, and the app answers the same (src-tauri/src/windows.rs).
    expect(await host.windowStart()).toEqual(start);
    expect(await host.windowStart()).toEqual(start);
    expect(invoke).toHaveBeenCalledTimes(2);
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
