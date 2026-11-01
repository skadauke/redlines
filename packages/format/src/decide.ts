// Accepting and rejecting changes (format §2.2, §3.6, §4). A decision is a list of text changes:
// the markers go, and rejecting a deletion or a substitution puts the old text back. The ledger
// loses the entry of every mark that is gone. v0.1 decides insertions, deletions, substitutions,
// splits and highlights; format changes, table marks and moves are kept as they are.

import { breakEnd } from './blocks.ts';
import { commitEdit, eolOf, inEol, markerRanges, workingLedger } from './edit-support.ts';
import type { Eol } from './edit-support.ts';
import { EditError } from './errors.ts';
import { parse } from './parse.ts';
import type { MarkRange, Parsed, Range, Segment, TextChange } from './types.ts';

type Action = 'accept' | 'reject';

const NOT_SUPPORTED = 'not supported in v0.1';

/** A deletion whose payload starts with `row=` or `col=` belongs to a table (format §3.7). */
const TABLE_DELETION = /^(?:row|col)=/;

function isTableMark(mark: MarkRange): boolean {
  return (
    (mark.kind === 'ins' && (mark.payload === 'row' || mark.payload === 'col')) ||
    (mark.kind === 'del' && TABLE_DELETION.test(mark.payload ?? ''))
  );
}

/** Whether v0.1 can accept and reject the mark. */
function isDecidable(mark: MarkRange): boolean {
  if (mark.entry.move !== undefined || isTableMark(mark)) return false;
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
  mark: MarkRange,
  action: Action,
  eol: Eol,
): TextChange[] {
  const changes: TextChange[] = [];
  const remove = (range: Range) => changes.push({ from: range.from, to: range.to, insert: '' });
  for (const { open, close, payload } of mark.segments) {
    const whole = { from: open.from, to: (close ?? open).to };
    const restored = inEol(payload ?? '', eol);
    if (mark.kind === 'split') {
      const to = action === 'accept' ? open.to : breakEnd(text, open.to, limit);
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

/** Changes that do not overlap: where one lies inside another, the outer one wins. */
function outermost(changes: readonly TextChange[]): TextChange[] {
  const kept: TextChange[] = [];
  let end = -1;
  for (const change of changes.toSorted((a, b) => a.from - b.from || b.to - a.to)) {
    if (change.from < end) continue;
    kept.push(change);
    end = change.to;
  }
  return kept;
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
      if (isRemoved(changes, segment.open)) continue;
      const isPoint = !segment.close || isRemoved(changes, segment.close);
      if (!isPoint && isEmptied(changes, segment.content)) emptied.push(segment);
      else live.push(segment);
    }
    // A thread stays: when no part of a comment covers anything, it becomes a point comment at
    // the first of them (format §4). A highlight has no point form and goes.
    const [point] = live.length === 0 && mark.kind === 'cmt' ? emptied : [];
    for (const segment of emptied) {
      if (segment === point && segment.close) remove(segment.close);
      else {
        remove(segment.open);
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
  const raw = marks.flatMap((mark) => decisionChanges(text, limit, mark, action, eol));
  let changes = keepAnnotations(outermost(raw), parsed, new Set(marks.map((mark) => mark.id)));
  // Removing an annotation can empty another that held it, so go on until nothing is left to do.
  for (;;) {
    const extra = emptiedAnnotations(changes, parsed);
    if (extra.length === 0) break;
    changes = [...changes, ...extra].sort((a, b) => a.from - b.from || a.to - b.to);
  }
  const ledger = workingLedger(parsed.ledger);
  for (const mark of marks) delete ledger.marks[mark.id];
  return commitEdit(text, changes, ledger, { parsed });
}

/**
 * Accepts a change: the markers go and the new text stays, so a deleted text is gone for good. An
 * insertion that holds other people's changes leaves them pending. A highlight is dismissed.
 *
 * @throws EditError when there is no such change, when it is a comment, when v0.1 does not decide
 *   its kind (`not supported in v0.1`), or when the ledger can't be read.
 */
export function accept(text: string, id: string): TextChange[] {
  const parsed = parse(text);
  return decide(text, parsed, [markToDecide(parsed, id)], 'accept');
}

/**
 * Rejects a change: an insertion goes with everything inside it, a deletion's text comes back as
 * plain text and a substitution gives the old text back. A comment on text that goes becomes a
 * point comment where the text was.
 *
 * @throws EditError as `accept` does.
 */
export function reject(text: string, id: string): TextChange[] {
  const parsed = parse(text);
  return decide(text, parsed, [markToDecide(parsed, id)], 'reject');
}

function selected(parsed: Parsed, filter?: (mark: MarkRange) => boolean): MarkRange[] {
  return parsed.marks.filter((mark) => isChange(mark) && (!filter || filter(mark)));
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

/** Rejects every tracked change that passes `filter` (all by default). See `acceptAll`. */
export function rejectAll(text: string, filter?: (mark: MarkRange) => boolean): TextChange[] {
  const parsed = parse(text);
  return decide(text, parsed, selected(parsed, filter), 'reject');
}
