// Pasting a range over cells (design: tables, "Copy and paste", In). A range (an HTML table, or text
// with tabs) goes over the cells from the caret's rightward and down, as Sheets and Excel do, and
// from the top-left cell of selected cells; the rows it needs that the table lacks are added (Stage
// 1's insertion, one row each), and so are the columns, added at the table's right. One value onto
// selected cells fills every one of them.
//
// With Track Changes on each overwritten cell is a substitution (an insertion in an empty one), the
// added columns and rows are inserted columns and rows, and the whole paste is one group and one step
// to undo. The paste is worked out on the text: the columns' insertion first, then the rows', with the
// new rows' cells written in them (text in your own new row or column is part of its insertion), then
// the edits to the cells that were there, by the same rules as typing there; they are composed into one
// change.

import { isolateHistory } from '@codemirror/commands';
import { ChangeSet, EditorSelection, type EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import {
  applyChanges,
  EditError,
  idsIn,
  newId,
  parse,
  readRowCells,
  type TextChange,
} from '@redlines/format';
import {
  markupViewFacet,
  setViewModeEffect,
  trackedEditAnnotation,
  viewModeField,
} from '../tracked/field.ts';
import {
  authoredChanges,
  editSourceFacet,
  refusedEditEffect,
  trackingField,
} from '../tracked/typing.ts';
import { cellOfRef, cellsOfRect, clearedCells, headCell, rectOf } from './cells.ts';
import { type Cell, type Table, tablesField } from './model.ts';
import { planned } from './ops.ts';

/** Fills the cells of the rows that an insertion writes with the values of `range`, from row `first`
 * of the range on. */
function fillRows(
  insert: string,
  range: readonly (readonly string[])[],
  first: number,
  col: number,
) {
  const lines = insert.split(/(?<=\n)/);
  let row = first;
  return lines
    .map((piece) => {
      const eol = /\r?\n$/.exec(piece)?.[0] ?? '';
      const line = piece.slice(0, piece.length - eol.length);
      if (!line.startsWith('|')) return piece;
      const values = range[row++] ?? [];
      const cells = readRowCells(line, 0, line.length).cells;
      let out = line;
      for (let j = values.length - 1; j >= 0; j--) {
        const cell = cells[col + j];
        const value = values[j];
        if (!cell || !value) continue;
        // Spaces between the value and the pipes, where the row has none there.
        const before = line[cell.textFrom - 1] === ' ' ? '' : ' ';
        const after = line[cell.textFrom] === ' ' ? '' : ' ';
        out = out.slice(0, cell.textFrom) + before + value + after + out.slice(cell.textFrom);
      }
      return out + eol;
    })
    .join('');
}

/** The cell of a row at a column, if the row has it. */
const cellAtCol = (table: Table, row: Table['rows'][number], col: number): Cell | undefined =>
  row.cells.find((cell) => cell.col === col && cell.col < table.columns);

function refuse(view: EditorView, message: string): true {
  view.dispatch({ effects: refusedEditEffect.of(message) });
  return true;
}

/** What a paste is: the table, the edits to its cells, the rows to add, and what ends up selected. */
interface Plan {
  table: Table;
  edits: TextChange[];
  /** Rows to add below the table's last. */
  extra: number;
  /** Columns to add right of the table's last. */
  extraCols?: number;
  /** The first and last cell pasted, by row and column. */
  corners: [[number, number], [number, number]];
  /** The range, for the cells of the rows to add. */
  range: readonly (readonly string[])[];
  /** The row of the table that range[0] is pasted in. */
  top: number;
  left: number;
}

/**
 * Pastes `range`, the cells as the Markdown each is written in, over the cells from the caret's or
 * the selected cells' top left. False where there is no cell to paste into (the caller pastes it as
 * it would outside a table); true when it pasted or said why it could not.
 */
export function pasteRange(view: EditorView, range: readonly (readonly string[])[]): boolean {
  const { state } = view;
  if (state.field(viewModeField, false) === 'raw' || range.length === 0) return false;
  const rect = rectOf(state);
  const head = rect ? null : headCell(state);
  const table = rect?.table ?? head?.table;
  if (!table) return false;
  const edits: TextChange[] = [];
  const height = range.length;
  const width = Math.max(1, ...range.map((row) => row.length));

  // One value, onto selected cells: every one of them.
  if (rect && height === 1 && width === 1) {
    const value = range[0]?.[0] ?? '';
    for (const cell of cellsOfRect(rect)) {
      if (state.sliceDoc(cell.textFrom, cell.textTo) !== value) {
        edits.push({ from: cell.textFrom, to: cell.textTo, insert: value });
      }
    }
    return write(view, {
      table,
      edits,
      extra: 0,
      corners: [
        [rect.rows[0], rect.cols[0]],
        [rect.rows[1], rect.cols[1]],
      ],
      range,
      top: rect.rows[0],
      left: rect.cols[0],
    });
  }

  const top = rect ? rect.rows[0] : head!.row.index;
  const left = rect ? rect.cols[0] : head!.cell.col;
  const extraCols = Math.max(0, left + width - table.columns);
  for (let i = 0; i < height && top + i < table.rows.length; i++) {
    const row = table.rows[top + i]!;
    for (let j = 0; j < (range[i]?.length ?? 0); j++) {
      // The cells of the columns to be added are written once they are there.
      if (left + j >= table.columns) {
        if (row.cells.length < table.columns) {
          return refuse(
            view,
            `Row ${top + i} has fewer cells than the table. Write the cells it lacks first.`,
          );
        }
        continue;
      }
      const cell = cellAtCol(table, row, left + j);
      if (!cell) {
        return refuse(
          view,
          `Row ${top + i} has fewer cells than the table. Write the cells it lacks first.`,
        );
      }
      const value = range[i]![j]!;
      if (state.sliceDoc(cell.textFrom, cell.textTo) !== value) {
        edits.push({ from: cell.textFrom, to: cell.textTo, insert: value });
      }
    }
  }
  return write(view, {
    table,
    edits,
    extra: Math.max(0, top + height - table.rows.length),
    extraCols,
    corners: [
      [top, left],
      [top + height - 1, left + width - 1],
    ],
    range,
    top,
    left,
  });
}

function write(view: EditorView, plan: Plan): boolean {
  const { state } = view;
  const { table, extra } = plan;
  const extraCols = plan.extraCols ?? 0;
  let edits = plan.edits;
  const text0 = state.doc.toString();
  let rows: ChangeSet = ChangeSet.empty(text0.length);
  let text1 = text0;
  let group: string | undefined;
  const tracked = state.field(trackingField);
  if (extra > 0 || extraCols > 0) {
    // The columns, the rows and the cell edits are one change, so they share one group, even for one.
    group =
      tracked && extra + extraCols + edits.length > 1
        ? newId(idsIn(text0), editRandom(state))
        : undefined;
  }
  if (extraCols > 0) {
    const insertion = planned(
      view,
      { kind: 'insertCols', table: table.from, after: table.columns, count: extraCols },
      group,
    );
    if ('refusal' in insertion) return refuse(view, insertion.refusal);
    rows = ChangeSet.of(
      insertion.changes.map(({ from, to, insert }) => ({ from, to, insert })),
      text0.length,
    );
    text1 = applyChanges(text0, insertion.changes);
    // The edits to the cells that were there, where the columns' insertion leaves them: in front of
    // what it writes at the end of a row.
    edits = edits.map((edit) => ({
      ...edit,
      from: rows.mapPos(edit.from, -1),
      to: rows.mapPos(edit.to, -1),
    }));
  }
  if (extra > 0) {
    const insertion = planned(
      view,
      { kind: 'insertRows', table: table.from, after: table.rows.length - 1, count: extra },
      group,
      text1,
    );
    if ('refusal' in insertion) return refuse(view, insertion.refusal);
    // The new rows hold the values they are pasted: text in your own new row is its insertion.
    const first = table.rows.length - plan.top;
    let filled = false;
    const changes = insertion.changes.map((change) => {
      if (!/^\r?\n\|/.test(change.insert) || change.from !== change.to) return change;
      filled = true;
      return { ...change, insert: fillRows(change.insert, plan.range, first, plan.left) };
    });
    // Values are never dropped: if the rows are not where they are expected, the paste is refused.
    if (!filled) return refuse(view, "Redlines can't add the rows this paste needs to this table.");
    const step = ChangeSet.of(
      changes.map(({ from, to, insert }) => ({ from, to, insert })),
      text1.length,
    );
    rows = rows.compose(step);
    text1 = applyChanges(text1, changes);
  }
  // The values of the columns added to rows that were there are written in their new cells.
  if (extraCols > 0) {
    for (let i = 0; i < plan.range.length && plan.top + i < table.rows.length; i++) {
      const row = table.rows[plan.top + i]!;
      const start = rows.mapPos(row.from, 1);
      const line = text1
        .slice(start, text1.indexOf('\n', start) === -1 ? undefined : text1.indexOf('\n', start))
        .replace(/\r$/, '');
      const cells = readRowCells(line, 0, line.length).cells;
      for (let j = 0; j < (plan.range[i]?.length ?? 0); j++) {
        if (plan.left + j < table.columns) continue;
        const cell = cells[plan.left + j];
        const value = plan.range[i]![j]!;
        if (cell && value !== '') {
          edits.push({ from: start + cell.textFrom, to: start + cell.textTo, insert: value });
        }
      }
    }
  }
  let cells = ChangeSet.empty(text1.length);
  if (edits.length) {
    try {
      cells = authoredChanges(state, text1, parse(text1), edits, group);
    } catch (error) {
      if (error instanceof EditError) return refuse(view, error.message);
      throw error;
    }
  }
  const total = rows.compose(cells);
  if (total.empty) return true;
  view.dispatch({
    changes: total,
    userEvent: 'input.paste',
    annotations: [trackedEditAnnotation.of(true), clearedCells.of(true), isolateHistory.of('full')],
    // A tracked change made in Clean shows in the markup view, as typing's do.
    effects:
      tracked && state.field(viewModeField) === 'clean'
        ? [setViewModeEffect.of(state.facet(markupViewFacet))]
        : [],
    scrollIntoView: true,
  });
  // What was pasted stays selected.
  const now = view.state.field(tablesField, false)?.find((t) => t.id === table.id);
  const a = now && cellOfRef(now, { row: plan.corners[0][0], col: plan.corners[0][1] });
  const b = now && cellOfRef(now, { row: plan.corners[1][0], col: plan.corners[1][1] });
  if (a && b && a !== b) {
    view.dispatch({ selection: EditorSelection.single(a.textFrom, b.textTo), userEvent: 'select' });
  }
  return true;
}

/** The random source tracked edits draw ids from. */
const editRandom = (state: EditorState) => state.facet(editSourceFacet).random;
