// The caret's stops in a table (design: tables, "The caret's stops"). The caret steps over one atom
// from the end of a cell's text to the start of the next cell's text, across the padding, the pipes,
// the line breaks and the delimiter row, so that → at the end of a cell lands at the start of the next
// in one step, and at the end of a row, at the start of the next row. A cell's stops are its text's
// start and end; an empty cell has the one. The first atom reaches back over the line break before the
// table, and the last over the one after it, joining the atoms of the blank lines around.
//
// The one other stop is the end of a row that has fewer cells than the header, past its last cell's text:
// the cells it lacks are drawn as cells, and stand there (`missing.ts`), for a caret only; a selection
// never ends in one, which has no text to select.
//
// No other place in a table's lines is a stop: text typed before a row's first pipe would add a cell
// to the header and unmake the table, and text after its last pipe is a cell GFM doesn't show. A caret
// or a selection's end that lands there anyway (Find, Undo, an agent's edit, a reload) moves to the
// nearest stop of the nearest cell, and an edit that would put text there is refused, a guard that
// should never fire. A selection whose two ends are in two cells of one table is a rectangle of cells
// (`cells.ts`).

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
import { cellEscapes } from './escape.ts';
import { type Dirty, type DirtyTable, dirtyOf, type Span } from './dirty.ts';
import { type Cell, type Row, type Table, cellAt, tablesField } from './model.ts';
import { isMissingStop, missingField } from './missing.ts';

export const TEXT_IN_CELLS = "A table's text goes in its cells.";

/** A stretch of a table the caret steps over. */
class StopAtom extends RangeValue {
  override eq(other: RangeValue): boolean {
    return other instanceof StopAtom;
  }
}

const ATOM = new StopAtom();

/** A `<br>` in a cell's text, as the layout draws it: `<br>`, `<br/>` or `<br />`. */
export const BR = /<br\s*\/?>/gi;

/** The line breaks of a cell's text, as ranges of the document. */
function breaksIn(state: EditorState, cell: Cell): { from: number; to: number }[] {
  if (cell.textTo - cell.textFrom < 4) return [];
  const text = state.sliceDoc(cell.textFrom, cell.textTo);
  return [...text.matchAll(BR)].map((found) => ({
    from: cell.textFrom + found.index,
    to: cell.textFrom + found.index + found[0].length,
  }));
}

/** The cells of a row that GFM shows. */
const shownOf = (table: Table, row: Row): Cell[] =>
  row.cells.filter((cell) => cell.col < table.columns);

/**
 * The atoms of a table that its rows own, by where they start: the one in front of the first cell
 * (the first row's), the stretch from a cell's end to the next cell's text (the row of the first of
 * the two), the one after the last cell (the last row's) and the line breaks in its cells. Every row
 * of the table when `rows` is null. The work is that of the rows asked for.
 */
function atomsOf(state: EditorState, table: Table, rows: readonly Row[] | null): Span[] {
  const spans: Span[] = [];
  let lastRow: Row | undefined;
  for (let i = table.rows.length - 1; i >= 0 && !lastRow; i--) {
    const row = table.rows[i];
    if (row && shownOf(table, row).length > 0) lastRow = row;
  }
  for (const row of rows ?? table.rows) {
    const cells = shownOf(table, row);
    const first = cells[0];
    const last = cells.at(-1);
    if (!first || !last) continue;
    if (row === table.rows[0])
      spans.push({ from: Math.max(0, table.from - 1), to: first.textFrom });
    for (let i = 1; i < cells.length; i++) {
      const before = cells[i - 1];
      const after = cells[i];
      if (before && after && after.textFrom > before.textTo) {
        spans.push({ from: before.textTo, to: after.textFrom });
      }
    }
    // The end of a row that lacks cells is a stop of its own: the atom from the last cell's text to the
    // next row's is two, with the end of the row between.
    const tail = isMissingStop(table, row, row.to) ? row.to : null;
    const over = (to: number) => {
      if (tail !== null && tail < to)
        spans.push({ from: last.textTo, to: tail }, { from: tail, to });
      else spans.push({ from: last.textTo, to });
    };
    if (row === lastRow) {
      over(Math.min(state.doc.length, table.to + 1));
    } else {
      // Over the end of the row and the start of the next one that has a cell GFM shows.
      for (let k = row.index + 1; k < table.rows.length; k++) {
        const next = table.rows[k] && shownOf(table, table.rows[k]!)[0];
        if (!next) continue;
        if (next.textFrom > last.textTo) over(next.textFrom);
        break;
      }
    }
    // A line break is one atom: the caret never rests inside it.
    for (const cell of cells) spans.push(...breaksIn(state, cell));
  }
  return spans.filter((span) => span.to > span.from);
}

