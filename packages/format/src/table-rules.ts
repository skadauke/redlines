// What a table asks of an edit (format §3.7), so that every allowed edit reads the same in every
// decision order:
//
// 1. A cell is one line. An edit inside a table keeps each of its lines and the unescaped pipes in
//    each: text in a row never holds an unescaped `|` or a line break, so no edit adds a cell, takes
//    one away or splits a row. The editor writes `\|` and `<br>`; the format refuses the rest, an
//    agent's edit included.
// 6. A table that goes whole (a block deletion, §3.4) takes your own pending changes in, as rejecting
//    them would, and is refused while it holds another person's. Its comments become point comments
//    where it was.
// 7. A row that starts with text and no pipe gets a plain `| ` in front when a marker has to stand
//    at its start, which a row with markers must not leave bare.

import {
  blankAt,
  bodyStart,
  lineEnd,
  lineStart,
  nextLineStart,
  openerRange,
  prefixLength,
} from './blocks.ts';
import { EditError } from './errors.ts';
import { parse } from './parse.ts';
import { alignPointIn, indentOf, readLine, readTables } from './table.ts';
import type { TableDeletionRead, TableRead, TableRowRead } from './table.ts';
import { closersBelow, deletionLine } from './table-rows.ts';
import type { MarkRange, Parsed, Person, Range, Segment, TextChange } from './types.ts';

const ONE_LINE_CELL = 'In a table, write a pipe as \\| and a line break as <br>.';

/** The tables of the last text asked about: an edit asks of the same text again and again. */
let last: { text: string; tables: TableRead[] } | undefined;

/** The tables of `text`, read once for the same text. */
function tablesIn(text: string, parsed?: Parsed): TableRead[] {
  if (last?.text === text) return last.tables;
  const read = parsed ?? parse(text);
  const tables = readTables(text, read);
  last = { text, tables };
  return tables;
}

/** The unescaped pipes of each line of `s`. */
function pipesPerLine(s: string): number[] {
  return s.split(/\r?\n/).map((line) => {
    let count = 0;
    let slashes = 0;
    for (const c of line) {
      if (c === '\\') slashes++;
      else {
        if (c === '|' && slashes % 2 === 0) count++;
        slashes = 0;
      }
    }
    return count;
  });
}

/** Whether `edit` lies in `table`, so that it can change the table's cells: it touches the lines
 * of its rows, the delimiter row's too. */
function inTable(table: TableRead, edit: TextChange): boolean {
  return edit.from === edit.to
    ? table.from <= edit.from && edit.from <= table.to
    : edit.from < table.to && edit.to > table.from;
}

/**
 * Refuses an edit that would change a table's cells otherwise than by their text: one that adds or
 * takes away an unescaped pipe or a line break in the lines of a table. An edit over the whole
 * table, which replaces or deletes it as a block, is not one.
 *
 * @throws EditError
 */
export function checkTableEdits(text: string, edits: readonly TextChange[], parsed?: Parsed): void {
  if (!text.includes('|')) return;
  let tables: TableRead[] | undefined;
  for (const edit of edits) {
    // Cheap first: an edit that has no pipe in the lines it touches, or brings none, and no line
    // break, can't change a cell.
    const from = lineStart(text, edit.from);
    const to = lineEnd(text, edit.to);
    const before = text.slice(from, to);
    if (!before.includes('|') && !edit.insert.includes('|')) continue;
    tables ??= tablesIn(text, parsed);
    for (const table of tables) {
      if (!inTable(table, edit)) continue;
      if (coversTable(table, edit)) continue;
      // A blank line written before the table or after it only moves it: Return at the first
      // pipe or at the end of the last row.
      if (edit.from === edit.to && edit.from === table.from && /(?:\r?\n){2}$/.test(edit.insert)) {
        continue;
      }
      if (edit.from === edit.to && edit.from === table.to && /^(?:\r?\n){2}/.test(edit.insert)) {
        continue;
      }
      const after = text.slice(from, edit.from) + edit.insert + text.slice(edit.to, to);
      const was = pipesPerLine(before);
      const now = pipesPerLine(after);
      if (was.length !== now.length || was.some((count, i) => count !== now[i])) {
        throw new EditError(ONE_LINE_CELL, 'no-legal-placement');
      }
    }
  }
}

export const PENDING_PIPE =
  "This key can't be written here with Track Changes on: it would have to rewrite a pipe or a line break of the table next to a pending change, and Markdown would read the row otherwise in some order of decisions. Accept or reject the change next to it first, or turn off Track Changes.";

/**
 * Refuses an edit that was written, next to a marker, with a pipe or a line break of a table in the new text of
 * a change that the edit did not type: `changes` are what `edits` became in tracked form. A key next to a
 * marker is written again by a character when it would read otherwise, and where the next character is the
 * row's pipe, or its line break, that put the pipe in a pending insertion with a deletion of its own: rejecting
 * the one and not the other left a pipe too many or none (or, after a backslash, an escaped pipe in place of the
 * row's edge), and a cell too many or too few. Text in a row never holds a pipe or a line break that nobody typed
 * (format §3.7, "A cell is one line"), so no key is written so. A change over the whole table is the block's, as
 * in `checkTableEdits`.
 *
 * @throws EditError
 */
export function assertRowsStay(
  text: string,
  edits: readonly TextChange[],
  changes: readonly TextChange[],
  parsed?: Parsed,
): void {
  if (!text.includes('|')) return;
  // What a change brings: its new text without the markers, whose payloads write a pipe as `\|`.
  const brings = (insert: string) => insert.replace(/<!--[\s\S]*?-->/g, '');
  const count = (s: string, pattern: RegExp) => s.match(pattern)?.length ?? 0;
  const inRows = (change: TextChange, tables: readonly TableRead[]) =>
    tables.some((table) => inTable(table, change) && !coversTable(table, change));
  for (const pattern of [/\|/g, /\n/g]) {
    const typed = edits.reduce((sum, edit) => sum + count(edit.insert, pattern), 0);
    const written = changes.reduce((sum, change) => sum + count(brings(change.insert), pattern), 0);
    if (written <= typed) continue;
    const tables = tablesIn(text, parsed);
    if (
      changes.some((change) => count(brings(change.insert), pattern) > 0 && inRows(change, tables))
    ) {
      throw new EditError(PENDING_PIPE, 'no-legal-placement');
    }
  }
}

/** Whether a line above `position`, in the lines of text that run up to it, holds a pipe: the
 * header, the delimiter row or a row of a table that a line without one can be a row of. */
function pipeAbove(text: string, position: number): boolean {
  // Up by line starts, as far as the block goes, and no further: the work is the block's, as it was
  // on main, with no answer of "maybe" that makes the caller read every table of the file. A line is
  // looked at with `indexOf` and cut out only when it has no pipe, to see whether it is blank.
  let start = lineStart(text, position);
  while (start > 0) {
    const end = start - 1;
    const previous = lineStart(text, end);
    const pipe = text.indexOf('|', previous);
    if (pipe !== -1 && pipe < end) return true;
    if (text.slice(previous, end).trim() === '') return false;
    start = previous;
  }
  return false;
}

