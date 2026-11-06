// The markers of a file and its ledger, as stretches that are not text.

import { openerRange } from './blocks.ts';
import type { MarkRange, Parsed, Segment } from './types.ts';

/** A stretch of the file that is not text: one marker, or the ledger with the blank line before it. */
export interface MarkerRange {
  from: number;
  to: number;
  /** The mark a marker belongs to. Absent for the ledger. */
  mark?: MarkRange;
  segment?: Segment;
  role: 'open' | 'close' | 'ledger';
}

/** Every marker of the parsed marks, and the ledger, in the order they appear. */
export function markerRanges(parsed: Parsed): MarkerRange[] {
  const ranges: MarkerRange[] = [];
  for (const mark of parsed.marks) {
    for (const segment of mark.segments) {
      ranges.push({ ...openerRange(segment), mark, segment, role: 'open' });
      if (segment.close) ranges.push({ ...segment.close, mark, segment, role: 'close' });
    }
  }
  if (parsed.ledgerRange) ranges.push({ ...parsed.ledgerRange, role: 'ledger' });
  return ranges.sort((a, b) => a.from - b.from || a.to - b.to);
}
