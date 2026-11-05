// Format changes (format §2.6): formatting that changes while the words stay the same. With Track
// Changes on, a change is a `fmt` mark around the text, whose payload says what rejecting it undoes.
// With it off, the same syntax goes through `untrackedEdit`, and no mark is written.
//
// - Adding a format writes its syntax (`**`, `*`, `~~`, backticks, `[`…`](…)`) right against the
//   first and last characters of the text, and the markers right against the syntax. Text that has
//   the format already is left out, and a piece that would cross the edge of another format, a link
//   or a table cell is cut there. A format around all of another goes outside its syntax.
// - Removing a format takes all of its run, and the markers stand where its syntax stood.
// - A mark holds an insertion, a substitution or another format change only with text of its own on
//   both sides of it. Otherwise the range is cut at its edge, because rejecting the insertion would
//   leave `****`, or `** text**`, and markers would cross.
// - In the author's own insertion the syntax is written with no mark, and a format change of the
//   author's own that is turned back goes away. Another person's change of the same format is in
//   the way, and is refused.
// - Each block has its marks, with one id for the pieces at one depth, and all of them share a group.
//
// Whatever a change comes to is tried before it is written, and refused if it does not come out: it
// reads as the same plain text in every order of accepting and rejecting it and the marks that could
// change how its syntax reads, which is where a delimiter that opens nothing shows up, and rejecting
// it gives back the bytes. Nothing is repaired when a decision is made later.

import {
  breakEnd,
  breakStart,
  frontMatterEnd,
  lineEnd,
  lineStart,
  lineStartKind,
  openerRange,
} from './blocks.ts';
import { applyChanges } from './changes.ts';
import { accept, acceptAll, reject, rejectAll } from './decide.ts';
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
  readLayout,
  startOf,
} from './format-reader.ts';
import type { FormatReader, Layout, Span } from './format-reader.ts';
import { LOST_SYNTAX, inOrder, overlaps, refused, segmentChanges, urlIn } from './format-undo.ts';
import { idsIn, newId } from './ids.ts';
import { inspectPlace, isWord, paragraphRange, visible } from './inline.ts';
import type { Place } from './inline.ts';
import { normalizeLedger } from './ledger-order.ts';
import { serializeLedger } from './ledger-write.ts';
import { parse } from './parse.ts';
import type { TrackedEdits } from './track.ts';
import type {
  EditContext,
  Ledger,
  MarkEntry,
  MarkRange,
  Parsed,
  Person,
  Range,
  Segment,
  TextChange,
} from './types.ts';
import { nameOf, untrackedEdit } from './untracked.ts';
import type { UntrackedContext } from './untracked.ts';

export { parseFormatOps } from './format-ops.ts';
export type { BlockType, FormatOp, InlineFormat, ParsedFormatOp } from './format-ops.ts';

const FLANK = 'A marker here would change how the text next to it is emphasized.';

const READS_OTHERWISE =
  "This formatting can't be written here: Markdown would read the text next to it differently.";

const IN_CODE_SPAN = "Text inside code can't be formatted. Select the whole code span instead.";

const IN_VERBATIM = "Text inside code, an HTML block or an HTML comment can't be formatted.";

const HOLDER_UNTRACKED =
  "Text in a pending insertion can't be formatted with Track Changes off. Accept or reject it first, or turn on Track Changes.";

const BARE_ROW = 'A row of a table needs a leading | to hold a format change.';

const STRADDLES =
  'This formatting starts and ends on different sides of a pending change. Accept or reject that change first.';

const REFERENCE =
  "This text has a reference, whose address is defined elsewhere in the file, so a link can't be changed or added here.";

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
  | { kind: 'edit'; at: number; changes: TextChange[]; id: string; kept: boolean };

