// Operations on a table's rows and columns (format §3.7): written as the forms the format defines,
// tracked as Word tracks them, or plain with Track Changes off (§3.10). An operation gives the
// changes of the file and where the caret goes. This file has inserting rows; the others join it.

import { lineEnd } from './blocks.ts';
import { applyChanges, eolOf } from './changes.ts';
import { EditError } from './errors.ts';
import { addPerson, commitEdit, workingLedger } from './edit-support.ts';
import { idsIn, newId } from './ids.ts';
import { encodePayload } from './payload.ts';
import { parse } from './parse.ts';
import { readTables } from './table.ts';
import type { TableDeletionRead, TableRead, TableRowRead } from './table.ts';
import { commentsOf, ruleThree } from './table-rules.ts';
import {
  addDeletionLines,
  afterRemoval,
  afterWriting,
  arrangeRows,
  deletedRowText,
  joinPoints,
  removeDeletionLines,
  rowTextOf,
  setPositions,
} from './table-rows.ts';
import type { RowItem } from './table-rows.ts';
import type { UntrackedContext } from './untracked.ts';
import { originalChanges } from './views.ts';
import type { EditContext, MarkEntry, MarkRange, Parsed, TextChange } from './types.ts';

/**
 * An operation on a table. `table` is the offset of the table's first character; `after` is the row
 * (0 the header, 1 the first body row, -1 above the header) that the new rows go below. Rows are
 * counted as written, the header 0. For a move, `to` is the boundary the rows go to: 0 above the
 * header, the number of rows below the last.
 */
export type TableOp =
  | { kind: 'insertRows'; table: number; after: number; count: number }
  | { kind: 'deleteRows'; table: number; rows: number[] }
  | { kind: 'moveRows'; table: number; rows: number[]; to: number };

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
  const columns = 'Accept or reject the column changes in this table first.';
  switch (op) {
    case 'insertRows':
      return pending.colsChanged ? columns : null;
    // A deleted or moved row keeps its cells as written, so a column inserted while it is pending
    // would be missing from it when the insertion is rejected. With Track Changes off the row is
    // taken out of the table, and only a column deleted or moved is left the wrong number of cells.
    case 'deleteRows':
    case 'moveRows':
      return pending.colsChanged || (tracked && pending.colsInserted) ? columns : null;
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

const NO_SUCH_ROW = 'There is no such row in this table.';

function tableOf(text: string, parsed: Parsed, op: TableOp): TableRead {
  const table = readTables(text, parsed).find((t) => t.from === op.table);
  if (!table) throw new EditError('There is no table there.');
  if (op.kind === 'insertRows' && (!Number.isInteger(op.count) || op.count < 1)) {
    throw new EditError('Insert at least one row.');
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
  const empty = cell.textFrom >= cell.textTo;
  const lead = row.leadingPipe ? '' : '| ';
  return lead + line.slice(0, at) + marker + (empty ? '' : ' ') + line.slice(at);
}

/** The row as it reads with every pending change in it rejected. */
function originalRowText(text: string, parsed: Parsed, row: TableRowRead): string {
  const inside = originalChanges(text, parsed).filter(
    (c) =>
      c.from >= row.from &&
      c.to <= row.to &&
      (c.to > c.from || (c.from > row.from && c.from < row.to)),
  );
  let out = '';
  let at = row.from;
  for (const c of inside) {
    out += text.slice(at, c.from) + c.insert;
    at = c.to;
  }
  return out + text.slice(at, row.to);
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
  const refusal = ruleTwo('deleteRows', pendingOf(table, parsed), ctx !== null);
  if (refusal) throw new EditError(refusal, 'no-legal-placement');
  if (ctx) {
    const three = ruleThree(table, parsed, rows, ctx.author, 'delete');
    if (three) throw new EditError(three, 'no-legal-placement');
  }
  const eol = eolOf(text, parsed.ledgerRange);
  const leaving = new Set(rows);
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
  const changes = commitEdit(text, body, ledger, { parsed, created, removes: true });
  const after = applyChanges(text, changes);
  const read = tableAfter(after, table);
  // The caret goes to the row that now sits where the first deleted one did.
  const target = Math.min(rows[0] ?? 0, (read?.rows.length ?? 1) - 1);
  const row = read?.rows[target];
  return { changes, caret: row?.cells[0]?.textFrom ?? table.from };
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
  const refusal = ruleTwo('moveRows', pendingOf(table, parsed), ctx !== null);
  if (refusal) throw new EditError(refusal, 'no-legal-placement');
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
    const payload = `row=${position} ${originalRowText(text, parsed, row)}`;
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
    ctx ? { parsed, created } : { parsed, removes: true },
  );
  const read = tableAfter(applyChanges(text, changes), table);
  const moved = rows.map((index) => order.indexOf(index));
  const first = read?.rows[moved[0] ?? 0];
  return { changes, caret: first?.cells[0]?.textFrom ?? table.from, rows: moved };
}

/**
 * An operation on a table as a tracked change by `ctx.author`: the changes of the text and the
 * ledger, and where the caret goes in the new text. New rows carry `<!--ins ID row-->` at the start
 * of their first cell; several rows made at once share a group. A deleted row is kept below the
 * table, and a moved one is written at its new place and kept as a deletion at the old.
 *
 * @throws EditError when the operation is refused, or the ledger can't be read.
 */
export function tableEdit(text: string, op: TableOp, ctx: EditContext): TableEdit {
  const parsed = parse(text);
  const table = tableOf(text, parsed, op);
  if (op.kind === 'deleteRows') return deleteRows(text, parsed, table, rowsOf(table, op.rows), ctx);
  if (op.kind === 'moveRows') {
    return moveRows(text, parsed, table, rowsOf(table, op.rows), op.to, ctx);
  }
  const refusal = ruleTwo(op.kind, pendingOf(table, parsed), true);
  if (refusal) throw new EditError(refusal, 'no-legal-placement');
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
    lines.push(rowText(table, text, `<!--ins ${id} row-->`));
  }
  const body = insertBody(text, table, op, eol, lines);
  const changes = commitEdit(text, body, ledger, { parsed, created: ids });
  return { changes, caret: caretOf(applyChanges(text, changes), table, op) };
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
  void ctx;
  const parsed = parse(text);
  const table = tableOf(text, parsed, op);
  if (op.kind === 'deleteRows')
    return deleteRows(text, parsed, table, rowsOf(table, op.rows), null);
  if (op.kind === 'moveRows') {
    return moveRows(text, parsed, table, rowsOf(table, op.rows), op.to, null);
  }
  const refusal = ruleTwo(op.kind, pendingOf(table, parsed), false);
  if (refusal) throw new EditError(refusal, 'no-legal-placement');
  const eol = eolOf(text, parsed.ledgerRange);
  const lines = Array.from({ length: op.count }, () => rowText(table, text, ''));
  const body = insertBody(text, table, op, eol, lines);
  const changes = commitEdit(text, body, parsed.ledger, { parsed, keepLedger: true });
  return { changes, caret: caretOf(applyChanges(text, changes), table, op) };
}

