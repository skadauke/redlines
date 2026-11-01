import { describe, expect, it, vi } from 'vitest';
import {
  CHANGED_ON_DISK,
  DELETED_ON_DISK,
  DocumentController,
  NOT_WATCHED,
  type DocumentState,
} from './document.ts';
import {
  decodeText,
  deriveHandle,
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
    return Promise.resolve(null);
  }
  async read(path: string) {
    if (this.holdReads) await new Promise<void>((resolve) => this.heldReads.push(resolve));
    const bytes = this.bytes.get(path);
    if (bytes) return decodeText(bytes);
    const text = this.files.get(path);
    if (text === undefined) throw new Error('not found');
    return text;
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
  list(): Promise<FileEntry[]> {
    return Promise.resolve([]);
  }
  askToSave() {
    this.asked++;
    return Promise.resolve(this.choice);
  }
  askToOverwrite() {
    this.overwriteAsked++;
    return Promise.resolve(this.overwriteChoice);
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
    setDoc: (text: string) => {
      doc = text;
      onChange(text);
    },
    reloadDoc: (text: string) => {
      doc = text;
      onChange(text);
    },
    type: (text: string) => {
      doc = text;
      onChange(text);
    },
    onChange: (fn: (text: string) => void) => (onChange = fn),
  };
}

function setup(files: Record<string, string> = {}) {
  const host = new FakeHost();
  for (const [path, text] of Object.entries(files)) host.files.set(path, text);
  const editor = fakeEditor();
  let state: DocumentState | null = null;
  const controller = new DocumentController(host, editor, (s) => (state = s));
  editor.onChange((text) => controller.markEdited(text));
  return { host, editor, controller, state: () => state };
}

/** Lets the watcher registration, which runs after open resolves, finish. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('DocumentController', () => {
  it('reloads a clean document when the file changes', async () => {
    const { host, editor, controller, state } = setup({ '/docs/plan.md': 'One\n' });
    await controller.open('/docs/plan.md');
    host.files.set('/docs/plan.md', 'Two\n');
    await controller.externalChange();
    expect(editor.getDoc()).toBe('Two\n');
    expect(state()).toEqual({ path: '/docs/plan.md', name: 'plan.md', dirty: false, notice: null });
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
    expect(state()).toEqual({ path: '/docs/new.md', name: 'new.md', dirty: false, notice: null });
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
    expect(state()).toEqual({ path: '/docs/plan.md', name: 'plan.md', dirty: false, notice: null });

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
    expect(state()).toEqual({ path: '/docs/plan.md', name: 'plan.md', dirty: false, notice: null });
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
    expect(state()).toEqual({ path: '/docs/plan.md', name: 'plan.md', dirty: false, notice: null });
  });

  it('is clean when edits are undone after the file changed on disk', async () => {
    const { host, editor, controller, state } = setup({ '/docs/plan.md': 'One\n' });
    await controller.open('/docs/plan.md');
    editor.type('Mine\n');
    host.files.set('/docs/plan.md', 'Theirs\n');
    await controller.externalChange();
    editor.type('One\n');
    expect(state()?.dirty).toBe(false);
    // Clean, so Save leaves the other version on disk.
    await controller.save();
    expect(host.files.get('/docs/plan.md')).toBe('Theirs\n');
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
