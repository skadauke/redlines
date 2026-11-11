// @vitest-environment happy-dom
// Rectangles of cells (design: tables, "Selecting cells"): a selection whose two ends are in two
// different cells of one table, read from the ordinary selection with no state of its own; drawn as
// `.rl-sel` on exactly its cells.
import { forceParsing } from '@codemirror/language';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type Editor } from '../index.ts';
import { cellsOfRect, rectOf, selectedCells, whole } from './cells.ts';
import { tablesOf } from './model.ts';

const open: Editor[] = [];
afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

export const DOC = [
  'Intro.',
  '',
  '| a | b | c |',
  '| - | - | - |',
  '| 11 | 12 | 13 |',
  '| 21 | 22 | 23 |',
  '| 31 | 32 | 33 |',
  '',
  'Between.',
  '',
  '| x | y |',
  '| - | - |',
  '| 1 | 2 |',
  '',
  'After.',
].join('\n');

function load(doc = DOC): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, { doc, author: { handle: 'ada', name: 'Ada Lovelace' } });
  open.push(editor);
  forceParsing(editor.view, editor.view.state.doc.length, 10_000);
  return editor;
}

/** The start of a cell's text: the first occurrence of `text` as a cell. */
const start = (editor: Editor, cell: string, nth = 0) => {
  const text = editor.getDoc();
  let at = -1;
  for (let i = 0; i <= nth; i++) at = text.indexOf(`| ${cell} |`, at + 1);
  return at + 2;
};
const end = (editor: Editor, cell: string, nth = 0) => start(editor, cell, nth) + cell.length;

function select(editor: Editor, anchor: number, head: number): void {
  editor.view.dispatch({ selection: { anchor, head } });
}

const shownCells = (editor: Editor) =>
  [...editor.view.contentDOM.querySelectorAll('.rl-sel')].map((el) => el.textContent?.trim());

describe('a rectangle of cells', () => {
  it('is a selection with its ends in two cells of one table, every cell between', () => {
    const editor = load();
    select(editor, start(editor, '12'), end(editor, '32'));
    const rect = rectOf(editor.view.state);
    expect(rect?.rows).toEqual([1, 3]);
    expect(rect?.cols).toEqual([1, 1]);
    expect(
      selectedCells(editor.view.state).map((c) => editor.view.state.sliceDoc(c.textFrom, c.textTo)),
    ).toEqual(['12', '22', '32']);
  });

  it('is the same read backwards, and a corner to its opposite corner', () => {
    const editor = load();
    select(editor, end(editor, '23'), start(editor, '11'));
    const rect = rectOf(editor.view.state)!;
    expect(rect.rows).toEqual([1, 2]);
    expect(rect.cols).toEqual([0, 2]);
    expect(rect.anchor).toEqual({ row: 2, col: 2 });
    expect(rect.head).toEqual({ row: 1, col: 0 });
    expect(cellsOfRect(rect)).toHaveLength(6);
  });

  it('is none for a caret, for text in one cell, and in a different table or outside every table', () => {
    const editor = load();
    select(editor, start(editor, '22'), start(editor, '22'));
    expect(rectOf(editor.view.state)).toBeNull();
    select(editor, start(editor, '21'), end(editor, '21'));
    expect(rectOf(editor.view.state)).toBeNull();
    // From one table into another is a reach, and so is a selection from a paragraph into a table.
    select(editor, start(editor, '22'), start(editor, '1'));
    expect(rectOf(editor.view.state)).toBeNull();
    select(editor, editor.getDoc().indexOf('Intro'), start(editor, '22'));
    expect(rectOf(editor.view.state)).toBeNull();
    // A selection that covers a table whole and more deletes the table: no rectangle.
    select(editor, 0, editor.getDoc().length);
    expect(rectOf(editor.view.state)).toBeNull();
  });

  it('is none in Raw, which draws no cells', () => {
    const editor = load();
    editor.setViewMode('raw');
    select(editor, start(editor, '12'), end(editor, '32'));
    expect(rectOf(editor.view.state)).toBeNull();
    expect(shownCells(editor)).toEqual([]);
  });

  it('reports whole rows, whole columns and the whole table', () => {
    const editor = load();
    const kind = (): string | null => {
      const rect = rectOf(editor.view.state);
      return rect ? whole(rect) : 'none';
    };
    select(editor, start(editor, '21'), end(editor, '23'));
    expect(kind()).toBe('row');
    select(editor, start(editor, '11'), end(editor, '23'));
    expect(kind()).toBe('row');
    select(editor, start(editor, 'b'), end(editor, '32'));
    expect(kind()).toBe('column');
    select(editor, start(editor, 'a'), end(editor, '33'));
    expect(kind()).toBe('table');
    select(editor, start(editor, '12'), end(editor, '23'));
    expect(kind()).toBeNull();
  });

  it('calls a short row whole when its cells are selected', () => {
    const editor = load('| a | b | c |\n| - | - | - |\n| 1 | 2 |\n| 3 | 4 | 5 |');
    select(editor, start(editor, '1'), end(editor, '2'));
    const rect = rectOf(editor.view.state)!;
    expect(whole(rect)).toBe('row');
    expect(cellsOfRect(rect)).toHaveLength(2);
  });

  it('draws .rl-sel on exactly the cells of the rectangle', () => {
    const editor = load();
    select(editor, start(editor, '12'), end(editor, '23'));
    expect(shownCells(editor)).toEqual(['12', '13', '22', '23']);
    select(editor, start(editor, '12'), start(editor, '12'));
    expect(shownCells(editor)).toEqual([]);
  });

  it('is kept by an edit, and read again from the table’s own place', () => {
    const editor = load();
    select(editor, start(editor, '12'), end(editor, '22'));
    expect(tablesOf(editor.view.state)).toHaveLength(2);
    expect(selectedCells(editor.view.state)).toHaveLength(2);
  });

  it('lets ⇧→ from a cell’s end extend into the next cell as a rectangle', () => {
    const editor = load();
    const at = end(editor, '11');
    select(editor, at - 1, at);
    // One step over the pipes with the arrow key: CodeMirror's own selection extension.
    editor.view.contentDOM.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true }),
    );
    const rect = rectOf(editor.view.state);
    expect(rect).not.toBeNull();
    expect(rect?.cols).toEqual([0, 1]);
    expect(rect?.rows).toEqual([1, 1]);
  });
});
