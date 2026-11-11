// Operations on a table's rows and columns (format §3.7): written as the forms the format defines,
// tracked as Word tracks them, or plain with Track Changes off (§3.10). An operation gives the
// changes of the file and where the caret goes. This file has inserting rows; the others join it.

import { lineEnd } from './blocks.ts';
import { applyChanges, eolOf } from './changes.ts';
import { EditError } from './errors.ts';
import { addPerson, commitEdit, workingLedger } from './edit-support.ts';
import { idsIn, newId } from './ids.ts';
import { parse } from './parse.ts';
import { readTables } from './table.ts';
import type { TableRead } from './table.ts';
import type { UntrackedContext } from './untracked.ts';
import type { EditContext, MarkEntry, MarkRange, Parsed, TextChange } from './types.ts';

/**
 * An operation on a table. `table` is the offset of the table's first character; `after` is the row
 * (0 the header, 1 the first body row) that the new rows go below.
 */
export type TableOp = { kind: 'insertRows'; table: number; after: number; count: number };

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
}

/** Whether a mark is a half of a move. */
const isMove = (mark: MarkRange) => mark.entry.move !== undefined;

/** What is pending in `table`: marks in its rows, the deletions below it, and a format change of
 * its alignment around it. */
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
    if (mark.kind === 'fmt' && mark.segments.some((s) => /(?:^| )align=/.test(s.payload ?? ''))) {
      const around = mark.segments.some(
        (segment) =>
          (segment.open.to <= table.from &&
            table.from - (segment.carrier?.to ?? segment.open.to) <= 1) ||
          (segment.close !== undefined &&
            segment.close.from >= table.to &&
            segment.open.from <= table.from),
      );
      if (around) pending.align = true;
    }
  }
  for (const deletion of table.deletions) {
    if (deletion.axis === 'row') pending.rowsChanged = true;
    else pending.colsChanged = true;
  }
  return pending;
}

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
  void tracked;
  switch (op) {
    case 'insertRows':
      return pending.colsChanged
        ? 'Accept or reject the column changes in this table first.'
        : null;
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
function rowText(table: TableRead, text: string, first: string): string {
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
    const content = i === 0 ? first + ' '.repeat(width) : ' '.repeat(width);
    line += `| ${content} `;
  }
  return `${line}|`;
}

/** Where the new rows go: the end of the line of the row they go below. */
function insertionPoint(table: TableRead, text: string, after: number): number {
  if (!Number.isInteger(after) || after < 0 || after >= table.rows.length) {
    throw new EditError('There is no such row in this table.');
  }
  if (after === 0) return table.delimiter.to;
  return lineEnd(text, table.rows[after]?.from ?? table.to);
}

function tableOf(text: string, parsed: Parsed, op: TableOp): TableRead {
  const table = readTables(text, parsed).find((t) => t.from === op.table);
  if (!table) throw new EditError('There is no table there.');
  if (!Number.isInteger(op.count) || op.count < 1) throw new EditError('Insert at least one row.');
  return table;
}

/** Where the caret goes in the text after the changes: the first cell of the first new row. */
function caretOf(after: string, table: TableRead, op: TableOp): number {
  const read = readTables(after, parse(after)).find((t) => t.from === table.from);
  const cell = read?.rows[op.after + 1]?.cells[0];
  return cell?.textFrom ?? insertionPoint(table, after, op.after);
}

/**
 * An operation on a table as a tracked change by `ctx.author`: the changes of the text and the
 * ledger, and where the caret goes in the new text. New rows carry `<!--ins ID row-->` at the start
 * of their first cell; several rows made at once share a group.
 *
 * @throws EditError when the operation is refused, or the ledger can't be read.
 */
export function tableEdit(
  text: string,
  op: TableOp,
  ctx: EditContext,
): { changes: TextChange[]; caret: number } {
  const parsed = parse(text);
  const table = tableOf(text, parsed, op);
  const refusal = ruleTwo(op.kind, pendingOf(table, parsed), true);
  if (refusal) throw new EditError(refusal, 'no-legal-placement');
  const eol = eolOf(text, parsed.ledgerRange);
  const at = insertionPoint(table, text, op.after);

  const taken = idsIn(text);
  const ledger = workingLedger(parsed.ledger);
  addPerson(ledger, ctx.author);
  const group = ctx.group ?? (op.count > 1 ? newId(taken, ctx.random) : undefined);
  if (group !== undefined) taken.add(group);
  const ids: string[] = [];
  let insert = '';
  for (let i = 0; i < op.count; i++) {
    const id = newId(taken, ctx.random);
    taken.add(id);
    ids.push(id);
    const entry: MarkEntry = { by: ctx.author.handle, at: ctx.time };
    if (group !== undefined) entry.group = group;
    if (ctx.note !== undefined) entry.note = ctx.note;
    ledger.marks[id] = entry;
    insert += eol + rowText(table, text, `<!--ins ${id} row-->`);
  }
  const body: TextChange[] = [
    { from: at, to: at, insert },
    ...rewritePositions(text, table, op.after + 1, 1),
  ];
  const changes = commitEdit(text, body, ledger, { parsed, created: ids });
  return { changes, caret: caretOf(applyChanges(text, changes), table, op) };
}

/**
 * The same operation with Track Changes off (format §3.10): plain rows, no marks, no ledger entries.
 *
 * @throws EditError when the operation is refused.
 */
export function untrackedTableEdit(
  text: string,
  op: TableOp,
  ctx: UntrackedContext = {},
): { changes: TextChange[]; caret: number } {
  void ctx;
  const parsed = parse(text);
  const table = tableOf(text, parsed, op);
  const refusal = ruleTwo(op.kind, pendingOf(table, parsed), false);
  if (refusal) throw new EditError(refusal, 'no-legal-placement');
  const eol = eolOf(text, parsed.ledgerRange);
  const at = insertionPoint(table, text, op.after);
  let insert = '';
  for (let i = 0; i < op.count; i++) insert += eol + rowText(table, text, '');
  const body: TextChange[] = [
    { from: at, to: at, insert },
    ...rewritePositions(text, table, op.after + 1, 1),
  ];
  const changes = commitEdit(text, body, parsed.ledger, { parsed, keepLedger: true });
  return { changes, caret: caretOf(applyChanges(text, changes), table, op) };
}
