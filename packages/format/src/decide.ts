// Accepting and rejecting changes (format §2.2, §2.6, §3.6, §4). A decision is a list of text
// changes: the markers go, rejecting a deletion or a substitution puts the old text back, and
// rejecting a format change undoes its operations. The ledger loses the entry of every mark that is
// gone. This decides insertions, deletions, substitutions, splits, highlights and inline format
// changes; block format changes, table marks and moves are kept as they are.

import { openerRange, splitEnd } from './blocks.ts';
import { applyChanges } from './changes.ts';
import {
  commitEdit,
  eolOf,
  inEol,
  markerRanges,
  spliceRepairs,
  workingLedger,
} from './edit-support.ts';
import type { Eol } from './edit-support.ts';
import { EditError } from './errors.ts';
import { formatReader } from './format-reader.ts';
import type { FormatReader } from './format-reader.ts';
import {
  decidesFormat,
  formatDecision,
  rejectionWorks,
  underscoreRewrites,
} from './format-undo.ts';
import { parse } from './parse.ts';
import type { MarkRange, Parsed, Range, Segment, TextChange } from './types.ts';

type Action = 'accept' | 'reject';

const NOT_SUPPORTED = 'not supported in v0.1';

const UNFINISHED =
  "The comments and highlights on this text can't be worked out, so nothing is changed.";

/** A deletion whose payload starts with `row=` or `col=` belongs to a table (format §3.7). */
const TABLE_DELETION = /^(?:row|col)=/;

function isTableMark(mark: MarkRange): boolean {
  return (
    (mark.kind === 'ins' && (mark.payload === 'row' || mark.payload === 'col')) ||
    (mark.kind === 'del' && TABLE_DELETION.test(mark.payload ?? ''))
  );
}

/**
 * Whether a person can be offered to reject the mark: false only for a format change whose text no
 * longer has the formatting it undoes, with no change in it that could bring it back, which can
 * only be accepted (`****` once the text in it is gone). Other refusals say what to decide first.
 */
export function canReject(parsed: Parsed, mark: MarkRange): boolean {
  if (mark.kind !== 'fmt') return true;
  const { text } = parsed;
  if (mark.segments.some((s) => s.close && text.slice(s.open.to, s.close.from).includes('<!--'))) {
    return true;
  }
  return rejectionWorks(formatReader(text, parsed), mark);
}

/** Whether accept and reject decide the mark: not a table mark or a half of a move, nor a format
 * change with operations they can't undo. Comments are resolved instead. */
export function isDecidable(mark: MarkRange): boolean {
  if (mark.entry.move !== undefined || isTableMark(mark)) return false;
  if (mark.kind === 'fmt') return decidesFormat(mark);
  return (
    mark.kind === 'ins' ||
    mark.kind === 'del' ||
    mark.kind === 'sub' ||
    mark.kind === 'split' ||
    mark.kind === 'hl'
  );
}

/** Whether accept all and reject all decide the mark: a tracked change, not an annotation. */
function isChange(mark: MarkRange): boolean {
  return mark.kind !== 'hl' && isDecidable(mark);
}

function markToDecide(parsed: Parsed, id: string): MarkRange {
  const mark = parsed.marks.find((candidate) => candidate.id === id);
  if (!mark) throw new EditError(`There is no change with the id ${id}.`, 'unknown-id');
  if (mark.kind === 'cmt') {
    throw new EditError(
      'A comment is resolved or deleted, not accepted or rejected.',
      'not-supported',
    );
  }
  if (!isDecidable(mark)) throw new EditError(NOT_SUPPORTED, 'not-supported');
  return mark;
}

/** The changes that decide one mark: all its segments. Marks inside a rejected insertion or
 * substitution go with it. Rejecting a split takes the break it stands for away. */
function decisionChanges(
  text: string,
  limit: number | undefined,
  deletions: readonly Segment[],
  mark: MarkRange,
  action: Action,
  eol: Eol,
  reader: FormatReader | undefined,
): TextChange[] {
  const changes: TextChange[] = [];
  const remove = (range: Range) => changes.push({ from: range.from, to: range.to, insert: '' });
  for (const segment of mark.segments) {
    if (mark.kind === 'fmt' && reader) {
      changes.push(...formatDecision(reader, mark, segment, action));
      continue;
    }
    // The opener goes with its carrier, if it has one.
    const open = openerRange(segment);
    const { close, payload } = segment;
    const whole = { from: open.from, to: (close ?? open).to };
    const restored = inEol(payload ?? '', eol);
    if (mark.kind === 'split') {
      // Rejecting it takes the break with it, or the deletion of the break that someone recorded.
      const to = action === 'accept' ? open.to : splitEnd(text, segment.open, deletions, limit);
      changes.push({ from: open.from, to, insert: '' });
    } else if (mark.kind === 'del') {
      changes.push({ from: open.from, to: open.to, insert: action === 'accept' ? '' : restored });
    } else if (action === 'reject' && mark.kind === 'ins') {
      changes.push({ ...whole, insert: '' });
    } else if (action === 'reject' && mark.kind === 'sub') {
      changes.push({ ...whole, insert: restored });
    } else {
      // Accepting keeps the text and drops the markers; a highlight is dismissed either way.
      remove(open);
      if (close) remove(close);
    }
  }
  return changes;
}