/**
 * Where a plain `| ` goes so that a marker may stand at the start of a row (rule 7): at the start of
 * the text of a row that has no leading pipe, when `edit` is at that start, or null.
 */
export function leadingPipeAt(text: string, edit: TextChange, parsed?: Parsed): number | null {
  if (!text.includes('|')) return null;
  const line = text.slice(lineStart(text, edit.from), lineEnd(text, edit.from));
  // A row with no pipe at all is one of a table too (the first under the delimiter row, say).
  if (!line.includes('|') && !pipeAbove(text, edit.from)) return null;
  for (const table of tablesIn(text, parsed)) {
    if (edit.from < table.from || edit.from > table.to) continue;
    // A deletion of the whole table is a deletion of a block, with its marker in front of the block
    // after it: nothing stands at the start of the table's first row, and the pipe is no use.
    if (coversTable(table, edit)) continue;
    const row = table.rows.find((r) => r.from <= edit.from && edit.from <= r.to);
    const cell = row?.cells[0];
    if (!row || !cell || row.leadingPipe) continue;
    if (edit.from === cell.textFrom && edit.from < row.to) return edit.from;
  }
  return null;
}

/** Whether `position` is in a row of a table, the header or a body row, not its delimiter row. */
export function isTableRowAt(text: string, position: number): boolean {
  if (!text.includes('|')) return false;
  const line = text.slice(lineStart(text, position), lineEnd(text, position));
  if (!line.includes('|')) return false;
  return tablesIn(text).some((table) =>
    table.rows.some((row) => row.from <= position && position <= row.to),
  );
}

/**
 * Whether `edit` lies in the text of one cell of a row that `handle` inserted and nobody has decided
 * (format §3.7): text typed there is part of the row's insertion, and is written as it is, with no
 * mark of its own.
 */
export function inOwnInsertedRow(
  text: string,
  edit: TextChange,
  parsed: Parsed,
  handle: string,
): boolean {
  // Cheap first, for a key anywhere in the file: the row's marker is on the line the edit is in.
  if (!text.slice(lineStart(text, edit.from), lineEnd(text, edit.to)).includes('row-->')) {
    return false;
  }
  if (!parsed.marks.some((mark) => mark.kind === 'ins' && mark.payload === 'row')) return false;
  for (const table of tablesIn(text, parsed)) {
    if (edit.from < table.from || edit.to > table.to) continue;
    const row = table.rows.find((r) => r.from <= edit.from && edit.to <= r.to);
    // The row of a move is not a row of its own: what is typed in it is a change, which travels with
    // it, so that rejecting the move leaves the original's text as the original reads.
    if (!row?.insertion || row.insertion.entry.by !== handle) continue;
    if (row.insertion.entry.move !== undefined) continue;
    const cell = row.cells.find((c) => c.textFrom <= edit.from && edit.to <= c.textTo);
    if (cell) return true;
  }
  return false;
}

/**
 * Whether `edit` lies in the text of a cell of a column that `handle` inserted and nobody has decided
 * (format §3.7): like the text of the author's own new row, it is part of the insertion and is written
 * as it is. The column of a move is not one of its own: what is typed in it is a change.
 */
export function inOwnInsertedCol(
  text: string,
  edit: TextChange,
  parsed: Parsed,
  handle: string,
): boolean {
  if (!parsed.marks.some((mark) => mark.kind === 'ins' && mark.payload === 'col')) return false;
  for (const table of tablesIn(text, parsed)) {
    if (edit.from < table.from || edit.to > table.to) continue;
    const row = table.rows.find((r) => r.from <= edit.from && edit.to <= r.to);
    if (!row) continue;
    const cell = row.cells.find((c) => c.textFrom <= edit.from && edit.to <= c.textTo);
    if (!cell) continue;
    const index = row.cells.indexOf(cell);
    const mark = table.colMarks.find((c) => c.col === index)?.mark;
    if (mark && mark.entry.by === handle && mark.entry.move === undefined) return true;
  }
  return false;
}

/** A pending move that an edit reaches: the copy (the row or column at its new place), the deletion
 * that keeps it at the old, the table, and the row or column index of the copy. */
export interface MovedCopy {
  copy: MarkRange;
  twin: TableDeletionRead;
  table: TableRead;
  axis: 'row' | 'col';
  index: number;
}

/**
 * The pending move whose copy `edit` lies in, a cell of a column or a row that is the new place of a
 * move not yet decided. With Track Changes off the edit is written in both halves of the move (format
 * §3.7), for the original has the cell at the old place and the kept copy is what it reads there.
 */
export function movedCopyAt(text: string, edit: TextChange, parsed: Parsed): MovedCopy | null {
  if (
    !parsed.marks.some(
      (m) => m.kind === 'ins' && m.entry.move && (m.payload === 'col' || m.payload === 'row'),
    )
  ) {
    return null;
  }
  for (const table of tablesIn(text, parsed)) {
    if (edit.from < table.from || edit.to > table.to) continue;
    const row = table.rows.find((r) => r.from <= edit.from && edit.to <= r.to);
    if (!row) continue;
    const twinOf = (copy: MarkRange) => table.deletions.find((d) => d.mark.id === copy.entry.move);
    if (row.insertion?.entry.move !== undefined) {
      const twin = twinOf(row.insertion);
      if (twin) {
        return { copy: row.insertion, twin, table, axis: 'row', index: table.rows.indexOf(row) };
      }
    }
    const index = cellIndexAt(row, edit.from);
    const copy = table.colMarks.find((c) => c.col === index)?.mark;
    const twin = copy?.entry.move === undefined ? undefined : twinOf(copy);
    if (copy && twin) return { copy, twin, table, axis: 'col', index };
  }
  return null;
}

/** Whether `edit` lies in a cell of a pending move's copy. */
export const inMovedCol = (text: string, edit: TextChange, parsed: Parsed): boolean =>
  movedCopyAt(text, edit, parsed) !== null;

/** The table whose first row starts at `position`, or null. */
export function tableStartsAt(text: string, parsed: Parsed, position: number): TableRead | null {
  if (!text.includes('|')) return null;
  return tablesIn(text, parsed).find((table) => table.from === position) ?? null;
}

/** The name of a person in the file's ledger, or their handle. */
function nameOf(parsed: Parsed, handle: string): string {
  return parsed.ledger.people.find((person) => person.handle === handle)?.name ?? handle;
}

/**
 * A comment that runs from one row of the table into another: in a table whose rows have no pipe at
 * their start, a comment that starts a row is written with its opener at the end of the row above
 * (a marker can't start the row), so it crosses the line break. Moving rows beside such a comment,
 * or deleting the header under it, can't be undone: the comment's refusal comes first. Returns the
 * thread's author's name with the mark, or null.
 */
