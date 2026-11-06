// Keeping the form of marks that start a block (format §3.3) right after a change. An opener that
// stands alone on the line before a block carries the line break, blank line and prefix that follow
// it (`Segment.carrier`). A change can leave an opener at the start of a block with text after it
// (typing in front of a paragraph, or deleting what stood in front of the opener), where a
// renderer would read the rest of the line as raw HTML: it gets that form. Or it can leave one in
// the middle of a line with the carrier of its old place after it, which would split the paragraph:
// the carrier goes.

import {
  HARD_BREAK,
  afterBullet,
  breakEnd,
  openerRange,
  carrierEnd,
  lineEnd,
  lineStart,
  lineStartKind,
  markerEnd,
  scaffold,
} from './blocks.ts';
import { EditError } from './errors.ts';
import { inspectPlace } from './inline.ts';
import { parse } from './parse.ts';
import { newestView, originalView } from './views.ts';
import type { DocView, MarkKind, MarkRange, Parsed, Range, Segment, TextChange } from './types.ts';

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

/** An opener that had no carrier and has one after the changes: where it is in the new text, where
 * its carrier ends there, and the kind of its mark. */
interface Phantom {
  kind: MarkKind;
  from: number;
  to: number;
  carrierTo: number;
  /** It had a carrier, which now reaches further. */
  grown?: boolean;
}

/**
 * The openers that had no carrier and are alone on their line before a block after the changes,
 * where the line break after them would be read as part of them (format §3.3): the break would go
 * from the views and from the decisions on the mark. `current` is `text` with the `body` changes.
 *
 * Also the openers of changes whose carrier reaches further than it did: the changes took away the
 * marker that stood on the line after the carrier, such as the closer of a block change whose text
 * is all deleted, and the carrier takes in the blank lines that came after it. The opener would
 * then start the next block, and rejecting the change would join its text to that block.
 */
function phantomCarriers(
  text: string,
  body: readonly TextChange[],
  current: string,
  before: Parsed,
): Phantom[] {
  const shown = current.slice(0, parse(current).ledgerRange?.from ?? current.length);
  const found: Phantom[] = [];
  for (const mark of before.marks) {
    for (const segment of mark.segments) {
      const { open, carrier } = segment;
      if (carrier) {
        // A carrier reaches further only where a change took away what came right after it.
        if (mark.kind === 'cmt' || mark.kind === 'hl') continue;
        if (!body.some((change) => change.from <= carrier.to && carrier.to < change.to)) continue;
      }
      const end = markerEnd(text, open.from);
      if (!canCarry(mark, segment) || touches(body, open.from, carrier?.to ?? end)) continue;
      const start = forward(body, open.from);
      if (start === null) continue;
      const to = start + end - open.from;
      if (current.slice(start, to) !== text.slice(open.from, end)) continue;
      const carrierTo = carrierEnd(shown, start, to);
      if (!carrier) {
        if (carrierTo > to) found.push({ kind: mark.kind, from: start, to, carrierTo });
        continue;
      }
      const was = forward(body, carrier.to);
      if (was !== null && carrierTo > was) {
        found.push({ kind: mark.kind, from: start, to, carrierTo, grown: true });
      }
    }
  }
  return found;
}

/** Whether the changes leave an opener that had no carrier alone on its line before a block. */
export function leavesPhantomCarrier(
  text: string,
  body: readonly TextChange[],
  current: string,
  before: Parsed,
): boolean {
  return phantomCarriers(text, body, current, before).length > 0;
}

/**
 * What a decision does about the openers that would get a carrier (it took away the marker that
 * stood after them on their line, such as the split in front of a break): the opener of a comment
 * or a highlight goes behind the break, which is the line break, the blank line and the prefix of
 * the next line (`breakEnd`). The marker itself is not touched, and no view changes. The opener of
 * any other mark can not, and the decision is refused: the line break would go from both views,
 * which a comparison of the words does not see.
 *
 * @throws EditError when the opener of another kind of mark would get a carrier.
 */
export function movedPhantoms(
  text: string,
  body: readonly TextChange[],
  current: string,
  before: Parsed,
): TextChange[] {
  const repairs: TextChange[] = [];
  for (const phantom of phantomCarriers(text, body, current, before)) {
    if (phantom.grown) {
      throw new EditError(
        "This can't be decided yet: a marker would then start the block after it, and rejecting its change would join the two. Decide the changes next to it first.",
        'no-legal-placement',
      );
    }
    if (phantom.kind !== 'cmt' && phantom.kind !== 'hl') {
      throw new EditError(
        "A change can't be made here: a marker would be left alone on its line, and the line break after it would be read as part of it.",
        'no-legal-placement',
      );
    }
    const end = breakEnd(current, phantom.to);
    if (end === phantom.to) continue;
    repairs.push(
      { from: phantom.from, to: phantom.from, insert: current.slice(phantom.to, end) },
      { from: phantom.to, to: end, insert: '' },
    );
  }
  return repairs;
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

/** A marker of the parsed text: its mark's kind, whether it closes the mark, and whether it can
 * stand last in front of a block's text with the line break, blank line and prefix after it as its
 * carrier (an opener, but not a split or the mark of a table). */
interface MarkerSpot extends Range {
  kind: MarkKind;
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
      const { kind } = mark;
      spots.push({ ...segment.open, kind, closes: false, carries: canCarry(mark, segment) });
      if (segment.close) spots.push({ ...segment.close, kind, closes: true, carries: false });
    }
  }
  return spots.sort((a, b) => a.from - b.from);
}

