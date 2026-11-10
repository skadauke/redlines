// The caret's stops in a table (design: tables, "The caret's stops"). The caret steps over one atom
// from the end of a cell's text to the start of the next cell's text, across the padding, the pipes,
// the line breaks and the delimiter row, so that → at the end of a cell lands at the start of the next
// in one step, and at the end of a row, at the start of the next row. A cell's stops are its text's
// start and end; an empty cell has the one. The first atom reaches back over the line break before the
// table, and the last over the one after it, joining the atoms of the blank lines around.
//
// No other place in a table's lines is a stop: text typed before a row's first pipe would add a cell
// to the header and unmake the table, and text after its last pipe is a cell GFM doesn't show. A caret
// or a selection's end that lands there anyway (Find, Undo, an agent's edit, a reload) moves to the
// nearest stop of the nearest cell, and an edit that would put text there is refused, a guard that
// should never fire. Until cells can be selected (Stage 2), a selection whose two ends are in two
// cells of one table is held to the cell of its anchor.

import {
  EditorSelection,
  EditorState,
  Prec,
  RangeSet,
  RangeValue,
  type SelectionRange,
  StateField,
  Transaction,
} from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { trackedEditAnnotation, viewModeField } from '../tracked/field.ts';
import { refusedEditEffect } from '../tracked/typing.ts';
import { type Cell, type Table, cellAt, tablesField } from './model.ts';

export const TEXT_IN_CELLS = "A table's text goes in its cells.";

/** A stretch of a table the caret steps over. */
class StopAtom extends RangeValue {
  override eq(other: RangeValue): boolean {
    return other instanceof StopAtom;
  }
}

const ATOM = new StopAtom();

/** The cells of a table that GFM shows, in order of the document. */
function shownCells(table: Table): Cell[] {
  return table.rows.flatMap((row) => row.cells.filter((cell) => cell.col < table.columns));
}

/** The atoms of the tables of a state. */
export function stopAtoms(state: EditorState): RangeSet<StopAtom> {
  if (state.field(viewModeField, false) === 'raw') return RangeSet.of<StopAtom>([]);
  const spans: { from: number; to: number }[] = [];
  for (const table of state.field(tablesField, false) ?? []) {
    const cells = shownCells(table);
    const first = cells[0];
    const last = cells.at(-1);
    if (!first || !last) continue;
    spans.push({ from: Math.max(0, table.from - 1), to: first.textFrom });
    for (let i = 1; i < cells.length; i++) {
      const before = cells[i - 1];
      const after = cells[i];
      if (before && after && after.textFrom > before.textTo) {
        spans.push({ from: before.textTo, to: after.textFrom });
      }
    }
    spans.push({ from: last.textTo, to: Math.min(state.doc.length, table.to + 1) });
  }
  return RangeSet.of(
    spans.filter((span) => span.to > span.from).map((span) => ATOM.range(span.from, span.to)),
    true,
  );
}

const atomField = StateField.define<RangeSet<StopAtom>>({
  create: stopAtoms,
  update(value, tr) {
    const changed =
      tr.startState.field(tablesField, false) !== tr.state.field(tablesField, false) ||
      tr.startState.field(viewModeField, false) !== tr.state.field(viewModeField, false);
    return changed ? stopAtoms(tr.state) : value;
  },
  provide: (field) => EditorView.atomicRanges.of((view) => view.state.field(field)),
});

/** The cell GFM shows that holds `pos`, or the last it shows in the row when `pos` is in one it
 * doesn't. */
export function shownCellAt(state: EditorState, pos: number): { table: Table; cell: Cell } | null {
  const found = cellAt(state, pos);
  if (!found) return null;
  const { table, row } = found;
  const shown = row.cells.filter((cell) => cell.col < table.columns);
  const cell = found.cell.col < table.columns ? found.cell : shown.at(-1);
  return cell ? { table, cell } : null;
}

/** Whether `pos` is a stop: in the text of a cell, ends included. Positions outside tables are. */
export function isStop(state: EditorState, pos: number): boolean {
  const found = shownCellAt(state, pos);
  return !found || (found.cell.textFrom <= pos && pos <= found.cell.textTo);
}

/** `pos` if it is a stop, or the nearest stop of the nearest cell. */
export function nearestStop(state: EditorState, pos: number): number {
  const found = shownCellAt(state, pos);
  if (!found) return pos;
  return Math.min(Math.max(pos, found.cell.textFrom), found.cell.textTo);
}

/** A selection with its ends on stops, and held to its anchor's cell when both ends are in one
 * table, in two cells. */
export function onStops(state: EditorState, selection: EditorSelection): EditorSelection {
  let changed = false;
  const ranges = selection.ranges.map((range): SelectionRange => {
    const anchor = nearestStop(state, range.anchor);
    let head = nearestStop(state, range.head);
    const a = shownCellAt(state, anchor);
    const h = shownCellAt(state, head);
    if (a && h && a.table === h.table && a.cell !== h.cell) {
      head = head > anchor ? a.cell.textTo : a.cell.textFrom;
    }
    if (anchor === range.anchor && head === range.head) return range;
    changed = true;
    return EditorSelection.range(anchor, head, range.goalColumn);
  });
  return changed ? EditorSelection.create(ranges, selection.mainIndex) : selection;
}

/** Whether a transaction is something a person does to the text, and no structural edit. */
const isTyping = (tr: Transaction) =>
  ['input', 'delete', 'move'].some((event) => tr.isUserEvent(event)) &&
  !tr.annotation(trackedEditAnnotation) &&
  !tr.annotation(Transaction.remote);

/** The guard: text that a person types goes in a cell. It runs before the tracked layer turns the
 * typing into an edit of its own (a transaction filter that is registered last runs first). */
const guard = Prec.lowest(
  EditorState.transactionFilter.of((tr) => {
    const start = tr.startState;
    if (!tr.docChanged || !isTyping(tr) || start.field(viewModeField, false) === 'raw') return tr;
    if (!(start.field(tablesField, false) ?? []).length) return tr;
    let outside = false;
    tr.changes.iterChanges((from, to, _fromB, _toB, inserted) => {
      if (outside || inserted.length === 0 || inserted.toString().includes('\n')) return;
      const found = shownCellAt(start, from);
      if (found && !(found.cell.textFrom <= from && to <= found.cell.textTo)) outside = true;
    });
    return outside ? { effects: refusedEditEffect.of(TEXT_IN_CELLS) } : tr;
  }),
);

/** The selection's ends on stops, after everything else has had its say. */
const onStopsFilter = Prec.high(
  EditorState.transactionFilter.of((tr) => {
    if (tr.startState.field(viewModeField, false) === 'raw') return tr;
    if (!tr.selection && !tr.docChanged) return tr;
    const next = tr.state;
    if (!(next.field(tablesField, false) ?? []).length) return tr;
    const selection = onStops(next, next.selection);
    return selection === next.selection ? tr : [tr, { selection, sequential: true }];
  }),
);

/** The caret's stops in tables, and what keeps it on them. */
export function tableStops() {
  return [tablesField, atomField, guard, onStopsFilter];
}
