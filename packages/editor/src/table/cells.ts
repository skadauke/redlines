// Selected cells (design: tables, "Selecting cells"). There is one selection model: a caret, text
// inside one cell, or a rectangle of cells. A rectangle is the ordinary selection whose two ends are
// in two different cells of one table; it is no new state, so that everything that extends a
// selection (shift-arrows, shift-press, a drag, Undo restoring one) makes and keeps rectangles for
// free, and the format only ever sees positions. Whole rows, whole columns and the whole table are
// the rectangles that reach the table's edges.
//
// This file reads rectangles and acts on them: the cells they hold, what clearing them writes, and
// the commands that select a cell, a row, a column or the table.

import { isolateHistory } from '@codemirror/commands';
import {
  Annotation,
  ChangeSet,
  EditorSelection,
  type EditorState,
  type SelectionRange,
} from '@codemirror/state';
import { type EditorView } from '@codemirror/view';
import { viewModeField } from '../tracked/field.ts';
import { editGroupAnnotation } from '../tracked/typing.ts';
import { type Cell, type Row, type Table, cellAt, tablesField } from './model.ts';

/** A cell of a table by its row (0 the header) and column. */
export interface CellRef {
  row: number;
  col: number;
}

/** The cells from one corner to the other, both included. */
export interface Rect {
  table: Table;
  /** The first and last row, by index (the header is 0). */
  rows: [number, number];
  /** The first and last column. */
  cols: [number, number];
  /** The cell the selection started in, and the one it ends in (where Esc and Tab go from). */
  anchor: CellRef;
  head: CellRef;
}

const shown = (table: Table, row: Row): Cell[] =>
  row.cells.filter((cell) => cell.col < table.columns);

/** The cell GFM shows that holds `pos`, with its row: the last the row shows when `pos` is in a cell
 * it doesn't. Null outside a table, and where `pos` is not in the text of the cell. */
function textCellAt(
  state: EditorState,
  pos: number,
): { table: Table; row: Row; cell: Cell } | null {
  const found = cellAt(state, pos);
  if (!found) return null;
  const { table, row } = found;
  const cell = found.cell.col < table.columns ? found.cell : shown(table, row).at(-1);
  if (!cell || pos < cell.textFrom || pos > cell.textTo) return null;
  return { table, row, cell };
}

/** The cell the head of the selection is in, with its table and row, or null outside a table. */
export function headCell(state: EditorState): { table: Table; row: Row; cell: Cell } | null {
  if (state.field(viewModeField, false) === 'raw') return null;
  return textCellAt(state, state.selection.main.head);
}

/**
 * The rectangle of cells a selection makes: its two ends in two different cells of one table, every
 * cell in the rows and columns between them. Null for a caret, for text inside one cell, for a
 * selection that reaches out of the table (which is a reach, `reach.ts`) and in Raw, which draws no
 * cells. A selection that covers a table whole and more is no rectangle: it deletes the table.
 */
export function rectOf(
  state: EditorState,
  range: SelectionRange = state.selection.main,
): Rect | null {
  if (range.empty || state.field(viewModeField, false) === 'raw') return null;
  if (!state.field(tablesField, false)?.length) return null;
  const a = textCellAt(state, range.anchor);
  const h = textCellAt(state, range.head);
  if (!a || !h || a.table !== h.table || a.cell === h.cell) return null;
  const { table } = a;
  if (
    range.from <= table.from &&
    range.to >= table.to &&
    (range.from < table.from || range.to > table.to)
  ) {
    return null;
  }
  const anchor = { row: a.row.index, col: a.cell.col };
  const head = { row: h.row.index, col: h.cell.col };
  return {
    table,
    rows: [Math.min(anchor.row, head.row), Math.max(anchor.row, head.row)],
    cols: [Math.min(anchor.col, head.col), Math.max(anchor.col, head.col)],
    anchor,
    head,
  };
}

/** The cells of a rectangle, row by row. A short row has the cells it has. */
export function cellsOfRect(rect: Rect): Cell[] {
  const cells: Cell[] = [];
  for (const row of rect.table.rows.slice(rect.rows[0], rect.rows[1] + 1)) {
    for (const cell of shown(rect.table, row)) {
      if (cell.col >= rect.cols[0] && cell.col <= rect.cols[1]) cells.push(cell);
    }
  }
  return cells;
}

/** The cells the selection has selected, or none. */
export function selectedCells(state: EditorState): Cell[] {
  const rect = rectOf(state);
  return rect ? cellsOfRect(rect) : [];
}

/** What a rectangle is, when it reaches the table's edges: whole rows, whole columns, the table. */
export function whole(rect: Rect): 'row' | 'column' | 'table' | null {
  const { table } = rect;
  const last = table.rows.length - 1;
  const tall = rect.rows[0] === 0 && rect.rows[1] === last;
  // Wide: from the first column to the last cell of every row it covers (a short row ends early).
  const wide =
    rect.cols[0] === 0 &&
    table.rows
      .slice(rect.rows[0], rect.rows[1] + 1)
      .every((row) => rect.cols[1] >= (shown(table, row).at(-1)?.col ?? 0));
  if (tall && wide) return 'table';
  if (wide) return 'row';
  if (tall) return 'column';
  return null;
}

/** The cell of a table at a row and column: the last of a row that is shorter. */
export function cellOfRef(table: Table, ref: CellRef): Cell | null {
  const row = table.rows[ref.row];
  if (!row) return null;
  const cells = shown(table, row);
  return cells.find((cell) => cell.col === ref.col) ?? cells.at(-1) ?? null;
}