export function commentAcrossRows(
  table: TableRead,
  parsed: Parsed,
  parkedOnly = false,
): { mark: MarkRange; name: string } | null {
  const rowOf = (at: number) => table.rows.findIndex((row) => row.from <= at && at <= row.to);
  for (const mark of parsed.marks) {
    if (mark.kind !== 'cmt') continue;
    for (const { open, close } of mark.segments) {
      if (!close) continue;
      const a = rowOf(open.from);
      const b = rowOf(close.from);
      if (a === -1 || b === -1 || a === b) continue;
      // Only the opener of a comment that starts the next row, parked at the end of the row it is
      // in, has no form that a move of rows carries (`parkedOnly`, #295): any other comment
      // travels with its rows, as a highlight across rows does.
      const rest = parsed.text.slice(open.to, table.rows[a]?.to ?? open.to);
      // (Other markers parked beside it are no text.)
      if (parkedOnly && rest.replace(/<!--[^]*?-->/g, '').trim() !== '') continue;
      return { mark, name: nameOf(parsed, mark.entry.by) };
    }
  }
  return null;
}

/**
 * What a highlight whose markers are to be written at `range.from` and `range.to` of `text` would do
 * to the rows of `table` that a decision of an inserted or moved row can't undo, which the highlight
 * is refused for when it is made if such a row is pending (a highlight has no point form to be left
 * as, `commentsOf`, so deciding the row would leave one of its markers, or could not be made at all):
 *
 * - `leaves`: the markers are in different rows, or one is in a row, or among the deleted rows kept
 *   under the table, and the other outside the table, before it or after it. A highlight that
 *   starts a row with no pipe at its start does, as a comment does: its opener is at the end of the
 *   row above.
 * - `hides`: both are in one row, and one is in front of the mark of that row, which the table is
 *   read by at the start of the row's first cell and would no longer find there, or right behind it,
 *   between it and the space that deciding the row takes away with it.
 *
 * `table` is read from `text`, as it is before the highlight: a marker of the highlight in front of
 * the mark of a row, or of a deleted row, would hide it from the reader.
 */
export function highlightAgainstRows(
  table: TableRead,
  text: string,
  range: Range,
): 'leaves' | 'hides' | null {
  // The deleted rows are kept below the table, each on a line that starts with its marker: they
  // are the table's, and a marker in front of one hides it as it would a row's mark.
  const end = table.deletions.reduce(
    (last, deletion) => Math.max(last, deletion.mark.segments[0]?.open.to ?? last),
    table.to,
  );
  const rowOf = (at: number) => {
    const row = table.rows.findIndex((candidate) => candidate.from <= at && at <= candidate.to);
    return row !== -1 || at <= table.to || at > end ? row : table.rows.length;
  };
  const a = rowOf(range.from);
  const b = rowOf(range.to);
  if ((a !== -1 || b !== -1) && a !== b) return 'leaves';
  for (const at of [range.from, range.to]) {
    const row = table.rows[rowOf(at)];
    const mark = row?.insertion?.segments[0]?.open;
    if (!row || !mark) continue;
    if (at === mark.to || (at <= mark.from && /^[\s|]*$/.test(text.slice(row.from, at)))) {
      return 'hides';
    }
  }
  return null;
}

/**
 * Where a marker of a comment, to be written at `at` in `text`, goes so that it does not hide the
 * mark of a pending inserted or moved row: a marker in front of the mark, at the start of the row's
 * first cell, or between the mark and its space, would take the mark out of the table's reading and
 * the row could be neither accepted nor rejected. It goes past the mark and its space, where the
 * text of the row starts. `at` when it is anywhere else.
 */
export function pastRowMark(table: TableRead, text: string, at: number): number {
  for (const row of table.rows) {
    const open = row.insertion?.segments[0]?.open;
    if (!open || at < row.from || at > open.to) continue;
    if (at === open.to || /^[\s|]*$/.test(text.slice(row.from, at))) {
      return text[open.to] === ' ' ? open.to + 1 : open.to;
    }
  }
  return at;
}

/**
 * `at`, or the place before the closing pipe of the header row that it is after: a marker after the pipe
 * is a cell more than the delimiter row has, and the header and the table are no longer read (#955,
 * #396). Past the pipe, the marker goes in front of it, at the end of the last cell's text.
 */
export function beforeHeaderPipe(table: TableRead, text: string, at: number): number {
  const header = table.rows[0];
  if (!header || at <= header.from || at > header.to) return at;
  const line = text.slice(header.from, header.to);
  const pipe = /\|\s*$/.exec(line);
  if (!pipe) return at;
  const slashes = /\\*$/.exec(line.slice(0, pipe.index))?.[0].length ?? 0;
  if (slashes % 2 === 1) return at;
  const pipeAt = header.from + pipe.index;
  return at > pipeAt ? pipeAt : at;
}

/** The marks, other than comments and highlights, that have a marker inside `row`. */
function changesIn(parsed: Parsed, row: TableRowRead): MarkRange[] {
  return parsed.marks.filter(
    (mark) =>
      mark.kind !== 'cmt' &&
      mark.kind !== 'hl' &&
      !(mark.kind === 'ins' && mark.payload === 'row') &&
      mark.segments.some((segment) =>
        [segment.open, segment.close].some(
          (range) => range !== undefined && row.from <= range.from && range.to <= row.to,
        ),
      ),
  );
}

/**
 * Rule 3 (format §3.7), for Track Changes on: another person's pending changes stay theirs. A row
 * with another person's pending change in it can't be deleted until they are decided; a row that is
 * another person's pending insertion or move can't be deleted or moved. A row that is moved takes
 * the changes in it along. Your own are folded into a deletion, or travel. Returns the refusal, which
 * names the person, or null.
 */
export function ruleThree(
  table: TableRead,
  parsed: Parsed,
  rows: readonly number[],
  author: Person | string,
  operation: 'delete' | 'move',
): string | null {
  const me = typeof author === 'string' ? author : author.handle;
  for (const index of rows) {
    const row = table.rows[index];
    if (!row) continue;
    const insertion = row.insertion;
    if (insertion && insertion.entry.by !== me) {
      const what = insertion.entry.move !== undefined ? 'moved' : 'inserted';
      return `${nameOf(parsed, insertion.entry.by)}'s ${what} row is pending. Decide it first.`;
    }
    for (const mark of changesIn(parsed, row)) {
      if (mark.entry.by === me) continue;
      if (operation === 'move') continue;
      return `${nameOf(parsed, mark.entry.by)}'s pending change is in this row. Decide it first.`;
    }
  }
  return null;
}

/**
 * Where a comment's point is written at the end of a cell's text (`at`): in front of an unescaped
 * backslash that ends the text, not after it, where the backslash would escape the marker and the file
 * would read otherwise than its newest view (#476, format §3.7, rule 4). The comment moves by one
 * character and nothing is escaped or added; a backslash that is itself escaped (an even run) stays
 * in front of the point.
 */
