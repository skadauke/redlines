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
import { cellAt } from './table-cells.ts';
import { untrackedTableEdit } from './table-ops.ts';
import type { TableEdit, TableOp } from './table-ops.ts';
import type { TrackedEdits } from './track.ts';
import type { EditContext, Range } from './types.ts';
import { newestView } from './views.ts';
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
  const edits = changesBetween(view.text, applyChanges(view.text, plain.changes));
  const done = widen(text, edits, ctx);
  const after = newestView(done.text);
  return { ...plain, changes: done.changes, caret: after.map.toSource(plain.caret, 1) };
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
  if (ranges.some((range) => !cellAt(text, parsed, range.from, range.to))) throw first;
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
    return { changes: done.changes, markIds: [done.id], extendedIds: [] };
  } catch (error) {
    // No unit holds it, or the format has no meaning there: the first refusal stands.
    if (error instanceof Untrackable || error instanceof EditError) throw first;
    throw error;
  }
}
