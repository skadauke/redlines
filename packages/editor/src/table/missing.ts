// The cells a row lacks (design: tables, "Edge cases"). GFM reads a row with fewer cells than the
// header as having blank cells after its last, and the table draws them as cells (the layout's
// fillers) with a stop for the caret. The file has no text for them, so they stand in no place of their
// own: every cell a row lacks is at the end of the row, and the caret's position can't say which of
// them it is in. This file says: a field holds the column the caret was put in (by Tab, an arrow or a
// press), and the first of them is the caret's cell when none was. Nothing is written until text is
// typed there (`fill.ts`), which writes the pipes it needs first (format §3.7, "A cell a row lacks").
//
// The virtual cells are read from the table model, which has each row's cells as written: the cells a
// row lacks are those from its last to the header's width. They are never kept in it, so no code that
// reads a row's cells can take one for a cell with text to edit.

import {
  EditorSelection,
  type EditorState,
  StateEffect,
  StateField,
  type TransactionSpec,
} from '@codemirror/state';
import { viewModeField } from '../tracked/field.ts';
import { type Cell, type Row, type Table, cellAt, tablesField } from './model.ts';

/** The caret is in the cell of column `col` that the row ending at `at` lacks. */
export interface MissingAt {
  at: number;
  col: number;
}

/** Puts the caret, which is at the end of a row, in the cell of that row that is column `col`. */
export const setMissing = StateEffect.define<MissingAt>();

/** The column of the cell the caret is in, when it is not the first the row lacks. It holds until the
 * selection or the text changes, which no longer mean the cell it was put in. */
export const missingField = StateField.define<MissingAt | null>({
  create: () => null,
  update(value, tr) {
    const set = tr.effects.findLast((effect) => effect.is(setMissing));
    if (set) return set.value;
    return tr.selection || tr.docChanged ? null : value;
  },
});

/** The cell of a row that is column `col`, which the row lacks: empty, at the end of the row. */
export function virtualCell(row: Row, col: number): Cell {
  return { from: row.to, to: row.to, textFrom: row.to, textTo: row.to, col, missing: true };
}

/** The cells of `row` that it lacks, from its last to the header's width; none for the header. */
export function missingCells(table: Table, row: Row): Cell[] {
  const cells: Cell[] = [];
  if (row.header) return cells;
  for (let col = row.cells.length; col < table.columns; col++) cells.push(virtualCell(row, col));
  return cells;
}

/** Whether `pos` is where the cells of `row` that it lacks stand: the end of a body row with fewer
 * cells than the header, past its last cell's text (a position that is the end of that text, in a row
 * that ends there, is the cell's own). */
export function isMissingStop(table: Table, row: Row, pos: number): boolean {
  if (row.header || pos !== row.to || row.cells.length >= table.columns) return false;
  const last = row.cells.at(-1);
  return last !== undefined && pos > last.textTo;
}

/** The cell a row lacks that the caret is in, with its table and row; null where it is in none. */
export interface MissingCaret {
  table: Table;
  row: Row;
  cell: Cell;
}

/**
 * The cell the caret is in, when it is in one its row lacks: an empty selection at the end of a body row
 * that has fewer cells than the header, in the column the field says, or in the first the row lacks
 * where the caret is past the text of the row's last cell (a caret that Undo, a key or a press put at the
 * end of the row). Null in Raw, which draws no cells.
 */
export function missingCaret(state: EditorState): MissingCaret | null {
  if (state.field(viewModeField, false) === 'raw') return null;
  const { selection } = state;
  const { head } = selection.main;
  if (selection.ranges.length !== 1 || !selection.main.empty) return null;
  // Cheaply first: a caret in the middle of a line is in no cell a row lacks.
  if (state.doc.lineAt(head).to !== head || !state.field(tablesField, false)?.length) return null;
  const found = cellAt(state, head);
  if (!found || found.row.header || found.row.to !== head) return null;
  const { table, row } = found;
  const have = row.cells.length;
  if (have === 0 || have >= table.columns) return null;
  const set = state.field(missingField, false);
  if (set && set.at === head && set.col >= have && set.col < table.columns) {
    return { table, row, cell: virtualCell(row, set.col) };
  }
  const last = row.cells[have - 1];
  return last && head > last.textTo ? { table, row, cell: virtualCell(row, have) } : null;
}

/** What puts the caret in `cell`, a cell its row lacks: the selection at the end of the row, and the
 * column. */
export function missingSpec(cell: Cell, userEvent = 'select'): TransactionSpec {
  return {
    selection: EditorSelection.cursor(cell.textFrom),
    effects: setMissing.of({ at: cell.textFrom, col: cell.col }),
    userEvent,
    scrollIntoView: true,
  };
}