/** Changes that do not overlap: where one lies inside another, the outer one wins. Text written
 * right in front of a change is not inside it. */
function outermost(changes: readonly TextChange[]): TextChange[] {
  const kept: TextChange[] = [];
  let start = -1;
  let end = -1;
  for (const change of changes.toSorted((a, b) => a.from - b.from || b.to - a.to)) {
    const inFront = change.from === change.to && change.from === start;
    if (change.from < end && !inFront) continue;
    kept.push(change);
    if (inFront) continue;
    start = change.from;
    end = change.to;
  }
  return kept.toSorted((a, b) => a.from - b.from || a.to - b.to);
}

/** A comment or a highlight: an annotation that a decision about the text under it leaves. */
function isAnnotation(mark: MarkRange): boolean {
  return mark.kind === 'cmt' || mark.kind === 'hl';
}

/**
 * Splits the changes around the markers of comments and highlights, which stay where they are,
 * unless the highlight is the one being decided. Text that goes takes the markers of other kinds
 * with it, but the thread of a comment on it stays (format §4), and a comment or highlight that
 * started or ended in it keeps its other end.
 */
function keepAnnotations(
  changes: readonly TextChange[],
  parsed: Parsed,
  decided: ReadonlySet<string>,
): TextChange[] {
  const anchors = markerRanges(parsed).filter(
    (marker) => marker.mark && isAnnotation(marker.mark) && !decided.has(marker.mark.id),
  );
  const result: TextChange[] = [];
  for (const change of changes) {
    let cursor = change.from;
    let insert = change.insert;
    for (const anchor of anchors) {
      if (anchor.from < change.from || anchor.to > change.to) continue;
      // The text that comes back goes in front of the markers that stay.
      if (anchor.from > cursor || insert !== '') {
        result.push({ from: cursor, to: anchor.from, insert });
        insert = '';
      }
      cursor = anchor.to;
    }
    if (cursor < change.to || insert !== '') result.push({ from: cursor, to: change.to, insert });
  }
  return result;
}

/** Whether the changes remove all of `range`, which holds something, and put nothing in it. */
function isEmptied(changes: readonly TextChange[], range: Range): boolean {
  if (range.to <= range.from) return false;
  let position = range.from;
  for (const change of changes) {
    if (change.insert !== '' && change.from <= range.to && change.to >= range.from) return false;
    if (change.to <= position) continue;
    if (change.from > position) break;
    position = change.to;
  }
  return position >= range.to;
}

function isRemoved(changes: readonly TextChange[], range: Range): boolean {
  return changes.some((c) => c.insert === '' && c.from <= range.from && range.to <= c.to);
}

/** The markers of comments and highlights whose text a decision removed, which are removed too. */
function emptiedAnnotations(changes: readonly TextChange[], parsed: Parsed): TextChange[] {
  const extra: TextChange[] = [];
  const remove = (range: Range) => extra.push({ from: range.from, to: range.to, insert: '' });
  for (const mark of parsed.marks) {
    if (!isAnnotation(mark)) continue;
    const live: Segment[] = [];
    const emptied: Segment[] = [];
    for (const segment of mark.segments) {
      if (isRemoved(changes, openerRange(segment))) continue;
      const isPoint = !segment.close || isRemoved(changes, segment.close);
      // What the segment covers starts after the carrier of its opener, which is no text.
      const covered = { from: segment.carrier?.to ?? segment.content.from, to: segment.content.to };
      if (!isPoint && isEmptied(changes, covered)) emptied.push(segment);
      else live.push(segment);
    }
    // A thread stays: when no part of a comment covers anything, it becomes a point comment at
    // the first of them (format §4). A highlight has no point form and goes.
    const [point] = live.length === 0 && mark.kind === 'cmt' ? emptied : [];
    for (const segment of emptied) {
      if (segment === point && segment.close) remove(segment.close);
      else {
        remove(openerRange(segment));
        if (segment.close) remove(segment.close);
      }
    }
  }
  return extra;
}

