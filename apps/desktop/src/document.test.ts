// @vitest-environment happy-dom
import { createMacAgents, createRuns } from '@redlines/agents';
import { fakeProvider, fakeRelay, type FakeScript } from '@redlines/agents/fake-provider';
import { createEditor } from '@redlines/editor';
import { addComment, parse } from '@redlines/format';
import { describe, expect, it, vi } from 'vitest';
import {
  CHANGED_ON_DISK,
  DELETED_ON_DISK,
  DocumentController,
  NOT_WATCHED,
  TRACKING_FOR_EVERYONE,
  type DocumentState,
} from './document.ts';
import {
  decodeCapped,
  decodeText,
  deriveHandle,
  FileExistsError,
  NotUtf8Error,
  type FileEntry,
  type Host,
  type OverwriteChoice,
  type SaveChoice,
} from './host.ts';

/** A host over an in-memory folder, with a watcher the test fires by hand. */
class FakeHost implements Host {
  files = new Map<string, string>();
  /** Files given as bytes, decoded as the real host decodes them. */
  bytes = new Map<string, Uint8Array>();
  writes: { path: string; text: string }[] = [];
  watchers = new Map<string, () => void>();
  saveAsPath: string | null = '/docs/new.md';
  /** What the open dialog picks; null is Cancel. */
  picked: { path: string; text: string } | null = null;
  pickError: Error | null = null;
  openedWindows: (string | undefined)[] = [];
  failOpenWindow = false;
  choice: SaveChoice = 'cancel';
  asked = 0;
  overwriteChoice: OverwriteChoice = 'cancel';
  overwriteAsked = 0;
  failWatch = false;
  /** Set to hold reads until the test calls the resolver. */
  holdReads = false;
  heldReads: (() => void)[] = [];

  identity() {
    return Promise.resolve({ handle: 'ada', name: 'Ada Lovelace' });
  }
  open() {
    return this.pickError ? Promise.reject(this.pickError) : Promise.resolve(this.picked);
  }
  openWindow(path?: string) {
    if (this.failOpenWindow) return Promise.reject(new Error('no window'));
    this.openedWindows.push(path);
    return Promise.resolve();
  }
  windowStart() {
    return Promise.resolve({ path: null, line: null });
  }
  readClipboardText() {
    return Promise.resolve('');
  }
  async read(path: string) {
    if (this.holdReads) await new Promise<void>((resolve) => this.heldReads.push(resolve));
    const bytes = this.bytes.get(path);
    if (bytes) return decodeText(bytes);
    const text = this.files.get(path);
    if (text === undefined) throw new Error('not found');
    return text;
  }
  async readCapped(path: string, limit: number) {
    const text = await this.read(path);
    return text.length > limit ? { tooLarge: true as const } : { text };
  }
  write(path: string, text: string) {
    this.files.set(path, text);
    this.writes.push({ path, text });
    return Promise.resolve();
  }
  async saveAs(text: string) {
    if (this.saveAsPath) await this.write(this.saveAsPath, text);
    return this.saveAsPath;
  }
  watch(path: string, onChange: () => void) {
    if (this.failWatch) return Promise.reject(new Error('watching is not allowed'));
    this.watchers.set(path, onChange);
    return Promise.resolve(() => this.watchers.delete(path));
  }
  projectRoot(path: string) {
    return Promise.resolve({
      folder: path.slice(0, path.lastIndexOf('/')),
      isRepo: false,
      tooBroad: false,
    });
  }
  list(): Promise<FileEntry[]> {
    return Promise.resolve([]);
  }
  renames: { from: string; to: string }[] = [];
  failRename: Error | null = null;
  rename(from: string, to: string) {
    if (this.failRename) return Promise.reject(this.failRename);
    // Like the file system: a name taken is refused, and the watch follows the controller's.
    if (this.files.has(to)) return Promise.reject(new FileExistsError(to));
    this.files.set(to, this.files.get(from) ?? '');
    this.files.delete(from);
    this.renames.push({ from, to });
    return Promise.resolve();
  }
  exists(path: string) {
    return Promise.resolve(this.files.has(path));
  }
  reveal() {
    return Promise.resolve();
  }
  print() {
    return Promise.resolve();
  }
  openDefault() {
    return Promise.resolve();
  }
  allowDocument() {
    return Promise.resolve();
  }
  forgetDocuments() {
    return Promise.resolve();
  }
  askToSave() {
    this.asked++;
    return Promise.resolve(this.choice);
  }
  askToOverwrite() {
    this.overwriteAsked++;
    return Promise.resolve(this.overwriteChoice);
  }
  listenForFiles() {
    return Promise.resolve();
  }
}

/**
 * An editor that, like a real one, reports its text after every change, including when its whole
 * text is replaced.
 */
function fakeEditor() {
  let doc = '';
  let onChange: (text: string) => void = () => {};
  return {
    getDoc: vi.fn(() => doc),
    getParsed: () => parse(doc),
    setDoc: (text: string) => {
      doc = text;
      onChange(text);
    },
    reloadDoc: vi.fn((text: string) => {
      doc = text;
      onChange(text);
    }),
    type: (text: string) => {
      doc = text;
      onChange(text);
    },
    onChange: (fn: (text: string) => void) => (onChange = fn),
  };
}

function setup(files: Record<string, string> = {}, options: { isRunLive?: () => boolean } = {}) {
  const host = new FakeHost();
  for (const [path, text] of Object.entries(files)) host.files.set(path, text);
  const editor = fakeEditor();
  let state: DocumentState | null = null;
  const controller = new DocumentController(host, editor, (s) => (state = s), options);
  editor.onChange((text) => controller.markEdited(text));
  return { host, editor, controller, state: () => state };
}