const toAtoms = (spans: readonly Span[]) => spans.map((span) => ATOM.range(span.from, span.to));

/** The atoms of the tables of a state. */
export function stopAtoms(state: EditorState): RangeSet<StopAtom> {
  if (state.field(viewModeField, false) === 'raw') return RangeSet.of<StopAtom>([]);
  const spans = (state.field(tablesField, false) ?? []).flatMap((table) =>
    atomsOf(state, table, null),
  );
  return RangeSet.of(toAtoms(spans), true);
}

/** What a set keeps when the atoms that start in `from`..`to` are taken out. */
const without = (from: number, to: number) => ({
  filter: (a: number) => !(a >= from && a <= to),
  filterFrom: from,
  filterTo: to,
});

/** The atoms after a change in the tables' text, as the layout's sets are patched: mapped, and built
 * again for the rows the change touches and the one before each (its last atom reaches into them). */
function patchAtoms(value: RangeSet<StopAtom>, tr: Transaction, dirty: Dirty): RangeSet<StopAtom> {
  let atoms = value.map(tr.changes);
  for (const span of dirty.gone) atoms = atoms.update(without(span.from - 1, span.to));
  // Taken out first, all of it, then built: see `patchLayout`.
  const wanted = new Map<DirtyTable, Row[]>();
  for (const dirtyTable of dirty.tables) {
    const { table, rows, clear } = dirtyTable;
    if (rows === null) {
      atoms = atoms.update(without(clear.from - 1, clear.to));
      continue;
    }
    const spans = new Map<Row, Span>();
    for (const { row, clear: span } of rows) {
      spans.set(row, span);
      const above = table.rows[row.index - 1];
      if (above && !spans.has(above)) spans.set(above, { from: above.from, to: above.to });
    }
    for (const [row, span] of spans) {
      const from = row.index === 0 ? Math.min(span.from, clear.from - 1) : span.from;
      atoms = atoms.update(without(from, Math.max(span.to, row.to)));
    }
    wanted.set(dirtyTable, [...spans.keys()]);
  }
  for (const dirtyTable of dirty.tables) {
    const { table } = dirtyTable;
    const rows = wanted.get(dirtyTable) ?? null;
    atoms = atoms.update({ add: toAtoms(atomsOf(tr.state, table, rows)), sort: true });
  }
  return atoms;
}

const atomField = StateField.define<RangeSet<StopAtom>>({
  create: stopAtoms,
  update(value, tr) {
    const tables = tr.state.field(tablesField, false);
    const mode = tr.startState.field(viewModeField, false) !== tr.state.field(viewModeField, false);
    if (tr.startState.field(tablesField, false) === tables && !mode) return value;
    if (mode || !tr.docChanged || tr.state.field(viewModeField, false) === 'raw') {
      return stopAtoms(tr.state);
    }
    if (!tables?.length && !tr.startState.field(tablesField, false)?.length) return value;
    const dirty = dirtyOf(tr);
    return dirty ? patchAtoms(value, tr, dirty) : stopAtoms(tr.state);
  },
  provide: (field) => EditorView.atomicRanges.of((view) => view.state.field(field)),
});

/** The atoms a state has, as the field keeps them up to date. */
export const atomsOfState = (state: EditorState): RangeSet<StopAtom> => state.field(atomField);

/** The cell GFM shows among those a lookup found: itself, or the last the row shows when it is one that
 * GFM doesn't. */
