// The columns of a table, rearranged (format §3.7). Every operation on columns (inserting, deleting,
// moving, and deciding them) comes to the same thing: the columns the table has afterwards, some kept
// where they are, some cut out of their place and written at another, some new, and the deleted
// columns kept below it. This file turns that into changes of the text that touch as little as they
// can: a cell is the pipe in front of it and what lies up to the next (its unit), and only the units
// of the columns that leave, move or come are taken out or written, so that everything else in the
// rows, marks included, stays where it is.
//
// The first cell of a row inserted and not yet decided holds that row's marker. It follows the first
// cell, whichever column that is, so that a row keeps its marker when a column is put in front of it
// or its first column goes.

import { readLine } from './table.ts';
import type { TableDeletionRead, TableLineRead, TableRead } from './table.ts';
import {
  afterRemoval,
  afterWriting,
  joinPoints,
  removeDeletionLines,
  rowMarker,
  setPositions,
} from './table-rows.ts';
import { EditError } from './errors.ts';
import { commentsOfCols } from './table-rules.ts';
import type { MarkRange, Parsed, Range, TextChange } from './types.ts';

/** The lines of a table as cells: the header, the delimiter row, and the body rows. */
export interface Grid {
  table: TableRead;
  lines: TableLineRead[];
  /** The marker of an inserted row, and the space after it, in the first cell of each line. */
  rowMarkers: (Range | null)[];
  /** The columns the header has. */
  columns: number;
}

export function gridOf(text: string, table: TableRead): Grid {
  const rows = table.rows.map((row) => readLine(text, row.from, row.to));
  const delimiter = readLine(text, table.delimiter.from, table.delimiter.to);
  const markers = table.rows.map((row) => (row.insertion ? rowMarker(text, row) : null));
  return {
    table,
    lines: [rows[0] as TableLineRead, delimiter, ...rows.slice(1)],
    rowMarkers: [markers[0] ?? null, null, ...markers.slice(1)],
    columns: table.aligns.length,
  };
}

/** The text of the cell `col` of a line, between its pipes, as written. */
export function contentOf(text: string, line: TableLineRead, col: number): string | undefined {
  const cell = line.cells[col];
  return cell ? text.slice(cell.contentFrom, cell.contentTo) : undefined;
}

/** Where a marker goes in the content of a cell: after the first space, in front of the text. */
const slot = (content: string): number => (/^[ \t]/.test(content) ? 1 : 0);

/** The content with the marker of an inserted row at the start of its text. */
export function withRowMarker(content: string, marker: string): string {
  const at = slot(content);
  return content.slice(0, at) + marker + content.slice(at);
}

const ROW_MARKER_START = /^[ \t]*<!--ins [a-z0-9]{4} row--> ?/;

/** The content with the marker of an inserted column at the start of its text, after the marker of an
 * inserted row if the cell has one. */
export function withColMarker(content: string, marker: string): string {
  const at = ROW_MARKER_START.exec(content)?.[0].length ?? slot(content);
  return content.slice(0, at) + marker + ' ' + content.slice(at);
}

/** The content without the marker of the inserted column `id`, and the space after it. */
export function withoutColMarker(content: string, id: string): string {
  return content.replace(new RegExp(`<!--ins ${id} col--> ?`), '');
}

/**
 * A column of the table as it is to be: column `src` of the table as written, kept in its place or, with
 * `moving`, cut out and written where it goes (with `edit` applied to its content in each line), or new
 * cells, their content in each line.
 */
export type ColItem =
  | { src: number; moving?: false }
  | { src: number; moving: true; edit?: (line: number, content: string) => string }
  | { text: (line: number) => string };

const isStaying = (item: ColItem): item is { src: number; moving?: false } =>
  'src' in item && !item.moving;

/**
 * The changes that give the lines of a table the columns `final`, in order. A column that stays is not
 * touched; one that leaves is taken out with the pipe in front of it; one that moves is taken out and
 * written again at its place with its content; new ones are written. A row with fewer cells than the
 * table has columns is written no cell beyond its last (GFM reads the rest as empty).
 */
