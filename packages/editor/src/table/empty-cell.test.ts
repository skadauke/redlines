// @vitest-environment happy-dom
// The caret in an empty cell with one space of padding or none (`| |`, `||`), and at the end of text
// with none after it (`| y|`, `|a|b|`) (design: tables, "The caret's stops"). The stop of such a cell is
// the end of its own mark, which is also where the next cell's mark starts: the model gives that place
// to the cell whose text ends there, and the page draws the caret in it. For each layout of cells: the
// stops of every row, the cell each belongs to, Tab and ⇧Tab, ← and →, ↑ and ↓, Home and End, a press,
// the place the page draws the caret, a rectangle from or to the cell, Select Column, Delete Row, and
// typing, plain and tracked; then the second ⌫ and tracked deletions in tables that have such cells.
// The layouts with two spaces and with text are here too, as controls that nothing else moved.
import { forceParsing } from '@codemirror/language';
import { EditorView, type MouseSelectionStyle, runScopeHandlers } from '@codemirror/view';
import { acceptAll, applyChanges, newestView, rejectAll } from '@redlines/format';
import { afterEach, describe, expect, it } from 'vitest';
import { decisionProblems, type Script, scriptRows, type Step } from '../blocks/script.ts';
import { createEditor, type Editor } from '../index.ts';
import { type Rect, rectOf, selectedCells, selectRect, whole } from './cells.ts';
import { type Cell, cellAt, type Table, tablesOf } from './model.ts';
import { deleteRows, touchedCols } from './ops.ts';
import { isStop, nearestStop } from './stops.ts';

const ada = { handle: 'ada', name: 'Ada Lovelace' };
const open: Editor[] = [];

afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

function load(doc: string, at = 0, tracking = false): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, { doc, author: ada, tracking });
  forceParsing(editor.view, editor.view.state.doc.length, 10_000);
  editor.view.dispatch({ selection: { anchor: at } });
  open.push(editor);
  return editor;
}

/** Presses a key through the editor's keymaps, as a keyboard sends it: `Shift-Tab`, `ArrowDown`. */
function press(editor: Editor, key: string): boolean {
  const parts = key.split('-');
  const name = parts.pop() ?? key;
  return runScopeHandlers(
    editor.view,
    new KeyboardEvent('keydown', {
      key: name,
      shiftKey: parts.includes('Shift'),
      altKey: parts.includes('Alt'),
      bubbles: true,
      cancelable: true,
    }),
    'editor',
  );
}

const sel = (editor: Editor) => editor.view.state.selection.main;
const head = (editor: Editor) => sel(editor).head;
const table = (editor: Editor): Table => {
  const found = tablesOf(editor.view.state)[0];
  if (!found) throw new Error('no table');
  return found;
};

// The layouts. `‸` marks a stop of the row it is in: where the caret may stand, and nowhere else in
// the row. A stop is the start and end of each cell's text, and the one place of an empty cell.

const HEAD = '| ‸a‸ | ‸b‸ | ‸c‸ |\n| - | - | - |';
const TEXT = '| ‸4‸ | ‸5‸ | ‸6‸ |';
const TEXT2 = '| ‸7‸ | ‸8‸ | ‸9‸ |';
const LEDGER =
  '\n\n<!-- redlines\nversion: 1\npeople:\n  bo: {name: Bo Chen}\nmarks:\n  m2bd: {by: bo, at: 2026-11-01T10:00Z}\n-->\n';

interface Layout {
  name: string;
  marked: string;
}

/** Each is a table of three rows of text around the row that has the empty cells (or, for the header,
 * the header that has one). */
