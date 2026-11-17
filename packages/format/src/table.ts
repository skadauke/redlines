// Reading the tables of a file (format §3.7): each row and cell as offsets, the delimiter row, and
// the deleted rows and columns kept below the table. It reads the source as GitHub Flavored Markdown
// does, in a few lines of its own and not through a Markdown parser: the tests hold it to micromark,
// the oracle (format §12). Tables in quotes and list items are not read: their lines carry
// prefixes, and the editor leaves them as source.

import { bodyStart, lineEnd } from './blocks.ts';
import { HTML_STARTS, indentColumns } from './block-read.ts';
import { isAlignPayload } from './format-ops.ts';
import type { MarkRange, Parsed, Range } from './types.ts';

export type TableAlign = '' | 'left' | 'center' | 'right';

/**
 * A cell: from the pipe in front of it (the start of the line for the first cell) to the next pipe
 * (the end of the line for the last, so a row's closing pipe is in its last cell). `textFrom` and
 * `textTo` leave out the padding and, in a cell that starts with one, the marker of an inserted row
 * or column and the space after it, and, in a cell that ends with one, the mark of an alignment
 * change (`alignPointIn`): the text stops in front of it. In an empty cell they are one position:
 * after the first space of its padding, where typing reads well, or the marker's space, or in front
 * of the mark that is all the cell holds.
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
  /** The inserted columns: the `ins … col` marks in the header row, and the header cell (the column)
   * each stands in. */
  colMarks: { mark: MarkRange; col: number }[];
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
export const indentOf = indentColumns;
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
  /** The line ends with a pipe that closes its last cell. */
  trailingPipe: boolean;
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
  return { leadingPipe, trailingPipe: trailing && !lone, cells, lone };
}

/** A line of a table as the cells it is made of, for the operations on columns: each cell as the
 * range it takes up with the pipe in front of it (a `unit`, which taking a column out removes) and
 * the range between its pipes (its `content`, as written, padding included). */
export interface TableLineRead {
  from: number;
  to: number;
  leadingPipe: boolean;
  trailingPipe: boolean;
  /** A line that is a pipe and nothing else, which has no cell to speak of. */
  lone: boolean;
  cells: { open: number; close: number; contentFrom: number; contentTo: number }[];
}

/**
 * The cells of the line `text[start, end)`, found by the text alone. The first cell of a line with no
 * leading pipe has its start for `open`, and no pipe of its own: its unit is its content.
 */
export function readLine(text: string, start: number, end: number): TableLineRead {
  const read = split(text, start, end);
  return {
    from: start,
    to: end,
    leadingPipe: read.leadingPipe,
    trailingPipe: read.trailingPipe,
    lone: read.lone,
    cells: read.lone
      ? []
      : read.cells.map((cell) => {
          const open = cell.open === -1 ? start : cell.open;
          const contentFrom = cell.open === -1 ? start : cell.open + 1;
          return {
            open,
            close: cell.close,
            contentFrom,
            contentTo: Math.max(contentFrom, cell.close),
          };
        }),
  };
}

/** The trimmed text of a cell: the offsets of its first and last non-blank characters. */
function trimmed(text: string, from: number, to: number): Range {
  let a = from;
  let b = to;
  while (a < b && isSpace(text[a])) a++;
  while (b > a && isSpace(text[b - 1])) b--;
  return { from: a, to: b };
}

/** An alignment change written as a point (format §3.7): `<!--fmt ID align=SPEC-->`, an id of four
 * characters, a payload that starts with `align=` and stays on its line, up to its first `-->`. */
const ALIGN_POINT =
  /<!--fmt [bcdfghjkmnpqrstvwxz][bcdfghjkmnpqrstvwxz23456789]{3} align=[^\r\n]*?-->/y;

/** What a mark is at least: its opener and `-->`, with nothing in its payload but `align=`. */
const SHORTEST_POINT = '<!--fmt k3x9 align=-->'.length;

