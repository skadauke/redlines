// Operations on a table's rows and columns (format §3.7): written as the forms the format defines,
// tracked as Word tracks them, or plain with Track Changes off (§3.10). An operation gives the
// changes of the file and where the caret goes. This file has inserting rows; the others join it.

import { assertPointsRead } from './align-point.ts';
import { bodyStart, lineEnd, lineStart, nextLineStart } from './blocks.ts';
import { applyChanges, eolOf } from './changes.ts';
import { rejectAll } from './decide.ts';
import { EditError } from './errors.ts';
import { widenedTableEdit } from './table-widen.ts';
import { Untrackable } from './widen.ts';
import { addPerson, changesBetween, commitEdit, workingLedger } from './edit-support.ts';
import type { CommitOptions } from './edit-support.ts';
import { idsIn, newId } from './ids.ts';
import { SYNTAX_ONLY } from './inline.ts';
import { encodePayload } from './payload.ts';
import { parse } from './parse.ts';
import { readTables } from './table.ts';
import type { TableAlign, TableDeletionRead, TableRead, TableRowRead } from './table.ts';
import {
  alignEdit,
  alignMarkOf,
  assertMarkHolds,
  assertMarkRead,
  keepAlignInStep,
} from './table-align.ts';
import {
  columnChanges,
  deletedColPayload,
  gridOf,
  newCellContent,
  newColumnShape,
  originalOrder,
  withColMarker,
  withCommentPoints,
} from './table-cols.ts';
import type { ColItem, Grid } from './table-cols.ts';
import {
  annotationsIn,
  commentAcrossRows,
  commentCrossesTable,
  commentFromAbove,
  commentHasNoPlace,
  commentsOf,
  commentsOfCols,
  foldedMarks,
  neighboursOf,
  NEXT_TO_WORDS,
  pendingInTable,
  pointPlaces,
  ruleSix,
  straddlingMarks,
  ruleThree,
  ruleThreeCols,
} from './table-rules.ts';
import { fillCells } from './table-fill.ts';
import {
  addDeletionLines,
  afterRemoval,
  afterWriting,
  arrangeRows,
  deletedRowText,
  joinPoints,
  removeDeletionLines,
  rewrittenRows,
  rowMarker,
  rowTextOf,
  setPositions,
} from './table-rows.ts';
import type { RowItem } from './table-rows.ts';
import { SELF_CHECK, fineEdit as trackedEdit } from './track.ts';
import { untrackedEdit } from './untracked.ts';
import type { UntrackedContext } from './untracked.ts';
import { newestView, originalView } from './views.ts';
import type { EditContext, MarkEntry, MarkRange, Parsed, TextChange } from './types.ts';

/**
 * An operation on a table. `table` is the offset of the table's first character; `after` is the row
 * (0 the header, 1 the first body row, -1 above the header) that the new rows go below. Rows are
 * counted as written, the header 0. For a move, `to` is the boundary the rows go to: 0 above the
 * header, the number of rows below the last.
 */
export type TableOp =
  | {
      kind: 'insertRows';
      table: number;
      after: number;
      count: number;
      /** The text of the cells of each new row, when it has some: an agent's rows. */
      texts?: readonly (readonly string[])[];
    }
  | { kind: 'deleteRows'; table: number; rows: number[] }
  | { kind: 'moveRows'; table: number; rows: number[]; to: number }
  /** `after` counts the columns in front of the new ones: 0 puts them before the first column. */
  | {
      kind: 'insertCols';
      table: number;
      after: number;
      count: number;
      /** The text of the cells of each new column, the header's first: an agent's columns. */
      texts?: readonly (readonly string[])[];
    }
  | { kind: 'deleteCols'; table: number; cols: number[] }
  /** `to` is the boundary the columns go to: 0 before the first column, up to the number of columns. */
  | { kind: 'moveCols'; table: number; cols: number[]; to: number }
  /** The columns `cols` aligned as `align` (format §3.7, rule 5). */
  | { kind: 'align'; table: number; cols: number[]; align: TableAlign }
  /** The whole table, as a block (format §3.4, §3.7 rule 6). */
  | { kind: 'deleteTable'; table: number }
  /** The cell `col` of body row `row` (0 the header), which the row lacks: its pipes are written, plain,
   * and `text`, when there is some, is typed into it (format §3.7, "A cell a row lacks"). */
  | { kind: 'fillCells'; table: number; row: number; col: number; text?: string };

/** What is pending in a table, by axis (format §3.7). */
export interface TablePending {
  rowsInserted: boolean;
  /** A row is deleted or moved. */
  rowsChanged: boolean;
  colsInserted: boolean;
  /** A column is deleted or moved. */
  colsChanged: boolean;
  /** An alignment change. */
  align: boolean;
  /** The header is itself a pending row change: `rows[0].insertion` is set (a row inserted above it,
   * or moved to the top), or a deleted row has position 0 (the header deleted, or moved away). */
  headerChanged: boolean;
}

/** The words of a refusal while an alignment change is pending: a column operation, or a row operation
 * that touches the header, where the mark of the change stands (format §3.7, rule 5). */
export const ALIGN_FIRST = 'Accept or reject the alignment change in this table first.';

/** Whether a mark is a half of a move. */
const isMove = (mark: MarkRange) => mark.entry.move !== undefined;

/** What is pending in `table`: marks in its rows, the deletions below it, and a format change of
 * its alignment: a point in its header row, or a range around it that another tool wrote. */
export function pendingOf(table: TableRead, parsed: Parsed): TablePending {
  const header = table.rows[0];
  const inHeader = (mark: MarkRange) => {
    const at = mark.segments[0]?.open.from ?? -1;
    return header !== undefined && header.from <= at && at <= header.to;
  };
  const pending: TablePending = {
    rowsInserted: false,
    rowsChanged: false,
    colsInserted: false,
    colsChanged: false,
    align: false,
    headerChanged: false,
  };
  for (const row of table.rows) {
    if (!row.insertion) continue;
    if (isMove(row.insertion)) pending.rowsChanged = true;
    else pending.rowsInserted = true;
  }
  for (const mark of parsed.marks) {
    if (mark.kind === 'ins' && mark.payload === 'col' && inHeader(mark)) {
      if (isMove(mark)) pending.colsChanged = true;
      else pending.colsInserted = true;
    }
  }
  if (alignMarkOf(parsed, table)) pending.align = true;
  for (const deletion of table.deletions) {
    if (deletion.axis === 'row') {
      pending.rowsChanged = true;
      // A deleted row that comes back at position 0 comes back above the header.
      if (deletion.position === 0) pending.headerChanged = true;
    } else pending.colsChanged = true;
  }
  if (header?.insertion) pending.headerChanged = true;
  return pending;
}

const COLUMNS_FIRST = 'Accept or reject the column changes in this table first.';
const ROWS_FIRST = 'Accept or reject the row changes in this table first.';

/** Whether a pending alignment change keeps a column operation from being made (format §3.7, rule 5): any
 * tracked one, and one with Track Changes off while a column is pending too. */
const alignHolds = (pending: TablePending, tracked: boolean): boolean =>
  pending.align && (tracked || pending.colsInserted || pending.colsChanged);

/** The refusal of an operation that would leave a deletion or a move the wrong number of cells,
 * or null (format §3.7, rule 2). A column deleted or moved is kept as its cells top to bottom, so a
 * row inserted or deleted while it is pending would leave it one cell short or long; the same of a
 * column and a pending row deletion. `tracked` is Track Changes: the table of allowed pairs reads the
 * same with it on or off for these. */
export function ruleTwo(
  op: TableOp['kind'],
  pending: TablePending,
  tracked: boolean,
): string | null {
  switch (op) {
    // A column put in a table while a row is deleted or moved would be missing from the kept row; one
    // put in while rows are inserted is in them too. Rule 5: while an alignment change keeps the old
    // delimiter row, a tracked change of the columns would leave it a cell short or long in some order
    // of decisions. With Track Changes off the operation does the same to the old row as to the table's
    // own (`keepAlignInStep`), unless a column is pending too, which it can't be kept in step with.
    case 'insertCols':
      return alignHolds(pending, tracked) ? ALIGN_FIRST : pending.rowsChanged ? ROWS_FIRST : null;
    case 'deleteCols':
    case 'moveCols':
      return alignHolds(pending, tracked)
        ? ALIGN_FIRST
        : pending.rowsChanged || (tracked && pending.rowsInserted)
          ? ROWS_FIRST
          : null;
    case 'insertRows':
      return pending.colsChanged ? COLUMNS_FIRST : null;
    // Rule 5: `align=` keeps the whole old delimiter row, so a pending column would leave it a cell
    // short or long. Its mark stands in the header row, so a header that is itself a pending row change
    // (a row inserted above it, the header deleted or moved) would leave it where rejecting the row
    // could take it along or leave it in a body row. Rows below the header don't touch the delimiter
    // row or the mark. With Track Changes off no mark is written: the row is changed as it says, in the
    // kept one too.
    case 'align':
      if (!tracked) return null;
      if (pending.colsInserted || pending.colsChanged) return COLUMNS_FIRST;
      return pending.headerChanged ? ROWS_FIRST : null;
    // A deleted or moved row keeps its cells as written, so a column inserted while it is pending
    // would be missing from it when the insertion is rejected. With Track Changes off the row is
    // taken out of the table, and only a column deleted or moved is left the wrong number of cells.
    case 'deleteRows':
    case 'moveRows':
      return pending.colsChanged || (tracked && pending.colsInserted) ? COLUMNS_FIRST : null;
    // The table goes whole: your own pending changes in it are folded into the deletion, whatever
    // axis they are on, and another person's are refused (rule 6), not asked to be decided by axis.
    case 'deleteTable':
      return null;
    // A cell typed in is a cell edit, which any change pending in the table allows.
    case 'fillCells':
      return null;
  }
}