export function columnChanges(
  text: string,
  grid: Grid,
  final: readonly ColItem[],
  /** Leave a line that is one pipe as it is: new columns are written in no such line (GFM reads it
   * as blank cells), so that rejecting them gives its bytes back. A column written back is not new. */
  skipLone = false,
): TextChange[] {
  const changes: TextChange[] = [];
  const staying = new Set(final.flatMap((item) => (isStaying(item) ? [item.src] : [])));
  const first = final[0];
  const firstStays = first !== undefined && isStaying(first) && first.src === 0;
  grid.lines.forEach((read, k) => {
    if (read.lone && skipLone) return;
    // A line that is one pipe stands for one empty cell, which a column written back is put in front of
    // or after (it was emptied by a deletion that went with a column's).
    const pipe = read.lone ? text.indexOf('|', read.from) : -1;
    const line = read.lone
      ? {
          ...read,
          cells: [{ open: pipe, close: pipe, contentFrom: pipe + 1, contentTo: pipe + 1 }],
        }
      : read;
    const n = line.cells.length;
    const limit = Math.min(n, grid.columns);
    const marker = grid.rowMarkers[k] ?? null;
    const markerText = marker ? text.slice(marker.from, marker.to) : '';
    const carry = marker !== null && !firstStays;
    for (let c = 0; c < limit; c++) {
      const cell = line.cells[c];
      if (!staying.has(c) && cell) changes.push({ from: cell.open, to: cell.close, insert: '' });
    }
    if (carry && staying.has(0)) changes.push({ from: marker.from, to: marker.to, insert: '' });
    const contentAt = (c: number): string => {
      const cell = line.cells[c];
      if (!cell) return '';
      // The marker of an inserted row stays with the row, not the cell: it goes to the new first cell.
      if (c === 0 && marker) {
        return text.slice(cell.contentFrom, marker.from) + text.slice(marker.to, cell.contentTo);
      }
      return text.slice(cell.contentFrom, cell.contentTo);
    };
    let run: string[] = [];
    let runAt = 0;
    let runPresent = 0;
    let present = 0;
    const flush = (before: number | null) => {
      if (run.length === 0) return;
      const cells = run;
      run = [];
      // A row too short to have the cells in front of these is left alone: GFM reads it as empty.
      if (runPresent !== runAt) return;
      if (before !== null) {
        const cell = line.cells[before];
        if (!cell) return;
        if (before === 0 && !line.leadingPipe) {
          changes.push({ from: line.from, to: line.from, insert: `|${cells.join('|')}|` });
        } else {
          changes.push({
            from: cell.open,
            to: cell.open,
            insert: cells.map((cellText) => `|${cellText}`).join(''),
          });
        }
        return;
      }
      const written = cells.map((cellText) => `|${cellText}`).join('');
      const beyond = line.cells[limit];
      if (limit < n && beyond)
        changes.push({ from: beyond.open, to: beyond.open, insert: written });
      else if (line.trailingPipe) {
        const close = line.cells[n - 1]?.close ?? line.to;
        changes.push({ from: close, to: close, insert: written });
      } else changes.push({ from: line.to, to: line.to, insert: written });
    };
    // A row of one cell with no pipe at all would be no row of a table: it gets its leading pipe.
    const after = final.filter((item) => !('src' in item) || item.src < n).length;
    if (!line.leadingPipe && !line.trailingPipe && staying.has(0) && after === 1 && n > 1) {
      changes.push({ from: line.from, to: line.from, insert: '|' });
    }
    final.forEach((item, f) => {
      if (isStaying(item)) {
        if (item.src >= n) return;
        flush(item.src);
        present++;
        if (carry && f === 0) {
          const cell = line.cells[item.src];
          if (cell) {
            const at = cell.contentFrom + slot(text.slice(cell.contentFrom, cell.contentTo));
            changes.push({ from: at, to: at, insert: markerText });
          }
        }
        return;
      }
      let content: string;
      if ('src' in item) {
        if (item.src >= n) return;
        content = contentAt(item.src);
        if (item.edit) content = item.edit(k, content);
      } else content = item.text(k);
      if (carry && f === 0) content = withRowMarker(content, markerText);
      if (run.length === 0) {
        runAt = f;
        runPresent = present;
      }
      run.push(content);
      present++;
    });
    flush(null);
    // A row with no closing pipe whose last cell changes would end in a cell that is blank, which GFM
    // does not read as a cell: it gets the closing pipe.
    const last = final.findLast((item) => !('src' in item) || item.src < n);
    if (
      !line.trailingPipe &&
      limit === n &&
      n > 0 &&
      last !== undefined &&
      !(isStaying(last) && last.src === n - 1)
    ) {
      changes.push({ from: line.to, to: line.to, insert: '|' });
    }
  });
  return changes;
}

/** The ids of the marks of `table` that are columns or deleted columns, and the twins of moves. */
export function colMarkIds(table: TableRead): Set<string> {
  const ids = new Set<string>();
  for (const { mark } of table.colMarks) ids.add(mark.id);
  for (const deletion of table.deletions) if (deletion.axis === 'col') ids.add(deletion.mark.id);
  return ids;
}