/** The changes that decide `marks`, with the ledger that goes with them. */
function decide(
  text: string,
  parsed: Parsed,
  marks: readonly MarkRange[],
  action: Action,
): TextChange[] {
  if (marks.length === 0) return [];
  const eol = eolOf(text);
  const limit = parsed.ledgerRange?.from;
  const deletions = parsed.marks.flatMap((mark) => (mark.kind === 'del' ? mark.segments : []));
  const formats = marks.filter((mark) => mark.kind === 'fmt');
  const reader = formats.length > 0 ? formatReader(text, parsed) : undefined;
  const raw = marks.flatMap((mark) =>
    decisionChanges(text, limit, deletions, mark, action, eol, reader),
  );
  let changes = keepAnnotations(outermost(raw), parsed, new Set(marks.map((mark) => mark.id)));
  // Removing an annotation can empty another that held it, so go on until nothing is left to do.
  // Every round removes markers that were not removed before, so the markers are the most rounds.
  const markers = parsed.marks.reduce((sum, mark) => sum + 2 * mark.segments.length, 0);
  for (let round = 0; ; round++) {
    const extra = emptiedAnnotations(changes, parsed);
    if (extra.length === 0) break;
    if (round > markers) throw new EditError(UNFINISHED, 'no-legal-placement');
    changes = [...changes, ...extra].sort((a, b) => a.from - b.from || a.to - b.to);
  }
  if (reader) {
    const segments = formats.flatMap((mark) => mark.segments);
    changes = [...changes, ...underscoreRewrites(reader, segments, changes)];
    changes.sort((a, b) => a.from - b.from || a.to - b.to);
  }
  const ledger = workingLedger(parsed.ledger);
  for (const mark of marks) delete ledger.marks[mark.id];
  // A highlight is no change: neither view is different once it is dismissed.
  const keeps = marks.every(isAnnotation) ? 'both' : action === 'accept' ? 'newest' : 'original';
  return commitEdit(text, changes, ledger, { parsed, removes: true, keeps });
}

/**
 * Accepts a change: the markers go and the new text stays, so a deleted text is gone for good. An
 * insertion that holds other people's changes leaves them pending. A highlight is dismissed.
 *
 * @throws EditError when there is no such change, when it is a comment, when its kind is not decided
 *   yet (`not supported in v0.1`), or when the ledger can't be read.
 */
export function accept(text: string, id: string): TextChange[] {
  const parsed = parse(text);
  return decide(text, parsed, [markToDecide(parsed, id)], 'accept');
}

/**
 * Rejects a change: an insertion goes with everything inside it, a deletion's text comes back as
 * plain text, a substitution gives the old text back and a format change undoes its operations. A
 * comment on text that goes becomes a point comment where the text was.
 *
 * @throws EditError as `accept` does, and when the text of a format change no longer has the
 *   formatting that rejecting takes away (`no-legal-placement`).
 */
export function reject(text: string, id: string): TextChange[] {
  const parsed = parse(text);
  return decide(text, parsed, [markToDecide(parsed, id)], 'reject');
}

function selected(parsed: Parsed, filter?: (mark: MarkRange) => boolean): MarkRange[] {
  return parsed.marks.filter((mark) => isChange(mark) && (!filter || filter(mark)));
}

/**
 * Rejects `marks` in one list of changes: format changes after the others, because rejecting a
 * deletion can bring back the syntax that a format change undoes. A format change that can't be
 * rejected, as when the changes inside it are not among `marks`, stays pending, and does not stop
 * the others.
 */
function rejectTogether(text: string, parsed: Parsed, marks: readonly MarkRange[]): TextChange[] {
  const isFormat = (mark: MarkRange) => mark.kind === 'fmt';
  const formats = new Set(marks.filter(isFormat).map((mark) => mark.id));
  if (formats.size === 0) return decide(text, parsed, marks, 'reject');
  const others = marks.filter((mark) => !isFormat(mark));
  let changes = decide(text, parsed, others, 'reject');
  let current = applyChanges(text, changes);
  let read = parse(current);
  const reader = formatReader(current, read);
  const left = read.marks.filter((mark) => formats.has(mark.id) && rejectionWorks(reader, mark));
  try {
    return spliceRepairs(text, changes, current, decide(current, read, left, 'reject'));
  } catch (error) {
    if (!(error instanceof EditError)) throw error;
  }
  // One of them has no form to leave behind. The others are decided one by one.
  for (const { id } of left) {
    try {
      const mark = read.marks.find((candidate) => candidate.id === id);
      const step = mark ? decide(current, read, [mark], 'reject') : [];
      changes = spliceRepairs(text, changes, current, step);
      current = applyChanges(current, step);
      read = parse(current);
    } catch (error) {
      if (!(error instanceof EditError)) throw error;
    }
  }
  return changes;
}

/**
 * Accepts every tracked change that passes `filter` (all by default), as one list of changes.
 * Highlights, comments and what v0.1 does not decide stay. Nothing is written when there is
 * nothing to accept.
 *
 * @throws EditError when the ledger can't be read.
 */
export function acceptAll(text: string, filter?: (mark: MarkRange) => boolean): TextChange[] {
  const parsed = parse(text);
  return decide(text, parsed, selected(parsed, filter), 'accept');
}

/** Rejects every tracked change that passes `filter` (all by default). See `acceptAll`. A format
 * change that can't be undone stays pending. */
export function rejectAll(text: string, filter?: (mark: MarkRange) => boolean): TextChange[] {
  const parsed = parse(text);
  return rejectTogether(text, parsed, selected(parsed, filter));
}
