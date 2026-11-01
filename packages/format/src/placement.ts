// Keeping the form of marks that start a block (format §3.3) right after a change. An opener that
// stands alone on the line before a block carries the line break, blank line and prefix that follow
// it (`Segment.carrier`). A change can leave an opener at the start of a block with text after it
// (typing in front of a paragraph, or deleting what stood in front of the opener), where a
// renderer would read the rest of the line as raw HTML: it gets that form. Or it can leave one in
// the middle of a line with the carrier of its old place after it, which would split the paragraph:
// the carrier goes.

import {
  afterBullet,
  openerRange,
  carrierEnd,
  lineStart,
  lineStartKind,
  markerEnd,
  scaffold,
} from './blocks.ts';
import { parse } from './parse.ts';
import type { MarkRange, Parsed, Range, Segment, TextChange } from './types.ts';

/** Where a position of the text went in the changed text, or null when a change took it away or
 * it lies inside text that a change replaced. Text inserted at the position goes in front of it. */
export function forward(changes: readonly TextChange[], position: number): number | null {
  let delta = 0;
  for (const change of changes) {
    if (change.to <= position) delta += change.insert.length - (change.to - change.from);
    else if (change.from < position) return null;
    else break;
  }
  return position + delta;
}

/** Whether a change touches the text between `from` and `to`, or the place between its characters. */
function touches(changes: readonly TextChange[], from: number, to: number): boolean {
  return changes.some((change) => change.from < to && change.to > from);
}

/**
 * The openers that had a carrier in `before` and, after the changes, stand where it no longer
 * belongs: the carrier is still there in the new text, and the opener has text in front of it on its
 * line. The changes that remove those carriers, in offsets of `current`.
 */
function staleCarriers(
  text: string,
  changes: readonly TextChange[],
  current: string,
  before: Parsed,
  bodyEnd: number,
): TextChange[] {
  const repairs: TextChange[] = [];
  for (const mark of before.marks) {
    for (const segment of mark.segments) {
      const { open } = segment;
      if (!segment.carrier) continue;
      const end = open.to;
      if (touches(changes, open.from, segment.carrier.to)) continue;
      const start = forward(changes, open.from);
      if (start === null) continue;
      const markerLength = end - open.from;
      if (current.slice(start, start + markerLength) !== text.slice(open.from, end)) continue;
      const carrier = text.slice(end, segment.carrier.to);
      const newEnd = start + markerLength;
      if (!current.startsWith(carrier, newEnd)) continue;
      // Still the carrier of the opener in its new place, or more of it than before.
      if (carrierEnd(current.slice(0, bodyEnd), start, newEnd) >= newEnd + carrier.length) continue;
      repairs.push({ from: newEnd, to: newEnd + carrier.length, insert: '' });
    }
  }
  return repairs;
}

/**
 * Whether the changes leave an opener that had no carrier alone on its line before a block, where
 * the line break after it would be read as part of it (format §3.3): the break would go from the
 * views and from the decisions on the mark. `current` is `text` with the `body` changes.
 */
export function leavesPhantomCarrier(
  text: string,
  body: readonly TextChange[],
  current: string,
  before: Parsed,
): boolean {
  const bodyEnd = parse(current).ledgerRange?.from ?? current.length;
  for (const mark of before.marks) {
    for (const segment of mark.segments) {
      const { open, carrier } = segment;
      const end = markerEnd(text, open.from);
      if (carrier || !canCarry(mark, segment) || touches(body, open.from, end)) continue;
      const start = forward(body, open.from);
      if (start === null) continue;
      if (current.slice(start, start + end - open.from) !== text.slice(open.from, end)) continue;
      if (
        carrierEnd(current.slice(0, bodyEnd), start, start + end - open.from) >
        start + end - open.from
      ) {
        return true;
      }
    }
  }
  return false;
}

/** The ranges of the markers of the parsed text, with their carriers. */
function hiddenRanges(parsed: Parsed): Range[] {
  const ranges: Range[] = [];
  for (const mark of parsed.marks) {
    for (const segment of mark.segments) {
      ranges.push(openerRange(segment));
      if (segment.close) ranges.push(segment.close);
    }
  }
  return ranges.sort((a, b) => a.from - b.from);
}

