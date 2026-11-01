// The three views of a file (format §8). Each is the source with a list of changes applied: markers
// hidden, deleted text brought back, or markers turned into CriticMarkup. None is ever stored.
//
// In this version a view treats `ins`, `del`, `sub`, `split`, `cmt` and `hl` as marks it knows. The
// markers of `fmt` and the table marks are hidden and their content is kept, so the newest and
// the original view show them the same. The original view leaves out the break a `split` stands
// for (format §3.4).

import { openerRange, splitEnd } from './blocks.ts';
import { applyChanges } from './changes.ts';
import { parse } from './parse.ts';
import type { DocView, MarkRange, Parsed, PositionMap, Segment, TextChange } from './types.ts';

/** Text changes that don't overlap: outer ones win over the ones inside them. */
function resolve(changes: TextChange[]): TextChange[] {
  const sorted = changes.toSorted((a, b) => a.from - b.from || b.to - a.to);
  const kept: TextChange[] = [];
  let end = 0;
  for (const change of sorted) {
    if (change.from < end) continue;
    kept.push(change);
    end = change.to;
  }
  return kept;
}

/** The change that replaces the whole of a segment, markers and content. */
function wholeSegment(segment: Segment, insert: string): TextChange {
  return { from: segment.open.from, to: (segment.close ?? openerRange(segment)).to, insert };
}

/** The ledger and its blank line, as a change. */
function ledgerChanges(parsed: Parsed): TextChange[] {
  const range = parsed.ledgerRange;
  return range ? [{ from: range.from, to: range.to, insert: '' }] : [];
}

/** Changes that hide every marker of a segment and keep what lies between them. */
function hideMarkers(segment: Segment): TextChange[] {
  const changes = [{ ...openerRange(segment), insert: '' }];
  if (segment.close) changes.push({ ...segment.close, insert: '' });
  return changes;
}

/**
 * Maps between a view and its source. Changes that touch each other act as one stretch, so a
 * position beside several hidden markers sits before all of them or after all of them.
 */
function positionMap(changes: readonly TextChange[]): PositionMap {
  interface Stretch {
    /** The stretch in the source. */
    from: number;
    to: number;
    /** What it became in the view. */
    viewFrom: number;
    viewTo: number;
  }
  const stretches: Stretch[] = [];
  let delta = 0;
  for (const change of changes) {
    const viewFrom = change.from + delta;
    delta += change.insert.length - (change.to - change.from);
    const viewTo = change.to + delta;
    const last = stretches.at(-1);
    if (last && last.to === change.from) {
      last.to = change.to;
      last.viewTo = viewTo;
    } else stretches.push({ from: change.from, to: change.to, viewFrom, viewTo });
  }
  return {
    toSource(pos, assoc = 1) {
      let shift = 0;
      for (const stretch of stretches) {
        if (pos < stretch.viewFrom) break;
        if (pos <= stretch.viewTo) return assoc < 0 ? stretch.from : stretch.to;
        shift = stretch.viewTo - stretch.to;
      }
      return pos - shift;
    },
    fromSource(pos) {
      let shift = 0;
      for (const stretch of stretches) {
        if (pos < stretch.from) break;
        if (pos <= stretch.to) return pos === stretch.to ? stretch.viewTo : stretch.viewFrom;
        shift = stretch.viewTo - stretch.to;
      }
      return pos + shift;
    },
  };
}

function viewOf(text: string, changes: TextChange[]): DocView {
  const resolved = resolve(changes);
  return { text: applyChanges(text, resolved), map: positionMap(resolved) };
}

/** Every change accepted: no markers, no deleted text and no ledger. */
export function newestView(text: string): DocView {
  const parsed = parse(text);
  const changes = parsed.marks.flatMap((mark) => mark.segments.flatMap(hideMarkers));
  return viewOf(text, [...changes, ...ledgerChanges(parsed)]);
}

/** Every change rejected: inserted text gone, deleted and replaced text back, and no ledger. */
export function originalView(text: string): DocView {
  const parsed = parse(text);
  const changes: TextChange[] = [];
  const deletions = parsed.marks.flatMap((mark) => (mark.kind === 'del' ? mark.segments : []));
  for (const mark of parsed.marks) {
    for (const segment of mark.segments) {
      if (mark.kind === 'ins' && segment.close) {
        // Everything inside an insertion goes with it, other people's marks included.
        changes.push(wholeSegment(segment, ''));
      } else if (mark.kind === 'sub') {
        changes.push(wholeSegment(segment, segment.payload ?? ''));
      } else if (mark.kind === 'del') {
        changes.push({ ...openerRange(segment), insert: segment.payload ?? '' });
      } else if (mark.kind === 'split') {
        // The break after it, and the prefix of the block that follows, were inserted with it. So
        // was the deletion of the break that someone recorded after it.
        const to = splitEnd(text, segment.open, deletions, parsed.ledgerRange?.from);
        changes.push({ from: segment.open.from, to, insert: '' });
      } else changes.push(...hideMarkers(segment));
    }
  }
  return viewOf(text, [...changes, ...ledgerChanges(parsed)]);
}

/** How a mark is written in CriticMarkup: what replaces its opener and its closer. */
function notation(
  mark: MarkRange,
  segment: Segment,
  note: string | undefined,
): { open: string; close: string } {
  const tag = `[${mark.id} ${mark.entry.by}]`;
  const comment = note === undefined ? '' : `{>>[${mark.id} ${mark.entry.by}] ${note}<<}`;
  const lastSegment = mark.segments.at(-1) === segment;
  switch (mark.kind) {
    case 'ins':
      return segment.close ? { open: '{++', close: `++}${tag}` } : { open: '', close: '' };
    case 'sub':
      return { open: `{~~${segment.payload ?? ''}~>`, close: `~~}${tag}` };
    case 'del':
      return { open: `{--${segment.payload ?? ''}--}${tag}`, close: '' };
    case 'hl':
      return { open: '{==', close: `==}${tag}` };
    case 'cmt':
      return segment.close
        ? { open: '{==', close: `==}${lastSegment ? comment : ''}` }
        : { open: lastSegment ? comment : '', close: '' };
    default:
      return { open: '', close: '' };
  }
}

/**
 * The newest text with every pending change in CriticMarkup, each followed by its id and author
 * in brackets, and a comment's text after the text it covers. This is what agents read.
 */
export function reviewView(text: string): string {
  const parsed = parse(text);
  const threads = new Map(parsed.ledger.comments.map((thread) => [thread.id, thread.text]));
  const changes: TextChange[] = [];
  for (const mark of parsed.marks) {
    for (const segment of mark.segments) {
      const { open, close } = notation(mark, segment, threads.get(mark.id));
      changes.push({ ...openerRange(segment), insert: open });
      if (segment.close) changes.push({ ...segment.close, insert: close });
    }
  }
  return applyChanges(text, resolve([...changes, ...ledgerChanges(parsed)]));
}
