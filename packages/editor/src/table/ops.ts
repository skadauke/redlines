// What the table keys and the Table menu do to a table's rows (design: tables, "Rows and columns"):
// the format's operations (`table-ops.ts`), dispatched as one step to undo, tracked as the format
// writes them with Track Changes on and plain with it off. The format refuses what it must (a row
// while a column is pending deleted), and the refusal is told to the person.

import { isolateHistory } from '@codemirror/commands';
import { EditorSelection, type EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import {
  EditError,
  tableEdit,
  type TableOp,
  type TextChange,
  untrackedTableEdit,
} from '@redlines/format';
import {
  authorFacet,
  setViewModeEffect,
  trackedEditAnnotation,
  viewModeField,
} from '../tracked/field.ts';
import {
  contextFor,
  editSourceFacet,
  refusedEditEffect,
  trackingField,
} from '../tracked/typing.ts';
import type { Row, Table } from './model.ts';
import { rectOf, rectSelection } from './cells.ts';
import { shownCellAt } from './stops.ts';
import { tablesField } from './model.ts';

/** The format's changes for `op` on the state's text, as Track Changes says; or the refusal. */
export function planned(
  view: EditorView,
  op: TableOp,
  group?: string,
  /** The text to work on, when it is not the state's (a paste that does several things in a row). */
  onText?: string,
):
  { changes: TextChange[]; caret: number; rows?: number[]; cols?: number[] } | { refusal: string } {
  const { state } = view;
  const text = onText ?? state.doc.toString();
  try {
    if (state.field(trackingField))
      return tableEdit(text, op, { ...contextFor(state), ...(group ? { group } : {}) });
    const { random } = state.facet(editSourceFacet);
    const editing = state.facet(authorFacet);
    const author = editing ? { handle: editing.handle, name: editing.name } : undefined;
    return untrackedTableEdit(text, op, { random, author });
  } catch (error) {
    if (error instanceof EditError) return { refusal: error.message };
    throw error;
  }
}

/** Makes an operation's changes one step to undo, the caret where the operation says; or says why
 * it can't. */
function perform(
  view: EditorView,
  op: TableOp,
  userEvent = 'table.insert.row',
  select?: (
    after: EditorView,
    done: { caret: number; rows?: number[]; cols?: number[] },
  ) => EditorSelection,
): boolean {
  const done = planned(view, op);
  if ('refusal' in done) {
    view.dispatch({ effects: refusedEditEffect.of(done.refusal) });
    return true;
  }
  const tracked = view.state.field(trackingField);
  // The selection the operation leaves, worked out in the text after it.
  const next = view.state.update({ changes: done.changes });
  const selection = select
    ? select({ state: next.state } as EditorView, done)
    : EditorSelection.single(done.caret);
  view.dispatch({
    changes: done.changes,
    selection,
    userEvent,
    annotations: [trackedEditAnnotation.of(true), isolateHistory.of('full')],
    // A tracked change made in Clean shows in Redlines, as typing's do.
    effects:
      tracked && view.state.field(viewModeField) === 'clean'
        ? [setViewModeEffect.of('redlines')]
        : [],
    scrollIntoView: true,
  });
  return true;
}

/** Inserts a row below `row` of `table` (the header's is the first body row). */
export function insertRowAfter(view: EditorView, table: Table, row: Row): boolean {
  return perform(view, { kind: 'insertRows', table: table.from, after: row.index, count: 1 });
}

/** The rows the selection touches: a rectangle's rows, or the caret's row. Null outside a table, and
 * in Raw. */
export function touchedRows(
  state: EditorState,
): { table: Table; first: number; last: number; rectangle: boolean } | null {
  // A title is worked out on a state with none of the editor's fields too (`baseTitle`).
  if (state.field(viewModeField, false) === 'raw' || !state.field(tablesField, false)) return null;
  const rect = rectOf(state);
  if (rect) return { table: rect.table, first: rect.rows[0], last: rect.rows[1], rectangle: true };
  const found = shownCellAt(state, state.selection.main.head);
  const row = found?.table.rows.find((r) => r.cells.includes(found.cell));
  return found && row
    ? { table: found.table, first: row.index, last: row.index, rectangle: false }
    : null;
}

/** How many rows the selection touches, at least one. */
export const rowCount = (state: EditorState): number => {
  const touched = touchedRows(state);
  return touched ? touched.last - touched.first + 1 : 1;
};

const counted = (verb: string, tail: string) => (state: EditorState) => {
  const n = rowCount(state);
  return n === 1 ? `${verb} Row${tail}` : `${verb} ${n} Rows${tail}`;
};

/** The titles of the row commands, which count the rows the selection touches. */
export const rowTitles = {
  insertAbove: counted('Insert', ' Above'),
  insertBelow: counted('Insert', ' Below'),
  delete: counted('Delete', ''),
  moveUp: counted('Move', ' Up'),
  moveDown: counted('Move', ' Down'),
};

/** Where the selection of a moved or made group of rows stands, in the new text: the rows as a
 * rectangle, the way they were selected, or the caret in the first of them. */
function rowsSelected(
  state: EditorState,
  table: Table,
  rows: readonly number[],
  rectangle: boolean,
  fallback: number,
): EditorSelection {
  const read = state.field(tablesField, false)?.find((t) => t.from === table.from);
  const first = rows[0];
  const last = rows.at(-1);
  if (!read || first === undefined || last === undefined) return EditorSelection.single(fallback);
  if (rectangle) {
    const end = Math.max(0, (read.rows[last]?.cells.length ?? 1) - 1);
    const rect = rectSelection(read, { row: first, col: 0 }, { row: last, col: end });
    if (rect) return rect;
  }
  const cell = read.rows[first]?.cells[0];
  return EditorSelection.single(cell?.textFrom ?? fallback);
}

/** Inserts as many rows as the selection touches, above its first row or below its last, with the
 * caret in the first new cell. */
export function insertRows(view: EditorView, above: boolean): boolean {
  const touched = touchedRows(view.state);
  if (!touched) return false;
  const count = touched.last - touched.first + 1;
  return perform(view, {
    kind: 'insertRows',
    table: touched.table.from,
    after: above ? touched.first - 1 : touched.last,
    count,
  });
}

/** Deletes the rows the selection touches; the caret goes to the row that is then where they were. */
export function deleteRows(view: EditorView): boolean {
  const touched = touchedRows(view.state);
  if (!touched) return false;
  const rows = Array.from(
    { length: touched.last - touched.first + 1 },
    (_, i) => touched.first + i,
  );
  return perform(view, { kind: 'deleteRows', table: touched.table.from, rows }, 'table.delete.row');
}

/** Moves rows `first` to `last` of `table` to the boundary `to` (0 above the header, the number of
 * rows below the last), and keeps them selected as they were. A boundary that is where they are is
 * no move: it says so. */
export function moveRowsTo(
  view: EditorView,
  table: Table,
  first: number,
  last: number,
  to: number,
  rectangle = true,
): boolean {
  if (to >= first && to <= last + 1) return false;
  const rows = Array.from({ length: last - first + 1 }, (_, i) => first + i);
  return perform(
    view,
    { kind: 'moveRows', table: table.from, rows, to },
    'table.move.row',
    (after, done) => rowsSelected(after.state, table, done.rows ?? [], rectangle, done.caret),
  );
}

/** Inserts `count` rows at the boundary `at` (0 above the header), the caret in the first. */
export function insertRowsAt(view: EditorView, table: Table, at: number, count = 1): boolean {
  return perform(view, { kind: 'insertRows', table: table.from, after: at - 1, count });
}

/** Moves the rows the selection touches one place up or down; they stay selected. At the top or the
 * bottom there is no place: it says so. */
export function moveRows(view: EditorView, up: boolean): boolean {
  const touched = touchedRows(view.state);
  if (!touched) return false;
  const { table, first, last } = touched;
  const edge = up ? first === 0 : last === table.rows.length - 1;
  if (edge) {
    view.dispatch({
      effects: refusedEditEffect.of(up ? 'The row is at the top.' : 'The row is at the bottom.'),
    });
    return true;
  }
  return moveRowsTo(view, table, first, last, up ? first - 1 : last + 2, touched.rectangle);
}

/** Inserts a row below the caret's row: the table's first body row from the header. False with the
 * caret outside a cell. */
export function insertRowBelow(view: EditorView): boolean {
  const { state } = view;
  if (state.field(viewModeField, false) === 'raw') return false;
  const found = shownCellAt(state, state.selection.main.head);
  const row = found?.table.rows.find((r) => r.cells.includes(found.cell));
  return found && row ? insertRowAfter(view, found.table, row) : false;
}

// Columns: the same operations, on the columns the selection touches.

/** The columns the selection touches: a rectangle's, or the caret's column; and the row the caret is
 * in. Null outside a table, and in Raw. */
export function touchedCols(state: EditorState): {
  table: Table;
  first: number;
  last: number;
  rectangle: boolean;
  row: number;
} | null {
  if (state.field(viewModeField, false) === 'raw' || !state.field(tablesField, false)) return null;
  const rect = rectOf(state);
  if (rect) {
    return {
      table: rect.table,
      first: rect.cols[0],
      last: rect.cols[1],
      rectangle: true,
      row: rect.head.row,
    };
  }
  const found = shownCellAt(state, state.selection.main.head);
  const row = found?.table.rows.find((r) => r.cells.includes(found.cell));
  return found && row
    ? {
        table: found.table,
        first: found.cell.col,
        last: found.cell.col,
        rectangle: false,
        row: row.index,
      }
    : null;
}

/** How many columns the selection touches, at least one. */
export const colCount = (state: EditorState): number => {
  const touched = touchedCols(state);
  return touched ? touched.last - touched.first + 1 : 1;
};

const countedCols = (verb: string, tail: string) => (state: EditorState) => {
  const n = colCount(state);
  return n === 1 ? `${verb} Column${tail}` : `${verb} ${n} Columns${tail}`;
};

/** The titles of the column commands, which count the columns the selection touches. */
export const colTitles = {
  insertLeft: countedCols('Insert', ' Left'),
  insertRight: countedCols('Insert', ' Right'),
  delete: countedCols('Delete', ''),
  moveLeft: countedCols('Move', ' Left'),
  moveRight: countedCols('Move', ' Right'),
};

/** The selection in column `col` of row `row` of the table at `table` in the new text: the cell's
 * text, or the rectangle of `cols` over every row when the columns were selected as one. */
function colsSelected(
  state: EditorState,
  table: Table,
  cols: readonly number[],
  row: number,
  rectangle: boolean,
  fallback: number,
): EditorSelection {
  const read = state.field(tablesField, false)?.find((t) => t.from === table.from);
  const first = cols[0];
  const last = cols.at(-1);
  if (!read || first === undefined || last === undefined) return EditorSelection.single(fallback);
  if (rectangle) {
    const rect = rectSelection(
      read,
      { row: 0, col: first },
      { row: read.rows.length - 1, col: last },
    );
    if (rect) return rect;
  }
  const cell = (read.rows[Math.min(row, read.rows.length - 1)] ?? read.rows[0])?.cells[first];
  return EditorSelection.single(cell?.textFrom ?? fallback);
}

/** Inserts as many columns as the selection touches, left of its first column or right of its last,
 * with the caret in the first new cell of the caret's row. */
export function insertCols(view: EditorView, left: boolean): boolean {
  const touched = touchedCols(view.state);
  if (!touched) return false;
  const count = touched.last - touched.first + 1;
  return perform(
    view,
    {
      kind: 'insertCols',
      table: touched.table.from,
      after: left ? touched.first : touched.last + 1,
      count,
    },
    'table.insert.col',
    (after, done) =>
      colsSelected(after.state, touched.table, done.cols ?? [], touched.row, false, done.caret),
  );
}

/** Deletes the columns the selection touches; the caret goes to the cell of the column that is then
 * where they were, in its row. */
export function deleteCols(view: EditorView): boolean {
  const touched = touchedCols(view.state);
  if (!touched) return false;
  const cols = Array.from(
    { length: touched.last - touched.first + 1 },
    (_, i) => touched.first + i,
  );
  return perform(
    view,
    { kind: 'deleteCols', table: touched.table.from, cols },
    'table.delete.col',
    (after, done) =>
      colsSelected(after.state, touched.table, done.cols ?? [], touched.row, false, done.caret),
  );
}

/** Moves columns `first` to `last` of `table` to the boundary `to` (0 before the first column, the
 * number of columns after the last), and keeps them selected as they were. A boundary that is where
 * they are is no move. */
export function moveColsTo(
  view: EditorView,
  table: Table,
  first: number,
  last: number,
  to: number,
  rectangle = true,
  row = 0,
): boolean {
  if (to >= first && to <= last + 1) return false;
  const cols = Array.from({ length: last - first + 1 }, (_, i) => first + i);
  return perform(
    view,
    { kind: 'moveCols', table: table.from, cols, to },
    'table.move.col',
    (after, done) => colsSelected(after.state, table, done.cols ?? [], row, rectangle, done.caret),
  );
}

/** Inserts `count` columns at the boundary `at` (0 before the first), the caret in the first. */
export function insertColsAt(view: EditorView, table: Table, at: number, count = 1): boolean {
  return perform(
    view,
    { kind: 'insertCols', table: table.from, after: at, count },
    'table.insert.col',
    (after, done) => colsSelected(after.state, table, done.cols ?? [], 1, false, done.caret),
  );
}

/** Moves the columns the selection touches one place left or right; they stay selected. At the edge
 * there is no place: it says so. */
export function moveCols(view: EditorView, left: boolean): boolean {
  const touched = touchedCols(view.state);
  if (!touched) return false;
  const { table, first, last } = touched;
  const edge = left ? first === 0 : last === table.columns - 1;
  if (edge) {
    view.dispatch({
      effects: refusedEditEffect.of(
        left ? 'The column is at the left.' : 'The column is at the right.',
      ),
    });
    return true;
  }
  return moveColsTo(
    view,
    table,
    first,
    last,
    left ? first - 1 : last + 2,
    touched.rectangle,
    touched.row,
  );
}
