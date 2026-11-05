// The three views of a file (format §8). Each is the source with a list of changes applied: markers
// hidden, deleted text brought back, or markers turned into CriticMarkup. None is ever stored.
//
// The views know `ins`, `del`, `sub`, `split`, `cmt`, `hl` and `fmt`: the original view undoes a
// format change's operations, and the review view names them. The markers of table marks are
// hidden and their content is kept, so the newest and the original view show them the same. The
// original view leaves out the break a `split` stands for (format §3.4).

import { openerRange, splitEnd } from './blocks.ts';
import { applyChanges, eolOf, inEol } from './changes.ts';
import { EditError } from './errors.ts';
import { decidesFormat, parseFormatOps } from './format-ops.ts';
import { formatReader } from './format-reader.ts';
import type { FormatReader } from './format-reader.ts';
import { formatDecision, underscoreRewrites } from './format-undo.ts';
import { parse } from './parse.ts';
import type {
  DocView,
  Handle,
  MarkRange,
  Parsed,
  PositionMap,
  Range,
  Segment,
  TextChange,
  Time,
} from './types.ts';

/** Text changes that don't overlap: outer ones win over the ones inside them. */
function resolve<T extends TextChange>(changes: T[]): T[] {
  const sorted = changes.toSorted((a, b) => a.from - b.from || b.to - a.to);
  const kept: T[] = [];
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

/**
 * `changes` that decide `marks` of `text`, with `_` emphasis that they leave against a letter or a
 * digit written with `*`, as deciding format changes writes it (format §2.6). The view then reads
 * as the decision does, and has the same length.
 */
function withRewrites(
  text: string,
  parsed: Parsed,
  marks: readonly MarkRange[],
  changes: TextChange[],
  reader?: FormatReader,
): TextChange[] {
  const formats = marks.filter((mark) => mark.kind === 'fmt' && decidesFormat(mark));
  if (formats.length === 0 || !text.includes('_')) return changes;
  const segments = formats.flatMap((mark) => mark.segments);
  return [
    ...changes,
    ...underscoreRewrites(reader ?? formatReader(text, parsed), segments, resolve(changes)),
  ];
}

/** Every change accepted: no markers, no deleted text and no ledger. */
export function newestView(text: string): DocView {
  const parsed = parse(text);
  const changes = parsed.marks.flatMap((mark) => mark.segments.flatMap(hideMarkers));
  return viewOf(
    text,
    withRewrites(text, parsed, parsed.marks, [...changes, ...ledgerChanges(parsed)]),
  );
}

/** A change that makes the original view: `opener` is the marker, with its carrier, whose old
 * text it brings back, for a deletion or a substitution. */
export interface OriginalChange extends TextChange {
  opener?: Range;
}

/** The changes that make the original view of `text` (see `originalView`), sorted, outer ones
 * only. `parsed` is `parse(text)`, when the caller has it. */
export function originalChanges(
  text: string,
  parsed: Parsed = parse(text),
  /** False to keep the format changes and the ledger, which a second step undoes. */
  formats = true,
): OriginalChange[] {
  const changes: OriginalChange[] = [];
  const deletions = parsed.marks.flatMap((mark) => (mark.kind === 'del' ? mark.segments : []));
  // Restored text has the file's line breaks, as rejecting writes it.
  const eol = eolOf(text);
  const restored = (segment: Segment) => inEol(segment.payload ?? '', eol);
  for (const mark of parsed.marks) {
    if (!formats && mark.kind === 'fmt') continue;
    for (const segment of mark.segments) {
      if (mark.kind === 'ins' && segment.close) {
        // Everything inside an insertion goes with it, other people's marks included.
        changes.push(wholeSegment(segment, ''));
      } else if (mark.kind === 'sub') {
        changes.push({
          ...wholeSegment(segment, restored(segment)),
          opener: openerRange(segment),
        });
      } else if (mark.kind === 'del') {
        const opener = openerRange(segment);
        changes.push({ ...opener, insert: restored(segment), opener });
      } else if (mark.kind === 'split') {
        // The break after it, and the prefix of the block that follows, were inserted with it. So
        // was the deletion of the break that someone recorded after it.
        const to = splitEnd(text, segment.open, deletions, parsed.ledgerRange?.from);
        changes.push({ from: segment.open.from, to, insert: '' });
      } else changes.push(...hideMarkers(segment));
    }
  }
  return resolve(formats ? [...changes, ...ledgerChanges(parsed)] : changes);
}

/** Every change rejected: inserted text gone, deleted and replaced text back, and no ledger. A
 * format change's markers are hidden, and its operations are not undone: what typing with Track
 * Changes off checks itself against, as it types the same into both. */
export function originalViewOfText(text: string): DocView {
  const changes = originalChanges(text);
  return { text: applyChanges(text, changes), map: positionMap(changes) };
}

/**
 * Every change rejected: inserted text gone, deleted and replaced text back, format changes undone,
 * and no ledger. The format changes are undone after the rest, as rejecting all does, since a
 * deletion that comes back can hold the syntax a format change undoes (format §2.6). One that can't
 * be undone, as when its syntax is no longer there, keeps its text as it is.
 */
export function originalView(text: string): DocView {
  const parsed = parse(text);
  if (!parsed.marks.some((mark) => mark.kind === 'fmt')) return originalViewOfText(text);
  const first = originalChanges(text, parsed, false);
  const maps = [positionMap(first)];
  let current = applyChanges(text, first);
  // A format change inside another is undone first, as rejecting them one by one does: the outer
  // one's syntax stands around the inner one's. Those that hold no other go together.
  for (let round = 0; ; round++) {
    const read = parse(current);
    const formats = read.marks.filter((mark) => mark.kind === 'fmt');
    const last = formats.length === 0 || round > formats.length;
    const reader = formatReader(current, read);
    const inner = formats.filter(
      (mark) => !formats.some((other) => other !== mark && holds(mark, other)),
    );
    const undone = resolve([
      ...(last ? formats : inner).flatMap((mark) =>
        mark.segments.flatMap((segment) =>
          last ? hideMarkers(segment) : undoneFormat(reader, mark, segment),
        ),
      ),
      ...(last ? ledgerChanges(read) : []),
    ]);
    const changes = last ? undone : resolve(withRewrites(current, read, inner, undone, reader));
    maps.push(positionMap(changes));
    current = applyChanges(current, changes);
    if (last) break;
  }
  return {
    text: current,
    map: {
      toSource: (pos, assoc = 1) => maps.reduceRight((at, map) => map.toSource(at, assoc), pos),
      fromSource: (pos) => maps.reduce((at, map) => map.fromSource(at), pos),
    },
  };
}

/** Whether a segment of `outer` holds a segment of `inner`, markers and all. */
function holds(outer: MarkRange, inner: MarkRange): boolean {
  return outer.segments.some((o) =>
    inner.segments.some((i) => {
      const end = (o.close ?? openerRange(o)).to;
      return o.open.from <= i.open.from && (i.close ?? openerRange(i)).to <= end;
    }),
  );
}

/** The changes that undo one segment of a format change, or that hide its markers when it can't
 * be undone. */
function undoneFormat(reader: FormatReader, mark: MarkRange, segment: Segment): TextChange[] {
  if (!decidesFormat(mark)) return hideMarkers(segment);
  try {
    return formatDecision(reader, mark, segment, 'reject');
  } catch (error) {
    if (error instanceof EditError) return hideMarkers(segment);
    throw error;
  }
}

/** How a mark is written in CriticMarkup: what replaces its opener and its closer. */
function notation(
  mark: MarkRange,
  segment: Segment,
  entries: readonly { by: Handle; text: string }[],
): { open: string; close: string } {
  const tag = `[${mark.id} ${mark.entry.by}]`;
  const comment = entries.map((e) => `{>>[${mark.id} ${e.by}] ${e.text}<<}`).join('');
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
    case 'fmt': {
      // A format change is named by the operations that rejecting it undoes. A block's syntax
      // stays as it reads, so the name follows the block, and a box's mark stands for itself.
      const named = `{>>${noteOf(mark)}<<}`;
      if (!segment.close) return { open: named, close: '' };
      const ops = parseFormatOps(segment.payload ?? mark.payload ?? '');
      if (ops.some((op) => op.name === 'was')) return { open: '', close: named };
      return { open: '{==', close: `==}${named}` };
    }
    case 'cmt':
      return segment.close
        ? { open: '{==', close: `==}${lastSegment ? comment : ''}` }
        : { open: lastSegment ? comment : '', close: '' };
    default:
      return { open: '', close: '' };
  }
}