/**
 * The changes that rewrite the positions of a table's deleted rows after a row goes in at `index`
 * (`delta` 1) or out of it (-1): a deletion that comes back below that row moves with the rows
 * around it (format §3.7: positions count the table as written). Deletions at or above it stay.
 */
export function rewritePositions(
  text: string,
  table: TableRead,
  index: number,
  delta: 1 | -1,
): TextChange[] {
  const changes: TextChange[] = [];
  for (const deletion of table.deletions) {
    if (deletion.axis !== 'row' || deletion.position <= index) continue;
    const open = deletion.mark.segments[0]?.open;
    if (!open) continue;
    const found = /row=(\d+)/.exec(text.slice(open.from, open.to));
    if (!found?.[1]) continue;
    const from = open.from + found.index + 4;
    changes.push({ from, to: from + found[1].length, insert: String(deletion.position + delta) });
  }
  return changes;
}

/** The text of a new row, in the table's style: padded to line up where every row of the table is,
 * `| a | b |` otherwise. `first` is the text at the start of the first cell. */
function rowText(
  table: TableRead,
  text: string,
  first: string,
  cells: readonly string[] = [],
): string {
  const columns = table.aligns.length;
  const delimiter = text.slice(table.delimiter.from, table.delimiter.to);
  const widths: number[] = [];
  const row0 = table.rows[0];
  const lined =
    table.padded &&
    row0?.leadingPipe === true &&
    /^[ \t]*\|/.test(delimiter) &&
    /\|[ \t]*$/.test(delimiter);
  if (lined) {
    const pipes: number[] = [];
    for (let i = 0; i < delimiter.length; i++) if (delimiter[i] === '|') pipes.push(i);
    for (let i = 0; i < columns; i++) {
      widths.push(Math.max(0, (pipes[i + 1] ?? 0) - (pipes[i] ?? 0) - 3));
    }
  }
  let line = '';
  for (let i = 0; i < columns; i++) {
    const width = lined ? (widths[i] ?? 0) : 0;
    // The first cell's marker leaves the cell as wide as the others when it goes (accepting the
    // row): the spaces after it are the cell's own.
    const body = cells[i] ?? '';
    const pad = ' '.repeat(Math.max(0, width - body.length));
    // The first cell's marker is followed by a space of its own, which accepting the row takes with
    // it: the cell is then as wide as the others.
    const lead = i === 0 && first !== '' ? `${first} ` : '';
    const content = body === '' ? lead + ' '.repeat(width) : lead + body + pad;
    line += `| ${content} `;
  }
  return `${line}|`;
}

/** A row put above the header would take the header's place, and the marker of an inserted column and
 * the mark of an alignment change stand in the header: it is refused while a column is pending
 * insertion or an alignment change is pending (format §3.7). */
function headerCheck(op: TableOp & { kind: 'insertRows' }, table: TableRead, parsed: Parsed): void {
  if (op.after >= 0) return;
  const pending = pendingOf(table, parsed);
  if (pending.colsInserted) throw new EditError(COLUMNS_FIRST, 'no-legal-placement');
  if (pending.align) throw new EditError(ALIGN_FIRST, 'no-legal-placement');
}

/** Where the new rows go: the end of the line of the row they go below. */
function insertionPoint(table: TableRead, text: string, after: number): number {
  if (!Number.isInteger(after) || after < 0 || after >= table.rows.length) {
    throw new EditError('There is no such row in this table.');
  }
  if (after === 0) return table.delimiter.to;
  return lineEnd(text, table.rows[after]?.from ?? table.to);
}

const NO_SUCH_ROW = 'There is no such row in this table.';

function tableOf(text: string, parsed: Parsed, op: TableOp): TableRead {
  const table = readTables(text, parsed).find((t) => t.from === op.table);
  if (!table) throw new EditError('There is no table there.');
  if (op.kind === 'insertRows' && (!Number.isInteger(op.count) || op.count < 1)) {
    throw new EditError('Insert at least one row.');
  }
  if (op.kind === 'insertCols' && (!Number.isInteger(op.count) || op.count < 1)) {
    throw new EditError('Insert at least one column.');
  }
  return table;
}

/** The rows an operation names, sorted and apart. */
function rowsOf(table: TableRead, rows: readonly number[]): number[] {
  const sorted = [...new Set(rows)].sort((a, b) => a - b);
  if (sorted.length === 0) throw new EditError(NO_SUCH_ROW);
  for (const row of sorted) {
    if (!Number.isInteger(row) || row < 0 || row >= table.rows.length) {
      throw new EditError(NO_SUCH_ROW);
    }
  }
  return sorted;
}

/** What an operation gives: the changes, where the caret goes in the new text, and, for rows that
 * were moved or made, their indexes in the new table. */
export interface TableEdit {
  changes: TextChange[];
  caret: number;
  rows?: number[];
  /** For columns moved or made, their indexes in the new table. */
  cols?: number[];
}

/** The new table of `table`'s first character, read from the text after the changes. */
function tableAfter(after: string, table: TableRead): TableRead | undefined {
  return readTables(after, parse(after)).find((t) => t.from === table.from);
}

/** Where the caret goes in the text after the changes: the first cell of the first new row. */
function caretOf(after: string, table: TableRead, op: TableOp & { kind: 'insertRows' }): number {
  const read = tableAfter(after, table);
  const cell = read?.rows[op.after + 1]?.cells[0];
  return cell?.textFrom ?? insertionPoint(table, after, op.after);
}

/** Rows written in front of the header: a new header, and the old one a body row. */
function insertAbove(
  text: string,
  table: TableRead,
  eol: string,
  texts: readonly string[],
): TextChange[] {
  const final: RowItem[] = [
    ...texts.map((row) => ({ text: row })),
    ...table.rows.map((_, src) => ({ src })),
  ];
  return arrangeRows(text, table, final, eol);
}

/** The marker of an inserted row, written at the start of the text of a row's first cell. A row
 * without a leading pipe gets a plain one first (rule 7). */
function markedRow(text: string, row: TableRowRead, marker: string): string {
  const cell = row.cells[0];
  const line = rowTextOf(text, row);
  if (!cell) return `| ${marker} ${line}`;
  const at = cell.textFrom - row.from;
  const lead = row.leadingPipe ? '' : '| ';
  return lead + line.slice(0, at) + marker + ' ' + line.slice(at);
}

/** The row as it reads with every pending change in it rejected, format changes undone as well: its
 * line in the original view of the file, found from where the line starts (the row is one line). */
export function originalRowText(text: string, parsed: Parsed, row: TableRowRead): string {
  // A row that holds no marker reads as it is written, which is nearly every row.
  const marked = parsed.marks.some((mark) =>
    mark.segments.some(
      (segment) =>
        // (an inserted row's own marker is no change in it that the original would undo)
        !(mark.kind === 'ins' && mark.payload === 'row') &&
        // The marker of either end: a comment of a row without outer pipes can start at the end
        // of the line above, its marker not being allowed at the start of the row.
        ((segment.open.to > row.from && segment.open.from < row.to) ||
          (segment.close !== undefined &&
            segment.close.to > row.from &&
            segment.close.from < row.to)),
    ),
  );
  if (!marked && !row.insertion) return rowTextOf(text, row);
  const view = originalView(text);
  const from = view.map.fromSource(row.from);
  return view.text.slice(from, lineEnd(view.text, from));
}

/** The twin of a half of a move, in the table: the deletion of an inserted row, or the row. */
function twinOf(table: TableRead, row: TableRowRead): number {
  const id = row.insertion?.entry.move;
  return id === undefined ? -1 : table.deletions.findIndex((d) => d.mark.id === id);
}

/** The positions of the table's deletions, in the order they are written, after rows leave. */
function positionsAfterLeaving(table: TableRead, leaving: readonly number[]): number[] {
  return table.deletions.map((deletion) =>
    [...leaving].reverse().reduce((p, index) => afterRemoval(p, index), deletion.position),
  );
}