/** What an opener has in front of its payload: `<!--fmt `, the id and a space. */
const POINT_HEAD = '<!--fmt k3x9 '.length;

/**
 * The mark of an alignment change that ends `text[from, to)`, white space after it aside: one whole
 * `<!--fmt ID align=…-->` that starts in the range and has its first `-->` for its end, as the scan
 * reads a marker, and whose value is a delimiter row, as the parse reads a point (`isAlignPayload`).
 * It is a point (no closer), and it stands at the end of the text of the header row's last cell
 * (format §3.7). Null when the range ends otherwise, or in an `align=` that is no alignment change,
 * which the parse leaves as the text it is. It reads the text alone, so that `readTables` and
 * `readRowCells`, which the editor's model calls with no parse of the file, find the same mark in the
 * same cell.
 */
export function alignPointIn(text: string, from: number, to: number): Range | null {
  let end = to;
  while (end > from && isSpace(text[end - 1])) end--;
  // Nearly every cell ends in some other way, and is answered at once.
  if (end - from < SHORTEST_POINT || !text.startsWith('-->', end - 3)) return null;
  // The range alone: a long text is not searched past the cell.
  const cell = text.slice(from, end);
  for (let at = cell.indexOf('<!--fmt '); at !== -1; at = cell.indexOf('<!--fmt ', at + 1)) {
    ALIGN_POINT.lastIndex = at;
    const found = ALIGN_POINT.exec(cell);
    // The first opener whose first `-->` is the end is the marker: an opener after it is in its payload.
    if (found && at + found[0].length === cell.length) {
      return isAlignPayload(found[0].slice(POINT_HEAD, -3)) ? { from: from + at, to: end } : null;
    }
  }
  return null;
}

/** The marker of an inserted row or column at a position: where it ends, and its mark when known. */
type MarkerAt = (at: number) => { end: number; mark: MarkRange | null } | null;

function cellOf(
  text: string,
  cell: Split['cells'][number],
  markerAt: MarkerAt,
): { cell: TableCellRead; marker: MarkRange | null } {
  const contentFrom = cell.open === -1 ? cell.from : cell.open + 1;
  const contentTo = Math.max(contentFrom, cell.close);
  const content = trimmed(text, contentFrom, contentTo);
  const from = content.from;
  // The mark of an alignment change that ends the text is no part of it: the text stops in front of
  // it. A marker of an inserted row or column at its start and this mark at its end can be in one cell.
  const point = from < content.to ? alignPointIn(text, from, content.to) : null;
  const to = point ? point.from : content.to;
  let textFrom = from;
  let textTo = to;
  let marker: MarkRange | null = null;
  const found = from < to ? markerAt(from) : null;
  if (found) {
    marker = found.mark;
    const end = found.end;
    textFrom = end;
    while (textFrom < to && isSpace(text[textFrom])) textFrom++;
    // A marker alone: the cell is empty, and its stop is after the space that follows the marker,
    // and never past the mark that ends the cell.
    if (textFrom >= to) {
      textFrom = Math.min(end + 1, point ? point.from : contentTo);
      textTo = textFrom;
    }
  } else if (from === to) {
    // No text: one stop, in front of the mark that is all the cell holds, or after the first space of
    // its padding.
    textFrom = point ? point.from : Math.min(contentFrom + 1, contentTo);
    textTo = textFrom;
  }
  return {
    cell: { from: cell.from, to: cell.to, textFrom, textTo },
    marker,
  };
}

/** The markers of an inserted line break or the end of an insertion that end a line of a table
 * (§3.7, "A table inserted with Track Changes on"). */
const TRAILING_MARKERS = /(?:<!--(?:split [a-z0-9]{4}|\/[a-z0-9]{4})-->)+(?=[ \t]*$)/;

/** `text` with the markers that end it as spaces: the same length, so the same positions. A row
 * of a pending inserted table ends with one, which is no cell of the row. */