/** The marker of an inserted row, with the space after it when text follows (as accepting takes it). */
export function rowMarker(text: string, row: TableRowRead): { from: number; to: number } | null {
  const open = row.insertion?.segments[0]?.open;
  const cell = row.cells[0];
  if (!open || !cell) return null;
  const after = text.slice(open.to, cell.textTo > open.to ? cell.textTo : open.to);
  const to = /\S/.test(after) && /^[ \t]/.test(after) ? open.to + 1 : open.to;
  return { from: open.from, to };
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

  if (action === 'accept' && !original) {
    for (const i of decidedRows) {
      const marker = rowMarker(text, table.rows[i] as TableRowRead);
      if (marker) changes.push({ ...marker, insert: '' });
    }
    changes.push(...removeDeletionLines(text, table, decidedLines));
    return { changes, decided, anchored };
  }

  const twinLine = (i: number): number | undefined => {
    const move = table.rows[i]?.insertion?.entry.move;
    return move === undefined ? undefined : lineOfId.get(move);
  };
  // Rows that go: those inserted. A moved row comes back, in the place of its deletion.
  const relocate = (i: number) => !original && twinLine(i) !== undefined;
  const leaving = new Set(decidedRows.filter((i) => !relocate(i)));
  let positions = table.deletions.map((d) => d.position);
  const cur: RowItem[] = table.rows.map((row, src) => {
    if (!relocate(src)) return { src };
    const marker = rowMarker(text, row);
    return { src, patch: marker ? [{ ...marker, insert: '' }] : [] };
  });
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
  }
  return { changes: joinPoints(changes), decided, anchored };
}

function relocatedPatch(text: string, table: TableRead, index: number): TextChange[] {
  const marker = rowMarker(text, table.rows[index] as TableRowRead);
  return marker ? [{ ...marker, insert: '' }] : [];
}
