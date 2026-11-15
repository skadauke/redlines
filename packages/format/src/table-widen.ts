// A table operation that its rules refuse, written as a replacement of the table (format §3.12,
// lane R2): the operation is made on the table as the newest view reads it, which is what the same
// operation with Track Changes off writes there, and the edit that makes is written by `widen`.
// Other people's pending changes in the table stay in the old text of the replacement.
//
// Not wired into `tableEdit` yet: the existing refusal tests of the table rules flip when it is, and
// that is the rest of R2.

import { applyChanges } from './changes.ts';
import { changesBetween } from './edit-support.ts';
import { untrackedTableEdit } from './table-ops.ts';
import type { TableEdit, TableOp } from './table-ops.ts';
import type { EditContext } from './types.ts';
import { newestView } from './views.ts';
import { widen } from './widen.ts';

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
  return { ...plain, changes: done.changes, caret: after.map.toSource(plain.caret) };
}
