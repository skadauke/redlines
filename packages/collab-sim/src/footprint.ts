// Footprints (collaboration.md, "Footprints"): what a pushed edit changes, and what its result
// depends on, as ranges of the text it was derived on. The ledger is kept apart so that the
// harness can say how often it alone makes two edits collide.

import { newestView, parse } from '@redlines/format';
import type { Range, TextChange } from '@redlines/format';

export interface Footprint {
  /** Ranges of the body: what the edit changes, whole marks it touches, and the nearest visible
   * character on each side of every marker position. */
  body: Range[];
  /** The ledger's change. Today's format writes the ledger as one change, so an edit that makes
   * or changes any entry declares the whole ledger. */
  ledger: Range[];
}

const touches = (a: Range, b: Range): boolean => a.from <= b.to && b.from <= a.to;

export function overlapAny(a: readonly Range[], b: readonly Range[]): boolean {
  return a.some((x) => b.some((y) => touches(x, y)));
}

function merge(ranges: Range[]): Range[] {
  const sorted = [...ranges].sort((a, b) => a.from - b.from || a.to - b.to);
  const out: Range[] = [];
  for (const range of sorted) {
    const last = out[out.length - 1];
    if (last && range.from <= last.to) last.to = Math.max(last.to, range.to);
    else out.push({ ...range });
  }
  return out;
}

/** The footprint of `changes`, which were derived on `text`. */
export function footprintOf(text: string, changes: readonly TextChange[]): Footprint {
  const parsed = parse(text);
  const ledgerAt = parsed.ledgerRange?.from;
  const body: Range[] = [];
  const ledger: Range[] = [];
  for (const change of changes) {
    const inLedger =
      change.insert.includes('<!-- redlines') ||
      (ledgerAt !== undefined && change.from >= ledgerAt);
    (inLedger ? ledger : body).push({ from: change.from, to: change.to });
  }
  if (body.length === 0) return { body, ledger: merge(ledger) };

  // Every mark with a marker in or touching a range, whole.
  const spans: Range[] = parsed.marks.map((mark) => {
    let from = Infinity;
    let to = 0;
    for (const segment of mark.segments) {
      from = Math.min(from, segment.open.from);
      to = Math.max(to, segment.close?.to ?? Math.max(segment.content.to, segment.open.to));
      if (segment.carrier) to = Math.max(to, segment.carrier.to);
    }
    return { from, to };
  });
  let ranges = merge(body);
  for (let round = 0; round < 3; round++) {
    const grown = merge([
      ...ranges,
      ...spans.filter((span) => ranges.some((range) => touches(range, span))),
    ]);
    const same = grown.length === ranges.length && grown.every((r, i) => r.to === ranges[i]?.to);
    ranges = grown;
    if (same) break;
  }

  // The nearest visible character on each side.
  const view = newestView(text);
  const wide = ranges.map((range) => {
    const left = Math.max(0, view.map.fromSource(range.from) - 1);
    const right = Math.min(view.text.length, view.map.fromSource(range.to) + 1);
    return {
      from: Math.min(range.from, view.map.toSource(left, 1)),
      to: Math.max(range.to, view.map.toSource(right, -1)),
    };
  });
  return { body: merge(wide), ledger: merge(ledger) };
}

/** A position after changes in front of it. A position inside a replaced range goes to its end
 * when `assoc` is 1 and to its start when it is -1. */
export function mapPos(pos: number, changes: readonly TextChange[], assoc: -1 | 1): number {
  let delta = 0;
  for (const change of changes) {
    if (change.to < pos) {
      delta += change.insert.length - (change.to - change.from);
      continue;
    }
    if (change.from > pos) break;
    // The change touches the position: an insertion at it, or a replaced range around it.
    if (change.from === change.to) {
      if (assoc > 0) delta += change.insert.length;
      break;
    }
    return change.from + delta + (assoc > 0 ? change.insert.length : 0);
  }
  return pos + delta;
}

export function mapRange(range: Range, changes: readonly TextChange[]): Range {
  const from = mapPos(range.from, changes, 1);
  const to = mapPos(range.to, changes, -1);
  return { from, to: Math.max(from, to) };
}

export function mapChanges(
  edits: readonly TextChange[],
  through: readonly TextChange[],
): TextChange[] {
  const out = edits.map((edit) => {
    const range = mapRange(edit, through);
    return { from: range.from, to: range.to, insert: edit.insert };
  });
  // Keep them in order and apart, as a list of changes must be.
  out.sort((a, b) => a.from - b.from || a.to - b.to);
  let end = 0;
  for (const change of out) {
    change.from = Math.max(change.from, end);
    change.to = Math.max(change.to, change.from);
    end = change.to;
  }
  return out;
}

export function mapFootprint(fp: Footprint, through: readonly TextChange[]): Footprint {
  return {
    body: fp.body.map((range) => mapRange(range, through)),
    ledger: fp.ledger.map((range) => mapRange(range, through)),
  };
}