export function blankTrailingMarkers(text: string): string {
  return text.replace(TRAILING_MARKERS, (marker) => ' '.repeat(marker.length));
}

/** Where the markers that end the line stand from `at` on: the end of those that `readTables` leaves out of the
 * cell (`blankTrailingMarkers`), or `at` when none follows. The mark of an alignment change goes after them
 * (format §3.7, "Where the mark stands"): a comment's closer that ends a header with no closing pipe is
 * one of the marks that end the text. */
export function trailingMarkersEnd(text: string, at: number): number {
  const eol = text.indexOf('\n', at);
  const line = text.slice(at, eol === -1 ? text.length : eol).replace(/\r$/, '');
  const found = /^(?:<!--(?:split [a-z0-9]{4}|\/[a-z0-9]{4})-->)+(?=[ \t]*$)/.exec(line);
  return found ? at + found[0].length : at;
}

/** The marker of an inserted row or column as it is written, `<!--ins ID row-->` or `col`. */
const TABLE_MARKER =
  /<!--ins [bcdfghjkmnpqrstvwxz][bcdfghjkmnpqrstvwxz23456789]{3} (?:row|col)-->/y;

/** Where the marker of an inserted row or column that starts at `at` ends, or null: for a reader
 * that has no parse of the file to ask. */
export function tableMarkerEnd(text: string, at: number): number | null {
  if (text.charCodeAt(at) !== 60) return null;
  TABLE_MARKER.lastIndex = at;
  return TABLE_MARKER.test(text) ? TABLE_MARKER.lastIndex : null;
}

/**
 * The cells of the line `text[start, end)` as a row of a table, found by the text alone: a row's
 * line, with the marker of an inserted row or column at the start of a cell read as it is written.
 */
export function readRowCells(
  text: string,
  start: number,
  end: number,
): { cells: TableCellRead[]; leadingPipe: boolean } {
  const read = split(text, start, end);
  const markerAt: MarkerAt = (at) => {
    const to = tableMarkerEnd(text, at);
    return to === null ? null : { end: to, mark: null };
  };
  return {
    leadingPipe: read.leadingPipe,
    cells: read.cells.map((cell) => cellOf(text, cell, markerAt).cell),
  };
}

/** The alignments of a delimiter row `text[start, end)` for `columns` cells, or null when the line
 * is no delimiter row for them. */
export function readDelimiterRow(
  text: string,
  start: number,
  end: number,
  columns: number,
): TableAlign[] | null {
  return delimiterOf(text, start, end, columns);
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
export function readTables(source: string, parsed: Parsed): TableRead[] {
  // The markers that end a line are no cell: a table inserted as a whole has one on each line.
  const text = source.split('\n').map(blankTrailingMarkers).join('\n');
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
  const markerAt: MarkerAt = (at) => {
    const mark = markers.get(at);
    const open = mark?.segments[0]?.open;
    return mark && open ? { end: open.to, mark } : null;
  };
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
        const { cell: done, marker } = cellOf(text, cell, markerAt);
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
    const header = rows[0] as TableRowRead;
    const colMarks = [...markers.values()]
      .filter((mark) => mark.payload === 'col')
      .flatMap((mark) => {
        const at = mark.segments[0]?.open.from ?? -1;
        const col = header.cells.findIndex(
          (cell) => cell.from <= at && at < Math.max(cell.to, cell.from + 1),
        );
        return at >= header.from && at <= header.to && col !== -1 ? [{ mark, col }] : [];
      })
      .sort((a, b) => a.col - b.col);
    tables.push({
      from: line.start,
      to: Math.max(lastRow.to, delimiterLine.end),
      rows,
      delimiter: { from: delimiterLine.start, to: delimiterLine.end },
      aligns,
      deletions: deletionsOf(text, parsed, Math.max(lastRow.to, delimiterLine.end)),
      colMarks,
      padded: isPadded(text, rows, delimiterLine),
    });
    i = last - 1;
  }
  return tables;
}

