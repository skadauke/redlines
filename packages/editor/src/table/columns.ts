// Inserted columns, found in the tables of a state (design: tables, "How it shows"): the cells of the
// column in every row, which the tracked layer gives the author's tint and underline and a change bar
// per row, and which a card is found by.

import type { EditorState } from '@codemirror/state';
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
