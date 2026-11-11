// The text of a table's rows and the deletions below it, rearranged (format §3.7). Every operation
// on rows (deleting, moving, inserting above the header, and deciding them) comes to the same thing:
// the rows the table has afterwards, some kept where they are, some moved, some new, and the
// deleted rows kept below it. This file turns that into changes of the text that touch as little as
// they can: a row that keeps its place is not rewritten, and the delimiter row follows the first row
// in every state.

import { lineEnd } from './blocks.ts';
import type { TableDeletionRead, TableRead, TableRowRead } from './table.ts';
import type { Range, TextChange } from './types.ts';

/**
 * A row of the table as it is to be: row `src` of the table as written (the header is 0), with the
 * changes `patch` made inside it (in offsets of the text), or new text.
 */
export type RowItem = { src: number; patch?: readonly TextChange[] } | { text: string };

/** The marker of an inserted row, with the space after it (as accepting takes it). */
export function rowMarker(text: string, row: TableRowRead): { from: number; to: number } | null {
  const open = row.insertion?.segments[0]?.open;
  const cell = row.cells[0];
  if (!open || !cell) return null;
  // The marker and one space, whatever follows: what is in the cell after it is not what decides,
  // or two orders of deciding the row and a change in its cell would not write the same bytes.
  const to = open.to < cell.to && /^[ \t]/.test(text.charAt(open.to)) ? open.to + 1 : open.to;
  return { from: open.from, to };
}

/** The line of a row, as written. */
export function rowTextOf(text: string, row: TableRowRead): string {
  return text.slice(row.from, row.to);
}

function patched(text: string, row: TableRowRead, patch: readonly TextChange[]): string {
  let out = '';
  let at = row.from;
  for (const change of patch.toSorted((a, b) => a.from - b.from || a.to - b.to)) {
    out += text.slice(at, change.from) + change.insert;
    at = change.to;
  }
  return out + text.slice(at, row.to);
}

