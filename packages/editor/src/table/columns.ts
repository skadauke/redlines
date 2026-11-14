// Inserted columns, found in the tables of a state (design: tables, "How it shows"): the cells of the
// column in every row, which the tracked layer gives the author's tint and underline and a change bar
// per row, and which a card is found by.

import type { EditorState } from '@codemirror/state';
import { alignWas } from '@redlines/format';
import type { MarkRange } from '@redlines/format';
import { tablesField } from './model.ts';
import type { Table } from './model.ts';

/** The table whose header holds `pos`, and the column that holds it there, or null. */
export function headerColumnAt(
  state: EditorState,
  pos: number,
): { table: Table; col: number } | null {
  for (const table of state.field(tablesField, false) ?? []) {
    const header = table.rows[0];
    if (!header || pos < header.from || pos > header.to) continue;
    const col = header.cells.findIndex(
      (cell) => cell.from <= pos && pos < Math.max(cell.to, cell.from + 1),
    );
    return col === -1 ? null : { table, col };
  }
  return null;
}

/** The cells of an inserted column, one per row that has one, from the pipe in front of each. */
export function insertedColumnCells(
  state: EditorState,
  mark: MarkRange,
): { from: number; to: number }[] {
  const open = mark.segments[0]?.open;
  const at = open ? headerColumnAt(state, open.from) : null;
  if (!at) return [];
  return at.table.rows.flatMap((row) => {
    const cell = row.cells[at.col];
    return cell && cell.to > cell.from ? [{ from: cell.from, to: cell.to }] : [];
  });
}

/** The rows of the table that a deleted column (or any deletion line) below it belongs to: the table
 * above `pos` that ends nearest to it. */
export function tableAbove(state: EditorState, pos: number): Table | null {
  let found: Table | null = null;
  for (const table of state.field(tablesField, false) ?? []) {
    if (table.to < pos && (!found || table.to > found.to)) found = table;
  }
  return found;
}

/**
 * The table an alignment change is of (format §3.7), and the columns whose alignment it changed:
 * those where the delimiter row differs from the old one the change keeps. A mark with no closer, the
 * point form, is of the table that holds it, at the end of its header's last cell; one with a closer
 * is of the table it is around, the span form that another tool wrote. Null when no table is there
 * or the old row has not its columns.
 */
export function alignedColumns(
  state: EditorState,
  mark: MarkRange,
): { table: Table; cols: number[] } | null {
  const segment = mark.segments[0];
  if (!segment) return null;
  const tables = state.field(tablesField, false) ?? [];
  let table: Table | null = null;
  if (segment.close) {
    const start = segment.carrier?.to ?? segment.open.to;
    for (const candidate of tables) {
      if (candidate.from >= start && (!table || candidate.from < table.from)) table = candidate;
    }
    if (table && table.to > segment.close.from) return null;
  } else {
    const { open } = segment;
    table = tables.find((found) => found.from <= open.from && open.to <= found.to) ?? null;
  }
  if (!table) return null;
  const was = alignWas(mark, table.columns);
  if (!was) return null;
  const cols = table.aligns.flatMap((align, col) => (align === was[col] ? [] : [col]));
  return { table, cols };
}
