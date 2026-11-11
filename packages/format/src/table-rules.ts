// What a table asks of an edit (format §3.7), so that every allowed edit reads the same in every
// decision order:
//
// 1. A cell is one line. An edit inside a table keeps each of its lines and the unescaped pipes in
//    each: text in a row never holds an unescaped `|` or a line break, so no edit adds a cell, takes
//    one away or splits a row. The editor writes `\|` and `<br>`; the format refuses the rest, an
//    agent's edit included.
// 7. A row that starts with text and no pipe gets a plain `| ` in front when a marker has to stand
//    at its start, which a row with markers must not leave bare.

import { lineEnd, lineStart } from './blocks.ts';
import { EditError } from './errors.ts';
import { parse } from './parse.ts';
import { readTables } from './table.ts';
import type { TableDeletionRead, TableRead, TableRowRead } from './table.ts';
import type { MarkRange, Parsed, Person, Range, TextChange } from './types.ts';

export const ONE_LINE_CELL = 'In a table, write a pipe as \\| and a line break as <br>.';

/** The tables of the last text asked about: an edit asks of the same text again and again. */
let last: { text: string; tables: TableRead[] } | undefined;

/** The tables of `text`, read once for the same text. */
export function tablesIn(text: string, parsed?: Parsed): TableRead[] {
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
      if (edit.from <= table.from && edit.to >= table.to && edit.to > edit.from) continue;
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
  const point = (row: number): number | null => {
    for (let i = row + 1; i < table.rows.length; i++) {
      const cell = table.rows[i]?.cells[0];
      if (stays(i) && cell) return cell.textFrom;
    }
    for (let i = row - 1; i >= 0; i--) {
      const cells = table.rows[i]?.cells;
      const cell = cells?.[Math.min(cells.length, columns) - 1];
      if (stays(i) && cell) return cell.textTo;
    }
    return null;
  };
  const rowOf = (at: number): number =>
    table.rows.findIndex((row) => row.from <= at && at <= row.to);
  const writes = new Map<number, string[]>();
  const write = (row: number, marker: string, backwards = false) => {
    const at = point(backwards ? row : row);
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
      else write(rowOf(segment.close?.from ?? 0), `<!--/${mark.id}-->`, true);
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
      if (!leaving.has(i) && cell) return cell.textTo;
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
