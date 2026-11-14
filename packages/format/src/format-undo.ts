// Undoing a format change (format §2.6): what accepting and rejecting one does to the file. Accepting
// takes the markers away. Rejecting also undoes the operations, from what stands in the mark now, and
// refuses when that is not there.

import { openerRange } from './blocks.ts';
import { EditError } from './errors.ts';
import { blockUndo } from './format-blocks.ts';
import {
  DELIMITER,
  closingOf,
  isAlignOps,
  isBlockUndo,
  isInlineFormat,
  opsOf,
} from './format-ops.ts';
import { alignDecision } from './table-align.ts';
import type { ParsedFormatOp } from './format-ops.ts';
import {
  PREFIX,
  SYNTAX,
  charAfter,
  charBefore,
  endOf,
  inFile,
  indexAt,
  isSpace,
  readLayout,
  startOf,
} from './format-reader.ts';
import type { FormatReader, LinkSpan } from './format-reader.ts';
import { isWord, paragraphRange } from './inline.ts';
import type { MarkRange, Range, Segment, TextChange } from './types.ts';

export { decidesFormat } from './format-ops.ts';

export const refused = (reason: string) => new EditError(reason, 'no-legal-placement');

export const LOST_SYNTAX =
  "This format change can't be rejected, because its text no longer has that formatting. Accept it, or change the text in Raw with Track Changes off.";

const DECIDE_INSIDE =
  "This format change can't be rejected until the changes inside it are decided. Accept or reject them first.";

export const overlaps = (a: Range, b: Range): boolean => a.from < b.to && b.from < a.to;

/** The changes of a file's body, in the order they go. */
export const inOrder = (changes: readonly TextChange[]): TextChange[] =>
  changes.toSorted((a, b) => a.from - b.from || a.to - b.to);

/** The changes that take a segment's markers away, or with `rest`, write its opener again with those
 * operations; and that give the text what undoing `ops` gives it. */
export function segmentChanges(
  reader: FormatReader,
  mark: MarkRange,
  segment: Segment,
  ops: readonly ParsedFormatOp[],
  rest: readonly ParsedFormatOp[] = [],
): TextChange[] {
  const undone = undoOf(reader, segment, ops);
  const start = segment.carrier?.to ?? segment.content.from;
  const opener = openerRange(segment);
  const close = segment.close ?? { from: segment.content.to, to: segment.content.to };
  // What is written at the place of a marker goes in one change with it.
  const changes = [...undone.changes];
  if (rest.length > 0) {
    const written = `<!--fmt ${mark.id} ${rest.map((op) => op.source).join(' ')}-->`;
    changes.push({ ...segment.open, insert: written });
    if (undone.left !== '') changes.push({ from: undone.at, to: undone.at, insert: undone.left });
    changes.push({ from: segment.content.to, to: segment.content.to, insert: undone.right });
  } else {
    if (undone.at === start) changes.push({ ...opener, insert: undone.left });
    else {
      changes.push({ ...opener, insert: '' });
      changes.push({ from: undone.at, to: undone.at, insert: undone.left });
    }
    changes.push({ from: segment.content.to, to: close.to, insert: undone.right });
  }
  return changes
    .filter((change) => change.from < change.to || change.insert !== '')
    .toSorted((a, b) => a.from - b.from || a.to - b.to);
}

/** What undoing `ops` does to a segment's text: `left` goes at `at`, the place of the first text in
 * the mark, `right` at the end of the mark, and `changes` are the syntax that goes. */
function undoOf(
  reader: FormatReader,
  segment: Segment,
  ops: readonly ParsedFormatOp[],
): { at: number; left: string; right: string; changes: TextChange[] } {
  const start = segment.carrier?.to ?? segment.content.from;
  const end = segment.content.to;
  const none = { at: start, left: '', right: '', changes: [] };
  if (end <= start || ops.length === 0) return none;
  // Other pending changes in the mark may be what holds its syntax, as a deletion of its text does.
  const pendingInside = reader.hidden.some(
    ({ from, to, mark }) =>
      from >= start &&
      to <= end &&
      (mark?.kind === 'del' || mark?.kind === 'sub' || mark?.kind === 'ins'),
  );
  const lost = () => refused(pendingInside ? DECIDE_INSIDE : LOST_SYNTAX);
  // The opener of a mark inside this one can stand on a line of its own after `start`, which reads
  // as a blank line: the paragraph is where the text of the mark is.
  const layout = readLayout(reader, paragraphRange(reader.text, reader.hidden, end));
  const first = indexAt(layout, start);
  const to = indexAt(layout, end);
  // A mark that starts a wrapped line has the line break and the prefix of the line in it.
  let from = first;
  while (from < to && (layout.roles[from] === PREFIX || isSpace(layout.v[from]))) from++;
  if (from >= to) {
    if (pendingInside) throw lost();
    return none;
  }
  const at = from > first ? startOf(layout, from) : start;
  /** Whether only syntax comes between the first text of the mark and `index`. */
  const leads = (index: number) => {
    for (let i = from; i < index; i++) if (layout.roles[i] !== SYNTAX) return false;
    return true;
  };
  const changes: TextChange[] = [];
  let left = '';
  let right = '';
  for (const op of ops) {
    const { name, sign, value } = op;
    if (name === 'link') {
      if (sign === '-') {
        left += '[';
        right = `](${value ?? ''})${right}`;
        continue;
      }
      const link = layout.links.find(
        (l) => l.inline && l.from >= from && l.to <= to && leads(l.from),
      );
      if (!link) throw lost();
      if (sign === '+') {
        changes.push({
          from: startOf(layout, link.from),
          to: endOf(layout, link.text.from),
          insert: '',
        });
        changes.push({
          from: startOf(layout, link.text.to),
          to: endOf(layout, link.to),
          insert: '',
        });
      } else {
        const url = urlIn(layout.v, link);
        changes.push({ ...inFile(layout, url), insert: value ?? '' });
      }
    } else if (isInlineFormat(name) && sign === '-') {
      const syntax = value ?? DELIMITER[name];
      // A rejection does not leave `_` against a letter or a digit (format §2.6).
      const letters =
        isWord(charBefore(layout.v, from, new Set())) || isWord(charAfter(layout.v, to, new Set()));
      const written = letters ? syntax.replaceAll('_', '*') : syntax;
      left += written;
      right = closingOf(name, written) + right;
    } else if (isInlineFormat(name)) {
      const span = layout.spans.find(
        (s) => s.format === name && s.open.from >= from && s.close.to <= to && leads(s.open.from),
      );
      if (!span) throw lost();
      changes.push({ ...inFile(layout, span.open), insert: '' });
      changes.push({ ...inFile(layout, span.close), insert: '' });
    }
  }
  return { at, left, right, changes };
}