const LAYOUTS: Layout[] = [
  { name: 'one space, in the middle', marked: `${HEAD}\n${TEXT}\n| ‸1‸ | ‸| ‸x‸ |\n${TEXT2}` },
  { name: 'one space, in the first cell', marked: `${HEAD}\n${TEXT}\n| ‸| ‸1‸ | ‸x‸ |\n${TEXT2}` },
  { name: 'no space, in the middle', marked: `${HEAD}\n${TEXT}\n| ‸1‸ |‸| ‸x‸ |\n${TEXT2}` },
  { name: 'one space, in the last cell', marked: `${HEAD}\n${TEXT}\n| ‸1‸ | ‸x‸ | ‸|\n${TEXT2}` },
  { name: 'no space, in the last cell', marked: `${HEAD}\n${TEXT}\n| ‸1‸ | ‸x‸ |‸|\n${TEXT2}` },
  {
    name: 'two cells side by side, one space each',
    marked: `${HEAD}\n${TEXT}\n| ‸| ‸| ‸x‸ |\n${TEXT2}`,
  },
  { name: 'two cells side by side, no space', marked: `${HEAD}\n${TEXT}\n|‸|‸|‸x‸|\n${TEXT2}` },
  { name: 'three cells, one space each', marked: `${HEAD}\n${TEXT}\n| ‸| ‸| ‸|\n${TEXT2}` },
  {
    name: 'in the header',
    marked: `| ‸a‸ | ‸| ‸c‸ |\n| - | - | - |\n${TEXT}\n${TEXT2}`,
  },
  {
    name: 'in the header, the first cell',
    marked: `| ‸| ‸b‸ | ‸c‸ |\n| - | - | - |\n${TEXT}\n${TEXT2}`,
  },
  {
    name: 'in a table with no outer pipes',
    marked: `‸a‸ | ‸b‸ | ‸c‸\n--- | --- | ---\n‸4‸ | ‸5‸ | ‸6‸\n‸1‸ | ‸| ‸x‸\n‸7‸ | ‸8‸ | ‸9‸`,
  },
  {
    name: 'in a table with no padding at all',
    marked: `|‸a‸|‸b‸|‸c‸|\n|-|-|-|\n|‸4‸|‸5‸|‸6‸|\n|‸1‸|‸|‸x‸|\n|‸7‸|‸8‸|‸9‸|`,
  },
  {
    name: 'a cell that holds only the marker of an inserted row and its space',
    marked: `${HEAD}\n${TEXT}\n| <!--ins m2bd row--> ‸| ‸x‸ | ‸y‸ |\n${TEXT2}${LEDGER}`,
  },
  {
    name: 'an inserted row with an empty cell beside its marker and text',
    marked: `${HEAD}\n${TEXT}\n| <!--ins m2bd row--> ‸a‸ | ‸| ‸y‸ |\n${TEXT2}${LEDGER}`,
  },
  // The controls: padding of two spaces, and text, which already worked.
  {
    name: 'control: two spaces, in the middle',
    marked: `${HEAD}\n${TEXT}\n| ‸1‸ | ‸ | ‸x‸ |\n${TEXT2}`,
  },
  {
    name: 'control: two spaces, in the first cell',
    marked: `${HEAD}\n${TEXT}\n| ‸ | ‸1‸ | ‸x‸ |\n${TEXT2}`,
  },
  {
    name: 'control: text in every cell',
    marked: `${HEAD}\n${TEXT}\n| ‸1‸2‸ | ‸3‸4‸ | ‸5‸6‸ |\n${TEXT2}`,
  },
];

/** The document of a marked layout, and its stops. */
function withStops(marked: string): { doc: string; stops: number[] } {
  const stops: number[] = [];
  let doc = '';
  for (const char of marked) {
    if (char === '‸') stops.push(doc.length);
    else doc += char;
  }
  return { doc, stops };
}

/** The column the text says a stop is in: the pipes before it in its line, less the one that opens the
 * line. (Not read from the model, which is what the stops are tested against.) */
function columnOf(doc: string, stop: number): number {
  const start = doc.lastIndexOf('\n', stop - 1) + 1;
  const line = doc.slice(start);
  const opens = line.trimStart().startsWith('|') ? 1 : 0;
  return [...doc.slice(start, stop)].filter((char) => char === '|').length - opens;
}

/** The cells of a table with no text, which have the one stop. */
const emptyCells = (found: Table) =>
  found.rows.flatMap((row) =>
    row.cells.filter((c) => c.textFrom === c.textTo).map((cell) => ({ row, cell })),
  );

/** The elements of the cells the page draws, by row and column. */
function drawn(editor: Editor): HTMLElement[][] {
  return [...editor.view.contentDOM.querySelectorAll<HTMLElement>('.rl-tbl .rl-trow')].map(
    (line) => [...line.querySelectorAll<HTMLElement>(':scope > .rl-tc')],
  );
}

/** The cell the page draws the caret in: where the editor puts the DOM selection of a caret, on the side
 * its `assoc` says (the side after the position when it says none), as `[row, column]`. */
function caretDrawnIn(editor: Editor): [number, number] | null {
  const { head: at, assoc } = sel(editor);
  const { node } = editor.view.domAtPos(at, assoc || 1);
  const holder = (node instanceof Element ? node : node.parentElement)?.closest('.rl-tc');
  const grid = drawn(editor);
  for (const [r, cells] of grid.entries()) {
    const c = cells.indexOf(holder as HTMLElement);
    if (c !== -1) return [r, c];
  }
  return null;
}

