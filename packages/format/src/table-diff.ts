// An agent's `str_replace` over a table (format §3.7, "Agents"): when the old and the new text hold the
// same table, the two are compared as tables. Rows are matched by their text, so an added row is a row
// insertion, a removed one a deletion, a reordered one a move, and the cells that changed in a row
// that stays are changed word by word, as an edit in a cell is. The edits are those of a person, by
// the agent's name; nothing here is a new form.

import { wordHunks } from './agent.ts';
import { applyChanges } from './changes.ts';
import { EditError } from './errors.ts';
import { assertNoMarkup } from './edit-support.ts';
import { idsIn, newId } from './ids.ts';
import { parse } from './parse.ts';
import { readTables } from './table.ts';
import type { TableRead } from './table.ts';
import { tableEdit } from './table-ops.ts';
import type { TableOp } from './table-ops.ts';
import { trackedEdits } from './track.ts';
import type { TrackedEdits } from './track.ts';
import type { DocView, EditContext, TextChange } from './types.ts';

/** A cell whose text is to change, in a row that stays. */
export interface CellChange {
  /** The row's index in the old table, the header 0. */
  row: number;
  column: number;
  from: string;
  to: string;
}

/** What turns one table into another. The operations are in the order they are made: rows that go,
 * then rows that move, then rows that come, each counted in the table as the ones before left it. */
export interface TableChanges {
  cells: CellChange[];
  ops: TableOp[];
}

export const ROWS_AND_COLUMNS =
  'Make the row changes now and leave the column changes until the person has decided them.';

/** The text of each row's cells, as the table shows them. */
function cellsOf(text: string, table: TableRead): string[][] {
  const columns = table.aligns.length;
  return table.rows.map((row) =>
    Array.from({ length: columns }, (_, i) => {
      const cell = row.cells[i];
      return cell ? text.slice(cell.textFrom, cell.textTo).trim() : '';
    }),
  );
}

/** The indexes of a longest strictly increasing run. */
function longestRun(values: readonly number[]): Set<number> {
  const tails: number[] = [];
  const tailAt: number[] = [];
  const before = new Array<number>(values.length).fill(-1);
  values.forEach((value, i) => {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if ((tails[middle] ?? 0) < value) low = middle + 1;
      else high = middle;
    }
    tails[low] = value;
    tailAt[low] = i;
    before[i] = low > 0 ? (tailAt[low - 1] ?? -1) : -1;
  });
  const kept = new Set<number>();
  let i = tailAt[tails.length - 1] ?? -1;
  while (i >= 0) {
    kept.add(i);
    i = before[i] ?? -1;
  }
  return kept;
}

/**
 * Compares two tables as tables. `null` when the texts do not hold one table each, or when only
 * cells changed (an edit in cells is written as it always was), or when only columns changed (the
 * columns come with Stage 3b); `{ refused }` when rows and columns change together.
 */