function shownIn(found: {
  table: Table;
  row: Row;
  cell: Cell;
}): { table: Table; cell: Cell } | null {
  const { table, row } = found;
  const shown = row.cells.filter((cell) => cell.col < table.columns);
  const cell = found.cell.col < table.columns ? found.cell : shown.at(-1);
  return cell ? { table, cell } : null;
}

/** The cell GFM shows that holds `pos`, or the last it shows in the row when `pos` is in one it
 * doesn't. */
export function shownCellAt(state: EditorState, pos: number): { table: Table; cell: Cell } | null {
  const found = cellAt(state, pos);
  return found ? shownIn(found) : null;
}

/** Whether `pos` is a stop: in the text of a cell, ends included, or the end of a row that lacks cells
 * (a caret's: see `nearestStop`). Positions outside tables are. */
export function isStop(state: EditorState, pos: number): boolean {
  const found = cellAt(state, pos);
  if (!found) return true;
  if (isMissingStop(found.table, found.row, pos)) return true;
  const shown = shownIn(found);
  if (!shown) return true;
  if (pos < shown.cell.textFrom || pos > shown.cell.textTo) return false;
  return !breaksIn(state, shown.cell).some((br) => br.from < pos && pos < br.to);
}

/** `pos` if it is a stop, or the nearest stop of the nearest cell. The end of a row that lacks cells is
 * one for a caret (`caret`, the default), and for a selection's end the end of the last cell's text. */
export function nearestStop(state: EditorState, pos: number, caret = true): number {
  const looked = cellAt(state, pos);
  const found = looked && shownIn(looked);
  if (!looked || !found) return pos;
  if (caret && isMissingStop(looked.table, looked.row, pos)) return pos;
  const inCell = Math.min(Math.max(pos, found.cell.textFrom), found.cell.textTo);
  // Inside a line break, the nearer end of it (the start, when they are as near).
  const br = breaksIn(state, found.cell).find((b) => b.from < inCell && inCell < b.to);
  return br ? (inCell - br.from <= br.to - inCell ? br.from : br.to) : inCell;
}

/**
 * A selection with its ends on stops. A selection that covers a table whole keeps its ends at the
 * table's first and last character (Select All in a document that starts or ends in one): what
 * covers a table goes with it, as a block.
 */
export function onStops(state: EditorState, selection: EditorSelection): EditorSelection {
  let changed = false;
  const tables = state.field(tablesField, false) ?? [];
  const ranges = selection.ranges.map((range): SelectionRange => {
    const lo = Math.min(range.anchor, range.head);
    const hi = Math.max(range.anchor, range.head);
    const edge = (pos: number) =>
      tables.some((t) => (pos === t.from || pos === t.to) && lo <= t.from && hi >= t.to);
    // A caret may be in a cell its row lacks; a selection never ends in one.
    const caret = range.empty;
    const anchor = edge(range.anchor) ? range.anchor : nearestStop(state, range.anchor, caret);
    const head = edge(range.head) ? range.head : nearestStop(state, range.head, caret);
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
      // Text that replaces a whole table is the block's, as a block's replacement is.
      if (found && from <= found.table.from && to >= found.table.to && to > from) return;
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
  return [tablesField, atomField, missingField, cellEscapes, guard, onStopsFilter];
}

/** Whether the selection is in a table's cells, as a view that draws tables shows them: the Paragraph
 * menu's block commands are not for text there. False in Raw, which draws none. */
export function selectionInTable(state: EditorState): boolean {
  if (state.field(viewModeField, false) === 'raw') return false;
  const { head, anchor } = state.selection.main;
  return shownCellAt(state, head) !== null || shownCellAt(state, anchor) !== null;
}

/** Whether the head of the selection is in a cell: where a command that works from the caret (Insert
 * Row Below) has a row to work from, which `selectionInTable` is wider than. False in Raw. */
export function headInTable(state: EditorState): boolean {
  if (state.field(viewModeField, false) === 'raw') return false;
  return shownCellAt(state, state.selection.main.head) !== null;
}
