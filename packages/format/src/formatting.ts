// Format changes (format §2.6): formatting that changes while the words stay the same. With Track
// Changes on, a change is a `fmt` mark around the text, whose payload says what rejecting it undoes.
// With it off, the same syntax goes through `untrackedEdit`, and no mark is written. Block format
// changes (a block's type, an indent, a box) are planned in format-blocks.ts and written here.
//
// - Adding a format writes its syntax (`**`, `*`, `~~`, backticks, `[`…`](…)`) right against the
//   first and last characters of the text, and the markers right against the syntax. Text that has
//   the format already is left out, and a piece that would cross the edge of another format, a link
//   or a table cell is cut there. A format around all of another goes outside its syntax.
// - Removing a format takes all of its run, and the markers stand where its syntax stood.
// - A mark holds an insertion, a substitution or another format change only with text of its own on
//   both sides of it. Otherwise the range is cut at its edge, because rejecting the insertion would
//   leave `****`, or `** text**`, and markers would cross.
// - Another person's pending change in the paragraph refuses the change, unless all of the text is
//   in the author's own insertion, where the syntax is written as typed text, with no mark. A format
//   change of the author's own that is turned back goes away.
// - Each block has its marks, with one id for the pieces at one depth, and all of them share a group.
//
// Whatever a change comes to is tried before it is written, on its block by itself (the whole list,
// table or block quote, or the paragraph), and refused if it does not come out: it reads as the same
// plain text in every order of decisions of every mark there, which is where a delimiter that opens
// nothing shows up, and rejecting it gives back the bytes. The marks of an inline change's block
// that are apart from it, words changed in a paragraph of their own (format-apart.ts), are left
// pending while the others are tried: no decision of theirs can make it read otherwise. Nothing is
// repaired when a decision is made later. A line that defines a link is not formatted.

import {
  breakEnd,
  breakStart,
  frontMatterEnd,
  lineEnd,
  lineStart,
  lineStartKind,
  openerRange,
  prefixLength,
} from './blocks.ts';
import { applyChanges } from './changes.ts';
import { accept, acceptAll, acceptMarks, reject } from './decide.ts';
import {
  addPerson,
  assertNoMarkup,
  commitEdit,
  eolOf,
  inEol,
  snapOut,
  spliceRepairs,
  workingLedger,
} from './edit-support.ts';
import { EditError } from './errors.ts';
import { holdsMisreadItem, marksApart, segmentName } from './format-apart.ts';
import type { Apart } from './format-apart.ts';
import { isBlockOp, planBlock } from './format-blocks.ts';
import { DELIMITER, INLINE_FORMATS, encodeValue, opsOf, removedOp } from './format-ops.ts';
import type { FormatOp, InlineFormat, ParsedFormatOp } from './format-ops.ts';
import {
  LINES_ABOVE,
  SYNTAX,
  TEXT,
  charAfter,
  charBefore,
  endOf,
  formatReader,
  inFile,
  indexAt,
  isOlderPunctuation,
  isPunctuation,
  isRawParagraph,
  isSpace,
  paragraphsIn,
  plainBody,
  plainParagraphs,
  readLayout,
  squashSpaces,
  startOf,
} from './format-reader.ts';
import type { FormatReader, Layout, Span } from './format-reader.ts';
import { LOST_SYNTAX, inOrder, overlaps, refused, segmentChanges, urlIn } from './format-undo.ts';
import { idsIn, newId } from './ids.ts';
import {
  DELIMITER_ROW,
  definedLabels,
  inspectPlace,
  isWord,
  paragraphRange,
  visible,
} from './inline.ts';
import type { Place } from './inline.ts';
import { normalizeLedger } from './ledger-order.ts';
import { markerRanges } from './markers.ts';
import { serializeLedger } from './ledger-write.ts';
import { parse } from './parse.ts';
import { scan } from './scan.ts';
import type { TrackedEdits } from './track.ts';
import type {
  EditContext,
  Ledger,
  MarkEntry,
  MarkRange,
  Parsed,
  DocView,
  Person,
  Range,
  Segment,
  TextChange,
} from './types.ts';
import { nameOf, untrackedEdit } from './untracked.ts';
import { newestView, originalViewOfText } from './views.ts';
import type { UntrackedContext } from './untracked.ts';

export { parseFormatOps } from './format-ops.ts';
export type { BlockType, FormatOp, InlineFormat, ParsedFormatOp } from './format-ops.ts';

const FLANK = 'A marker here would change how the text next to it is emphasized.';

const READS_OTHERWISE =
  "This formatting can't be written here: Markdown would read the text next to it differently.";

const IN_CODE_SPAN = "Text inside code can't be formatted. Select the whole code span instead.";

const IN_VERBATIM = "Text inside code, an HTML block or an HTML comment can't be formatted.";

const IN_PARAGRAPH = 'Accept or reject the changes in this paragraph first.';

const HOLDER_UNTRACKED =
  "Text in a pending insertion can't be formatted with Track Changes off. Accept or reject it first, or turn on Track Changes.";

const BARE_ROW = 'A row of a table needs a leading | to hold a format change.';

const BOX_START =
  'A pending change starts the text of this task item, after its box. Decide it first, or format text after its first word.';

const STRADDLES =
  'This formatting starts and ends on different sides of a pending change. Accept or reject that change first.';

const REFERENCE =
  "This text has a reference, whose address is defined elsewhere in the file, so a link can't be changed or added here.";

const DEFINES = 'This line defines a link.';

/** A stretch of the visible text. */
type Piece = Range;

/** Where the opening syntax that holds `index` starts, when all of what it opens is before `to`. */
function opensBefore(layout: Layout, index: number, to: number): number | undefined {
  for (const { open, close } of layout.spans) {
    if (open.from <= index && index < open.to && close.to <= to) return open.from;
  }
  for (const link of layout.links) if (link.from === index && link.to <= to) return link.from;
  return undefined;
}

/** Where the closing syntax that holds `index` ends, when all of what it closes is after `from`. */
function closesAfter(layout: Layout, index: number, from: number): number | undefined {
  for (const { open, close } of layout.spans) {
    if (close.from <= index && index < close.to && open.from >= from) return close.to;
  }
  for (const link of layout.links) {
    if (link.text.to <= index && index < link.to && link.from >= from) return link.to;
  }
  return undefined;
}

/**
 * A piece without what stands at its ends that is not its text: white space, the prefix of a line,
 * and syntax whose other end is not in the piece. A format goes right against the text.
 */
function trimmed(layout: Layout, piece: Piece): Piece | undefined {
  const { v, roles } = layout;
  let { from, to } = piece;
  while (from < to) {
    if (roles[from] === TEXT && !isSpace(v[from])) break;
    const start = roles[from] === SYNTAX ? opensBefore(layout, from, to) : undefined;
    if (start !== undefined) {
      from = start;
      break;
    }
    from++;
  }
  while (to > from) {
    if (roles[to - 1] === TEXT && !isSpace(v[to - 1])) break;
    const end = roles[to - 1] === SYNTAX ? closesAfter(layout, to - 1, from) : undefined;
    if (end !== undefined) {
      to = end;
      break;
    }
    to--;
  }
  return from < to ? { from, to } : undefined;
}

/** A piece that stops inside what takes no marker reaches over all of it: an entity, an image, a
 * code span (format §3.5). */
function overAtoms(layout: Layout, piece: Piece): Piece {
  let { from, to } = piece;
  const atoms: Range[] = layout.hits.filter((hit) => hit.refuse === undefined && !hit.text);
  for (const span of layout.spans) {
    if (span.format === 'code') atoms.push({ from: span.open.from, to: span.close.to });
  }
  for (let changed = true; changed;) {
    changed = false;
    for (const atom of atoms) {
      if (atom.from < from && from < atom.to) {
        from = atom.from;
        changed = true;
      }
      if (atom.from < to && to < atom.to) {
        to = atom.to;
        changed = true;
      }
    }
  }
  return { from, to };
}

/** What a piece must nest with: all of it inside `inner`, or all of `outer` inside the piece. When
 * `always` is set, the second will not do either, and the piece is cut around it. When `edge` is set
 * (a mark, whose decision can take its text or syntax away), the second will do only with text of
 * the piece on either side of it: the syntax of the piece stays against text that no decision of it
 * takes, and its markers can't cross the markers of the mark. */
interface Nester {
  outer: Range;
  inner: Range;
  always?: boolean;
  edge?: boolean;
}

function crosses(piece: Piece, { outer, inner, always, edge }: Nester): boolean {
  if (piece.to <= outer.from || piece.from >= outer.to) return false;
  if (inner.from <= piece.from && piece.to <= inner.to) return false;
  if (always) return true;
  if (!(piece.from <= outer.from && outer.to <= piece.to)) return true;
  return edge === true && (piece.from === outer.from || piece.to === outer.to);
}

/** The piece, cut at what it crosses. */
function nested(layout: Layout, start: Piece, nesters: readonly Nester[]): Piece[] {
  const done: Piece[] = [];
  const todo = [start];
  for (let next = todo.pop(); next; next = todo.pop()) {
    const piece = trimmed(layout, next);
    if (!piece) continue;
    const { from, to } = piece;
    const crossed = nesters.find((nester) => crosses(piece, nester));
    if (!crossed) done.push(piece);
    else if (from < crossed.inner.from) {
      todo.push({ from: crossed.inner.from, to }, { from, to: crossed.outer.from });
    } else todo.push({ from: crossed.outer.to, to }, { from, to: crossed.inner.to });
  }
  return done.toSorted((a, b) => a.from - b.from);
}

/** `piece` without the ranges. */
function without(piece: Piece, ranges: readonly Range[]): Piece[] {
  let pieces = [piece];
  for (const range of ranges) {
    pieces = pieces.flatMap((p) => {
      if (!overlaps(p, range)) return [p];
      const left = { from: p.from, to: Math.min(p.to, range.from) };
      const right = { from: Math.max(p.from, range.to), to: p.to };
      return [left, right].filter((part) => part.from < part.to);
    });
  }
  return pieces;
}

/** A pending insertion or substitution, in the visible text of a paragraph. */
interface Holder extends Range {
  mark: MarkRange;
  own: boolean;
}

/** A segment of a format change, in the visible text of a paragraph. */
interface FormatSegment extends Range {
  mark: MarkRange;
  segment: Segment;
  ops: ParsedFormatOp[];
  own: boolean;
}

/** One thing a format change does, in offsets of the file. */
type Step =
  /** Syntax around text that had none. */
  | {
      kind: 'wrap';
      at: number;
      a: number;
      b: number;
      /** Where the opener goes: `a`, or at the end of the line before. */
      opener: number;
      left: string;
      right: string;
      op: string;
      /** The insertion of the author's own that holds it, where no mark is written. */
      own?: string;
    }
  /** Syntax taken away. */
  | {
      kind: 'unwrap';
      at: number;
      opens: Range;
      closes: Range;
      opener: number;
      op: string;
      /** How many other removals of this change are around it. */
      depth: number;
      own?: string;
    }
  /** A link's address changed. */
  | {
      kind: 'relink';
      at: number;
      outer: Range;
      opener: number;
      url: Range;
      insert: string;
      op: string;
    }
  /** A format change of the author's own changed in place. */
  | { kind: 'edit'; at: number; changes: TextChange[]; id: string; kept: boolean }
  /** A block format change: its changes, with the markers given, or with none the syntax alone. */
  | { kind: 'block'; at: number; write: (open: string, close: string) => TextChange[] };