/** `line` without the marks of alignment changes that end its cells (`alignPointIn`). */
function withoutPoints(line: string): string {
  let out = '';
  let at = 0;
  for (const cell of split(line, 0, line.length).cells) {
    const contentFrom = cell.open === -1 ? cell.from : cell.open + 1;
    const { from, to } = trimmed(line, contentFrom, Math.max(contentFrom, cell.close));
    const point = from < to ? alignPointIn(line, from, to) : null;
    if (!point) continue;
    out += line.slice(at, point.from);
    at = point.to;
  }
  return out + line.slice(at);
}

/** The pipes of every row without a marker are where the others' are. */
function isPadded(text: string, rows: readonly TableRowRead[], delimiter: Line): boolean {
  // The marker of an inserted column and its space, and the mark of an alignment change, are not part
  // of the row's shape: when they go the row is as wide as the others.
  const shape = (start: number, end: number) => {
    let line = text.slice(start, end);
    if (line.includes('align=')) line = withoutPoints(line);
    if (line.includes('col-->')) line = line.replace(/<!--ins [a-z0-9]{4} col--> /g, '');
    return pipesOf(line, 0, line.length).join(',');
  };
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

/** The tables of the last few texts asked about by `insertedRows`: the views of one edit ask about the
 * same text again and again (the newest and the original view, before and after), and a file with an
 * inserted row reads its tables for each. */
const recent: { text: string; tables: TableRead[] }[] = [];

export function tablesOfText(text: string, parsed: Parsed): TableRead[] {
  const known = recent.find((entry) => entry.text === text);
  if (known) return known.tables;
  const tables = readTables(text, parsed);
  recent.unshift({ text, tables });
  recent.length = Math.min(recent.length, 4);
  return tables;
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
  const wanted = new Map(
    parsed.marks
      .filter((mark) => mark.kind === 'ins' && mark.payload === 'row')
      .map((mark) => [mark.id, mark]),
  );
  if (wanted.size === 0) return [];
  const found: InsertedRow[] = [];
  for (const table of tablesOfText(text, parsed)) {
    table.rows.forEach((row, index) => {
      const read = row.insertion;
      // The caller's own mark: the tables may have been read from another parse of the same text.
      const mark = read && wanted.get(read.id);
      const cell = row.cells[0];
      const open = read?.segments[0]?.open;
      if (!mark || !cell || !open) return;
      let to = open.to;
      if (open.to < cell.to && /^[ \t]/.test(text.charAt(open.to))) to++;
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

/** An inserted column (format §3.7) with the range that deciding it and the views change. */
export interface InsertedCol {
  mark: MarkRange;
  table: TableRead;
  /** The column's index in the table: its header cell. */
  col: number;
  /** The marker and the space after it, which accepting the column takes away. */
  marker: Range;
}

/** The range of the marker of an inserted column, and the one space after it. */
export function colMarkerRange(text: string, mark: MarkRange): Range | null {
  const open = mark.segments[0]?.open;
  if (!open) return null;
  const to = /^[ \t]/.test(text.charAt(open.to)) ? open.to + 1 : open.to;
  return { from: open.from, to };
}

/** The inserted columns of a file. A file with none is answered at once. */
export function insertedCols(text: string, parsed: Parsed): InsertedCol[] {
  const wanted = new Map(
    parsed.marks
      .filter((mark) => mark.kind === 'ins' && mark.payload === 'col')
      .map((mark) => [mark.id, mark]),
  );
  if (wanted.size === 0) return [];
  const found: InsertedCol[] = [];
  for (const table of tablesOfText(text, parsed)) {
    for (const { mark: read, col } of table.colMarks) {
      // The caller's own mark: the tables may have been read from another parse of the same text.
      const mark = wanted.get(read.id);
      const marker = mark && colMarkerRange(text, mark);
      if (mark && marker) found.push({ mark, table, col, marker });
    }
  }
  return found;
}