/** A format change's name in the review view: its id, its author and its operations. */
function noteOf(mark: MarkRange): string {
  const ops = mark.segments[0]?.payload ?? mark.payload ?? '';
  return `[${mark.id} ${mark.entry.by}] Formatted: ${ops}`;
}

/** The comment of a thread and then its replies, in order, as the review view shows them. Empty
 * when `id` is no thread. */
export function threadEntries(
  parsed: Parsed,
  id: string,
): { by: Handle; at: Time; text: string }[] {
  const thread = parsed.ledger.comments.find((candidate) => candidate.id === id);
  if (thread === undefined) return [];
  return [
    { by: thread.by, at: thread.at, text: thread.text },
    ...thread.replies.map(({ by, at, text }) => ({ by, at, text })),
  ];
}

/**
 * The newest text with every pending change in CriticMarkup, each followed by its id and author
 * in brackets, and a comment's text after the text it covers, then each reply to it, written as
 * a comment of its own with the thread's id and the author of the reply. This is what agents read.
 */
export function reviewView(text: string): string {
  const parsed = parse(text);
  const changes: TextChange[] = [];
  // A format change that accept and reject don't decide is no change to name, and nor is one
  // that has no text left, only its syntax (`****`, `[](url)`).
  const named = (mark: MarkRange, segment: Segment) =>
    mark.kind === 'fmt' && decidesFormat(mark) && !emptied(text, segment);
  // The highlights of format changes: a segment of text that one changes, not a block.
  const highlights = parsed.marks.flatMap((mark) =>
    mark.segments
      .filter((segment) => named(mark, segment) && segment.close && !changesBlock(mark, segment))
      .map((segment) => ({ mark, segment })),
  );
  const within = (inner: Segment, outer: Segment) =>
    inner !== outer &&
    outer.open.from <= inner.open.from &&
    (inner.close ?? openerRange(inner)).to <= (outer.close ?? outer.open).to;
  // A format change inside another's highlight is named in that one's note, after its text, as
  // CriticMarkup has no highlight inside another: each segment by the outermost highlight it is in.
  const heldBy = (mark: MarkRange, segment: Segment) => {
    const outer = highlights.filter((h) => h.mark !== mark && within(segment, h.segment));
    return outer.find(
      (h) => !outer.some((other) => other !== h && within(h.segment, other.segment)),
    );
  };
  const held = new Map<Segment, MarkRange[]>();
  for (const mark of parsed.marks) {
    for (const segment of mark.segments) {
      if (!named(mark, segment)) continue;
      const outer = heldBy(mark, segment);
      if (!outer) continue;
      const marks = held.get(outer.segment) ?? [];
      if (!marks.includes(mark) && mark !== outer.mark) marks.push(mark);
      held.set(outer.segment, marks);
    }
  }
  for (const mark of parsed.marks) {
    for (const segment of mark.segments) {
      let { open, close } = notation(mark, segment, threadEntries(parsed, mark.id));
      if (mark.kind === 'fmt' && (!named(mark, segment) || heldBy(mark, segment))) {
        open = close = '';
      }
      const inside = held.get(segment);
      if (inside) close = close.replace(/<<}$/, `; ${inside.map(noteOf).join('; ')}<<}`);
      changes.push({ ...openerRange(segment), insert: open });
      if (segment.close) changes.push({ ...segment.close, insert: close });
    }
  }
  return applyChanges(text, resolve([...changes, ...ledgerChanges(parsed)]));
}

/** Whether a segment of a format change changes a block's type, indent or box, not its text. */
function changesBlock(mark: MarkRange, segment: Segment): boolean {
  return parseFormatOps(segment.payload ?? mark.payload ?? '').some((op) => op.name === 'was');
}

/** Whether a segment holds syntax alone: delimiters and a link's brackets and URL, with no text
 * between them, and no change that could bring some back. */
function emptied(text: string, segment: Segment): boolean {
  if (!segment.close) return false;
  const content = text.slice(segment.open.to, segment.close.from);
  if (content.includes('<!--')) return false;
  return content.replace(/\]\([^)]*\)/g, '').replace(/[\s*_~[\]]/g, '') === '';
}
