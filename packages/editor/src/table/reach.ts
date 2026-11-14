// Selections that reach into a table (design: tables, "Selecting cells" and the Call about them). A
// selection that covers whole tables deletes them as blocks, as block editing deletes any covered
// block. One that ends inside a table clears the text of the cells in the rows it reaches (the table
// keeps its shape), deletes the text outside the table as block editing deletes a selection, and
// never joins across the table. Delete, Backspace, Return and typing all work, Return and typing
// doing the deleting first and then writing where the caret is: in the first cleared cell, or at
// the deletion's start. What this writes is plain edits of the text, as typing is, which the tracked
// layer records: a deletion in each cell, in one group and one step to undo.

import { isolateHistory } from '@codemirror/commands';
import {
  Annotation,
  ChangeSet,
  EditorSelection,
  EditorState,
  Prec,
  type SelectionRange,
  StateField,
  Transaction,
} from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view';
import { planReturn } from '../blocks/edits.ts';
import { applyKeyEdit } from '../blocks/keys.ts';
import { endOf, startOf } from '../blocks/motion.ts';
import { blockAt, neighbours } from '../blocks/structure.ts';
import { viewModeField } from '../tracked/field.ts';
import { editGroupAnnotation } from '../tracked/typing.ts';
import { cellsOfRect, clearedCells, rectOf, rectSpec } from './cells.ts';
import { composeOverCells } from './compose.ts';
import { type Cell, endsAtPipe, type Table, tablesField, tablesOf } from './model.ts';

/** What a selection reaches in the tables of a state. */
export interface Reach {
  /** The tables the selection covers entirely. */
  whole: Table[];
  /** The tables it ends inside: the whole rows it reaches, `[first, last]` by index (the header is
   * 0; a table the selection touches without reaching a cell has `first > last`). */
  partial: { table: Table; rows: [number, number] }[];
  /** The selection minus every table that it ends inside: what lies outside them, to delete as a
   * selection is deleted. */
  outside: { from: number; to: number }[];
}

const shown = (table: Table, cells: readonly Cell[]) =>
  cells.filter((cell) => cell.col < table.columns);

/** Whether the selection reaches a cell: it overlaps the cell's text, or includes an empty cell's
 * stop. */
function reaches(cell: Cell, from: number, to: number): boolean {
  if (cell.textFrom === cell.textTo) {
    return (
      from <= cell.textFrom && cell.textFrom <= to && (from < cell.textFrom || to > cell.textFrom)
    );
  }
  return from < cell.textTo && to > cell.textFrom;
}

/** What `range` reaches, or null when it reaches no table, sits inside one cell, or is a rectangle
 * of cells (`rectOf`, which has both its ends in one table). */
export function reachOf(state: EditorState, range: SelectionRange): Reach | null {
  if (range.empty || rectOf(state, range)) return null;
  const { from, to } = range;
  const touched = tablesOf(state).filter((table) => from < table.to && to > table.from);
  if (touched.length === 0) return null;
  const only = touched.length === 1 ? touched[0] : undefined;
  if (only) {
    // Inside one cell: the text's own.
    const cell = only.rows
      .flatMap((row) => shown(only, row.cells))
      .find((c) => c.textFrom <= from && to <= c.textTo);
    if (cell) return null;
  }
  const whole: Table[] = [];
  const partial: Reach['partial'] = [];
  for (const table of touched) {
    if (from <= table.from && to >= table.to) {
      whole.push(table);
      continue;
    }
    const rows = table.rows.filter((row) =>
      shown(table, row.cells).some((c) => reaches(c, from, to)),
    );
    const a = rows[0]?.index ?? 1;
    const b = rows.at(-1)?.index ?? 0;
    partial.push({ table, rows: [a, b] });
  }
  return {
    whole,
    partial,
    outside: outsideOf(
      state,
      range,
      partial.map((p) => p.table),
    ),
  };
}

/** The selection's text outside the tables it ends inside: the tail of the block above the first,
 * the blocks between two, the head of the block below the last. Never the line break next to a
 * table, so that nothing joins across it. */
