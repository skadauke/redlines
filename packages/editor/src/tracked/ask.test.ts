// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { undoSayingWhy } from '../history/guard.ts';
import {
  createEditor,
  type Editor,
  setViewModeEffect,
  type UntrackedAnswer,
  type UntrackedReason,
} from '../index.ts';

const open: Editor[] = [];
afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));
const FRONT = '---\ntitle: Notes\n---\n';
const DOC = `${FRONT}\nFirst words.\n`;
const END = DOC.length - 1;

/** An editor whose sheet is a function: what it was asked, and its answers. */
function load(doc: string, view: 'redlines' | 'raw', answers: UntrackedAnswer[], skip = false) {
  const asked: UntrackedReason[] = [];
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, {
    doc,
    author: { handle: 'ada', name: 'Ada' },
    tracking: true,
    view,
    askUntracked: {
      ask: (reason) => {
        asked.push(reason);
        return Promise.resolve(answers.shift() ?? 'cancel');
      },
      skip: () => skip,
    },
  });
  open.push(editor);
  return { editor, asked };
}

const type = (editor: Editor, text: string, event = 'input.type') =>
  editor.view.dispatch(editor.view.state.replaceSelection(text), { userEvent: event });
const caret = (editor: Editor, at: number) => editor.view.dispatch({ selection: { anchor: at } });
const composing = (editor: Editor) =>
  (editor.view as unknown as { inputState: { composing: number } }).inputState;

describe('the alert for an edit that no mark can hold', () => {
  it('holds a key in front matter, and makes it untracked on Make Edit', async () => {
    const { editor, asked } = load(DOC, 'redlines', ['make']);
    caret(editor, '---\ntitle: Notes'.length);
    type(editor, 'X');
    // Held: the document is as it was while the sheet is up.
    expect(editor.getDoc()).toBe(DOC);
    await tick();
    expect(asked).toEqual(['front-matter']);
    expect(editor.getDoc()).toBe(DOC.replace('Notes', 'NotesX'));
    expect(editor.getParsed().marks).toEqual([]);
  });

  it('drops it on Cancel', async () => {
    const { editor, asked } = load(DOC, 'redlines', ['cancel']);
    caret(editor, '---\ntitle: Notes'.length);
    type(editor, 'X');
    await tick();
    expect(asked).toEqual(['front-matter']);
    expect(editor.getDoc()).toBe(DOC);
  });

  it('asks once for a word typed in Raw, and again after a pause', async () => {
    const { editor, asked } = load(DOC, 'raw', ['make', 'cancel']);
    caret(editor, END);
    type(editor, 'a');
    await tick();
    type(editor, 'b');
    type(editor, 'c');
    expect(editor.getDoc()).toBe(DOC.replace('words.', 'words.abc'));
    expect(asked).toEqual(['raw']);
    // Past the run, the next edit asks again.
    const now = Date.now();
    const real = Date.now;
    Date.now = () => now + 6000;
    try {
      type(editor, 'd');
      await tick();
    } finally {
      Date.now = real;
    }
    expect(asked).toEqual(['raw', 'raw']);
    expect(editor.getDoc()).toBe(DOC.replace('words.', 'words.abc'));
  });

  it('holds a paste in Raw like a key', async () => {
    const { editor, asked } = load(DOC, 'raw', ['make']);
    caret(editor, END);
    type(editor, 'pasted', 'input.paste');
    expect(editor.getDoc()).toBe(DOC);
    await tick();
    expect(asked).toEqual(['raw']);
    expect(editor.getDoc()).toBe(DOC.replace('words.', 'words.pasted'));
  });

  it("makes the edit at once when 'Don't ask again' is set", () => {
    const { editor, asked } = load(DOC, 'raw', [], true);
    caret(editor, END);
    type(editor, 'a');
    expect(editor.getDoc()).toBe(DOC.replace('words.', 'words.a'));
    expect(asked).toEqual([]);
  });

  it('drops a held edit when the document changed under the sheet', async () => {
    const parent = document.createElement('div');
    document.body.append(parent);
    let answer: (a: UntrackedAnswer) => void = () => {};
    const editor = createEditor(parent, {
      doc: DOC,
      author: { handle: 'ada', name: 'Ada' },
      tracking: true,
      view: 'raw',
      askUntracked: {
        ask: () => new Promise<UntrackedAnswer>((resolve) => (answer = resolve)),
        skip: () => false,
      },
    });
    open.push(editor);
    caret(editor, END);
    type(editor, 'a');
    await tick();
    editor.setTracking(false);
    type(editor, 'z');
    answer('make');
    await tick();
    expect(editor.getDoc()).toBe(DOC.replace('words.', 'words.z'));
  });

  it('takes no step back in Raw while edits are tracked, with a host that asks', () => {
    const { editor, asked } = load(DOC, 'redlines', []);
    caret(editor, END);
    type(editor, 'a');
    editor.view.dispatch({ effects: setViewModeEffect.of('raw') });
    expect(undoSayingWhy(editor.view)).toBe(true);
    expect(editor.getDoc()).toContain('a');
    expect(asked).toEqual([]);
  });

  describe('an input method', () => {
    const compose = (editor: Editor, at: number, text: string) =>
      editor.view.dispatch({
        changes: { from: at, insert: text },
        selection: { anchor: at + text.length },
        userEvent: 'input.type.compose.start',
      });
    const finish = async (editor: Editor) => {
      composing(editor).composing = -1;
      editor.view.contentDOM.dispatchEvent(new Event('compositionend', { bubbles: true }));
      await tick();
    };

    it('in Raw: composes as it is, and asks when it ends', async () => {
      const { editor, asked } = load(DOC, 'raw', ['make']);
      composing(editor).composing = 1;
      compose(editor, END, 'ö');
      expect(editor.getDoc()).toBe(DOC.replace('words.', 'words.ö'));
      expect(asked).toEqual([]);
      await finish(editor);
      expect(asked).toEqual(['raw']);
      expect(editor.getDoc()).toBe(DOC.replace('words.', 'words.ö'));
    });

    it('in front matter: takes it back on Cancel', async () => {
      const { editor, asked } = load(DOC, 'redlines', ['cancel']);
      composing(editor).composing = 1;
      compose(editor, '---\ntitle: Notes'.length, 'ö');
      await finish(editor);
      expect(asked).toEqual(['front-matter']);
      expect(editor.getDoc()).toBe(DOC);
    });
  });
});
