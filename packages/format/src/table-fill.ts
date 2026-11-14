// Typing into a cell a row doesn't have (format §3.7). GFM reads a row with fewer cells than the header
// as having blank cells after its last, and the editor draws them as cells, but the file has no text
// for them, and no place in it to type: the cells stand in no position of their own. Typing into one
// writes the pipes it needs first, plain (rule 7: both versions have them, and nothing reads
// differently), and then the text, as typing in a cell is written, an insertion with Track Changes on
// and plain text with it off: the edit is made on the text with the pipes in it, in a cell that is an
// empty cell as any other, so every rule of a cell's edit is kept.
//
// What is written, after the row's last character: a pipe for each cell from the row's last to the one
// asked for, and the text between that cell's pipes. A row with a closing pipe is written ` |` for each
// cell in between and ` text |`: `| 1 |` is `| 1 | | x |` for an `x` in the third column. A row with none
// (`| 1 | 2`, `1 | 2`, a lone `|`) is written the pipes between its cells and no closing one: `| 1 | 2 | x`.
// With no text, the row gets the closing pipe, so that the cell is there to put a caret in.

import { applyChanges } from './changes.ts';
import { changesBetween } from './edit-support.ts';
import { EditError } from './errors.ts';
import { parse } from './parse.ts';
import { readLine, readTables } from './table.ts';
import type { TableRead } from './table.ts';
import type { TableEdit } from './table-ops.ts';
import { movedCopyAt } from './table-rules.ts';
import { SELF_CHECK, trackedEdit } from './track.ts';
import { untrackedEdit } from './untracked.ts';
import type { UntrackedContext } from './untracked.ts';
import { newestView } from './views.ts';
import type { EditContext, Parsed, TextChange } from './types.ts';

const NO_SUCH_ROW = 'There is no such row in this table.';
const NOT_MISSING = 'That cell is not one its row lacks.';

/** Which cell of which row: `col` is a column the row doesn't have, of a body row (the header has them
 * all); `text` is what is typed there, and none writes the pipes alone. */
export interface FillCells {
  row: number;
  col: number;
  text?: string;
}

/** The text after the row's last character that makes cell `col` there: the pipes before the cell's
 * text (ending in the space it begins with) and after it. */
function pipesFor(
  text: string,
  row: TableRead['rows'][number],
  col: number,
  typing: boolean,
): { lead: string; trail: string } {
  const have = row.cells.length;
  const closed = readLine(text, row.from, row.to).trailingPipe;
  // A closing pipe ends the row's last cell; without one, the pipe that ends it is written too.
  const lead = `${' |'.repeat(col - have + (closed ? 0 : 1))} `;
  // The cell is its own closing pipe's, unless it is typed in a row that has none (its text ends the
  // row, and is a cell without one).
  const trail = closed || !typing ? ' |' : '';
  return { lead, trail };
}

/** Where the caret goes after text typed at `stop` of `written` (the text with the pipes), in `after`:
 * after the typed text, before what is hidden there, as typing in a cell leaves it. */
function caretAfter(written: string, after: string, stop: number, length: number): number {
  const at = newestView(written).map.fromSource(stop) + length;
  return newestView(after).map.toSource(at, -1);
}

/**
 * Writes the cell `op.col` of body row `op.row` of `table`, with the text typed in it. `ctx` is the
 * author of a tracked insertion, or null for plain text with Track Changes off.
 *
 * @throws EditError when the cell is not one the row lacks, or the edit is refused as typing in it is
 *   (a pipe or a line break that no backslash or `<br>` stands for).
 */
export function fillCells(
  text: string,
  parsed: Parsed,
  table: TableRead,
  op: FillCells,
  ctx: EditContext | null,
  plain: UntrackedContext = {},
): TableEdit {
  const row = Number.isInteger(op.row) && op.row >= 1 ? table.rows[op.row] : undefined;
  if (!row) throw new EditError(NO_SUCH_ROW);
  const columns = table.aligns.length;
  if (!Number.isInteger(op.col) || op.col < row.cells.length || op.col >= columns) {
    throw new EditError(NOT_MISSING, 'no-legal-placement');
  }
  const typed = op.text ?? '';
  const { lead, trail } = pipesFor(text, row, op.col, typed !== '');
  const at = row.to;
  // The pipes are written in the row at its new place, and the kept copy of a row that is moving would
  // not have them, so that rejecting the move would read otherwise: the move is decided first. (A plain
  // edit there is written in both halves, as any plain edit in a move's copy is.)
  const moved =
    ctx || typed === '' ? movedCopyAt(text, { from: at, to: at, insert: typed }, parsed) : null;
  if (moved?.axis === 'row') {
    const by = moved.copy.entry.by;
    const who =
      by === (ctx?.author.handle ?? plain.author?.handle)
        ? 'Your'
        : `${parsed.ledger.people.find((person) => person.handle === by)?.name ?? by}'s`;
    throw new EditError(
      `${who} move of this row is pending. Decide it first.`,
      'no-legal-placement',
    );
  }
  const stop = at + lead.length;
  if (typed === '') return { changes: [{ from: at, to: at, insert: lead + trail }], caret: stop };
  const written = text.slice(0, at) + lead + trail + text.slice(at);
  const edit: TextChange = { from: stop, to: stop, insert: typed };
  const made = ctx ? trackedEdit(written, edit, ctx) : untrackedEdit(written, edit, plain);
  const after = applyChanges(written, made);
  // The cell is there, and the pipes are the only change besides the text's.
  const now = readTables(after, parse(after)).find((t) => t.from === table.from);
  if ((now?.rows[op.row]?.cells.length ?? 0) <= op.col) {
    throw new EditError(SELF_CHECK, 'no-legal-placement');
  }
  return {
    changes: changesBetween(text, after),
    caret: caretAfter(written, after, stop, typed.length),
  };
}