/** Lets the watcher registration, which runs after open resolves, finish. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('DocumentController', () => {
  it('knows when it last wrote the file, and not when a save wrote nothing', async () => {
    const { host, editor, controller } = setup({ '/docs/plan.md': 'One\n' });
    await controller.open('/docs/plan.md');
    expect(controller.savedAt).toBeNull();
    // Save on a clean document writes nothing; a cancelled Save As writes nothing.
    await controller.save();
    host.saveAsPath = null;
    await controller.saveAs();
    expect(controller.savedAt).toBeNull();

    editor.type('Two\n');
    await controller.save();
    expect(controller.savedAt).toBeInstanceOf(Date);
    // Opening another file starts afresh.
    host.files.set('/docs/other.md', 'Other\n');
    await controller.open('/docs/other.md');
    expect(controller.savedAt).toBeNull();
  });

  it('renames the file and keeps its edits and watch', async () => {
    const { host, editor, controller, state } = setup({ '/docs/plan.md': 'One\n' });
    await controller.open('/docs/plan.md');
    await settle();
    editor.type('Mine\n');

    expect(await controller.rename('outline.md')).toBe(true);
    expect(host.renames).toEqual([{ from: '/docs/plan.md', to: '/docs/outline.md' }]);
    expect(state()).toEqual({
      path: '/docs/outline.md',
      name: 'outline.md',
      dirty: true,
      notice: null,
      writing: false,
    });
    // The edits are the editor's still, and saving writes them to the new name.
    expect(editor.getDoc()).toBe('Mine\n');
    await controller.save();
    expect(host.writes).toEqual([{ path: '/docs/outline.md', text: 'Mine\n' }]);
    // The watch moved with the file.
    await settle();
    expect(host.watchers.has('/docs/plan.md')).toBe(false);
    expect(host.watchers.has('/docs/outline.md')).toBe(true);
    host.files.set('/docs/outline.md', 'Theirs\n');
    host.watchers.get('/docs/outline.md')?.();
    await settle();
    expect(editor.getDoc()).toBe('Theirs\n');
  });

  it('gives a name without an extension the file’s own', async () => {
    const { host, controller } = setup({ '/docs/plan.md': 'One\n' });
    await controller.open('/docs/plan.md');
    expect(await controller.rename('outline')).toBe(true);
    expect(host.renames).toEqual([{ from: '/docs/plan.md', to: '/docs/outline.md' }]);
  });

  it('does nothing for the name it already has', async () => {
    const { host, controller } = setup({ '/docs/plan.md': 'One\n' });
    await controller.open('/docs/plan.md');
    expect(await controller.rename(' plan.md ')).toBe(true);
    expect(host.renames).toEqual([]);
  });

  it('refuses a name that exists', async () => {
    const { host, controller, state } = setup({ '/docs/plan.md': 'One\n', '/docs/b.md': 'B\n' });
    await controller.open('/docs/plan.md');
    await settle();
    expect(await controller.rename('b.md')).toBe(false);
    expect(host.files.get('/docs/b.md')).toBe('B\n');
    expect(state()?.path).toBe('/docs/plan.md');
    expect(state()?.notice).toBe('There is already a file called b.md.');
    // The watch stays where it was.
    expect(host.watchers.has('/docs/plan.md')).toBe(true);
  });

  it('refuses a name that is no file name, and says when the rename failed', async () => {
    const { host, controller, state } = setup({ '/docs/plan.md': 'One\n' });
    await controller.open('/docs/plan.md');
    for (const bad of ['', '  ', 'a/b.md', 'a\\b.md', '.', '..']) {
      expect(await controller.rename(bad)).toBe(false);
    }
    expect(host.renames).toEqual([]);
    host.failRename = new Error('permission denied');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await controller.rename('x.md')).toBe(false);
    expect(state()?.notice).toBe('Couldn’t rename plan.md.');
    errors.mockRestore();
  });

  it('offers Save As for a document with no file', async () => {
    const { host, controller, state } = setup();
    await controller.create();
    host.saveAsPath = '/docs/chosen.md';
    expect(await controller.rename('outline.md')).toBe(true);
    // The dialog decides the name; nothing was renamed.
    expect(host.renames).toEqual([]);
    expect(state()?.path).toBe('/docs/chosen.md');
  });

  it('reloads a clean document when the file changes', async () => {
    const { host, editor, controller, state } = setup({ '/docs/plan.md': 'One\n' });
    await controller.open('/docs/plan.md');
    host.files.set('/docs/plan.md', 'Two\n');
    await controller.externalChange();
    expect(editor.getDoc()).toBe('Two\n');
    // A reload, which keeps the reader's place, rather than opening the file again.
    expect(editor.reloadDoc).toHaveBeenCalledWith('Two\n');
    expect(state()).toEqual({
      path: '/docs/plan.md',
      name: 'plan.md',
      dirty: false,
      notice: null,
      writing: false,
    });
  });

  it('keeps unsaved edits and sets a notice when the file changes', async () => {
    const { host, editor, controller, state } = setup({ '/docs/plan.md': 'One\n' });
    await controller.open('/docs/plan.md');
    editor.type('Mine\n');
    host.files.set('/docs/plan.md', 'Theirs\n');
    await controller.externalChange();
    expect(editor.getDoc()).toBe('Mine\n');
    expect(state()?.notice).toBe('This file changed on disk. Your unsaved edits are kept.');
    expect(state()?.notice).toBe(CHANGED_ON_DISK);
    expect(state()?.dirty).toBe(true);
    expect(host.files.get('/docs/plan.md')).toBe('Theirs\n');
    expect(host.writes).toEqual([]);
  });

  it('save writes exactly the editor text', async () => {
    const { host, editor, controller, state } = setup({ '/docs/plan.md': 'One\r\n' });
    await controller.open('/docs/plan.md');
    const text = '\uFEFF# Plan 🚀\r\n\r\nCafe\u0301 <!--ins k3x9-->new <!--/k3x9-->\r\n';
    editor.type(text);
    expect(state()?.dirty).toBe(true);
    await controller.save();
    expect(host.writes).toEqual([{ path: '/docs/plan.md', text }]);
    expect(state()?.dirty).toBe(false);
  });

  it('does not mark a document dirty on open', async () => {
    const { host, controller, state } = setup({ '/docs/plan.md': 'One\r\nTwo' });
    await controller.open('/docs/plan.md');
    expect(state()?.dirty).toBe(false);
    expect(host.writes).toEqual([]);
  });

  it('saves an untitled document with a dialog and watches the new file', async () => {
    const { host, editor, controller, state } = setup();
    editor.type('Hello\n');
    await controller.save();
    await settle();
    expect(host.writes).toEqual([{ path: '/docs/new.md', text: 'Hello\n' }]);
    expect(state()).toEqual({
      path: '/docs/new.md',
      name: 'new.md',
      dirty: false,
      notice: null,
      writing: false,
    });
    expect(host.watchers.has('/docs/new.md')).toBe(true);
  });

  it('reloads when the watcher reports a change', async () => {
    const { host, editor, controller } = setup({ '/docs/plan.md': 'One\n' });
    await controller.open('/docs/plan.md');
    await settle();
    host.files.set('/docs/plan.md', 'Two\n');
    host.watchers.get('/docs/plan.md')?.();
    await settle();
    expect(editor.getDoc()).toBe('Two\n');
  });

  it('ignores the watcher echo of its own save', async () => {
    const { editor, controller, state } = setup({ '/docs/plan.md': 'One\n' });
    await controller.open('/docs/plan.md');
    editor.type('Two\n');
    await controller.save();
    editor.type('Three\n');
    await controller.externalChange();
    expect(editor.getDoc()).toBe('Three\n');
    expect(state()?.notice).toBeNull();
  });

  it('is clean again when edits are undone', async () => {
    const { editor, controller, state } = setup({ '/docs/plan.md': 'One\n' });
    await controller.open('/docs/plan.md');
    editor.type('One more\n');
    expect(state()?.dirty).toBe(true);
    editor.type('One\n');
    expect(state()?.dirty).toBe(false);
  });

  it('asks before replacing unsaved edits, and keeps them on cancel', async () => {
    const { host, editor, controller, state } = setup({ '/docs/a.md': 'A', '/docs/b.md': 'B' });
    await controller.open('/docs/a.md');
    editor.type('A, edited');
    host.choice = 'cancel';
    await controller.open('/docs/b.md');
    expect(host.asked).toBe(1);
    expect(editor.getDoc()).toBe('A, edited');
    expect(state()?.path).toBe('/docs/a.md');

    host.choice = 'save';
    await controller.open('/docs/b.md');
    expect(host.files.get('/docs/a.md')).toBe('A, edited');
    expect(editor.getDoc()).toBe('B');
  });

  it('is clean again when the file on disk comes to match the editor', async () => {
    const { host, editor, controller, state } = setup({ '/docs/plan.md': 'One\n' });
    await controller.open('/docs/plan.md');
    host.files.delete('/docs/plan.md');
    await controller.externalChange();
    host.files.set('/docs/plan.md', 'One\n');
    await controller.externalChange();
    expect(state()).toEqual({
      path: '/docs/plan.md',
      name: 'plan.md',
      dirty: false,
      notice: null,
      writing: false,
    });

    editor.type('Two\n');
    host.files.set('/docs/plan.md', 'Two\n');
    await controller.externalChange();
    expect(state()?.dirty).toBe(false);
    expect(state()?.notice).toBeNull();
  });

  it('keeps a clean document clean when its file disappears, and reloads it when it returns', async () => {
    const { host, editor, controller, state } = setup({ '/docs/plan.md': 'One\n' });
    await controller.open('/docs/plan.md');
    host.files.delete('/docs/plan.md');
    await controller.externalChange();
    expect(editor.getDoc()).toBe('One\n');
    expect(state()?.dirty).toBe(false);
    expect(state()?.notice).toBe('This file was moved or deleted. Save to keep it.');
    expect(state()?.notice).toBe(DELETED_ON_DISK);

    // For example after switching git branches: the file is back, with other text.
    host.files.set('/docs/plan.md', 'Two\n');
    await controller.externalChange();
    expect(editor.getDoc()).toBe('Two\n');
    expect(state()).toEqual({
      path: '/docs/plan.md',
      name: 'plan.md',
      dirty: false,
      notice: null,
      writing: false,
    });
  });

  it('keeps unsaved edits when the file disappears, and saving writes it again', async () => {
    const { host, editor, controller, state } = setup({ '/docs/plan.md': 'One\n' });
    await controller.open('/docs/plan.md');
    editor.type('Mine\n');
    host.files.delete('/docs/plan.md');
    await controller.externalChange();
    expect(state()?.dirty).toBe(true);
    expect(state()?.notice).toBe(DELETED_ON_DISK);
    expect(await controller.save()).toBe(true);
    expect(host.files.get('/docs/plan.md')).toBe('Mine\n');
    expect(host.overwriteAsked).toBe(0);
  });

  it('a clean document whose file disappeared writes it again on Save', async () => {
    const { host, controller } = setup({ '/docs/plan.md': 'One\n' });
    await controller.open('/docs/plan.md');
    host.files.delete('/docs/plan.md');
    await controller.externalChange();
    await controller.save();
    expect(host.files.get('/docs/plan.md')).toBe('One\n');
  });

  it('Save on a clean document writes nothing', async () => {
    const { host, controller } = setup({ '/docs/plan.md': 'One\n' });
    await controller.open('/docs/plan.md');
    // A change the watcher hasn't reported yet must survive a Save.
    host.files.set('/docs/plan.md', 'Changed elsewhere\n');
    expect(await controller.save()).toBe(true);
    expect(host.writes).toEqual([]);
    expect(host.files.get('/docs/plan.md')).toBe('Changed elsewhere\n');
  });

  it('asks before saving over a file that changed on disk', async () => {
    const { host, editor, controller, state } = setup({ '/docs/plan.md': 'One\n' });
    await controller.open('/docs/plan.md');
    editor.type('Mine\n');
    host.files.set('/docs/plan.md', 'Theirs\n');
    await controller.externalChange();
    controller.dismissNotice();

    host.overwriteChoice = 'cancel';
    expect(await controller.save()).toBe(false);
    expect(host.overwriteAsked).toBe(1);
    expect(host.writes).toEqual([]);
    expect(state()?.dirty).toBe(true);

    host.overwriteChoice = 'saveAs';
    expect(await controller.save()).toBe(true);
    expect(host.files.get('/docs/plan.md')).toBe('Theirs\n');
    expect(host.files.get('/docs/new.md')).toBe('Mine\n');
    expect(state()?.path).toBe('/docs/new.md');
  });

  it('overwrites a changed file only when told to', async () => {
    const { host, editor, controller, state } = setup({ '/docs/plan.md': 'One\n' });
    await controller.open('/docs/plan.md');
    editor.type('Mine\n');
    host.files.set('/docs/plan.md', 'Theirs\n');
    host.overwriteChoice = 'overwrite';
    // No watcher event reached the controller: Save still looks at the disk first.
    expect(await controller.save()).toBe(true);
    expect(host.overwriteAsked).toBe(1);
    expect(host.files.get('/docs/plan.md')).toBe('Mine\n');
    expect(state()).toEqual({
      path: '/docs/plan.md',
      name: 'plan.md',
      dirty: false,
      notice: null,
      writing: false,
    });
  });

  it('reloads the file when edits are undone after it changed on disk', async () => {
    const { host, editor, controller, state } = setup({ '/docs/plan.md': 'One\n' });
    await controller.open('/docs/plan.md');
    editor.type('Mine\n');
    host.files.set('/docs/plan.md', 'Theirs\n');
    await controller.externalChange();
    expect(state()?.notice).toBe(CHANGED_ON_DISK);
    editor.type('One\n');
    // No unsaved edits are left to keep, so the file as it is now is the text, and the notice,
    // which spoke of edits, goes.
    expect(editor.reloadDoc).toHaveBeenCalledWith('Theirs\n');
    expect(editor.getDoc()).toBe('Theirs\n');
    expect(state()).toEqual({
      path: '/docs/plan.md',
      name: 'plan.md',
      dirty: false,
      notice: null,
      writing: false,
    });
    // Clean, so Save leaves the other version on disk.
    await controller.save();
    expect(host.files.get('/docs/plan.md')).toBe('Theirs\n');
    expect(host.writes).toEqual([]);
    // Typing goes on from the new version.
    editor.type('Theirs and mine\n');
    expect(state()?.dirty).toBe(true);
  });

  it('reloads on undo also after the notice was dismissed', async () => {
    const { host, editor, controller, state } = setup({ '/docs/plan.md': 'One\n' });
    await controller.open('/docs/plan.md');
    editor.type('Mine\n');
    host.files.set('/docs/plan.md', 'Theirs\n');
    await controller.externalChange();
    controller.dismissNotice();
    editor.type('One\n');
    expect(editor.getDoc()).toBe('Theirs\n');
    expect(state()?.notice).toBeNull();
  });

  it('keeps the notice of a deleted file when edits are undone', async () => {
    const { host, editor, controller, state } = setup({ '/docs/plan.md': 'One\n' });
    await controller.open('/docs/plan.md');
    editor.type('Mine\n');
    host.files.delete('/docs/plan.md');
    await controller.externalChange();
    editor.type('One\n');
    expect(editor.reloadDoc).not.toHaveBeenCalled();
    expect(state()?.notice).toBe(DELETED_ON_DISK);
  });

  it('says so when the file cannot be watched', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { host, controller, state } = setup({ '/docs/plan.md': 'One\n' });
    host.failWatch = true;
    await controller.open('/docs/plan.md');
    await settle();
    expect(state()?.notice).toBe(
      'Redlines can’t watch this file for changes. Reopen it to see changes made elsewhere.',
    );
    expect(state()?.notice).toBe(NOT_WATCHED);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('says in a notice that a file the app was asked to open could not be used', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { host, editor, controller, state } = setup({ '/docs/plan.md': 'One\n' });
    controller.couldNotOpen('/docs/notes.md', 'the path can’t be allowed');
    expect(state()?.notice).toBe('Couldn’t open notes.md.');
    // The reason, which is technical, goes to the console.
    expect(consoleError).toHaveBeenCalledWith(
      'Couldn’t open notes.md.',
      'the path can’t be allowed',
    );
    // Nothing was opened or changed.
    expect(state()).toMatchObject({ path: null, name: 'Untitled', dirty: false });
    expect(editor.getDoc()).toBe('');
    expect(host.writes).toEqual([]);
    consoleError.mockRestore();
  });

  it('does not open a file that is not UTF-8', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { host, editor, controller, state } = setup({ '/docs/a.md': 'A' });
    await controller.open('/docs/a.md');
    host.bytes.set('/docs/latin1.md', new Uint8Array([0x63, 0x61, 0x66, 0xe9]));
    await controller.open('/docs/latin1.md');
    expect(editor.getDoc()).toBe('A');
    expect(state()?.path).toBe('/docs/a.md');
    expect(state()?.notice).toBe(
      'This file isn’t UTF-8 text, so Redlines can’t open it without changing it.',
    );
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('does not replace text typed while a file was being read', async () => {
    const { host, editor, controller, state } = setup({ '/docs/a.md': 'A', '/docs/b.md': 'B' });
    await controller.open('/docs/a.md');
    host.holdReads = true;
    const opening = controller.open('/docs/b.md');
    await settle();
    editor.type('A, typed meanwhile');
    host.choice = 'cancel';
    host.heldReads.forEach((resolve) => resolve());
    await opening;
    expect(host.asked).toBe(1);
    expect(editor.getDoc()).toBe('A, typed meanwhile');
    expect(state()?.path).toBe('/docs/a.md');
  });

  it('compares the text the editor reports instead of reading it again', async () => {
    const { editor, controller, state } = setup({ '/docs/plan.md': 'One\n' });
    await controller.open('/docs/plan.md');
    editor.getDoc.mockClear();
    controller.markEdited('One more\n');
    expect(state()?.dirty).toBe(true);
    expect(editor.getDoc).not.toHaveBeenCalled();
  });
});

describe('a file that asks everyone to track changes', () => {
  // `tracking: everyone` in the ledger (format §5.6): the editor opens it with Track Changes on,
  // and the person is told why (design §5.4).
  const asking = 'Plan\n\n<!-- redlines\nversion: 1\ntracking: everyone\n-->\n';

  it('is the one these tests mean', () => {
    expect(parse(asking).ledger.tracking).toBe('everyone');
    expect(parse(asking).warnings).toEqual([]);
  });

  it('opens with a notice that says why Track Changes is on', async () => {
    const { controller, state } = setup({ '/docs/plan.md': asking });
    await controller.open('/docs/plan.md');
    expect(state()?.notice).toBe(TRACKING_FOR_EVERYONE);
    expect(state()?.notice).toBe(
      'Track Changes is on, because this file asks everyone to track their changes.',
    );
    expect(state()?.dirty).toBe(false);
  });

  it('shows the notice again each time the file is opened', async () => {
    const { controller, state } = setup({ '/docs/plan.md': asking, '/docs/other.md': 'Other\n' });
    await controller.open('/docs/plan.md');
    controller.dismissNotice();
    await controller.open('/docs/other.md');
    expect(state()?.notice).toBeNull();
    await controller.open('/docs/plan.md');
    expect(state()?.notice).toBe(TRACKING_FOR_EVERYONE);
  });

  it('shows it once: it does not come back when the file reloads', async () => {
    const { host, controller, state } = setup({ '/docs/plan.md': asking });
    await controller.open('/docs/plan.md');
    controller.dismissNotice();
    expect(state()?.notice).toBeNull();
    host.files.set('/docs/plan.md', `${asking}More\n`);
    await controller.externalChange();
    expect(state()?.notice).toBeNull();
  });

  it('is not announced for a file that does not ask, or for a new document', async () => {
    const { controller, state } = setup({ '/docs/plain.md': '# Plain\n' });
    await controller.open('/docs/plain.md');
    expect(state()?.notice).toBeNull();
    await controller.create();
    expect(state()?.notice).toBeNull();
  });

  it('is not announced for a file whose ledger asks for nothing', async () => {
    const quiet = 'Plan\n\n<!-- redlines\nversion: 1\n-->\n';
    const { controller, state } = setup({ '/docs/plan.md': quiet });
    await controller.open('/docs/plan.md');
    expect(state()?.notice).toBeNull();
  });

  it('dismisses the notice by its text, and leaves another notice alone', async () => {
    const { host, editor, controller, state } = setup({ '/docs/plan.md': asking });
    await controller.open('/docs/plan.md');
    controller.dismissNotice(TRACKING_FOR_EVERYONE);
    expect(state()?.notice).toBeNull();

    // Something else came up: the person's choice about tracking doesn't clear it.
    editor.type('Mine\n');
    host.files.set('/docs/plan.md', 'Theirs\n');
    await controller.externalChange();
    expect(state()?.notice).toBe(CHANGED_ON_DISK);
    controller.dismissNotice(TRACKING_FOR_EVERYONE);
    expect(state()?.notice).toBe(CHANGED_ON_DISK);
  });
});

describe('asking about unsaved edits', () => {
  /** A host whose question stays up until the test answers it. */
  function asking() {
    const world = setup();
    let answer: (choice: SaveChoice) => void = () => {};
    world.host.askToSave = () => {
      world.host.asked++;
      return new Promise<SaveChoice>((resolve) => (answer = resolve));
    };
    return { ...world, answer: (choice: SaveChoice) => answer(choice) };
  }

  it('shares one question among those who ask while it is up', async () => {
    // The close button's question is up when the app starts quitting: a second sheet would be left
    // behind, unanswered, when the first closes the window.
    const { host, editor, controller, answer } = asking();
    await controller.create();
    editor.type('Draft');
    const closing = controller.confirmDiscard();
    const quitting = controller.confirmDiscard();
    expect(host.asked).toBe(1);
    answer('discard');
    expect(await closing).toBe(true);
    expect(await quitting).toBe(true);
    expect(host.asked).toBe(1);
  });

  it('gives Cancel to all who shared the question, and asks anew the next time', async () => {
    const { host, editor, controller, answer } = asking();
    await controller.create();
    editor.type('Draft');
    const closing = controller.confirmDiscard();
    const quitting = controller.confirmDiscard();
    answer('cancel');
    expect(await closing).toBe(false);
    expect(await quitting).toBe(false);

    const again = controller.confirmDiscard();
    expect(host.asked).toBe(2);
    answer('discard');
    expect(await again).toBe(true);
  });

  it('asks nothing when there is nothing unsaved', async () => {
    const { host, controller } = asking();
    await controller.create();
    expect(await controller.confirmDiscard()).toBe(true);
    expect(host.asked).toBe(0);
  });
});

