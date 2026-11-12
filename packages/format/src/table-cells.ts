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

/** What a change in `spot`'s cell is checked against (format §3.7, "Cells apart"). */
export interface CellScope {
  /** The ids of the marks that lie wholly in the text of another cell of the table: nothing they
   * bring in or take out can reach this cell. A mark of the table's rows or columns, one that
   * crosses a pipe, and one outside the table are not of them. */
  elsewhere: Set<string>;
  /**
   * The lines of the table that the change is checked on: its header row, its delimiter row and the
   * cell's row, and not the rows between, which read as they do among any rows, so that the cost
   * does not grow with the table. Undefined where the table holds a change of its rows or columns
   * or an alignment change (the cell's reading is then a matter of those, decided in their own
   * tiers), or a mark reaches from these lines into others.
   */
  lines: Range[] | undefined;
}

export function scopeOf(text: string, parsed: Parsed, spot: CellSpot | undefined): CellScope {
  if (!spot) return { elsewhere: new Set(), lines: undefined };
  const { table, row, col } = spot;
  const header = table.rows[0];
  const mine = table.rows[row];
  const whole = (range: Range) => ({ from: lineStart(text, range.from), to: range.to });
  let lines: Range[] | undefined =
    header && mine && !table.deletions.length && !table.colMarks.length
      ? [whole(header), whole(table.delimiter), ...(row ? [whole(mine)] : [])]
      : undefined;
  if (table.rows.some((one) => one.insertion) || parsed.marks.some(isAlignMark)) lines = undefined;
  const elsewhere = new Set<string>();
  for (const mark of parsed.marks) {
    const spans = mark.segments.map((segment) => ({
      from: segment.open.from,
      to: (segment.close ?? segment.carrier ?? segment.open).to,
    }));
    const from = Math.min(...spans.map((span) => span.from));
    const to = Math.max(...spans.map((span) => span.to));
    // A mark that meets these lines lies wholly in them.
    const within = (line: Range, span: Range) => line.from <= span.from && span.to <= line.to;
    if (
      lines?.some((line) => from <= line.to && line.from <= to) &&
      !spans.every((span) => lines?.some((line) => within(line, span)))
    ) {
      lines = undefined;
    }
    if (mark.kind === 'cmt' || isStructural(mark) || from < table.from || to > table.to) continue;
    const there = cellAt(text, parsed, from, to);
    if (there && there.table === table && (there.row !== row || there.col !== col)) {
      elsewhere.add(mark.id);
    }
  }
  return { elsewhere, lines };
}

/** A cell as a refusal names it: "row 3, column 2", or "the header, column 2". */
export function cellName(spot: CellSpot): string {
  return `the cell in ${spot.row === 0 ? 'the header' : `row ${spot.row}`}, column ${spot.col + 1}`;
}
