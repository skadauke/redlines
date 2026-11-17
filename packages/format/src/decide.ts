// Accepting and rejecting changes (format §2.2, §2.6, §3.6, §4). A decision is a list of text
// changes: the markers go, rejecting a deletion or a substitution puts the old text back, and
// rejecting a format change undoes its operations. The ledger loses the entry of every mark that is
// gone. This decides insertions, deletions, substitutions, splits, highlights and inline format
// changes; block format changes, table marks and moves are kept as they are.

import { breakEnd, closerRange, lineEnd, lineStart, openerRange, splitEnd } from './blocks.ts';
import { applyChanges } from './changes.ts';
import {
  commitEdit,
  eolOf,
  hiddenError,
  markerRanges,
  paragraphBreaks,
  restoredPayload,
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
  rejectionError,
  rejectionWorks,
  underscoreRewrites,
} from './format-undo.ts';
import { parse } from './parse.ts';
import { scanPayload } from './scan.ts';
import { encodePayload, encodePayloadText } from './payload.ts';
import {
  findInPayload,
  intact,
  ledgerForSite,
  payloadFile,
  payloadIdsOf,
  payloadOfFile,
  prefixesOf,
} from './payload-marks.ts';
import type { PayloadFound } from './payload-marks.ts';
import { tablesOfText } from './table.ts';
import { colMarkIds, decideCols } from './table-cols.ts';
import { isAlignMark, isAlignPoint } from './table-align.ts';
import { wholeTableDeleted } from './table-bare.ts';
import { decideRows, originalRowText, rowMarkIds } from './table-ops.ts';
import type { MarkRange, Parsed, PayloadMarks, Range, Segment, TextChange } from './types.ts';
import { newestView, originalView, syntaxOnly } from './views.ts';

type Action = 'accept' | 'reject';

const NOT_SUPPORTED = 'not supported in v0.1';

const FENCE_LEFT_OPEN =
  'This decision would leave a code block open to the end of the file. Decide the changes next to it first.';

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

/** An inserted row or a deleted row (format §3.7), which accept and reject decide, the two halves of
 * a move together. */
const isRowMark = (mark: MarkRange) =>
  (mark.kind === 'ins' && mark.payload === 'row') ||
  (mark.kind === 'del' && /^row=/.test(mark.payload ?? ''));

/** An inserted column or a deleted column (format §3.7), the two halves of a move together. */
const isColMark = (mark: MarkRange) =>
  (mark.kind === 'ins' && mark.payload === 'col') ||
  (mark.kind === 'del' && /^col=/.test(mark.payload ?? ''));

/**
 * Whether a person can be offered to reject the mark: false for a format change whose text no
 * longer has the formatting it undoes, or has no text left in its syntax (`****`, `[](url)`), with
 * no change in it that could bring some back, and for a split whose break comes before a fence,
 * which rejecting would join to the text in front of it, so that the fence no longer opens its
 * code block and its closing fence opens one that never ends (format §3.3). It can only be
 * accepted, or go with the insertion that holds it. Other refusals say what to decide first.
 */
export function canReject(parsed: Parsed, mark: MarkRange): boolean {
  return rejectReason(parsed, mark) === undefined;
}

/** What Reject's hint says where a change can only be accepted (design §4.1). */
const ONLY_ACCEPT = 'This change can only be accepted: ';

/**
 * Why a person can't be offered to reject the mark, in a sentence that says what to do: "This change
 * can only be accepted: its block no longer has that syntax." (a hint for the grayed Reject), or
 * undefined where it can be. `canReject` is whether this says nothing.
 */
export function rejectReason(parsed: Parsed, mark: MarkRange): string | undefined {
  if (mark.kind === 'split') {
    return beforeFence(parsed.text, mark)
      ? `${ONLY_ACCEPT}rejecting it would join the line after it to the text in front, which opens a code fence.`
      : undefined;
  }
  if (mark.kind !== 'fmt') return undefined;
  const { text } = parsed;
  if (mark.segments.some((s) => s.close && text.slice(s.open.to, s.close.from).includes('<!--'))) {
    return undefined;
  }
  // Nothing is left for the change to have formatted: `****`, two backticks, `[](url)`.
  const ranges = mark.segments.filter((segment) => segment.close);
  if (ranges.length > 0 && ranges.every((segment) => syntaxOnly(text, mark, segment))) {
    return `${ONLY_ACCEPT}its text no longer has that formatting.`;
  }
  const error = rejectionError(formatReader(text, parsed), mark);
  if (error === null) return undefined;
  return `${ONLY_ACCEPT}${whyLost(error.message)}`;
}

