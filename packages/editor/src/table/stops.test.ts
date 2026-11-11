// @vitest-environment happy-dom
import { forceParsing } from '@codemirror/language';
import { Transaction } from '@codemirror/state';
import { runScopeHandlers } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type Editor } from '../index.ts';
import { refusedEditEffect } from '../tracked/typing.ts';
import { isStop, nearestStop, TEXT_IN_CELLS } from './stops.ts';

const ada = { handle: 'ada', name: 'Ada Lovelace' };
const open: Editor[] = [];

afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

function load(doc: string, caret?: number, tracking = false): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, { doc, author: ada, tracking });
  forceParsing(editor.view, editor.view.state.doc.length, 10_000);
  editor.view.dispatch({ selection: { anchor: caret ?? 0 } });
  open.push(editor);
  return editor;
}

const press = (editor: Editor, key: string, init: KeyboardEventInit = {}) =>
  runScopeHandlers(editor.view, new KeyboardEvent('keydown', { key, ...init }), 'editor');
const head = (editor: Editor) => editor.view.state.selection.main.head;
const T = 'Intro.\n\n| a | b |\n| - | - |\n| cc | d |\n\nAfter.';
const at = (doc: string, find: string, offset = 0) => doc.indexOf(find) + offset;

describe('the caret in a table', () => {
  it('steps from the end of a cell to the start of the next, over the pipe and the padding', () => {
    const editor = load(T, at(T, 'a | b', 1));
    expect(press(editor, 'ArrowRight')).toBe(true);
    expect(head(editor)).toBe(at(T, 'b |'));
    expect(press(editor, 'ArrowLeft')).toBe(true);
    expect(head(editor)).toBe(at(T, 'a | b', 1));
  });

  it('steps from the end of a row to the start of the next, over the delimiter row', () => {
    const editor = load(T, at(T, 'b |', 1));
    press(editor, 'ArrowRight');
    expect(head(editor)).toBe(at(T, 'cc'));
    press(editor, 'ArrowLeft');
    expect(head(editor)).toBe(at(T, 'b |', 1));
  });

  it('steps from the last cell into the block below, and back', () => {
    const editor = load(T, at(T, 'd |', 1));
    press(editor, 'ArrowRight');
    expect(head(editor)).toBe(at(T, 'After.'));
    press(editor, 'ArrowLeft');
    expect(head(editor)).toBe(at(T, 'd |', 1));
    // And from the block above into the first cell.
    editor.view.dispatch({ selection: { anchor: at(T, 'Intro.', 6) } });
    press(editor, 'ArrowRight');
    expect(head(editor)).toBe(at(T, 'a |'));
  });

  it('has one stop in an empty cell, after the first space of its padding', () => {
    const doc = '| a | b |\n| - | - |\n|  | d |';
    const editor = load(doc);
    const empty = at(doc, '|  |') + 2;
    editor.view.dispatch({ selection: { anchor: empty } });
    expect(head(editor)).toBe(empty);
    expect(isStop(editor.view.state, empty)).toBe(true);
    expect(isStop(editor.view.state, empty + 1)).toBe(false);
    expect(isStop(editor.view.state, empty - 1)).toBe(false);
    press(editor, 'ArrowRight');
    expect(head(editor)).toBe(at(doc, 'd |'));
  });

  it('has no stop in a cell GFM does not show', () => {
    const doc = '| a | b |\n| - | - |\n| c | d | e |\n| f | g |';
    const editor = load(doc, at(doc, 'd |', 1));
    press(editor, 'ArrowRight');
    expect(head(editor)).toBe(at(doc, 'f'));
    expect(isStop(editor.view.state, at(doc, 'e'))).toBe(false);
    expect(nearestStop(editor.view.state, at(doc, 'e'))).toBe(at(doc, 'd |', 1));
  });

  it('moves a caret that lands in a pipe, padding or the delimiter row to the nearest stop', () => {
    const editor = load(T);
    const row = at(T, '| a | b |');
    const cases: [number, number][] = [
      [row, at(T, 'a | b')],
      [row + 1, at(T, 'a | b')],
      [row + 3, at(T, 'a | b', 1)],
      [row + 4, at(T, 'b |')],
      [row + 9, at(T, 'b |', 1)],
      [at(T, '| - |') + 3, at(T, 'b |', 1)],
      [at(T, '| cc') + 1, at(T, 'cc')],
    ];
    for (const [pos, expected] of cases) {
      editor.view.dispatch({ selection: { anchor: pos } });
      expect(head(editor), `from ${pos}`).toBe(expected);
    }
  });

  it('moves the caret an edit from outside leaves in a pipe', () => {
    const editor = load(T, at(T, 'cc', 1));
    // A remote edit that puts text in front of the row, which moves the caret's cell away.
    editor.view.dispatch({
      changes: { from: at(T, 'Intro.', 6), insert: 'xyz' },
      annotations: Transaction.remote.of(true),
      selection: { anchor: at(T, 'cc') + 3 + 2 },
    });
    expect(isStop(editor.view.state, head(editor))).toBe(true);
  });

  it('refuses text typed before a row’s first pipe or after its last, and takes text in a cell', () => {
    const editor = load(T, at(T, 'cc'));
    const notices: string[] = [];
    const row = at(T, '| cc');
    for (const [from, insert] of [
      [row, 'x'],
      [row + 1, 'x'],
      [row + '| cc | d |'.length, 'x'],
    ] as const) {
      const before = editor.view.state.doc.toString();
      editor.view.dispatch({
        changes: { from, insert },
        userEvent: 'input.type',
        effects: [],
      });
      expect(editor.view.state.doc.toString(), `at ${from}`).toBe(before);
    }
    void notices;
    void refusedEditEffect;
    expect(TEXT_IN_CELLS).toBe("A table's text goes in its cells.");
    editor.view.dispatch({
      changes: { from: at(T, 'cc', 1), insert: 'x' },
      userEvent: 'input.type',
    });
    expect(editor.view.state.doc.toString()).toContain('| cxc |');
  });

  it('holds a selection that starts in a cell to that cell until cells can be selected', () => {
    const editor = load(T, at(T, 'a | b', 1));
    press(editor, 'ArrowRight', { shiftKey: true });
    const { anchor, head: to } = editor.view.state.selection.main;
    expect(anchor).toBe(at(T, 'a | b', 1));
    expect(to).toBe(anchor);
    editor.view.dispatch({ selection: { anchor: at(T, 'cc'), head: at(T, 'd |', 1) } });
    expect(editor.view.state.selection.main.head).toBe(at(T, 'cc', 2));
    // Within the cell, a selection is the text's.
    editor.view.dispatch({ selection: { anchor: at(T, 'cc'), head: at(T, 'cc', 2) } });
    expect(editor.view.state.selection.main.head).toBe(at(T, 'cc', 2));
  });

  it('leaves a selection from a paragraph into a cell alone', () => {
    const editor = load(T);
    editor.view.dispatch({ selection: { anchor: 2, head: at(T, 'cc', 2) } });
    const main = editor.view.state.selection.main;
    expect([main.anchor, main.head]).toEqual([2, at(T, 'cc', 2)]);
  });

  it('has no stops, and no guard, in a table in a quote, or in Raw', () => {
    const quote = '> | a | b |\n> | - | - |\n> | c | d |';
    const editor = load(quote, 1);
    expect(head(editor)).toBe(1);
    const raw = load(T);
    raw.setViewMode('raw');
    raw.view.dispatch({ selection: { anchor: at(T, '| a') } });
    expect(head(raw)).toBe(at(T, '| a'));
  });

  it('guards typing with Track Changes on too, and tracks what it takes', () => {
    const editor = load(T, at(T, 'cc'), true);
    const before = editor.view.state.doc.toString();
    editor.view.dispatch({
      changes: { from: at(T, '| cc'), insert: 'x' },
      userEvent: 'input.type',
    });
    expect(editor.view.state.doc.toString()).toBe(before);
    editor.view.dispatch({
      changes: { from: at(T, 'cc', 1), insert: 'x' },
      userEvent: 'input.type',
    });
    expect(editor.view.state.doc.toString()).toContain('c<!--ins ');
  });

  describe('a line break in a cell is one atom', () => {
    for (const br of ['<br>', '<br/>', '<br />']) {
      const doc = `| a | b |\n| - | - |\n| c${br}d | e |`;
      const start = at(doc, 'c') + 1;
      const end = start + br.length;

      it(`${br}: the arrows step over it, and the caret never rests inside`, () => {
        const editor = load(doc, start);
        const seen: number[] = [];
        for (let i = 0; i < 3; i++) {
          press(editor, 'ArrowRight');
          seen.push(head(editor));
        }
        expect(seen).toEqual([end, end + 1, at(doc, 'e')]);
        for (let pos = start + 1; pos < end; pos++) {
          expect(isStop(editor.view.state, pos)).toBe(false);
        }
        press(editor, 'ArrowLeft');
        press(editor, 'ArrowLeft');
        expect(head(editor)).toBe(end);
        press(editor, 'ArrowLeft');
        expect(head(editor)).toBe(start);
      });

      it(`${br}: Backspace and Delete next to it remove it whole`, () => {
        const back = load(doc, end);
        press(back, 'Backspace');
        expect(back.view.state.doc.toString()).toBe(doc.replace(br, ''));
        expect(head(back)).toBe(start);
        const forward = load(doc, start);
        press(forward, 'Delete');
        expect(forward.view.state.doc.toString()).toBe(doc.replace(br, ''));
      });

      it(`${br}: a selection set inside it moves to its nearer end`, () => {
        const editor = load(doc, start);
        editor.view.dispatch({ selection: { anchor: start + 1 } });
        expect(head(editor)).toBe(start);
        editor.view.dispatch({ selection: { anchor: end - 1 } });
        expect(head(editor)).toBe(end);
      });
    }
  });
});