/** Deleting rows (format §3.7, rules 2 to 4). `tracked` is by `ctx`, or null for plain. */
function deleteRows(
  text: string,
  parsed: Parsed,
  table: TableRead,
  rows: readonly number[],
  ctx: EditContext | null,
): TableEdit {
  const remaining = table.rows.length - rows.length;
  if (remaining < 1) throw new EditError('Delete the table instead.', 'no-legal-placement');
  const pending = pendingOf(table, parsed);
  const refusal = ruleTwo('deleteRows', pending, ctx !== null);
  if (refusal) throw new EditError(refusal, 'no-legal-placement');
  if (rows.includes(0) && pending.colsInserted)
    throw new EditError(COLUMNS_FIRST, 'no-legal-placement');
  // The header carries the mark of an alignment change: it is neither deleted nor moved while it is pending.
  if (rows.includes(0) && pending.align) throw new EditError(ALIGN_FIRST, 'no-legal-placement');
  if (ctx) {
    const three = ruleThree(table, parsed, rows, ctx.author, 'delete');
    if (three) throw new EditError(three, 'no-legal-placement');
  }
  const eol = eolOf(text, parsed.ledgerRange);
  const leaving = new Set(rows);
  // The first row that stays is the header, when the header goes: a row of another width unreads the table.
  const newHeader = table.rows.find((_, i) => !leaving.has(i));
  if (rows.includes(0) && newHeader && newHeader.cells.length !== table.aligns.length) {
    throw new EditError(unreadRefusal(table, parsed, newHeader), 'no-legal-placement');
  }
  const final: RowItem[] = table.rows.flatMap((_, src) => (leaving.has(src) ? [] : [{ src }]));
  const before = table.deletions.map((d) => d.position);
  const positions = positionsAfterLeaving(table, rows);
  const ledger = workingLedger(parsed.ledger);
  const taken = idsIn(text);
  const added: { order: number; line: string }[] = [];
  const created: string[] = [];
  const twins = new Set<number>();
  const group = ctx
    ? (ctx.group ?? (rows.length > 1 ? newId(taken, ctx.random) : undefined))
    : undefined;
  if (group !== undefined) taken.add(group);
  if (ctx) addPerson(ledger, ctx.author);
  for (const index of rows) {
    const row = table.rows[index] as TableRowRead;
    const twin = twinOf(table, row);
    if (twin !== -1) {
      if (ctx === null) twins.add(twin);
      else {
        // Deleting your own move: the row at the new place goes, and the old place stays a deletion.
        const id = table.deletions[twin]?.mark.id ?? '';
        const entry = ledger.marks[id];
        if (entry) {
          const { move: _move, ...rest } = entry;
          void _move;
          ledger.marks[id] = rest;
        }
      }
      continue;
    }
    if (!ctx || row.insertion) continue;
    const id = newId(taken, ctx.random);
    taken.add(id);
    created.push(id);
    const entry: MarkEntry = { by: ctx.author.handle, at: ctx.time };
    if (group !== undefined) entry.group = group;
    if (ctx.note !== undefined) entry.note = ctx.note;
    ledger.marks[id] = entry;
    const position = index - rows.filter((r) => r < index).length;
    const payload = `row=${position} ${originalRowText(text, parsed, row)}`;
    added.push({ order: index, line: `<!--del ${id} ${encodePayload(payload)}-->` });
  }
  const body = joinPoints([
    ...arrangeRows(text, table, final, eol),
    ...commentsOf(parsed, table, leaving),
    ...addDeletionLines(text, table, before, added, eol),
    ...setPositions(
      text,
      table,
      positions,
      new Set(table.deletions.map((_, i) => i).filter((i) => !twins.has(i))),
    ),
    ...removeDeletionLines(text, table, twins),
  ]);
  // Rows that hold no marks and no twin of a move leave the ledger as it is (the common plain delete).
  const marked = parsed.marks.some((mark) =>
    mark.segments.some((segment) =>
      rows.some((index) => {
        const row = table.rows[index];
        return row !== undefined && row.from <= segment.open.from && segment.open.to <= row.to;
      }),
    ),
  );
  const plainLedger = ctx === null && !marked && twins.size === 0;
  const changes = commitEdit(
    text,
    body,
    ledger,
    plainLedger ? { parsed, keepLedger: true } : { parsed, created, removes: true },
  );
  const after = applyChanges(text, changes);
  const read = tableAfter(after, table);
  if (!read || read.rows.length !== remaining) {
    throw new EditError(unreadRefusal(table, parsed, newHeader), 'no-legal-placement');
  }
  // The caret goes to the row that now sits where the first deleted one did.
  const target = Math.min(rows[0] ?? 0, (read?.rows.length ?? 1) - 1);
  const row = read?.rows[target];
  return { changes, caret: row?.cells[0]?.textFrom ?? table.from };
}

/**
 * The words for an operation on rows that would leave the table unread as a table (a row that is the
 * header, or a header that a comment's marker is after the closing pipe of, so that it has a cell
 * too many), refused when it is made and not when it is decided (format §3.7). `header` is the row
 * that would be the header.
 */
function unreadRefusal(table: TableRead, parsed: Parsed, header: TableRowRead | undefined): string {
  // A comment's marker after the closing pipe of the row is a cell too many.
  const inHeader = header
    ? parsed.marks.find(
        (mark) =>
          mark.kind === 'cmt' &&
          mark.segments.some((seg) =>
            [seg.open, seg.close].some(
              (r) => r !== undefined && header.from <= r.from && r.to <= header.to,
            ),
          ),
      )
    : undefined;
  if (inHeader) {
    const name = parsed.ledger.people.find((p) => p.handle === inHeader.entry.by)?.name;
    return `${name ?? inHeader.entry.by}'s comment is at the end of this row, which would make a cell too many in the header. Delete or resolve it first.`;
  }
  if (header && header.cells.length !== table.aligns.length) {
    return 'This row has a different number of cells than the header, so the table would stop reading as a table. Make its cells match the header first.';
  }
  const across = commentAcrossRows(table, parsed);
  if (across) {
    return `${across.name}'s comment runs from one row of this table into the next, and this would leave the table unread. Delete or resolve it first.`;
  }
  return 'This would leave the table unread as a table.';
}

/** Moving rows (format §3.7). */
function moveRows(
  text: string,
  parsed: Parsed,
  table: TableRead,
  rows: readonly number[],
  to: number,
  ctx: EditContext | null,
): TableEdit {
  if (!Number.isInteger(to) || to < 0 || to > table.rows.length) {
    throw new EditError('There is no such place in this table.');
  }
  const pending = pendingOf(table, parsed);
  const refusal = ruleTwo('moveRows', pending, ctx !== null);
  if (refusal) throw new EditError(refusal, 'no-legal-placement');
  // The header carries the markers of inserted columns and the mark of an alignment change: it keeps its
  // place while they are pending.
  const header = rows.includes(0) || to === 0;
  if (header && pending.colsInserted) throw new EditError(COLUMNS_FIRST, 'no-legal-placement');
  if (header && pending.align) throw new EditError(ALIGN_FIRST, 'no-legal-placement');
  if (ctx) {
    const three = ruleThree(table, parsed, rows, ctx.author, 'move');
    if (three) throw new EditError(three, 'no-legal-placement');
  }
  const moving = new Set(rows);
  const others = table.rows.map((_, i) => i).filter((i) => !moving.has(i));
  const at = to - rows.filter((r) => r < to).length;
  const order = [...others.slice(0, at), ...rows, ...others.slice(at)];
  if (order.every((index, i) => index === i)) {
    throw new EditError('The rows are already there.', 'no-legal-placement');
  }
  // A comment that runs from one row into another (a row with no pipe at its start can't start with
  // a marker, and the comment's opener stands at the end of the row above) can't be kept with a
  // move that can be rejected: refused now, naming its author, and not when the move is decided.
  const across = ctx ? commentAcrossRows(table, parsed) : null;
  if (across) {
    throw new EditError(
      `${across.name}'s comment runs from one row of this table into the next. Delete or resolve it first, or turn off Track Changes.`,
      'no-legal-placement',
    );
  }
  // The row that becomes the header must have the header's cells: the table would be read no more.
  const top = table.rows[order[0] ?? 0];
  if (order[0] !== 0 && top && top.cells.length !== table.aligns.length) {
    throw new EditError(unreadRefusal(table, parsed, top), 'no-legal-placement');
  }
  const eol = eolOf(text, parsed.ledgerRange);
  const ledger = workingLedger(parsed.ledger);
  const taken = idsIn(text);
  const created: string[] = [];
  const group = ctx
    ? (ctx.group ?? (rows.length > 1 ? newId(taken, ctx.random) : undefined))
    : undefined;
  if (group !== undefined) taken.add(group);
  if (ctx) addPerson(ledger, ctx.author);
  const copies = new Map<number, string>();
  const ghosts = new Map<number, { id: string; ins: string }>();
  for (const index of rows) {
    const row = table.rows[index] as TableRowRead;
    if (!ctx || row.insertion) continue;
    const ins = newId(taken, ctx.random);
    taken.add(ins);
    const del = newId(taken, ctx.random);
    taken.add(del);
    created.push(ins, del);
    ghosts.set(index, { id: del, ins });
    copies.set(index, markedRow(text, row, `<!--ins ${ins} row-->`));
    for (const [id, other] of [
      [ins, del],
      [del, ins],
    ] as const) {
      const entry: MarkEntry = { by: ctx.author.handle, at: ctx.time };
      if (group !== undefined) entry.group = group;
      if (ctx.note !== undefined) entry.note = ctx.note;
      entry.move = other;
      ledger.marks[id] = entry;
    }
  }
  const final: RowItem[] = order.map((index) => {
    const copy = copies.get(index);
    return copy === undefined ? { src: index } : { text: copy };
  });
  // Where the deletions sit afterwards: rows leave, then come in at their places.
  let positions = positionsAfterLeaving(table, rows);
  order.forEach((index, place) => {
    if (!moving.has(index)) return;
    positions = positions.map((p, i) => afterWriting(p, place, i));
  });
  const added: { order: number; line: string }[] = [];
  for (const [index, { id }] of ghosts) {
    const row = table.rows[index] as TableRowRead;
    let anchor = -1;
    for (let a = index - 1; a >= 0; a--) {
      if (!moving.has(a)) {
        anchor = a;
        break;
      }
    }
    const position = anchor === -1 ? 0 : order.indexOf(anchor) + 1;
    // A row with no pipe at its start is given a plain one in front of its marker, and the place it
    // leaves is kept with the same pipe: the pipe is no change, both versions have it, and
    // rejecting the move puts the row back as it reads, with a mark of a comment or of another
    // person's typing at its start where a row without a pipe could have none (#289).
    const original = originalRowText(text, parsed, row);
    const lead = /^[ \t]*\|/.test(original) ? '' : '| ';
    const payload = `row=${position} ${lead}${original}`;
    added.push({ order: index, line: `<!--del ${id} ${encodePayload(payload)}-->` });
  }
  const before = table.deletions.map((d) => d.position);
  const body = joinPoints([
    ...arrangeRows(text, table, final, eol),
    ...addDeletionLines(text, table, before, added, eol),
    ...setPositions(text, table, positions),
  ]);
  const changes = commitEdit(
    text,
    body,
    ledger,
    // A plain move keeps every marker it writes again, so the ledger is as it was.
    ctx ? { parsed, created } : { parsed, keepLedger: true },
  );
  const read = tableAfter(applyChanges(text, changes), table);
  // The rows must still make the table they made, as a last guard: refused now, not on rejecting.
  if (!read || read.rows.length !== table.rows.length) {
    throw new EditError(unreadRefusal(table, parsed, top), 'no-legal-placement');
  }
  const moved = rows.map((index) => order.indexOf(index));
  const first = read?.rows[moved[0] ?? 0];
  return { changes, caret: first?.cells[0]?.textFrom ?? table.from, rows: moved };
}

