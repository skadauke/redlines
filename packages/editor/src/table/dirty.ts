// What a transaction changes in the tables' drawing (design: tables, "Kept up to date, cheaply"; the
// plan's constraint that the table layer's work per keystroke is the row being edited, never the
// table). The layout and the caret's stops are sets of ranges, and a change maps them through it;
// this says which part of them to build again: a table the change doesn't touch is kept as it is, one
// whose rows it touches builds those rows, and one whose shape it changes (its rows or columns, an
// alignment, its delimiter row), or that is new, builds the table alone.

import type { Transaction } from '@codemirror/state';
import { type Row, type Table, tablesField } from './model.ts';

export interface Span {
  from: number;
  to: number;
}

/** A row to build again, and the places of what was built for it, after the change. */
export interface DirtyRow {
  row: Row;
  clear: Span;
}

/** A table to build, in the new text. */
export interface DirtyTable {
  table: Table;
  /** The rows to build again, or null for the whole table. */
  rows: readonly DirtyRow[] | null;
  /** Where what was built before for it lies, after the change: the old table's place and the new. */
  clear: Span;
}

export interface Dirty {
  tables: DirtyTable[];
  /** The places, after the change, of tables that are no more. */
  gone: Span[];
}

/** Whether `table` has the shape `old` had: the rows, the columns, the alignments and the cells of
 * each row, and a delimiter row of the same length. */
function sameShape(old: Table, table: Table): boolean {
  return (
    old.rows.length === table.rows.length &&
    old.columns === table.columns &&
    old.aligns.length === table.aligns.length &&
    old.aligns.every((align, i) => align === table.aligns[i]) &&
    old.delimiter.to - old.delimiter.from === table.delimiter.to - table.delimiter.from &&
    old.rows.every((row, i) => row.cells.length === table.rows[i]?.cells.length)
  );
}

/** The end of what a row draws: a header's is its delimiter row's. */
export const rowEnd = (table: Table, row: Row): number =>
  row.header ? table.delimiter.to : row.to;

const memo = new WeakMap<Transaction, Dirty | null>();

/**
 * What to build again after `tr`, or null where the tables are not read from the changed text (no
 * tables field). Tables are matched by their identity.
 */
export function dirtyOf(tr: Transaction): Dirty | null {
  if (memo.has(tr)) return memo.get(tr) ?? null;
  const result = compute(tr);
  memo.set(tr, result);
  return result;
}

function compute(tr: Transaction): Dirty | null {
  const before = tr.startState.field(tablesField, false);
  const after = tr.state.field(tablesField, false);
  if (!before || !after) return null;
  const ranges: Span[] = [];
  tr.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => ranges.push({ from: fromB, to: toB }));
  const touching = (from: number, to: number) => ranges.filter((r) => r.from <= to && r.to >= from);
  const touches = (from: number, to: number) => touching(from, to).length > 0;
  /** `span`, and where the changes that touch it write: what was drawn for it at the edge of a change
   * stayed in front of what the change wrote, or went after it. */
  const reaching = (span: Span): Span => {
    const hit = touching(span.from, span.to);
    return {
      from: Math.min(span.from, ...hit.map((r) => r.from)),
      to: Math.max(span.to, ...hit.map((r) => r.to)),
    };
  };
  const old = new Map(before.map((table) => [table.id, table]));
  const place = (span: Span): Span => ({
    from: tr.changes.mapPos(span.from, -1),
    to: tr.changes.mapPos(span.to, 1),
  });
  const dirty: Dirty = { tables: [], gone: [] };
  for (const table of after) {
    const was = old.get(table.id);
    old.delete(table.id);
    if (!was) {
      dirty.tables.push({ table, rows: null, clear: reaching({ from: table.from, to: table.to }) });
      continue;
    }
    const mapped = place(was);
    const extent = { from: Math.min(mapped.from, table.from), to: Math.max(mapped.to, table.to) };
    // The line breaks around the table are its too: the stops reach over them.
    if (!touches(extent.from - 1, extent.to + 1)) continue;
    const clear = reaching(extent);
    const delimiterTouched = touches(table.delimiter.from - 1, table.delimiter.to);
    if (!sameShape(was, table) || delimiterTouched) {
      dirty.tables.push({ table, rows: null, clear });
      continue;
    }
    // The first row owns the line break in front of the table, and the last the one after it.
    const last = table.rows.length - 1;
    const rows: DirtyRow[] = [];
    for (const row of table.rows) {
      // Where what was drawn for the row lies now, and where the row is.
      const was_ = was.rows[row.index];
      const there = was_ ? place({ from: was_.from, to: rowEnd(was, was_) }) : null;
      const span = {
        from: Math.min(row.from, there?.from ?? row.from),
        to: Math.max(rowEnd(table, row), there?.to ?? 0),
      };
      if (
        !touches(
          row.index === 0 ? span.from - 1 : span.from,
          span.to + (row.index === last ? 1 : 0),
        )
      ) {
        continue;
      }
      rows.push({ row, clear: reaching(span) });
    }
    dirty.tables.push({ table, rows, clear });
  }
  for (const table of old.values()) dirty.gone.push(reaching(place(table)));
  return dirty;
}
