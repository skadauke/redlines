// Reading the tables of a file (format §3.7): each row and cell as offsets, the delimiter row, and
// the deleted rows and columns kept below the table. It reads the source as GitHub Flavored Markdown
// does, in a few lines of its own and not through a Markdown parser: the tests hold it to micromark,
// the oracle (format §12). Tables in quotes and list items are not read: their lines carry
// prefixes, and the editor leaves them as source.

import { bodyStart, lineEnd } from './blocks.ts';
import { HTML_STARTS } from './block-read.ts';
import type { MarkRange, Parsed, Range } from './types.ts';

export type TableAlign = '' | 'left' | 'center' | 'right';

/**
 * A cell: from the pipe in front of it (the start of the line for the first cell) to the next pipe
 * (the end of the line for the last, so a row's closing pipe is in its last cell). `textFrom` and
 * `textTo` leave out the padding and, in a cell that starts with one, the marker of an inserted row
 * or column and the space after it. In an empty cell they are one position: after the first space
 * of its padding, where typing reads well, or the marker's space.
 */
export interface TableCellRead {
  from: number;
  to: number;
  textFrom: number;
  textTo: number;
}

export interface TableRowRead {
  /** The row's line, from its start to the end of its text (before the line break). */
  from: number;
  to: number;
  header: boolean;
  /** Every cell as written, those past the header's width included: GFM doesn't show them. */
  cells: TableCellRead[];
  /** The `ins … row` mark at the start of the row's first cell, when it has one. */
  insertion: MarkRange | null;
  leadingPipe: boolean;
}

/** A deleted row or column kept below the table, and the position it comes back to. */
export interface TableDeletionRead {
  mark: MarkRange;
  axis: 'row' | 'col';
  position: number;
}

export interface TableRead {
  /** The start of the header row, and the end of the last row's text. */
  from: number;
  to: number;
  /** The header and the body rows, not the delimiter row. */
  rows: TableRowRead[];
  /** The delimiter row's line. */
  delimiter: Range;
  /** The alignment of each column, as the delimiter row says. */
  aligns: TableAlign[];
  /** The deletions that follow the table after one blank line, in order. */
  deletions: TableDeletionRead[];
  /** Whether every row without a marker is padded so that its pipes line up with the others'. */
  padded: boolean;
}

const QUOTE = /^ {0,3}>/;
const RULE = /^ {0,3}(?:(?:\* *){3,}|(?:- *){3,}|(?:_ *){3,})$/;
const ITEM = /^( {0,3})(?:[-+*]|\d{1,9}[.)])(?:( +)|$)/;
const ATX = /^ {0,3}#{1,6}(?:[ \t]|$)/;
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const DELIMITER_CELL = /^:?-+:?$/;
const TABLE_DELETION = /^(row|col)=(\d+)/;

const isBlank = (line: string) => /^[ \t]*$/.test(line);
const indentOf = (line: string) => /^[ \t]*/.exec(line)?.[0].length ?? 0;
const isSpace = (c: string | undefined) => c === ' ' || c === '\t';

/** The offsets of a line's pipes that start a cell: those no backslash escapes. A pipe in a code
 * span starts one too, as GFM reads it. */
function pipesOf(text: string, from: number, to: number): number[] {
  const pipes: number[] = [];
  let slashes = 0;
  for (let at = from; at < to; at++) {
    const c = text[at];
    if (c === '\\') slashes++;
    else {
      if (c === '|' && slashes % 2 === 0) pipes.push(at);
      slashes = 0;
    }
  }
  return pipes;
}

interface Split {
  leadingPipe: boolean;
  /** Where each cell starts, and where it ends: the offsets of the pipes, the line's ends. */
  cells: { from: number; open: number; to: number; close: number }[];
  /** The line is a pipe and nothing else: one empty cell in a body row, none in a header. */
  lone: boolean;
}

/** A line's cells: `open` is the pipe in front of a cell (-1 for none), `close` where its content
 * ends, which is before the closing pipe of the last cell. */