/** Why a point comment's place is refused by the edit that writes it, which the next place is tried for. */
const NO_PLACE = new Set(['no-legal-placement', 'inside-code', 'would-hide-marks', 'unclosed-end']);

/**
 * The comments and highlights in `table`'s rows taken out of them, and the comments written as point
 * comments where the table was (format §3.7, rule 6): at the start of the text of the block after the
 * table, or at the end of the text of the block before it. The text as it is after. With Track
 * Changes off a comment that can't be written so is left to the edit that takes the table's text out,
 * which keeps a point where the text was.
 *
 * @throws EditError, with Track Changes on, when a comment runs from the table into the text around
 *   it, or no text next to the table can keep a point.
 */
function commentsToPoints(
  text: string,
  parsed: Parsed,
  table: TableRead,
  tracked: boolean,
): string {
  const { removals, points, crossing } = annotationsIn(parsed, table);
  if (crossing) {
    if (!tracked) return text;
    throw new EditError(commentCrossesTable(parsed, crossing.by), 'no-legal-placement');
  }
  if (removals.length === 0) return text;
  const ledger = workingLedger(parsed.ledger);
  const ids = points.map((point) => point.id);
  const insert = ids.map((id) => `<!--cmt ${id}-->`).join('');
  for (const at of ids.length > 0 ? pointPlaces(text, parsed, table) : [null]) {
    const body = at === null ? removals : [...removals, { from: at, to: at, insert }];
    try {
      const changes = commitEdit(text, body, ledger, {
        parsed,
        created: ids,
        removes: true,
        // A point that no one reads, in code, say, would leave its thread with no anchor.
        verify: (_after, read) => {
          if (ids.some((id) => !read.marks.some((mark) => mark.id === id))) {
            throw new EditError(commentHasNoPlace(parsed, points[0]?.by ?? ''), 'inside-code');
          }
        },
      });
      return applyChanges(text, changes);
    } catch (error) {
      if (!(error instanceof EditError) || !NO_PLACE.has(error.code ?? '')) throw error;
    }
  }
  if (!tracked) return text;
  throw new EditError(commentHasNoPlace(parsed, points[0]?.by ?? ''), 'no-legal-placement');
}

/** Whether the line that starts at `start` is blank. */
const blankLine = (text: string, start: number): boolean =>
  /^[ \t]*$/.test(text.slice(start, lineEnd(text, start)));

/**
 * What a table's removal takes out as text, with Track Changes off: the table and the blank lines
 * after it, up to the line of what follows, or when nothing follows, the table and the break before it
 * (so that the neighbors stay as far apart as they were).
 */
function plainRange(text: string, parsed: Parsed, table: TableRead): { from: number; to: number } {
  const stop = parsed.ledgerRange?.from ?? text.length;
  const first = bodyStart(text);
  const start = lineStart(text, table.from);
  // A line of text right above the table (a table can start in a paragraph's next line) is kept apart
  // from what follows by the blank line after the table, which then stays.
  const apart = start <= first || blankLine(text, lineStart(text, start - 1));
  let after = nextLineStart(text, table.to);
  if (!apart && after < stop) return { from: table.from, to: after };
  while (after < stop && blankLine(text, after)) after = nextLineStart(text, after);
  if (after < stop) return { from: table.from, to: after };
  let above = start;
  while (above > first) {
    const line = lineStart(text, above - 1);
    above = line;
    if (blankLine(text, line)) continue;
    return { from: lineEnd(text, line), to: table.to };
  }
  return { from: table.from, to: table.to };
}

/** Where the caret goes after a table is gone: at the start of the text that follows it, or at the end
 * of the text before it when none follows. `from` is where the table started in `before`. */
function caretAfterTable(before: string, from: number, after: string): number {
  const wanted = newestView(before).map.fromSource(from);
  const view = newestView(after);
  const end = view.text.replace(/\s+$/, '').length;
  return wanted >= end ? view.map.toSource(end, -1) : view.map.toSource(wanted, 1);
}

/**
 * The words of a refusal of the deletion of the table `table` that say what stands in the way and what
 * to do (format §3.7, rule 6), or null when the refusal is for another reason. The deletion's marker
 * can't stand in front of a code fence, nor behind a code block or a rule where the table ends the
 * text, and the block's deletion needs a break in front of the table's first line.
 */
function wordsNextTo(
  error: EditError,
  text: string,
  parsed: Parsed,
  table: TableRead,
): string | null {
  const next = neighboursOf(text, parsed, table);
  if (error.code === 'unclosed-end' && next.fenceAfter) return NEXT_TO_WORDS.codeAfter;
  if (
    next.endsText &&
    ((error.code === 'inside-code' && next.indentedAbove) ||
      (error.message === SYNTAX_ONLY && next.fenceOrRuleAbove))
  ) {
    return NEXT_TO_WORDS.codeBefore;
  }
  if (error.code === 'inside-code' && next.indentedAbove && next.indentedBelow) {
    return NEXT_TO_WORDS.codeBetween;
  }
  if (error.message.startsWith("A heading's closing #s") && next.headingAbove) {
    return NEXT_TO_WORDS.underHeading;
  }
  if (error.message === SELF_CHECK) {
    if (next.underText) return NEXT_TO_WORDS.underText;
    if (next.htmlBelow) return NEXT_TO_WORDS.htmlBelow;
  }
  return null;
}

/**
 * Deleting a table (format §3.4, §3.7 rule 6): a deletion of the block, in the form of §3.4, with the
 * table as it reads with your own pending changes rejected as its payload. With Track Changes on,
 * another person's pending change in the table refuses it; your own are folded in, as rejecting them
 * would (your inserted row is removed outright, a row you deleted is in the payload), its comments
 * become point comments where it was and its highlights go. With it off the table goes as text, with
 * what was pending in it. `ctx` is null for plain.
 */
function deleteTable(
  text: string,
  parsed: Parsed,
  table: TableRead,
  ctx: EditContext | null,
  plain: UntrackedContext = {},
): TableEdit {
  if (ctx) {
    const refusal = ruleSix(text, table, parsed, ctx.author);
    if (refusal) throw new EditError(refusal, 'no-legal-placement');
  }
  const tables = readTables(text, parsed);
  const index = tables.findIndex((t) => t.from === table.from);
  const handle = ctx ? ctx.author.handle : null;
  // A change of yours that runs from the table into the text around it can't be undone with the table.
  const straddling = ctx ? straddlingMarks(text, table, parsed, ctx.author.handle)[0] : undefined;
  if (straddling) throw new EditError(pendingInTable(parsed, straddling), 'no-legal-placement');
  // The changes in it that go with it are undone first, as deciding them would: what is left is a
  // table with nothing pending, which the ordinary deletion of a block writes (`trackedEdit`).
  let current = text;
  const folded = foldedMarks(text, table, parsed, handle);
  if (folded.length > 0) {
    const wanted = new Set(folded.map((mark) => mark.id));
    current = applyChanges(
      text,
      rejectAll(text, (mark) => wanted.has(mark.id)),
    );
  }
  let read = current === text ? parsed : parse(current);
  const left = readTables(current, read);
  if (left.length < tables.length) {
    // The table was nothing but your own pending insertion, and undoing it took it away with no trace;
    // or undoing the changes in it left what the file no longer reads as a table, which is not that.
    const shown = (view: string) => readTables(view, parse(view)).length;
    if (shown(newestView(current).text) >= shown(newestView(text).text)) {
      throw new EditError(pendingInTable(read, folded[0] as MarkRange), 'no-legal-placement');
    }
    return {
      changes: changesBetween(text, current),
      caret: caretAfterTable(text, table.from, current),
    };
  }
  let here = left[index] as TableRead;
  if (ctx) {
    // A change of yours that can't be undone (a format change that a later edit altered) stays.
    const stuck = foldedMarks(current, here, read, handle)[0];
    if (stuck) throw new EditError(pendingInTable(read, stuck), 'no-legal-placement');
  }
  const pointed = commentsToPoints(current, read, here, ctx !== null);
  if (pointed !== current) {
    current = pointed;
    read = parse(current);
    here = readTables(current, read)[index] as TableRead;
  }
  let asked: TextChange[];
  try {
    asked = ctx
      ? trackedEdit(current, { from: here.from, to: here.to, insert: '' }, ctx)
      : untrackedEdit(current, { ...plainRange(current, read, here), insert: '' }, plain);
  } catch (error) {
    // The ordinary deletion of a block words its refusals for blocks in general, and some are not so of
    // a table (it speaks of a code block to close, or of a change to make smaller). When what stands
    // next to the table is in the way, say so.
    const words =
      ctx && error instanceof EditError ? wordsNextTo(error, current, read, here) : null;
    throw words === null ? error : new EditError(words, 'no-legal-placement');
  }
  const after = applyChanges(current, asked);
  return {
    changes: current === text ? asked : changesBetween(text, after),
    caret: caretAfterTable(current, here.from, after),
  };
}

