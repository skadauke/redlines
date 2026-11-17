// Footprints (docs/research/collaboration.md, "Footprints"): the ranges an edit changes and the
// ranges its result depends on, in the text it was computed on. A stale push is rebased unless its
// footprint touches the footprint of an update logged since its base. Touching ends count.

import type { ChangeDesc, ChangeSet } from '@codemirror/state';
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
