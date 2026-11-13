// The blocks a whole-block deletion holds (format §3.4), for a view that draws them where they were.
// A deletion of whole blocks is written in one of two forms: the opener alone on its line before the
// block after them, the payload ending with the break (and, in front of the next item of a list,
// that item's prefix), or, at the end of the text, the opener behind the block above, the payload
// starting with the break. This reads the payload; whether the file is in one of those places is
// the caller's to say.

import { CONTAINER_PREFIX } from './blocks.ts';
import { parse } from './parse.ts';
import { readTables } from './table.ts';
import type { TableAlign, TableRead } from './table.ts';
import type { Segment } from './types.ts';

export type DeletedBlockKind =
  | { kind: 'paragraph' }
  | { kind: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6 }
  | {
      kind: 'item';
      /** The bullet or the number with its delimiter: `-`, `*`, `+`, `3.`, `3)`. */
      marker: string;
      /** The columns in front of the marker. */
      indent: number;
      /** The columns from the start of the marker to the start of the text. */
      width: number;
    }
  | { kind: 'quote' }
  /** A fenced code block: its lines, without the fences, and the language the opening fence names. */
  | { kind: 'code'; language: string }
  /**
   * A table (format §3.7), as GFM reads it, whether or not its rows start with a pipe: its rows as
   * written, the header's first, and the alignments its delimiter row says. The delimiter row is no
   * row. `rows` holds the cells of the first rows that `DeletedBlocksContext.tableRows` allows, all
   * by default, and `rowCount` is how many the table has.
   */
  | {
      kind: 'table';
      aligns: TableAlign[];
      /** The columns the header has, which GFM shows. */
      columns: number;
      rowCount: number;
      rows: DeletedCell[][];
    }
  /** HTML, math, a rule, a pipe-led block that is no table: drawn as its source. */
  | { kind: 'other' };

/** A cell of a deleted table: its text as written, between its pipes, with no padding. */
export interface DeletedCell {
  /** A pipe in it is still `\|`, and a line break `<br>`. */
  text: string;
  /** Where it starts in the payloads put together, as a piece's `at`. */
  at: number;
}

/** A stretch of a block's text, and where it starts in the payloads put together. */
export interface DeletedPiece {
  text: string;
  at: number;
}

export interface DeletedBlock {
  kind: DeletedBlockKind;
  /** The text after the block's prefix, its lines joined by a space. */
  text: string;
  /** The text as the stretches of the payloads it is made of, so that a view can color each. */
  pieces: DeletedPiece[];
}

/** What the file around a deletion says. */
export interface DeletedBlocksContext {
  /**
   * What stands on the line in front of the opener, when it is a container prefix (`- `, `> `):
   * the first block's own prefix, which a deletion in front of the next item of a list leaves
   * outside the marker. Default: nothing.
   */
  lead?: string;
  /** Whether nothing but blank lines follows the deletion, up to the end of the text. */
  atEnd?: boolean;
  /**
   * With `atEnd`, whether the deletion is all the text: nothing but blank lines stands before it
   * either, so that no block above it holds its marker. The payload is then the blocks alone, with
   * no break at either end, as a table that is the only block of a file is written. Default: no.
   */
  alone?: boolean;
  /**
   * How many rows of a table, the header and then the body's, a view draws, so that the cells of no
   * more are given (the rest are counted). Default: all.
   */
  tableRows?: number;
}