/**
 * An operation on a table as a tracked change by `ctx.author`: the changes of the text and the
 * ledger, and where the caret goes in the new text. New rows carry `<!--ins ID row-->` at the start
 * of their first cell; several rows made at once share a group. A deleted row is kept below the
 * table, and a moved one is written at its new place and kept as a deletion at the old.
 *
 * @throws EditError when the operation is refused, or the ledger can't be read.
 */
/** The operation at the grain it was made, refused where its rules say so (`tableEdit` widens). */
export function fineTableEdit(text: string, op: TableOp, ctx: EditContext): TableEdit {
  const parsed = parse(text);
  const table = tableOf(text, parsed, op);
  if (op.kind === 'deleteTable') return deleteTable(text, parsed, table, ctx);
  if (op.kind === 'fillCells') return fillCells(text, parsed, table, op, ctx);
  if (op.kind === 'deleteRows') return deleteRows(text, parsed, table, rowsOf(table, op.rows), ctx);
  if (op.kind === 'moveRows') {
    return moveRows(text, parsed, table, rowsOf(table, op.rows), op.to, ctx);
  }
  if (op.kind === 'insertCols') return insertCols(text, parsed, table, op, ctx);
  if (op.kind === 'deleteCols') return deleteCols(text, parsed, table, colsOf(table, op.cols), ctx);
  if (op.kind === 'moveCols') {
    return moveCols(text, parsed, table, colsOf(table, op.cols), op.to, ctx);
  }
  if (op.kind === 'align') return aligned(text, parsed, table, op, ctx);
  const refusal = ruleTwo(op.kind, pendingOf(table, parsed), true);
  if (refusal) throw new EditError(refusal, 'no-legal-placement');
  headerCheck(op, table, parsed);
  const eol = eolOf(text, parsed.ledgerRange);

  const taken = idsIn(text);
  const ledger = workingLedger(parsed.ledger);
  addPerson(ledger, ctx.author);
  const group = ctx.group ?? (op.count > 1 ? newId(taken, ctx.random) : undefined);
  if (group !== undefined) taken.add(group);
  const ids: string[] = [];
  const lines: string[] = [];
  for (let i = 0; i < op.count; i++) {
    const id = newId(taken, ctx.random);
    taken.add(id);
    ids.push(id);
    const entry: MarkEntry = { by: ctx.author.handle, at: ctx.time };
    if (group !== undefined) entry.group = group;
    if (ctx.note !== undefined) entry.note = ctx.note;
    ledger.marks[id] = entry;
    lines.push(rowText(table, text, `<!--ins ${id} row-->`, op.texts?.[i]));
  }
  const body = insertBody(text, table, op, eol, lines);
  const changes = commitEdit(text, body, ledger, { parsed, created: ids });
  return { changes, caret: caretOf(applyChanges(text, changes), table, op) };
}

/** Aligning columns (format §3.7, rule 5). `ctx` is null for plain. */
function aligned(
  text: string,
  parsed: Parsed,
  table: TableRead,
  op: TableOp & { kind: 'align' },
  ctx: EditContext | null,
): TableEdit {
  for (const col of op.cols) {
    if (!Number.isInteger(col) || col < 0 || col >= table.aligns.length) {
      throw new EditError('There is no such column in this table.');
    }
  }
  if (op.cols.length === 0) throw new EditError('There is no such column in this table.');
  const refusal = ruleTwo('align', pendingOf(table, parsed), ctx !== null);
  if (refusal) throw new EditError(refusal, 'no-legal-placement');
  return alignEdit(text, parsed, table, op, ctx);
}

/** The changes that write rows `lines` below row `op.after`, and move the deletions' positions. */
function insertBody(
  text: string,
  table: TableRead,
  op: TableOp & { kind: 'insertRows' },
  eol: string,
  lines: readonly string[],
): TextChange[] {
  const index = op.after + 1;
  const shifted = table.deletions.map((d) =>
    d.position > index ? d.position + lines.length : d.position,
  );
  if (op.after < 0) {
    return [...insertAbove(text, table, eol, lines), ...setPositions(text, table, shifted)];
  }
  if (!Number.isInteger(op.after) || op.after >= table.rows.length) {
    throw new EditError(NO_SUCH_ROW);
  }
  const at = insertionPoint(table, text, op.after);
  return [
    { from: at, to: at, insert: lines.map((line) => eol + line).join('') },
    ...setPositions(text, table, shifted),
  ];
}

/**
 * The same operation with Track Changes off (format §3.10): plain rows, no marks, no ledger entries.
 * What was pending in rows that go goes with them.
 *
 * @throws EditError when the operation is refused.
 */
export function untrackedTableEdit(
  text: string,
  op: TableOp,
  ctx: UntrackedContext = {},
): TableEdit {
  const parsed = parse(text);
  const table = tableOf(text, parsed, op);
  if (op.kind === 'deleteTable') return deleteTable(text, parsed, table, null, ctx);
  if (op.kind === 'fillCells') return fillCells(text, parsed, table, op, null, ctx);
  if (op.kind === 'deleteRows')
    return deleteRows(text, parsed, table, rowsOf(table, op.rows), null);
  if (op.kind === 'moveRows') {
    return moveRows(text, parsed, table, rowsOf(table, op.rows), op.to, null);
  }
  if (op.kind === 'insertCols') return insertCols(text, parsed, table, op, null);
  if (op.kind === 'deleteCols')
    return deleteCols(text, parsed, table, colsOf(table, op.cols), null);
  if (op.kind === 'moveCols') {
    return moveCols(text, parsed, table, colsOf(table, op.cols), op.to, null);
  }
  if (op.kind === 'align') return aligned(text, parsed, table, op, null);
  const refusal = ruleTwo(op.kind, pendingOf(table, parsed), false);
  if (refusal) throw new EditError(refusal, 'no-legal-placement');
  headerCheck(op, table, parsed);
  const eol = eolOf(text, parsed.ledgerRange);
  const lines = Array.from({ length: op.count }, (_, i) => rowText(table, text, '', op.texts?.[i]));
  const body = insertBody(text, table, op, eol, lines);
  const changes = commitEdit(text, body, parsed.ledger, { parsed, keepLedger: true });
  return { changes, caret: caretOf(applyChanges(text, changes), table, op) };
}

const NO_SUCH_COL = 'There is no such column in this table.';
const SHORT_ROW = 'A row of this table has fewer cells than its header. Fill it in first.';

/** The text of a new column's cell in a line of the table: the header's, the delimiter's (none), or a body row's. */
const textOf = (cells: readonly string[] | undefined, line: number): string | undefined =>
  line === 1 ? undefined : cells?.[line === 0 ? 0 : line - 1];

/** The columns an operation names, sorted and apart. */
function colsOf(table: TableRead, cols: readonly number[]): number[] {
  const sorted = [...new Set(cols)].sort((a, b) => a - b);
  if (sorted.length === 0) throw new EditError(NO_SUCH_COL);
  for (const col of sorted) {
    if (!Number.isInteger(col) || col < 0 || col >= table.aligns.length) {
      throw new EditError(NO_SUCH_COL);
    }
  }
  return sorted;
}

/** The positions of a table's deletions as indexes: a column's counts from 1 in the file. */
const indexesOf = (table: TableRead): number[] =>
  table.deletions.map((d) => (d.axis === 'col' ? d.position - 1 : d.position));

/** The columns `from` to `to` (not including) as columns that stay. */
const staying = (from: number, to: number): ColItem[] =>
  Array.from({ length: Math.max(0, to - from) }, (_, i) => ({ src: from + i }));

/** Whether a line of the table has fewer cells than the header has columns. */
const isShort = (grid: Grid): boolean =>
  grid.lines.some((line) => line.lone || line.cells.length < grid.columns);

/** The cells of column `col`, one per line, as they read with every pending change rejected: what a
 * deleted or moved column keeps (format §3.7). Found in the original view, in the column that is where
 * this one was. */