/** What the planning of one change works with. */
interface Planning extends FormatReader {
  parsed: Parsed;
  /** Whose own marks are changed in place. Nobody's, with Track Changes off. */
  me: string | undefined;
  author: Person | undefined;
  tracked: boolean;
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
  let opener = a;
  if (lineStartKind(text, a, hidden) === 'continuation') {
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

/** What a change does, block by block. */
interface Plan {
  planning: Planning;
  blocks: Step[][];
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
    author,
    tracked,
  };
  const limit = parsed.ledgerRange?.from ?? text.length;
  const to = Math.min(limit, snapOut(planning.hidden, range.to, false));
  let from = Math.min(to, snapOut(planning.hidden, range.from, true));
  const blocks: Step[][] = [];
  if (from >= to) return { planning, blocks };
  const front = frontMatterEnd(text);
  if (front >= 0 && from <= front) {
    if (to <= front) throw new EditError("Front matter can't be formatted.", 'front-matter');
    from = front + 1;
  }
  let inVerbatim = false;
  let elsewhere = false;
  for (const paragraph of paragraphsIn(planning, from, to)) {
    if (paragraph.to <= from || paragraph.from >= to) continue;
    if (isRawParagraph(planning, paragraph)) {
      inVerbatim = true;
      continue;
    }
    elsewhere = true;
    const layout = readLayout(planning, paragraph);
    const clamp = {
      from: indexAt(layout, Math.max(from, paragraph.from)),
      to: indexAt(layout, Math.min(to, paragraph.to)),
    };
    if (clamp.from >= clamp.to) continue;
    const steps = planParagraph(planning, layout, clamp, op);
    if (steps.length > 0) blocks.push(steps.toSorted((a, b) => a.at - b.at));
  }
  if (inVerbatim && !elsewhere) throw new EditError(IN_VERBATIM, 'inside-code');
  return { planning, blocks };
}

/** The body of a file without the line breaks that end it. */
function bodyWithoutEnd(text: string): string {
  const range = parse(text).ledgerRange;
  return (range ? text.slice(0, range.from) : text).replace(/[\r\n]+$/, '');
}

/** The message of a change that came out other than it should. */
const SELF_CHECK =
  "This format change can't be written here without altering other text. Make it on less text, or decide the changes next to it first.";

const NEAR_PENDING =
  "This formatting can't be written next to these pending changes: deciding them could leave stray syntax. Accept or reject them first.";

const TOO_MANY =
  'Too many pending changes touch this text to check this formatting against them. Accept or reject some of them first.';

/** How many decisions may be tried for one block, which bounds the work of a change. It goes
 * through every order of a new mark and two others, and refuses a third. */
const TRIALS = 200;

/** Whether two files read as the same words. Only the paragraphs that differ are read, on both
 * readings of punctuation: a delimiter that opens nothing would be read as text. */
function readsTheSame(a: string, b: string): boolean {
  const bodyA = bodyWithoutEnd(a);
  const bodyB = bodyWithoutEnd(b);
  if (bodyA === bodyB) return true;
  const limit = Math.min(bodyA.length, bodyB.length);
  let head = 0;
  while (head < limit && bodyA[head] === bodyB[head]) head++;
  let tail = 0;
  while (tail < limit - head && bodyA.at(-1 - tail) === bodyB.at(-1 - tail)) tail++;
  return [isPunctuation, isOlderPunctuation].every(
    (punctuation) =>
      plainBody(a, punctuation, head, bodyA.length - tail) ===
      plainBody(b, punctuation, head, bodyB.length - tail),
  );
}

/** Warnings that a decision must not add: marks that don't fit together, and a marker that starts a
 * line. */
const LEFT_WRONG = new Set([
  'unclosed-mark',
  'unopened-close',
  'kind-mismatch',
  'duplicate-id',
  'line-start-marker',
]);

const wrongIn = (text: string): number =>
  parse(text).warnings.filter(({ code }) => LEFT_WRONG.has(code)).length;

/**
 * Tries every order of accepting and rejecting the marks, from `after`, against the same decisions
 * from `baseline`. `fresh` are the marks the change wrote, which `baseline` does not have. Every state
 * on the way reads as the state it stands for, and once all of `fresh` is rejected and none of it
 * accepted, it has the bytes of that state. A decision that works there works here. No repair is
 * looked for: a change that does not come out is refused.
 *
 * @throws EditError when that does not hold, or when there are too many states to try.
 */
function proveDecisions(
  baseline: string,
  after: string,
  fresh: readonly string[],
  others: readonly string[],
): void {
  let trials = TRIALS;
  const known = new Map<string, string | undefined>();
  const attempt = (text: string, id: string, action: 'accept' | 'reject') => {
    const key = `${id}${action}${text}`;
    if (known.has(key)) return known.get(key);
    if (trials-- <= 0) throw refused(TOO_MANY);
    let result: string | undefined;
    try {
      result = applyChanges(text, action === 'accept' ? accept(text, id) : reject(text, id));
    } catch (error) {
      if (!(error instanceof EditError)) throw error;
    }
    known.set(key, result);
    return result;
  };
  const seen = new Set<string>();
  const visit = (a: string, b: string, accepted: boolean) => {
    const key = `${accepted ? 'a' : 'p'}${a}`;
    if (seen.has(key)) return;
    seen.add(key);
    const inA = new Map(parse(a).marks.map((mark) => [mark.id, mark.kind]));
    const undecided = fresh.filter((id) => inA.has(id));
    const backToBytes = fresh.length > 0 && undecided.length === 0 && !accepted;
    const right = backToBytes ? bodyWithoutEnd(a) === bodyWithoutEnd(b) : readsTheSame(a, b);
    if (!right || wrongIn(a) > wrongIn(b)) throw refused(NEAR_PENDING);
    for (const id of undecided) {
      for (const action of ['reject', 'accept'] as const) {
        const next = attempt(a, id, action);
        if (next === undefined) throw refused(NEAR_PENDING);
        visit(next, b, accepted || action === 'accept');
      }
    }
    const inB = new Set(parse(b).marks.map((mark) => mark.id));
    for (const id of others) {
      if (!inA.has(id) || !inB.has(id)) continue;
      // A highlight is dismissed, whichever word is used.
      for (const action of inA.get(id) === 'hl'
        ? (['accept'] as const)
        : (['reject', 'accept'] as const)) {
        const nextB = attempt(b, id, action);
        if (nextB === undefined) continue;
        const nextA = attempt(a, id, action);
        if (nextA === undefined) throw refused(NEAR_PENDING);
        visit(nextA, nextB, accepted);
      }
    }
  };
  visit(after, baseline, false);
}

/** What a segment of a mark takes up in the file: a split, the break it stands for as well. */
function segmentSpan(mark: MarkRange, segment: Segment, reader: FormatReader): Range {
  const { from } = segment.open;
  if (mark.kind === 'split') return { from, to: breakEnd(reader.text, segment.open.to) };
  return { from, to: (segment.close ?? openerRange(segment)).to };
}

/** The marks that stand in the paragraphs of `ranges`, or whose markers or text reach into them. */
function marksOfParagraphs(
  parsed: Parsed,
  reader: FormatReader,
  ranges: readonly Range[],
): MarkRange[] {
  const paragraphs = ranges.map((range) => paragraphRange(reader.text, reader.hidden, range.to));
  const inThem = (range: Range) => paragraphs.some((p) => range.from <= p.to && p.from <= range.to);
  return parsed.marks.filter((mark) =>
    mark.segments.some((segment) => inThem(segmentSpan(mark, segment, reader))),
  );
}

/**
 * A file of nothing but the paragraph of `spot`, with the lines in front of it that hold the openers
 * of its marks and the marks in it, to try decisions on: what a try costs does not grow with the
 * file. Undefined when the paragraph can't be read by itself, because a mark in it goes on outside it.
 */
function paragraphFile(parsed: Parsed, reader: FormatReader, spot: Range): string | undefined {
  const { text, hidden } = reader;
  const paragraph = paragraphRange(text, hidden, spot.to);
  let start = paragraph.from;
  for (let lines = 0; lines < LINES_ABOVE && start > 0; lines++) {
    const above = lineStart(text, start - 1);
    const shown = visible(text, hidden, above, lineEnd(text, above)).text;
    if (!/^[ \t>]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]*)?\r?$/.test(shown)) break;
    start = above;
  }
  while (start < paragraph.from && text.slice(start, lineEnd(text, start)).trim() === '') {
    start = text.indexOf('\n', start) + 1;
  }
  const marks: MarkRange[] = [];
  for (const mark of parsed.marks) {
    const spans = mark.segments
      .map((segment) => segmentSpan(mark, segment, reader))
      .filter(({ from, to }) => from <= paragraph.to && start <= to);
    if (spans.length === 0) continue;
    if (mark.kind === 'split' || spans.some(({ from, to }) => from < start || to > paragraph.to)) {
      return undefined;
    }
    marks.push(mark);
  }
  const body = text.slice(start, paragraph.to);
  const ids = new Set(marks.map((mark) => mark.id));
  const ledger: Ledger = {
    version: 1,
    people: parsed.ledger.people,
    marks: Object.fromEntries(Object.entries(parsed.ledger.marks).filter(([id]) => ids.has(id))),
    comments: parsed.ledger.comments.filter((thread) => ids.has(thread.id)),
  };
  // A reference is a link by what is defined elsewhere in the file.
  const definitions = body.includes('[')
    ? [...text.matchAll(/^[ \t]{0,3}\[[^\]\n]+\]:.*$/gm)].map((match) => match[0])
    : [];
  const eol = eolOf(text);
  const written = inEol(serializeLedger(normalizeLedger(body, ledger)), eol);
  return [body, ...definitions, written].join(eol + eol) + eol;
}