/** What is lost, in the words of the hint, from what the format said when it could not restore. */
function whyLost(message: string): string {
  if (/alert no longer has a type/.test(message)) {
    return 'its alert no longer has a type on its first line.';
  }
  if (/table no longer has the columns/.test(message)) {
    return 'the table no longer has the columns it had.';
  }
  if (/block no longer has that syntax/.test(message))
    return 'its block no longer has that syntax.';
  if (/text no longer has that formatting/.test(message)) {
    return 'its text no longer has that formatting.';
  }
  return "its old text can't be restored.";
}

/** Whether the break of a split is followed by a line that opens a fenced code block. */
function beforeFence(text: string, mark: MarkRange): boolean {
  return mark.segments.some(({ open }) => {
    const end = breakEnd(text, open.to);
    if (end === open.to) return false;
    // Quote markers and list markers may stand in front of the fence on its line.
    return /^[ \t>]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)*(?:`{3,}|~{3,})/.test(
      text.slice(lineStart(text, end), lineEnd(text, end)),
    );
  });
}

/** Whether accept and reject decide the mark: not a table mark or a half of a move, nor a format
 * change with operations they can't undo. Comments are resolved instead. */
export function isDecidable(mark: MarkRange): boolean {
  if (isTableMark(mark)) return isRowMark(mark) || isColMark(mark);
  if (mark.entry.move !== undefined) return false;
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
  parsed: Parsed,
): TextChange[] {
  const changes: TextChange[] = [];
  const remove = (range: Range) => changes.push({ from: range.from, to: range.to, insert: '' });
  for (const [index, segment] of mark.segments.entries()) {
    if (mark.kind === 'fmt' && reader) {
      changes.push(...formatDecision(reader, mark, segment, action));
      continue;
    }
    // The opener goes with its carrier, if it has one.
    const open = openerRange(segment);
    const { close, payload } = segment;
    const whole = { from: open.from, to: (close ?? open).to };
    const restored = restoredPayload(payload ?? '', eol);
    if (mark.kind === 'split') {
      // Rejecting it takes the break with it, or the deletion of the break that someone recorded.
      const to = action === 'accept' ? open.to : splitEnd(text, segment.open, deletions, limit);
      changes.push({ from: open.from, to, insert: '' });
    } else if (mark.kind === 'del') {
      if (action === 'accept') changes.push(...acceptedOpener(parsed, mark, index, segment));
      else changes.push({ from: open.from, to: open.to, insert: restored });
    } else if (action === 'reject' && mark.kind === 'ins') {
      changes.push({ ...whole, insert: '' });
    } else if (action === 'reject' && mark.kind === 'sub') {
      changes.push({ ...whole, insert: restored });
    } else if (action === 'accept' && mark.kind === 'sub') {
      // Accepting keeps the new text and drops the markers, the old text and the marks in it, but a
      // comment in it stays, as a point comment where the new text starts (format §3.12).
      changes.push(...acceptedOpener(parsed, mark, index, segment));
      if (close) remove(closerRange(text, close));
    } else {
      // Accepting keeps the text and drops the markers; a highlight is dismissed either way.
      remove(open);
      if (close) remove(closerRange(text, close));
    }
  }
  return changes;
}

/**
 * What accepting a replacement does to its opener: it goes with its carrier, and the old text with
 * it. A comment in the old text stays, as a point comment where the new text starts (format §3.12,
 * the rule of a deleted block): the markers of the comments are written in place of the opener, one
 * after the other, and the carrier, if the opener has one, stays after them, so that they stand as
 * a block's opener does.
 */
function acceptedOpener(
  parsed: Parsed,
  mark: MarkRange,
  index: number,
  segment: Segment,
): TextChange[] {
  const ids: string[] = [];
  const walk = (held: PayloadMarks) => {
    for (const inner of held.marks) if (inner.kind === 'cmt') ids.push(inner.id);
    for (const deeper of held.payloads) walk(deeper);
  };
  for (const site of parsed.payloads) {
    if (site.owner === mark.id && site.segment === index) walk(site);
  }
  if (ids.length === 0) return [{ ...openerRange(segment), insert: '' }];
  const insert = [...new Set(ids)].map((id) => `<!--cmt ${id}-->`).join('');
  return [{ from: segment.open.from, to: segment.open.to, insert }];
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

/**
 * Whether a range that covers no text, only markers or nothing, stood in text that the changes
 * remove on both sides of it: it was in the removed text, as a range is that the removal empties.
 */
function inRemovedText(
  text: string,
  changes: readonly TextChange[],
  segment: Segment,
  covered: Range,
): boolean {
  if (!segment.close) return false;
  if (text.slice(covered.from, covered.to).replace(/<!--[^]*?-->/g, '') !== '') return false;
  const opener = openerRange(segment);
  const removes = (change: TextChange) => change.insert === '' && change.from < change.to;
  return (
    changes.some((change) => removes(change) && change.to === opener.from) &&
    changes.some((change) => removes(change) && change.from === segment.close!.to)
  );
}

/** The markers of comments and highlights whose text a decision removed, which are removed too. */
function emptiedAnnotations(
  text: string,
  changes: readonly TextChange[],
  parsed: Parsed,
): TextChange[] {
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
      // A range over no text in removed text is emptied with it (walk seed 197): its closer would
      // otherwise stay behind the opener, where the removal can leave them a line each.
      const over = !isPoint && inRemovedText(text, changes, segment, covered);
      if (!isPoint && (isEmptied(changes, covered) || over)) emptied.push(segment);
      else live.push(segment);
    }
    // A thread stays: when no part of a comment covers anything, it becomes a point comment at
    // the first of them (format §4). A highlight has no point form and goes.
    const [point] = live.length === 0 && mark.kind === 'cmt' ? emptied : [];
    for (const segment of emptied) {
      if (segment === point && segment.close) remove(closerRange(text, segment.close));
      else {
        remove(openerRange(segment));
        if (segment.close) remove(closerRange(text, segment.close));
      }
    }
  }
  return extra;
}

/** The ids of every marker in the payloads of `marks`, however deep: those that are read, and those
 * that a payload too deep to read holds as text until the replacement is rejected. */
function deepIds(marks: readonly MarkRange[]): string[] {
  const ids: string[] = [];
  const walk = (payload: string, depth: number) => {
    if (depth > 8 || !payload.includes('<!--')) return;
    for (const marker of scanPayload(payload).markers) {
      if (marker.type !== 'open') continue;
      ids.push(marker.id);
      if (marker.payload !== undefined) walk(marker.payload, depth + 1);
    }
  };
  for (const mark of marks) {
    if (mark.kind !== 'sub' && mark.kind !== 'del') continue;
    for (const segment of mark.segments) walk(segment.payload ?? '', 0);
  }
  return ids;
}

/** Whether a mark is a half of a move of a row. */
const isRowMove = (mark: MarkRange) => isRowMark(mark) && mark.entry.move !== undefined;

/**
 * The changes that decide `marks`, with the ledger that goes with them. The columns are decided after
 * the other marks, and a move of a row after those, each on the text the ones before leave: a column is
 * taken out or written in every line of the table, and a row goes back or stays with whatever is
 * pending in it decided already, which a decision over the same lines could not do together.
 */
function decide(
  text: string,
  parsed: Parsed,
  marks: readonly MarkRange[],
  action: Action,
): TextChange[] {
  // Rejecting every inserted column of a table whose original column is a pending deletion (#477).
  const bare =
    action === 'reject' && parsed.marks.some((mark) => mark.kind === 'del' && isColMark(mark))
      ? wholeTableDeleted(text, parsed, marks, (all) => decideTiers(text, parsed, all, 'reject'))
      : undefined;
  const changes = bare ?? decideTiers(text, parsed, marks, action);
  if (action !== 'accept' || changes.length === 0) return changes;
  if (!parsed.marks.some((mark) => isRowMove(mark) && mark.kind === 'ins')) return changes;
  return resyncMoves(text, changes);
}

/**
 * A decision that accepts a change inside a row that a pending move wrote is a change of the row, and
 * the row goes back with it when the move is rejected (format §3.7, #475): the kept copy, which the
 * original view reads at the old place, is written again as the row now reads with its pending changes
 * rejected, so that the original view is what rejecting the move gives and every order of the decisions
 * reads alike.
 */
function resyncMoves(text: string, changes: TextChange[]): TextChange[] {
  const after = applyChanges(text, changes);
  const read = parse(after);
  const step: TextChange[] = [];
  for (const table of tablesOfText(after, read)) {
    table.rows.forEach((row, index) => {
      const copy = row.insertion;
      if (!copy || copy.entry.move === undefined || copy.payload !== 'row') return;
      const twin = table.deletions.find((d) => d.mark.id === copy.entry.move);
      const open = twin?.mark.segments[0]?.open;
      const payload = twin?.mark.payload;
      if (!twin || !open || payload === undefined) return;
      try {
        const moved = applyChanges(after, decide(after, read, [copy], 'accept'));
        const readMoved = parse(moved);
        const mine = tablesOfText(moved, readMoved).find((t) => t.from === table.from);
        const placed = mine?.rows[index];
        if (!placed) return;
        const prefix = /^(?:row|col)=\d+ ?/.exec(payload)?.[0] ?? '';
        const wanted = prefix + originalRowText(moved, readMoved, placed);
        if (wanted === payload) return;
        step.push({
          from: open.from,
          to: open.to,
          insert: `<!--del ${twin.mark.id} ${encodePayload(wanted)}-->`,
        });
      } catch (error) {
        if (!(error instanceof EditError)) throw error;
      }
    });
  }
  if (step.length === 0) return changes;
  return spliceRepairs(
    text,
    changes,
    after,
    step.sort((a, b) => a.from - b.from),
  );
}

function decideTiers(
  text: string,
  parsed: Parsed,
  marks: readonly MarkRange[],
  action: Action,
): TextChange[] {
  const tiers = [
    marks.filter((mark) => !isRowMove(mark) && !isColMark(mark) && !isAlignMark(mark)),
    marks.filter(isColMark),
    marks.filter(isRowMove),
    marks.filter(isAlignMark),
  ].filter((tier) => tier.length > 0);
  if (tiers.length <= 1) return decideNow(text, parsed, marks, action);
  let changes: TextChange[] = [];
  let current = text;
  let read = parsed;
  for (const tier of tiers) {
    const ids = new Set(tier.map((mark) => mark.id));
    const later = changes.length === 0 ? tier : read.marks.filter((mark) => ids.has(mark.id));
    const step = decideNow(current, read, later, action);
    changes = changes.length === 0 ? step : spliceRepairs(text, changes, current, step);
    current = applyChanges(current, step);
    read = parse(current);
  }
  return changes;
}

/** The text with every pending move of a row accepted, or undefined where one can't be. */
function movesAccepted(text: string, parsed: Parsed): string | undefined {
  const moves = parsed.marks.filter(isRowMove);
  if (moves.length === 0) return undefined;
  try {
    return applyChanges(text, decide(text, parsed, moves, 'accept'));
  } catch (error) {
    if (error instanceof EditError) return undefined;
    throw error;
  }
}

/**
 * Throws when a decision lets the text of a row that a pending move writes be read otherwise once the
 * move is accepted. The view of the decision leaves a moved row out as the original view does, or in
 * its new place, and a mark inside the row can hold text that the decision cannot see (a substitution
 * in a format change holds the closing `**` of the format as its old text): the decision is checked
 * in the other order of the move too. (Format §3.7.)
 */
function assertMovesKept(
  text: string,
  parsed: Parsed,
  changes: readonly TextChange[],
  keeps: 'newest' | 'original' | 'both',
): void {
  const before = movesAccepted(text, parsed);
  if (before === undefined) return;
  const afterText = applyChanges(text, changes);
  const after = movesAccepted(afterText, parse(afterText));
  if (after === undefined) return;
  const view = keeps === 'newest' ? newestView : originalView;
  if (paragraphBreaks(view(after).text) !== paragraphBreaks(view(before).text)) {
    throw new EditError(
      `This decision would change the ${keeps} text of a row that is moved, because a marker that goes lets the text next to it be read otherwise. Decide the changes next to it first.`,
      'no-legal-placement',
    );
  }
}

function decideNow(
  text: string,
  parsed: Parsed,
  marks: readonly MarkRange[],
  action: Action,
): TextChange[] {
  if (marks.length === 0) return [];
  const eol = eolOf(text, parsed.ledgerRange);
  const limit = parsed.ledgerRange?.from;
  const deletions = parsed.marks.flatMap((mark) => (mark.kind === 'del' ? mark.segments : []));
  const formats = marks.filter((mark) => mark.kind === 'fmt');
  const reader = formats.length > 0 ? formatReader(text, parsed) : undefined;
  const rowMarks = marks.filter(isRowMark);
  const colMarks = marks.filter(isColMark);
  const decidedIds = new Set(marks.map((mark) => mark.id));
  const travelling = new Set<string>();
  const raw = marks
    .filter((mark) => !isRowMark(mark) && !isColMark(mark))
    .flatMap((mark) => decisionChanges(text, limit, deletions, mark, action, eol, reader, parsed));
  if (rowMarks.length > 0) {
    // The rows of a table are decided together, a move's two halves with each other.
    const wanted = new Set(rowMarks.map((mark) => mark.id));
    const found = new Set<string>();
    for (const table of tablesOfText(text, parsed)) {
      const here = rowMarkIds(table);
      const mine = new Set([...wanted].filter((id) => here.has(id)));
      if (mine.size === 0) continue;
      const done = decideRows(text, parsed, table, mine, action, eol);
      raw.push(...done.changes);
      for (const id of done.decided) {
        found.add(id);
        decidedIds.add(id);
      }
      for (const id of done.anchored) decidedIds.add(id);
      for (const id of done.travelling) travelling.add(id);
    }
    if (rowMarks.some((mark) => !found.has(mark.id))) {
      throw new EditError(NOT_SUPPORTED, 'not-supported');
    }
  }
  if (colMarks.length > 0) {
    // The columns of a table are decided together, a move's two halves with each other.
    const wanted = new Set(colMarks.map((mark) => mark.id));
    const found = new Set<string>();
    for (const table of tablesOfText(text, parsed)) {
      const here = colMarkIds(table);
      const mine = new Set([...wanted].filter((id) => here.has(id)));
      if (mine.size === 0) continue;
      const done = decideCols(text, parsed, table, mine, action);
      raw.push(...done.changes);
      for (const id of done.decided) {
        found.add(id);
        decidedIds.add(id);
      }
      for (const id of done.anchored) decidedIds.add(id);
      for (const id of done.travelling) travelling.add(id);
    }
    if (colMarks.some((mark) => !found.has(mark.id))) {
      throw new EditError(NOT_SUPPORTED, 'not-supported');
    }
  }
  let changes = keepAnnotations(outermost(raw), parsed, new Set([...decidedIds, ...travelling]));
  // Removing an annotation can empty another that held it, so go on until nothing is left to do.
  // Every round removes markers that were not removed before, so the markers are the most rounds.
  const markers = parsed.marks.reduce((sum, mark) => sum + 2 * mark.segments.length, 0);
  for (let round = 0; ; round++) {
    const extra = emptiedAnnotations(text, changes, parsed);
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
  for (const id of decidedIds) delete ledger.marks[id];
  // A highlight is no change: neither view is different once it is dismissed.
  const keeps = marks.every(isAnnotation) ? 'both' : action === 'accept' ? 'newest' : 'original';
  // The alignment changes that this decision leaves pending are read after it: a column that comes back carries the
  // mark of the change to the end of the cell that is the header's last, where a backtick or the half of a comment
  // in the column that returns and another in the table could pair across the cells and hide it. The mark is written
  // again by the decision, which `commitEdit` takes for a removal and does not look at, and its entry would be lost
  // with it, and nothing said.
  const pointed = parsed.marks.filter((mark) => isAlignPoint(mark) && !decidedIds.has(mark.id));
  try {
    const done = commitEdit(text, changes, ledger, {
      parsed,
      removes: true,
      keeps,
      ...(pointed.length > 0
        ? {
            verify: (_after: string, read: Parsed) => {
              if (pointed.some((mark) => !read.marks.some((other) => other.id === mark.id))) {
                throw hiddenError(true);
              }
            },
          }
        : {}),
    });
    if (keeps !== 'both' && !marks.some((mark) => isRowMove(mark) || isColMark(mark))) {
      assertMovesKept(text, parsed, done, keeps);
    }
    return done;
  } catch (error) {
    // The ledger would be code: the decision would leave a fence open to the end of the file.
    if (error instanceof EditError && error.code === 'unclosed-end') {
      throw new EditError(FENCE_LEFT_OPEN, 'no-legal-placement');
    }
    throw error;
  }
}

/**
 * Decides a mark that the old text of a replacement holds (format §3.12): the old text is a file of
 * its own for the length of the decision, so that the mark is decided there by the code that decides
 * it in a file, and is refused when it would be refused there. The decided old text is written
 * again, encoded, in the opener of the replacement; the new text is not touched, and nor is the
 * newest view. Rejecting the replacement afterwards gives what deciding the mark in the file before
 * the edit would have left.
 */
function decideInPayload(
  text: string,
  parsed: Parsed,
  found: PayloadFound,
  action: Action,
): TextChange[] {
  const { mark, chain } = found;
  const leaf = chain.at(-1);
  const top = chain[0];
  if (!leaf || !top)
    throw new EditError(`There is no change with the id ${mark.id}.`, 'unknown-id');
  // The payload is a file of its own, with the prefix its first line has in the file (`> `, `- `),
  // and with the entries of the marks it holds.
  const prefix = prefixesOf(text, parsed, chain).at(-1) ?? '';
  const proxy = payloadFile(prefix + leaf.text, ledgerForSite(parsed, leaf));
  // An old text that ends inside a comment or a fence that it never closes takes the ledger into it.
  if (!intact(proxy, prefix + leaf.text)) {
    throw new EditError(
      "This change is in text that ends inside a comment or a code block that is never closed, so it can't be decided there. Decide the change that holds it first.",
      'no-legal-placement',
    );
  }
  const read = parse(proxy);
  const inside = markToDecide(read, mark.id);
  const changes = decide(proxy, read, [inside], action);
  const made = applyChanges(proxy, changes);
  let written = payloadOfFile(made, parse(made));
  if (!written.startsWith(prefix)) throw new EditError(UNFINISHED, 'no-legal-placement');
  written = written.slice(prefix.length);
  // The decided text goes back into the opener that holds it, one payload at a time, inward out.
  for (let depth = chain.length - 1; depth >= 1; depth--) {
    const site = chain[depth];
    const outer = chain[depth - 1];
    const owner = outer?.marks.find((held) => held.id === site?.owner);
    const segment = owner?.segments[site?.segment ?? -1];
    if (!outer || !owner || !segment) throw new EditError(UNFINISHED, 'no-legal-placement');
    written = `${outer.text.slice(0, segment.open.from)}<!--${owner.kind} ${owner.id} ${encodePayloadText(
      written,
    )}-->${outer.text.slice(segment.open.to)}`;
  }
  const holder = parsed.marks.find((held) => held.id === top.owner);
  const opener = holder?.segments[top.segment]?.open;
  if (!holder || !opener) throw new EditError(UNFINISHED, 'no-legal-placement');
  const change: TextChange = {
    from: opener.from,
    to: opener.to,
    insert: `<!--${holder.kind} ${holder.id} ${encodePayloadText(written)}-->`,
  };
  const keeps = inside.kind === 'hl' ? 'both' : action === 'accept' ? 'newest' : 'original';
  return commitEdit(text, [change], workingLedger(parsed.ledger), {
    parsed,
    removes: true,
    keeps,
  });
}

/** The mark with this id in the body, or one the old text of a replacement holds: decided in the
 * body, or in that old text. */
function decideById(text: string, parsed: Parsed, id: string, action: Action): TextChange[] {
  if (!parsed.marks.some((mark) => mark.id === id)) {
    const found = findInPayload(parsed, id);
    if (found) {
      if (found.mark.kind === 'cmt') markToDecide({ ...parsed, marks: [found.mark] }, id);
      return decideInPayload(text, parsed, found, action);
    }
  }
  return decide(text, parsed, [markToDecide(parsed, id)], action);
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
  return decideById(text, parsed, id, 'accept');
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
  return decideById(text, parsed, id, 'reject');
}

/**
 * Decides several marks in one list of changes, all or none: the first one that can't be decided
 * is thrown for, and nothing is written.
 */
function marksToDecide(parsed: Parsed, ids: readonly string[]): MarkRange[] {
  return ids.map((id) => markToDecide(parsed, id));
}

/**
 * Accepts the marks `ids` as one decision, as for a suggestion that is several marks. The result
 * is the same as accepting each, but the text is changed once.
 *
 * @throws EditError as `accept` does for any one of them, and then nothing is decided.
 */
export function acceptMarks(text: string, ids: readonly string[]): TextChange[] {
  const parsed = parse(text);
  return decide(text, parsed, marksToDecide(parsed, ids), 'accept');
}

/**
 * Rejects the marks `ids` as one decision. See `acceptMarks`. A format change among them that
 * can't be rejected is an error here, where `rejectAll` leaves it pending.
 *
 * @throws EditError as `reject` does for any one of them, and then nothing is decided.
 */
export function rejectMarks(text: string, ids: readonly string[]): TextChange[] {
  const parsed = parse(text);
  const marks = marksToDecide(parsed, ids);
  for (const mark of marks) {
    if (!canReject(parsed, mark)) {
      throw new EditError('A format change here can only be accepted.', 'no-legal-placement');
    }
  }
  const changes = rejectTogether(text, parsed, marks);
  // A format change that `rejectTogether` could not undo stays pending, and that is not all.
  const left = new Set(parse(applyChanges(text, changes)).marks.map((mark) => mark.id));
  if (ids.some((id) => left.has(id))) {
    throw new EditError('A format change here can only be accepted.', 'no-legal-placement');
  }
  return changes;
}

function selected(parsed: Parsed, filter?: (mark: MarkRange) => boolean): MarkRange[] {
  // A row mark that is in no table (a text merge can leave one) is left pending.
  const inTable = new Set<string>();
  if (parsed.marks.some((mark) => isRowMark(mark) || isColMark(mark))) {
    for (const table of tablesOfText(parsed.text, parsed)) {
      for (const id of rowMarkIds(table)) inTable.add(id);
      for (const id of colMarkIds(table)) inTable.add(id);
    }
  }
  return parsed.marks.filter(
    (mark) =>
      isChange(mark) &&
      (!(isRowMark(mark) || isColMark(mark)) || inTable.has(mark.id)) &&
      (!filter || filter(mark)),
  );
}

/** Where a mark is: from its first opener to the end of its last segment. */
function extentOf(mark: MarkRange): Range {
  return {
    from: Math.min(...mark.segments.map((segment) => segment.open.from)),
    to: Math.max(...mark.segments.map((segment) => (segment.close ?? segment.content).to)),
  };
}

/**
 * The changes `acceptAll` would decide that `range` touches, with the other marks of their
 * suggestions (marks of one `group` are decided together), or all of them without a range. A
 * range touches a change when it has some of its text (a caret or an edge alone does not). A
 * deleted row or column, which is kept below its table, and an inserted column, which stands in
 * the header, are touched by a range that touches the table, deletions included; an inserted
 * row, by one that touches the row.
 */
export function changesIn(parsed: Parsed, range?: Range): MarkRange[] {
  const all = selected(parsed);
  if (!range) return all;
  const extents = new Map<string, Range>();
  if (all.some((mark) => isRowMark(mark) || isColMark(mark))) {
    for (const table of tablesOfText(parsed.text, parsed)) {
      const whole = {
        from: table.from,
        to: Math.max(table.to, ...table.deletions.map(({ mark }) => extentOf(mark).to)),
      };
      for (const id of rowMarkIds(table)) extents.set(id, whole);
      for (const id of colMarkIds(table)) extents.set(id, whole);
      for (const row of table.rows) if (row.insertion) extents.set(row.insertion.id, row);
    }
  }
  const touched = all.filter((mark) => {
    const { from, to } = extents.get(mark.id) ?? extentOf(mark);
    return range.from < to && from < range.to;
  });
  const groups = new Set(touched.flatMap((mark) => (mark.entry.group ? [mark.entry.group] : [])));
  const ids = new Set(touched.map((mark) => mark.id));
  return all.filter((mark) => ids.has(mark.id) || groups.has(mark.entry.group ?? ''));
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
  const marks = selected(parsed, filter);
  let changes = rejectTogether(text, parsed, marks);
  if (parsed.payloads.length === 0) return changes;
  // The marks in the old text of a replacement that is rejected are pending again, and are
  // rejected with it: nothing is left pending but what the filter keeps (format §3.12).
  const wanted = new Set(marks.flatMap((mark) => payloadIdsOf(parsed, mark)));
  // Marks that were text in a payload too deep to read come back as marks, and go with it.
  for (const id of deepIds(marks)) wanted.add(id);
  let current = applyChanges(text, changes);
  for (let round = 0; wanted.size > 0 && round <= wanted.size; round++) {
    const read = parse(current);
    const again = selected(read, filter).filter((mark) => wanted.has(mark.id));
    if (again.length === 0) break;
    const step = rejectTogether(current, read, again);
    changes = spliceRepairs(text, changes, current, step);
    current = applyChanges(current, step);
  }
  return changes;
}