/** The cells of a deleted column as its payload keeps them, one per line of the table: `col=N` and the
 * cells from the header down, the delimiter row's included, apart by line breaks. */
export function deletedColCells(payload: string | undefined): string[] {
  const found = /^col=\d+ ?/.exec(payload ?? '');
  return (payload ?? '').slice(found?.[0].length ?? 0).split('\n');
}

/** The payload of the deletion of a column: its position (from 1) and its cells. */
export function deletedColPayload(position: number, cells: readonly string[]): string {
  return `col=${position} ${cells.join('\n')}`;
}

/** The dashes of a delimiter cell and the empty content of a cell, for new columns: in a table whose
 * rows line up the column is three wide, otherwise as narrow as the table's narrowest. */
export function newColumnShape(text: string, grid: Grid): { dashes: number; empty: string } {
  const delimiter = grid.lines[1];
  const widths = (delimiter?.cells ?? []).map(
    (cell) => text.slice(cell.contentFrom, cell.contentTo).replace(/[ \t:]/g, '').length,
  );
  const padded = grid.table.padded;
  const dashes = padded ? 3 : Math.max(1, Math.min(3, ...widths));
  return { dashes, empty: ' '.repeat(padded ? 5 : 2) };
}

/** The content of a new column's cell in each kind of line. */
export function newCellContent(
  line: number,
  shape: { dashes: number; empty: string },
  marker: string | null,
  text?: string,
): string {
  if (line === 1) return ` ${'-'.repeat(shape.dashes)} `;
  // Text a new column is given (an agent's) stands in the cell as wide as the shape says.
  const inner = text ? text.padEnd(shape.empty.length - 2) : ' '.repeat(shape.empty.length - 2);
  if (line === 0 && marker !== null) return ` ${marker} ${inner} `;
  return ` ${inner} `;
}

/** What deciding columns comes to: the changes, and the marks that are decided with them. */
export interface ColDecision {
  changes: TextChange[];
  /** Every mark decided, the other half of a move among them. */
  decided: string[];
  /** The comments and highlights in columns that leave, which the changes deal with. */
  anchored: Set<string>;
  /** The comments and highlights in cells that are cut out and written again, which travel with the
   * text. */
  travelling: Set<string>;
}

const positionsOf = (table: TableRead): number[] =>
  table.deletions.map((deletion) =>
    deletion.axis === 'col' ? deletion.position - 1 : deletion.position,
  );

/**
 * The columns of the original table in order: for each, the index of the column of `table` that is
 * there, or -1 for a column that is a deletion's (it comes back). Inserted columns are not in it.
 */
export function originalOrder(table: TableRead): number[] {
  const cut = new Set(table.colMarks.map((c) => c.col));
  let positions = positionsOf(table);
  for (const col of [...cut].sort((a, b) => b - a)) {
    positions = positions.map((p) => afterRemoval(p, col));
  }
  const order = Array.from({ length: table.aligns.length }, (_, c) => c).filter((c) => !cut.has(c));
  const lines = table.deletions
    .map((deletion, line) => ({ deletion, line }))
    .filter(({ deletion }) => deletion.axis === 'col')
    .map(({ line }) => line)
    .sort((a, b) => b - a);
  for (const line of lines) {
    const index = Math.min(positions[line] ?? 0, order.length);
    order.splice(index, 0, -1);
    positions = positions.map((p, k) => (k === line ? p : afterWriting(p, index, k, line)));
  }
  return order;
}

/**
 * The decision of the columns' marks `ids` of one table (format §3.7), all accepted or all rejected,
 * or, with `original`, every column mark rejected as the original view reads it. Accepting takes the
 * markers and the deletion lines away; rejecting takes inserted columns away, writes deleted columns
 * back where they were and moves a moved column back to its place. Both halves of a move are decided
 * together. Every deletion's position is rewritten as the columns around it go and come.
 *
 * @throws EditError when the table would be left with no column.
 */