/** Text of a mark that can pair with syntax elsewhere in the paragraph. */
const HOLDS_SYNTAX = /[*_~`\\[\]&]/;

/**
 * The marks whose decisions can change how the syntax in `ranges` reads: those with a marker right
 * next to it or in it, with no text in between, those around it, and those in its paragraph with text
 * that has syntax of its own. The others change only words further off. Comments have no decision.
 */
function marksInvolved(
  parsed: Parsed,
  reader: FormatReader,
  ranges: readonly Range[],
): MarkRange[] {
  const markers = reader.hidden.filter(({ role }) => role !== 'ledger');
  const wide = ranges.map(({ from, to }) => {
    let left = from;
    let right = to;
    for (let step = 0; step <= markers.length; step++) {
      const before = markers.find((marker) => marker.to === left && marker.from < left);
      const after = markers.find((marker) => marker.from === right && marker.to > right);
      if (!before && !after) break;
      left = before?.from ?? left;
      right = after?.to ?? right;
    }
    return { from: left, to: right };
  });
  const paragraphMarks = new Set(marksOfParagraphs(parsed, reader, ranges));
  const touches = (range: Range) => wide.some((w) => range.from <= w.to && w.from <= range.to);
  return parsed.marks.filter((mark) => {
    if (mark.kind === 'cmt') return false;
    return mark.segments.some((segment) => {
      const opener = openerRange(segment);
      const { close } = segment;
      if (touches(segmentSpan(mark, segment, reader)) && mark.kind === 'split') return true;
      if (touches(opener) || (close && touches(close))) return true;
      if (close && wide.some((w) => opener.from <= w.from && w.to <= close.to)) return true;
      if (!paragraphMarks.has(mark) || mark.kind === 'fmt') return false;
      const written = `${segment.payload ?? ''}${reader.text.slice(segment.content.from, segment.content.to)}`;
      return HOLDS_SYNTAX.test(written);
    });
  });
}

/** The file without the markers of the comments and highlights of `marks`. */
function withoutAnnotations(text: string, marks: readonly MarkRange[]): string {
  const parsed = parse(text);
  const ids = new Set(marks.map((mark) => mark.id));
  const changes = parsed.marks.flatMap((mark) => {
    if ((mark.kind !== 'cmt' && mark.kind !== 'hl') || !ids.has(mark.id)) return [];
    return mark.segments.flatMap((segment) => {
      const gone: TextChange[] = [{ ...openerRange(segment), insert: '' }];
      if (segment.close) gone.push({ ...segment.close, insert: '' });
      return gone;
    });
  });
  return applyChanges(text, inOrder(changes));
}

/**
 * Reads the states at the ends, where every mark of the paragraphs is decided and no comment or
 * highlight is left to read as punctuation next to a delimiter: all accepted, and all rejected, which
 * with `exact` gives back the bytes.
 */
function proveEnds(
  baseline: string,
  after: string,
  marks: readonly MarkRange[],
  exact: boolean,
): void {
  const ids = new Set(marks.map((mark) => mark.id));
  const inScope = (mark: MarkRange) => ids.has(mark.id);
  const a = withoutAnnotations(after, marks);
  const b = withoutAnnotations(baseline, marks);
  if (!readsTheSame(a, b)) throw refused(NEAR_PENDING);
  const tryAll = (all: typeof acceptAll, text: string) => {
    try {
      return applyChanges(text, all(text, inScope));
    } catch (error) {
      if (error instanceof EditError) return undefined;
      throw error;
    }
  };
  for (const all of [acceptAll, rejectAll]) {
    const wanted = tryAll(all, b);
    if (wanted === undefined) continue;
    const got = tryAll(all, a);
    if (got === undefined) throw refused(NEAR_PENDING);
    const right =
      all === rejectAll && exact
        ? bodyWithoutEnd(got) === bodyWithoutEnd(wanted)
        : readsTheSame(got, wanted);
    if (!right) throw refused(NEAR_PENDING);
  }
}

/**
 * Looks at what the change makes of the file, before it is written. The plain text is what it was,
 * while the marks are pending and once they are accepted, and rejecting the new marks gives back the
 * bytes of the body, up to what the change did with no mark (`direct`). The same holds with every
 * other mark of the paragraphs decided, either way, and block by block in any order of the marks
 * that could change how the new syntax reads (format §2.6).
 */
function selfCheck(
  text: string,
  after: string,
  blocks: readonly (readonly string[])[],
  direct: readonly TextChange[],
): void {
  if (!readsTheSame(text, after)) throw refused(READS_OTHERWISE);
  const created = blocks.flat();
  if (created.length === 0) return;
  const parsed = parse(after);
  const reader = formatReader(after, parsed);
  const marks = parsed.marks.filter((mark) => created.includes(mark.id));
  const gone = marks.flatMap((mark) =>
    mark.segments.flatMap((segment) => {
      const changes: TextChange[] = [{ ...openerRange(segment), insert: '' }];
      if (segment.close) changes.push({ ...segment.close, insert: '' });
      return changes;
    }),
  );
  if (!readsTheSame(text, applyChanges(after, inOrder(gone)))) throw refused(READS_OTHERWISE);
  const baseline = applyChanges(text, inOrder(direct));
  /** The file with the marks of `ids` rejected, or undefined when one of them can't be. */
  const without = (ids: readonly string[]) => {
    const rejected = applyChanges(
      after,
      rejectAll(after, (mark) => ids.includes(mark.id)),
    );
    return parse(rejected).marks.some((mark) => ids.includes(mark.id)) ? undefined : rejected;
  };
  const undone = without(created);
  if (undone === undefined || bodyWithoutEnd(undone) !== bodyWithoutEnd(baseline)) {
    throw refused(SELF_CHECK);
  }
  const spots = (ids: readonly string[]) =>
    marks
      .filter((mark) => ids.includes(mark.id))
      .flatMap((mark) =>
        mark.segments.map((segment) => ({
          from: segment.open.from,
          to: (segment.close ?? segment.open).to,
        })),
      );
  proveEnds(baseline, after, marksOfParagraphs(parsed, reader, spots(created)), true);
  for (const ids of blocks) {
    const others = marksInvolved(parsed, reader, spots(ids))
      .map((mark) => mark.id)
      .filter((id) => !ids.includes(id) && !created.includes(id));
    if (ids.length === 1 && others.length === 0) continue;
    // The paragraph by itself, when it can be: with the marks of this block rejected, it has been
    // shown above to be what the file had.
    const [spot] = spots(ids);
    const hasSplit = parsed.marks.some((mark) => others.includes(mark.id) && mark.kind === 'split');
    const local = spot && !hasSplit ? paragraphFile(parsed, reader, spot) : undefined;
    if (local !== undefined) {
      const rejected = applyChanges(
        local,
        rejectAll(local, (mark) => ids.includes(mark.id)),
      );
      if (parse(rejected).marks.some((mark) => ids.includes(mark.id))) throw refused(SELF_CHECK);
      proveDecisions(rejected, local, ids, others);
    } else {
      // The marks of other blocks have nothing to do with these, and bytes are compared without them.
      const alone = without(created.filter((id) => !ids.includes(id)));
      if (alone === undefined) throw refused(SELF_CHECK);
      proveDecisions(baseline, alone, ids, others);
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
  const createdByBlock: string[][] = [];
  const segments = new Map<string, number>();
  const body: TextChange[] = [];
  const direct: TextChange[] = [];
  const extended: string[] = [];
  let removes = false;
  for (const steps of blocks) {
    const ids = new Map<number, string>();
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
        direct.push(...step.changes);
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
          direct.push(...changes);
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
          direct.push(...changes);
          body.push(...changes);
          extended.push(own);
          continue;
        }
        const id = idAt(depth);
        const open = `<!--fmt ${id} ${written}-->`;
        if (opener === opens.from) body.push({ ...opens, insert: open });
        else body.push({ from: opener, to: opener, insert: open }, { ...opens, insert: '' });
        body.push({ ...closes, insert: `<!--/${id}-->` });
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
    if (ids.size > 0) createdByBlock.push([...ids.values()]);
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
  selfCheck(text, applyChanges(text, changes), createdByBlock, direct);
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
  const { blocks } = planFormat(text, range, op, false, ctx.author);
  const edits: TextChange[] = [];
  for (const step of blocks.flat()) {
    if (step.kind === 'wrap') {
      edits.push(
        { from: step.a, to: step.a, insert: step.left },
        { from: step.b, to: step.b, insert: step.right },
      );
    } else if (step.kind === 'unwrap') {
      edits.push({ ...step.opens, insert: '' }, { ...step.closes, insert: '' });
    } else if (step.kind === 'relink') {
      edits.push({ ...step.url, insert: step.insert });
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
  if (!readsTheSame(text, current)) throw refused(READS_OTHERWISE);
  // What the syntax stands against can be decided later, as with Track Changes on.
  if (edits.length > 0) {
    const parsed = parse(text);
    const reader = formatReader(text, parsed);
    proveEnds(text, current, marksOfParagraphs(parsed, reader, edits), false);
    const others = marksInvolved(parsed, reader, edits).map((mark) => mark.id);
    if (others.length > 0) proveDecisions(text, current, [], others);
  }
  return changes;
}