/** The selection of a rectangle from one cell's text to another's. */
function rectSelection(table: Table, from: CellRef, to: CellRef): EditorSelection | null {
  const a = cellOfRef(table, from);
  const b = cellOfRef(table, to);
  if (!a || !b) return null;
  return EditorSelection.single(a.textFrom, b.textTo);
}

/** The comment a rectangle makes: on the selected cells' text in one row, on the whole rows across
 * rows, as the text from the first of them to the last (the markers stand in the cells). */
export function commentRangeOfRect(state: EditorState): { from: number; to: number } | null {
  const rect = rectOf(state);
  if (!rect) return null;
  const rows = rect.table.rows.slice(rect.rows[0], rect.rows[1] + 1);
  const first = rows[0] && shown(rect.table, rows[0]);
  const last = rows.at(-1) && shown(rect.table, rows.at(-1)!);
  if (!first || !last) return null;
  if (rows.length === 1) {
    const mine = cellsOfRect(rect);
    const a = mine[0];
    const b = mine.at(-1);
    return a && b ? { from: a.textFrom, to: b.textTo } : null;
  }
  const a = first[0];
  const b = last.at(-1);
  return a && b ? { from: a.textFrom, to: b.textTo } : null;
}

/** What `scope` selects around the caret's cell. */
export type Scope = 'cell' | 'row' | 'column' | 'table';

/**
 * Selects the caret's cell (its text), row, column or the whole table, as a rectangle (so that
 * `whole` reports it). False where the selection has no cell, or in Raw.
 */
export function selectRect(view: EditorView, scope: Scope): boolean {
  const { state } = view;
  if (state.field(viewModeField, false) === 'raw') return false;
  const { head } = state.selection.main;
  const found = textCellAt(state, head) ?? textCellAt(state, state.selection.main.anchor);
  if (!found) return false;
  const { table, row, cell } = found;
  let selection: EditorSelection | null;
  if (scope === 'cell') selection = EditorSelection.single(cell.textFrom, cell.textTo);
  else if (scope === 'row') {
    selection = rectSelection(
      table,
      { row: row.index, col: 0 },
      { row: row.index, col: table.columns - 1 },
    );
  } else if (scope === 'column') {
    selection = rectSelection(
      table,
      { row: 0, col: cell.col },
      { row: table.rows.length - 1, col: cell.col },
    );
  } else {
    selection = rectSelection(
      table,
      { row: 0, col: 0 },
      { row: table.rows.length - 1, col: table.columns - 1 },
    );
  }
  if (!selection) return false;
  view.dispatch({ selection, userEvent: 'select', scrollIntoView: true });
  return true;
}

/** Marks what a rectangle's own edit has made, so that the filter that routes typing leaves it be. */
export const clearedCells = Annotation.define<boolean>();

/** What clearing `cells` writes, as plain edits: the text of each goes, and `insert` is written in
 * the first, top-left one. Null where nothing changes. */
function planOf(
  cells: readonly Cell[],
  insert: string,
): { changes: { from: number; to: number; insert?: string }[]; first: Cell } | null {
  const first = cells[0];
  if (!first) return null;
  const changes: { from: number; to: number; insert?: string }[] = [];
  for (const cell of cells) {
    if (cell === first && insert !== '') {
      changes.push({ from: cell.textFrom, to: cell.textTo, insert });
    } else if (cell.textFrom < cell.textTo) changes.push({ from: cell.textFrom, to: cell.textTo });
  }
  return changes.length ? { changes, first } : null;
}

/** The transaction that clears `cells` and writes `insert` in the first: one change, one group, one
 * step to undo, the caret after what is written. Null where nothing changes. */
function clearSpec(
  state: EditorState,
  cells: readonly Cell[],
  insert: string,
  userEvent: string,
): Parameters<EditorView['dispatch']>[0] | null {
  const plan = planOf(cells, insert);
  if (!plan) return null;
  const changes = ChangeSet.of(plan.changes, state.doc.length);
  const caret = changes.mapPos(plan.first.textFrom, -1) + insert.length;
  return {
    changes,
    selection: EditorSelection.cursor(caret),
    userEvent,
    annotations: [clearedCells.of(true), editGroupAnnotation.of(true), isolateHistory.of('before')],
    scrollIntoView: true,
  };
}

/** The transaction that clears a rectangle's cells and types `insert` into the first. */
export function rectSpec(
  state: EditorState,
  rect: Rect,
  insert: string,
  userEvent: string,
): Parameters<EditorView['dispatch']>[0] | null {
  return clearSpec(state, cellsOfRect(rect), insert, userEvent);
}

/**
 * Clears the text of `cells`, one change and one step to undo, and leaves the rectangle they are
 * of selected (a second key then has the cells to act on). True also when there was nothing to
 * clear: the key is taken and writes nothing.
 */
export function clearCells(view: EditorView, cells: readonly Cell[]): boolean {
  const { state } = view;
  const rect = rectOf(state);
  const spec = clearSpec(state, cells, '', 'delete.selection');
  if (spec) view.dispatch(spec);
  if (rect && spec) reselect(view, rect);
  return true;
}

/** Selects the rectangle `rect` again after an edit changed the text in it: the same cells of the
 * same table, found by its identity. */
export function reselect(view: EditorView, rect: Rect): void {
  const table = view.state.field(tablesField, false)?.find((t) => t.id === rect.table.id);
  if (!table) return;
  const selection = rectSelection(table, rect.anchor, rect.head);
  if (!selection || selection.eq(view.state.selection)) return;
  view.dispatch({ selection, userEvent: 'select' });
}