export function originalCells(text: string, parsed: Parsed, grid: Grid, col: number): string[] {
  const { table } = grid;
  const raw = () =>
    grid.lines.map((line) => {
      const cell = line.cells[col];
      return cell ? text.slice(cell.contentFrom, cell.contentTo) : '';
    });
  const touched = parsed.marks.some((mark) =>
    mark.segments.some((s) => s.open.to > table.from && s.open.from < table.to),
  );
  if (!touched) return raw();
  const tables = readTables(text, parsed);
  const view = originalView(text);
  const then = readTables(view.text, parse(view.text));
  const at = tables.findIndex((t) => t.from === table.from);
  const was = then[at];
  const index = originalOrder(table).indexOf(col);
  if (!was || tables.length !== then.length || index === -1) return raw();
  const before = gridOf(view.text, was);
  return before.lines.map((line) => {
    const cell = line.cells[index];
    return cell ? view.text.slice(cell.contentFrom, cell.contentTo) : '';
  });
}

/** Where the caret goes after a column operation: the cell of column `col` in the first body row. */
function colCaret(after: string, table: TableRead, col: number): number {
  const read = tableAfter(after, table);
  const row = read?.rows[1] ?? read?.rows[0];
  const cell = row?.cells[Math.min(col, (row?.cells.length ?? 1) - 1)];
  return cell?.textFrom ?? table.from;
}

/** A new entry of the ledger for a mark made by `ctx`. */
function entryFor(ctx: EditContext, group: string | undefined): MarkEntry {
  const entry: MarkEntry = { by: ctx.author.handle, at: ctx.time };
  if (group !== undefined) entry.group = group;
  if (ctx.note !== undefined) entry.note = ctx.note;
  return entry;
}

/** The alignment change that a plain operation on columns keeps in step: its id, whether it is gone (its old and
 * new alignments are then the same), and whether its mark is written at the end of another cell than the one it
 * stood in. */
interface KeptChange {
  id: string;
  gone: boolean;
  placed: boolean;
}

/**
 * A plain operation on columns beside an alignment change keeps it in step (format §3.7, §3.10): the grid of its
 * table with the text that the change's mark is written with once the columns `final` are made (`keepAlignInStep`),
 * and the change: `gone` where the old and the new alignments are then the same, `placed` where the mark is written
 * at the end of another cell than the one it stands in, which the caller looks at once the file is made
 * (`assertMarkHolds`): the changes pending in that cell can leave it read otherwise in some order of decisions. A
 * change that stays is looked at as soon as the file is read (`stillRead`). `ctx` is null for plain, and is the only
 * one that gets here with a change pending (`ruleTwo`). A grid with no change pending is returned as it is.
 *
 * @throws EditError when it can't be kept in step: the old row has not the table's columns, the table has another
 * alignment change, or the change is the span form that another tool wrote.
 */
function keptInStep(
  text: string,
  parsed: Parsed,
  table: TableRead,
  final: readonly ColItem[],
  grid: Grid,
  pending: TablePending,
  ctx: EditContext | null,
): { grid: Grid; change?: KeptChange } {
  if (ctx !== null || !pending.align) return { grid };
  const kept = keepAlignInStep(text, parsed, table, final);
  const mark = alignMarkOf(parsed, table);
  if (!kept || !mark || !grid.alignMark) throw new EditError(ALIGN_FIRST, 'no-legal-placement');
  const aligned = { ...grid, alignMark: { ...grid.alignMark, text: kept.opener ?? '' } };
  if (kept.opener === null)
    return { grid: aligned, change: { id: mark.id, gone: true, placed: false } };
  // The mark stands where it did when its cell stays and is the last; a mark that a merge left below the header is
  // in a row that the walk of the header does not look at.
  const { range } = grid.alignMark;
  const home = grid.lines[0]?.cells.findIndex(
    (cell) => cell.contentFrom <= range.from && range.to <= cell.contentTo,
  );
  const last = final.at(-1);
  const stays =
    home === undefined ||
    home === -1 ||
    (last !== undefined && 'src' in last && !last.moving && last.src === home);
  return { grid: aligned, change: { id: mark.id, gone: false, placed: !stays } };
}

/**
 * The check that a plain operation makes of the change it keeps, as `commitEdit` reads the file it makes: its mark
 * and its entry must be read there (`assertMarkRead`). The operation writes the mark again (its old row in step, or at
 * the end of another cell), which the edit's own check of the marks that stay takes for a removal, so that the scan's
 * pairing of backticks or comment halves across the cells could take it into code or a comment without a word.
 * `removing` is the operation's own, in the words of the refusal. `more` is another check of the same file.
 */
function stillRead(
  change: KeptChange | undefined,
  removing: boolean,
  more?: CommitOptions['verify'],
): CommitOptions['verify'] {
  if (!change || change.gone) return undefined;
  return (after, parsedAfter, written) => {
    assertMarkRead(parsedAfter, change.id, removing);
    more?.(after, parsedAfter, written);
  };
}

/** Inserting columns (format §3.7): a cell in every row, the marker in the header's. */
function insertCols(
  text: string,
  parsed: Parsed,
  table: TableRead,
  op: TableOp & { kind: 'insertCols' },
  ctx: EditContext | null,
): TableEdit {
  const pending = pendingOf(table, parsed);
  const refusal = ruleTwo('insertCols', pending, ctx !== null);
  if (refusal) throw new EditError(refusal, 'no-legal-placement');
  // The marker of an inserted column stands in the header: it can't stand in a header that is itself
  // pending (rejecting the row would take the marker, and not the column, away).
  if (ctx && table.rows[0]?.insertion) {
    throw new EditError(
      'Accept or reject the row changes in this table first.',
      'no-legal-placement',
    );
  }
  const columns = table.aligns.length;
  if (!Number.isInteger(op.after) || op.after < 0 || op.after > columns) {
    throw new EditError('There is no such place in this table.');
  }
  const grid = gridOf(text, table, parsed);
  const shape = newColumnShape(text, grid);
  const ledger = workingLedger(parsed.ledger);
  const taken = idsIn(text);
  const ids: string[] = [];
  if (ctx) {
    addPerson(ledger, ctx.author);
    const group = ctx.group ?? (op.count > 1 ? newId(taken, ctx.random) : undefined);
    if (group !== undefined) taken.add(group);
    for (let i = 0; i < op.count; i++) {
      const id = newId(taken, ctx.random);
      taken.add(id);
      ids.push(id);
      ledger.marks[id] = entryFor(ctx, group);
    }
  }
  const news: ColItem[] = Array.from({ length: op.count }, (_, i) => ({
    text: (line: number) =>
      newCellContent(
        line,
        shape,
        ctx ? `<!--ins ${ids[i]} col-->` : null,
        textOf(op.texts?.[i], line),
      ),
  }));
  const final = [...staying(0, op.after), ...news, ...staying(op.after, columns)];
  const positions = indexesOf(table).map((p, i) =>
    table.deletions[i]?.axis === 'col' && p > op.after ? p + op.count : p,
  );
  const { grid: aligned, change } = keptInStep(text, parsed, table, final, grid, pending, ctx);
  const body = joinPoints([
    ...columnChanges(text, aligned, final, true),
    ...setPositions(text, table, positions, undefined, 'col'),
  ]);
  // A change that is gone leaves the ledger, and the edit takes its mark away.
  if (change?.gone) delete ledger.marks[change.id];
  const changes = ctx
    ? commitEdit(text, body, ledger, { parsed, created: ids })
    : change?.gone
      ? commitEdit(text, body, ledger, { parsed, removes: true })
      : commitEdit(text, body, parsed.ledger, {
          parsed,
          keepLedger: true,
          verify: stillRead(change, false),
        });
  const cols = Array.from({ length: op.count }, (_, i) => op.after + i);
  const after = applyChanges(text, changes);
  if (change?.placed) assertMarkHolds(after, change.id, table.from);
  return { changes, caret: colCaret(after, table, op.after), cols };
}