/** What the planning of one change works with. */
interface Planning extends FormatReader {
  parsed: Parsed;
  /** Whose own marks are changed in place. Nobody's, with Track Changes off. */
  me: string | undefined;
  /** Whose pending changes don't keep a paragraph from being formatted: the author's. */
  owner: string | undefined;
  author: Person | undefined;
  tracked: boolean;
  /** The original view, every pending change rejected, once something has asked for it. */
  original?: DocView;
  /** The newest view, once something has asked for it. */
  newest?: DocView;
}

function holdersIn(planning: Planning, layout: Layout): Holder[] {
  const holders: Holder[] = [];
  for (const mark of planning.parsed.marks) {
    if (mark.kind !== 'ins' && mark.kind !== 'sub') continue;
    for (const segment of mark.segments) {
      if (!segment.close) continue;
      const start = segment.carrier?.to ?? segment.content.from;
      if (segment.content.to <= layout.range.from || start >= layout.range.to) continue;
      holders.push({
        mark,
        own: mark.entry.by === planning.me,
        from: indexAt(layout, start),
        to: indexAt(layout, segment.content.to),
      });
    }
  }
  return holders;
}

function formatSegmentsIn(planning: Planning, layout: Layout): FormatSegment[] {
  const segments: FormatSegment[] = [];
  for (const mark of planning.parsed.marks) {
    if (mark.kind !== 'fmt') continue;
    for (const segment of mark.segments) {
      if (!segment.close) continue;
      const start = segment.carrier?.to ?? segment.content.from;
      if (segment.content.to <= layout.range.from || start >= layout.range.to) continue;
      segments.push({
        mark,
        segment,
        ops: opsOf(mark, segment),
        own: mark.entry.by === planning.me,
        from: indexAt(layout, start),
        to: indexAt(layout, segment.content.to),
      });
    }
  }
  return segments;
}

/** What a new piece of `format` has to nest with in the paragraph. */
function nestersFor(planning: Planning, layout: Layout, format?: InlineFormat): Nester[] {
  const nesters: Nester[] = [];
  for (const { format: other, open, close } of layout.spans) {
    if (other === format) continue;
    nesters.push({
      outer: { from: open.from, to: close.to },
      inner: { from: open.to, to: close.from },
    });
  }
  for (const link of layout.links) {
    nesters.push({ outer: { from: link.from, to: link.to }, inner: link.text });
  }
  for (const wall of layout.walls) {
    nesters.push({
      outer: { from: wall, to: wall + 1 },
      inner: { from: wall + 1, to: wall + 1 },
      always: true,
    });
  }
  const point = (at: number): Nester => ({
    outer: { from: at, to: at },
    inner: { from: at, to: at },
    always: true,
  });
  // With Track Changes off, the syntax goes outside insertions and substitutions, as typed text does
  // (format §3.10).
  if (planning.tracked) {
    for (const holder of holdersIn(planning, layout)) {
      nesters.push({ outer: holder, inner: holder, edge: true });
    }
  }
  for (const segment of formatSegmentsIn(planning, layout)) {
    nesters.push({ outer: segment, inner: segment, edge: true });
  }
  // Bringing back a deleted block break would part the syntax on either side of it.
  for (const mark of planning.parsed.marks) {
    if (mark.kind !== 'del') continue;
    for (const { open, payload } of mark.segments) {
      if (open.from < layout.range.from || open.from > layout.range.to) continue;
      if (payload?.includes('\n')) nesters.push(point(indexAt(layout, open.to)));
    }
  }
  // Code hides what is in it, the markers as well.
  if (format === 'code') for (const joint of layout.joints) nesters.push(point(joint));
  return nesters;
}

/** A piece that is all of the text of a format or a link goes around its syntax. It stays in what
 * holds it. */
function aroundSyntax(layout: Layout, start: Piece, nesters: readonly Nester[]): Piece {
  let piece = start;
  const walls = nesters.filter((nester) => nester.always || nester.edge);
  const inside = (p: Piece, { inner }: Nester) => inner.from <= p.from && p.to <= inner.to;
  const fits = (wider: Piece) =>
    !walls.some((wall) => crosses(wider, wall) || (inside(piece, wall) && !inside(wider, wall)));
  for (let changed = true; changed;) {
    changed = false;
    for (const { outer, inner, always, edge } of nesters) {
      if (always || edge) continue;
      const text = trimmed(layout, inner);
      if (text?.from !== piece.from || text.to !== piece.to || !fits(outer)) continue;
      piece = outer;
      changed = true;
      break;
    }
  }
  return piece;
}

/** Where the opener of a piece goes, after looking at the places of both markers. Only the markers
 * of a mark that the piece gets are looked at. */
/** A mark whose decisions change the text, and so the lines it stands on. */
const isTextChange = (mark: MarkRange) =>
  mark.kind === 'ins' || mark.kind === 'del' || mark.kind === 'sub' || mark.kind === 'split';

function markerPlaces(planning: Planning, layout: Layout, from: number, to: number): number {
  const { text, hidden } = planning;
  if (layout.bareRow) throw refused(BARE_ROW);
  const check = (place: Place) => {
    // What a marker does to the delimiters next to it comes out in the last check of the change.
    if (place.kind === 'refuse') throw refused(place.reason);
    if (place.kind === 'construct') throw refused(FLANK);
  };
  const a = startOf(layout, from);
  check(inspectPlace(text, hidden, a));
  // A task item's box is text: an opener alone after it is in its paragraph, and another opener
  // alone on a line under it would end that paragraph, and the box with it.
  const carried = hidden.find((m) => m.role === 'open' && m.segment?.carrier?.to === a);
  if (carried && /\[[ xX]\][ \t]*$/.test(text.slice(lineStart(text, carried.from), carried.from))) {
    throw refused(BOX_START);
  }
  let opener = a;
  const kind = lineStartKind(text, a, hidden);
  // An opener alone on its line, with a blank line after it, is for a block that starts there in
  // every decision: where rejecting the pending changes makes the line go on from the one above,
  // it would end that paragraph.
  if (kind === 'block' && planning.parsed.marks.some(isTextChange)) {
    planning.original ??= originalViewOfText(text);
    const { text: original, map } = planning.original;
    if (lineStartKind(original, map.fromSource(a), []) === 'continuation') {
      throw refused(NEAR_PENDING);
    }
  }
  if (kind === 'continuation') {
    // The marker can't start the line: it goes at the end of the one before, with the line break
    // in the mark (format §3.2).
    opener = breakStart(text, a);
    if (hidden.some((m) => m.role === 'open' && m.mark?.kind === 'split' && m.to === opener)) {
      throw refused('Text can not start the line after a line break that someone inserted yet.');
    }
    // A line of nothing but syntax takes no marker, and a bullet with no text is such a line.
    check(inspectPlace(text, hidden, opener));
    if (/^[ \t>]*[-*+][ \t]*$/.test(text.slice(lineStart(text, opener), opener))) {
      throw refused(FLANK);
    }
  }
  check(inspectPlace(text, hidden, endOf(layout, to), { joined: true }));
  const { v, roles } = layout;
  // A marker never cuts a run of delimiters in two (format §3.1). Syntax that a format reads stays
  // as it is read, and the last check of the change looks at that.
  for (const at of [from, to]) {
    const c = v[at];
    const inRun =
      (c === '*' || c === '_' || c === '~') && v[at - 1] === c && !layout.joints.has(at);
    if (inRun && (roles[at] === TEXT || roles[at - 1] === TEXT)) throw refused(FLANK);
  }
  // Never next to a `_` that has a letter or a digit on its other side (format §3.1, rule 5).
  const none = new Set<number>();
  const outerBefore = v[from - 1] === '_' && roles[from - 1] !== SYNTAX;
  const outerAfter = v[to] === '_' && roles[to] !== SYNTAX;
  if (
    (outerBefore && isWord(charBefore(v, from - 1, none))) ||
    (outerAfter && isWord(charAfter(v, to + 1, none)))
  ) {
    throw refused(FLANK);
  }
  return opener;
}

/** The innermost insertion or substitution that all of a piece is in. */
function holderOf(holders: readonly Holder[], piece: Piece): Holder | undefined {
  return holders
    .filter((holder) => holder.from <= piece.from && piece.to <= holder.to)
    .toSorted((a, b) => a.to - a.from - (b.to - b.from))[0];
}

/**
 * Whether the brackets of a piece that are text could be read otherwise once it has syntax around
 * it: one cut off from its pair can pair with what comes next, what looks like a link with an address
 * that can't be one is read as a link by some, and a new link can't hold a bracket at all.
 */
function bracketsInTheWay(layout: Layout, piece: Piece, inLink: boolean): boolean {
  let depth = 0;
  for (let i = piece.from; i < piece.to; i++) {
    const c = layout.v[i];
    if (c !== '[' && c !== ']') continue;
    if (layout.roles[i] !== TEXT || layout.hits.some((h) => h.from <= i && i < h.to && !h.text)) {
      continue;
    }
    if (inLink) return true;
    depth += c === '[' ? 1 : -1;
    if (depth < 0 || (c === ']' && (layout.v[i + 1] === '(' || layout.v[i + 1] === '['))) {
      return true;
    }
  }
  return depth !== 0;
}

/** The step that writes syntax around a piece. */
function wrapStep(
  planning: Planning,
  layout: Layout,
  holders: readonly Holder[],
  piece: Piece,
  left: string,
  right: string,
  op: string,
): Step {
  if (bracketsInTheWay(layout, piece, left === '[')) throw refused(READS_OTHERWISE);
  const a = startOf(layout, piece.from);
  const b = endOf(layout, piece.to);
  const holder = planning.tracked ? holderOf(holders, piece) : undefined;
  // With Track Changes off, syntax typed in the middle of an insertion would split it. Its second
  // part has no decisions of the first, so nothing can be shown of what either would leave.
  if (!planning.tracked) {
    const inMiddle = (index: number) => holders.some((h) => h.from < index && index < h.to);
    if (inMiddle(piece.from) || inMiddle(piece.to)) throw refused(HOLDER_UNTRACKED);
  }
  if (!planning.tracked || holder?.own) {
    const step: Step = { kind: 'wrap', at: a, a, b, opener: a, left, right, op };
    if (holder) step.own = holder.mark.id;
    return step;
  }
  const opener = markerPlaces(planning, layout, piece.from, piece.to);
  return { kind: 'wrap', at: a, a, b, opener, left, right, op };
}