export function diffTables(
  oldText: string,
  newText: string,
): TableChanges | { refused: string } | null {
  const oldRead = readTables(oldText, parse(oldText));
  const newRead = readTables(newText, parse(newText));
  const [before, after] = [oldRead[0], newRead[0]];
  if (oldRead.length !== 1 || newRead.length !== 1 || !before || !after) return null;
  const a = cellsOf(oldText, before);
  const b = cellsOf(newText, after);
  if (before.aligns.length !== after.aligns.length) {
    return a.length === b.length ? null : { refused: ROWS_AND_COLUMNS };
  }
  const delimiter = (text: string, table: TableRead) =>
    text.slice(table.delimiter.from, table.delimiter.to).replace(/\s+/g, '');
  if (delimiter(oldText, before) !== delimiter(newText, after)) return null;

  const keyOf = (cells: readonly string[]) => cells.join('\u0001');
  // Rows with the same text, in order.
  const free = new Map<string, number[]>();
  a.forEach((cells, i) => {
    const key = keyOf(cells);
    free.set(key, [...(free.get(key) ?? []), i]);
  });
  const pairOfNew = new Map<number, number>();
  b.forEach((cells, j) => {
    const old = free.get(keyOf(cells))?.shift();
    if (old !== undefined) pairOfNew.set(j, old);
  });
  const matchedOld = new Set(pairOfNew.values());
  const matchedNew = [...pairOfNew.keys()].sort((x, y) => x - y);
  const stable = longestRun(matchedNew.map((j) => pairOfNew.get(j) ?? 0));
  const anchors = matchedNew.filter((_, k) => stable.has(k));

  // Rows that stay in place but changed: between two anchors, the rows left over in order that have
  // a cell in common.
  const changed = new Map<number, number>();
  const bounds = [
    [-1, -1],
    ...anchors.map((j) => [pairOfNew.get(j) ?? 0, j]),
    [a.length, b.length],
  ];
  for (let k = 0; k + 1 < bounds.length; k++) {
    const [o0, n0] = bounds[k] as number[];
    const [o1, n1] = bounds[k + 1] as number[];
    let from = (n0 ?? -1) + 1;
    for (let i = (o0 ?? -1) + 1; i < (o1 ?? 0); i++) {
      if (matchedOld.has(i)) continue;
      for (let j = from; j < (n1 ?? 0); j++) {
        if (pairOfNew.has(j) || [...changed.values()].includes(j)) continue;
        const [x, y] = [a[i] ?? [], b[j] ?? []];
        if (x.some((cell, c) => cell !== '' && cell === y[c])) {
          changed.set(i, j);
          from = j + 1;
          break;
        }
      }
    }
  }
  const cells: CellChange[] = [];
  for (const [i, j] of changed) {
    (a[i] ?? []).forEach((from, column) => {
      const to = b[j]?.[column] ?? '';
      if (from !== to) cells.push({ row: i, column, from, to });
    });
  }

  const deleted = a.map((_, i) => i).filter((i) => !matchedOld.has(i) && !changed.has(i));
  const newOfOld = new Map<number, number>([...pairOfNew].map(([j, i]) => [i, j]));
  for (const [i, j] of changed) newOfOld.set(i, j);
  const inserted = b
    .map((_, j) => j)
    .filter((j) => !pairOfNew.has(j) && ![...changed.values()].includes(j));
  const moved = matchedNew.filter((_, k) => !stable.has(k));
  if (deleted.length === 0 && inserted.length === 0 && moved.length === 0) return null;

  const ops: TableOp[] = [];
  if (deleted.length > 0) ops.push({ kind: 'deleteRows', table: 0, rows: deleted });
  // The rows now, as old indexes, and the order they are to be in.
  let current = a.map((_, i) => i).filter((i) => !deleted.includes(i));
  const target = b
    .map((_, j) => j)
    .filter((j) => !inserted.includes(j))
    .map((j) => [...newOfOld].find(([, to]) => to === j)?.[0] ?? -1);
  const inPlace = longestRun(current.map((i) => target.indexOf(i)));
  const movers = current.filter((_, k) => !inPlace.has(k));
  for (const row of movers.toSorted((x, y) => target.indexOf(x) - target.indexOf(y))) {
    const index = current.indexOf(row);
    const rest = current.filter((r) => r !== row);
    const before = target[target.indexOf(row) - 1];
    const place = before === undefined ? 0 : rest.indexOf(before) + 1;
    const to = place <= index ? place : place + 1;
    if (to !== index && to !== index + 1)
      ops.push({ kind: 'moveRows', table: 0, rows: [index], to });
    current = [...rest.slice(0, place), row, ...rest.slice(place)];
  }
  // New rows go below the row that comes before them in the new table.
  const order = b.map((_, j) => j);
  const presence = current.map((i) => newOfOld.get(i) ?? -1);
  const layout = [...presence];
  for (const j of order) {
    if (!inserted.includes(j)) continue;
    const previous = j === 0 ? -1 : layout.indexOf(j - 1);
    ops.push({
      kind: 'insertRows',
      table: 0,
      after: j === 0 ? -1 : previous,
      count: 1,
      texts: [b[j] ?? []],
    });
    layout.splice(previous + 1, 0, j);
  }
  return { cells, ops };
}