/** Deleting columns (format §3.7, rules 2 to 4). `ctx` is null for plain. */
function deleteCols(
  text: string,
  parsed: Parsed,
  table: TableRead,
  cols: readonly number[],
  ctx: EditContext | null,
): TableEdit {
  const columns = table.aligns.length;
  if (columns - cols.length < 1)
    throw new EditError('Delete the table instead.', 'no-legal-placement');
  const pending = pendingOf(table, parsed);
  const refusal = ruleTwo('deleteCols', pending, ctx !== null);
  if (refusal) throw new EditError(refusal, 'no-legal-placement');
  if (ctx) {
    const three = ruleThreeCols(table, parsed, cols, ctx.author, 'delete');
    if (three) throw new EditError(three, 'no-legal-placement');
    const above = commentFromAbove(table, parsed, new Set(cols));
    if (above) throw new EditError(above, 'no-legal-placement');
  }
  // With Track Changes off the columns go from the original as well: one that is not pending must
  // remain, or the original would have none.
  if (!ctx) {
    const pure = (col: number) => {
      const mark = table.colMarks.find((c) => c.col === col)?.mark;
      return mark !== undefined && mark.entry.move === undefined;
    };
    if (originalOrder(table).length - cols.filter((col) => !pure(col)).length < 1) {
      throw new EditError(COLUMNS_FIRST, 'no-legal-placement');
    }
  }
  const grid = gridOf(text, table, parsed);
  if (ctx && grid.lines.some((line) => cols.some((col) => !line.cells[col] || line.lone))) {
    throw new EditError(SHORT_ROW, 'no-legal-placement');
  }
  const leaving = new Set(cols);
  const final = staying(0, columns).filter((item) => 'src' in item && !leaving.has(item.src));
  const { grid: aligned, change } = keptInStep(text, parsed, table, final, grid, pending, ctx);
  const before = indexesOf(table);
  const positions = before.map((p) =>
    [...cols].reverse().reduce((position, index) => afterRemoval(position, index), p),
  );
  const ledger = workingLedger(parsed.ledger);
  if (change?.gone) delete ledger.marks[change.id];
  const taken = idsIn(text);
  const added: { order: number; line: string }[] = [];
  const created: string[] = [];
  const twins = new Set<number>();
  const group = ctx
    ? (ctx.group ?? (cols.length > 1 ? newId(taken, ctx.random) : undefined))
    : undefined;
  if (group !== undefined) taken.add(group);
  if (ctx) addPerson(ledger, ctx.author);
  for (const col of cols) {
    const marked = table.colMarks.find((c) => c.col === col)?.mark;
    const twin = marked?.entry.move;
    const twinLine = twin === undefined ? -1 : table.deletions.findIndex((d) => d.mark.id === twin);
    if (marked && twinLine !== -1) {
      if (ctx === null) twins.add(twinLine);
      else {
        // Deleting your own move: the column at the new place goes, and the old place stays a deletion.
        const entry = ledger.marks[twin ?? ''];
        if (entry) {
          const { move: _move, ...rest } = entry;
          void _move;
          ledger.marks[twin ?? ''] = rest;
        }
      }
      continue;
    }
    if (!ctx || marked) continue;
    const id = newId(taken, ctx.random);
    taken.add(id);
    created.push(id);
    ledger.marks[id] = entryFor(ctx, group);
    const position = col - cols.filter((c) => c < col).length + 1;
    const payload = deletedColPayload(position, originalCells(text, parsed, grid, col));
    added.push({ order: col, line: `<!--del ${id} ${encodePayload(payload)}-->` });
  }
  const eol = eolOf(text, parsed.ledgerRange);
  // The comment points of the columns that leave stand between the marker of an inserted row and the mark of an
  // alignment change, where they are written at one place (`withCommentPoints`, which finds the mark by its text).
  const body = joinPoints([
    ...withCommentPoints(
      columnChanges(text, aligned, final),
      commentsOfCols(parsed, table, leaving).writes,
      aligned,
    ),
    ...addDeletionLines(text, table, before, added, eol),
    ...setPositions(
      text,
      table,
      positions,
      new Set(table.deletions.map((_, i) => i).filter((i) => !twins.has(i))),
      'col',
    ),
    ...removeDeletionLines(text, table, twins),
  ]);
  const touched = parsed.marks.some((mark) =>
    mark.segments.some((s) => s.open.to > table.from && s.open.from < table.to),
  );
  const plainLedger = ctx === null && !touched && twins.size === 0;
  const changes = commitEdit(
    text,
    body,
    ledger,
    plainLedger
      ? { parsed, keepLedger: true }
      : {
          parsed,
          created,
          removes: true,
          // Deleting columns passes `removes`, as a decision does, which skips the checks that hold the mark of an
          // alignment change in `commitEdit`: a plain deletion is an edit, and makes them here. The mark and its entry
          // must still be read (the scan can pair backticks or comment halves across the cells so that the mark is left
          // in code or a comment, and the check of the marks that stay takes a mark that is written again for one that
          // goes), and as written it must read as it did, as beside any other edit. The second is the gate every other
          // edit passes; no case is known where it refuses what the first and the walk of a mark that moves let through.
          verify: stillRead(change, true, (after, parsedAfter, written) =>
            assertPointsRead(text, parsed, after, parsedAfter, written),
          ),
        },
  );
  const after = applyChanges(text, changes);
  if (change?.placed) assertMarkHolds(after, change.id, table.from, true);
  const read = tableAfter(after, table);
  const target = Math.min(cols[0] ?? 0, (read?.aligns.length ?? 1) - 1);
  return { changes, caret: colCaret(after, table, target), cols: [target] };
}

/** Moving columns (format §3.7). */
function moveCols(
  text: string,
  parsed: Parsed,
  table: TableRead,
  cols: readonly number[],
  to: number,
  ctx: EditContext | null,
): TableEdit {
  const columns = table.aligns.length;
  if (!Number.isInteger(to) || to < 0 || to > columns) {
    throw new EditError('There is no such place in this table.');
  }
  const pending = pendingOf(table, parsed);
  const refusal = ruleTwo('moveCols', pending, ctx !== null);
  if (refusal) throw new EditError(refusal, 'no-legal-placement');
  if (ctx) {
    const three = ruleThreeCols(table, parsed, cols, ctx.author, 'move');
    if (three) throw new EditError(three, 'no-legal-placement');
    const above = commentFromAbove(table, parsed, new Set(cols));
    if (above) throw new EditError(above, 'no-legal-placement');
  }
  const moving = new Set(cols);
  const others = staying(0, columns).filter((item) => 'src' in item && !moving.has(item.src));
  const at = to - cols.filter((c) => c < to).length;
  const order = [
    ...others.slice(0, at).map((item) => ('src' in item ? item.src : -1)),
    ...cols,
    ...others.slice(at).map((item) => ('src' in item ? item.src : -1)),
  ];
  if (order.every((index, i) => index === i)) {
    throw new EditError('The columns are already there.', 'no-legal-placement');
  }
  const grid = gridOf(text, table, parsed);
  if (isShort(grid)) throw new EditError(SHORT_ROW, 'no-legal-placement');
  const ledger = workingLedger(parsed.ledger);
  const taken = idsIn(text);
  const created: string[] = [];
  const group = ctx
    ? (ctx.group ?? (cols.length > 1 ? newId(taken, ctx.random) : undefined))
    : undefined;
  if (group !== undefined) taken.add(group);
  if (ctx) addPerson(ledger, ctx.author);
  const markers = new Map<number, string>();
  const ghosts = new Map<number, string>();
  for (const col of cols) {
    const marked = table.colMarks.find((c) => c.col === col);
    if (!ctx || marked) continue;
    const ins = newId(taken, ctx.random);
    taken.add(ins);
    const del = newId(taken, ctx.random);
    taken.add(del);
    created.push(ins, del);
    markers.set(col, `<!--ins ${ins} col-->`);
    ghosts.set(col, del);
    for (const [id, other] of [
      [ins, del],
      [del, ins],
    ] as const) {
      ledger.marks[id] = { ...entryFor(ctx, group), move: other };
    }
  }
  const final: ColItem[] = order.map((index) => {
    if (!moving.has(index)) return { src: index };
    const marker = markers.get(index);
    return {
      src: index,
      moving: true,
      ...(marker === undefined
        ? {}
        : {
            edit: (line: number, content: string) =>
              line === 0 ? withColMarker(content, marker) : content,
          }),
    };
  });
  const before = indexesOf(table);
  let positions = before.map((p) =>
    [...cols].reverse().reduce((position, index) => afterRemoval(position, index), p),
  );
  order.forEach((index, place) => {
    if (!moving.has(index)) return;
    positions = positions.map((p, i) => afterWriting(p, place, i));
  });
  const added: { order: number; line: string }[] = [];
  for (const [col, id] of ghosts) {
    let anchor = -1;
    for (let a = col - 1; a >= 0; a--) {
      if (!moving.has(a)) {
        anchor = a;
        break;
      }
    }
    const position = (anchor === -1 ? 0 : order.indexOf(anchor) + 1) + 1;
    const payload = deletedColPayload(position, originalCells(text, parsed, grid, col));
    added.push({ order: col, line: `<!--del ${id} ${encodePayload(payload)}-->` });
  }
  const eol = eolOf(text, parsed.ledgerRange);
  const { grid: aligned, change } = keptInStep(text, parsed, table, final, grid, pending, ctx);
  const body = joinPoints([
    ...columnChanges(text, aligned, final),
    ...addDeletionLines(text, table, before, added, eol),
    ...setPositions(text, table, positions, undefined, 'col'),
  ]);
  // A change that is gone leaves the ledger, and the edit takes its mark away.
  if (change?.gone) delete ledger.marks[change.id];
  const changes = commitEdit(
    text,
    body,
    ledger,
    ctx
      ? { parsed, created }
      : change?.gone
        ? { parsed, removes: true }
        : { parsed, keepLedger: true, verify: stillRead(change, false) },
  );
  const moved = cols.map((index) => order.indexOf(index));
  const after = applyChanges(text, changes);
  if (change?.placed) assertMarkHolds(after, change.id, table.from);
  return { changes, caret: colCaret(after, table, moved[0] ?? 0), cols: moved };
}

/** The ids of the marks of `table` that are rows or deleted rows, and the twins of moves. */
export function rowMarkIds(table: TableRead): Set<string> {
  const ids = new Set<string>();
  for (const row of table.rows) if (row.insertion) ids.add(row.insertion.id);
  for (const deletion of table.deletions) if (deletion.axis === 'row') ids.add(deletion.mark.id);
  return ids;
}

