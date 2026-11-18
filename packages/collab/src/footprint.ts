// Footprints (docs/research/collaboration.md, "Footprints"): the ranges an edit changes and the
// ranges its result depends on, in the text it was computed on. A stale push is rebased unless its
// footprint touches the footprint of an update logged since its base. Touching ends count.

import type { ChangeDesc, ChangeSet } from '@codemirror/state';
import { newestView, parse } from '@redlines/format';
import type { WireRange } from './protocol.ts';

export type Footprint = readonly WireRange[];

/** Whether any range of `a` touches any range of `b`. */
export function touches(a: Footprint, b: Footprint): boolean {
  for (const x of a) {
    for (const y of b) {
      if (x.from <= y.to && y.from <= x.to) return true;
    }
  }
  return false;
}

/** The ranges of `changes` in the text it applies to. An insertion is an empty range. */
export function changedRanges(changes: ChangeSet): WireRange[] {
  const ranges: WireRange[] = [];
  changes.iterChangedRanges((from, to) => {
    ranges.push({ from, to });
  });
  return ranges;
}

/**
 * Moves a footprint through a change, wider where text is inserted at its ends: a range that
 * grows must still touch whatever it touched.
 */
export function mapFootprint(footprint: Footprint, changes: ChangeDesc): WireRange[] {
  return footprint.map((range) => ({
    from: changes.mapPos(range.from, -1),
    to: changes.mapPos(range.to, 1),
  }));
}

/**
 * Reads a footprint a client sent. Returns null when it isn't a list of ranges inside a text of
 * `length` characters, with `from <= to`.
 */
export function readFootprint(value: unknown, length: number): WireRange[] | null {
  if (!Array.isArray(value)) return null;
  const out: WireRange[] = [];
  for (const item of value as unknown[]) {
    if (typeof item !== 'object' || item === null) return null;
    const { from, to } = item as Record<string, unknown>;
    if (typeof from !== 'number' || typeof to !== 'number') return null;
    if (!Number.isInteger(from) || !Number.isInteger(to)) return null;
    if (from < 0 || to > length || from > to) return null;
    out.push({ from, to });
  }
  return out;
}

const touchesRange = (a: WireRange, b: WireRange): boolean => a.from <= b.to && b.from <= a.to;

function merge(ranges: WireRange[]): WireRange[] {
  const sorted = [...ranges].sort((a, b) => a.from - b.from || a.to - b.to);
  const out: WireRange[] = [];
  for (const range of sorted) {
    const last = out[out.length - 1];
    if (last && range.from <= last.to) last.to = Math.max(last.to, range.to);
    else out.push({ ...range });
  }
  return out;
}

/**
 * What an edit made on `text` depends on, for a push (the simulation's `footprintOf`): the ranges
 * it changes, every mark it touches whole, the nearest visible character on each side, and the
 * whole ledger when it changes any entry. Parses `text` once.
 */
export function declareFootprint(text: string, changes: ChangeSet): WireRange[] {
  const parsed = parse(text);
  const ledger = parsed.ledgerRange;
  const body: WireRange[] = [];
  const whole: WireRange[] = [];
  changes.iterChangedRanges((from, to) => {
    if (ledger && to >= ledger.from) whole.push({ from: ledger.from, to: ledger.to });
    else body.push({ from, to });
  });
  if (body.length === 0) return merge(whole);

  const spans: WireRange[] = parsed.marks.map((mark) => {
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
      ...spans.filter((span) => ranges.some((range) => touchesRange(range, span))),
    ]);
    const same =
      grown.length === ranges.length &&
      grown.every((r, i) => r.from === ranges[i]?.from && r.to === ranges[i]?.to);
    ranges = grown;
    if (same) break;
  }
  const view = newestView(text);
  const wide = ranges.map((range) => {
    const left = Math.max(0, view.map.fromSource(range.from) - 1);
    const right = Math.min(view.text.length, view.map.fromSource(range.to) + 1);
    return {
      from: Math.min(range.from, view.map.toSource(left, 1)),
      to: Math.max(range.to, view.map.toSource(right, -1)),
    };
  });
  return merge([...wide, ...whole]);
}