function outsideOf(state: EditorState, range: SelectionRange, tables: Table[]) {
  const pieces: { from: number; to: number }[] = [];
  tables.forEach((table, n) => {
    const block = blockAt(state, table.from);
    if (!block) return;
    const { prev, next } = neighbours(state, block);
    if (n === 0 && range.from < table.from && prev) {
      const end = endOf(state, prev);
      if (range.from < end) pieces.push({ from: range.from, to: end });
    }
    const other = tables[n + 1];
    if (other) {
      // The blocks between two tables go whole, from their first line to the next table's.
      if (next && next.lines.from < other.from) {
        pieces.push({ from: state.doc.lineAt(next.lines.from).from, to: other.from });
      }
    } else if (next && range.to > table.to) {
      const start = startOf(state, next);
      if (start < range.to) pieces.push({ from: start, to: range.to });
    }
  });
  return pieces;
}

/** What deleting `range` does, in plain edits of the state's text, and where the caret goes (the
 * start text's offsets); with `insert`, what is written there. */
export function reachChanges(
  state: EditorState,
  range: SelectionRange,
  insert = '',
): {
  changes: { from: number; to: number; insert?: string }[];
  caret: number;
  inCell: boolean;
} | null {
  const reach = reachOf(state, range);
  if (!reach || reach.partial.length === 0) return null;
  const changes: { from: number; to: number; insert?: string }[] = [];
  for (const { table, rows } of reach.partial) {
    for (const row of table.rows.slice(rows[0], rows[1] + 1)) {
      for (const cell of shown(table, row.cells)) {
        if (cell.textFrom < cell.textTo) changes.push({ from: cell.textFrom, to: cell.textTo });
      }
    }
  }
  for (const piece of reach.outside) changes.push(piece);
  // The caret: the deletion's start, or the cell that the selection starts in.
  let caret = range.from;
  const start = reach.partial.find((p) => p.table.from <= range.from && range.from <= p.table.to);
  if (start) {
    const lastCell = start.table.rows.at(-1)?.cells.at(-1);
    const cell = start.table.rows
      .flatMap((row) => shown(start.table, row.cells).map((c) => ({ c, row })))
      .find(
        ({ c, row }) =>
          c.from <= range.from &&
          (range.from < c.to ||
            c === lastCell ||
            // Where the next cell's mark begins is this cell's when its text ends there (`holds`): the
            // selection starts in an empty cell with one space of padding or none, or at the end of text
            // with none after it.
            (range.from === c.to && endsAtPipe(c) && c !== row.cells.at(-1))),
      )?.c;
    caret = cell ? cell.textFrom : range.from;
  }
  if (insert !== '') {
    const at = changes.find((change) => change.from === caret);
    if (at) at.insert = insert;
    else changes.push({ from: caret, to: caret, insert });
  }
  changes.sort((a, b) => a.from - b.from || a.to - b.to);
  return { changes, caret, inCell: start !== undefined };
}

/** Marks what `deleteReach` has made, so that the filter that routes typing leaves it be. */
const reached = Annotation.define<boolean>();

/** The transaction that deletes (and writes) what `range` reaches. */
function reachSpec(
  state: EditorState,
  range: SelectionRange,
  insert: string,
  userEvent: string,
  lineBreak = false,
): { spec: Parameters<EditorView['dispatch']>[0]; inCell: boolean } | null {
  // Return writes a line break where the caret lands, in a cell.
  const first = lineBreak ? reachChanges(state, range) : null;
  const written = first?.inCell ? '<br>' : insert;
  const plan = reachChanges(state, range, written);
  if (!plan) return null;
  const changes = ChangeSet.of(plan.changes, state.doc.length);
  // After what is written, where there is something, else where the deletion left the caret.
  const caret =
    changes.mapPos(plan.caret, -1) + (plan.inCell || insert !== '' ? written.length : 0);
  return {
    inCell: plan.inCell,
    spec: {
      changes,
      selection: EditorSelection.cursor(caret),
      userEvent,
      annotations: [reached.of(true), editGroupAnnotation.of(true), isolateHistory.of('before')],
      scrollIntoView: true,
    },
  };
}

/**
 * Deletes what the selection reaches into a table, one step to undo; with `then`, the Return or the
 * text that went with it is written after, at the caret. False when the selection reaches no table
 * partly (whole tables are block editing's, as any covered block is).
 */