function beforeBackslash(text: string, at: number): number {
  let run = 0;
  while (text[at - 1 - run] === '\\') run++;
  return run % 2 === 1 ? at - 1 : at;
}

/**
 * Rule 4 (format §3.7): comments in rows that leave the table become point comments where the rows
 * were: at the start of the text of the first cell of the next row that stays, or the end of the text
 * of the last cell of the one before it, for the last. A comment with a part that stays loses only the
 * part in the rows; one with an end in them keeps its other end, the end that left standing at the
 * place. The rows themselves are taken out by other changes; these only write the points. Highlights
 * have no point form and go.
 */
export function commentsOf(
  parsed: Parsed,
  table: TableRead,
  leaving: ReadonlySet<number>,
): TextChange[] {
  const columns = table.aligns.length;
  const stays = (index: number) => !leaving.has(index) && table.rows[index] !== undefined;
  // The end of the text of the last cell of the nearest row above `row` that stays.
  const endAbove = (row: number): number | null => {
    for (let i = row - 1; i >= 0; i--) {
      const cells = table.rows[i]?.cells;
      const cell = cells?.[Math.min(cells.length, columns) - 1];
      if (stays(i) && cell) return beforeBackslash(parsed.text, cell.textTo);
    }
    return null;
  };
  const point = (row: number): number | null => {
    for (let i = row + 1; i < table.rows.length; i++) {
      const cell = table.rows[i]?.cells[0];
      if (!stays(i) || !cell) continue;
      // The start of the text of a row with no pipe at its start can't hold a marker (a renderer
      // would read the rest of the line as raw HTML): the point goes to the end of the row above.
      if (!table.rows[i]?.leadingPipe) {
        const above = endAbove(i);
        if (above !== null) return above;
      }
      return cell.textFrom;
    }
    return endAbove(row);
  };
  const rowOf = (at: number): number =>
    table.rows.findIndex((row) => row.from <= at && at <= row.to);
  const writes = new Map<number, string[]>();
  const write = (row: number, marker: string) => {
    const at = point(row);
    if (at === null) return;
    writes.set(at, [...(writes.get(at) ?? []), marker]);
  };
  for (const mark of parsed.marks) {
    if (mark.kind !== 'cmt') continue;
    const inside = (range: Range | undefined) =>
      range !== undefined && leaving.has(rowOf(range.from)) && rowOf(range.from) !== -1;
    const segments = mark.segments;
    // A part that stays, or one that is outside this table's rows, keeps the thread where it is.
    const staying = segments.some(
      (s) => !inside(s.open) && (s.close === undefined || !inside(s.close)),
    );
    let pointed = staying;
    for (const segment of segments) {
      const opens = inside(segment.open);
      const closes = segment.close !== undefined && inside(segment.close);
      if (!opens && !closes) continue;
      const openAt = rowOf(segment.open.from);
      if (opens && closes) {
        if (!pointed) {
          write(openAt, `<!--cmt ${mark.id}-->`);
          pointed = true;
        }
      } else if (opens) write(openAt, `<!--cmt ${mark.id}-->`);
      else write(rowOf(segment.close?.from ?? 0), `<!--/${mark.id}-->`);
    }
  }
  return [...writes].map(([at, markers]) => ({ from: at, to: at, insert: markers.join('') }));
}

/** The cell of a row that holds `at`, as its index: the cell whose range from the pipe in front of it
 * holds the position. */
function cellIndexAt(row: TableRowRead, at: number): number {
  // The text of a cell first (an empty cell's stop is at its pipe's edge, which the next cell's range
  // also starts at), then the pipe and padding in front of it.
  const inText = row.cells.findIndex((cell) => cell.textFrom <= at && at <= cell.textTo);
  if (inText !== -1) return inText;
  return row.cells.findIndex(
    (cell, i) => cell.from <= at && (at < cell.to || i === row.cells.length - 1),
  );
}

/** The rows of `table` with the markers of a mark in column `col`. */
function inColumn(table: TableRead, mark: MarkRange, cols: ReadonlySet<number>): boolean {
  return mark.segments.some((segment) =>
    [segment.open, segment.close].some((range) => {
      if (range === undefined) return false;
      const row = table.rows.find((r) => r.from <= range.from && range.to <= r.to);
      if (!row) return false;
      const col = cellIndexAt(row, range.from);
      return col !== -1 && cols.has(col);
    }),
  );
}

/**
 * Rule 3 (format §3.7) for columns, as `ruleThree` is for rows: another person's pending changes stay
 * theirs. A column with another person's pending change in it can't be deleted until it is decided;
 * a column that is another person's pending insertion or move can't be deleted or moved. A column that
 * is moved takes the changes in it along. Returns the refusal, which names the person, or null.
 */
export function ruleThreeCols(
  table: TableRead,
  parsed: Parsed,
  cols: readonly number[],
  author: Person | string,
  operation: 'delete' | 'move',
): string | null {
  const me = typeof author === 'string' ? author : author.handle;
  for (const col of cols) {
    const insertion = table.colMarks.find((c) => c.col === col)?.mark;
    if (insertion && insertion.entry.by !== me) {
      const what = insertion.entry.move !== undefined ? 'moved' : 'inserted';
      return `${nameOf(parsed, insertion.entry.by)}'s ${what} column is pending. Decide it first.`;
    }
    if (operation === 'move') continue;
    for (const mark of parsed.marks) {
      if (mark.kind === 'cmt' || mark.kind === 'hl' || mark.entry.by === me) continue;
      if (mark.kind === 'ins' && (mark.payload === 'row' || mark.payload === 'col')) continue;
      if (inColumn(table, mark, new Set([col]))) {
        return `${nameOf(parsed, mark.entry.by)}'s pending change is in this column. Decide it first.`;
      }
    }
  }
  return null;
}

/**
 * Rule 4 (format §3.7) for columns: comments in columns that leave the table become point comments
 * where they were: at the start of the text of the cell after, in the same row, or the end of the text
 * of the cell before for the last column. A comment with a part that stays loses only the part in the
 * columns; one with an end in them keeps its other end. Highlights have no point form and go. Gives the
 * points to write and the comments and highlights that have a marker in the columns that leave, which
 * the changes deal with.
 */