function inTheWay(planning: Planning, mark: MarkRange): EditError {
  const name = nameOf(planning.parsed, mark, planning.author);
  return refused(
    `Formatting can't be changed here until ${name} is decided. Accept or reject it first.`,
  );
}

/** An address as a link's destination is written. In a table, an unescaped `|` would end the cell. */
function writtenUrl(url: string, layout: Layout): string {
  const written = /[\s()<>]/.test(url) ? `<${url.replace(/[<>\\]/g, '\\$&')}>` : url;
  return layout.walls.length > 0 ? written.replaceAll('|', '\\|') : written;
}

function assertWritableUrl(url: string): void {
  assertNoMarkup(url);
  if (/<!--|-->|[\r\n]/.test(url)) {
    throw new EditError("This address can't be written in a link.", 'markup');
  }
}

/** The step that takes back one operation of a format change of the author's own. */
function cancelStep(planning: Planning, layout: Layout, seg: FormatSegment, index: number): Step {
  const rest = seg.ops.filter((_, i) => i !== index);
  const op = seg.ops[index];
  return {
    kind: 'edit',
    at: startOf(layout, seg.from),
    changes: segmentChanges(planning, seg.mark, seg.segment, op ? [op] : [], rest),
    id: seg.mark.id,
    kept: rest.length > 0,
  };
}

function refuseInCode(layout: Layout, clamp: Piece): void {
  for (const span of layout.spans) {
    if (span.format !== 'code') continue;
    if (span.open.to <= clamp.from && clamp.to <= span.close.from) {
      throw new EditError(IN_CODE_SPAN, 'inside-code');
    }
  }
}

function refuseInComment(layout: Layout, clamp: Piece): void {
  for (const hit of layout.hits) {
    if (hit.kind === 'comment' && hit.from < clamp.from && clamp.to < hit.to) {
      throw new EditError(IN_VERBATIM, 'inside-code');
    }
  }
}

/** Formats that are off in `clamp` turned on: what has it already is left out. */
function planOn(planning: Planning, layout: Layout, clamp: Piece, format: InlineFormat): Step[] {
  if (format !== 'code') refuseInCode(layout, clamp);
  refuseInComment(layout, clamp);
  const start = trimmed(layout, clamp);
  if (!start) return [];
  const steps: Step[] = [];
  const skip: Range[] = [];
  for (const { format: other, open, close } of layout.spans) {
    if (other === format) skip.push({ from: open.from, to: close.to });
  }
  for (const seg of formatSegmentsIn(planning, layout)) {
    if (!overlaps(seg, start)) continue;
    const index = seg.ops.findIndex((op) => op.name === format && op.sign === '-');
    if (index === -1) continue;
    if (!seg.own) throw inTheWay(planning, seg.mark);
    steps.push(cancelStep(planning, layout, seg, index));
    skip.push(seg);
  }
  const nesters = nestersFor(planning, layout, format);
  const holders = holdersIn(planning, layout);
  for (const free of without(overAtoms(layout, start), skip)) {
    for (const cut of nested(layout, free, nesters)) {
      const piece = aroundSyntax(layout, cut, nesters);
      const [left, right] = syntaxFor(format, layout.v.slice(piece.from, piece.to));
      steps.push(wrapStep(planning, layout, holders, piece, left, right, `+${format}`));
    }
  }
  return steps;
}

/** The syntax around text of a format. Code takes more backticks than the text has in a row, and a
 * space inside them next to a backtick. */
function syntaxFor(format: InlineFormat, text: string): [string, string] {
  if (format !== 'code') return [DELIMITER[format], DELIMITER[format]];
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const run = '`'.repeat(longest + 1);
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
  return [run + pad, pad + run];
}

/** Spans that stand directly one inside the other, written as one removal. */
interface Stack {
  spans: Span[];
  depth: number;
}

/** The spans in stacks, from outside in, with how many other stacks are around each. */
function stacksOf(layout: Layout, spans: readonly Span[]): Stack[] {
  const stacks: Stack[] = [];
  for (const span of spans.toSorted(
    (a, b) => a.open.from - b.open.from || b.close.to - a.close.to,
  )) {
    const on = stacks.find((stack) => {
      const inner = stack.spans.at(-1);
      return (
        inner &&
        inner.open.to === span.open.from &&
        inner.close.from === span.close.to &&
        !layout.joints.has(span.open.from) &&
        !layout.joints.has(span.close.to)
      );
    });
    if (on) on.spans.push(span);
    else stacks.push({ spans: [span], depth: 0 });
  }
  for (const stack of stacks) {
    const [outer] = stack.spans;
    if (!outer) continue;
    stack.depth = stacks.filter((other) => {
      const around = other.spans[0];
      return (
        around &&
        other !== stack &&
        around.open.from <= outer.open.from &&
        outer.close.to <= around.close.to
      );
    }).length;
  }
  return stacks;
}

