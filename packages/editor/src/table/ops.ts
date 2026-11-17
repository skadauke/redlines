// What the table keys and the Table menu do to a table's rows (design: tables, "Rows and columns"):
// the format's operations (`table-ops.ts`), dispatched as one step to undo, tracked as the format
// writes them with Track Changes on and plain with it off. The format refuses what it must (a row
// while a column is pending deleted), and the refusal is told to the person.

import { isolateHistory } from '@codemirror/commands';
import {
  ChangeSet,
  EditorSelection,
  type EditorState,
  Transaction,
  type TransactionSpec,
} from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { EditError, type TableOp, type TextChange } from '@redlines/format';
import {
  authorFacet,
  markupViewFacet,
  setViewModeEffect,
  trackedEditAnnotation,
  viewModeField,
} from '../tracked/field.ts';
import { heldEditEffect, untrackedAnswerAnnotation, untrackedAskFacet } from '../tracked/ask.ts';
import {
  contextFor,
  editSourceFacet,
  refusedEditEffect,
  trackingField,
} from '../tracked/typing.ts';
import type { Unnamed } from '../tracked/intent.ts';
import { recordedAs } from '../tracked/intent.ts';
import { type TableIntent, writeTable } from './intent.ts';
import type { Align, Row, Table } from './model.ts';
import { rectOf, rectSelection } from './cells.ts';
import { missingCaret } from './missing.ts';
import { shownCellAt } from './stops.ts';
import { tablesField } from './model.ts';

/** What `planned` gives: the changes, where the caret goes, and the rows or columns made. */
export type Planned =
  | {
      changes: TextChange[];
      caret: number;
      rows?: number[];
      cols?: number[];
      untracked?: true;
      /** What was asked and how it was written, to record beside the changes. */
      intent?: Unnamed<TableIntent>;
    }
  | { refusal: string };

/** The format's changes for `op` on the state's text, as Track Changes says; or the refusal. */
export function planned(
  view: EditorView,
  op: TableOp,
  group?: string,
  /** The text to work on, when it is not the state's (a paste that does several things in a row). */
  onText?: string,
  /** The operation as the table's own rules write it, never as a replacement of the table: for a
   * caller that works on where the operation put the cells (a paste that goes on to fill them). */
  fine = false,
  /** The operation as Track Changes off writes it, whatever the setting: what a question to the
   * person answered Make Edit asks for. */
  untracked = false,
  /** Where no tracked write holds the operation, the plain one, marked `untracked`, for a caller that
   * asks the person first. */
  asked = false,
): Planned {
  return plannedIn(view.state, op, group, onText, fine, untracked, asked);
}

/** `planned` for a state, where there is no view (a transaction filter's). */
export function plannedIn(
  state: EditorState,
  op: TableOp,
  group?: string,
  onText?: string,
  fine = false,
  untracked = false,
  asked = false,
): Planned {
  const text = onText ?? state.doc.toString();
  try {
    const tracking = state.field(trackingField) && !untracked;
    const { random } = state.facet(editSourceFacet);
    const editing = state.facet(authorFacet);
    const written = tracking
      ? (() => {
          const ctx = contextFor(state);
          return writeTable(text, {
            tracking,
            op,
            writer: fine ? 'fine' : asked ? 'asked' : 'tableEdit',
            ...(group ? { group } : {}),
            author: ctx.author,
            time: ctx.time,
            ...(random ? { random } : {}),
          });
        })()
      : writeTable(text, {
          tracking,
          op,
          author: editing ? { handle: editing.handle, name: editing.name } : null,
          time: '',
          ...(random ? { random } : {}),
        });
    return { ...written.edit, intent: written.intent };
  } catch (error) {
    if (error instanceof EditError) return { refusal: error.message };
    throw error;
  }
}

/** Changes written as one, from the start of the first to the end of the last, when there are many
 * (the lines of a table). */
export function coalesced(text: string, changes: readonly TextChange[]): TextChange[] {
  if (changes.length < 8) return [...changes];
  const sorted = changes.toSorted((a, b) => a.from - b.from || a.to - b.to);
  const from = sorted[0]?.from ?? 0;
  const to = Math.max(...sorted.map((change) => change.to));
  let insert = '';
  let at = from;
  for (const change of sorted) {
    insert += text.slice(at, change.from) + change.insert;
    at = change.to;
  }
  return [{ from, to, insert: insert + text.slice(at, to) }];
}

/** The sheet's question for a table operation that no tracked write holds. */
const UNTRACKED_OPERATION = "This change to the table can't be tracked. Make it without tracking?";