export function commentsOfCols(
  parsed: Parsed,
  table: TableRead,
  leaving: ReadonlySet<number>,
): { writes: TextChange[]; anchored: Set<string> } {
  const columns = table.aligns.length;
  const point = (row: TableRowRead, col: number): number | null => {
    for (let i = col + 1; i < Math.min(row.cells.length, columns); i++) {
      const cell = row.cells[i];
      if (!leaving.has(i) && cell) return cell.textFrom;
    }
    for (let i = Math.min(col, row.cells.length) - 1; i >= 0; i--) {
      const cell = row.cells[i];
      if (!leaving.has(i) && cell) return beforeBackslash(parsed.text, cell.textTo);
    }
    return null;
  };
  const place = (at: number): { row: TableRowRead; col: number } | null => {
    const row = table.rows.find((r) => r.from <= at && at <= r.to);
    const col = row ? cellIndexAt(row, at) : -1;
    return row && col !== -1 ? { row, col } : null;
  };
  const writes = new Map<number, string[]>();
  const write = (found: { row: TableRowRead; col: number }, marker: string) => {
    const at = point(found.row, found.col);
    if (at === null) return;
    writes.set(at, [...(writes.get(at) ?? []), marker]);
  };
  const anchored = new Set<string>();
  const inside = (range: Range | undefined) => {
    const found = range === undefined ? null : place(range.from);
    return found !== null && leaving.has(found.col) ? found : null;
  };
  for (const mark of parsed.marks) {
    if (mark.kind !== 'cmt' && mark.kind !== 'hl') continue;
    if (mark.segments.some((s) => inside(s.open) || inside(s.close))) anchored.add(mark.id);
    if (mark.kind !== 'cmt') continue;
    const staying = mark.segments.some((s) => !inside(s.open) && !inside(s.close));
    let pointed = staying;
    for (const segment of mark.segments) {
      const opens = inside(segment.open);
      const closes = inside(segment.close);
      if (!opens && !closes) continue;
      if (opens && closes) {
        if (!pointed) {
          write(opens, `<!--cmt ${mark.id}-->`);
          pointed = true;
        }
      } else if (opens) write(opens, `<!--cmt ${mark.id}-->`);
      else if (closes) write(closes, `<!--/${mark.id}-->`);
    }
  }
  return {
    writes: [...writes].map(([at, markers]) => ({ from: at, to: at, insert: markers.join('') })),
    anchored,
  };
}

/**
 * Rule 3's other case for columns: a comment that starts above the table (on a line of its own, where a
 * marker can't start the header's line) and ends in a column that moves or is deleted. Its end would go
 * with the column, or stay behind the start, and the change could not be rejected afterwards. Returns
 * the refusal, naming the comment's author, or null.
 */
export function commentFromAbove(
  table: TableRead,
  parsed: Parsed,
  cols: ReadonlySet<number>,
): string | null {
  for (const mark of parsed.marks) {
    if (mark.kind !== 'cmt') continue;
    for (const segment of mark.segments) {
      const end = segment.close;
      if (segment.open.from >= table.from || !end) continue;
      const row = table.rows.find((r) => r.from <= end.from && end.to <= r.to);
      const col = row ? cellIndexAt(row, end.from) : -1;
      if (col !== -1 && cols.has(col)) {
        const by =
          parsed.ledger.comments.find((thread) => thread.id === mark.id)?.by ?? mark.entry.by;
        return `${nameOf(parsed, by)}'s comment starts above this table and ends in this column. Delete it first, or turn off Track Changes.`;
      }
    }
  }
  return null;
}

/**
 * What belongs to a table, for deleting it whole (format §3.7, rule 6): from its first character to
 * the end of its last deletion line. The closers of marks that end with the table stand below that,
 * and are theirs.
 */
export function tableExtent(text: string, table: TableRead): Range {
  let to = table.to;
  for (const deletion of table.deletions) to = Math.max(to, deletionLine(text, deletion).to);
  return { from: table.from, to };
}

/** Whether a mark has a marker in `extent`, or has the extent between its markers: it is in the
 * table, or the table is in it. A marker in front of the table's first line, or behind its last,
 * does not touch it. */
function touchesExtent(mark: MarkRange, extent: Range): boolean {
  let from = Infinity;
  let to = -Infinity;
  for (const segment of mark.segments) {
    from = Math.min(from, segment.open.from);
    to = Math.max(to, (segment.close ?? segment.open).to);
  }
  return from <= extent.to && to >= extent.from;
}

/** Whether a mark's text holds the whole extent, as an insertion that a table is typed into does: the
 * table is part of the mark's text, which deleting it shortens, and no change of the table's own. */
function holdsExtent(mark: MarkRange, extent: Range): boolean {
  return (
    (mark.kind === 'ins' || mark.kind === 'sub') &&
    mark.segments.some(
      (segment) =>
        segment.close !== undefined &&
        segment.open.to <= extent.from &&
        extent.to <= segment.close.from,
    )
  );
}

/** A mark that is a change, which a comment and a highlight are not. */
const isChangeMark = (mark: MarkRange): boolean => mark.kind !== 'cmt' && mark.kind !== 'hl';

/**
 * Rule 6 (format §3.7), for Track Changes on: another person's pending changes stay theirs, so a table
 * that holds one can't be deleted until it is decided: a change in a cell, an inserted or moved row or
 * column, a deleted row or column kept below it, an alignment change, or a pending change that holds
 * the table in its text. Comments and highlights are no changes. Returns the refusal, which names the
 * person, or null.
 */
export function ruleSix(
  text: string,
  table: TableRead,
  parsed: Parsed,
  author: Person | string,
): string | null {
  const me = typeof author === 'string' ? author : author.handle;
  const extent = tableExtent(text, table);
  for (const mark of parsed.marks) {
    if (!isChangeMark(mark) || mark.entry.by === me || !touchesExtent(mark, extent)) continue;
    return pendingInTable(parsed, mark);
  }
  return null;
}

/** The words of the refusal of deleting a table that holds the pending change `mark`. */
export function pendingInTable(parsed: Parsed, mark: MarkRange): string {
  return `${nameOf(parsed, mark.entry.by)}'s pending change is in this table. Decide it first.`;
}

/** Whether a mark is an alignment change of a table, whose markers stand around it (format §3.7). */
const isAlignChange = (mark: MarkRange): boolean =>
  mark.kind === 'fmt' &&
  mark.segments.some((segment) => /^align=/.test(segment.payload ?? mark.payload ?? ''));

/** Whether every marker of a mark lies in `extent`, or it is an alignment change, whose markers stand
 * around the table. */
function inExtent(mark: MarkRange, extent: Range): boolean {
  const within = (range: Range | undefined) =>
    range === undefined || (extent.from <= range.from && range.to <= extent.to);
  return (
    isAlignChange(mark) ||
    mark.segments.every((segment) => within(segment.open) && within(segment.close))
  );
}

/**
 * The marks that deleting a table whole folds in (format §3.7, rule 6): the changes in the table, its
 * row and column changes and deletion lines and its alignment change, by `handle` only, or by anyone
 * with Track Changes off. A table that is part of the text of a pending insertion is no such change:
 * deleting it shortens that text. A mark that has markers in the table and outside it is not folded
 * either, which would undo what lies outside the table too (`straddlingMarks`).
 */
export function foldedMarks(
  text: string,
  table: TableRead,
  parsed: Parsed,
  handle: string | null,
): MarkRange[] {
  const extent = tableExtent(text, table);
  return parsed.marks.filter(
    (mark) =>
      isChangeMark(mark) &&
      (handle === null || mark.entry.by === handle) &&
      touchesExtent(mark, extent) &&
      !holdsExtent(mark, extent) &&
      inExtent(mark, extent),
  );
}

