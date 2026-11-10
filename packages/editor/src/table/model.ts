// The tables of a state (design: tables, "Kept up to date, cheaply"). A table stays its Markdown
// source; this field reads where its rows and cells are, once, and keeps them as the text changes:
// an edit inside one row's text, with no line break, pipe or backslash in what it adds or removes,
// reads that row again; any other edit that touches a table reads that table again; the tables it
// doesn't touch are moved with the text. A table is found by the syntax tree (so a table in a quote
// or a list item, whose lines carry prefixes, is none); its rows and cells are read by the format's
// own reader (`readRowCells`), so that this and the file's other readers agree.

import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { type ChangeDesc, type EditorState, StateField, type Text } from '@codemirror/state';
import type { Tree } from '@lezer/common';
import { readDelimiterRow, readRowCells } from '@redlines/format';

export type Align = '' | 'left' | 'center' | 'right';

/** A cell: from the pipe in front of it (the start of the line for the first) to the next pipe (the
 * end of the line for the last). `textFrom` and `textTo` leave out the padding, and a marker of an
 * inserted row or column; an empty cell has one stop, where they meet. */
export interface Cell {
  from: number;
  to: number;
  textFrom: number;
  textTo: number;
  /** The cell's index in its row. */
  col: number;
}

export interface Row {
  from: number;
  to: number;
  header: boolean;
  /** 0 the header, 1 the first body row. */
  index: number;
  /** As written: a ragged row has the cells it has. */
  cells: Cell[];
}

export interface Table {
  from: number;
  to: number;
  rows: Row[];
  aligns: Align[];
  /** The delimiter row's line. */
  delimiter: { from: number; to: number };
  /** The columns the header has, which GFM shows. */
  columns: number;
}

/** Whether a table of the syntax tree is at the top of the document, not in a quote or a list. */
function isTopLevel(node: { parent: { name: string } | null }): boolean {
  return node.parent?.name === 'Document';
}

function readRow(doc: Text, from: number, to: number, index: number): Row {
  const text = doc.sliceString(from, to);
  const { cells } = readRowCells(text, 0, text.length);
  return {
    from,
    to,
    header: index === 0,
    index,
    cells: cells.map((cell, col) => ({
      from: cell.from + from,
      to: cell.to + from,
      textFrom: cell.textFrom + from,
      textTo: cell.textTo + from,
      col,
    })),
  };
}

/** The table that the syntax tree has from `from` to `to`. */
function readTable(doc: Text, from: number, to: number): Table | null {
  const first = doc.lineAt(from);
  const delimiterLine = first.number < doc.lines ? doc.line(first.number + 1) : null;
  if (!delimiterLine || delimiterLine.from > to) return null;
  const rows = [readRow(doc, first.from, first.to, 0)];
  for (let n = first.number + 2; n <= doc.lines; n++) {
    const line = doc.line(n);
    if (line.from > to) break;
    rows.push(readRow(doc, line.from, line.to, rows.length));
  }
  const columns = rows[0]?.cells.length ?? 0;
  const aligns = readDelimiterRow(
    doc.sliceString(delimiterLine.from, delimiterLine.to),
    0,
    delimiterLine.to - delimiterLine.from,
    columns,
  );
  // A node of a tree that is not finished, or reused from a text that has changed, is no table
  // unless the delimiter row holds as many cells as the header.
  if (!aligns || columns === 0) return null;
  return {
    from: first.from,
    // A table of a header alone ends with its delimiter row.
    to: Math.max(rows.at(-1)?.to ?? first.to, delimiterLine.to),
    rows,
    aligns,
    delimiter: { from: delimiterLine.from, to: delimiterLine.to },
    columns,
  };
}

/** The tables of the syntax tree that start in `from`..`to`, in order. */
function tablesBetween(state: EditorState, tree: Tree, from: number, to: number): Table[] {
  const tables: Table[] = [];
  tree.iterate({
    from,
    to,
    enter: (node) => {
      if (node.name === 'Document') return true;
      if (node.name === 'Table') {
        if (node.to >= from && node.from <= to && isTopLevel(node.node)) {
          const table = readTable(state.doc, node.from, node.to);
          if (table) tables.push(table);
        }
        return false;
      }
      return false;
    },
  });
  return tables;
}

