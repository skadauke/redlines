import { describe, expect, it } from 'vitest';
import { CHANGED_ON_DISK, DocumentController, type DocumentState } from './document.ts';
import { decodeText, deriveHandle, type FileEntry, type Host, type SaveChoice } from './host.ts';

/** A host over an in-memory folder, with a watcher the test fires by hand. */
class FakeHost implements Host {
  files = new Map<string, string>();
  writes: { path: string; text: string }[] = [];
  watchers = new Map<string, () => void>();
  saveAsPath: string | null = '/docs/new.md';
  choice: SaveChoice = 'cancel';
  asked = 0;

  identity() {
    return Promise.resolve({ handle: 'ada', name: 'Ada Lovelace' });
  }
  open() {
    return Promise.resolve(null);
  }
  read(path: string) {
    const text = this.files.get(path);
    return text === undefined ? Promise.reject(new Error('not found')) : Promise.resolve(text);
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
}

/** An editor that, like a real one might, reports a change when its whole text is replaced. */
function fakeEditor() {
  let doc = '';
  let onChange = () => {};
  return {
    getDoc: () => doc,
    setDoc: (text: string) => {
      doc = text;
      onChange();
    },
    type: (text: string) => {
      doc = text;
      onChange();
    },
    onChange: (fn: () => void) => (onChange = fn),
  };
}

function setup(files: Record<string, string> = {}) {
  const host = new FakeHost();
  for (const [path, text] of Object.entries(files)) host.files.set(path, text);
  const editor = fakeEditor();
  let state: DocumentState | null = null;
  const controller = new DocumentController(host, editor, (s) => (state = s));
  editor.onChange(() => controller.markEdited());
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
    const text = '﻿# Plan 🚀\r\n\r\nCafé <!--ins k3x9-->new <!--/k3x9-->\r\n';
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

  it('marks a file deleted on disk as unsaved', async () => {
    const { host, editor, controller, state } = setup({ '/docs/plan.md': 'One\n' });
    await controller.open('/docs/plan.md');
    host.files.delete('/docs/plan.md');
    await controller.externalChange();
    expect(editor.getDoc()).toBe('One\n');
    expect(state()?.dirty).toBe(true);
    expect(state()?.notice).toBe('This file was moved or deleted. Save to keep it.');
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
    expect(text).toBe('﻿# A\r\n');
    expect(new TextEncoder().encode(text)).toEqual(bytes);
  });
});