export function decideCols(
  text: string,
  parsed: Parsed,
  table: TableRead,
  ids: ReadonlySet<string>,
  action: 'accept' | 'reject',
  original = false,
): ColDecision {
  const colDeletions = table.deletions
    .map((deletion, line) => ({ deletion, line }))
    .filter(({ deletion }) => deletion.axis === 'col');
  const lineOfId = new Map(colDeletions.map(({ deletion, line }) => [deletion.mark.id, line]));
  const insOfId = new Map(table.colMarks.map(({ mark, col }) => [mark.id, col]));
  const wanted = new Set<string>();
  const want = (id: string) => {
    wanted.add(id);
    const mark =
      table.colMarks.find((c) => c.mark.id === id)?.mark ??
      colDeletions.find((d) => d.deletion.mark.id === id)?.deletion.mark;
    const twin = mark?.entry.move;
    if (twin !== undefined && (insOfId.has(twin) || lineOfId.has(twin))) wanted.add(twin);
  };
  for (const id of ids) if (insOfId.has(id) || lineOfId.has(id)) want(id);
  if (original) for (const id of [...insOfId.keys(), ...lineOfId.keys()]) wanted.add(id);

  const decidedCols = [...insOfId].filter(([id]) => wanted.has(id)).map(([, col]) => col);
  const decidedLines = new Set([...lineOfId].filter(([id]) => wanted.has(id)).map(([, l]) => l));
  const decided = [...wanted];
  const none = { anchored: new Set<string>(), travelling: new Set<string>() };

  if (action === 'accept' && !original) {
    const changes: TextChange[] = [];
    for (const { mark } of table.colMarks) {
      if (!wanted.has(mark.id)) continue;
      const open = mark.segments[0]?.open;
      if (!open) continue;
      const to = /^[ \t]/.test(text.charAt(open.to)) ? open.to + 1 : open.to;
      changes.push({ from: open.from, to, insert: '' });
    }
    changes.push(...removeDeletionLines(text, table, decidedLines));
    return { changes, decided, ...none };
  }

  const twinLine = (col: number): number | undefined => {
    const move = table.colMarks.find((c) => c.col === col)?.mark.entry.move;
    return move === undefined ? undefined : lineOfId.get(move);
  };
  // Columns that go: those inserted. A moved column comes back, in the place of its deletion.
  const relocate = (col: number) => !original && twinLine(col) !== undefined;
  const leaving = new Set(decidedCols.filter((col) => !relocate(col)));
  const cutOut = new Set(decidedCols);
  let positions = positionsOf(table);
  const cur: ColItem[] = Array.from({ length: table.aligns.length }, (_, src) => ({ src }));
  const stay = cur.filter((item) => 'src' in item && !cutOut.has(item.src));
  let items: ColItem[] = stay;
  for (const col of [...cutOut].sort((a, b) => b - a)) {
    positions = positions.map((p) => afterRemoval(p, col));
  }
  const moving = new Set<number>();
  const restoring = [...decidedLines].sort((a, b) => b - a);
  for (const line of restoring) {
    const deletion = table.deletions[line] as TableDeletionRead;
    const copy = [...insOfId].find(([, col]) => twinLine(col) === line && relocate(col))?.[1];
    const id = copy === undefined ? undefined : table.colMarks.find((c) => c.col === copy)?.mark.id;
    const cells = deletedColCells(deletion.mark.payload);
    const item: ColItem =
      copy === undefined || id === undefined
        ? { text: (k) => cells[k] ?? '' }
        : {
            src: copy,
            moving: true,
            edit: (k, content) => (k === 0 ? withoutColMarker(content, id) : content),
          };
    if (copy !== undefined) moving.add(copy);
    const index = Math.min(positions[line] ?? 0, items.length);
    items = [...items.slice(0, index), item, ...items.slice(index)];
    positions = positions.map((p, k) => (k === line ? p : afterWriting(p, index, k, line)));
  }
  if (items.length === 0) {
    throw new EditError('A table keeps at least one column.', 'no-legal-placement');
  }
  const pending = new Set(table.deletions.map((_, k) => k).filter((k) => !decidedLines.has(k)));
  const grid = gridOf(text, table);
  const changes: TextChange[] = [
    ...columnChanges(text, grid, items),
    ...removeDeletionLines(text, table, decidedLines),
    ...setPositions(text, table, positions, pending, 'col'),
  ];
  const anchored = new Set<string>();
  const travelling = new Set<string>();
  if (!original) {
    const comments = commentsOfCols(parsed, table, leaving);
    changes.push(...comments.writes);
    for (const id of comments.anchored) anchored.add(id);
  }
  // The comments and highlights inside the cells that are cut out and written again are written
  // with them.
  for (const mark of parsed.marks) {
    if (mark.kind !== 'cmt' && mark.kind !== 'hl') continue;
    if (anchored.has(mark.id) || !touchesTable(mark, table)) continue;
    travelling.add(mark.id);
  }
  return { changes: joinPoints(changes), decided, anchored, travelling };
}

/** Whether a mark has a marker in the lines of a table. */
function touchesTable(mark: MarkRange, table: TableRead): boolean {
  return mark.segments.some((segment) =>
    [segment.open, segment.close].some(
      (range) => range !== undefined && table.from <= range.from && range.to <= table.to,
    ),
  );
}