/** A marker of the parsed text: whether it closes a mark, and whether it can stand last in front of
 * a block's text with the line break, blank line and prefix after it as its carrier (an opener, but
 * not a split or the mark of a table). */
interface MarkerSpot extends Range {
  closes: boolean;
  carries: boolean;
}

/** Whether the opener of the segment can have a carrier: not a split, whose break follows it, and
 * not a mark of a table. */
function canCarry(mark: MarkRange, segment: Segment): boolean {
  if (mark.kind === 'split') return false;
  if (mark.kind === 'ins') return mark.payload !== 'row' && mark.payload !== 'col';
  return !(mark.kind === 'del' && /^(?:row|col)=/.test(segment.payload ?? ''));
}

function markerSpots(parsed: Parsed): MarkerSpot[] {
  const spots: MarkerSpot[] = [];
  for (const mark of parsed.marks) {
    for (const segment of mark.segments) {
      spots.push({ ...segment.open, closes: false, carries: canCarry(mark, segment) });
      if (segment.close) spots.push({ ...segment.close, closes: true, carries: false });
    }
  }
  return spots.sort((a, b) => a.from - b.from);
}

/**
 * The markers at the start of a block with text after them, which were not like that before: the
 * changes that give the opener among them the form of §3.3. Closers may stand in front of the
 * opener on its line (where one mark ends and the next starts a block); the openers after it come
 * to the line of their own, a step at a time, as each repair puts the next one at the start of a
 * line. A line of markers that holds no opener that can carry, because a closer or a split is the
 * last of them, can not be put right: the text after it is read as raw HTML, and the edit that
 * made it is refused (`commitEdit`).
 */
function scaffolds(current: string, parsed: Parsed, before: Parsed, eol: string): TextChange[] {
  const warned = new Set(
    before.warnings.flatMap((warning) =>
      warning.code === 'line-start-marker' ? (warning.id ?? []) : [],
    ),
  );
  const hidden = hiddenRanges(parsed);
  const spots = markerSpots(parsed);
  const repairs: TextChange[] = [];
  for (const warning of parsed.warnings) {
    const { range } = warning;
    if (warning.code !== 'line-start-marker' || !range || warning.id === undefined) continue;
    if (warned.has(warning.id) || current.startsWith('<!--split', range.from)) continue;
    if (lineStartKind(current, range.from, hidden) !== 'block') continue;
    // The first opener of the line that can carry, after any closers.
    let spot = spots.find((candidate) => candidate.from === range.from);
    while (spot && !spot.carries && spot.closes) {
      const end = spot.to;
      spot = spots.find((candidate) => candidate.from === end);
    }
    if (!spot?.carries) continue;
    const prefix = current.slice(lineStart(current, range.from), range.from);
    const tight = afterBullet(current, range.from, hidden);
    repairs.push({ from: spot.to, to: spot.to, insert: scaffold(prefix, eol, tight) });
  }
  return repairs;
}

/**
 * What a body of changes leaves to put right: the changes that give the openers at the start of a
 * block their own line, and take the carrier from an opener that is no longer at the start of one.
 * `current` is `text` with `changes` applied, and `parsed` is what is read in it with the ledger
 * the edit will write, which knows the comments it adds. The result is in the offsets of `current`.
 */
export function placementRepairs(
  text: string,
  changes: readonly TextChange[],
  current: string,
  before: Parsed,
  parsed: Parsed,
): TextChange[] {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const bodyEnd = parsed.ledgerRange ? parsed.ledgerRange.from : current.length;
  // Carriers that no longer belong go first: they move openers about, and the openers at the start
  // of a block are only known when none is left.
  const stale = staleCarriers(text, changes, current, before, bodyEnd);
  if (stale.length > 0) return stale.sort((a, b) => a.from - b.from);
  return scaffolds(current, parsed, before, eol).sort((a, b) => a.from - b.from);
}