export function deleteReach(view: EditorView, then?: 'return' | { typed: string }): boolean {
  const { state } = view;
  if (state.field(viewModeField, false) === 'raw' || state.selection.ranges.length > 1)
    return false;
  const typed = then && then !== 'return' ? then.typed : '';
  const planned = reachSpec(
    state,
    state.selection.main,
    typed,
    typed ? 'input.type' : 'delete.selection',
    then === 'return',
  );
  if (!planned) return false;
  const before = state.doc;
  view.dispatch(planned.spec);
  if (then === 'return' && !planned.inCell && !view.state.doc.eq(before)) {
    // A Return in a paragraph, in the step of the deletion that it follows.
    const edit = planReturn(view.state);
    if (edit) {
      applyKeyEdit(view, { ...edit, userEvent: 'delete.selection', join: true, record: true });
    }
  }
  return true;
}

/** Typing, pasting and deleting over a selection that reaches into a table: the same as deleting it
 * and writing there. */
const routeEdits = Prec.lowest(
  EditorState.transactionFilter.of((tr: Transaction) => {
    const start = tr.startState;
    if (!tr.docChanged || tr.annotation(reached) || tr.annotation(clearedCells)) return tr;
    if (start.field(viewModeField, false) === 'raw' || start.selection.ranges.length > 1) return tr;
    const event = ['input', 'delete'].find((e) => tr.isUserEvent(e));
    const range = start.selection.main;
    if (!event || range.empty || tr.isUserEvent('input.type.compose')) return tr;
    if (!(start.field(tablesField, false) ?? []).length) return tr;
    // One change that replaces the selection: what typing, pasting and the delete keys make of it.
    let only: { from: number; to: number; insert: string } | null = null;
    let count = 0;
    tr.changes.iterChanges((from, to, _fromB, _toB, inserted) => {
      count++;
      only = { from, to, insert: inserted.toString() };
    });
    const change = only as { from: number; to: number; insert: string } | null;
    if (count !== 1 || !change || change.from !== range.from || change.to !== range.to) return tr;
    // Cells selected: their text goes, and what is written is written in the first.
    const rect = rectOf(start, range);
    if (rect) {
      const spec = rectSpec(
        start,
        rect,
        change.insert,
        tr.annotation(Transaction.userEvent) ?? event,
      );
      return spec ? [spec] : [{}];
    }
    const planned = reachSpec(
      start,
      range,
      change.insert,
      tr.annotation(Transaction.userEvent) ?? event,
    );
    return planned ? [planned.spec] : tr;
  }),
);

/** The decorations of the cells that a selection reaches: `.rl-sel` on each, a block that fills the
 * cell with the system's selection color. */
function selectedCells(state: EditorState): DecorationSet {
  if (state.field(viewModeField, false) === 'raw') return Decoration.none;
  const range = state.selection.main;
  if (state.selection.ranges.length > 1 || range.empty) return Decoration.none;
  const marks: ReturnType<ReturnType<typeof Decoration.mark>['range']>[] = [];
  const mark = (table: Table, cells: readonly Cell[]) => {
    for (const cell of shown(table, cells)) {
      if (cell.to <= cell.from) continue;
      marks.push(
        Decoration.mark({ class: 'rl-sel', attributes: { 'data-col': String(cell.col) } }).range(
          cell.from,
          cell.to,
        ),
      );
    }
  };
  const rect = rectOf(state, range);
  if (rect) {
    mark(rect.table, cellsOfRect(rect));
    return Decoration.set(marks, true);
  }
  const reach = reachOf(state, range);
  if (!reach) return Decoration.none;
  for (const table of reach.whole) for (const row of table.rows) mark(table, row.cells);
  for (const { table, rows } of reach.partial) {
    for (const row of table.rows.slice(rows[0], rows[1] + 1)) mark(table, row.cells);
  }
  return Decoration.set(marks, true);
}

const selectedField = StateField.define<DecorationSet>({
  create: selectedCells,
  update(value, tr) {
    return tr.selection ||
      tr.docChanged ||
      tr.startState.field(viewModeField, false) !== tr.state.field(viewModeField, false)
      ? selectedCells(tr.state)
      : value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** The keys and the filter that act on selections reaching into a table, and their drawing. */
export function tableReach() {
  return [selectedField, routeEdits, composeOverCells];
}