function split(text: string, start: number, end: number): Split {
  const pipes = pipesOf(text, start, end);
  let last = end;
  while (last > start && isSpace(text[last - 1])) last--;
  let first = start;
  while (first < end && isSpace(text[first])) first++;
  const leadingPipe = pipes[0] === first;
  const trailing = pipes.length > 0 && pipes.at(-1) === last - 1 && last - 1 >= first;
  const openers = [...pipes];
  // The closing pipe starts no cell. A lone pipe is both, and stands for one empty cell.
  const lone = leadingPipe && trailing && pipes.length === 1;
  if (trailing && !lone) openers.pop();
  const starts: { open: number }[] = [];
  if (!leadingPipe) starts.push({ open: -1 });
  for (const open of openers) starts.push({ open });
  if (lone) starts.splice(0, starts.length, { open: pipes[0] ?? first });
  const cells = starts.map((cell, i) => {
    const next = starts[i + 1];
    const open = cell.open;
    return {
      from: i === 0 ? start : open,
      open,
      to: next ? next.open : end,
      close: next ? next.open : trailing ? last - 1 : end,
    };
  });
  return { leadingPipe, cells, lone };
}

/** The trimmed text of a cell: the offsets of its first and last non-blank characters. */
function trimmed(text: string, from: number, to: number): Range {
  let a = from;
  let b = to;
  while (a < b && isSpace(text[a])) a++;
  while (b > a && isSpace(text[b - 1])) b--;
  return { from: a, to: b };
}

function cellOf(
  text: string,
  cell: Split['cells'][number],
  markers: Map<number, MarkRange>,
): { cell: TableCellRead; marker: MarkRange | null } {
  const contentFrom = cell.open === -1 ? cell.from : cell.open + 1;
  const contentTo = Math.max(contentFrom, cell.close);
  const { from, to } = trimmed(text, contentFrom, contentTo);
  let textFrom = from;
  let textTo = to;
  let marker: MarkRange | null = null;
  const found = markers.get(from);
  if (found && from < to) {
    marker = found;
    const end = openerEnd(found);
    textFrom = end;
    while (textFrom < to && isSpace(text[textFrom])) textFrom++;
    // A marker alone: the cell is empty, and its stop is after the space that follows the marker.
    if (textFrom >= to) {
      textFrom = Math.min(end + 1, contentTo);
      textTo = textFrom;
    }
  } else if (from === to) {
    textFrom = Math.min(contentFrom + 1, contentTo);
    textTo = textFrom;
  }
  return {
    cell: { from: cell.from, to: cell.to, textFrom, textTo },
    marker,
  };
}

function openerEnd(mark: MarkRange): number {
  return mark.segments[0]?.open.to ?? 0;
}

/** The marks of an inserted row or column, by where their marker starts. */
function tableMarkers(parsed: Parsed): Map<number, MarkRange> {
  const markers = new Map<number, MarkRange>();
  for (const mark of parsed.marks) {
    if (mark.kind !== 'ins' || (mark.payload !== 'row' && mark.payload !== 'col')) continue;
    const open = mark.segments[0]?.open;
    if (open) markers.set(open.from, mark);
  }
  return markers;
}

/** Whether a line starts a block that ends a table's rows. */
function endsTable(line: string): boolean {
  return indentOf(line) >= 4 || startsBlock(line);
}

/** Whether a line starts a block that may interrupt a paragraph. */
function startsBlock(line: string): boolean {
  if (indentOf(line) >= 4) return false;
  if (QUOTE.test(line) || RULE.test(line) || ATX.test(line) || FENCE.test(line)) return true;
  if (ITEM.test(line)) return true;
  return HTML_STARTS.some(([start]) => start.test(line));
}

/** The delimiter row's alignments, or null when the line is none for `columns` cells. */
function delimiterOf(
  text: string,
  start: number,
  end: number,
  columns: number,
): TableAlign[] | null {
  const line = text.slice(start, end);
  if (indentOf(line) >= 4 || !line.includes('|')) return null;
  // `- | -` is a list item before it is a delimiter row.
  if (/^ {0,3}-[ \t]/.test(line) || RULE.test(line)) return null;
  const { cells, lone } = split(text, start, end);
  if (lone || cells.length !== columns) return null;
  const aligns: TableAlign[] = [];
  for (const cell of cells) {
    const contentFrom = cell.open === -1 ? cell.from : cell.open + 1;
    const { from, to } = trimmed(text, contentFrom, Math.max(contentFrom, cell.close));
    const word = text.slice(from, to);
    if (!DELIMITER_CELL.test(word)) return null;
    const left = word.startsWith(':');
    const right = word.endsWith(':');
    aligns.push(left && right ? 'center' : left ? 'left' : right ? 'right' : '');
  }
  return aligns;
}

interface Line {
  start: number;
  end: number;
}

/** The alignments of the table whose header row is `line` and whose delimiter row is `next`, or
 * null when they make none. */
