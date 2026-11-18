// Where a comment or a highlight may stand in a table that has changes pending (#376, #396): its markers must
// not make another person's change impossible to decide. A marker in a stretch that a decision takes out, or
// beside a mark of the table that the decision reads, can leave the change refused as hiding it. The range is
// written as asked when every decision the table had stays possible; otherwise the nearest range whose ends
// stand elsewhere is written, and when none does, the range as asked (the edit is never refused for it).

import { applyChanges } from './changes.ts';
import { accept, reject } from './decide.ts';
import { parse } from './parse.ts';
import { readTables } from './table.ts';
import type { Range, TextChange } from './types.ts';
import { newestView } from './views.ts';
import { readsOtherAsIs } from './widen.ts';

/** Whether a file has a change pending in a table: an inserted, deleted or moved row or column. */
export function hasTableChange(text: string): boolean {
  return /<!--(?:ins [a-z0-9]{4} (?:row|col)|del [a-z0-9]{4} (?:row|col)=)/.test(text);
}

/**
 * The ids of the changes that stand in the tables that `range` touches (the stretch from a table's first row
 * to the last of its deletion lines below it): the only decisions that a comment there can make impossible.
 * Empty when the range touches no table.
 */
export function marksOfTablesAt(text: string, range: Range): Set<string> {
  const parsed = parse(text);
  const ids = new Set<string>();
  for (const table of readTables(text, parsed)) {
    const last = table.deletions.reduce(
      (end, deletion) =>
        Math.max(end, ...deletion.mark.segments.map((seg) => seg.close?.to ?? seg.open.to)),
      table.to,
    );
    // A little before and after: a marker beside the table's edge is in it.
    if (range.to < table.from - 1 || range.from > last + 1) continue;
    // The rows that the range touches, (a marker at the edge of a row counts for the next): an inserted row's mark matters only there.
    const touched = table.rows.flatMap((row, i) =>
      row.from <= range.to + 1 && range.from <= row.to + 1 ? [i] : [],
    );
    const lo = touched[0] ?? Infinity;
    const hi = touched[touched.length - 1] ?? -Infinity;
    for (const mark of parsed.marks) {
      if (mark.kind === 'cmt' || mark.kind === 'hl') continue;
      const at = mark.segments[0]?.open.from ?? -1;
      // A change that holds the whole table (another person's replacement of it) is decided with it too.
      const holds = mark.segments.some(
        (seg) => seg.open.from <= table.from && (seg.close?.to ?? seg.open.to) >= table.to,
      );
      if (!holds && (at < table.from || at > last)) continue;
      if (mark.kind === 'ins' && mark.payload === 'row') {
        const row = table.rows.findIndex((r) => r.from <= at && at <= r.to);
        if (row < lo || row > hi) continue;
      }
      ids.add(mark.id);
    }
  }
  return ids;
}

/**
 * Whether an end of `range` stands against an emphasis delimiter (`*`, `_`, `~`), the markers between not counted:
 * a comment's or a highlight's marker there can cut the run of a bold or an italic that a decision of another
 * person's change leaves, and Markdown then reads the cell otherwise than its view (#490, #265).
 */
export function besideDelimiter(text: string, range: Range): boolean {
  const plain = (part: string) => part.replace(/<!--[^]*?-->/g, '');
  return [range.from, range.to].some((at) => {
    const before = plain(text.slice(Math.max(0, at - 200), at));
    const after = plain(text.slice(at, at + 200));
    return /[*_~\\]/.test(before.slice(-1)) || /[*_~\\]/.test(after.slice(0, 1));
  });
}

/**
 * The decisions of the changes `ids` of `text`, one at a time, that are refused, by what they decide. With `reads`,
 * also those after which the file reads otherwise than its newest view (micromark), and the file as it is.
 */
export function refusalsOf(text: string, ids: ReadonlySet<string>, reads = false): Set<string> {
  const refused = new Set<string>();
  if (reads && readsOtherAsIs(text)) refused.add('reads');
  for (const id of ids) {
    for (const [how, decide] of [
      ['accept', accept],
      ['reject', reject],
    ] as const) {
      try {
        const changes = decide(text, id);
        if (reads && readsOtherAsIs(applyChanges(text, changes))) {
          refused.add(`reads ${how} ${id}`);
        }
      } catch {
        // Whatever stops a decision, a placement must not add to it.
        refused.add(`${how} ${id}`);
      }
    }
  }
  return refused;
}

/** Whether every decision of `ids` that was possible in `text` still is in the file `changes` make of it. */
export function decisionsHold(
  text: string,
  changes: readonly TextChange[],
  before: Set<string>,
  ids: ReadonlySet<string>,
  reads = false,
): boolean {
  const now = refusalsOf(applyChanges(text, changes), ids, reads);
  for (const key of now) if (!before.has(key)) return false;
  return true;
}

/**
 * The ranges near `range` to try, nearest first: each end moved up to `reach` characters of the newest view
 * either way (as an editor has them), and taken back into the file.
 */
export function nearRanges(text: string, range: Range, limit: number, reach = 14): Range[] {
  const view = newestView(text);
  const start = view.map.fromSource(range.from);
  const end = view.map.fromSource(range.to);
  const shifts = [0];
  for (let k = 1; k <= reach; k++) shifts.push(-k, k);
  const pairs: { from: number; to: number; cost: number }[] = [];
  for (const df of shifts) {
    for (const dt of shifts) {
      if (df === 0 && dt === 0) continue;
      const from = start + df;
      const to = end + dt;
      if (from < 0 || to < from || to > view.text.length) continue;
      if (range.from === range.to && from !== to) continue;
      pairs.push({ from, to, cost: Math.abs(df) + Math.abs(dt) });
    }
  }
  pairs.sort((a, b) => a.cost - b.cost);
  const seen = new Set<string>();
  const found: Range[] = [];
  for (const pair of pairs) {
    const from = view.map.toSource(pair.from, 1);
    const to = Math.max(from, view.map.toSource(pair.to, -1));
    const key = `${from} ${to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({ from, to });
    if (found.length >= limit) break;
  }
  return found;
}