/** The syntax tree as far as a table needs it: complete up to `upto` when that takes little time. */
function treeOf(state: EditorState, upto: number): Tree {
  return ensureSyntaxTree(state, Math.min(upto, state.doc.length), 200) ?? syntaxTree(state);
}

/** Every table of a state, read from the syntax tree. */
export function buildTables(state: EditorState): Table[] {
  return tablesBetween(state, treeOf(state, state.doc.length), 0, state.doc.length);
}

/** `pos` after `changes`, the same on either side of a change that covers it. */
function mapTable(table: Table, changes: ChangeDesc): Table {
  const map = (pos: number) => changes.mapPos(pos, 1);
  return {
    ...table,
    from: map(table.from),
    to: map(table.to),
    delimiter: { from: map(table.delimiter.from), to: map(table.delimiter.to) },
    rows: table.rows.map((row) => ({
      ...row,
      from: map(row.from),
      to: map(row.to),
      cells: row.cells.map((cell) => ({
        ...cell,
        from: map(cell.from),
        to: map(cell.to),
        textFrom: map(cell.textFrom),
        textTo: map(cell.textTo),
      })),
    })),
  };
}

interface Range {
  fromA: number;
  toA: number;
  fromB: number;
  toB: number;
}

/** What a change inside one row's text does to its table: the row read again, and the rows after it
 * moved by the change; or null when the change may make or break a table (it has a line break, a
 * pipe or a backslash, or it is not in the text of one row, after its first pipe). */
function rereadRow(
  state: EditorState,
  before: EditorState,
  table: Table,
  change: Range,
): Table | null {
  const row = table.rows.find((r) => r.from <= change.fromA && change.toA <= r.to);
  if (!row || change.fromA <= row.from || before.doc.sliceString(row.from, row.from + 1) !== '|') {
    return null;
  }
  const unsafe = /[|\\\n\r]/;
  if (unsafe.test(before.doc.sliceString(change.fromA, change.toA))) return null;
  if (unsafe.test(state.doc.sliceString(change.fromB, change.toB))) return null;
  const delta = change.toB - change.fromB - (change.toA - change.fromA);
  // Text after a closing pipe can make a cell, and a header with another number of cells than the
  // delimiter row is no table: a row that has other cells than it had is read with its table.
  const again = readRow(state.doc, row.from, row.to + delta, row.index);
  if (again.cells.length !== row.cells.length) return null;
  return {
    ...table,
    to: table.to + delta,
    rows: table.rows.map((r) => {
      if (r.to < change.fromA) return r;
      return r === row ? again : shiftRow(r, delta);
    }),
    delimiter:
      table.delimiter.from > change.toA ? shiftSpan(table.delimiter, delta) : table.delimiter,
  };
}

function shiftSpan(
  span: { from: number; to: number },
  delta: number,
): { from: number; to: number } {
  return { from: span.from + delta, to: span.to + delta };
}

function shiftRow(row: Row, delta: number): Row {
  return {
    ...row,
    from: row.from + delta,
    to: row.to + delta,
    cells: row.cells.map((cell) => ({
      ...cell,
      from: cell.from + delta,
      to: cell.to + delta,
      textFrom: cell.textFrom + delta,
      textTo: cell.textTo + delta,
    })),
  };
}

/** The start of the line that starts the lines of text that run up to `pos`, or the end of those
 * that run on from it (with a line either side): the block a change in it can alter. */
function blockEdge(doc: Text, pos: number, up: boolean): number {
  let line = doc.lineAt(Math.max(0, Math.min(doc.length, pos)));
  for (let steps = 0; steps < 2000; steps++) {
    const next = up ? line.number - 1 : line.number + 1;
    if (next < 1 || next > doc.lines) break;
    line = doc.line(next);
    if (line.text.trim() === '') break;
  }
  return up ? line.from : line.to;
}