function headerOf(text: string, line: Line, next: Line): TableAlign[] | null {
  if (
    !text.slice(line.start, line.end).includes('|') &&
    !text.slice(next.start, next.end).includes('|')
  )
    return null;
  const head = split(text, line.start, line.end);
  if (head.lone || head.cells.length === 0) return null;
  return delimiterOf(text, next.start, next.end, head.cells.length);
}

/**
 * Every table of the file's body, in order. Not read: a table in a quote or list item, in a code
 * block, or in front matter or the ledger.
 */
export function readTables(text: string, parsed: Parsed): TableRead[] {
  const stop = parsed.ledgerRange?.from ?? text.length;
  const lines: Line[] = [];
  for (let start = bodyStart(text); start <= stop;) {
    const end = Math.min(lineEnd(text, start), stop);
    lines.push({ start, end });
    const next = text.indexOf('\n', end);
    if (next === -1 || next + 1 > stop) break;
    start = next + 1;
  }
  const markers = tableMarkers(parsed);
  const tables: TableRead[] = [];
  const lineText = (line: Line) => text.slice(line.start, line.end);

  // What the line above belongs to, which a table can't start in: a quote, a list item (by the
  // column its text starts at) and a fenced code block.
  let container: { kind: 'quote' } | { kind: 'item'; column: number } | null = null;
  let fence: string | null = null;
  let blankBefore = true;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) break;
    const content = lineText(line);
    const blank = isBlank(content);
    if (fence !== null) {
      const close = FENCE.exec(content);
      if (close?.[1]?.startsWith(fence[0] ?? '') && (close[1]?.length ?? 0) >= fence.length) {
        if (isBlank(close[2] ?? '')) fence = null;
      }
      blankBefore = false;
      continue;
    }
    if (blank) {
      if (container?.kind === 'quote') container = null;
      blankBefore = true;
      continue;
    }
    const indent = indentOf(content);
    if (container?.kind === 'item' && blankBefore && indent < container.column) container = null;
    if (container !== null) {
      // A line that holds the container's prefix is in it, and so is a lazy line of its paragraph;
      // a line that starts a block of its own ends it.
      const prefixed =
        container.kind === 'quote' ? QUOTE.test(content) : indent >= container.column;
      if (prefixed || !startsBlock(content)) {
        blankBefore = false;
        continue;
      }
      container = null;
    }
    blankBefore = false;
    if (indent >= 4) continue;
    if (QUOTE.test(content)) {
      container = { kind: 'quote' };
      continue;
    }
    const item = RULE.test(content) ? null : ITEM.exec(content);
    if (item) {
      const marker = content.slice(item[1]?.length ?? 0).search(/[ \t]|$/);
      const spaces = (item[2]?.length ?? 0) > 4 ? 1 : (item[2]?.length ?? 1);
      container = { kind: 'item', column: (item[1]?.length ?? 0) + marker + spaces };
      continue;
    }
    const open = FENCE.exec(content);
    if (open && !(open[1]?.startsWith('`') && open[2]?.includes('`'))) {
      fence = open[1] ?? '```';
      continue;
    }
    if (ATX.test(content) || RULE.test(content)) continue;
    // An HTML block, which a blank line ends or its own closer does, holds no table.
    const html = HTML_STARTS.find(([start]) => start.test(content));
    if (html) {
      if (html[1] === null) {
        while (i + 1 < lines.length && !isBlank(lineText(lines[i + 1] as Line))) i++;
      } else {
        let at = i;
        while (at < lines.length && !html[1].test(lineText(lines[at] as Line))) at++;
        i = Math.min(at, lines.length - 1);
      }
      continue;
    }

    // A header row, if the next line is a delimiter row for its cells.
    const next = lines[i + 1];
    const found = next ? headerOf(text, line, next) : null;
    if (!next || !found) continue;
    const aligns = found;

    const rows: TableRowRead[] = [];
    const readRow = (row: Line, header: boolean) => {
      const read = split(text, row.start, row.end);
      let insertion: MarkRange | null = null;
      const cells = read.cells.map((cell, index) => {
        const { cell: done, marker } = cellOf(text, cell, markers);
        if (index === 0 && marker?.payload === 'row') insertion = marker;
        return done;
      });
      rows.push({
        from: row.start,
        to: row.end,
        header,
        cells,
        insertion,
        leadingPipe: read.leadingPipe,
      });
    };
    readRow(line, true);
    let last = i + 2;
    for (; last < lines.length; last++) {
      const row = lines[last];
      const rowText = row ? lineText(row) : '';
      if (!row || isBlank(rowText) || endsTable(rowText)) break;
      readRow(row, false);
    }
    const lastRow = rows.at(-1) as TableRowRead;
    const delimiterLine = next;
    tables.push({
      from: line.start,
      to: lastRow.to,
      rows,
      delimiter: { from: delimiterLine.start, to: delimiterLine.end },
      aligns,
      deletions: deletionsOf(text, parsed, lastRow.to),
      padded: isPadded(text, rows, delimiterLine),
    });
    i = last - 1;
  }
  return tables;
}

