// A table operation that its rules refuse, written as a replacement of the table (format §3.12,
// lane R2): the operation is made on the table as the newest view reads it, which is what the same
// operation with Track Changes off writes there, and the edit that makes is written by `widen`.
// Other people's pending changes in the table stay in the old text of the replacement.
//
// `tableEdit` tries it when a table operation can't be written finely, and `trackedFormat` when a
// format change in a table's cell can't (`widenedCellFormat`).

import { applyChanges } from './changes.ts';
import { changesBetween } from './edit-support.ts';
import { EditError } from './errors.ts';
import { untrackedFormat } from './formatting.ts';
import type { FormatOp } from './formatting.ts';
import { parse } from './parse.ts';
import { readLine, tablesOfText } from './table.ts';
import { untrackedTableEdit } from './table-ops.ts';
import type { TableEdit, TableOp } from './table-ops.ts';
import type { TrackedEdits } from './track.ts';
import type { EditContext, Range, TextChange } from './types.ts';
import { newestView } from './views.ts';
import { scopeOf, widensHere } from './widen-scope.ts';
import { Untrackable, widen } from './widen.ts';

/**
 * The operation as a replacement of the table.
 *
 * @throws Untrackable when no unit holds it; EditError when the operation has no meaning on the
 *   table (an index outside it, the last row or column).
 */
export function widenedTableEdit(text: string, op: TableOp, ctx: EditContext): TableEdit {
  const view = newestView(text);
  const plain = untrackedTableEdit(view.text, { ...op, table: view.map.fromSource(op.table) });
  const made = changesBetween(view.text, applyChanges(view.text, plain.changes));
  const edits = op.kind === 'deleteTable' ? withTheLineAbove(view.text, made) : made;
  const done = widen(text, edits, ctx);
  const after = newestView(done.text);
  return { ...plain, changes: done.changes, caret: after.map.toSource(plain.caret, 1) };
}

/**
 * The deletion of a table that stands right under a line of text (a paragraph, a heading) as the
 * deletion of the break in front of it and the table, but not of the break after it: the edit then
 * lies in the block above and the table together, which is the unit that holds it (`widen` takes
 * the paragraph, or the heading, with the table), where the table's own unit would hold nothing.
 */
function withTheLineAbove(view: string, edits: readonly TextChange[]): TextChange[] {
  return edits.map((edit) => {
    const text = view.slice(edit.from, edit.to);
    if (edit.insert !== '' || !text.endsWith('\n') || view[edit.from - 1] !== '\n') return edit;
    const above =
      view
        .slice(0, edit.from - 1)
        .split('\n')
        .at(-1) ?? '';
    if (above.trim() === '') return edit;
    return { ...edit, from: edit.from - 1, to: edit.to - 1 };
  });
}

/** Whether `range` is in the text of one cell of a table, in a row with a leading pipe or without
 * one: the table is replaced whole, so the row's start has no marker to hold. */
function inCell(text: string, parsed: ReturnType<typeof parse>, range: Range): boolean {
  const table = tablesOfText(text, parsed).find(
    (one) => one.from <= range.from && range.to <= one.to,
  );
  const row = table?.rows.find((one) => one.from <= range.from && range.to <= one.to);
  if (!row) return false;
  const line = readLine(text, row.from, row.to);
  return line.cells.some((cell) => cell.contentFrom <= range.from && range.to <= cell.contentTo);
}

/** The codes of the refusals that a replacement of the table sets right. */
const WIDENABLE_CELL: readonly string[] = ['no-legal-placement', 'would-hide-marks', 'inside-code'];

/**
 * A format change in the cells of a table that `trackedFormat` refused (`first`: another person's
 * change is in the cell, a row they inserted holds it, no place for the mark), written as a
 * replacement of the table: the format made on the table as the newest view reads it, as Track
 * Changes off would make it, and the edit that makes written by `widen`. Their pending changes stay
 * in the old text of the replacement.
 *
 * @throws `first` when a range is not in a cell, or no unit holds the change.
 */
