// @vitest-environment happy-dom
// Undo and Redo of what a table's keys and filters write (the plan's Global Constraints: every
// key is a step that undoes and redoes, the selection included): Redo's selection, a pipe composed by
// an input method, a drop and a paste that the cell's escapes rewrite, and a whole table deleted.
import { forceParsing } from '@codemirror/language';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type Editor, redo, undo } from '../index.ts';
import { isStop } from './stops.ts';

const open: Editor[] = [];
afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

function mount(doc: string, tracking: boolean): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, {
    doc,
    author: { handle: 'ada', name: 'Ada Lovelace' },
    tracking,
  });
  open.push(editor);
  forceParsing(editor.view, editor.view.state.doc.length, 10_000);
  return editor;
}

const selection = (editor: Editor) => {
  const { anchor, head } = editor.view.state.selection.main;
  return [anchor, head];
};
const key = (editor: Editor, name: string) =>
  editor.view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));

/** Redo selects what it puts back, as CodeMirror's does, so its selection is not the one the key
 * left: it is the text as it was made, with the selection on stops (in a cell's text, never inside a
 * pipe, padding, marker or line break). */
function expectRedone(editor: Editor, done: { doc: string }, redone: { doc: string }) {
  expect(redone.doc).toBe(done.doc);
  const { anchor, head } = editor.view.state.selection.main;
  expect(isStop(editor.view.state, anchor)).toBe(true);
  expect(isStop(editor.view.state, head)).toBe(true);
}

const T = '| a | b |\n| - | - |\n| 12 | 34 |\n';
const at = (find: string, n = 0) => T.indexOf(find) + n;

/** Does `act`, then Undo and Redo: the text and the selection after each of the three. */
function roundTrip(editor: Editor, act: () => void) {
  const before = { doc: editor.getDoc(), selection: selection(editor) };
  act();
  const done = { doc: editor.getDoc(), selection: selection(editor) };
  expect(done.doc).not.toBe(before.doc);
  undo(editor.view);
  const undone = { doc: editor.getDoc(), selection: selection(editor) };
  redo(editor.view);
  const redone = { doc: editor.getDoc(), selection: selection(editor) };
  return { before, done, undone, redone };
}

describe('Undo and Redo in a table', () => {
  for (const tracking of [false, true]) {
    const mode = `Track Changes ${tracking ? 'on' : 'off'}`;

    it(`Redo gives back a new row, with the selection on a stop, ${mode}`, () => {
      const editor = mount(T, tracking);
      editor.view.dispatch({ selection: { anchor: at('34', 1) } });
      const r = roundTrip(editor, () => key(editor, 'Tab'));
      expect(r.undone).toEqual(r.before);
      expectRedone(editor, r.done, r.redone);
    });

    it(`Redo gives back typed text, with the selection on a stop, ${mode}`, () => {
      const editor = mount(T, tracking);
      editor.view.dispatch({ selection: { anchor: at('12', 1) } });
      const r = roundTrip(editor, () =>
        editor.view.dispatch({
          changes: { from: at('12', 1), insert: '|' },
          selection: { anchor: at('12', 2) },
          userEvent: 'input.type',
        }),
      );
      expect(r.done.doc).toContain('\\|');
      expect(r.undone).toEqual(r.before);
      expectRedone(editor, r.done, r.redone);
    });

    for (const userEvent of ['input.drop', 'input.paste']) {
      it(`takes back text with a pipe that the cell escaped, ${userEvent}, ${mode}`, () => {
        const editor = mount(T, tracking);
        editor.view.dispatch({ selection: { anchor: at('12', 1) } });
        const r = roundTrip(editor, () =>
          editor.view.dispatch({
            changes: { from: at('12', 1), insert: 'x|y\nz' },
            selection: { anchor: at('12', 1) + 5 },
            userEvent,
          }),
        );
        expect(r.done.doc).toContain('x\\|y<br>z');
        // One step: a single Undo gave the document back as it was, and Redo as it was made.
        expect(r.undone).toEqual(r.before);
        expectRedone(editor, r.done, r.redone);
      });
    }
  }

  it('takes back a pipe composed by an input method, and gives it back escaped', async () => {
    for (const tracking of [false, true]) {
      const editor = mount(T, tracking);
      const from = at('12', 1);
      editor.view.dispatch({ selection: { anchor: from } });
      const before = { doc: editor.getDoc(), selection: selection(editor) };
      (editor.view as unknown as { inputState: { composing: number } }).inputState.composing = 1;
      editor.view.dispatch({
        changes: { from, insert: '¨' },
        selection: { anchor: from + 1 },
        userEvent: 'input.type.compose.start',
      });
      editor.view.dispatch({
        changes: { from, to: from + 1, insert: '|' },
        selection: { anchor: from + 1 },
        userEvent: 'input.type.compose',
      });
      (editor.view as unknown as { inputState: { composing: number } }).inputState.composing = -1;
      editor.view.contentDOM.dispatchEvent(new Event('compositionend', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 10));
      const done = { doc: editor.getDoc(), selection: selection(editor) };
      expect(done.doc).toContain('\\|');
      undo(editor.view);
      expect({ doc: editor.getDoc(), selection: selection(editor) }).toEqual(before);
      redo(editor.view);
      expectRedone(editor, done, { doc: editor.getDoc() });
    }
  });

  for (const tracking of [false, true]) {
    it(`takes a deleted table back with the selection it had, Track Changes ${tracking ? 'on' : 'off'}`, () => {
      const doc = `Intro.\n\n${T}\nAfter.\n`;
      const editor = mount(doc, tracking);
      const from = doc.indexOf('| a');
      const to = doc.indexOf('| 12 | 34 |') + '| 12 | 34 |'.length;
      editor.view.dispatch({ selection: { anchor: from, head: to } });
      const r = roundTrip(editor, () => key(editor, 'Delete'));
      expect(r.undone).toEqual(r.before);
      expect(r.undone.selection).toEqual([from, to]);
      expectRedone(editor, r.done, r.redone);
    });
  }
});