/** The address of a link: what stands in its parentheses, without a title. */
export function urlIn(v: string, link: LinkSpan): Range {
  const { from, to } = link.dest;
  const raw = v.slice(from, to);
  const lead = /^\s*/.exec(raw)?.[0].length ?? 0;
  if (raw[lead] === '<') {
    let close = lead + 1;
    while (close < raw.length && raw[close] !== '>') close += raw[close] === '\\' ? 2 : 1;
    return { from: from + lead, to: from + Math.min(close + 1, raw.length) };
  }
  const end = /\s/.exec(raw.slice(lead))?.index;
  return { from: from + lead, to: end === undefined ? to : from + lead + end };
}

/**
 * The changes that decide one segment of a format change: its markers go, and rejecting it undoes
 * its operations, so that the text is as it was.
 *
 * @throws EditError when its text no longer has the formatting that rejecting takes away.
 */
export function formatDecision(
  reader: FormatReader,
  mark: MarkRange,
  segment: Segment,
  action: 'accept' | 'reject',
): TextChange[] {
  // An alignment change of a table, whose closer stands below it: its own markers go and its own
  // old row comes back (format §3.7).
  if (isAlignOps(opsOf(mark, segment))) return alignDecision(reader, mark, segment, action);
  const ops = action === 'reject' ? opsOf(mark, segment) : [];
  if (isBlockUndo(ops)) return blockUndo(reader, segment, ops);
  return segmentChanges(reader, mark, segment, ops);
}

/** Whether rejecting the mark can be worked out now: whether its text has what it undoes. */
export function rejectionWorks(reader: FormatReader, mark: MarkRange): boolean {
  try {
    for (const segment of mark.segments) formatDecision(reader, mark, segment, 'reject');
    return true;
  } catch (error) {
    if (error instanceof EditError) return false;
    throw error;
  }
}

/**
 * What a decision about format changes rewrites: `_` emphasis that a marker it takes away kept off a
 * letter or a digit would render literally (`re_built_`), so it is written with `*` (format §2.6).
 * `changes` are those of the decision.
 */
export function underscoreRewrites(
  reader: FormatReader,
  segments: readonly Segment[],
  changes: readonly TextChange[],
): TextChange[] {
  const sorted = inOrder(changes);
  /** Whether the changes take away all of a range that holds something, and write nothing there. */
  const cleared = ({ from, to }: Range) => {
    if (from >= to) return false;
    let at = from;
    for (const change of sorted) {
      if (change.to < at || change.from > to) continue;
      if (change.insert !== '') return false;
      if (change.from <= at && change.to > at) at = change.to;
    }
    return at >= to;
  };
  const rewrites: TextChange[] = [];
  const seen = new Set<number>();
  const none = new Set<number>();
  for (const segment of segments) {
    const paragraph = paragraphRange(reader.text, reader.hidden, segment.content.to);
    if (seen.has(paragraph.from)) continue;
    seen.add(paragraph.from);
    const layout = readLayout(reader, paragraph);
    for (const span of layout.spans) {
      const { open, close } = span;
      if (layout.v[open.from] !== '_') continue;
      const before = { from: endOf(layout, open.from), to: startOf(layout, open.from) };
      const after = { from: endOf(layout, close.to), to: startOf(layout, close.to) };
      const exposed =
        (open.from > 0 && isWord(charBefore(layout.v, open.from, none)) && cleared(before)) ||
        (close.to < layout.v.length &&
          isWord(charAfter(layout.v, close.to, none)) &&
          cleared(after));
      if (!exposed) continue;
      const opens = inFile(layout, open);
      const closes = inFile(layout, close);
      if (sorted.some((change) => overlaps(change, opens) || overlaps(change, closes))) continue;
      const stars = '*'.repeat(open.to - open.from);
      rewrites.push({ ...opens, insert: stars }, { ...closes, insert: stars });
    }
  }
  return rewrites;
}