/** The cell the head of the selection is in: `[row, column]`. */
function headIn(editor: Editor): [number, number] | null {
  const found = cellAt(editor.view.state, head(editor));
  return found ? [found.row.index, found.cell.col] : null;
}

for (const layout of LAYOUTS) {
  const { doc, stops } = withStops(layout.marked);

  describe(`the caret in a table with cells like these: ${layout.name}`, () => {
    it('stops where the text says in every row, and nowhere else', () => {
      const editor = load(doc);
      const { state } = editor.view;
      for (const row of table(editor).rows) {
        const want = stops.filter((p) => p >= row.from && p <= row.to);
        const got: number[] = [];
        for (let p = row.from; p <= row.to; p++) if (isStop(state, p)) got.push(p);
        expect(got, `row ${row.index}`).toEqual(want);
      }
      // The delimiter row is no place for the caret.
      const { delimiter } = table(editor);
      for (let p = delimiter.from; p <= delimiter.to; p++) expect(isStop(state, p)).toBe(false);
      // An empty cell has one stop: a row of such cells has as many stops as cells.
      for (const row of table(editor).rows) {
        if (row.cells.every((c) => c.textFrom === c.textTo)) {
          expect(stops.filter((p) => p >= row.from && p <= row.to)).toHaveLength(row.cells.length);
        }
      }
    });

    it('gives each stop to the cell whose text it is in, and to no other', () => {
      const editor = load(doc);
      const { state } = editor.view;
      for (const row of table(editor).rows) {
        for (const p of stops.filter((q) => q >= row.from && q <= row.to)) {
          const found = cellAt(state, p);
          expect(
            [found?.row.index, found?.cell.col],
            `stop ${p - row.from} of row ${row.index}`,
          ).toEqual([row.index, columnOf(doc, p)]);
          // No position is a stop of two cells.
          expect(row.cells.filter((c) => c.textFrom <= p && p <= c.textTo)).toHaveLength(1);
        }
        for (let p = row.from; p <= row.to; p++) {
          expect(
            row.cells.filter((c) => c.textFrom <= p && p <= c.textTo).length,
          ).toBeLessThanOrEqual(1);
        }
      }
    });

    it('keeps a caret on a stop, and moves one anywhere else in the table to a stop', () => {
      const editor = load(doc);
      const { state } = editor.view;
      const { from, to } = table(editor);
      for (let p = from; p <= to; p++) {
        expect(isStop(state, nearestStop(state, p)), `from ${p}`).toBe(true);
        if (isStop(state, p)) expect(nearestStop(state, p)).toBe(p);
      }
      for (const p of stops) {
        editor.view.dispatch({ selection: { anchor: p } });
        expect(head(editor), `a caret set at ${p}`).toBe(p);
      }
    });

    it('is drawn in the cell it is in, at every stop: the caret leans to the cell whose end it is at', () => {
      const editor = load(doc);
      const found = table(editor);
      for (const row of found.rows) {
        for (const p of stops.filter((q) => q >= row.from && q <= row.to)) {
          editor.view.dispatch({ selection: { anchor: p } });
          expect(head(editor)).toBe(p);
          expect(caretDrawnIn(editor), `stop ${p - row.from} of row ${row.index}`).toEqual([
            row.index,
            columnOf(doc, p),
          ]);
        }
      }
    });

    it('is visited by Tab, cell by cell in order, and by ⇧Tab back', () => {
      const editor = load(doc, stops[0]);
      const found = table(editor);
      const order = found.rows.flatMap((row) => row.cells.map((c) => [row.index, c.col]));
      const cells = found.rows.flatMap((row) => row.cells);
      const visit = (key: string, to: Cell) => {
        expect(press(editor, key)).toBe(true);
        // Tab selects the cell's text; an empty cell has the caret at its stop.
        if (to.textFrom === to.textTo) {
          expect([sel(editor).anchor, sel(editor).head]).toEqual([to.textFrom, to.textFrom]);
          expect(caretDrawnIn(editor)).toEqual(headIn(editor));
        } else {
          expect([sel(editor).from, sel(editor).to]).toEqual([to.textFrom, to.textTo]);
        }
        return headIn(editor);
      };
      const forward: ([number, number] | null)[] = [headIn(editor)];
      for (let i = 1; i < cells.length; i++) forward.push(visit('Tab', cells[i] as Cell));
      expect(forward).toEqual(order);
      const back: ([number, number] | null)[] = [];
      for (let i = cells.length - 2; i >= 0; i--) back.push(visit('Shift-Tab', cells[i] as Cell));
      expect(back).toEqual(order.slice(0, -1).reverse());
    });

    it('steps through a row one stop at a time with → and ←, an empty cell one step', () => {
      const editor = load(doc);
      for (const row of table(editor).rows) {
        const want = stops.filter((p) => p >= row.from && p <= row.to);
        editor.view.dispatch({ selection: { anchor: want[0] ?? 0 } });
        const right: number[] = [];
        for (let i = 1; i < want.length; i++) {
          press(editor, 'ArrowRight');
          right.push(head(editor));
          expect(caretDrawnIn(editor), `→ to ${head(editor) - row.from}, row ${row.index}`).toEqual(
            headIn(editor),
          );
        }
        expect(right, `→ along row ${row.index}`).toEqual(want.slice(1));
        const left: number[] = [];
        for (let i = 1; i < want.length; i++) {
          press(editor, 'ArrowLeft');
          left.push(head(editor));
          expect(caretDrawnIn(editor), `← to ${head(editor) - row.from}, row ${row.index}`).toEqual(
            headIn(editor),
          );
        }
        expect(left, `← along row ${row.index}`).toEqual(want.slice(0, -1).reverse());
      }
    });

    it('is reached by ↓ and ↑ from the cell above and below in the same column', () => {
      const editor = load(doc);
      const found = table(editor);
      const last = found.rows.length - 1;
      for (let col = 0; col < found.columns; col++) {
        const top = found.rows[0]?.cells[col];
        editor.view.dispatch({ selection: { anchor: top?.textFrom ?? 0 } });
        for (let r = 1; r <= last; r++) {
          expect(press(editor, 'ArrowDown')).toBe(true);
          expect(headIn(editor), `↓ into row ${r}, column ${col}`).toEqual([r, col]);
          const target = found.rows[r]?.cells[col];
          if (target && target.textFrom === target.textTo)
            expect(head(editor)).toBe(target.textFrom);
          expect(caretDrawnIn(editor)).toEqual([r, col]);
        }
        for (let r = last - 1; r >= 0; r--) {
          expect(press(editor, 'ArrowUp')).toBe(true);
          expect(headIn(editor), `↑ into row ${r}, column ${col}`).toEqual([r, col]);
          const target = found.rows[r]?.cells[col];
          if (target && target.textFrom === target.textTo)
            expect(head(editor)).toBe(target.textFrom);
          expect(caretDrawnIn(editor)).toEqual([r, col]);
        }
      }
    });

    it('stays in the cell for Home and End', () => {
      const editor = load(doc);
      for (const { row, cell } of emptyCells(table(editor))) {
        for (const key of ['Home', 'End']) {
          editor.view.dispatch({ selection: { anchor: cell.textFrom } });
          press(editor, key);
          expect(head(editor), `${key} in row ${row.index}, column ${cell.col}`).toBe(
            cell.textFrom,
          );
          expect(headIn(editor)).toEqual([row.index, cell.col]);
        }
      }
    });

    it('makes a rectangle from the cell to a cell below, above and beside it', () => {
      const editor = load(doc);
      const found = table(editor);
      for (const { row, cell } of emptyCells(found)) {
        const where = `row ${row.index}, column ${cell.col}`;
        const cols = (rect: Rect | null) => rect && [rect.cols[0], rect.cols[1]];
        const rows = (rect: Rect | null) => rect && [rect.rows[0], rect.rows[1]];
        // From the cell down and up: two cells, one column.
        for (const [key, other] of [
          ['Shift-ArrowDown', row.index + 1],
          ['Shift-ArrowUp', row.index - 1],
        ] as const) {
          if (other < 0 || other >= found.rows.length) continue;
          editor.view.dispatch({ selection: { anchor: cell.textFrom } });
          press(editor, key);
          const rect = rectOf(editor.view.state);
          expect([rows(rect), cols(rect)], `${key} from ${where}`).toEqual([
            [Math.min(row.index, other), Math.max(row.index, other)],
            [cell.col, cell.col],
          ]);
          expect(rect?.anchor).toEqual({ row: row.index, col: cell.col });
          expect(selectedCells(editor.view.state).map((c) => c.col)).toEqual([cell.col, cell.col]);
        }
        // To the cell from the cell above it, and from the one below.
        for (const [key, from] of [
          ['Shift-ArrowDown', row.index - 1],
          ['Shift-ArrowUp', row.index + 1],
        ] as const) {
          const start = found.rows[from]?.cells.find((c) => c.col === cell.col);
          if (!start) continue;
          editor.view.dispatch({ selection: { anchor: start.textFrom } });
          press(editor, key);
          const rect = rectOf(editor.view.state);
          expect(rect?.head, `${key} into ${where}`).toEqual({ row: row.index, col: cell.col });
          expect(rows(rect)).toEqual([Math.min(row.index, from), Math.max(row.index, from)]);
          expect(cols(rect)).toEqual([cell.col, cell.col]);
        }
        // From the end of the text before it, and the start of the text after it: two cells, one row.
        const before = row.cells[cell.col - 1];
        const after = row.cells[cell.col + 1];
        if (before) {
          editor.view.dispatch({ selection: { anchor: before.textTo } });
          press(editor, 'Shift-ArrowRight');
          const rect = rectOf(editor.view.state);
          expect([rows(rect), cols(rect)], `Shift-→ into ${where}`).toEqual([
            [row.index, row.index],
            [cell.col - 1, cell.col],
          ]);
          expect(head(editor)).toBe(cell.textFrom);
        }
        if (after) {
          editor.view.dispatch({ selection: { anchor: after.textFrom } });
          press(editor, 'Shift-ArrowLeft');
          const rect = rectOf(editor.view.state);
          expect([rows(rect), cols(rect)], `Shift-← into ${where}`).toEqual([
            [row.index, row.index],
            [cell.col, cell.col + 1],
          ]);
          expect(head(editor)).toBe(cell.textTo);
        }
      }
    });

    it('is the column that Select Column and the columns commands act on', () => {
      const editor = load(doc);
      const found = table(editor);
      for (const { row, cell } of emptyCells(found)) {
        editor.view.dispatch({ selection: { anchor: cell.textFrom } });
        expect(touchedCols(editor.view.state)?.first, `the column of row ${row.index}`).toBe(
          cell.col,
        );
        expect(touchedCols(editor.view.state)?.last).toBe(cell.col);
        expect(selectRect(editor.view, 'column')).toBe(true);
        const rect = rectOf(editor.view.state);
        expect(rect && whole(rect)).toBe('column');
        expect(rect?.cols).toEqual([cell.col, cell.col]);
        expect(rect?.rows).toEqual([0, found.rows.length - 1]);
        expect(selectedCells(editor.view.state).map((c) => c.col)).toEqual(
          found.rows.map(() => cell.col),
        );
        // And the cell, the row and the table, from the caret in the cell.
        editor.view.dispatch({ selection: { anchor: cell.textFrom } });
        expect(selectRect(editor.view, 'row')).toBe(true);
        expect(rectOf(editor.view.state)?.rows).toEqual([row.index, row.index]);
      }
    });

    it('is in the row that Delete Row deletes', () => {
      const lines = doc.split('\n');
      for (const { row, cell } of emptyCells(table(load(doc)))) {
        // (The header goes with its next row, and a row that holds another person's marker is for the
        // format to say: neither is this test's.)
        if (row.index === 0 || lines[row.index + 1]?.includes('<!--ins')) continue;
        const editor = load(doc, cell.textFrom);
        expect(deleteRows(editor.view)).toBe(true);
        // The header is the first line and the delimiter row the second: row r is line r + 1.
        expect(editor.getDoc(), `row ${row.index}`).toBe(
          lines.filter((_, i) => i !== row.index + 1).join('\n'),
        );
      }
    });

    it('writes what is typed into that cell, and into no other, and the caret stays in it', () => {
      // (The format refuses plain typing in a row that another person inserted, in any of its cells:
      // tracked typing there is the next test's.)
      if (doc.includes('<!--ins ')) return;
      for (const { row, cell } of emptyCells(table(load(doc)))) {
        const editor = load(doc, cell.textFrom);
        for (const letter of ['y', 'z']) {
          editor.view.dispatch(editor.view.state.replaceSelection(letter), {
            userEvent: 'input.type',
          });
        }
        const where = `row ${row.index}, column ${cell.col}`;
        expect(editor.getDoc(), where).toBe(
          `${doc.slice(0, cell.textFrom)}yz${doc.slice(cell.textFrom)}`,
        );
        expect(head(editor)).toBe(cell.textFrom + 2);
        expect(headIn(editor)).toEqual([row.index, cell.col]);
        expect(caretDrawnIn(editor), `${where}: the caret is drawn in the cell`).toEqual([
          row.index,
          cell.col,
        ]);
        const typed = table(editor).rows[row.index]?.cells[cell.col];
        expect(editor.view.state.sliceDoc(typed?.textFrom, typed?.textTo)).toBe('yz');
      }
    });

    it('writes what is typed there as a tracked insertion in that cell alone, read the same in every order', () => {
      for (const { row, cell } of emptyCells(table(load(doc)))) {
        const editor = load(doc, cell.textFrom, true);
        for (const letter of ['y', 'z']) {
          editor.view.dispatch(editor.view.state.replaceSelection(letter), {
            userEvent: 'input.type',
          });
        }
        const file = editor.getDoc();
        const where = `row ${row.index}, column ${cell.col}`;
        const typed = `${doc.slice(0, cell.textFrom)}yz${doc.slice(cell.textFrom)}`;
        expect(newestView(file).text, where).toBe(newestView(typed).text);
        expect(decisionProblems(file), where).toEqual([]);
        // Rejecting gives back the bytes the file had; accepting, the plain edit's.
        const rejected = applyChanges(file, rejectAll(file));
        expect(rejected, where).toBe(applyChanges(doc, rejectAll(doc)));
        expect(applyChanges(file, acceptAll(file)), where).toBe(
          applyChanges(typed, acceptAll(typed)),
        );
        expect(headIn(editor)).toEqual([row.index, cell.col]);
      }
    });
  });
}

