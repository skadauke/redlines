// Where a comment or a highlight may stand in a table that has changes pending (#376, #396): its markers must
// not make another person's change impossible to decide. A marker in a stretch that a decision takes out, or
// beside a mark of the table that the decision reads, can leave the change refused as hiding it. The range is
// written as asked when every decision the table had stays possible; otherwise the nearest range whose ends
// stand elsewhere is written, and when none does, the range as asked (the edit is never refused for it).

import { applyChanges } from './changes.ts';
import { accept, reject } from './decide.ts';
import { parse } from './parse.ts';
import type { Range, TextChange } from './types.ts';
import { newestView } from './views.ts';

/** Whether a file has a change pending in a table: an inserted, deleted or moved row or column. */
export function hasTableChange(text: string): boolean {
  return /<!--(?:ins [a-z0-9]{4} (?:row|col)|del [a-z0-9]{4} (?:row|col)=)/.test(text);
}

/** The decisions of the changes of `text`, one at a time, that are refused, by what they decide. */
function refusals(text: string): Set<string> {
  const refused = new Set<string>();
  const parsed = parse(text);
  for (const mark of parsed.marks) {
    if (mark.kind === 'cmt' || mark.kind === 'hl') continue;
    for (const [how, decide] of [
      ['accept', accept],
      ['reject', reject],
    ] as const) {
      try {
        decide(text, mark.id);
      } catch {
        // Whatever stops a decision, a placement must not add to it.
        refused.add(`${how} ${mark.id}`);
      }
    }
  }
  return refused;
}

/** Whether every decision that was possible in `text` still is in the file `changes` make of it. */
export function decisionsHold(
  text: string,
  changes: readonly TextChange[],
  before: Set<string>,
): boolean {
  const now = refusals(applyChanges(text, changes));
  for (const key of now) if (!before.has(key)) return false;
  return true;
}

/** The decisions that `text` refuses itself. */
export function refusalsOf(text: string): Set<string> {
  return refusals(text);
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