const FENCE = /^[ \t]*(`{3,}|~{3,})/;
const RULE = /^[ \t]{0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const ITEM = /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+)(.*)$/;
const HEADING = /^[ \t]{0,3}(#{1,6})(?:[ \t]+(.*)|)$/;
const QUOTE = /^[ \t]*>[ \t]?(.*)$/;
const TABLE_ROW = /^[ \t]*\|/;
const HTML = /^[ \t]{0,3}(?:<[A-Za-z!/?]|\$\$)/;
const SETEXT = /^[ \t]{0,3}(=+|-+)[ \t]*$/;
const BLANK = /^[ \t>]*$/;

interface Line {
  text: string;
  at: number;
}

interface Open {
  kind: DeletedBlockKind;
  pieces: DeletedPiece[];
  /** Lines of code, a table or HTML, which continue by their own rules. */
  other?: 'fence' | 'table' | 'html';
  fence?: string;
}

/** The lines of a text with where each starts. */
function linesOf(text: string): Line[] {
  const lines: Line[] = [];
  let at = 0;
  for (const part of text.split('\n')) {
    lines.push({ text: part.replace(/\r$/, ''), at });
    at += part.length + 1;
  }
  return lines;
}

/** Whether a line starts a block, so that it can't continue a paragraph. */
function startsBlock(text: string): boolean {
  return (
    ITEM.test(text) ||
    HEADING.test(text) ||
    QUOTE.test(text) ||
    FENCE.test(text) ||
    RULE.test(text) ||
    TABLE_ROW.test(text) ||
    HTML.test(text)
  );
}

/** A line that may be a table's delimiter row: dashes, colons and spaces, and a pipe. */
const DELIMITER_LINE = /^(?=.*\|)(?=.*-)[ \t|:-]+$/m;

/** The tables the last payloads held, by payload: a keystroke elsewhere asks about them again. */
const recent: { text: string; tables: TableRead[] }[] = [];

/**
 * The tables of a payload, as the rest of the format reads them (`readTables`). A payload is text
 * with no marks in it, never a file: the old text of the deletion.
 */
function tablesIn(text: string): TableRead[] {
  // A table has a delimiter row under its header row: a payload with no such line has none.
  if (!DELIMITER_LINE.test(text)) return [];
  const known = recent.find((entry) => entry.text === text);
  if (known) return known.tables;
  const tables = readTables(text, parse(text));
  recent.unshift({ text, tables });
  recent.length = Math.min(recent.length, 16);
  return tables;
}

/** What the lines of a payload say about its tables. */
interface Tables {
  payload: string;
  /** The tables that start a line, by where the line starts in the payload. */
  byStart: ReadonlyMap<number, TableRead>;
  /** How many rows of a table to give the cells of. */
  rows: number;
}

/** The kind of the block that a table is: the cells of its first rows. */
function tableKind({ payload, rows }: Tables, table: TableRead): DeletedBlockKind {
  return {
    kind: 'table',
    aligns: [...table.aligns],
    columns: table.aligns.length,
    rowCount: table.rows.length,
    rows: table.rows.slice(0, rows).map((row) =>
      row.cells.map((cell) => ({
        text: payload.slice(cell.textFrom, cell.textTo),
        at: cell.textFrom,
      })),
    ),
  };
}

/** The blocks of a text that is whole blocks, one after the other. */
function blocksOf(lines: readonly Line[], tables: Tables): DeletedBlock[] {
  const blocks: DeletedBlock[] = [];
  let open: Open | null = null;
  const close = () => {
    if (open) {
      // Code keeps its lines, blank ones too, apart; the rest reads as one line.
      const code = open.kind.kind === 'code';
      const pieces = code ? open.pieces : open.pieces.filter((piece) => piece.text !== '');
      const text = pieces.map((piece) => piece.text).join(code ? '\n' : ' ');
      blocks.push({ kind: open.kind, text, pieces });
    }
    open = null;
  };
  const piece = (line: Line, from = 0): DeletedPiece => {
    const body = line.text.slice(from);
    const lead = body.length - body.trimStart().length;
    return { text: body.trim(), at: line.at + from + lead };
  };
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    const { text } = line;
    if (open?.other === 'fence') {
      const closing = /^[ \t]*(`{3,}|~{3,})[ \t]*$/.exec(text)?.[1];
      if (
        closing &&
        open.fence &&
        closing[0] === open.fence[0] &&
        closing.length >= open.fence.length
      ) {
        close();
      } else open.pieces.push({ text, at: line.at });
      continue;
    }
    // A line of `>` alone parts the paragraphs of a quote and ends nothing of it.
    if (open?.kind.kind === 'quote' && /^[ \t]*>[ \t>]*$/.test(text)) continue;
    if (BLANK.test(text)) {
      close();
      continue;
    }
    const fence = FENCE.exec(text);
    if (fence) {
      close();
      const language = text.slice(text.indexOf(fence[1]!) + fence[1]!.length).trim();
      open = { kind: { kind: 'code', language }, pieces: [], other: 'fence', fence: fence[1]! };
      continue;
    }
    // A table as GFM reads it, which starts here and ends before the next block (not one a prefix
    // changed, as a list item's first line, which stays the source it is).
    const table = tables.byStart.get(line.at);
    const header = table?.rows[0];
    if (table && header && text === tables.payload.slice(header.from, header.to)) {
      close();
      const pieces = [piece(line)];
      while (lines[index + 1] && lines[index + 1]!.at <= table.to)
        pieces.push(piece(lines[++index]!));
      blocks.push({
        kind: tableKind(tables, table),
        text: pieces.map((one) => one.text).join(' '),
        pieces,
      });
      continue;
    }
    if (open?.other === 'table' && TABLE_ROW.test(text)) {
      open.pieces.push(piece(line));
      continue;
    }
    if (open?.other === 'html') {
      open.pieces.push(piece(line));
      continue;
    }
    if (open?.kind.kind === 'paragraph') {
      const underline = SETEXT.exec(text);
      if (underline) {
        open.kind = { kind: 'heading', level: underline[1]!.startsWith('=') ? 1 : 2 };
        continue;
      }
      if (!startsBlock(text)) {
        open.pieces.push(piece(line));
        continue;
      }
    }
    if (RULE.test(text)) {
      close();
      open = { kind: { kind: 'other' }, pieces: [piece(line)] };
      close();
      continue;
    }
    const heading = HEADING.exec(text);
    if (heading) {
      close();
      const level = heading[1]!.length as 1 | 2 | 3 | 4 | 5 | 6;
      const body = heading[2] ?? '';
      const at = line.at + text.length - body.length;
      open = { kind: { kind: 'heading', level }, pieces: [{ text: body.trim(), at }] };
      close();
      continue;
    }
    const item = ITEM.exec(text);
    if (item) {
      close();
      const [, indent, marker, spaces, body] = item as unknown as [
        string,
        string,
        string,
        string,
        string,
      ];
      const width = marker.length + spaces.length;
      const start = indent.length + width;
      open = {
        kind: { kind: 'item', marker, indent: indent.length, width },
        pieces: [{ text: body.trim(), at: line.at + start }],
      };
      continue;
    }
    const quote = QUOTE.exec(text);
    if (quote) {
      if (open?.kind.kind !== 'quote') {
        close();
        open = { kind: { kind: 'quote' }, pieces: [] };
      }
      open.pieces.push({ text: quote[1]!.trim(), at: line.at + text.length - quote[1]!.length });
      continue;
    }
    if (TABLE_ROW.test(text)) {
      close();
      open = { kind: { kind: 'other' }, pieces: [piece(line)], other: 'table' };
      continue;
    }
    if (HTML.test(text)) {
      close();
      open = { kind: { kind: 'other' }, pieces: [piece(line)], other: 'html' };
      continue;
    }
    // A line of an item's text, or a quote's, goes on with it; any other starts a paragraph.
    if (open && (open.kind.kind === 'item' || open.kind.kind === 'quote')) {
      open.pieces.push(piece(line));
      continue;
    }
    close();
    open = { kind: { kind: 'paragraph' }, pieces: [piece(line)] };
  }
  close();
  return blocks;
}