// A press on the cell's drawn box: happy-dom has no layout, so the cells' boxes are stubbed from a grid
// (column c of row r is at (100c, 30r), 100 by 30), as `mouse.test.ts` does.

function withBoxes(editor: Editor): Editor {
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
  for (const wrapper of editor.view.contentDOM.querySelectorAll<HTMLElement>('.rl-tbl')) {
    wrapper.getBoundingClientRect = () =>
      box(0, 0, 400, 30 * wrapper.querySelectorAll('.rl-trow').length);
    wrapper.querySelectorAll<HTMLElement>('.rl-trow').forEach((line, r) => {
      line.querySelectorAll<HTMLElement>('.rl-tc').forEach((cell) => {
        const c = Number(cell.dataset['col']);
        cell.getBoundingClientRect = () => box(100 * c, 30 * r, 100, 30);
      });
    });
  }
  return editor;
}

function pressAt(editor: Editor, x: number, y: number): MouseSelectionStyle | null {
  const event = new MouseEvent('mousedown', { clientX: x, clientY: y, button: 0, detail: 1 });
  for (const make of editor.view.state.facet(EditorView.mouseSelectionStyle)) {
    const style = make(editor.view, event);
    if (style) {
      editor.view.dispatch({
        selection: style.get(event, false, false),
        userEvent: 'select.pointer',
      });
      return style;
    }
  }
  return null;
}