/** The marks of `handle` that have markers in a table and outside it, and do not hold it: undoing
 * them would undo more than the table. */
export function straddlingMarks(
  text: string,
  table: TableRead,
  parsed: Parsed,
  handle: string,
): MarkRange[] {
  const extent = tableExtent(text, table);
  return parsed.marks.filter(
    (mark) =>
      isChangeMark(mark) &&
      mark.entry.by === handle &&
      touchesExtent(mark, extent) &&
      !holdsExtent(mark, extent) &&
      !inExtent(mark, extent),
  );
}

/** The comments and highlights that have a marker in a table's rows (format §3.7, rule 6). */
interface TableAnnotations {
  /** The markers inside the rows that go: those of the comments that lie wholly in them, and every one
   * of a highlight that has one there, which goes whole. */
  removals: TextChange[];
  /** The comments that need a point where the table was: all of their parts are in it. In the order
   * of their first marker. */
  points: { id: string; by: string }[];
  /** A comment with one end in the table and the other outside (it keeps its markers), and its author. */
  crossing: { id: string; by: string } | null;
}

/**
 * Rule 6 (format §3.7) for comments: a comment in a table that is deleted whole becomes a point comment
 * where the table was, as in a row that leaves (rule 4); one with a part that stays loses only the
 * part in the table. A highlight has no point form and goes. A comment with one end in the table and
 * the other outside has no place for the end that leaves, and is reported.
 */
export function annotationsIn(parsed: Parsed, table: TableRead): TableAnnotations {
  const inside = (range: Range | undefined) =>
    range !== undefined && table.from <= range.from && range.to <= table.to;
  // The opener of a comment on the first cell of a header with no pipe at its start is alone on the
  // line above the table, which it starts as a block (§3.3): it is in the table, with its carrier.
  const opens = (segment: Segment) =>
    inside(segment.open) || (segment.carrier !== undefined && segment.carrier.to === table.from);
  const removal = (range: Range): TextChange => ({ from: range.from, to: range.to, insert: '' });
  const removals: TextChange[] = [];
  const points: { id: string; by: string }[] = [];
  let crossing: { id: string; by: string } | null = null;
  for (const mark of parsed.marks) {
    if (mark.kind !== 'cmt' && mark.kind !== 'hl') continue;
    if (!mark.segments.some((segment) => opens(segment) || inside(segment.close))) continue;
    const by = parsed.ledger.comments.find((thread) => thread.id === mark.id)?.by ?? mark.entry.by;
    if (mark.kind === 'hl') {
      for (const segment of mark.segments) {
        removals.push(removal(openerRange(segment)));
        if (segment.close) removals.push(removal(segment.close));
      }
      continue;
    }
    // A comment with a part that has one end in the table and the other outside it is left alone.
    const across = mark.segments.some(
      (segment) => segment.close !== undefined && opens(segment) !== inside(segment.close),
    );
    if (across) {
      crossing ??= { id: mark.id, by };
      continue;
    }
    let stays = false;
    for (const segment of mark.segments) {
      if (!opens(segment)) stays = true;
      else {
        removals.push(removal(openerRange(segment)));
        if (segment.close) removals.push(removal(segment.close));
      }
    }
    if (!stays) points.push({ id: mark.id, by });
  }
  return { removals, points, crossing };
}

/** The words of the refusal of a comment that runs from a table into the text around it. */
export function commentCrossesTable(parsed: Parsed, by: string): string {
  return `${nameOf(parsed, by)}'s comment runs from this table into the text next to it. Delete it first, or turn off Track Changes.`;
}

/** The words of the refusal of a comment in a table that has no text next to it to keep its point. */
export function commentHasNoPlace(parsed: Parsed, by: string): string {
  return `${nameOf(parsed, by)}'s comment is in this table, and no text next to it can keep it. Delete the comment first, or turn off Track Changes.`;
}

/** Whether a change takes out the whole table (and something): the edit of a block, not of its rows. */
function coversTable(table: TableRead, change: Range): boolean {
  return change.from <= table.from && change.to >= table.to && change.to > change.from;
}

/**
 * Where the text below a table starts: `stop`, where the text ends (the ledger's start); `right`, the
 * line right under the table and the closers of marks that end with it (on lines of their own below
 * it); and `after`, the first line with text from there on (`stop` or more when there is none).
 */
function belowTable(
  text: string,
  parsed: Parsed,
  table: TableRead,
): { stop: number; right: number; after: number } {
  const stop = parsed.ledgerRange?.from ?? text.length;
  let end = tableExtent(text, table).to;
  const closers = closersBelow(text, end);
  if (closers !== -1) end = lineEnd(text, closers);
  const right = nextLineStart(text, end);
  let after = right;
  while (after < stop && blankAt(text, after)) after = nextLineStart(text, after);
  return { stop, right, after };
}

/**
 * Where a point comment of a table that is deleted whole may stand, in the order to try them (format
 * §3.7, rule 6): at the start of the text of the block after the table, past its prefix (`- `, `> `,
 * `## `), then at the end of the text of the block before it. Either may be missing, and neither is
 * known to hold a marker: a code block holds none, which the edit that writes the point finds out.
 */
export function pointPlaces(text: string, parsed: Parsed, table: TableRead): number[] {
  const places: number[] = [];
  const { stop, after } = belowTable(text, parsed, table);
  if (after < stop) {
    const line = text.slice(after, lineEnd(text, after));
    const heading = /^#{1,6}[ \t]+/.exec(line.slice(prefixLength(line)))?.[0].length ?? 0;
    places.push(after + prefixLength(line) + heading);
  }
  const first = bodyStart(text);
  let above = lineStart(text, table.from);
  while (above > first) {
    const line = lineStart(text, above - 1);
    above = line;
    const content = text.slice(line, lineEnd(text, line));
    // A line of nothing but markers is no text to end at: a carrier follows it.
    if (content.replace(/<!--.*?-->/g, '').trim() === '') continue;
    places.push(lineEnd(text, line));
    break;
  }
  return places;
}