export function widenedCellFormat(
  text: string,
  ranges: readonly Range[],
  op: FormatOp,
  ctx: EditContext,
  first: unknown,
): TrackedEdits {
  if (!(first instanceof EditError) || !WIDENABLE_CELL.includes(first.code ?? 'markup')) {
    throw first;
  }
  const parsed = parse(text);
  // A cell of a table is the table's lane (R2), a list is the list's (R3).
  const inLane = (range: Range) =>
    scopeOf(text, range.from, range.to) === 'cell'
      ? inCell(text, parsed, range)
      : widensHere(text, range.from, range.to);
  if (ranges.some((range) => !inLane(range))) throw first;
  try {
    const view = newestView(text);
    const edits = ranges.flatMap((range) =>
      untrackedFormat(
        view.text,
        { from: view.map.fromSource(range.from), to: view.map.fromSource(range.to) },
        op,
      ),
    );
    if (edits.length === 0) throw first;
    const done = widen(text, edits, ctx);
    // Outside a table's cells, others' pending marks in the old text keep the refusal (#808).
    if (
      done.heldByOthers.length > 0 &&
      ranges.some((r) => scopeOf(text, r.from, r.to) !== 'cell')
    ) {
      throw first;
    }
    return { changes: done.changes, markIds: [done.id], extendedIds: [] };
  } catch (error) {
    // No unit holds it, or the format has no meaning there: the first refusal stands.
    if (error instanceof Untrackable || error instanceof EditError) throw first;
    throw error;
  }
}

/** A paste over the cells of a table: `range` goes from the cell at row `top`, column `left` of
 * the table that starts at `table` (the rows and columns of the newest view, the header's row 0),
 * and the rows and columns it needs are added. */
export interface PasteOnTable {
  table: number;
  range: readonly (readonly string[])[];
  top: number;
  left: number;
}

/**
 * A paste that adds rows or columns, written as a replacement of the table (format §3.12, lane
 * F5): the paste is made on the table as the newest view reads it, which is what the same paste with
 * Track Changes off writes there, and the edit that makes is written by `widen`. Other people's
 * pending changes in the table stay in the old text of the replacement.
 *
 * @throws Untrackable when no unit holds it; EditError when the paste has no meaning on the table.
 */
export function widenedPaste(
  text: string,
  paste: PasteOnTable,
  ctx: EditContext,
): { changes: TextChange[] } {
  const view = newestView(text);
  const start = view.map.fromSource(paste.table);
  const read = (at: string) => {
    const table = tablesOfText(at, parse(at)).find((one) => one.from === start);
    if (!table) throw new EditError('There is no such table.');
    return table;
  };
  let current = view.text;
  const first = read(current);
  const columns = first.aligns.length;
  const rows = first.rows.length;
  const width = Math.max(1, ...paste.range.map((row) => row.length));
  const extraCols = Math.max(0, paste.left + width - columns);
  const extraRows = Math.max(0, paste.top + paste.range.length - rows);
  const apply = (op: TableOp) => {
    current = applyChanges(current, untrackedTableEdit(current, op).changes);
  };
  if (extraCols > 0) {
    apply({ kind: 'insertCols', table: start, after: columns, count: extraCols });
  }
  const total = columns + extraCols;
  if (extraRows > 0) {
    const texts = Array.from({ length: extraRows }, (_, k) => {
      const values = paste.range[rows - paste.top + k] ?? [];
      return Array.from({ length: total }, (_, col) => values[col - paste.left] ?? '');
    });
    apply({ kind: 'insertRows', table: start, after: rows - 1, count: extraRows, texts });
  }
  // The cells that were there get their values.
  const cells = read(current);
  const edits: TextChange[] = [];
  for (let i = 0; i < paste.range.length && paste.top + i < rows; i++) {
    const row = cells.rows[paste.top + i];
    for (let j = 0; j < (paste.range[i]?.length ?? 0); j++) {
      const cell = row?.cells[paste.left + j];
      const value = paste.range[i]?.[j] ?? '';
      if (!cell || current.slice(cell.textFrom, cell.textTo) === value) continue;
      const empty = cell.textFrom === cell.textTo;
      const before = empty && current[cell.textFrom - 1] !== ' ' ? ' ' : '';
      const after = empty && current[cell.textFrom] !== ' ' ? ' ' : '';
      edits.push({ from: cell.textFrom, to: cell.textTo, insert: `${before}${value}${after}` });
    }
  }
  current = applyChanges(current, edits);
  const made = changesBetween(view.text, current);
  if (made.length === 0) throw new EditError('Nothing to paste.');
  const done = widen(text, made, ctx);
  return { changes: done.changes };
}