describe('Open…, with one document per window', () => {
  const picked = { path: '/docs/plan.md', text: '# Plan\n' };

  it('opens the file here while the window is untouched', async () => {
    const { host, editor, controller } = setup();
    await controller.create();
    expect(controller.untouched).toBe(true);
    host.picked = picked;
    await controller.openWithDialog();
    expect(editor.getDoc()).toBe('# Plan\n');
    expect(controller.state.path).toBe('/docs/plan.md');
    expect(controller.untouched).toBe(false);
    expect(host.openedWindows).toEqual([]);
  });

  it('opens it in a new window when this one holds a document', async () => {
    const { host, editor, controller } = setup({ '/docs/old.md': 'Old\n' });
    await controller.open('/docs/old.md');
    expect(controller.untouched).toBe(false);
    host.picked = picked;
    await controller.openWithDialog();
    expect(editor.getDoc()).toBe('Old\n');
    expect(host.openedWindows).toEqual(['/docs/plan.md']);
    expect(host.asked).toBe(0);
  });

  it('opens it in a new window when this one has unsaved edits, without asking', async () => {
    const { host, editor, controller } = setup();
    await controller.create();
    editor.type('Draft');
    expect(controller.untouched).toBe(false);
    host.picked = picked;
    await controller.openWithDialog();
    expect(editor.getDoc()).toBe('Draft');
    expect(host.openedWindows).toEqual(['/docs/plan.md']);
    expect(host.asked).toBe(0);
  });

  it('keeps what was typed while the dialog was open', async () => {
    const { host, editor, controller } = setup();
    await controller.create();
    let pick: (file: typeof picked) => void = () => {};
    host.open = () => new Promise((resolve) => (pick = resolve));
    const opening = controller.openWithDialog();
    editor.type('Typed meanwhile');
    pick(picked);
    await opening;
    expect(editor.getDoc()).toBe('Typed meanwhile');
    expect(host.openedWindows).toEqual(['/docs/plan.md']);
  });

  it('does nothing when the dialog is cancelled', async () => {
    const { host, editor, controller } = setup({ '/docs/old.md': 'Old\n' });
    await controller.open('/docs/old.md');
    await controller.openWithDialog();
    expect(editor.getDoc()).toBe('Old\n');
    expect(host.openedWindows).toEqual([]);
  });

  it('says so in a notice when the file can’t be read, or the window can’t open', async () => {
    const { host, controller } = setup({ '/docs/old.md': 'Old\n' });
    await controller.open('/docs/old.md');
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    host.pickError = new NotUtf8Error();
    await controller.openWithDialog();
    expect(controller.state.notice).toBe(new NotUtf8Error().message);

    host.pickError = null;
    host.picked = picked;
    host.failOpenWindow = true;
    await controller.openWithDialog();
    expect(controller.state.notice).toBe('Couldn’t open plan.md.');
    error.mockRestore();
  });

  it('opens it in a new window while a run is live, though the window looks untouched', async () => {
    let live = true;
    const { host, editor, controller } = setup({}, { isRunLive: () => live });
    await controller.create();
    expect(controller.untouched).toBe(false);
    host.picked = picked;
    await controller.openWithDialog();
    expect(editor.getDoc()).toBe('');
    expect(host.openedWindows).toEqual(['/docs/plan.md']);
    live = false;
    expect(controller.untouched).toBe(true);
  });

  it('counts a saved document as touched', async () => {
    const { controller, editor } = setup();
    await controller.create();
    editor.type('Draft');
    await controller.saveAs();
    expect(controller.untouched).toBe(false);
  });
});