/** What deciding rows comes to: the changes, and the marks that are decided with them. */
export interface RowDecision {
  changes: TextChange[];
  /** Every mark decided, the other half of a move among them. */
  decided: string[];
  /** The comments and highlights in rows that leave, which the changes deal with. */
  anchored: Set<string>;
  /** The comments and highlights in rows that are taken out and written again, which travel with
   * the text: a comment in a moved row goes back with the row. */
  travelling: Set<string>;
}

/**
 * The decision of the rows' marks `ids` of one table (format §3.7), all accepted or all rejected,
 * or, with `original`, every row mark rejected as the original view reads it. Accepting takes the
 * markers and the deletion lines away; rejecting takes inserted rows away, writes deleted rows back
 * where they were and moves a moved row back to its place. Both halves of a move are decided
 * together. Every deletion's position is rewritten as the rows around it go and come.
 *
 * @throws EditError when the table would be left with no row.
 */
export function decideRows(
  text: string,
  parsed: Parsed,
  table: TableRead,
  ids: ReadonlySet<string>,
  action: 'accept' | 'reject',
  eol: string,
  original = false,
): RowDecision {
  const rowDeletions = table.deletions
    .map((deletion, line) => ({ deletion, line }))
    .filter(({ deletion }) => deletion.axis === 'row');
  const lineOfId = new Map(rowDeletions.map(({ deletion, line }) => [deletion.mark.id, line]));
  const insOfId = new Map(
    table.rows.flatMap((row, i) => (row.insertion ? [[row.insertion.id, i] as const] : [])),
  );
  // A half of a move brings its twin.
  const wanted = new Set<string>();
  const want = (id: string) => {
    wanted.add(id);
    const twin =
      (insOfId.has(id) ? table.rows[insOfId.get(id) ?? 0]?.insertion : undefined)?.entry.move ??
      rowDeletions.find((d) => d.deletion.mark.id === id)?.deletion.mark.entry.move;
    if (twin !== undefined && (insOfId.has(twin) || lineOfId.has(twin))) wanted.add(twin);
  };
  for (const id of ids) if (insOfId.has(id) || lineOfId.has(id)) want(id);
  if (original) for (const id of [...insOfId.keys(), ...lineOfId.keys()]) wanted.add(id);

  const decidedRows = [...insOfId].filter(([id]) => wanted.has(id)).map(([, i]) => i);
  const decidedLines = new Set([...lineOfId].filter(([id]) => wanted.has(id)).map(([, l]) => l));
  const decided = [...wanted];
  const changes: TextChange[] = [];
  const anchored = new Set<string>();
  const travelling = new Set<string>();

  if (action === 'accept' && !original) {
    for (const i of decidedRows) {
      const marker = rowMarker(text, table.rows[i] as TableRowRead);
      if (marker) changes.push({ ...marker, insert: '' });
    }
    changes.push(...removeDeletionLines(text, table, decidedLines));
    return { changes, decided, anchored, travelling };
  }

  const twinLine = (i: number): number | undefined => {
    const move = table.rows[i]?.insertion?.entry.move;
    return move === undefined ? undefined : lineOfId.get(move);
  };
  // Rows that go: those inserted. A moved row comes back, in the place of its deletion.
  const relocate = (i: number) => !original && twinLine(i) !== undefined;
  const leaving = new Set(decidedRows.filter((i) => !relocate(i)));
  let positions = table.deletions.map((d) => d.position);
  const cur: RowItem[] = table.rows.map((_, src) => ({ src }));
  const out = [...decidedRows].sort((a, b) => b - a);
  // Index in `cur` of each row, as rows go.
  for (const c of out) {
    positions = positions.map((p) => afterRemoval(p, c));
    cur.splice(c, 1);
  }
  const restoring = [...decidedLines].sort((a, b) => b - a);
  for (const line of restoring) {
    const deletion = table.deletions[line] as TableDeletionRead;
    const copy = [...insOfId].find(([, i]) => twinLine(i) === line && relocate(i))?.[1];
    const item: RowItem =
      copy === undefined
        ? { text: deletedRowText(deletion.mark.payload) }
        : { src: copy, patch: relocatedPatch(text, table, copy) };
    const index = Math.min(positions[line] ?? 0, cur.length);
    cur.splice(index, 0, item);
    positions = positions.map((p, k) => (k === line ? p : afterWriting(p, index, k, line)));
  }
  if (cur.length === 0)
    throw new EditError('A table keeps at least one row.', 'no-legal-placement');
  const pending = new Set(table.deletions.map((_, k) => k).filter((k) => !decidedLines.has(k)));
  changes.push(
    ...arrangeRows(text, table, cur, eol),
    ...removeDeletionLines(text, table, decidedLines),
    ...setPositions(text, table, positions, pending),
  );
  if (!original) {
    changes.push(...commentsOf(parsed, table, leaving));
    for (const mark of parsed.marks) {
      if (mark.kind !== 'cmt' && mark.kind !== 'hl') continue;
      const at = mark.segments[0]?.open.from ?? -1;
      const row = table.rows.findIndex((r) => r.from <= at && at <= r.to);
      if (row !== -1 && leaving.has(row)) anchored.add(mark.id);
    }
    // A comment or a highlight in a row that is taken out and written again is written with it
    // (format §3.7, "Moving rows"): a decision of the text would leave its markers at the place the row
    // leaves, and the row would have them a second time where it goes.
    const rewritten = [...rewrittenRows(cur)].flatMap((i) => table.rows[i] ?? []);
    if (rewritten.length > 0) {
      const inRewritten = (at: number) => rewritten.some((row) => row.from <= at && at <= row.to);
      for (const mark of parsed.marks) {
        if ((mark.kind !== 'cmt' && mark.kind !== 'hl') || anchored.has(mark.id)) continue;
        const inside = mark.segments.some((segment) =>
          [segment.open, segment.close].some(
            (range) => range !== undefined && inRewritten(range.from),
          ),
        );
        if (inside) travelling.add(mark.id);
      }
    }
  }
  return { changes: joinPoints(changes), decided, anchored, travelling };
}

function relocatedPatch(text: string, table: TableRead, index: number): TextChange[] {
  const marker = rowMarker(text, table.rows[index] as TableRowRead);
  return marker ? [{ ...marker, insert: '' }] : [];
}

/**
 * A tracked table operation. Where the rules refuse it because of another person's pending changes
 * (or any form that would read differently in some order of decisions), it is written as a
 * replacement of the table (format §3.12, `table-widen.ts`); where no unit holds it, or the
 * operation has no meaning on the table, the refusal stands.
 *
 * @throws EditError when the operation is refused.
 */
export function tableEdit(text: string, op: TableOp, ctx: EditContext): TableEdit {
  try {
    // A table in the new text of a pending replacement takes no mark of its own there (a decision of
    // the replacement would hide it): the operation is written into the replacement's new text.
    if (inReplacementText(text, op)) return widenedTableEdit(text, op, ctx);
  } catch (first) {
    if (!(first instanceof EditError) && !(first instanceof Untrackable)) throw first;
  }
  try {
    return fineTableEdit(text, op, ctx);
  } catch (error) {
    if (!(error instanceof EditError) || !WIDENABLE.includes(error.code ?? 'markup')) throw error;
    // A request with no meaning (the last column, rows already there, columns already aligned that
    // way) is no refusal of the rules: it is answered in its own words, not written as a replacement.
    if (NO_MEANING.test(error.message)) throw error;
    try {
      return widenedTableEdit(text, op, ctx);
    } catch (second) {
      // The operation has no meaning, or no unit holds it: the refusal is the first one's.
      if (second instanceof EditError || second instanceof Untrackable) throw error;
      throw second;
    }
  }
}

/** Whether the table that `op` is on stands in the new text of a pending replacement. */
function inReplacementText(text: string, op: TableOp): boolean {
  const at = 'table' in op ? op.table : undefined;
  if (typeof at !== 'number') return false;
  return parse(text).marks.some(
    (mark) =>
      mark.kind === 'sub' &&
      mark.segments.some(
        (segment) =>
          segment.close !== undefined &&
          (segment.carrier?.to ?? segment.content.from) <= at &&
          at < segment.content.to,
      ),
  );
}

/**
 * `tableEdit`, and where no tracked write holds the operation (the fine form is refused, and no
 * unit holds a replacement of the table: an unclosed `<!--` in its header, say), the operation as
 * Track Changes off writes it, marked `untracked`: the caller asks the person first (format §3.13).
 *
 * @throws EditError when the operation is refused as `tableEdit` does and the plain one is too.
 */
export function askedTableEdit(
  text: string,
  op: TableOp,
  ctx: EditContext,
): TableEdit & { untracked?: true } {
  try {
    return tableEdit(text, op, ctx);
  } catch (error) {
    if (!(error instanceof EditError) || !WIDENABLE.includes(error.code ?? 'markup')) throw error;
    if (NO_MEANING.test(error.message)) throw error;
    try {
      return {
        ...untrackedTableEdit(text, op, { author: ctx.author, random: ctx.random }),
        untracked: true,
      };
    } catch (second) {
      if (second instanceof EditError) throw error;
      throw second;
    }
  }
}

const NO_MEANING =
  /^(Delete the table instead\.|The (rows|columns) are already there\.|The columns are already aligned that way\.|A table keeps at least one column\.|There is no such )/;

const WIDENABLE: readonly string[] = ['no-legal-placement', 'would-hide-marks', 'inside-code'];