/** The tables after a transaction, from the tables before it. */
function updateTables(
  tables: readonly Table[],
  tr: { startState: EditorState; state: EditorState; changes: ChangeDesc },
): readonly Table[] {
  const { state, startState, changes } = tr;
  const ranges: Range[] = [];
  changes.iterChangedRanges((fromA, toA, fromB, toB) => ranges.push({ fromA, toA, fromB, toB }));
  // A table is read with the lines of text above it that run into it, which make its header a line
  // of their paragraph, so a change in them can undo it.
  const reach = (doc: Text, pos: number, up: boolean) => blockEdge(doc, pos, up);
  const touches = (table: Table, r: Range) =>
    r.toA >= reach(startState.doc, table.from, true) && r.fromA <= table.to + 1;
  const kept: Table[] = [];
  const touched: { table: Table; hits: Range[] }[] = [];
  for (const table of tables) {
    const hits = ranges.filter((r) => touches(table, r));
    if (hits.length === 0) kept.push(mapTable(table, changes));
    else touched.push({ table, hits });
  }
  // One change, in one row of one table, and the rest of the changes after the table: the row alone.
  const only = touched.length === 1 ? touched[0] : undefined;
  const change = only?.hits.length === 1 ? only.hits[0] : undefined;
  // The other changes must be where no table can start or end: after this one, in text without a
  // pipe (the ledger, for one).
  const apart = (r: Range) =>
    r === change ||
    (r.fromA > only!.table.to + 1 &&
      !state.doc
        .sliceString(blockEdge(state.doc, r.fromB, true), blockEdge(state.doc, r.toB, false))
        .includes('|'));
  if (only && change && ranges.every(apart)) {
    const row = rereadRow(state, startState, only.table, change);
    if (row) return [...kept, row].sort((a, b) => a.from - b.from);
  }
  // Otherwise the tables that the changes touch, and any they make, are read again from the
  // changed text, a line either side of each change.
  const { doc } = state;
  const tree = treeOf(state, doc.length);
  const found = new Map<number, Table>();
  for (const r of ranges) {
    const from = blockEdge(doc, r.fromB, true);
    const to = blockEdge(doc, r.toB, false);
    for (const table of tablesBetween(state, tree, from, to)) found.set(table.from, table);
  }
  const fresh = [...found.values()];
  const rest = kept.filter((table) => !fresh.some((f) => f.from <= table.to && table.from <= f.to));
  return [...rest, ...fresh].sort((a, b) => a.from - b.from);
}

/** Tables by tree: the tree a field value was read from. */
const read = new WeakMap<readonly Table[], Tree>();

export const tablesField = StateField.define<readonly Table[]>({
  create(state) {
    const tables = buildTables(state);
    read.set(tables, syntaxTree(state));
    return tables;
  },
  update(tables, tr) {
    if (!tr.docChanged) {
      // A parse that went on, with no change to the text, may have found more of the tables.
      const tree = syntaxTree(tr.state);
      if (read.get(tables) === tree) return tables;
      const again = buildTables(tr.state);
      read.set(again, tree);
      return again;
    }
    const next = updateTables(tables, tr);
    read.set(next, syntaxTree(tr.state));
    return next;
  },
});

/** The tables of a state, in order. */
export function tablesOf(state: EditorState): readonly Table[] {
  return state.field(tablesField);
}

/**
 * The cell that holds `pos`, or the nearest to it in a table: a position in a pipe or in padding is
 * in the cell it belongs to (cells run from the pipe in front of them), and one in the delimiter row
 * is in the header's last cell. Null outside every table.
 */
export function cellAt(
  state: EditorState,
  pos: number,
): { table: Table; row: Row; cell: Cell } | null {
  const tables = tablesOf(state);
  let low = 0;
  let high = tables.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const table = tables[middle];
    if (!table) return null;
    if (pos < table.from) high = middle - 1;
    else if (pos > table.to) low = middle + 1;
    else return within(table, pos);
  }
  return null;
}

function within(table: Table, pos: number): { table: Table; row: Row; cell: Cell } | null {
  // The row that holds `pos`, or the header when `pos` is in the delimiter row, which the header's
  // last cell holds.
  let row = table.rows.find((r) => r.from <= pos && pos <= r.to);
  row ??= table.rows[0];
  if (!row || row.cells.length === 0) return null;
  let cell = row.cells.find((c, i) => c.from <= pos && (pos < c.to || i === row.cells.length - 1));
  cell ??= row.cells.at(-1);
  if (!cell) return null;
  return { table, row, cell };
}