/** The pipes of every row without a marker are where the others' are. */
function isPadded(text: string, rows: readonly TableRowRead[], delimiter: Line): boolean {
  const shape = (start: number, end: number) =>
    pipesOf(text, start, end)
      .map((pipe) => pipe - start)
      .join(',');
  const wanted = shape(delimiter.start, delimiter.end);
  return rows.every((row) => row.insertion !== null || shape(row.from, row.to) === wanted);
}

/** The deleted rows and columns that follow a table ending at `end`: after one blank line, a line
 * for each, which starts with the opener of a `del` mark whose payload says `row=` or `col=`. */
function deletionsOf(text: string, parsed: Parsed, end: number): TableDeletionRead[] {
  const found: TableDeletionRead[] = [];
  const eol = text[end] === '\r' ? 2 : 1;
  let at = end + eol;
  // One blank line.
  if (end >= text.length || at > text.length) return found;
  const blankEnd = lineEnd(text, at);
  if (!isBlank(text.slice(at, blankEnd)) || blankEnd >= text.length) return found;
  at = blankEnd + (text[blankEnd] === '\r' ? 2 : 1);
  const byOpener = new Map<number, MarkRange>();
  for (const mark of parsed.marks) {
    if (mark.kind !== 'del' || !TABLE_DELETION.test(mark.payload ?? '')) continue;
    const open = mark.segments[0]?.open;
    if (open) byOpener.set(open.from, mark);
  }
  while (at < text.length) {
    const mark = byOpener.get(at);
    if (!mark) break;
    const match = TABLE_DELETION.exec(mark.payload ?? '');
    if (!match) break;
    found.push({
      mark,
      axis: match[1] === 'row' ? 'row' : 'col',
      position: Number(match[2]),
    });
    const lineEndAt = lineEnd(text, at);
    if (lineEndAt >= text.length) break;
    at = lineEndAt + (text[lineEndAt] === '\r' ? 2 : 1);
  }
  return found;
}

/** The table that holds `pos`, from the start of its header row to the end of its last row. */
export function tableAt(text: string, parsed: Parsed, pos: number): TableRead | null {
  return readTables(text, parsed).find((table) => table.from <= pos && pos <= table.to) ?? null;
}

/** An inserted row (format §3.7) with the ranges that deciding it and the views change. */
export interface InsertedRow {
  mark: MarkRange;
  table: TableRead;
  /** The row's index in `table.rows`: 0 the header. */
  index: number;
  /** What goes when the row is accepted: the marker, and the space after it when text follows. */
  marker: Range;
  /** What goes when the row is rejected: the row and the line break before it (a header's differs,
   * see `rejectedHeader`). */
  row: Range;
}

/**
 * The inserted rows of a file. Reading the tables costs, so a file with none is answered at once.
 * The marker goes with one space after it when text follows it in the cell, and alone when the cell
 * is empty, so that a row keeps the width its cell was written with.
 */
export function insertedRows(text: string, parsed: Parsed): InsertedRow[] {
  const wanted = parsed.marks.filter((mark) => mark.kind === 'ins' && mark.payload === 'row');
  if (wanted.length === 0) return [];
  const found: InsertedRow[] = [];
  for (const table of readTables(text, parsed)) {
    table.rows.forEach((row, index) => {
      const mark = row.insertion;
      const cell = row.cells[0];
      const open = mark?.segments[0]?.open;
      if (!mark || !cell || !open) return;
      const after = text.slice(open.to, cell.textTo > open.to ? cell.textTo : open.to);
      let to = open.to;
      if (/\S/.test(after) && /^[ \t]/.test(after)) to++;
      const before = index <= 1 ? table.delimiter.to : (table.rows[index - 1]?.to ?? row.from);
      found.push({
        mark,
        table,
        index,
        marker: { from: open.from, to },
        row: { from: index === 0 ? row.from : before, to: row.to },
      });
    });
  }
  return found;
}