/** The changes between two texts, in the body and in the ledger, each as one change of what differs. */
function changesBetween(before: string, after: string): TextChange[] {
  const split = (text: string) => parse(text).ledgerRange?.from ?? text.length;
  const [bodyBefore, bodyAfter] = [split(before), split(after)];
  const part = (a: string, b: string, offset: number): TextChange[] => {
    let start = 0;
    while (start < a.length && start < b.length && a[start] === b[start]) start++;
    let endA = a.length;
    let endB = b.length;
    while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
      endA--;
      endB--;
    }
    return start === endA && start === endB
      ? []
      : [{ from: offset + start, to: offset + endA, insert: b.slice(start, endB) }];
  };
  return [
    ...part(before.slice(0, bodyBefore), after.slice(0, bodyAfter), 0),
    ...part(before.slice(bodyBefore), after.slice(bodyAfter), bodyBefore),
  ];
}

/**
 * The tracked edits of an agent's replacement of `before` by `after` (in the file's line breaks), when
 * both hold the same table; `null` when they do not, or when only cells changed.
 *
 * @throws EditError when the table changes are refused, or the new text holds Redlines markup.
 */
export function tableSuggestion(
  text: string,
  view: DocView,
  before: string,
  after: string,
  start: number,
  ctx: EditContext,
): TrackedEdits | null {
  if (!before.includes('|') || !after.includes('|') || !before.includes('\n')) return null;
  const old = readTables(before, parse(before))[0];
  const now = readTables(after, parse(after))[0];
  if (!old || !now) return null;
  // The text around the table is as it was.
  if (before.slice(0, old.from) !== after.slice(0, now.from)) return null;
  if (before.slice(old.to) !== after.slice(now.to)) return null;
  const diff = diffTables(before.slice(old.from, old.to), after.slice(now.from, now.to));
  if (diff === null) return null;
  if ('refused' in diff) throw new EditError(diff.refused, 'no-legal-placement');
  assertNoMarkup(after);

  // The table of the file that this one is: its header is where the old text's is, and its rows
  // are the old text's rows.
  const viewTables = readTables(view.text, parse(view.text));
  const at = start + old.from;
  const index = viewTables.findIndex((t) => t.from === at);
  const shown = viewTables[index];
  if (!shown || shown.rows.length < old.rows.length) return null;
  const sameRows = old.rows.every(
    (row, i) =>
      view.text.slice(shown.rows[i]?.from, shown.rows[i]?.to) === before.slice(row.from, row.to),
  );
  if (!sameRows) return null;
  const tableAt = (current: string) => readTables(current, parse(current))[index];
  const first = tableAt(text);
  if (!first || first.rows.length !== shown.rows.length) return null;

  let current = text;
  const taken = idsIn(text);
  const marks = diff.ops.length + (diff.cells.length > 0 ? 1 : 0);
  const group = ctx.group ?? (marks > 1 ? newId(taken, ctx.random) : undefined);
  const stepCtx: EditContext = group === undefined ? ctx : { ...ctx, group };
  const known = new Set(parse(text).marks.map((mark) => mark.id));

  if (diff.cells.length > 0) {
    const edits: TextChange[] = [];
    for (const change of diff.cells) {
      const cell = shown.rows[change.row]?.cells[change.column];
      const source = first.rows[change.row]?.cells[change.column];
      if (!cell || !source) return null;
      for (const hunk of wordHunks(change.from, change.to)) {
        const base = cell.textFrom;
        const insertion = hunk.from === hunk.to;
        const from = view.map.toSource(base + hunk.from, insertion && hunk.from > 0 ? -1 : 1);
        const to = insertion ? from : view.map.toSource(base + hunk.to, -1);
        edits.push({ from, to, insert: hunk.insert });
      }
    }
    const done = trackedEdits(
      current,
      edits.toSorted((x, y) => x.from - y.from),
      stepCtx,
    );
    current = applyChanges(current, done.changes);
  }
  for (const op of diff.ops) {
    const table = tableAt(current);
    if (!table) return null;
    const done = tableEdit(current, { ...op, table: table.from }, stepCtx);
    current = applyChanges(current, done.changes);
  }
  const markIds = parse(current)
    .marks.filter((mark) => !known.has(mark.id) && mark.kind !== 'cmt')
    .map((mark) => mark.id);
  return { changes: changesBetween(text, current), markIds, extendedIds: [] };
}
