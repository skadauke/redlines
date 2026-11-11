// @vitest-environment happy-dom
// Presses in a table's cells (design: tables, "The pointer"). happy-dom has no layout, so the cells'
// boxes are stubbed from a grid (a cell is 100 by 30), and `posAtCoords` answers what an engine's
// hit-test would: the text of some other cell, which the style must not trust. The real hit-testing
// runs in the WebKit script.
import { forceParsing } from '@codemirror/language';
import { EditorSelection } from '@codemirror/state';
import { EditorView, type MouseSelectionStyle } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type Editor, setViewModeEffect } from '../index.ts';
import { tablesOf } from './model.ts';

const open: Editor[] = [];
afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

const DOC = '| a | b |\n| - | - |\n| one two | dd |\n|  | last |\n';

/** An editor on `doc` whose cells have boxes: column c of row r is at (100c, 30r), 100 by 30. */
function load(doc = DOC): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, { doc, author: { handle: 'ada', name: 'Ada Lovelace' } });
  open.push(editor);
  forceParsing(editor.view, editor.view.state.doc.length, 10_000);
  const box = (left: number, top: number, width: number, height: number) =>
    ({
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
      x: left,
      y: top,
    }) as DOMRect;
  for (const table of editor.view.contentDOM.querySelectorAll<HTMLElement>('.rl-tbl')) {
    table.getBoundingClientRect = () =>
      box(0, 0, 200, 30 * table.querySelectorAll('.rl-trow').length);
    table.querySelectorAll<HTMLElement>('.rl-trow').forEach((row, r) => {
      row.querySelectorAll<HTMLElement>('.rl-tc').forEach((cell) => {
        const c = Number(cell.dataset['col']);
        cell.getBoundingClientRect = () => box(100 * c, 30 * r, 100, 30);
      });
    });
  }
  return editor;
}

/** Where the engine's own hit-test says a press is, whatever the cell. */
function hitTest(editor: Editor, pos: number) {
  (editor.view as { posAtCoords: unknown }).posAtCoords = () => pos;
}

const at = (find: string, offset = 0) => DOC.indexOf(find) + offset;

function press(editor: Editor, x: number, y: number, init: MouseEventInit = {}) {
  const event = new MouseEvent('mousedown', {
    clientX: x,
    clientY: y,
    button: 0,
    detail: 1,
    ...init,
  });
  const styles = editor.view.state.facet(EditorView.mouseSelectionStyle);
  let style: MouseSelectionStyle | null = null;
  for (const make of styles) {
    style = make(editor.view, event);
    if (style) break;
  }
  return { event, style };
}

describe('a press in a cell', () => {
  it('puts the caret in an empty cell, though the hit-test finds another cell’s text', () => {
    const editor = load();
    hitTest(editor, at('last'));
    const { event, style } = press(editor, 50, 75);
    const cell = tablesOf(editor.view.state)[0]!.rows[2]!.cells[0]!;
    expect(style).not.toBeNull();
    expect(style!.get(event, false, false).main).toEqual(EditorSelection.cursor(cell.textFrom));
    expect(cell.textFrom).toBe(cell.textTo);
  });

  it('puts the caret at the end of the text for a press right of it', () => {
    const editor = load();
    // The engine finds the next cell's text, to the right.
    hitTest(editor, at('dd'));
    const { event, style } = press(editor, 90, 45);
    expect(style!.get(event, false, false).main.head).toBe(at('one two') + 'one two'.length);
  });

  it('puts the caret at the start of the text for a press left of it, where the hit-test is above', () => {
    const editor = load();
    hitTest(editor, at('| a |'));
    const { event, style } = press(editor, 105, 45);
    expect(style!.get(event, false, false).main.head).toBe(at('dd'));
  });

  it('puts the caret where the text is hit', () => {
    const editor = load();
    hitTest(editor, at('one two', 3));
    const { event, style } = press(editor, 20, 45);
    expect(style!.get(event, false, false).main.head).toBe(at('one two', 3));
  });

  it('works in the header', () => {
    const editor = load();
    hitTest(editor, at('| b |'));
    const { event, style } = press(editor, 20, 10);
    expect(style!.get(event, false, false).main.head).toBe(at('a |') + 1);
  });

  it('selects a word on a double press, and the cell’s text on a triple press', () => {
    const editor = load();
    hitTest(editor, at('one two', 5));
    const double = press(editor, 20, 45, { detail: 2 });
    const word = double.style!.get(double.event, false, false).main;
    expect([word.from, word.to]).toEqual([at('two'), at('two') + 3]);
    const triple = press(editor, 20, 45, { detail: 3 });
    const text = triple.style!.get(triple.event, false, false).main;
    expect([text.from, text.to]).toEqual([at('one two'), at('one two') + 7]);
  });

  it('stays at the edge of the first cell’s text when dragged into another cell', () => {
    const editor = load();
    hitTest(editor, at('one two', 4));
    const { event, style } = press(editor, 40, 45);
    hitTest(editor, at('dd', 1));
    const drag = new MouseEvent('mousemove', { clientX: 150, clientY: 45 });
    const range = style!.get(drag, false, false).main;
    expect([range.anchor, range.head]).toEqual([at('one two', 4), at('one two') + 7]);
    // And back in the first cell, text again.
    hitTest(editor, at('one two', 6));
    const back = style!.get(
      new MouseEvent('mousemove', { clientX: 60, clientY: 45 }),
      false,
      false,
    );
    expect([back.main.anchor, back.main.head]).toEqual([at('one two', 4), at('one two', 6)]);
    void event;
  });

  it('is left to the editor with a modifier, in Raw, and outside a table', () => {
    const editor = load();
    hitTest(editor, at('dd'));
    expect(press(editor, 20, 45, { shiftKey: true }).style).toBeNull();
    expect(press(editor, 20, 45, { altKey: true }).style).toBeNull();
    expect(press(editor, 20, 45, { button: 2 }).style).toBeNull();
    expect(press(editor, 500, 500).style).toBeNull();
    editor.view.dispatch({ effects: setViewModeEffect.of('raw') });
    expect(press(editor, 20, 45).style).toBeNull();
  });
});

describe('text dropped on a cell', () => {
  it('is written as typing is: pipes escaped, line breaks as <br>', () => {
    const editor = load('| a | b |\n| - | - |\n| 12 | 3 |');
    const at = editor.view.state.doc.toString().indexOf('2 |');
    editor.view.dispatch({
      changes: { from: at, insert: 'a|b\nc' },
      selection: { anchor: at + 5 },
      userEvent: 'input.drop',
    });
    expect(editor.getDoc()).toBe('| a | b |\n| - | - |\n| 1a\\|b<br>c2 | 3 |');
  });
});