describe('agent edits', () => {
  const PLAN = 'The importer ships in April.\n';
  const EDITED = 'The importer ships in <!--ins k3x9-->early <!--/k3x9-->April.\n';

  it('writes an agent edit to the file while the document is clean, and stays clean', async () => {
    const { host, editor, controller, state } = setup({ '/docs/plan.md': PLAN });
    await controller.open('/docs/plan.md');
    await controller.applyAgentEdit(EDITED);
    expect(editor.reloadDoc).toHaveBeenCalledWith(EDITED);
    expect(host.files.get('/docs/plan.md')).toBe(EDITED);
    expect(state()?.dirty).toBe(false);
    expect(controller.savedAt).not.toBeNull();
    // The watcher's echo of that write changes nothing.
    host.watchers.get('/docs/plan.md')?.();
    await settle();
    expect(editor.reloadDoc).toHaveBeenCalledTimes(1);
    expect(state()?.notice).toBeNull();
  });

  it('applies the edit at once, before the file is written', async () => {
    const { host, editor, controller } = setup({ '/docs/plan.md': PLAN });
    await controller.open('/docs/plan.md');
    host.holdReads = true;
    const applying = controller.applyAgentEdit(EDITED);
    expect(editor.getDoc()).toBe(EDITED);
    await settle();
    // It looks at the file before writing it.
    expect(host.heldReads).toHaveLength(1);
    expect(host.files.get('/docs/plan.md')).toBe(PLAN);
    host.holdReads = false;
    for (const resolve of host.heldReads.splice(0)) resolve();
    await applying;
    expect(host.files.get('/docs/plan.md')).toBe(EDITED);
  });

  it('writes edits in the order they came, never an older one over a newer', async () => {
    const { host, controller, state } = setup({ '/docs/plan.md': PLAN });
    await controller.open('/docs/plan.md');
    const second = EDITED.replace('April', 'May');
    const third = second.replace('importer', 'new importer');
    await controller.applyAgentEdit(EDITED);
    await controller.applyAgentEdit(second);
    expect(host.writes.map(({ text }) => text)).toEqual([EDITED, second]);
    // Two at once: the file ends with the last.
    await Promise.all([controller.applyAgentEdit(EDITED), controller.applyAgentEdit(third)]);
    expect(host.writes.at(-1)?.text).toBe(third);
    expect(host.files.get('/docs/plan.md')).toBe(third);
    expect(state()?.dirty).toBe(false);
  });

  it('waits for an agent edit being written before Save looks at the file', async () => {
    const { host, editor, controller } = setup({ '/docs/plan.md': PLAN });
    await controller.open('/docs/plan.md');
    host.holdReads = true;
    const applying = controller.applyAgentEdit(EDITED);
    editor.type(`${EDITED}More.\n`);
    const saving = controller.save();
    await settle();
    // The edit is being written, and Save waits for it.
    expect(host.heldReads).toHaveLength(1);
    host.holdReads = false;
    for (const resolve of host.heldReads.splice(0)) resolve();
    await applying;
    expect(await saving).toBe(true);
    expect(host.overwriteAsked).toBe(0);
    expect(host.files.get('/docs/plan.md')).toBe(`${EDITED}More.\n`);
  });

  it('looks at a change on disk only once the agent edits being written are on disk', async () => {
    const { host, editor, controller } = setup({ '/docs/plan.md': PLAN });
    await controller.open('/docs/plan.md');
    const second = EDITED.replace('April', 'May');
    const write = host.write.bind(host);
    let watching: Promise<void> | undefined;
    let applyingSecond: Promise<void> | undefined;
    host.write = async (path, text) => {
      await write(path, text);
      if (watching) return;
      // The first is on disk, and before the write call returns, the agent edits again and the
      // watcher reports the first.
      applyingSecond = controller.applyAgentEdit(second);
      watching = controller.externalChange();
      await settle();
    };
    await controller.applyAgentEdit(EDITED);
    await applyingSecond;
    await watching;
    expect(editor.getDoc()).toBe(second);
    expect(host.files.get('/docs/plan.md')).toBe(second);
    expect(controller.state.dirty).toBe(false);
  });

  it('leaves the file alone while there are unsaved edits, and Save writes both', async () => {
    const { host, editor, controller, state } = setup({ '/docs/plan.md': PLAN });
    await controller.open('/docs/plan.md');
    editor.type(`Today ${PLAN}`);
    await controller.applyAgentEdit(`Today ${EDITED}`);
    expect(editor.getDoc()).toBe(`Today ${EDITED}`);
    expect(host.files.get('/docs/plan.md')).toBe(PLAN);
    expect(host.writes).toEqual([]);
    expect(state()?.dirty).toBe(true);
    expect(await controller.save()).toBe(true);
    expect(host.files.get('/docs/plan.md')).toBe(`Today ${EDITED}`);
    expect(state()?.dirty).toBe(false);
  });

  it('keeps an edit typed while the file was being written', async () => {
    const { host, editor, controller, state } = setup({ '/docs/plan.md': PLAN });
    await controller.open('/docs/plan.md');
    host.holdReads = true;
    const applying = controller.applyAgentEdit(EDITED);
    await settle();
    editor.type(`${EDITED}More.\n`);
    host.holdReads = false;
    for (const resolve of host.heldReads.splice(0)) resolve();
    await applying;
    expect(host.files.get('/docs/plan.md')).toBe(EDITED);
    expect(editor.getDoc()).toBe(`${EDITED}More.\n`);
    expect(state()?.dirty).toBe(true);
  });

  it('only reloads a document with no file, which stays unsaved', async () => {
    const { host, editor, controller, state } = setup();
    await controller.create();
    editor.type(PLAN);
    await controller.applyAgentEdit(EDITED);
    expect(editor.getDoc()).toBe(EDITED);
    expect(host.writes).toEqual([]);
    expect(state()?.dirty).toBe(true);
  });

  it('does not write over a file that changed on disk, and keeps the edit unsaved', async () => {
    const { host, editor, controller, state } = setup({ '/docs/plan.md': PLAN });
    await controller.open('/docs/plan.md');
    // Changed elsewhere, and the watcher hasn't said so yet.
    host.files.set('/docs/plan.md', 'Someone else wrote this.\n');
    await controller.applyAgentEdit(EDITED);
    expect(editor.getDoc()).toBe(EDITED);
    expect(host.files.get('/docs/plan.md')).toBe('Someone else wrote this.\n');
    expect(state()?.dirty).toBe(true);
    expect(state()?.notice).toBe(CHANGED_ON_DISK);
  });

  it('says so, and keeps the edit unsaved, when the file can’t be written', async () => {
    const { host, editor, controller, state } = setup({ '/docs/plan.md': PLAN });
    await controller.open('/docs/plan.md');
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    host.write = () => Promise.reject(new Error('disk full'));
    await controller.applyAgentEdit(EDITED);
    expect(editor.getDoc()).toBe(EDITED);
    expect(state()?.dirty).toBe(true);
    expect(state()?.notice).toBe('Couldn’t save plan.md.');
    error.mockRestore();
  });

  it('lets go of nothing when the reload throws: the next change on disk is still looked at', async () => {
    const { host, editor, controller, state } = setup({ '/docs/plan.md': PLAN });
    await controller.open('/docs/plan.md');
    editor.reloadDoc.mockImplementationOnce(() => {
      throw new Error('broken view');
    });
    await expect(controller.applyAgentEdit(EDITED)).rejects.toThrow('broken view');
    expect(state()?.dirty).toBe(false);
    // Nothing is left waiting: a change on disk reloads at once.
    host.files.set('/docs/plan.md', 'Changed.\n');
    await controller.externalChange();
    expect(editor.getDoc()).toBe('Changed.\n');
    expect(host.writes).toEqual([]);
  });

  it('keeps saving after an agent edit’s write went wrong in a way it didn’t expect', async () => {
    const { host, editor, controller } = setup({ '/docs/plan.md': PLAN });
    await controller.open('/docs/plan.md');
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    // The write fails, and so does telling the window about it.
    host.write = () => Promise.reject(new Error('disk full'));
    editor.getDoc.mockImplementation(() => {
      throw new Error('broken view');
    });
    await expect(controller.applyAgentEdit(EDITED)).rejects.toThrow();
    editor.getDoc.mockRestore();
    host.write = (path, text) => {
      host.files.set(path, text);
      host.writes.push({ path, text });
      return Promise.resolve();
    };
    editor.type(`${EDITED}More.\n`);
    host.overwriteChoice = 'overwrite';
    expect(await controller.save()).toBe(true);
    expect(host.files.get('/docs/plan.md')).toBe(`${EDITED}More.\n`);
    error.mockRestore();
  });

  it('waits for an agent edit being written before asking about unsaved edits', async () => {
    const { host, controller } = setup({ '/docs/plan.md': PLAN });
    await controller.open('/docs/plan.md');
    host.holdReads = true;
    const applying = controller.applyAgentEdit(EDITED);
    const closing = controller.confirmDiscard();
    await settle();
    let answered = false;
    void closing.then(() => (answered = true));
    await settle();
    // Not before the edit is on disk.
    expect(answered).toBe(false);
    host.holdReads = false;
    for (const resolve of host.heldReads.splice(0)) resolve();
    await applying;
    expect(await closing).toBe(true);
    expect(host.files.get('/docs/plan.md')).toBe(EDITED);
    expect(host.asked).toBe(0);
  });

  it('asks about unsaved edits when the agent edit couldn’t be written', async () => {
    const { host, controller } = setup({ '/docs/plan.md': PLAN });
    await controller.open('/docs/plan.md');
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    host.write = () => Promise.reject(new Error('disk full'));
    host.choice = 'cancel';
    const applying = controller.applyAgentEdit(EDITED);
    expect(await controller.confirmDiscard()).toBe(false);
    expect(host.asked).toBe(1);
    await applying;
    error.mockRestore();
  });

  it('reports itself busy while an agent edit is being written, so that quitting asks it', async () => {
    const { host, controller, state } = setup({ '/docs/plan.md': PLAN });
    await controller.open('/docs/plan.md');
    expect(state()?.writing).toBe(false);
    host.holdReads = true;
    const applying = controller.applyAgentEdit(EDITED);
    // Nothing is unsaved, but it isn't on disk yet either.
    expect(state()).toMatchObject({ dirty: false, writing: true });
    await settle();
    host.holdReads = false;
    for (const resolve of host.heldReads.splice(0)) resolve();
    await applying;
    expect(state()).toMatchObject({ dirty: false, writing: false });
  });

  it('waits for agent edits being written before the app quits, and asks nothing once they are on disk', async () => {
    const { host, controller } = setup({ '/docs/plan.md': PLAN });
    await controller.open('/docs/plan.md');
    host.holdReads = true;
    const applying = controller.applyAgentEdit(EDITED);
    const toFront = vi.fn(() => Promise.resolve());
    let answer: boolean | undefined;
    void controller.confirmQuit(toFront).then((given) => (answer = given));
    await settle();
    expect(answer).toBeUndefined();
    host.holdReads = false;
    for (const resolve of host.heldReads.splice(0)) resolve();
    await applying;
    await settle();
    expect(answer).toBe(true);
    expect(host.files.get('/docs/plan.md')).toBe(EDITED);
    expect(toFront).not.toHaveBeenCalled();
    expect(host.asked).toBe(0);
  });

  it('brings the window forward and asks before quitting when an agent edit couldn’t be written', async () => {
    const { host, controller } = setup({ '/docs/plan.md': PLAN });
    await controller.open('/docs/plan.md');
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    host.write = () => Promise.reject(new Error('disk full'));
    host.choice = 'cancel';
    const applying = controller.applyAgentEdit(EDITED);
    const toFront = vi.fn(() => Promise.resolve());
    expect(await controller.confirmQuit(toFront)).toBe(false);
    expect(toFront).toHaveBeenCalledOnce();
    expect(host.asked).toBe(1);
    await applying;
    error.mockRestore();
  });

  it('asks nothing before quitting a clean document with nothing being written', async () => {
    const { host, controller } = setup({ '/docs/plan.md': PLAN });
    await controller.open('/docs/plan.md');
    const toFront = vi.fn(() => Promise.resolve());
    expect(await controller.confirmQuit(toFront)).toBe(true);
    expect(toFront).not.toHaveBeenCalled();
    expect(host.asked).toBe(0);
  });

  it('waits also for agent edits that came while it waited, before asking about unsaved edits', async () => {
    const { host, controller } = setup({ '/docs/plan.md': PLAN });
    await controller.open('/docs/plan.md');
    const second = EDITED.replace('April', 'May');
    host.holdReads = true;
    const first = controller.applyAgentEdit(EDITED);
    await settle();
    const closing = controller.confirmDiscard();
    // Another edit lands while the window waits.
    const then = controller.applyAgentEdit(second);
    host.holdReads = false;
    for (const resolve of host.heldReads.splice(0)) resolve();
    expect(await closing).toBe(true);
    // By the time it said yes, the later edit was on disk too.
    expect(host.files.get('/docs/plan.md')).toBe(second);
    await Promise.all([first, then]);
  });

  it('counts a new generation each time another document replaces this one', async () => {
    const { host, editor, controller } = setup({ '/docs/plan.md': PLAN, '/docs/b.md': 'B\n' });
    const first = controller.generation;
    await controller.open('/docs/plan.md');
    const opened = controller.generation;
    expect(opened).not.toBe(first);
    // Not for a reload, a save or an agent edit: those are the same document.
    host.files.set('/docs/plan.md', 'Changed.\n');
    await controller.externalChange();
    editor.type('Typed.\n');
    await controller.save();
    await controller.applyAgentEdit('Edited.\n');
    expect(controller.generation).toBe(opened);
    await controller.open('/docs/b.md');
    expect(controller.generation).not.toBe(opened);
  });
});