for (const layout of LAYOUTS) {
  const { doc } = withStops(layout.marked);
  describe(`a press on a cell like these: ${layout.name}`, () => {
    it('puts the caret in an empty cell, and draws it there', () => {
      const editor = withBoxes(load(doc));
      for (const { row, cell } of emptyCells(table(editor))) {
        editor.view.dispatch({ selection: { anchor: 0 } });
        // The engine's own hit test finds another cell's text for a point in an empty cell.
        const other = table(editor).rows[row.index]?.cells.find((c) => c.textFrom < c.textTo);
        (editor.view as { posAtCoords: unknown }).posAtCoords = () => other?.textFrom ?? 0;
        pressAt(editor, 100 * cell.col + 50, 30 * row.index + 15);
        const where = `row ${row.index}, column ${cell.col}`;
        expect(head(editor), where).toBe(cell.textFrom);
        expect(headIn(editor), where).toEqual([row.index, cell.col]);
        expect(caretDrawnIn(editor), `${where}: the DOM selection is in the cell's mark`).toEqual([
          row.index,
          cell.col,
        ]);
      }
    });

    it('puts the caret at the start of the text of the cell after an empty one, as before', () => {
      const editor = withBoxes(load(doc));
      for (const { row, cell } of emptyCells(table(editor))) {
        const next = row.cells[cell.col + 1];
        if (!next || next.textFrom === next.textTo) continue;
        editor.view.dispatch({ selection: { anchor: 0 } });
        (editor.view as { posAtCoords: unknown }).posAtCoords = () => next.textFrom;
        pressAt(editor, 100 * next.col + 5, 30 * row.index + 15);
        expect(head(editor)).toBe(next.textFrom);
        expect(headIn(editor)).toEqual([row.index, next.col]);
        expect(caretDrawnIn(editor)).toEqual([row.index, next.col]);
      }
    });
  });
}