/** The indexes of a longest strictly increasing run of `values` (undefined ones left out). */
function longestRun(values: readonly (number | undefined)[]): Set<number> {
  const tails: number[] = [];
  const tailAt: number[] = [];
  const before: number[] = new Array<number>(values.length).fill(-1);
  values.forEach((value, i) => {
    if (value === undefined) return;
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
 * The changes that give a table the rows `final`, in order, the first one the header. Rows that keep
 * their relative order stay where they are; the others are taken out and written again where they
 * go. The delimiter row follows the first row: when the header changes it is moved with it.
 */
export function arrangeRows(
  text: string,
  table: TableRead,
  final: readonly RowItem[],
  eol: string,
): TextChange[] {
  const srcs = final.map((item) => ('src' in item ? item.src : undefined));
  const keptAt = longestRun(srcs);
  const keepsSrc = new Set<number>();
  for (const i of keptAt) {
    const src = srcs[i];
    if (src !== undefined) keepsSrc.add(src);
  }
  // The delimiter row stays when the first row of the table stays the first.
  const first = final[0];
  const delimiterStays = first !== undefined && 'src' in first && first.src === 0 && keptAt.has(0);

  const rows = table.rows;
  // The original lines: row 0, the delimiter row, rows 1…
  const lines: (Range & { row: number | 'delimiter' })[] = [
    { from: rows[0]?.from ?? table.from, to: rows[0]?.to ?? table.from, row: 0 },
    { ...table.delimiter, row: 'delimiter' },
    ...rows.slice(1).map((row, i) => ({ from: row.from, to: row.to, row: i + 1 })),
  ];
  const gone = lines.map((line) =>
    line.row === 'delimiter' ? !delimiterStays : !keepsSrc.has(line.row),
  );

  const changes: TextChange[] = [];
  // Taking out the lines that go, a run at a time, with the line break before the run (or after it
  // for a run that starts the table).
  for (let a = 0; a < lines.length; a++) {
    if (!gone[a]) continue;
    let b = a;
    while (b + 1 < lines.length && gone[b + 1]) b++;
    const start = lines[a] as Range;
    const end = lines[b] as Range;
    const next = lines[b + 1];
    if (a > 0) changes.push({ from: (lines[a - 1] as Range).to, to: end.to, insert: '' });
    else if (next) changes.push({ from: start.from, to: next.from, insert: '' });
    else changes.push({ from: start.from, to: end.to, insert: '' });
    a = b;
  }

  // Writing the lines that are new, after the line that stays before them.
  const writes = new Map<number, string>();
  let anchor = table.from;
  let atStart = true;
  const write = (line: string) => {
    writes.set(anchor, (writes.get(anchor) ?? '') + (atStart ? line + eol : eol + line));
  };
  const delimiterText = text.slice(table.delimiter.from, table.delimiter.to);
  final.forEach((item, i) => {
    if (keptAt.has(i) && 'src' in item) {
      const row = rows[item.src] as TableRowRead;
      if (item.patch) changes.push(...item.patch);
      anchor = row.to;
      atStart = false;
    } else if ('src' in item) {
      const row = rows[item.src] as TableRowRead;
      write(item.patch ? patched(text, row, item.patch) : rowTextOf(text, row));
    } else write(item.text);
    if (i === 0 && !delimiterStays) write(delimiterText);
    else if (i === 0) {
      anchor = table.delimiter.to;
      atStart = false;
    }
  });
  for (const [at, insert] of writes) changes.push({ from: at, to: at, insert });
  return changes.toSorted((a, b) => a.from - b.from || a.to - b.to);
}

/** The line of a deletion below a table: from the start of its marker to the end of the line. */
export function deletionLine(text: string, deletion: TableDeletionRead): Range {
  const open = deletion.mark.segments[0]?.open;
  const from = open?.from ?? 0;
  return { from, to: lineEnd(text, from) };
}

/** The end of a table's last line of rows. */
export function tableEnd(table: TableRead): number {
  return Math.max(table.rows.at(-1)?.to ?? 0, table.delimiter.to);
}

/**
 * The changes that take the deletions in `lines` (indexes into `table.deletions`) out of the text;
 * the blank line in front of them goes with the last one.
 */
export function removeDeletionLines(
  text: string,
  table: TableRead,
  lines: ReadonlySet<number>,
): TextChange[] {
  const all = table.deletions.map((deletion) => deletionLine(text, deletion));
  const changes: TextChange[] = [];
  for (let a = 0; a < all.length; a++) {
    if (!lines.has(a)) continue;
    let b = a;
    while (b + 1 < all.length && lines.has(b + 1)) b++;
    const end = all[b] as Range;
    const next = all[b + 1];
    if (a > 0) changes.push({ from: (all[a - 1] as Range).to, to: end.to, insert: '' });
    else if (next) changes.push({ from: (all[0] as Range).from, to: next.from, insert: '' });
    else changes.push({ from: tableEnd(table), to: end.to, insert: '' });
    a = b;
  }
  return changes;
}

/** A deletion line to be written, and the position it is for. */
export interface NewDeletion {
  /** Where the row sat in the table before the operation: lines are kept in this order. */
  order: number;
  /** The marker, whole. */
  line: string;
}

/**
 * The changes that write new deletion lines among the table's: each before the first deletion that
 * the table's rows had after it, and so in order. `before` is where each deletion that is there
 * sat, in the numbering of the new lines' `order`.
 */
export function addDeletionLines(
  text: string,
  table: TableRead,
  before: readonly number[],
  added: readonly NewDeletion[],
  eol: string,
): TextChange[] {
  if (added.length === 0) return [];
  const existing = table.deletions.map((deletion) => deletionLine(text, deletion));
  const slots = new Map<number, string[]>();
  for (const one of added.toSorted((a, b) => a.order - b.order)) {
    let slot = before.findIndex((place) => place > one.order);
    if (slot === -1) slot = existing.length;
    slots.set(slot, [...(slots.get(slot) ?? []), one.line]);
  }
  const changes: TextChange[] = [];
  for (const [slot, lines] of slots) {
    const next = existing[slot];
    const last = existing[slot - 1];
    if (next) {
      changes.push({ from: next.from, to: next.from, insert: lines.map((l) => l + eol).join('') });
    } else if (last) {
      changes.push({ from: last.to, to: last.to, insert: lines.map((l) => eol + l).join('') });
    } else {
      const at = tableEnd(table);
      changes.push({ from: at, to: at, insert: eol + eol + lines.join(eol) });
    }
  }
  return changes;
}

/**
 * The changes that write `positions` into the deletions of `table` that are in `which`, of one axis.
 * A column's position counts from 1 and a row's from 0 (format §3.7); `positions` are indexes, from 0,
 * for both.
 */
export function setPositions(
  text: string,
  table: TableRead,
  positions: readonly number[],
  which?: ReadonlySet<number>,
  axis: 'row' | 'col' = 'row',
): TextChange[] {
  const changes: TextChange[] = [];
  const base = axis === 'col' ? 1 : 0;
  table.deletions.forEach((deletion, i) => {
    const position = positions[i];
    if (deletion.axis !== axis || position === undefined) return;
    if (position + base === deletion.position) return;
    if (which && !which.has(i)) return;
    const open = deletion.mark.segments[0]?.open;
    if (!open) return;
    const found = new RegExp(`${axis}=(\\d+)`).exec(text.slice(open.from, open.to));
    if (!found?.[1]) return;
    const from = open.from + found.index + 4;
    changes.push({ from, to: from + found[1].length, insert: String(position + base) });
  });
  return changes;
}

/** Where a deletion's position goes when the row at `index` leaves the table. */
export const afterRemoval = (position: number, index: number): number =>
  position > index ? position - 1 : position;

/**
 * Where a deletion's position goes when a row is written at `index`: those after it move down. A
 * deletion restored there (`line` its place among the deletions) goes before the ones at the same
 * place that come after it; a new row goes after all of them.
 */
export function afterWriting(
  position: number,
  index: number,
  line: number,
  restored = Infinity,
): number {
  return position > index || (position === index && line > restored) ? position + 1 : position;
}

/** The row that a deletion's payload says, with its text as written: `row=N text`. */
export function deletedRowText(payload: string | undefined): string {
  const found = /^row=\d+ ?/.exec(payload ?? '');
  return (payload ?? '').slice(found?.[0].length ?? 0);
}

/**
 * Changes sorted and apart, with the text written at the start of a change that takes text away
 * written in front of what it writes: the one that starts there would otherwise hide it.
 */
export function joinPoints(changes: readonly TextChange[]): TextChange[] {
  const result: TextChange[] = [];
  const sorted = changes.toSorted((a, b) => a.from - b.from || a.to - b.to);
  const points = sorted.filter((c) => c.from === c.to);
  const used = new Set<TextChange>();
  for (const change of sorted) {
    if (change.from === change.to) continue;
    const here = points.filter((p) => p.from === change.from);
    for (const p of here) used.add(p);
    result.push(
      here.length > 0
        ? { ...change, insert: here.map((p) => p.insert).join('') + change.insert }
        : change,
    );
  }
  for (const p of points) if (!used.has(p)) result.push(p);
  return result.toSorted((a, b) => a.from - b.from || a.to - b.to);
}
