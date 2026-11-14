// @vitest-environment happy-dom
import { createEditor, type Editor } from '@redlines/editor';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { editCommands, pageClipboard } from './edit.ts';

const ada = { handle: 'ada', name: 'Ada Lovelace' };
const open: Editor[] = [];

afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
  // The page's own `execCommand` again, for the tests that stub it.
  Reflect.deleteProperty(document, 'execCommand');
  vi.restoreAllMocks();
});

function mount(doc: string, tracking = false): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, { doc, author: ada, tracking });
  // happy-dom fires `selectionchange` while CodeMirror writes a focused editor's selection.
  vi.spyOn(editor.view, 'focus').mockImplementation(() => {});
  open.push(editor);
  return editor;
}

/** A page whose editing commands answer as a browser's do for a press of a button. */
function exec(answer: boolean) {
  const run = vi.fn(() => answer);
  Object.defineProperty(document, 'execCommand', { value: run, configurable: true });
  return run;
}

describe('pageClipboard', () => {
  it('cuts and copies with the page’s editing commands, with the keyboard in the document', async () => {
    const editor = mount('Hello world');
    const focus = vi.spyOn(editor.view, 'focus');
    const run = exec(true);
    const clipboard = pageClipboard(editor, () => Promise.resolve(''));
    await clipboard.cut();
    await clipboard.copy();
    expect(run.mock.calls).toEqual([['cut'], ['copy']]);
    expect(focus).toHaveBeenCalledTimes(2);
  });

  it('says so when the page will not cut or copy', () => {
    const editor = mount('Hello world');
    exec(false);
    const clipboard = pageClipboard(editor, () => Promise.resolve(''));
    expect(() => clipboard.cut()).toThrow("The page wouldn't cut");
    expect(() => clipboard.copy()).toThrow("The page wouldn't copy");
  });

  it('pastes the text the host reads at the selection, as ⇧⌘V does', async () => {
    const editor = mount('Hello world');
    editor.view.dispatch({ selection: { anchor: 5, head: 11 } });
    const clipboard = pageClipboard(editor, () => Promise.resolve(', everyone'));
    await clipboard.paste();
    expect(editor.view.state.doc.toString()).toBe('Hello, everyone');
  });

  it('pastes as the paster’s insertion while Track Changes is on', async () => {
    const editor = mount('Hello', true);
    editor.view.dispatch({ selection: { anchor: 5 } });
    const clipboard = pageClipboard(editor, () => Promise.resolve(' there'));
    await clipboard.paste();
    const marks = editor.getParsed().marks;
    expect(marks.map((mark) => [mark.kind, mark.entry.by])).toEqual([['ins', 'ada']]);
    // The pasted text is the insertion, between its markers.
    expect(editor.view.state.doc.toString()).toMatch(/^Hello<!--ins (\w+)--> there<!--\/\1-->/);
  });

  it('pastes with the host’s own Paste when it has one, and reads no text', async () => {
    const editor = mount('Hello world');
    const read = vi.fn(() => Promise.resolve('plain'));
    const native = vi.fn(() => Promise.resolve(true));
    const focus = vi.spyOn(editor.view, 'focus');
    await pageClipboard(editor, read, native).paste();
    expect(native).toHaveBeenCalledOnce();
    // The keyboard is in the document before it is asked, as for the Mac's own Paste.
    expect(focus.mock.invocationCallOrder[0]).toBeLessThan(native.mock.invocationCallOrder[0] ?? 0);
    expect(read).not.toHaveBeenCalled();
    // The page's own paste event does the pasting, which the host's Paste makes: nothing is
    // written here.
    expect(editor.view.state.doc.toString()).toBe('Hello world');
  });

  it.each<[string, () => Promise<boolean>]>([
    ['says nothing took it', () => Promise.resolve(false)],
    ['fails', () => Promise.reject(new Error('no'))],
  ])('pastes the clipboard’s text when the host’s Paste %s', async (_what, run) => {
    const editor = mount('Hello world');
    editor.view.dispatch({ selection: { anchor: 5, head: 11 } });
    const native = vi.fn(run);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await pageClipboard(editor, () => Promise.resolve(', there'), native).paste();
    // It was asked first, and what it said didn't take it.
    expect(native).toHaveBeenCalledOnce();
    expect(editor.view.state.doc.toString()).toBe('Hello, there');
  });

  it('says so when neither the host’s Paste nor the clipboard has anything', async () => {
    const editor = mount('Hello');
    await expect(
      pageClipboard(
        editor,
        () => Promise.resolve(''),
        () => Promise.resolve(false),
      ).paste(),
    ).rejects.toThrow('The clipboard has no text');
    expect(editor.view.state.doc.toString()).toBe('Hello');
  });

  it('rejects for a clipboard with no text, and for one that cannot be read', async () => {
    const editor = mount('Hello');
    await expect(pageClipboard(editor, () => Promise.resolve('')).paste()).rejects.toThrow(
      'The clipboard has no text',
    );
    await expect(
      pageClipboard(editor, () => Promise.reject(new Error('denied'))).paste(),
    ).rejects.toThrow('denied');
    expect(editor.view.state.doc.toString()).toBe('Hello');
  });
});

describe('editCommands', () => {
  it('are Cut, Copy and Paste, which need a selection but for Paste', () => {
    const editor = mount('Hello world');
    const clipboard = { cut: vi.fn(), copy: vi.fn(), paste: vi.fn() };
    const [cut, copy, paste] = editCommands(clipboard, () => {});
    expect([cut?.id, copy?.id, paste?.id]).toEqual(['edit.cut', 'edit.copy', 'edit.paste']);
    expect(cut?.isEnabled?.(editor.view.state)).toBe(false);
    // Paste works with no selection: it has no test of one.
    expect(paste).not.toHaveProperty('isEnabled');
    editor.view.dispatch({ selection: { anchor: 0, head: 5 } });
    expect(cut?.isEnabled?.(editor.view.state)).toBe(true);
    expect(copy?.isEnabled?.(editor.view.state)).toBe(true);
  });

  it('report a clipboard that fails, whether it throws or rejects', async () => {
    const editor = mount('Hello');
    const failed = vi.fn();
    const [cut, , paste] = editCommands(
      {
        cut: () => {
          throw new Error('no');
        },
        copy: () => {},
        paste: () => Promise.reject(new Error('empty')),
      },
      failed,
    );
    expect(cut?.run(editor)).toBe(false);
    expect(failed).toHaveBeenCalledWith('cut', expect.any(Error));
    expect(paste?.run(editor)).toBe(true);
    await vi.waitFor(() => expect(failed).toHaveBeenCalledWith('paste', expect.any(Error)));
  });
});