// What a person types, the second ⌫, Delete Row, and tracked deletions beside such cells, as keystroke
// scripts with Track Changes off and on, each read in every decision order, with Undo taking each step
// back.

interface ScriptRow {
  name: string;
  doc: string;
  keys: Step[];
  off: Script['expect'];
  on: Script['expect'];
  skip?: Script['skip'];
}

const both = (rows: ScriptRow[]): Script[] =>
  rows.flatMap((row) =>
    [false, true].map((tc) => ({
      name: `${row.name}, Track Changes ${tc ? 'on' : 'off'}`,
      doc: row.doc,
      keys: row.keys,
      tc,
      expect: tc ? row.on : row.off,
      ...(row.skip ? { skip: row.skip } : {}),
    })),
  );

const H = '| a | b | c |⏎| - | - | - |⏎';

describe('typing in a cell with one space of padding or none', () => {
  scriptRows(
    both([
      {
        name: 'a letter goes in the cell, written before its pipe',
        doc: `${H}| 1 | ‸| x |`,
        keys: [{ type: 'y' }],
        off: { file: `${H}| 1 | y| x |`, caret: `${H}| 1 | y‸| x |` },
        on: {
          caret: `${H}| 1 | <ins>y‸</ins>| x |`,
          newest: `${H}| 1 | y| x |`,
          original: `${H}| 1 | | x |`,
        },
      },
      {
        name: 'a second letter goes after the first, in the same cell',
        doc: `${H}| 1 | ‸| x |`,
        keys: [{ type: 'y' }, { type: 'z' }],
        off: { file: `${H}| 1 | yz| x |`, caret: `${H}| 1 | yz‸| x |` },
        on: { caret: `${H}| 1 | <ins>yz‸</ins>| x |`, newest: `${H}| 1 | yz| x |` },
      },
      {
        name: 'a letter goes in the first cell of a row',
        doc: `${H}| ‸| 1 | x |`,
        keys: [{ type: 'y' }, { type: 'z' }],
        off: { file: `${H}| yz| 1 | x |`, caret: `${H}| yz‸| 1 | x |` },
        on: { newest: `${H}| yz| 1 | x |`, original: `${H}| | 1 | x |` },
      },
      {
        name: 'a letter goes in a cell with no space of padding',
        doc: `${H}| 1 |‸| x |`,
        keys: [{ type: 'y' }, { type: 'z' }],
        off: { file: `${H}| 1 |yz| x |`, caret: `${H}| 1 |yz‸| x |` },
        on: { newest: `${H}| 1 |yz| x |`, original: `${H}| 1 || x |` },
      },
      {
        name: 'a letter goes in the first of two cells side by side',
        doc: `${H}| ‸| | x |`,
        keys: [{ type: 'y' }, { type: 'z' }],
        off: { file: `${H}| yz| | x |`, caret: `${H}| yz‸| | x |` },
        on: { newest: `${H}| yz| | x |`, original: `${H}| | | x |` },
      },
      {
        name: 'a letter goes in the second of two cells side by side',
        doc: `${H}| | ‸| x |`,
        keys: [{ type: 'y' }, { type: 'z' }],
        off: { file: `${H}| | yz| x |`, caret: `${H}| | yz‸| x |` },
        on: { newest: `${H}| | yz| x |`, original: `${H}| | | x |` },
      },
      {
        name: 'a letter goes in the last cell',
        doc: `${H}| 1 | x | ‸|`,
        keys: [{ type: 'y' }, { type: 'z' }],
        off: { file: `${H}| 1 | x | yz|`, caret: `${H}| 1 | x | yz‸|` },
        on: { newest: `${H}| 1 | x | yz|`, original: `${H}| 1 | x | |` },
      },
      {
        name: 'a letter goes in an empty header cell',
        doc: '| a | ‸| c |⏎| - | - | - |⏎| 1 | 2 | 3 |',
        keys: [{ type: 'y' }, { type: 'z' }],
        off: { file: '| a | yz| c |⏎| - | - | - |⏎| 1 | 2 | 3 |' },
        on: {
          newest: '| a | yz| c |⏎| - | - | - |⏎| 1 | 2 | 3 |',
          original: '| a | | c |⏎| - | - | - |⏎| 1 | 2 | 3 |',
        },
      },
      {
        name: 'a letter goes at the end of text that has no padding after it',
        doc: `${H}| 1 |x‸| 2 |`,
        keys: [{ type: 'y' }, { type: 'z' }],
        off: { file: `${H}| 1 |xyz| 2 |`, caret: `${H}| 1 |xyz‸| 2 |` },
        on: { newest: `${H}| 1 |xyz| 2 |`, original: `${H}| 1 |x| 2 |` },
      },
      {
        name: 'a pipe typed there is written escaped, and stays in the cell',
        doc: `${H}| 1 | ‸| x |`,
        keys: [{ type: '|' }, { type: 'z' }],
        off: { file: `${H}| 1 | \\|z| x |`, caret: `${H}| 1 | \\|z‸| x |` },
        on: { newest: `${H}| 1 | \\|z| x |` },
      },
      {
        name: 'Return writes a line break in that cell',
        doc: `${H}| 1 | ‸| x |`,
        keys: ['Enter'],
        off: { file: `${H}| 1 | <br>| x |`, caret: `${H}| 1 | <br>‸| x |` },
        on: { newest: `${H}| 1 | <br>| x |` },
      },
    ]),
  );
});

