// Copying and cutting cells (design: tables, "Copy and paste", Out). A rectangle of cells goes on the
// clipboard as tab-separated text (cells parted by tabs, rows by line breaks, a cell that holds a
// tab, a line break or a quote in quotes with its quotes doubled, as a spreadsheet writes it) and as
// an HTML table of the cells' newest text with its inline formatting, the header row as `th` when it
// is the table's. Never markers (design §5.10). A selection that reaches into a table copies the text
// outside it and the cells of the rows it reaches, in order. Cut is copy and the clearing of the
// cells (`cells.ts`). Pasting a range over cells is `paste.ts`.

import type { EditorState } from '@codemirror/state';
import { newestView } from '@redlines/format';
import {
  cellsToHtml,
  DEFAULT_FONTS,
  type FontStacks,
  markdownToHtml,
} from '../clipboard/copy-html.ts';
import { type Rect, rectOf } from './cells.ts';
import { type Cell, type Table } from './model.ts';
import { cellText } from './escape.ts';
import { reachOf } from './reach.ts';

/** One stretch of what is copied: Markdown text, or cells with the table's alignments. */
export type CopyPart = { md: string } | { rows: string[][]; header: boolean; aligns: string[] };

/** What a copy of cells puts on the clipboard: the text, and what the HTML is made of. */
export interface TableCopy {
  text: string;
  parts: CopyPart[];
}

/** A cell's text as a spreadsheet reads it: a pipe unescaped, a `<br>` a line break, in quotes when
 * it holds a tab, a line break or a quote. */
function tsvCell(markdown: string): string {
  const plain = markdown.replace(/<br\s*\/?>/gi, '\n').replace(/\\\|/g, '|');
  return /[\t\n"]/.test(plain) ? `"${plain.replace(/"/g, '""')}"` : plain;
}

/** Cells (each as the Markdown it is written in) as tab-separated text: cells by tabs, rows by line
 * breaks. */
export function rectToTsv(cells: readonly (readonly string[])[]): string {
  return cells.map((row) => row.map(tsvCell).join('\t')).join('\n');
}

/** The newest text of the document, with the way back from the file's positions. */
function newestOf(state: EditorState) {
  const { text, map } = newestView(state.doc.toString());
  return (from: number, to: number) => text.slice(map.fromSource(from), map.fromSource(to));
}

/** The cells of rows `rows` of `table`, columns `cols`, each as its newest text; a short row has
 * empty cells where it has none. */
function matrix(
  table: Table,
  rows: readonly [number, number],
  cols: readonly [number, number],
  textOf: (from: number, to: number) => string,
): string[][] {
  return table.rows.slice(rows[0], rows[1] + 1).map((row) => {
    const out: string[] = [];
    for (let col = cols[0]; col <= cols[1]; col++) {
      const cell: Cell | undefined = row.cells.find((c) => c.col === col && c.col < table.columns);
      out.push(cell ? textOf(cell.textFrom, cell.textTo) : '');
    }
    return out;
  });
}

function partOf(
  table: Table,
  rows: readonly [number, number],
  cols: readonly [number, number],
  textOf: (from: number, to: number) => string,
): { part: CopyPart; cells: string[][] } {
  const cells = matrix(table, rows, cols, textOf);
  return {
    cells,
    part: {
      rows: cells,
      header: rows[0] === 0,
      aligns: table.aligns.slice(cols[0], cols[1] + 1),
    },
  };
}

/** The HTML of a copy's parts. */
export function partsToHtml(
  parts: readonly CopyPart[],
  fonts: FontStacks = DEFAULT_FONTS,
  altOnly: (href: string) => boolean = () => false,
): string {
  return parts
    .map((part) =>
      'md' in part
        ? markdownToHtml(part.md, fonts, altOnly)
        : cellsToHtml(part.rows, part.header, part.aligns, fonts, altOnly),
    )
    .join('');
}

/** The HTML table of a rectangle's cells: their newest text with its inline formatting. */
export function rectToHtml(
  state: EditorState,
  rect: Rect,
  fonts: FontStacks = DEFAULT_FONTS,
  altOnly: (href: string) => boolean = () => false,
): string {
  return partsToHtml(
    [partOf(rect.table, rect.rows, rect.cols, newestOf(state)).part],
    fonts,
    altOnly,
  );
}

/**
 * What copying the selection puts on the clipboard when it is cells: a rectangle's cells, or a
 * selection reaching into a table, the text outside it and the cells of the rows it reaches. Null
 * for any other selection, which is copied as text is.
 */
export function copyOfCells(state: EditorState): TableCopy | null {
  if (state.selection.ranges.length > 1) return null;
  const range = state.selection.main;
  const rect = rectOf(state, range);
  if (rect) {
    const { part, cells } = partOf(rect.table, rect.rows, rect.cols, newestOf(state));
    return { text: rectToTsv(cells), parts: [part] };
  }
  const reach = reachOf(state, range);
  if (!reach || reach.partial.length === 0) return null;
  const textOf = newestOf(state);
  // The outside pieces and the reached rows, in the order of the document.
  const pieces: { at: number; text: string; part: CopyPart }[] = [];
  for (const piece of reach.outside) {
    const md = textOf(piece.from, piece.to);
    if (md.trim() !== '') pieces.push({ at: piece.from, text: md, part: { md } });
  }
  for (const { table, rows } of reach.partial) {
    if (rows[0] > rows[1]) continue;
    const { part, cells } = partOf(table, rows, [0, table.columns - 1], textOf);
    pieces.push({ at: table.from, text: rectToTsv(cells), part });
  }
  pieces.sort((a, b) => a.at - b.at);
  if (pieces.length === 0) return null;
  return { text: pieces.map((p) => p.text).join('\n'), parts: pieces.map((p) => p.part) };
}

/** A cell's Markdown for plain text: a line break `<br>`, a tab a space, a pipe escaped. */
export function cellFromPlain(text: string): string {
  return cellText('', text.replace(/\t/g, ' '));
}

/**
 * The cells of text with tabs (a range copied from a spreadsheet or a text editor): cells parted by
 * tabs, rows by line breaks, a cell in quotes holding its tabs, line breaks and doubled quotes. Null
 * for text without a tab, which is a value and not a range. Each cell is returned as the Markdown
 * it is written in.
 */
export function tsvToRange(text: string): string[][] | null {
  if (!text.includes('\t')) return null;
  const source = text.replace(/\r\n?/g, '\n');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let start = true;
  for (let i = 0; i < source.length; i++) {
    const char = source[i]!;
    if (quoted) {
      if (char !== '"') cell += char;
      else if (source[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = false;
    } else if (char === '"' && start) quoted = true;
    else if (char === '\t' || char === '\n') {
      row.push(cell);
      cell = '';
      start = true;
      if (char === '\n') {
        rows.push(row);
        row = [];
      }
      continue;
    } else cell += char;
    start = false;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.map((cells) => cells.map(cellFromPlain));
}
