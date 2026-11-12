// Cells apart (format §3.7): a change confined to the text of one cell of a table is checked
// against the marks in that cell, and not against the marks in the other cells. GFM cuts a row into
// cells at unescaped pipes before it reads any inline syntax, and the markers of a mark never hold
// one, so whether a mark inside one cell is accepted or rejected can't change how another cell
// reads, in any order of decisions. The table's rows, columns and moves are decided in their own
// tiers (decide.ts), and still take part in the check.

import { lineStart } from './blocks.ts';
import { isAlignMark } from './table-align.ts';
import { readLine, tablesOfText } from './table.ts';
import type { TableRead } from './table.ts';
import type { MarkRange, Parsed, Range } from './types.ts';

/** A cell of a table in a file: the text between its pipes, and where it stands in the table. */
export interface CellSpot {
  table: TableRead;
  /** The row's index in `table.rows`: 0 is the header. */
  row: number;
  /** The cell's index in its row (the column). */
  col: number;
  /** The text between the pipes of the cell, padding and the marker of an inserted row included. */
  content: Range;
}

/** A mark of a table's rows or columns, a move, or an alignment change: decided in the tiers of
 * decide.ts, and not a mark of one cell's text. */
export function isStructural(mark: MarkRange): boolean {
  return (
    (mark.kind === 'ins' && (mark.payload === 'row' || mark.payload === 'col')) ||
    (mark.kind === 'del' && /^(?:row|col)=/.test(mark.payload ?? '')) ||
    mark.entry.move !== undefined ||
    isAlignMark(mark)
  );
}

/** The cell of a table whose text holds `[from, to]`, in a row that has a leading pipe, or
 * undefined: the range is in no table, crosses a pipe, or is in a row GFM reads without one. */
export function cellAt(
  text: string,
  parsed: Parsed,
  from: number,
  to: number,
): CellSpot | undefined {
  if (from > to) return undefined;
  const table = tablesOfText(text, parsed).find((one) => one.from <= from && to <= one.to);
  if (!table) return undefined;
  const row = table.rows.findIndex((one) => one.from <= from && to <= one.to);
  const found = table.rows[row];
  if (!found || !found.leadingPipe) return undefined;
  const line = readLine(text, found.from, found.to);
  const col = line.cells.findIndex((cell) => cell.contentFrom <= from && to <= cell.contentTo);
  const cell = line.cells[col];
  if (!cell) return undefined;
  return { table, row, col, content: { from: cell.contentFrom, to: cell.contentTo } };
}

/** The cell that holds every one of the edits, or undefined. */
export function cellOfEdits(
  text: string,
  parsed: Parsed,
  edits: readonly { from: number; to: number }[],
): CellSpot | undefined {
  if (edits.length === 0) return undefined;
  const from = Math.min(...edits.map((edit) => edit.from));
  const to = Math.max(...edits.map((edit) => edit.to));
  return cellAt(text, parsed, from, to);
}

/** The ids of the marks that lie wholly in the text of another cell of the table than `spot`'s:
 * nothing they bring in or take out can reach the cell (format §3.7, "Cells apart"). A mark of
 * the table's rows or columns, one that crosses a pipe, and one outside the table are not of them. */
export function marksOfOtherCells(text: string, parsed: Parsed, spot: CellSpot): Set<string> {
  const apart = new Set<string>();
  const { table } = spot;
  const lines = new Map<number, ReturnType<typeof readLine>>();
  for (const mark of parsed.marks) {
    if (mark.kind === 'cmt' || isStructural(mark)) continue;
    let from = Infinity;
    let to = -Infinity;
    for (const segment of mark.segments) {
      from = Math.min(from, segment.open.from, segment.carrier?.from ?? Infinity);
      to = Math.max(to, (segment.close ?? segment.carrier ?? segment.open).to);
    }
    if (from < table.from || to > table.to) continue;
    const row = table.rows.findIndex((one) => one.from <= from && to <= one.to);
    const found = table.rows[row];
    if (!found) continue;
    let line = lines.get(row);
    if (!line) {
      line = readLine(text, found.from, found.to);
      lines.set(row, line);
    }
    const col = line.cells.findIndex((cell) => cell.contentFrom <= from && to <= cell.contentTo);
    if (col === -1 || (row === spot.row && col === spot.col)) continue;
    apart.add(mark.id);
  }
  return apart;
}

/** A cell as a refusal names it: "row 3, column 2", or "the header, column 2". */
export function cellName(spot: CellSpot): string {
  const place = spot.row === 0 ? 'the header' : `row ${spot.row}`;
  return `the cell in ${place}, column ${spot.col + 1}`;
}

/**
 * The lines of a table that a change in `spot`'s cell is checked on: its header row, its delimiter
 * row and the cell's row, and not the rows between. The cell reads as it does in any row of the
 * table whatever the other rows hold, so the check on these lines is the check on the table, at a
 * cost that does not grow with the table. Undefined where the table holds a change of its rows or
 * columns, or an alignment change (the cell's reading is then a matter of those, decided in their
 * own tiers: format §3.7), or a mark reaches from these lines into others.
 */
export function rowLines(text: string, parsed: Parsed, spot: CellSpot): Range[] | undefined {
  const { table } = spot;
  if (table.deletions.length > 0 || table.colMarks.length > 0) return undefined;
  if (table.rows.some((row) => row.insertion)) return undefined;
  const header = table.rows[0];
  const row = table.rows[spot.row];
  if (!header || !row) return undefined;
  const whole = (range: Range) => ({ from: lineStart(text, range.from), to: range.to });
  const lines = [whole(header), whole(table.delimiter)];
  if (spot.row > 0) lines.push(whole(row));
  for (const mark of parsed.marks) {
    if (mark.kind === 'fmt') {
      const under = mark.segments.some((segment) => {
        const end = (segment.carrier ?? segment.open).to;
        return end <= table.from && text.slice(end, table.from).trim() === '';
      });
      if (under && isAlignMark(mark)) return undefined;
    }
    const inside = (segment: (typeof mark.segments)[number]) => {
      const from = Math.min(segment.open.from, segment.carrier?.from ?? Infinity);
      const to = (segment.close ?? segment.carrier ?? segment.open).to;
      return lines.some((line) => line.from <= from && to <= line.to);
    };
    const touches = mark.segments.some((segment) => {
      const from = Math.min(segment.open.from, segment.carrier?.from ?? Infinity);
      const to = (segment.close ?? segment.carrier ?? segment.open).to;
      return lines.some((line) => from <= line.to && line.from <= to);
    });
    if (touches && !mark.segments.every(inside)) return undefined;
  }
  return lines;
}