describe('the keys that clear and delete, in a table that has cells with one space of padding or none', () => {
  const COLUMN = `| a | [b | c |⏎| - | - | - |⏎| 1 | | x |⏎| 2 | ]| y |`;
  const ORIGINAL = '| a | b | c |⏎| - | - | - |⏎| 1 | | x |⏎| 2 | | y |';
  const CLEARED = '| a |  | c |⏎| - | - | - |⏎| 1 | | x |⏎| 2 | | y |';
  const REMOVED = '| a | c |⏎| - | - |⏎| 1 | x |⏎| 2 | y |';
  scriptRows(
    both([
      {
        // The selection ends at the stop of the empty cell in the last row: it is the column, not the
        // columns of both cells next to the stop.
        name: '⌫ clears a column selected to the empty cell of its last row, and the column stays',
        doc: COLUMN,
        keys: ['Backspace'],
        off: { file: CLEARED },
        on: { newest: CLEARED, original: ORIGINAL },
      },
      {
        name: '⌫ again deletes the column, the caret in the column that is then there',
        doc: COLUMN,
        keys: ['Backspace', 'Backspace'],
        off: { file: REMOVED, caret: '| a | c |⏎| - | - |⏎| 1 | x |⏎| 2 | ‸y |' },
        on: { newest: REMOVED, original: ORIGINAL },
      },
      {
        name: 'Delete Row deletes the row of the caret in the empty cell, the caret in the row after it',
        doc: `${H}| 1 | ‸| x |⏎| 2 | | y |`,
        keys: ['Alt-Mod-Backspace'],
        off: { file: `${H}| 2 | | y |`, caret: `${H}| ‸2 | | y |` },
        on: { newest: `${H}| 2 | | y |`, original: `${H}| 1 | | x |⏎| 2 | | y |` },
      },
    ]),
  );
});

