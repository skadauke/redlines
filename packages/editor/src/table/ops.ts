// What the table keys and the Table menu do to a table's rows (design: tables, "Rows and columns"):
// the format's operations (`table-ops.ts`), dispatched as one step to undo, tracked as the format
// writes them with Track Changes on and plain with it off. The format refuses what it must (a row
// while a column is pending deleted), and the refusal is told to the person.

import { isolateHistory } from '@codemirror/commands';
import { EditorSelection } from '@codemirror/state';
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
import { shownCellAt } from './stops.ts';

/** The format's changes for `op` on the state's text, as Track Changes says; or the refusal. */
export function planned(
  view: EditorView,
  op: TableOp,
  group?: string,
): { changes: TextChange[]; caret: number } | { refusal: string } {
  const { state } = view;
  const text = state.doc.toString();
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
function perform(view: EditorView, op: TableOp): boolean {
  const done = planned(view, op);
  if ('refusal' in done) {
    view.dispatch({ effects: refusedEditEffect.of(done.refusal) });
    return true;
  }
  const tracked = view.state.field(trackingField);
  view.dispatch({
    changes: done.changes,
    selection: EditorSelection.cursor(done.caret),
    userEvent: 'table.insert.row',
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

/** Inserts a row below the caret's row: the table's first body row from the header. False with the
 * caret outside a cell. */
export function insertRowBelow(view: EditorView): boolean {
  const { state } = view;
  if (state.field(viewModeField, false) === 'raw') return false;
  const found = shownCellAt(state, state.selection.main.head);
  const row = found?.table.rows.find((r) => r.cells.includes(found.cell));
  return found && row ? insertRowAfter(view, found.table, row) : false;
}