describe('a run, with the live editor and the file', () => {
  const PLAN = 'The importer ships in April.\n\nThe tests run in CI.\n';
  const me = { handle: 'ada', name: 'Ada Lovelace' };

  /** A window's document: a real editor, the controller over a file, and runs with a fake agent. */
  async function live(script: FakeScript) {
    const host = new FakeHost();
    host.files.set('/docs/plan.md', PLAN);
    const parent = document.createElement('div');
    document.body.append(parent);
    const editor = createEditor(parent, {
      doc: '',
      author: me,
      onChange: (text) => doc.markEdited(text),
    });
    editor.view.focus = () => {};
    editor.view.contentDOM.focus = () => {};
    let state: DocumentState | null = null;
    const relay = fakeRelay();
    const claude = fakeProvider({ relay, script });
    const runs = createRuns({
      agents: createMacAgents([claude], relay),
      author: me,
      document: {
        path: () => doc.state.path,
        generation: () => doc.generation,
        read: () => editor.getDoc(),
        save: () => doc.save(),
        applyAgentEdit: (next) => doc.applyAgentEdit(next),
      },
      projectRoot: () => Promise.resolve({ folder: '/docs', isRepo: false, tooBroad: false }),
      settings: { defaultScope: () => 'folder', consent: () => 'folder', setConsent: () => {} },
      onEnded: () => {},
    });
    const doc = new DocumentController(host, editor, (next) => (state = next), {
      isRunLive: () => runs.isLive(),
    });
    await doc.open('/docs/plan.md');
    /** Comments on `word` as the person, and posts it. */
    const post = (word: string, text: string) => {
      const view = editor.view.state.doc.toString();
      const from = view.indexOf(word);
      const { changes, id } = addComment(view, { from, to: from + word.length }, text, {
        author: me,
        time: '2026-11-05T10:30Z',
      });
      editor.view.dispatch({ changes });
      runs.posted({ thread: id, text });
      return id;
    };
    return { host, editor, doc, runs, post, state: () => state };
  }

  it('writes each agent edit to disk while the document is clean', async () => {
    const seen: string[] = [];
    const { host, editor, doc, runs, post, state } = await live(async function* ({ tools }) {
      await tools.initialize();
      // The person's comment was saved before the agent started.
      seen.push(host.files.get('/docs/plan.md') ?? '');
      await tools.call('str_replace', { old_str: 'April', new_str: 'May' });
      seen.push(host.files.get('/docs/plan.md') ?? '');
      await tools.call('str_replace', { old_str: 'CI', new_str: 'the nightly build' });
      seen.push(host.files.get('/docs/plan.md') ?? '');
      await tools.call('reply', { text: 'Moved to May, nightly.' });
      yield { type: 'done' };
    });
    post('importer', '@Claude move it');
    await vi.waitFor(() => expect(runs.isLive()).toBe(false));
    expect(seen[0]).toContain('@Claude move it');
    expect(parse(seen[1] ?? '').text).toContain('May');
    expect(parse(seen[1] ?? '').text).not.toContain('nightly');
    expect(parse(seen[2] ?? '').text).toContain('nightly');
    expect(host.files.get('/docs/plan.md')).toBe(editor.getDoc());
    expect(host.writes).toHaveLength(4);
    expect(state()?.dirty).toBe(false);
    expect(doc.state.notice).toBeNull();
    editor.destroy();
  });

  it('leaves the file alone while there are unsaved edits, and Save writes both', async () => {
    let release = () => {};
    const released = new Promise<void>((resolve) => (release = resolve));
    const { host, editor, doc, runs, post } = await live(async function* ({ tools }) {
      await tools.initialize();
      await released;
      await tools.call('str_replace', { old_str: 'run in CI', new_str: 'run nightly' });
      await tools.call('reply', { text: 'Nightly now.' });
      yield { type: 'done' };
    });
    post('importer', '@Claude make it nightly');
    await vi.waitFor(() => expect(host.writes).toHaveLength(1));
    const saved = host.files.get('/docs/plan.md');
    // The person types while the agent works.
    editor.view.dispatch({
      changes: { from: 0, insert: 'Today ' },
      selection: { anchor: 'Today '.length },
      userEvent: 'input.type',
    });
    expect(doc.state.dirty).toBe(true);
    release();
    await vi.waitFor(() => expect(runs.isLive()).toBe(false));
    expect(host.files.get('/docs/plan.md')).toBe(saved);
    expect(host.writes).toHaveLength(1);
    expect(doc.state.dirty).toBe(true);
    const both = editor.getDoc();
    expect(both.startsWith('Today The ')).toBe(true);
    expect(parse(both).text).toContain('nightly');
    expect(editor.view.state.selection.main.head).toBe('Today '.length);

    expect(await doc.save()).toBe(true);
    expect(host.files.get('/docs/plan.md')).toBe(both);
    expect(doc.state.dirty).toBe(false);
    editor.destroy();
  });

  it('opens a file in a new window while the run is live', async () => {
    let release = () => {};
    const released = new Promise<void>((resolve) => (release = resolve));
    const { host, editor, doc, runs, post } = await live(async function* ({ tools }) {
      await tools.initialize();
      await released;
      await tools.call('reply', { text: 'Done.' });
      yield { type: 'done' };
    });
    post('importer', '@Claude wait');
    expect(runs.isLive()).toBe(true);
    host.picked = { path: '/docs/other.md', text: 'Other\n' };
    await doc.openWithDialog();
    expect(host.openedWindows).toEqual(['/docs/other.md']);
    expect(doc.state.path).toBe('/docs/plan.md');
    release();
    await vi.waitFor(() => expect(runs.isLive()).toBe(false));
    editor.destroy();
  });
});