/** A line that opens a code fence, after at most three spaces, or after a list item's marker. */
const FENCE_OPEN = /^ {0,3}(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)*(`{3,}|~{3,})/;

/** A line that ends a code fence or is a rule, in a quote or an item or not. */
const FENCE_CLOSE_OR_RULE =
  /^[ \t>]*(?:(?:`{3,}|~{3,})[ \t]*|(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;

/** What stands next to a table, as far as deleting it whole with Track Changes on can tell (rule 6). */
interface TableNeighbours {
  /** The block after the table is a fenced code block (in a list item or not). */
  fenceAfter: boolean;
  /** That fence never closes: no line after it closes it before the ledger. */
  fenceUnclosed: boolean;
  /** Nothing follows the table but blank lines, up to the ledger. */
  endsText: boolean;
  /** The nearest line with text above the table closes a code fence, or is a rule. */
  fenceOrRuleAbove: boolean;
  /** The nearest line with text above the table is indented as code. */
  indentedAbove: boolean;
  /** The line right above the table has text: the table starts on the line under it, with no blank line. */
  underText: boolean;
  /** The nearest line with text below the table is indented as code. */
  indentedBelow: boolean;
  /** The line right below the table has text that opens an HTML comment or block, with no blank line. */
  htmlBelow: boolean;
  /** The line right above the table is a heading. */
  headingAbove: boolean;
}

/** A line that opens an HTML comment or block (CommonMark's block tags), not an autolink or inline tag. */
const HTML_OPENS =
  /^ {0,3}<(?:!--|[?!]|\/?(?:address|article|aside|blockquote|body|center|details|dialog|div|dl|dt|dd|fieldset|figure|figcaption|footer|form|h[1-6]|header|hr|html|iframe|li|main|nav|ol|p|pre|script|section|style|summary|table|tbody|td|th|thead|tr|ul)(?:[ \t>]|\/>|$))/i;

/** What stands next to `table`. */
export function neighboursOf(text: string, parsed: Parsed, table: TableRead): TableNeighbours {
  const { stop, after, right } = belowTable(text, parsed, table);
  const next = after < stop ? text.slice(after, lineEnd(text, after)) : null;
  const directBelow =
    right < stop && !blankAt(text, right) ? text.slice(right, lineEnd(text, right)) : null;
  // The nearest line with text above the table, and whether it is the line right above.
  const first = bodyStart(text);
  let above: { line: string; directly: boolean; at: number } | null = null;
  let line = lineStart(text, table.from);
  for (let directly = true; line > first && above === null; directly = false) {
    line = lineStart(text, line - 1);
    if (!blankAt(text, line)) {
      above = { line: text.slice(line, lineEnd(text, line)), directly, at: line };
    }
  }
  // Indented as code: a run of indented lines that a blank line, or the start of the text, comes before
  // (an indented line under a paragraph's line continues the paragraph, it is no code).
  let codeAbove = false;
  if (above !== null && indentOf(above.line) >= 4) {
    let start = above.at;
    while (start > first) {
      const before = lineStart(text, start - 1);
      if (blankAt(text, before)) break;
      if (indentOf(text.slice(before, lineEnd(text, before))) < 4) break;
      start = before;
    }
    codeAbove = start <= first || blankAt(text, lineStart(text, start - 1));
  }
  const fence = next === null ? null : FENCE_OPEN.exec(next);
  let fenceUnclosed = false;
  if (fence?.[1] && after < stop) {
    const run = fence[1];
    const close = new RegExp(
      `^[ \\t>]*${run.charAt(0) === '`' ? '`' : '~'}{${run.length},}[ \\t]*$`,
    );
    fenceUnclosed = true;
    for (let at = nextLineStart(text, after); at < stop; at = nextLineStart(text, at)) {
      if (close.test(text.slice(at, lineEnd(text, at)))) {
        fenceUnclosed = false;
        break;
      }
    }
  }
  return {
    fenceAfter: fence !== null,
    fenceUnclosed,
    endsText: next === null,
    fenceOrRuleAbove: above !== null && FENCE_CLOSE_OR_RULE.test(above.line),
    indentedAbove: codeAbove,
    underText: above?.directly === true,
    // Indented code needs a blank line before it: right under the table it is a row's lazy text.
    indentedBelow: next !== null && after > right && indentOf(next) >= 4,
    htmlBelow: directBelow !== null && HTML_OPENS.test(directBelow),
    headingAbove: above?.directly === true && /^ {0,3}#{1,6}(?:[ \t]|$)/.test(above.line),
  };
}

/** The words of the refusal of deleting a table that no marker can be written next to (rule 6), by what
 * stands in the way. Each says what to do. */
export const NEXT_TO_WORDS = {
  /** A code fence follows the table: a marker in front of it would unread the fence. */
  codeAfter:
    "This table can't be deleted with Track Changes on while a code block follows it with no text between. Put a paragraph between them first, or turn off Track Changes.",
  /** A code fence follows the table and never closes: the fix is the fence's, not a paragraph. */
  codeAfterUnclosed:
    "This table can't be deleted with Track Changes on while a code block that is never closed follows it. Close the code block first, or turn off Track Changes.",
  /** The table ends the text, and what is before it is code or a rule, which no marker may end. */
  codeBefore:
    "This table can't be deleted with Track Changes on while it ends the text right after a code block or a rule. Put a paragraph between them first, or turn off Track Changes.",
  /** The table starts right under the line above it, with no break in front of it. */
  underText:
    "This table can't be deleted with Track Changes on while it starts right under the line above it, with no blank line between. Put a blank line between them first, or turn off Track Changes.",
  /** An HTML comment or block follows the table on the next line. */
  htmlBelow:
    "This table can't be deleted with Track Changes on while an HTML comment or block follows it with no blank line between. Put a blank line between them first, or turn off Track Changes.",
  /** Indented code stands above the table and below it. */
  codeBetween:
    "This table can't be deleted with Track Changes on while indented code stands both above and below it. Put a paragraph between the table and one of the code blocks first, or turn off Track Changes.",
  /** The table starts right under a heading with closing #s or attributes. */
  underHeading:
    "This table can't be deleted with Track Changes on while it starts right under a heading that has closing #s or attributes. Put a blank line between them first, or turn off Track Changes.",
} as const;

/** A pipe written plain beside an edit (format §3.7, rule 7): where, what, and whether text at that
 * place stays after it (a leading pipe) or before it (a trailing one). */
export interface PipeWrite {
  at: number;
  insert: string;
  leading: boolean;
}

/**
 * The outer pipes an edit needs so that a table keeps its cells (format §3.7, rule 7). A row of a table
 * with no leading pipe starts with its first cell's text, and one with no trailing pipe ends with its
 * last cell's: an edit that takes all the text of that cell away (a deletion, tracked or not) would leave
 * the pipe beside it at the edge of the row, where GFM reads it as the row's own and the row has a cell
 * less, a header one too few for the delimiter row, and the table is none. A pipe is written plain, in
 * both versions, in its place: `| ` in front of the first cell, ` |` after the last. Empty when the edit
 * takes some other text, replaces, or is in no such row. Looks at the edited line first, and at the
 * tables only when that line could be one. The mark of an alignment change that ends a cell is no part of
 * the cell's text (`alignPointIn`), so a deletion of all that text empties the cell, and the pipe goes
 * after the mark, at the line's end, where the cell ends in both versions.
 */
export function outerPipeWrites(text: string, edit: TextChange, parsed?: Parsed): PipeWrite[] {
  if (edit.from === edit.to || edit.insert.trim() !== '' || !text.includes('|')) return [];
  const start = lineStart(text, edit.from);
  const end = lineEnd(text, edit.from);
  if (edit.to > end) return [];
  const line = readLine(text, start, end);
  if (line.lone) return [];
  // A row of one cell keeps it with a pipe at one end, and needs the other once the text is gone: with
  // none left, a lone pipe is no cell, the header is one cell less than the delimiter row, and the table is
  // none. (The mark of an alignment change that ends the cell of a header is no text either.)
  const only = line.cells.length === 1 ? line.cells[0] : undefined;
  if (line.cells.length < 2 && !only) return [];
  // The cell's text is all in the edit. What stays is no text: the mark of an alignment change that ends the
  // cell, and the markers of other changes, a comment's among them, and the text that another person's
  // pending deletion holds, which the newest view does not read.
  const emptied = (index: number): boolean => {
    const cell = line.cells[index];
    if (!cell) return false;
    const to = alignPointIn(text, cell.contentFrom, cell.contentTo)?.from ?? cell.contentTo;
    const content = text.slice(cell.contentFrom, to);
    // The text of the cell as the newest view has it, each character in its place, the rest blanked.
    const seen = content
      .replace(/<!--del (\w{4})\b[^>]*-->[\s\S]*?<!--\/\1-->/g, (m) => ' '.repeat(m.length))
      .replace(/<!--[\s\S]*?-->/g, (m) => ' '.repeat(m.length));
    if (seen.trim() === '') return false;
    const first = cell.contentFrom + (seen.length - seen.trimStart().length);
    const last = cell.contentFrom + seen.trimEnd().length;
    return edit.from <= first && last <= edit.to;
  };
  const writes: PipeWrite[] = [];
  if (!line.leadingPipe && emptied(0)) writes.push({ at: start, insert: '| ', leading: true });
  if (!line.trailingPipe && emptied(line.cells.length - 1)) {
    writes.push({ at: end, insert: ' |', leading: false });
  }
  if (writes.length === 0) return [];
  // Only a row of a table has cells.
  const table = tablesIn(text, parsed).find((t) => t.from <= start && end <= t.to);
  const row = table?.rows.find((r) => r.from === start);
  // A body row of one cell that is a pipe alone stands for the empty cell (and takes a column back);
  // only a header has to keep its cells.
  if (line.cells.length === 1 && !row?.header) return [];
  return row ? writes : [];
}

/** A position of a text after `writes` are made in it. Text at the place of a leading pipe moves after
 * it, text at a trailing one stays before it. */
function pipeShifted(writes: readonly PipeWrite[], at: number): number {
  return (
    at +
    writes
      .filter((write) => (write.leading ? write.at <= at : write.at < at))
      .reduce((sum, write) => sum + write.insert.length, 0)
  );
}

/** The edit `edit` of a text as an edit of the text after `writes`, and the changes that edit then
 * makes there as changes of the text before them, with the pipes written first. */
export function throughPipes(
  writes: readonly PipeWrite[],
  edit: TextChange,
  make: (edit: TextChange) => TextChange[],
  text: string,
): { text: string; changes: TextChange[] } {
  const sorted = writes.toSorted((a, b) => a.at - b.at || Number(b.leading) - Number(a.leading));
  let written = text;
  let offset = 0;
  for (const write of sorted) {
    const at = write.at + offset;
    written = written.slice(0, at) + write.insert + written.slice(at);
    offset += write.insert.length;
  }
  const done = make({
    ...edit,
    from: pipeShifted(sorted, edit.from),
    to: pipeShifted(sorted, edit.to),
  });
  const back = (at: number) => {
    let shift = 0;
    let passed = 0;
    for (const write of sorted) {
      if (write.at + shift + write.insert.length <= at) passed += write.insert.length;
      shift += write.insert.length;
    }
    return at - passed;
  };
  const changes: TextChange[] = sorted.map(({ at, insert }) => ({ from: at, to: at, insert }));
  for (const change of done)
    changes.push({ ...change, from: back(change.from), to: back(change.to) });
  return {
    text: written,
    changes: changes.toSorted((a, b) => a.from - b.from || a.to - b.to),
  };
}

/**
 * Whether a marker of a highlight or a comment placed at `at` is in a row that is inserted or
 * moved and pending, or in front of its mark, where a decision of the row would take it away or
 * hide the mark (`highlightAgainstRows`'s `hides`).
 */
export function inPendingRow(table: TableRead, text: string, at: number): boolean {
  // Among the deleted rows kept under the table, a marker would hide a row's line.
  const end = table.deletions.reduce(
    (last, deletion) => Math.max(last, deletion.mark.segments[0]?.open.to ?? last),
    table.to,
  );
  return (
    (at > table.to && at <= end) ||
    table.rows.some((row) => row.insertion !== null && row.from <= at && at <= row.to) ||
    highlightAgainstRows(table, text, { from: at, to: at }) === 'hides'
  );
}

/**
 * The ranges that a highlight or a comment on `wanted` is widened to, for a table with a row
 * inserted or moved and pending, smallest first: each end that is in a row is taken to the text of a
 * row that is not pending, above for the start and below for the end, so that no decision of a row
 * can take a marker away (format §3.12). An end outside the table stays where it is. The caller
 * tries each, as the places of the markers may still fall in a pending row.
 */
export function rowWidenings(table: TableRead, text: string, wanted: Range): Range[] {
  const rowOf = (at: number) => table.rows.findIndex((row) => row.from <= at && at <= row.to);
  // The text of a row, between its outer pipes: where its first marker may start, and its last end.
  const span = (index: number): Range => {
    const row = table.rows[index] as TableRowRead;
    const line = text.slice(row.from, row.to);
    const first = line.search(/[^\s|]/);
    const last = line.search(/[^\s|][\s|]*$/);
    return { from: row.from + Math.max(first, 0), to: row.from + Math.max(last, 0) + 1 };
  };
  const a = rowOf(wanted.from);
  const b = rowOf(wanted.to);
  const froms = [wanted.from];
  if (a !== -1) {
    for (let i = a; i >= 0; i--) {
      if (table.rows[i]?.insertion === null) froms.push(span(i).from);
    }
  }
  const tos = [wanted.to];
  if (b !== -1) {
    for (let i = b; i < table.rows.length; i++) {
      if (table.rows[i]?.insertion === null) tos.push(span(i).to);
    }
  }
  // Last: past the table, to the line of text before it or after it, where its rows have no place.
  if (a !== -1) {
    const before = text.slice(0, table.from).replace(/\s+$/, '');
    if (before !== '') froms.push(before.lastIndexOf('\n') + 1);
  }
  if (b !== -1) {
    const after = /^(?:\s*<!--del [^\n]*-->)*\s*([^\n]+)/.exec(text.slice(table.to));
    if (after?.[1] && !after[1].startsWith('<!-- redlines')) {
      tos.push(table.to + after[0].length);
    }
  }
  const pairs = froms.flatMap((from, i) => tos.map((to, j) => ({ from, to, size: i + j })));
  return pairs.toSorted((x, y) => x.size - y.size).map(({ from, to }) => ({ from, to }));
}