/** Formats in `clamp` turned off: all of the run of each that it touches. */
function planOff(
  planning: Planning,
  layout: Layout,
  clamp: Piece,
  formats: readonly InlineFormat[],
  clearing: boolean,
): Step[] {
  if (!formats.includes('code')) refuseInCode(layout, clamp);
  refuseInComment(layout, clamp);
  const start = trimmed(layout, clamp);
  if (!start) return [];
  const steps: Step[] = [];
  const segments = formatSegmentsIn(planning, layout);
  const free: Span[] = [];
  for (const span of layout.spans) {
    if (!formats.includes(span.format)) continue;
    if (!overlaps({ from: span.open.to, to: span.close.from }, start)) continue;
    // Clearing leaves code that holds Markdown: without the backticks, the words would change.
    if (clearing && span.format === 'code') {
      if (/[\\*_~`<[&]/.test(layout.v.slice(span.open.to, span.close.from))) continue;
    }
    const pending = segments.find(
      (seg) =>
        seg.from <= span.open.from &&
        span.close.to <= seg.to &&
        seg.ops.some((op) => op.name === span.format && op.sign === '+'),
    );
    if (!pending) {
      free.push(span);
      continue;
    }
    if (!pending.own) throw inTheWay(planning, pending.mark);
    const index = pending.ops.findIndex((op) => op.name === span.format && op.sign === '+');
    steps.push(cancelStep(planning, layout, pending, index));
  }
  const holders = planning.tracked ? holdersIn(planning, layout) : [];
  for (const { spans, depth } of stacksOf(layout, free)) {
    const outer = spans[0];
    const inner = spans.at(-1);
    if (!outer || !inner) continue;
    const side = (index: number) =>
      holders.filter((holder) => holder.from <= index && index <= holder.to);
    const before = side(outer.open.to);
    const after = side(outer.close.from);
    if (before.length !== after.length || before.some((holder, i) => holder !== after[i])) {
      throw refused(STRADDLES);
    }
    const all: Piece = { from: outer.open.from, to: outer.close.to };
    const holder = holderOf(holders, all);
    const opens = inFile(layout, { from: outer.open.from, to: inner.open.to });
    const closes = inFile(layout, { from: inner.close.from, to: outer.close.to });
    const op = spans
      .map((s) => removedOp(s.format, layout.v.slice(s.open.from, s.open.to)))
      .join(' ');
    if (!planning.tracked || holder?.own) {
      const step: Step = {
        kind: 'unwrap',
        at: opens.from,
        opens,
        closes,
        opener: opens.from,
        op,
        depth,
      };
      if (holder) step.own = holder.mark.id;
      steps.push(step);
    } else {
      const opener = markerPlaces(planning, layout, all.from, all.to);
      steps.push({ kind: 'unwrap', at: opens.from, opens, closes, opener, op, depth });
    }
  }
  return steps;
}

/** A link of a format change of the author's own, changed in place. */
function ownLinkStep(
  planning: Planning,
  layout: Layout,
  seg: FormatSegment,
  index: number,
  url: string | null,
): Step | undefined {
  const op = seg.ops[index];
  if (!op) return undefined;
  const at = startOf(layout, seg.from);
  const id = seg.mark.id;
  const rest = seg.ops.filter((_, i) => i !== index);
  const replaced = (source: string, changes: TextChange[]): Step => {
    const payload = [...rest.map((other) => other.source), source].join(' ');
    const written = `<!--fmt ${id} ${payload}-->`;
    return {
      kind: 'edit',
      at,
      changes: [{ ...seg.segment.open, insert: written }, ...changes],
      id,
      kept: true,
    };
  };
  const link = layout.links.find((l) => l.inline && l.from >= seg.from && l.to <= seg.to);
  // A link that was there before, whose address was changed or removed.
  if (op.sign === '-') {
    if (url === null) return undefined;
    if (url === op.value) return cancelStep(planning, layout, seg, index);
    // The address it had, and what stood after it stays after the new one.
    const old = op.value ?? '';
    const lead = urlIn(old, {
      from: 0,
      to: old.length,
      text: { from: 0, to: 0 },
      dest: { from: 0, to: old.length },
      inline: true,
    });
    const after = old.slice(lead.to);
    const start = seg.segment.carrier?.to ?? seg.segment.content.from;
    return replaced(`link=${encodeValue(old.slice(lead.from, lead.to))}`, [
      { from: start, to: start, insert: '[' },
      {
        from: seg.segment.content.to,
        to: seg.segment.content.to,
        insert: `](${writtenUrl(url, layout)}${after})`,
      },
    ]);
  }
  if (!link) throw refused(LOST_SYNTAX);
  const place = urlIn(layout.v, link);
  if (url === null) {
    if (op.sign === '+') return cancelStep(planning, layout, seg, index);
    // The title it has is the one it had.
    const old = op.value ?? '';
    const after = layout.v.slice(place.to, link.dest.to);
    return replaced(`-link=${encodeValue(old + after)}`, [
      { from: startOf(layout, link.from), to: endOf(layout, link.text.from), insert: '' },
      { from: startOf(layout, link.text.to), to: endOf(layout, link.to), insert: '' },
    ]);
  }
  const insert = writtenUrl(url, layout);
  if (op.sign === '' && (url === op.value || insert === op.value)) {
    return cancelStep(planning, layout, seg, index);
  }
  if (insert === layout.v.slice(place.from, place.to)) return undefined;
  return { kind: 'edit', at, changes: [{ ...inFile(layout, place), insert }], id, kept: true };
}

function planLink(planning: Planning, layout: Layout, clamp: Piece, url: string | null): Step[] {
  refuseInCode(layout, clamp);
  refuseInComment(layout, clamp);
  const start = trimmed(layout, clamp);
  if (!start) return [];
  // A link can't hold a reference, which is a link, and the address of one is not in its text.
  for (const hit of layout.hits) {
    const isReference = hit.kind === 'reference' || hit.kind === 'footnote';
    if (isReference && overlaps(hit, start)) throw refused(REFERENCE);
  }
  const steps: Step[] = [];
  const skip: Range[] = [];
  for (const seg of formatSegmentsIn(planning, layout)) {
    if (!overlaps(seg, start)) continue;
    const index = seg.ops.findIndex((op) => op.name === 'link');
    if (index === -1) continue;
    if (!seg.own) throw inTheWay(planning, seg.mark);
    const step = ownLinkStep(planning, layout, seg, index, url);
    if (step) steps.push(step);
    skip.push(seg);
  }
  for (const link of layout.links) {
    if (skip.some((range) => overlaps(range, link))) continue;
    if (!overlaps(link.text, start)) continue;
    if (!link.inline) throw refused(REFERENCE);
    skip.push(link);
    const place = urlIn(layout.v, link);
    const old = layout.v.slice(place.from, place.to);
    const all = { from: link.from, to: link.to };
    const outer = inFile(layout, all);
    const around = holderOf(holdersIn(planning, layout), all);
    if (!planning.tracked && url !== null && around) throw refused(HOLDER_UNTRACKED);
    const holder = planning.tracked ? around : undefined;
    const direct = !planning.tracked || holder?.own === true;
    const opener = direct ? outer.from : markerPlaces(planning, layout, all.from, all.to);
    if (url === null) {
      const dest = layout.v.slice(link.dest.from, link.dest.to);
      const step: Step = {
        kind: 'unwrap',
        at: outer.from,
        opens: inFile(layout, { from: link.from, to: link.text.from }),
        closes: inFile(layout, { from: link.text.to, to: link.to }),
        opener,
        op: `-link=${encodeValue(dest)}`,
        depth: 0,
      };
      if (holder?.own) step.own = holder.mark.id;
      steps.push(step);
    } else {
      const insert = writtenUrl(url, layout);
      if (insert === old) continue;
      const address = inFile(layout, place);
      if (holder?.own) {
        const changes = [{ ...address, insert }];
        steps.push({ kind: 'edit', at: outer.from, changes, id: holder.mark.id, kept: true });
      } else {
        steps.push({
          kind: 'relink',
          at: outer.from,
          outer,
          opener,
          url: address,
          insert,
          op: `link=${encodeValue(old)}`,
        });
      }
    }
  }
  if (url !== null) {
    // A link can't hold a link, and an autolink is one.
    for (const hit of layout.hits) if (hit.kind === 'autolink') skip.push(hit);
    const nesters = nestersFor(planning, layout);
    const holders = holdersIn(planning, layout);
    const right = `](${writtenUrl(url, layout)})`;
    for (const free of without(overAtoms(layout, start), skip)) {
      for (const cut of nested(layout, free, nesters)) {
        const piece = aroundSyntax(layout, cut, nesters);
        steps.push(wrapStep(planning, layout, holders, piece, '[', right, '+link'));
      }
    }
  }
  return steps;
}

function planParagraph(planning: Planning, layout: Layout, clamp: Piece, op: FormatOp): Step[] {
  switch (op.kind) {
    case 'inline':
      return op.on
        ? planOn(planning, layout, clamp, op.format)
        : planOff(planning, layout, clamp, [op.format], false);
    case 'clear':
      return planOff(planning, layout, clamp, INLINE_FORMATS, true);
    case 'link':
      return planLink(planning, layout, clamp, op.url);
    default:
      throw new EditError('This format change is not supported yet.', 'not-supported');
  }
}

/** What a change does in one paragraph, and the region it is tried on: the block the paragraph is
 * in, with the ones its marks join it to. `typing` is set when all of it is in an insertion of the
 * author's own, where its syntax is written as typed text is. */
interface Block {
  steps: Step[];
  region: Range;
  typing: boolean;
}

/** What a change does, block by block. */
interface Plan {
  planning: Planning;
  blocks: Block[];
}

/** The kinds of mark whose decisions change the text. Comments and highlights change none. */
const CHANGE_KINDS: ReadonlySet<string> = new Set(['ins', 'del', 'sub', 'fmt', 'split']);

/** Where the lines of openers in front of `position`'s line start: markers alone on their lines, in
 * front of the first line of a block (format §3.3). */
function withOpenerLines(reader: FormatReader, position: number): number {
  const { text, hidden } = reader;
  let start = lineStart(text, position);
  for (let lines = 0; lines < LINES_ABOVE && start > 0; lines++) {
    const above = lineStart(text, start - 1);
    const shown = visible(text, hidden, above, lineEnd(text, above)).text;
    if (!/^[ \t>]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]*)?\r?$/.test(shown)) break;
    start = above;
  }
  while (start < position && text.slice(start, lineEnd(text, start)).trim() === '') {
    start = text.indexOf('\n', start) + 1;
  }
  return Math.min(start, position);
}

/** The parts of the file that the segments of its marks take up. */
function spansOf(reader: FormatReader, parsed: Parsed): Range[] {
  return parsed.marks.flatMap((mark) =>
    mark.segments.map((segment) => segmentSpan(mark, segment, reader)),
  );
}

/** `range`, grown by `grow` and by the marks that reach into it until neither adds to it. */
function closed(range: Range, spans: readonly Range[], grow: (range: Range) => Range): Range {
  let { from, to } = range;
  for (;;) {
    let a = from;
    let b = to;
    for (const span of spans) {
      if (span.from > b || span.to < a) continue;
      a = Math.min(a, span.from);
      b = Math.max(b, span.to);
    }
    const grown = grow({ from: a, to: b });
    a = Math.min(a, grown.from);
    b = Math.max(b, grown.to);
    if (a === from && b === to) return { from, to };
    from = a;
    to = b;
  }
}

/**
 * A paragraph with the lines of the openers in front of it, and every paragraph that a mark in it
 * reaches into: rejecting an insertion with a break in it, or a split, joins two paragraphs. This is
 * where another person's pending change is in the way of a change (format §2.6).
 */
function paragraphRegion(reader: FormatReader, spans: readonly Range[], paragraph: Range): Range {
  const { text, hidden } = reader;
  const around = (position: number) => {
    const shown = visible(text, hidden, lineStart(text, position), lineEnd(text, position)).text;
    return /^[ \t>]*\r?$/.test(shown)
      ? { from: position, to: position }
      : paragraphRange(text, hidden, position);
  };
  const start = { ...paragraph, from: withOpenerLines(reader, paragraph.from) };
  return closed(start, spans, ({ from, to }) => ({
    from: withOpenerLines(reader, Math.min(from, around(from).from)),
    to: Math.max(to, around(to).to),
  }));
}

/** The first line of a list item, after the markers of block quotes. */
const ITEM_LINE = /^(?:[ \t]{0,3}>[ \t]?)*[ \t]*(?:[-*+]|\d{1,9}[.)])(?:[ \t]|\r?$)/;

/**
 * The whole block around `range`: the list it is in, from its first item to its last, the table,
 * the block quote, or the paragraph by itself, with the code blocks and comments it reaches into.
 * Without the rest of its block a line can read otherwise: indented by four spaces, out of its
 * list, it is code, and a row without the rows above it is no row of a table. A list goes on over
 * blank lines while the line after them is indented or another item. `limit` is where the body ends.
 */
function blockAround(reader: FormatReader, range: Range, limit: number): Range {
  const { text, verbatim } = reader;
  const line = (start: number) => text.slice(start, lineEnd(text, start));
  const blank = (start: number) => line(start).trim() === '';
  const next = (start: number) => {
    const newline = text.indexOf('\n', start);
    return newline === -1 || newline + 1 >= limit ? undefined : newline + 1;
  };
  const goesOn = (start: number) => /^[ \t]/.test(line(start)) || ITEM_LINE.test(line(start));
  // The first and last lines of the run of lines that are not blank around a position.
  const top = (position: number) => {
    let start = lineStart(text, position);
    while (start > 0 && !blank(lineStart(text, start - 1))) start = lineStart(text, start - 1);
    return start;
  };
  const bottom = (position: number) => {
    let start = lineStart(text, position);
    for (let after = next(start); after !== undefined && !blank(after); after = next(after)) {
      start = after;
    }
    return start;
  };
  const inList = (from: number, last: number) => {
    for (let at: number | undefined = from; at !== undefined && at <= last; at = next(at)) {
      if (ITEM_LINE.test(line(at))) return true;
    }
    return false;
  };
  let from = top(range.from);
  let last = bottom(range.to);
  let list = inList(from, last);
  for (;;) {
    const start = from;
    const end = last;
    // A run that goes on from the one above, in a list, joins it.
    while (goesOn(from)) {
      let above = from;
      while (above > 0 && blank(lineStart(text, above - 1))) above = lineStart(text, above - 1);
      if (above === 0) break;
      const run = top(above - 1);
      const listed = inList(run, lineStart(text, above - 1));
      if (!listed && !/^[ \t]/.test(line(run))) break;
      list ||= listed;
      from = run;
    }
    // And the runs below that go on from a list.
    while (list) {
      let below = next(last);
      while (below !== undefined && blank(below)) below = next(below);
      if (below === undefined || !goesOn(below)) break;
      last = bottom(below);
    }
    for (const v of verbatim) {
      if (v.from >= limit || v.from > lineEnd(text, last) || v.to < from) continue;
      from = Math.min(from, top(v.from));
      last = Math.max(last, bottom(Math.max(v.from, Math.min(v.to, limit) - 1)));
    }
    if (from === start && last === end) break;
    list ||= inList(from, last);
  }
  return { from, to: lineEnd(text, last) };
}

/** The region of a change in `paragraph`: the whole block around it, and every block that a mark in
 * it reaches into. What a change does there can be read in this stretch alone. */
function blockRegion(
  reader: FormatReader,
  spans: readonly Range[],
  paragraph: Range,
  limit: number,
): Range {
  return closed(paragraph, spans, (range) => blockAround(reader, range, limit));
}

/**
 * Where a link reference definition that starts at `start` of `s` ends, past its line break, as
 * CommonMark reads one: a label, a colon, an address (in angle brackets, or with no space in it),
 * and a title in quotes or parentheses if there is one, each part on its line or the next, and
 * nothing after it on its line. A footnote definition is its first line. Undefined where none is.
 */
function definitionAt(s: string, start: number): number | undefined {
  let i = start;
  const lineAfter = (at: number) => {
    const newline = s.indexOf('\n', at);
    return newline === -1 ? s.length : newline + 1;
  };
  const endsLine = (at: number) => /^[ \t]*(?:\n|$)/.test(s.slice(at));
  /** Spaces, and one line break among them; whether there were any. */
  const gap = () => {
    const from = i;
    while (s[i] === ' ' || s[i] === '\t') i++;
    if (s[i] === '\n') {
      i++;
      while (s[i] === ' ' || s[i] === '\t') i++;
    }
    return i > from;
  };
  if (s[i] !== '[') return undefined;
  if (s[i + 1] === '^') return /^\[\^[^\]\s]+\]:/.test(s.slice(i)) ? lineAfter(i) : undefined;
  const label = /^\[((?:[^[\]\\]|\\.){1,999})\]:/.exec(s.slice(i));
  if (!label || (label[1] ?? '').trim() === '') return undefined;
  i += label[0].length;
  gap();
  const address = i;
  if (s[i] === '<') {
    for (i++; i < s.length && s[i] !== '>'; i += s[i] === '\\' ? 2 : 1) {
      if (s[i] === '\n' || s[i] === '<') return undefined;
    }
    if (s[i] !== '>') return undefined;
    i++;
  } else {
    let depth = 0;
    // No space and no control character.
    for (; i < s.length && s.charCodeAt(i) > 0x20 && s.charCodeAt(i) !== 0x7f; i++) {
      if (s[i] === '\\') i++;
      else if (s[i] === '(') depth++;
      else if (s[i] === ')' && depth-- === 0) break;
    }
    if (i === address || depth > 0) return undefined;
  }
  const end = i;
  if (gap()) {
    const close = { '"': '"', "'": "'", '(': ')' }[s[i] ?? ''];
    if (close !== undefined) {
      let j = i + 1;
      for (; j < s.length && s[j] !== close; j += s[j] === '\\' ? 2 : 1) {
        if (close === ')' && s[j] === '(') break;
        if (s[j] === '\n' && endsLine(j + 1)) break;
      }
      if (s[j] === close && endsLine(j + 1)) return lineAfter(j + 1);
    }
  }
  // With no title, or one with more after it, the address ends the definition, and its line.
  return endsLine(end) ? lineAfter(end) : undefined;
}

/** The lines of the paragraph that are link reference or footnote definitions: they stand at its
 * start, one after another, and CommonMark reads the rest as a paragraph. Undefined when none is. */
function definitionLines(reader: FormatReader, paragraph: Range): Range | undefined {
  const { text, hidden } = reader;
  const starts: number[] = [];
  let joined = '';
  for (let at = paragraph.from; at <= paragraph.to;) {
    const shown = visible(text, hidden, at, lineEnd(text, at)).text;
    const prefix =
      starts.length === 0
        ? prefixLength(shown)
        : (/^(?:[ \t]*>)*[ \t]*/.exec(shown)?.[0].length ?? 0);
    starts.push(at);
    joined += `${shown.slice(prefix)}\n`;
    const newline = text.indexOf('\n', at);
    if (newline === -1) break;
    at = newline + 1;
  }
  let consumed = 0;
  for (let next = definitionAt(joined, 0); next !== undefined; next = definitionAt(joined, next)) {
    consumed = next;
  }
  if (consumed === 0) return undefined;
  const lines = joined.slice(0, consumed).split('\n').length - 1;
  const last = starts[lines - 1] ?? paragraph.from;
  return { from: paragraph.from, to: lineEnd(text, last) };
}

/** Whether `[from, to]` of `text` is on a line of a definition in the original view, every pending
 * change rejected. */
function definedBefore(text: string, from: number, to: number): boolean {
  const original = originalViewOfText(text);
  const a = original.map.fromSource(from);
  const b = original.map.fromSource(to);
  const reader = formatReader(original.text, parse(original.text));
  return paragraphsIn(reader, a, b).some((paragraph) => {
    const lines = definitionLines(reader, paragraph);
    return lines !== undefined && a <= lines.to && lines.from <= b;
  });
}

/** Whether another person's pending change, whose decisions could leave the syntax reading
 * otherwise, is in `range` (format §2.6). */
function othersIn(planning: Planning, range: Range): boolean {
  return planning.parsed.marks.some(
    (mark) =>
      CHANGE_KINDS.has(mark.kind) &&
      mark.entry.by !== planning.owner &&
      mark.segments.some((segment) => {
        const span = segmentSpan(mark, segment, planning);
        return span.from <= range.to && range.from <= span.to;
      }),
  );
}

function planFormat(
  text: string,
  range: Range,
  op: FormatOp,
  tracked: boolean,
  author: Person | undefined,
): Plan {
  if (range.from < 0 || range.to < range.from || range.to > text.length) {
    throw new RangeError(
      `The range ${range.from}-${range.to} is out of order or outside the text (${text.length} characters)`,
    );
  }
  if (op.kind === 'link' && op.url !== null) assertWritableUrl(op.url);
  const parsed = parse(text);
  const planning: Planning = {
    ...formatReader(text, parsed),
    parsed,
    me: tracked ? author?.handle : undefined,
    owner: author?.handle,
    author,
    tracked,
  };
  const limit = parsed.ledgerRange?.from ?? text.length;
  const to = Math.min(limit, snapOut(planning.hidden, range.to, false));
  let from = Math.min(to, snapOut(planning.hidden, range.from, true));
  const blocks: Block[] = [];
  // A block format change applies to the block the cursor is in.
  const forBlocks = isBlockOp(op);
  if (from > to || (from === to && !forBlocks)) return { planning, blocks };
  const front = frontMatterEnd(text);
  if (front >= 0 && from <= front) {
    if (to <= front) throw new EditError("Front matter can't be formatted.", 'front-matter');
    from = front + 1;
  }
  let inVerbatim = false;
  let elsewhere = false;
  const spans = spansOf(planning, parsed);
  let block: Range | undefined;
  /** The end of the last block that a block change took, with the lines under it. */
  let taken = -1;
  for (const paragraph of paragraphsIn(planning, from, to)) {
    // A cursor is in the block it touches; a range takes the blocks it holds text of, as an inline
    // change does, and not the block it ends at the start of.
    const outside =
      forBlocks && from === to
        ? paragraph.to < from || paragraph.from > to
        : paragraph.to <= from || paragraph.from >= to;
    if (outside) continue;
    if (isRawParagraph(planning, paragraph)) {
      inVerbatim = true;
      continue;
    }
    elsewhere = true;
    // A definition is not text: formatting would leave the links it defines with none (format §2.6).
    const defined = definitionLines(planning, paragraph);
    if (defined && from <= defined.to && defined.from <= to) throw refused(DEFINES);
    // Nor once the pending changes in it are rejected, which can make a line a definition again.
    if (
      parsed.marks.some((mark) =>
        mark.segments.some(
          (g) => g.open.from <= paragraph.to && paragraph.from <= (g.close ?? g.open).to,
        ),
      )
    ) {
      if (definedBefore(text, Math.max(from, paragraph.from), Math.min(to, paragraph.to))) {
        throw refused(DEFINES);
      }
    }
    if (forBlocks) {
      if (paragraph.from <= taken) continue;
      // Another person's change in a block that the change leaves as it is, as a box that is
      // checked already, is not in the way.
      const near = paragraphRegion(planning, spans, paragraph);
      const others = othersIn(planning, near);
      let plan;
      try {
        if (parsed.marks.some(isTextChange)) {
          planning.original ??= originalViewOfText(text);
          planning.newest ??= newestView(text);
        }
        plan = planBlock(planning, paragraph, op, tracked, { from, to });
      } catch (error) {
        throw others ? refused(IN_PARAGRAPH) : error;
      }
      if (!plan) continue;
      if (others || othersIn(planning, plan.extent)) throw refused(IN_PARAGRAPH);
      taken = plan.extent.to;
      const lines = {
        from: Math.min(near.from, plan.extent.from),
        to: Math.max(near.to, plan.extent.to),
      };
      const step: Step =
        plan.kind === 'mark'
          ? { kind: 'block', at: plan.at, write: plan.write }
          : { kind: 'edit', at: plan.at, changes: plan.changes, id: plan.id, kept: plan.kept };
      if (!block || lines.from < block.from || lines.to > block.to) {
        block = blockRegion(planning, spans, lines, limit);
      }
      blocks.push({ steps: [step], region: block, typing: false });
      continue;
    }
    const layout = readLayout(planning, paragraph);
    const clamp = {
      from: indexAt(layout, Math.max(from, paragraph.from)),
      to: indexAt(layout, Math.min(to, paragraph.to)),
    };
    if (clamp.from >= clamp.to) continue;
    // Text all of which is in an insertion of the author's own takes the syntax as typed text.
    const piece = trimmed(layout, clamp);
    const holder = piece && tracked ? holderOf(holdersIn(planning, layout), piece) : undefined;
    const typing = holder?.own === true;
    // Another person's pending change in the paragraph, whose decisions could leave the syntax
    // reading otherwise, is decided first (format §2.6).
    const near = paragraphRegion(planning, spans, paragraph);
    if (othersIn(planning, near) && !typing) throw refused(IN_PARAGRAPH);
    // The paragraphs of a block share its region, which is found once.
    if (!block || near.from < block.from || near.to > block.to) {
      block = blockRegion(planning, spans, near, limit);
    }
    const region = block;
    const steps = planParagraph(planning, layout, clamp, op);
    if (steps.length > 0)
      blocks.push({ steps: steps.toSorted((a, b) => a.at - b.at), region, typing });
  }
  if (inVerbatim && !elsewhere) throw new EditError(IN_VERBATIM, 'inside-code');
  return { planning, blocks };
}

/** The body of a file without the line breaks that end it. */
function bodyWithoutEnd(text: string, parsed: Parsed = parse(text)): string {
  const range = parsed.ledgerRange;
  return (range ? text.slice(0, range.from) : text).replace(/[\r\n]+$/, '');
}

/** The message of a change that came out other than it should. */
const SELF_CHECK =
  "This format change can't be written here without altering other text. Make it on less text, or decide the changes next to it first.";

const NEAR_PENDING =
  "This formatting can't be written next to these pending changes: deciding them could leave stray syntax. Accept or reject them first.";

/** How many decisions may be tried in one region, which bounds the work of a change: every order of
 * a new mark and four other marks takes about 850. A decision on a region longer than `TRIAL_SIZE`
 * counts as more than one. */
const TRIALS = 1500;
const TRIAL_SIZE = 1000;

/**
 * Whether two files read as the same words, on both readings of punctuation: a delimiter that opens
 * nothing would be read as text. The files are regions, so all of each is read. 'bytes' when their
 * bodies are the same, 'words' when they only read the same. With `pending`, from its readings, which
 * check the paragraphs of the marks apart as they go (see `pendingOf`).
 */
function sameReading(a: string, b: string, pending?: Pending): 'bytes' | 'words' | undefined {
  const parsedA = pending ? pending.parsedOf(a) : parse(a);
  const parsedB = pending ? pending.parsedOf(b) : parse(b, parsedA);
  if (bodyWithoutEnd(a, parsedA) === bodyWithoutEnd(b, parsedB)) return 'bytes';
  // All of it: a line that did not change can read otherwise for one that did, as the next item
  // of a list does when the first starts with a marker on its own line.
  const alike = pending
    ? pending.piecesOf(a).every(({ whole }, i) => whole === pending.piecesOf(b)[i]?.whole)
    : [isPunctuation, isOlderPunctuation].every(
        (punctuation) =>
          plainBody(a, punctuation, 0, Infinity, parsedA) ===
          plainBody(b, punctuation, 0, Infinity, parsedB),
      );
  return alike ? 'words' : undefined;
}

const readsTheSame = (a: string, b: string, pending?: Pending): boolean =>
  sameReading(a, b, pending) !== undefined;

/** How two states compare: they read the same, they don't, or they do but nothing shows that they
 * still do once the marks left pending are decided. */
type Reading = 'same' | 'otherwise' | 'unsure';

/** A file's reading on one reading of punctuation, in pieces: the plain text of each paragraph of
 * the marks left pending, with its place among them, and of each run of other paragraphs between
 * them; and all of it, as `plainBody` has it. */
interface Pieces {
  pieces: string[];
  whole: string;
}

/** The marks apart from a change that its walks leave pending (format-apart.ts), and what the walks
 * and the check before them read of each file, once: its parse, and its pieces on both readings of
 * punctuation. The walks come back to the same files many times. */
interface Pending {
  ids: readonly string[];
  bracketed: boolean;
  parsedOf: (text: string) => Parsed;
  piecesOf: (text: string) => readonly Pieces[];
}

/** `parse`, which reads each file once, and the ledger of the next from the last one read. */
function parsingOnce(): (text: string) => Parsed {
  const parses = new Map<string, Parsed>();
  let last: Parsed | undefined;
  return (text: string) => {
    let parsed = parses.get(text);
    if (!parsed) {
      parsed = parse(text, last);
      parses.set(text, parsed);
      last = parsed;
    }
    return parsed;
  };
}

/**
 * The readings of a walk that leaves `apart` pending. Reading a state, it also makes sure that each
 * paragraph of the marks apart is the paragraph it was in the file without the change: the same
 * segments of those marks (a highlight's may be missing, as it changes no text and the walk without
 * annotations has none), the same visible text, and no marker of a mark that is tried in it. A
 * decision that moved a boundary, or a repair that wrote into it, would make it otherwise; then
 * nothing shows that deciding the marks apart changes only their paragraph, and the walk tries
 * every mark instead (`TryEveryMark`). No such state is known since a split stands for its break
 * (format-apart.ts): the check is there so that the walk doesn't rest on the argument alone.
 */
function pendingOf(apart: Apart): Pending {
  const ids = [...apart.ids];
  const parsedOf = parsingOnce();
  const owners = new Map<string, number>();
  for (const [index, paragraph] of apart.paragraphs.entries()) {
    for (const segment of paragraph.segments) owners.set(segment, index);
  }
  const changingSegments = apart.paragraphs.reduce((sum, { changing }) => sum + changing, 0);
  const read = new Map<string, Pieces[]>();
  const piecesOf = (text: string) => {
    const known = read.get(text);
    if (known) return known;
    const parsed = parsedOf(text);
    const hidden = markerRanges(parsed);
    // A state with a line that the editor reads as a list item and CommonMark as more of the
    // paragraph above (#139) is walked with every mark, as a region with one is.
    if (holdsMisreadItem(text, hidden, parsed.ledgerRange?.from ?? text.length)) {
      throw new TryEveryMark();
    }
    const paragraphs = plainParagraphs(
      text,
      [isPunctuation, isOlderPunctuation],
      0,
      Infinity,
      parsed,
    );
    const starts = parsed.marks
      .filter((mark) => apart.ids.has(mark.id))
      .flatMap((mark) =>
        mark.segments.map((segment) => ({
          owner: owners.get(segmentName(mark, segment)),
          at: segment.open.from,
          changes: mark.kind !== 'hl',
        })),
      );
    const tried = hidden.filter(
      ({ mark }) => mark !== undefined && mark.kind !== 'cmt' && !apart.ids.has(mark.id),
    );
    // Which paragraph of marks apart each paragraph is, if it is one, checked: it holds segments of
    // that one only, all of those that change the text, the same visible text, and no marker of a
    // mark that is tried.
    const owned = paragraphs.map(({ range }) => {
      const here = starts.filter(({ at }) => range.from <= at && at <= range.to);
      if (here.length === 0) return undefined;
      const [{ owner } = { owner: undefined }] = here;
      const was = owner === undefined ? undefined : apart.paragraphs[owner];
      if (!was || here.some((start) => start.owner !== owner)) throw new TryEveryMark();
      if (here.filter(({ changes }) => changes).length !== was.changing) throw new TryEveryMark();
      if (tried.some((marker) => marker.from <= range.to && range.from < marker.to)) {
        throw new TryEveryMark();
      }
      if (visible(text, hidden, range.from, range.to).text !== was.shown) throw new TryEveryMark();
      return owner;
    });
    // And no segment of those that change the text is missing, or anywhere else.
    const placed = owned.reduce<number>(
      (sum, owner) => sum + (owner === undefined ? 0 : (apart.paragraphs[owner]?.changing ?? 0)),
      0,
    );
    const changing = starts.filter(({ changes }) => changes).length;
    if (placed !== changingSegments || changing !== changingSegments) throw new TryEveryMark();
    const found = [0, 1].map((punctuation) => {
      const pieces: string[] = [];
      let run: string[] = [];
      for (const [i, { plain }] of paragraphs.entries()) {
        const owner = owned[i];
        const words = plain[punctuation] ?? '';
        if (owner === undefined) {
          run.push(words);
          continue;
        }
        pieces.push(squashSpaces(run.join(' ')), `${owner}\u0000${squashSpaces(words)}`);
        run = [];
      }
      pieces.push(squashSpaces(run.join(' ')));
      const whole = squashSpaces(paragraphs.map(({ plain }) => plain[punctuation] ?? '').join(' '));
      return { pieces, whole };
    });
    read.set(text, found);
    return found;
  };
  return { ids, bracketed: apart.bracketed, parsedOf, piecesOf };
}

/**
 * `readsTheSame`, for states in which the marks apart from the change are pending: 'same' only
 * when the two also read the same piece by piece, the paragraphs of those marks one by one and the
 * runs of the other paragraphs between them, and have the same definitions where a paragraph of
 * those marks has a bracket. Then they read the same with those marks decided in any way, as their
 * decisions change their own paragraph alike in both (format-apart.ts). 'unsure' when they read the
 * same all together only.
 *
 * The last two are there in case, as no way to them is known. A paragraph of marks apart has the
 * same visible text in both files, as `pendingOf` makes sure, and reads otherwise in one only if it
 * is read as raw text there, which shows its markers: the whole differs too, unless another
 * paragraph made up for it word for word. And a format change writes no definition, while
 * `regionFile` copies the file's definitions into both files alike.
 */
function readsApart(a: string, b: string, pending: Pending): Reading {
  const same = sameReading(a, b, pending);
  if (same === undefined) return 'otherwise';
  if (same === 'bytes') return 'same';
  const x = pending.piecesOf(a);
  const y = pending.piecesOf(b);
  const alike = x.every((one, i) => {
    const other = y[i]?.pieces ?? [];
    return one.pieces.length === other.length && one.pieces.every((piece, j) => piece === other[j]);
  });
  if (!alike) return 'unsure';
  if (pending.bracketed) {
    const labels = definedLabels(a);
    const others = definedLabels(b);
    if (labels.size !== others.size || [...labels].some((label) => !others.has(label))) {
      return 'unsure';
    }
  }
  return 'same';
}

/** Thrown by a walk that leaves marks apart pending where it can't show that deciding them makes
 * no difference: every mark is tried instead. */
class TryEveryMark extends Error {}

/** Warnings that a decision must not add: marks that don't fit together, and a marker that starts a
 * line. */
const LEFT_WRONG = new Set([
  'unclosed-mark',
  'unopened-close',
  'kind-mismatch',
  'duplicate-id',
  'line-start-marker',
]);

/**
 * What the states of a change are compared with: the file without the change, which each state must
 * read as, and the bytes that rejecting the new marks gives back, when the change also wrote syntax
 * with no mark (in the author's own insertion), or turned back a mark of the author's.
 */
interface Baseline {
  reading: string;
  bytes?: string;
}

/**
 * Tries every order of accepting and rejecting the marks of a region, from `after`, against the same
 * decisions from the baseline. `fresh` are the marks the change wrote, which the baseline does not
 * have. Every state on the way reads as the state it stands for, and once none of `fresh` is left and
 * none of it was accepted, it has the bytes of that state. A decision that works there works here.
 * Every order, and not only one for each combination: a decision can be refused in one order (a
 * backtick that comes back would hide markers) and not in another. No repair is looked for: a change
 * that does not come out is refused, and so is one that makes a decision work that was refused, as
 * nothing shows what that comes to.
 *
 * The marks of `others` that are apart from the change (`pending`) are left pending, unless the walk
 * finds that it can't show them to make no difference, and then they are tried too.
 *
 * @throws EditError when that does not hold, or when there are too many states to try.
 */
function proveDecisions(
  baseline: Baseline,
  after: string,
  fresh: readonly string[],
  others: readonly string[],
  region: RegionSize,
  pending: Pending | undefined,
): void {
  try {
    walkDecisions(baseline, after, fresh, others, region, pending);
  } catch (error) {
    // What reads otherwise with every change accepted is no matter of deciding: the new text is
    // read so, as it would be with Track Changes off.
    if (error instanceof EditError && error.message === NEAR_PENDING) {
      const newest = (text: string) => {
        try {
          return applyChanges(text, acceptAll(text));
        } catch (failed) {
          if (failed instanceof EditError) return undefined;
          throw failed;
        }
      };
      const now = newest(after);
      const then = newest(baseline.reading);
      if (now !== undefined && then !== undefined && !readsTheSame(now, then)) {
        throw refused(READS_OTHERWISE);
      }
    }
    throw error;
  }
}

/** What a region is, for the words of a refusal, and how long it is, which is what a decision on
 * it costs. */
interface RegionSize {
  name: string;
  length: number;
}

/** The walk of `proveDecisions`: with the marks apart left pending, and if that does not show
 * enough, with every mark. */
function walkDecisions(
  baseline: Baseline,
  after: string,
  fresh: readonly string[],
  others: readonly string[],
  region: RegionSize,
  pending: Pending | undefined,
): void {
  const left = new Set(pending?.ids);
  if (pending && others.some((id) => left.has(id))) {
    const tried = others.filter((id) => !left.has(id));
    try {
      walkOrders(baseline, after, fresh, tried, region, pending);
      return;
    } catch (error) {
      if (!(error instanceof TryEveryMark)) throw error;
    }
  }
  walkOrders(baseline, after, fresh, others, region, undefined);
}

/** Every order of the decisions of `fresh` and `others`, with the marks `pending` left as they are. */
function walkOrders(
  baseline: Baseline,
  after: string,
  fresh: readonly string[],
  others: readonly string[],
  region: RegionSize,
  pending: Pending | undefined,
): void {
  let trials = TRIALS;
  // A decision in a long region costs as much as several in a paragraph. The definitions copied
  // in from the rest of the file are not the region's.
  const cost = Math.max(1, region.length / TRIAL_SIZE);
  // Only new marks: the change itself takes too many blocks of one list at once.
  const tooMany = () =>
    refused(
      others.length === 0
        ? 'This changes too many items of one list at once to check them. Change up to five items at a time.'
        : `There are too many pending changes to check this formatting against. Accept or reject some of the changes in this ${region.name} first.`,
    );
  // Every order of n marks is 2·n·3^(n-1) decisions, when all of them work: past the budget, the
  // walk is not begun.
  const marks = fresh.length + others.length;
  if (marks > 0 && 2 * marks * 3 ** (marks - 1) * cost > TRIALS) throw tooMany();
  const known = new Map<string, string | undefined>();
  const attempt = (text: string, id: string, action: 'accept' | 'reject') => {
    const key = `${id}${action}${text}`;
    if (known.has(key)) return known.get(key);
    trials -= cost;
    if (trials < 0) throw tooMany();
    let result: string | undefined;
    try {
      result = applyChanges(text, action === 'accept' ? accept(text, id) : reject(text, id));
    } catch (error) {
      if (!(error instanceof EditError)) throw error;
    }
    known.set(key, result);
    return result;
  };
  // Each file is read once: the walk comes back to the same files many times.
  const parsedOf = pending?.parsedOf ?? parsingOnce();
  const kinds = new Map<string, Map<string, string>>();
  const marksIn = (text: string) => {
    let found = kinds.get(text);
    if (!found) {
      found = new Map(parsedOf(text).marks.map((mark) => [mark.id, mark.kind]));
      kinds.set(text, found);
    }
    return found;
  };
  const wrongIn = (text: string) =>
    parsedOf(text).warnings.filter(({ code }) => LEFT_WRONG.has(code)).length;
  const reads = (a: string, r: string): Reading => {
    if (pending) return readsApart(a, r, pending);
    return readsTheSame(a, r) ? 'same' : 'otherwise';
  };
  /** A file with the marks left pending accepted: where their markers hide nothing. */
  const freedTexts = new Map<string, string | undefined>();
  const freed = (text: string) => {
    if (freedTexts.has(text)) return freedTexts.get(text);
    const inText = marksIn(text);
    const ids = (pending?.ids ?? []).filter((id) => inText.has(id));
    let result: string | undefined;
    try {
      result = applyChanges(text, acceptMarks(text, ids));
    } catch (error) {
      if (!(error instanceof EditError)) throw error;
    }
    freedTexts.set(text, result);
    return result;
  };
  const seen = new Set<string>();
  /** `a` is the state, `r` what it reads as, and `b` its bytes once `fresh` is rejected. */
  const visit = (a: string, r: string, b: string, accepted: boolean) => {
    const key = `${accepted ? 'a' : 'p'}${a}\u0000${r}`;
    if (seen.has(key)) return;
    seen.add(key);
    const inA = marksIn(a);
    const undecided = fresh.filter((id) => inA.has(id));
    const reading = reads(a, r);
    if (reading === 'otherwise' || wrongIn(a) > wrongIn(b)) throw refused(NEAR_PENDING);
    if (reading === 'unsure') throw new TryEveryMark();
    if (fresh.length > 0 && undecided.length === 0 && !accepted) {
      if (bodyWithoutEnd(a, parsedOf(a)) !== bodyWithoutEnd(b, parsedOf(b))) {
        throw refused(NEAR_PENDING);
      }
    }
    for (const id of undecided) {
      for (const action of ['reject', 'accept'] as const) {
        const next = attempt(a, id, action);
        if (next === undefined) throw refused(NEAR_PENDING);
        visit(next, r, b, accepted || action === 'accept');
      }
    }
    const inR = marksIn(r);
    for (const id of others) {
      if (!inA.has(id) || !inR.has(id)) continue;
      // A highlight is dismissed, whichever word is used.
      for (const action of inA.get(id) === 'hl'
        ? (['accept'] as const)
        : (['reject', 'accept'] as const)) {
        const nextR = attempt(r, id, action);
        if (nextR === undefined) {
          // Nothing shows what a decision that was refused comes to, so it stays refused.
          if (attempt(a, id, action) !== undefined) throw refused(NEAR_PENDING);
          // Refused while the markers of the marks left pending are there to hide, it may work once
          // they are decided, in a state this walk does not see.
          const opens = (text: string) => {
            const open = freed(text);
            return open === undefined || attempt(open, id, action) !== undefined;
          };
          if (pending && (opens(r) || opens(a))) throw new TryEveryMark();
          continue;
        }
        const nextB = b === r ? nextR : attempt(b, id, action);
        const nextA = attempt(a, id, action);
        if (nextA === undefined || nextB === undefined) throw refused(NEAR_PENDING);
        visit(nextA, nextR, nextB, accepted);
      }
    }
  };
  visit(after, baseline.reading, baseline.bytes ?? baseline.reading, false);
}

/** What a segment of a mark takes up in the file: a split, the break it stands for as well. */
function segmentSpan(mark: MarkRange, segment: Segment, reader: FormatReader): Range {
  const { from } = segment.open;
  if (mark.kind === 'split') {
    const limit = reader.hidden.find((marker) => marker.role === 'ledger')?.from;
    return { from, to: breakEnd(reader.text, segment.open.to, limit) };
  }
  return { from, to: (segment.close ?? openerRange(segment)).to };
}

/** The file without the markers of its comments and highlights. */
function withoutAnnotations(text: string): string {
  const changes = parse(text).marks.flatMap((mark) => {
    if (mark.kind !== 'cmt' && mark.kind !== 'hl') return [];
    return mark.segments.flatMap((segment) => {
      const gone: TextChange[] = [{ ...openerRange(segment), insert: '' }];
      if (segment.close) gone.push({ ...segment.close, insert: '' });
      return gone;
    });
  });
  return applyChanges(text, inOrder(changes));
}

/** What a region is called in a refusal, by its lines, and how long it is. */
function sizeOf(text: string, region: Range): RegionSize {
  const lines = text.slice(region.from, region.to).split('\n');
  const name = lines.some((line) => ITEM_LINE.test(line))
    ? 'list'
    : lines.some((line) => line.includes('|') && DELIMITER_ROW.test(line))
      ? 'table'
      : /^[ \t]{0,3}>/.test(lines.find((line) => line.trim() !== '') ?? '')
        ? 'quote'
        : 'paragraph';
  return { name, length: region.to - region.from };
}

/**
 * A file of nothing but `region` of `text` with `edits` made to it (in offsets of `text`, all in the
 * region), the reference definitions of the file, and the ledger entries of the marks in it: what a
 * decision does in the region can be tried on it, at a cost that does not grow with the file.
 */
function regionFile(
  text: string,
  ledger: Ledger,
  region: Range,
  edits: readonly TextChange[],
): string {
  const shifted = edits.map((edit) => ({
    ...edit,
    from: edit.from - region.from,
    to: edit.to - region.from,
  }));
  const body = applyChanges(text.slice(region.from, region.to), inOrder(shifted));
  const ids = new Set(scan(body).markers.map((marker) => marker.id));
  const local: Ledger = {
    version: 1,
    people: ledger.people,
    marks: Object.fromEntries(Object.entries(ledger.marks).filter(([id]) => ids.has(id))),
    comments: ledger.comments.filter((thread) => ids.has(thread.id)),
  };
  // A reference is a link by what is defined elsewhere in the file, which no change here alters.
  const definitions = body.includes('[')
    ? [...text.matchAll(/^[ \t]{0,3}\[[^\]\n]+\]:.*$/gm)]
        .filter((match) => match.index < region.from || match.index > region.to)
        .map((match) => match[0].replace(/<!--[\s\S]*?-->/g, ''))
    : [];
  const eol = eolOf(text);
  const written = inEol(serializeLedger(normalizeLedger(body, local)), eol);
  return [body, ...definitions, written].join(eol + eol) + eol;
}

/** What a change does in one region, for the check of it. */
interface RegionChange {
  region: Range;
  /** Syntax written with no mark, and the author's own marks changed in place. */
  direct: TextChange[];
}

/** The changes of the body, without those of the ledger: what is past the body, and the ledger
 * that a file which had none gets. */
function bodyChanges(parsed: Parsed, changes: readonly TextChange[]): TextChange[] {
  const ledger = parsed.ledgerRange?.from ?? Infinity;
  // What is written or taken away at the very end of the body, as the closer of a mark there, is
  // the body's.
  return changes.filter(
    (change) => change.to <= ledger && !change.insert.includes('<!-- redlines'),
  );
}

/** The blocks whose regions meet, as one region that covers them all. */
function regionsOf(blocks: readonly RegionChange[]): RegionChange[] {
  const regions: RegionChange[] = [];
  for (const block of blocks.toSorted((a, b) => a.region.from - b.region.from)) {
    const known = regions.at(-1);
    if (known && block.region.from <= known.region.to) {
      known.region = { from: known.region.from, to: Math.max(known.region.to, block.region.to) };
      known.direct.push(...block.direct);
    } else regions.push({ region: block.region, direct: [...block.direct] });
  }
  return regions;
}

/**
 * Whether the change reads as the file without it, before any decision (the check before the walks),
 * and the readings the walks of the region go on with: those of the marks apart, when there are
 * some and they hold here; otherwise none, and the walks try every mark.
 */
function readsAsBefore(
  local: string,
  after: string,
  pending: Pending | undefined,
): { alike: boolean; pending: Pending | undefined } {
  if (pending) {
    try {
      return { alike: readsTheSame(local, after, pending), pending };
    } catch (error) {
      if (!(error instanceof TryEveryMark)) throw error;
    }
  }
  return { alike: readsTheSame(local, after), pending: undefined };
}

/** The marks of `local`, the file of `region` before a change whose edits there are `touching` (in
 * offsets of the file), that are apart from the change (format-apart.ts), to leave pending; none
 * when there are none. */
function pendingIn(
  local: string,
  region: Range,
  touching: readonly TextChange[],
): Pending | undefined {
  const parsed = parse(local);
  const footprint = touching.map((edit) => ({
    from: edit.from - region.from,
    to: edit.to - region.from,
  }));
  const apart = marksApart(formatReader(local, parsed), parsed, footprint);
  return apart.ids.size > 0 ? pendingOf(apart) : undefined;
}

/**
 * Looks at what a change makes of each region, before it is written, on the region by itself. Text in
 * the author's own insertion only has to read as before, as typed text does. Elsewhere, every order
 * of deciding every mark in the region, the new ones and the others (another person's in the
 * paragraph itself would have refused the change), reads as the same decisions without the change,
 * with comments and without; and rejecting the new marks gives back the bytes (format §2.6). Marks
 * apart from the change are left pending, unless `checking` asks for every mark. `changes` are those
 * of the file, in offsets of `text`, and `ledger` the ledger that goes with them.
 */
function selfCheck(
  text: string,
  parsed: Parsed,
  changes: readonly TextChange[],
  ledger: Ledger,
  blocks: readonly RegionChange[],
  created: readonly string[],
  checking: Checking,
): void {
  const before = parsed.ledger;
  const body = bodyChanges(parsed, changes);
  for (const { region, direct } of regionsOf(blocks)) {
    const inside = (change: TextChange) => change.from >= region.from && change.to <= region.to;
    const touching = body.filter((change) => change.from <= region.to && region.from <= change.to);
    if (!touching.every(inside)) throw refused(SELF_CHECK);
    const local = regionFile(text, before, region, []);
    const after = regionFile(text, ledger, region, touching);
    const marks = parse(after).marks;
    const others = marks
      .filter((mark) => mark.kind !== 'cmt' && !created.includes(mark.id))
      .map((mark) => mark.id);
    const apart =
      !checking.everyMark && others.length > 0 ? pendingIn(local, region, touching) : undefined;
    const { alike, pending } = readsAsBefore(local, after, apart);
    if (!alike) throw refused(READS_OTHERWISE);
    const bytes = direct.length > 0 ? regionFile(text, before, region, direct) : local;
    const fresh = marks.filter((mark) => created.includes(mark.id)).map((mark) => mark.id);
    const size = sizeOf(text, region);
    proveDecisions({ reading: local, bytes }, after, fresh, others, size, pending);
    if (marks.some((mark) => mark.kind === 'cmt' || mark.kind === 'hl')) {
      const bare = { reading: withoutAnnotations(local), bytes: withoutAnnotations(bytes) };
      proveDecisions(bare, withoutAnnotations(after), fresh, others, size, pending);
    }
  }
}

/**
 * The change as tracked `fmt` marks by `ctx.author`: one mark per block, sharing a `group` when there
 * are several, which is `ctx.group` or a new id. Text in the author's own insertion gets the syntax
 * with no mark, and a pending format change of the author's that this one turns back goes away.
 * `range` covers visible text, as `trackedEdit`'s does. Nothing changes where the text is as asked.
 *
 * @throws RangeError when the range lies outside the text.
 * @throws EditError in the words the editor shows: in code (`inside-code`), in front matter
 *   (`front-matter`), where another person's pending format change or the placement of the markers
 *   is in the way (`no-legal-placement`), for an address that would be read as markup (`markup`).
 */
export function trackedFormat(
  text: string,
  range: Range,
  op: FormatOp,
  ctx: EditContext,
): TrackedEdits {
  return formatTracked(text, range, op, ctx, LEAVING_MARKS_APART);
}

/** How a change is checked: with the marks apart from it left pending (format §2.6), or, with
 * `everyMark`, every mark of its block tried in every order, as before they were. */
interface Checking {
  everyMark: boolean;
}

const LEAVING_MARKS_APART: Checking = { everyMark: false };

/**
 * For tests only: `trackedFormat` and `untrackedFormat` with every mark of a region tried in every
 * order, none left pending as apart from the change, as format changes were checked before marks
 * apart were (format §2.6). The tests compare the two. Not part of the package (`index.ts`).
 */
export const tryingEveryMark = {
  trackedFormat: (text: string, range: Range, op: FormatOp, ctx: EditContext): TrackedEdits =>
    formatTracked(text, range, op, ctx, { everyMark: true }),
  untrackedFormat: (
    text: string,
    range: Range,
    op: FormatOp,
    ctx: UntrackedContext = {},
  ): TextChange[] => formatUntracked(text, range, op, ctx, { everyMark: true }),
};

/** `trackedFormat`, checked as `checking` says. */
function formatTracked(
  text: string,
  range: Range,
  op: FormatOp,
  ctx: EditContext,
  checking: Checking,
): TrackedEdits {
  const { planning, blocks } = planFormat(text, range, op, true, ctx.author);
  if (blocks.length === 0) return { changes: [], markIds: [], extendedIds: [] };
  const { parsed } = planning;
  const taken = idsIn(text);
  const draw = () => {
    const id = newId(taken, ctx.random);
    taken.add(id);
    return id;
  };
  const created: string[] = [];
  const changed: RegionChange[] = [];
  const segments = new Map<string, number>();
  const body: TextChange[] = [];
  const extended: string[] = [];
  let removes = false;
  for (const { steps, region } of blocks) {
    const ids = new Map<number, string>();
    const unmarked: TextChange[] = [];
    /** The id of a mark of this block at a depth; a new one for the first segment. */
    const idAt = (depth: number) => {
      const known = ids.get(depth);
      if (known !== undefined) {
        segments.set(known, (segments.get(known) ?? 0) + 1);
        return known;
      }
      const id = draw();
      ids.set(depth, id);
      created.push(id);
      segments.set(id, 1);
      return id;
    };
    for (const step of steps) {
      if (step.kind === 'edit') {
        unmarked.push(...step.changes);
        body.push(...step.changes);
        if (step.kept) extended.push(step.id);
        else removes = true;
      } else if (step.kind === 'wrap') {
        const { a, b, opener, left, right, op: written, own } = step;
        if (own !== undefined) {
          const changes = [
            { from: a, to: a, insert: left },
            { from: b, to: b, insert: right },
          ];
          unmarked.push(...changes);
          body.push(...changes);
          extended.push(own);
          continue;
        }
        const id = idAt(0);
        const open = `<!--fmt ${id} ${written}-->`;
        if (opener === a) body.push({ from: a, to: a, insert: open + left });
        else
          body.push({ from: opener, to: opener, insert: open }, { from: a, to: a, insert: left });
        body.push({ from: b, to: b, insert: `${right}<!--/${id}-->` });
      } else if (step.kind === 'unwrap') {
        const { opens, closes, opener, op: written, depth, own } = step;
        if (own !== undefined) {
          const changes = [
            { ...opens, insert: '' },
            { ...closes, insert: '' },
          ];
          unmarked.push(...changes);
          body.push(...changes);
          extended.push(own);
          continue;
        }
        const id = idAt(depth);
        const open = `<!--fmt ${id} ${written}-->`;
        if (opener === opens.from) body.push({ ...opens, insert: open });
        else body.push({ from: opener, to: opener, insert: open }, { ...opens, insert: '' });
        body.push({ ...closes, insert: `<!--/${id}-->` });
      } else if (step.kind === 'block') {
        const id = idAt(0);
        body.push(...step.write(`<!--fmt ${id} {op}-->`, `<!--/${id}-->`));
      } else {
        const { outer, opener, url, insert, op: written } = step;
        const id = idAt(0);
        const open = `<!--fmt ${id} ${written}-->`;
        body.push(
          { from: opener, to: opener, insert: open },
          { ...url, insert },
          { from: outer.to, to: outer.to, insert: `<!--/${id}-->` },
        );
      }
    }
    changed.push({ region, direct: unmarked });
  }
  const ledger = workingLedger(parsed.ledger);
  if (created.length > 0) addPerson(ledger, ctx.author);
  const group = ctx.group ?? (created.length > 1 ? draw() : undefined);
  for (const id of created) {
    const entry: MarkEntry = { by: ctx.author.handle, at: ctx.time };
    if (group !== undefined) entry.group = group;
    if (ctx.note !== undefined) entry.note = ctx.note;
    ledger.marks[id] = entry;
  }
  const changes = commitEdit(text, body, ledger, {
    parsed,
    created,
    ...(removes && created.length === 0 ? { removes: true } : {}),
    verify: (_after, read) => {
      for (const id of created) {
        const mark = read.marks.find((candidate) => candidate.id === id);
        if (mark?.segments.length !== segments.get(id)) {
          throw new EditError(IN_VERBATIM, 'inside-code');
        }
      }
    },
  });
  // A block change leaves no mark apart: it changes the lines of its block.
  const blockChecking = isBlockOp(op) ? { everyMark: true } : checking;
  selfCheck(text, parsed, changes, ledger, changed, created, blockChecking);
  return { changes, markIds: created, extendedIds: [...new Set(extended)] };
}

/** Where a position of the text went, in front of what the changes put right at it. */
function positionAfter(changes: readonly TextChange[], position: number): number {
  let delta = 0;
  for (const change of changes) {
    if (change.to > position || (change.to === position && change.from === change.to)) break;
    delta += change.insert.length - (change.to - change.from);
  }
  return position + delta;
}

/**
 * The same change made directly: each piece of syntax goes through `untrackedEdit`'s rules, as typed
 * or deleted text, so that it stays outside pending insertions, and makes no mark. It refuses what
 * `trackedFormat` refuses, and what `untrackedEdit` refuses.
 *
 * @throws RangeError when the range lies outside the text.
 * @throws EditError as `trackedFormat` and `untrackedEdit` do.
 */
export function untrackedFormat(
  text: string,
  range: Range,
  op: FormatOp,
  ctx: UntrackedContext = {},
): TextChange[] {
  return formatUntracked(text, range, op, ctx, LEAVING_MARKS_APART);
}

/** `untrackedFormat`, checked as `checking` says. */
function formatUntracked(
  text: string,
  range: Range,
  op: FormatOp,
  ctx: UntrackedContext,
  checking: Checking,
): TextChange[] {
  const { blocks } = planFormat(text, range, op, false, ctx.author);
  const edits: TextChange[] = [];
  for (const step of blocks.flatMap((block) => block.steps)) {
    if (step.kind === 'wrap') {
      edits.push(
        { from: step.a, to: step.a, insert: step.left },
        { from: step.b, to: step.b, insert: step.right },
      );
    } else if (step.kind === 'unwrap') {
      edits.push({ ...step.opens, insert: '' }, { ...step.closes, insert: '' });
    } else if (step.kind === 'relink') {
      edits.push({ ...step.url, insert: step.insert });
    } else if (step.kind === 'block') {
      edits.push(...step.write('', ''));
    }
  }
  // From the end, so that what comes first is where it was, unless a repair moved it.
  let todo = inOrder(edits);
  let changes: TextChange[] = [];
  let current = text;
  for (let edit = todo.pop(); edit; edit = todo.pop()) {
    const step = untrackedEdit(current, edit, ctx);
    changes = spliceRepairs(text, changes, current, step);
    current = applyChanges(current, step);
    todo = todo.map((later) => ({
      ...later,
      from: positionAfter(step, later.from),
      to: positionAfter(step, later.to),
    }));
  }
  // What the syntax stands against can be decided later, as with Track Changes on: every order of
  // the decisions in the block reads as it would without it.
  const parsed = parse(text);
  const before = parsed.ledger;
  const body = bodyChanges(parsed, changes);
  for (const { region } of regionsOf(blocks.map(({ region }) => ({ region, direct: [] })))) {
    const touching = body.filter((change) => change.from <= region.to && region.from <= change.to);
    if (touching.some((change) => change.from < region.from || change.to > region.to)) {
      throw refused(SELF_CHECK);
    }
    const local = regionFile(text, before, region, []);
    const after = regionFile(text, before, region, touching);
    const marks = parse(after).marks;
    const others = marks.filter((mark) => mark.kind !== 'cmt').map((mark) => mark.id);
    const inline = !checking.everyMark && !isBlockOp(op) && others.length > 0;
    const apart = inline ? pendingIn(local, region, touching) : undefined;
    const { alike, pending } = readsAsBefore(local, after, apart);
    if (!alike) throw refused(READS_OTHERWISE);
    const size = sizeOf(text, region);
    if (others.length > 0) proveDecisions({ reading: local }, after, [], others, size, pending);
    if (marks.some((mark) => mark.kind === 'cmt' || mark.kind === 'hl')) {
      const bare = { reading: withoutAnnotations(local) };
      proveDecisions(bare, withoutAnnotations(after), [], others, size, pending);
    }
  }
  return changes;
}