describe('deriveHandle', () => {
  it('derives a handle from the email', () => {
    expect(deriveHandle('Ada Lovelace', 'Ada.Lovelace@example.org')).toBe('ada-lovelace');
    expect(deriveHandle('Bo Chen', 'bo+work@example.org')).toBe('bo-work');
  });

  it('falls back to the name, then to a safe default', () => {
    expect(deriveHandle('Zoë Ångström')).toBe('zoe-angstrom');
    expect(deriveHandle('Bo Chen', null)).toBe('bo-chen');
    expect(deriveHandle('2 Fast', '42@example.org')).toBe('fast');
    expect(deriveHandle('No', 'yes@example.org')).toBe('me');
    expect(deriveHandle('李雷')).toBe('me');
  });
});

describe('decodeCapped', () => {
  it('decodes a file within the limit, and not one over it', () => {
    const bytes = new TextEncoder().encode('héllo');
    expect(decodeCapped(bytes, bytes.byteLength)).toEqual({ text: 'héllo' });
    expect(decodeCapped(bytes, bytes.byteLength - 1)).toEqual({ tooLarge: true });
    // Over the limit is told before the bytes are looked at, so bytes that aren't UTF-8 are too.
    expect(decodeCapped(new Uint8Array([0xff, 0xfe, 0xfd]), 2)).toEqual({ tooLarge: true });
  });
});

describe('decodeText', () => {
  it('keeps a byte order mark, so an untouched save writes the same bytes', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x23, 0x20, 0x41, 0x0d, 0x0a]);
    const text = decodeText(bytes);
    expect(text).toBe('\uFEFF# A\r\n');
    expect(new TextEncoder().encode(text)).toEqual(bytes);
  });

  it('refuses bytes that are not UTF-8, rather than replacing them', () => {
    // "caf\u00E9" in Latin-1: decoding it as UTF-8 would turn \u00E9 into U+FFFD, and saving would keep that.
    expect(() => decodeText(new Uint8Array([0x63, 0x61, 0x66, 0xe9]))).toThrow(NotUtf8Error);
  });
});