/** Makes an operation's changes one step to undo, the caret where the operation says; or says why
 * it can't. */
function perform(
  view: EditorView,
  op: TableOp,
  userEvent = 'table.insert.row',
  select?: (
    after: EditorView,
    done: { caret: number; rows?: number[]; cols?: number[] },
    changes: readonly TextChange[],
  ) => EditorSelection,
): boolean {
  const done = planned(view, op, undefined, undefined, false, false, true);
  if ('refusal' in done) {
    view.dispatch({ effects: refusedEditEffect.of(done.refusal) });
    return true;
  }
  const tracked = view.state.field(trackingField) && !done.untracked;
  // An operation on columns writes into every line of the table: as many changes as lines, which the
  // syntax tree would read again one by one. Written as one change over the lines they span, the table
  // is read again once.
  const changes = coalesced(view.state.doc.toString(), done.changes);
  // The selection the operation leaves, worked out in the text after it.
  const next = view.state.update({ changes });
  const selection = select
    ? select({ state: next.state } as EditorView, done, changes)
    : EditorSelection.single(done.caret);
  const annotations = [trackedEditAnnotation.of(true), isolateHistory.of('full')];
  if (done.untracked) {
    // No tracked write holds it: the person is asked, and the operation is made without tracking
    // (design: widen, alert or disable, §3.1), never refused.
    const asker = view.state.facet(untrackedAskFacet);
    if (asker) {
      view.dispatch({
        effects: heldEditEffect.of({
          reason: 'accept-pending',
          words: { title: UNTRACKED_OPERATION },
          doc: view.state.doc,
          changes: ChangeSet.of(changes, view.state.doc.length),
          selection,
          annotations: [Transaction.userEvent.of(userEvent), ...annotations],
          scrollIntoView: true,
        }),
      });
      return true;
    }
    annotations.push(untrackedAnswerAnnotation.of(true));
  }
  view.dispatch({
    changes,
    selection,
    userEvent,
    annotations: done.intent ? [...annotations, recordedAs(done.intent)] : annotations,
    // A tracked change made in Clean shows in Redlines, in the look chosen last, as typing's do.
    effects:
      tracked && view.state.field(viewModeField) === 'clean'
        ? [setViewModeEffect.of(view.state.facet(markupViewFacet))]
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
 * in Plain. */
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
    // Whole rows: to the table's last column, whatever the last of them has (a row that lacks cells
    // ends early, as Select Row does), not to the last row's own end.
    const rect = rectSelection(read, { row: first, col: 0 }, { row: last, col: read.columns - 1 });
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

/**
 * Deletes the table the selection is in, whole: a block deletion with Track Changes on, the text of
 * the table taken out with it off. The caret goes to the start of the text that follows it, or to the
 * end of the text before it when none does. The format refuses it where another person's pending
 * change is in the table (rule 6), and the refusal is told.
 */
export function deleteTable(view: EditorView): boolean {
  const touched = touchedRows(view.state);
  if (!touched) return false;
  return perform(view, { kind: 'deleteTable', table: touched.table.from }, 'table.delete.table');
}

/** Delete Table as a transaction spec of a state's own, for a filter or a key that has no view: the
 * deletion with Track Changes' rules, or the refusal as a notice (#471). */
export function deleteTableSpec(state: EditorState, table: number): TransactionSpec {
  const done = plannedIn(state, { kind: 'deleteTable', table });
  if ('refusal' in done) return { effects: refusedEditEffect.of(done.refusal) };
  const changes = ChangeSet.of(coalesced(state.doc.toString(), done.changes), state.doc.length);
  return {
    changes,
    selection: EditorSelection.cursor(done.caret),
    userEvent: 'table.delete.table',
    annotations: [trackedEditAnnotation.of(true), isolateHistory.of('full')],
    effects:
      state.field(trackingField) && state.field(viewModeField) === 'clean'
        ? [setViewModeEffect.of(state.facet(markupViewFacet))]
        : [],
    scrollIntoView: true,
  };
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

/** Whether the rows the selection touches have a place to move to: false at the top (up) or the
 * bottom (down) of the table, and outside one. */
export function canMoveRows(state: EditorState, up: boolean): boolean {
  const touched = touchedRows(state);
  if (!touched) return false;
  return up ? touched.first > 0 : touched.last < touched.table.rows.length - 1;
}

/** Whether the columns the selection touches have a place to move to: false at the left (left) or
 * the right edge, and outside a table. */
export function canMoveCols(state: EditorState, left: boolean): boolean {
  const touched = touchedCols(state);
  if (!touched) return false;
  return left ? touched.first > 0 : touched.last < touched.table.columns - 1;
}

/** Why a command of the Table menu can't run with the caret outside a table (disabled, with this hint). */
export const NOT_IN_TABLE = 'This command works in a table. Put the caret in one.';

/** Why the rows the selection touches can't move up or down, or undefined when they can. */
export function moveRowsReason(state: EditorState, up: boolean): string | undefined {
  const touched = touchedRows(state);
  if (!touched) return NOT_IN_TABLE;
  const many = touched.last > touched.first;
  if (canMoveRows(state, up)) return undefined;
  const where = up ? 'top' : 'bottom';
  return `${many ? 'These rows are' : 'This row is'} at the ${where} of the table already.`;
}

/** Why the rows the selection touches can't be deleted, or undefined when they can. */
export function deleteRowsReason(state: EditorState): string | undefined {
  const touched = touchedRows(state);
  if (!touched) return NOT_IN_TABLE;
  const everyRow = touched.first === 0 && touched.last === touched.table.rows.length - 1;
  return everyRow ? 'A table keeps at least one row. Delete the table instead.' : undefined;
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
 * in. Null outside a table, and in Plain. */
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
  // A caret in a cell its row lacks is in the column it was put in.
  const lacking = missingCaret(state);
  if (lacking) {
    const { col } = lacking.cell;
    return {
      table: lacking.table,
      first: col,
      last: col,
      rectangle: false,
      row: lacking.row.index,
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

/** Why the columns the selection touches can't move left or right, or undefined when they can. */
export function moveColsReason(state: EditorState, left: boolean): string | undefined {
  const touched = touchedCols(state);
  if (!touched) return NOT_IN_TABLE;
  if (canMoveCols(state, left)) return undefined;
  const many = touched.last > touched.first;
  const edge = left ? 'left' : 'right';
  return `${many ? 'These columns are' : 'This column is'} at the ${edge} edge of the table already.`;
}

/** Why the columns the selection touches can't be deleted, or undefined when they can. */
export function deleteColsReason(state: EditorState): string | undefined {
  const touched = touchedCols(state);
  if (!touched) return NOT_IN_TABLE;
  const everyColumn = touched.first === 0 && touched.last === touched.table.columns - 1;
  return everyColumn ? 'A table keeps at least one column. Delete the table instead.' : undefined;
}

/** Why the columns the selection touches can't be aligned `align`, or undefined when they can. */
export function alignReason(state: EditorState, align: Align): string | undefined {
  const touched = touchedCols(state);
  if (!touched) return NOT_IN_TABLE;
  for (let col = touched.first; col <= touched.last; col++) {
    if (touched.table.aligns[col] !== align) return undefined;
  }
  return touched.last > touched.first
    ? 'The columns are already aligned this way.'
    : 'The column is already aligned this way.';
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

// Alignment: the delimiter row's colons, for the columns the selection touches.

/** The alignment of the column the caret is in, or null outside a table (a check mark for it). */
export function caretAlign(state: EditorState): Align | null {
  const touched = touchedCols(state);
  if (!touched) return null;
  const found = missingCaret(state)?.cell ?? shownCellAt(state, state.selection.main.head)?.cell;
  const col = found?.col ?? touched.first;
  return touched.table.aligns[col] ?? null;
}

/**
 * Aligns the columns the selection touches (format §3.7): the delimiter row as it says with Track
 * Changes off; with it on, the format's tracked change, one mark at the end of the header's last
 * cell that keeps the old row. Either way it is one step to undo. The selection stays where it is,
 * and a caret at the end of the last header cell stays in front of the mark. A refusal is the
 * format's, told in its words, with nothing written; columns that have the alignment already are
 * no change and no refusal.
 */
export function alignCols(view: EditorView, align: Align): boolean {
  const touched = touchedCols(view.state);
  if (!touched) return false;
  const cols = Array.from(
    { length: touched.last - touched.first + 1 },
    (_, i) => touched.first + i,
  );
  // The alignment the columns have already: the menu's check mark says so, and nothing is written.
  if (cols.every((col) => touched.table.aligns[col] === align)) return true;
  return perform(
    view,
    { kind: 'align', table: touched.table.from, cols, align },
    'table.align.col',
    // The default mapping: text written where a caret stands goes after it, so a caret at the end of
    // the last header cell stays in front of the mark.
    (_after, _done, changes) =>
      view.state.selection.map(ChangeSet.of([...changes], view.state.doc.length)),
  );
}
