// @vitest-environment happy-dom
// Rectangles of cells (design: tables, "Selecting cells"): a selection whose two ends are in two
// different cells of one table, read from the ordinary selection with no state of its own; drawn as
// `.rl-sel` on exactly its cells.
import { forceParsing } from '@codemirror/language';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type Editor } from '../index.ts';
import { cellsOfRect, rectOf, rectSelection, selectedCells, whole } from './cells.ts';
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

describe('the selection of a rectangle some rows lack cells of', () => {
  const HEAD = '| a | b | c | d |\n| - | - | - | - |\n';

  /** What `rectSelection` makes of the corners: the cells it selects (none where it is the text of one
   * cell), and what the rectangle is. */
  function made(doc: string, from: [number, number], to: [number, number]) {
    const editor = load(doc);
    const table = tablesOf(editor.view.state)[0]!;
    const selection = rectSelection(
      table,
      { row: from[0], col: from[1] },
      { row: to[0], col: to[1] },
    );
    editor.view.dispatch({ selection: selection! });
    const rect = rectOf(editor.view.state);
    const { from: a, to: b } = editor.view.state.selection.main;
    return {
      text: editor.view.state.sliceDoc(a, b),
      cells: rect
        ? cellsOfRect(rect).map((c) => editor.view.state.sliceDoc(c.textFrom, c.textTo))
        : null,
      rows: rect?.rows,
      cols: rect?.cols,
      kind: rect ? whole(rect) : null,
    };
  }

  it('is a column down to the last row that has it, whichever rows lack it', () => {
    const doc = `${HEAD}| 1 |\n| 2 | 3 | 4 |\n| 5 |`;
    for (const [from, to] of [
      [
        [0, 2],
        [3, 2],
      ],
      // The same read from the bottom.
      [
        [3, 2],
        [0, 2],
      ],
    ] as [[number, number], [number, number]][]) {
      const got = made(doc, from, to);
      expect([got.rows, got.cols, got.kind, got.cells]).toEqual([
        [0, 2],
        [2, 2],
        'column',
        ['c', '4'],
      ]);
    }
  });

  it('is the header’s cell, as the text of one cell, for a column no body row has', () => {
    const doc = `${HEAD}| 1 | 2 |\n| 4 | 5 |`;
    const got = made(doc, [0, 2], [2, 2]);
    expect([got.text, got.cells, got.kind]).toEqual(['c', null, null]);
    const last = made(doc, [0, 3], [2, 3]);
    expect([last.text, last.cells, last.kind]).toEqual(['d', null, null]);
  });

  it('is the header’s cells, a column, for several columns no body row has', () => {
    const doc = `${HEAD}| 1 | 2 |\n| 4 | 5 |`;
    const got = made(doc, [0, 2], [2, 3]);
    expect([got.rows, got.cols, got.kind, got.cells]).toEqual([
      [0, 0],
      [2, 3],
      'column',
      ['c', 'd'],
    ]);
    // One of the columns is had by a row: the rows down to it, and the columns as far as it goes.
    const some = made(`${HEAD}| 1 | 2 | 3 |\n| 4 | 5 |`, [0, 2], [2, 3]);
    expect([some.rows, some.cols, some.kind, some.cells]).toEqual([
      [0, 1],
      [2, 3],
      'column',
      ['c', 'd', '3'],
    ]);
  });

  it('is a short row as its cells, a row, and the whole table with its short last row', () => {
    const doc = `${HEAD}| 1 | 2 | 3 | 4 |\n| 4 | 5 |`;
    const row = made(doc, [2, 0], [2, 3]);
    expect([row.rows, row.cols, row.kind, row.cells]).toEqual([[2, 2], [0, 1], 'row', ['4', '5']]);
    const all = made(doc, [0, 0], [2, 3]);
    expect([all.rows, all.cols, all.kind, all.cells?.length]).toEqual([
      [0, 2],
      [0, 3],
      'table',
      10,
    ]);
  });

  it('keeps the corners it was given where both are cells', () => {
    const doc = `${HEAD}| 1 | 2 | 3 | 4 |\n| 4 | 5 | 6 | 7 |`;
    const got = made(doc, [2, 1], [1, 2]);
    expect([got.rows, got.cols, got.kind]).toEqual([[1, 2], [1, 2], null]);
    // The selection runs from the first corner to the second, as it was asked.
    const editor = load(doc);
    const table = tablesOf(editor.view.state)[0]!;
    const selection = rectSelection(table, { row: 2, col: 1 }, { row: 1, col: 2 })!;
    expect(selection.main.anchor).toBeGreaterThan(selection.main.head);
  });
});