describe('beside a row that is deleted or inserted', () => {
  // The row below the empty cell is deleted (a ghost row below the table in Redlines, with Track Changes
  // on), the caret goes to the row above, and Tab and the arrows step into the empty cell and out of it.
  const GONE = '| [4 | 5 | 6] |';
  const row = (caret: string) => `${H}${caret}`;
  scriptRows(
    both([
      {
        name: 'Tab goes into the one-space cell of the row above a deleted row',
        doc: `${H}| 1 | | x |⏎${GONE}`,
        keys: ['Backspace', 'Backspace', 'Tab'],
        off: { caret: row('| 1 | ‸| x |') },
        on: { caret: `${row('| 1 | ‸| x |')}⏎⏎<del row=2 | 4 | 5 | 6 |>` },
      },
      {
        name: '→ steps out of it, and ← back in',
        doc: `${H}| 1 | | x |⏎${GONE}`,
        keys: ['Backspace', 'Backspace', 'Tab', 'ArrowRight'],
        off: { caret: row('| 1 | | ‸x |') },
        on: { caret: `${row('| 1 | | ‸x |')}⏎⏎<del row=2 | 4 | 5 | 6 |>` },
      },
      {
        name: '← steps back into it from the next cell',
        doc: `${H}| 1 | | x |⏎${GONE}`,
        keys: ['Backspace', 'Backspace', 'Tab', 'ArrowRight', 'ArrowLeft'],
        off: { caret: row('| 1 | ‸| x |') },
        on: { caret: `${row('| 1 | ‸| x |')}⏎⏎<del row=2 | 4 | 5 | 6 |>` },
      },
    ]),
  );
});