/**
 * Where the text of the last line with text before `position` ends, in front of the syntax of a
 * hard break, when `position` is the start of a line's content: the stretch from there to
 * `position` is the line break, the blank lines and the prefix of the line, which no marker is in.
 */
function previousTextEnd(text: string, position: number): number | undefined {
  let start = lineStart(text, position);
  while (start > 0) {
    const before = lineStart(text, start - 1);
    const end = lineEnd(text, before);
    const line = text.slice(before, end);
    if (!/^[ \t>]*$/.test(line)) return end - (HARD_BREAK.exec(line)?.[0].length ?? 0);
    start = before;
  }
  return undefined;
}

/**
 * Moves the closers `[from, to)` that start a line to the end of the line before, by moving the
 * line break, the blank lines and the prefix between them to the other side of the closers
 * (`Para A.⏎⏎<!--/c8d2-->End.` becomes `Para A.<!--/c8d2-->⏎⏎End.`): the mark ends by white space
 * earlier, and no view changes. Not possible when a marker stands in that stretch, or the end of
 * the line before takes none.
 */
function movedBack(
  current: string,
  hidden: readonly Range[],
  from: number,
  to: number,
): TextChange[] | undefined {
  const gapStart = previousTextEnd(current, from);
  if (gapStart === undefined) return undefined;
  if (hidden.some((range) => range.from < from && range.to > gapStart)) return undefined;
  if (inspectPlace(current, hidden, gapStart).kind !== 'ok') return undefined;
  return [
    { from: gapStart, to: from, insert: '' },
    { from: to, to, insert: current.slice(gapStart, from) },
  ];
}

/**
 * Whether a break written at `position` falls between blocks in both views: what stands before it
 * there, in the newest view and in the original view, ends in a blank line, or nothing is there.
 * A break written in the middle of a paragraph of either view would split it, and one written
 * after a bullet would leave the bullet alone on its line, which a view shows.
 */
function betweenBlocks(current: string, position: number): boolean {
  const between = (view: DocView) => {
    const before = view.text.slice(0, view.map.fromSource(position));
    return /^[\s>]*$/.test(before) || /\n[ \t>]*\n[ \t>]*$/.test(before);
  };
  return between(newestView(current)) && between(originalView(current));
}

/** The markers that stand one after the other from `at`, the first of a line. */
function markersFrom(spots: readonly MarkerSpot[], at: number): MarkerSpot[] {
  const chain: MarkerSpot[] = [];
  for (let spot = spots.find((s) => s.from === at); spot;) {
    chain.push(spot);
    const end: number = spot.to;
    spot = spots.find((s) => s.from === end);
  }
  return chain;
}

/**
 * The markers at the start of a block with text after them, which were not like that before: the
 * changes that give the openers among them the form of §3.3. Closers may stand in front of the
 * opener on its line (where one mark ends and the next starts a block); each opener of the line
 * that can carry gets the break that puts what follows it, the next marker or the text, on a line of
 * its own.
 *
 * A line that ends in closers, which no opener is left to keep off the text, is what a decision
 * leaves when it takes away the opener that did (`removing`); an edit that leaves one is refused
 * (`commitEdit`). The closers of comments and highlights, which change no view, go back to the end
 * of the line before; others get a line of their own. A split or a mark of a table can not be put
 * right.
 */
function scaffolds(
  current: string,
  parsed: Parsed,
  before: Parsed,
  eol: string,
  removing: boolean,
): TextChange[] {
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
    const kind = lineStartKind(current, range.from, hidden);
    if (kind !== 'block' && !(removing && kind === 'continuation')) continue;
    const chain = markersFrom(spots, range.from);
    const stop = chain.findIndex((spot) => !spot.closes && !spot.carries);
    const run = stop === -1 ? chain : chain.slice(0, stop);
    const last = run.at(-1);
    if (!last) continue;
    // Closers of comments and highlights alone: they end a mark by white space earlier.
    if (removing && run.every((s) => s.closes && (s.kind === 'cmt' || s.kind === 'hl'))) {
      const moved = movedBack(current, hidden, range.from, last.to);
      if (moved) {
        repairs.push(...moved);
        continue;
      }
    }
    if (kind !== 'block') continue;
    const prefix = current.slice(lineStart(current, range.from), range.from);
    const form = scaffold(prefix, eol, afterBullet(current, range.from, hidden));
    for (const spot of run) {
      if (spot.carries) repairs.push({ from: spot.to, to: spot.to, insert: form });
    }
    // Closers at the end of the line keep the text off no opener: they get a line of their own,
    // where that does not split a paragraph in either view.
    if (removing && stop === -1 && last.closes && betweenBlocks(current, last.to)) {
      repairs.push({ from: last.to, to: last.to, insert: form });
    }
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
  removing = false,
): TextChange[] {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const bodyEnd = parsed.ledgerRange ? parsed.ledgerRange.from : current.length;
  // Carriers that no longer belong go first: they move openers about, and the openers at the start
  // of a block are only known when none is left.
  const stale = staleCarriers(text, changes, current, before, bodyEnd);
  if (stale.length > 0) return stale.sort((a, b) => a.from - b.from);
  return scaffolds(current, parsed, before, eol, removing).sort((a, b) => a.from - b.from);
}