/**
 * The blocks a whole-block deletion's payload holds, or null when it isn't whole blocks: a payload
 * that ends with the break at the start of the block after it (a deletion whose opener stands
 * alone on its line, `segment.carrier`), or, at the end of the text (`context.atEnd`), one that
 * starts with the break after the block above. A deletion that runs from the middle of one block
 * into another, a join (a payload of a break and a prefix), and a deletion of part of a block are
 * not. Other people's deletions inside the deleted blocks (format §3.4) are given with the
 * deletion's own segments, in the order of the file, and are part of the blocks.
 */
export function deletedBlocks(
  segments: Segment | readonly Segment[],
  context: DeletedBlocksContext = {},
): DeletedBlock[] | null {
  const list = 'open' in segments ? [segments] : segments;
  const first = list[0];
  if (!first) return null;
  let payload = '';
  for (const segment of list) payload += segment.payload ?? '';
  if (payload === '') return null;
  const lead = context.lead && CONTAINER_PREFIX.test(context.lead) ? context.lead : '';
  const lines = linesOf(payload);
  let from = 0;
  let to = lines.length;
  if (first.carrier) {
    // The opener of a block that starts here: the payload ends with the break and the prefix of
    // the block after it, and never starts with one.
    if (lines.length < 2 || BLANK.test(lines[0]!.text)) return null;
    const last = lines[lines.length - 1]!.text;
    if (!CONTAINER_PREFIX.test(last)) return null;
    while (to > 0 && CONTAINER_PREFIX.test(lines[to - 1]!.text)) to--;
  } else if (context.atEnd) {
    // After the block above: the payload starts with the break. When it is all the text there is no
    // block above, and it is the blocks alone.
    if (!context.alone && (lines.length < 2 || lines[0]!.text !== '')) return null;
    while (from < to && CONTAINER_PREFIX.test(lines[from]!.text)) from++;
    while (to > from && CONTAINER_PREFIX.test(lines[to - 1]!.text)) to--;
  } else return null;
  if (to <= from) return null;
  const body = lines.slice(from, to);
  // The first line takes the prefix the opener stood behind.
  if (first.carrier && lead !== '') {
    const head = body[0]!;
    body[0] = { text: lead + head.text, at: head.at - lead.length };
  }
  const read = tablesIn(payload);
  const blocks = blocksOf(body, {
    payload,
    byStart: new Map(read.map((table) => [table.from, table])),
    rows: context.tableRows ?? Infinity,
  });
  // A break and a prefix alone, with no text, are a join.
  // (An empty fence pair is a code block with no lines.)
  return blocks.length > 0 &&
    blocks.every((block) => block.text !== '' || block.kind.kind === 'code')
    ? blocks
    : null;
}

/** Whether `text` is the lines of a break and a container prefix, which hold none of a block's text. */
const isBreak = (text: string) =>
  text.split('\n').every((line) => CONTAINER_PREFIX.test(line.replace(/\r$/, '')));

/**
 * The columns and rows of the table that a deletion's payload is, when it is one table and nothing
 * else, as `deleteTable` writes it (format §3.7, rule 6): the table and the break after it, the
 * break before it at the end of the text, or the table alone when it is all the text. Rows are the
 * header's and the body's, and the delimiter row is no row. Null for any other payload.
 */
export function deletedTable(payload: string): { columns: number; rows: number } | null {
  const tables = tablesIn(payload);
  const [table] = tables;
  if (tables.length !== 1 || !table) return null;
  if (!isBreak(payload.slice(0, table.from)) || !isBreak(payload.slice(table.to))) return null;
  return { columns: table.aligns.length, rows: table.rows.length };
}
