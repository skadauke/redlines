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
import type { TableRead } from './table.ts';
import type { Parsed, TextChange } from './types.ts';

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
  // Walk up by line starts without cutting a string for each line. A run longer than the bound is
  // answered "maybe" (true): the caller then reads the tables, which is exact.
  let start = lineStart(text, position);
  for (let lines = 0; start > 0; lines++) {
    if (lines >= PIPE_ABOVE_LINES) return true;
    const end = start - 1;
    const previous = lineStart(text, end);
    let blank = true;
    for (let i = previous; i < end; i++) {
      const c = text.charCodeAt(i);
      if (c === 124) return true;
      if (c !== 32 && c !== 9 && c !== 13) blank = false;
    }
    if (blank) return false;
    start = previous;
  }
  return false;
}

const PIPE_ABOVE_LINES = 8;

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
    if (!row?.insertion || row.insertion.entry.by !== handle) continue;
    const cell = row.cells.find((c) => c.textFrom <= edit.from && edit.to <= c.textTo);
    if (cell) return true;
  }
  return false;
}

/** The table whose first row starts at `position`, or null. */
export function tableStartsAt(text: string, parsed: Parsed, position: number): TableRead | null {
  if (!text.includes('|')) return null;
  return tablesIn(text, parsed).find((table) => table.from === position) ?? null;
}
