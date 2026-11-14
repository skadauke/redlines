// Tracked edits (format §3.6): what typing, deleting and replacing text become while Track Changes
// is on. An edit covers visible text, so callers map positions through hidden markers first (a
// position that falls inside a marker is moved out of it).
//
// - Typing in plain text is a new insertion. At the end of, inside, or at the start of an
//   insertion or substitution of the author's own, it joins it. Inside another person's, it splits
//   it around a new insertion, so that no insertion holds another one.
// - Deleting plain text, or text in another person's insertion, is a deletion with the text as its
//   payload, merged with the author's deletion next to it. Marks inside the range stay, and the
//   deletion is split around them with one id. Text in the author's own insertion is removed, and
//   an insertion left with no text goes.
// - Replacing text in one piece is a substitution (inside the author's own insertion it just
//   changes the text). Over several marks it is a deletion and an insertion after it.
//
// Where the markers go (format §3.1 to §3.4):
//
// - A line break in typed text is a `split` marker followed by the break, written after the
//   insertion that holds the text before it, never as text of an insertion; a deletion that touches
//   a break takes all of it, with the prefix of the next block, so that it never leaves a bullet or
//   a `#` behind a marker; deleting all of a block takes one of its breaks.
// - A marker that would be inside a link destination, an image, an autolink, an entity or another
//   construct that takes none, or that would change how emphasis flanks, is not written there:
//   the edit is widened to a substitution of the whole construct, or of the word (`legalize`).
// - A marker that would start a wrapped line is moved to the end of the line before it, by taking
//   the line break into the change. One that starts a block gets its own line (`placement.ts`).
// - Front matter and the start of a list item, quote or heading take no change.
//
// What cannot be put anywhere is refused with the code `no-legal-placement`; a change that would put
// its markers inside code or an HTML comment, where nothing would read them, with `inside-code`.

import {
  CONTAINER_PREFIX,
  HARD_BREAK,
  afterBullet,
  betweenIndentedCode,
  blockEdges,
  bodyStart,
  breakEnd,
  breakLength,
  breakStart,
  breaksBetween,
  continuationPrefix,
  frontMatterEnd,
  indentColumns,
  isBodyStart,
  lineEnd,
  lineKind,
  linePrefixAt,
  lineStartKind,
  lineStart,
  loosensList,
  nextLineStart,
  numberedFromTwo,
  onlyMarkers,
  openerRange,
  prefixLength,
  scaffold,
  underlineOfBreak,
  viewBreaks,
  withoutMarkers,
} from './blocks.ts';
import { sameBlocks } from './block-read.ts';
import {
  checkTableEdits,
  inOwnInsertedCol,
  inOwnInsertedRow,
  leadingPipeAt,
  outerPipeWrites,
  tableStartsAt,
} from './table-rules.ts';
import type { PipeWrite } from './table-rules.ts';
import { checkAlignGap } from './table-align.ts';
import { breakComesToDepend, pairWords } from './break-reach.ts';
import { assertWholeCharacters } from './characters.ts';
import { EditError } from './errors.ts';
import {
  addPerson,
  assertNoMarkup,
  commitEdit,
  eolOf,
  inEol,
  markerRanges,
  nameOf,
  snapOut,
  visibleText,
  workingLedger,
} from './edit-support.ts';
import type { Eol, MarkerRange } from './edit-support.ts';
import { idsIn, newId } from './ids.ts';
import {
  lineStartsTouched,
  linesAboveStart,
  listGoesOnEveryWay,
  blankBetween,
} from './list-run.ts';
import { sameEmphasis, sameReading } from './format-reader.ts';
import { emphasisReadsAlike, neighbours, unreadDelimiters } from './emphasis-orders.ts';
import { codeSpanAt, inspectPlace, stepLeft, stepRight, underliningBullet } from './inline.ts';
import { applyChanges } from './changes.ts';
import { parse } from './parse.ts';
import { encodePayload } from './payload.ts';
import { scan } from './scan.ts';
import type { Verbatim } from './scan.ts';
import {
  assertStillBlock,
  codeBlockOf,
  edited,
  holdersOf,
  markInCode,
  MIXED_BREAKS,
  NOT_CODE,
  theirChange,
} from './code-edit.ts';
import { newestView, originalView, viewsOnce } from './views.ts';
import type { Views } from './views.ts';
import { atWrappedLine, wrappedLineStart } from './wrapped-line.ts';
import type {
  DocView,
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

/** Pending text that can hold other text: an insertion or a substitution, in one segment. */
interface Container {
  mark: MarkRange;
  open: Range;
  content: Range;
  close: Range;
  /** Made by the author of the edit. */
  own: boolean;
}

/** A `split` of the file with the break it stands for (format §3.4). */
interface SplitUnit {
  /** The id of the mark. */
  id: string;
  /** The marker. */
  marker: Range;
  /** Where its break ends, with the prefix of the next block. */
  end: number;
  /** Made by the author of the edit. */
  own: boolean;
  /** What the edit does to the break: `cancel` takes marker and break away, `join` deletes the
   * break and records that after the marker. */
  how?: 'cancel' | 'join';
}

/** A deletion of the author's own that a new deletion next to it can join. */
interface OwnDeletion {
  id: string;
  from: number;
  to: number;
  text: string;
}

/** What the edits of one call have decided so far. */
interface Plan {
  readonly text: string;
  readonly parsed: Parsed;
  readonly eol: Eol;
  /** Where the front matter ends, or -1. Nothing in or before it takes a change. */
  readonly frontEnd: number;
  /** Where the body starts, which is read as a file of its own: the line after the front matter,
   * or the start of the file (format §3.8). */
  readonly bodyStart: number;
  readonly ctx: EditContext;
  readonly markers: MarkerRange[];
  readonly containers: Container[];
  readonly ownDeletions: OwnDeletion[];
  readonly taken: Set<string>;
  readonly ledger: Ledger;
  readonly changes: TextChange[];
  /** The marks this call made. They must be there afterwards. */
  readonly created: string[];
  /** Made past the ledger, where the placement rules have nothing to say. */
  readonly exempt: string[];
  /** Marks of other people that this call closed and opened again, around what it wrote. */
  readonly split: string[];
  /** The splits this call made, and how long the break after each is. */
  readonly breaks: Map<string, number>;
  /** The splits of the file that this call takes the break of: its own are cancelled, marker and
   * break gone; another person's break is deleted, and that is recorded after the marker. */
  readonly units: SplitUnit[];
  /** The marks this call made whose text starts with a line break that was written as text: the
   * opener must not be read to have it as a carrier (format §3.3). */
  readonly raw: string[];
  /** Line breaks were written as they are, with no mark: the original text has more of them. */
  plain: boolean;
  /** Where a blank line is content (`Scan.verbatim`), once asked for. */
  verbatim?: readonly Verbatim[];
  /** The marks this call made or changed. */
  readonly touched: string[];
  /** The range each edit replaces once it is widened, a point for typing. */
  readonly spans: Range[];
  /** The emphasis next to a change that stands against another mark (format §3.1, rule 5): the
   * change is first written as typed (`mode` 0) and read in every order of decisions, then written
   * again by a character on one side or the other (`mode` 1 on), as far as `options` goes.
   * `touched` is set where the markers stand against a mark. */
  readonly emphasis: { mode: number; options: number; touched: boolean; near: Set<string> };
}

/** A deletion of a table row or column (format §3.7), which text is not merged into. */
const TABLE_DELETION = /^(?:row|col)=/;

function createPlan(text: string, ctx: EditContext, mode = 0): Plan {
  const parsed = parse(text);
  const markers = markerRanges(parsed);
  const me = ctx.author.handle;
  const containers: Container[] = [];
  for (const mark of parsed.marks) {
    if (mark.kind !== 'ins' && mark.kind !== 'sub') continue;
    for (const segment of mark.segments) {
      const { content, close } = segment;
      if (!close) continue;
      // The text of the mark starts after the carrier of its opener.
      const text: Range = { from: segment.carrier?.to ?? content.from, to: content.to };
      containers.push({
        mark,
        open: openerRange(segment),
        content: text,
        close,
        own: mark.entry.by === me,
      });
    }
  }
  const ownDeletions: OwnDeletion[] = [];
  for (const marker of markers) {
    const { mark, segment } = marker;
    if (marker.role !== 'open' || mark?.kind !== 'del' || mark.entry.by !== me) continue;
    if (mark.entry.move !== undefined || TABLE_DELETION.test(mark.payload ?? '')) continue;
    ownDeletions.push({
      id: mark.id,
      from: marker.from,
      to: marker.to,
      text: segment?.payload ?? '',
    });
  }
  return {
    text,
    parsed,
    eol: eolOf(text, parsed.ledgerRange),
    frontEnd: frontMatterEnd(text),
    bodyStart: bodyStart(text),
    ctx,
    markers,
    containers,
    ownDeletions,
    taken: idsIn(text),
    ledger: workingLedger(parsed.ledger),
    changes: [],
    created: [],
    exempt: [],
    split: [],
    breaks: new Map(),
    units: [],
    raw: [],
    plain: false,
    touched: [],
    spans: [],
    emphasis: { mode, options: 0, touched: false, near: new Set() },
  };
}

/** The splits of the file that have a break after them. */
function splitUnits(plan: Plan): SplitUnit[] {
  const limit = plan.parsed.ledgerRange?.from;
  const units: SplitUnit[] = [];
  for (const marker of plan.markers) {
    if (marker.role !== 'open' || marker.mark?.kind !== 'split') continue;
    const end = breakEnd(plan.text, marker.to, limit);
    if (end === marker.to) continue;
    units.push({
      id: marker.mark.id,
      marker: { from: marker.from, to: marker.to },
      end,
      own: marker.mark.entry.by === plan.ctx.author.handle,
    });
  }
  return units;
}

/** A new mark for the author: an id, and its entry in the ledger. */
function newMark(plan: Plan): string {
  const { ctx, ledger } = plan;
  const id = newId(plan.taken, ctx.random);
  plan.taken.add(id);
  addPerson(ledger, ctx.author);
  const entry: MarkEntry = { by: ctx.author.handle, at: ctx.time };
  if (ctx.group !== undefined) entry.group = ctx.group;
  if (ctx.note !== undefined) entry.note = ctx.note;
  ledger.marks[id] = entry;
  plan.created.push(id);
  plan.touched.push(id);
  return id;
}

/** Where a `split` marker is in the text that is typed, until it gets its id. A character after
 * it holds the length of the break that follows it, to check that the break is read as long. */
const SPLIT = '\uE000';
const LENGTH = 0xe100;

/** What an edit writes. A line break in typed text is a split (format §3.4): `inner` is what goes
 * in the insertion, and has a `SPLIT` in front of each break in it; `trail` is the breaks after the
 * last text, which go behind the insertion, so that its closer does not start a line. `fenced`:
 * `inner` ends with a fenced code block and a line break after it, and the closer goes alone on the
 * line after the closing fence (format §3.3). */
interface Typing {
  inner: string;
  trail: string;
  fenced?: boolean;
  /** `inner` starts with line breaks typed right after a backslash, written as they are. */
  plain?: boolean;
}

const isEmpty = (typing: Typing) => typing.inner === '' && typing.trail === '';

/** Text to write at a place: where, and what. `extended` is the insertion it became part of.
 * `later` is more text, to go in a second place. */
interface Typed {
  at: number;
  text: string;
  extended?: Container;
  later?: { at: number; text: string };
}

/**
 * The insertion or substitution of the author's that a text typed at `position` becomes part of: one
 * that holds the position, or ends or starts right there. Of several, the one that holds it, then
 * the one that ends there, then the one that starts there; the smallest of them.
 */
function ownContainerAt(plan: Plan, position: number): Container | undefined {
  let best: Container | undefined;
  let bestRank = Infinity;
  let bestSize = Infinity;
  for (const container of plan.containers) {
    if (!container.own || position < container.open.from || position > container.close.to) continue;
    const { content } = container;
    const rank =
      position >= content.from && position <= content.to
        ? 0
        : position === container.close.to
          ? 1
          : 2;
    const size = container.close.to - container.open.from;
    if (rank < bestRank || (rank === bestRank && size < bestSize)) {
      best = container;
      bestRank = rank;
      bestSize = size;
    }
  }
  return best;
}

/**
 * `position` moved out of another person's insertion or substitution, when it is at the edge of
 * its text: typing there goes before or after the mark, and does not split it. Only marks inside
 * `within` count, when given.
 */
function leaveEdge(plan: Plan, position: number, within?: Range, own = false): number {
  for (const container of plan.containers) {
    if (container.own && !own) continue;
    if (within && (container.open.from < within.from || container.close.to > within.to)) continue;
    if (container.content.from === position) return container.open.from;
    if (container.content.to === position) return container.close.to;
  }
  return position;
}

/** The text with other people's marks closed in front of it and opened again after it, and the
 * breaks of `trail` behind the openers: each mark goes on from there, so that no opener starts the
 * line after the breaks (format §3.6). */
function splitAround(containers: readonly Container[], middle: string, trail = ''): string {
  // The innermost closes first and opens last. A segment that is split goes on with the same kind
  // and id and has no payload: its first segment keeps the old text of a substitution.
  const inner = containers.toSorted(
    (a, b) => a.close.to - a.open.from - (b.close.to - b.open.from),
  );
  const closers = inner.map((c) => `<!--/${c.mark.id}-->`).join('');
  const openers = inner
    .toReversed()
    .map((c) => `<!--${c.mark.kind} ${c.mark.id}-->`)
    .join('');
  return closers + middle + openers + trail;
}

/** The step limit of the loops that move a position out of marks: each step crosses a marker. */
function steps(plan: Plan): number {
  return plan.containers.length * 2 + 2;
}

/** Text typed in the author's own insertion or substitution is part of it. Another person's mark
 * inside it is not extended, so it is closed around the text. */
function extend(plan: Plan, own: Container, position: number, typing: Typing): Typed {
  let at = Math.min(Math.max(position, own.content.from), own.content.to);
  for (let step = 0; step < steps(plan); step++) {
    const next = leaveEdge(plan, at, own.content);
    if (next === at) break;
    at = next;
  }
  const around = plan.containers.filter(
    (c) =>
      !c.own &&
      c.open.from >= own.content.from &&
      c.close.to <= own.content.to &&
      c.content.from < at &&
      at < c.content.to,
  );
  plan.touched.push(own.mark.id);
  plan.split.push(...around.map((c) => c.mark.id));
  // Breaks after the text go behind the insertion when the text ends it: its closer would start
  // the line that follows.
  const behind = at === own.content.to && typing.trail !== '';
  const typed: Typed = {
    at,
    text: splitAround(around, typing.inner, behind ? '' : typing.trail),
    extended: own,
  };
  if (behind) typed.later = { at: own.close.to, text: typing.trail };
  return typed;
}

/** `position` moved to the right over the markers that stand there on the same line: what the
 * text shows is the same, and none of them is left at the start of the line that a break starts.
 * A split keeps its place, because its break follows it; so does an opener with a carrier. */
function pastMarkers(plan: Plan, position: number): number {
  let at = position;
  for (let step = 0; step < plan.markers.length; step++) {
    const marker = plan.markers.find(
      (m) =>
        m.from === at &&
        m.role !== 'ledger' &&
        m.mark?.kind !== 'split' &&
        !plan.text.slice(m.from, m.to).includes('\n'),
    );
    if (!marker) break;
    at = marker.to;
  }
  return at;
}

/** The place for breaks that are typed with no text: after the markers that stand there, so that
 * none of them starts the new line, where a renderer would read the rest of it as raw HTML
 * (format §3.2). A marker after spaces would start it as well: it gets a line of its own when the
 * break has a blank line (a new block), and otherwise the break is refused. */
function breakPosition(plan: Plan, position: number, trail: string): number {
  const at = pastMarkers(plan, position);
  const marker = plan.markers.find((m) => m.role !== 'ledger' && m.from > at);
  const block = /\n[ \t>]*\r?\n/.test(trail);
  if (!block && marker && /^[ \t]+$/.test(plan.text.slice(at, marker.from))) {
    throw new EditError(
      'A line break here would leave a change marker at the start of the new line.',
      'no-legal-placement',
    );
  }
  return at;
}

/** What typing `typing` at `position` writes: part of the author's own insertion, or a new
 * insertion, which splits the insertions and substitutions of other people around it. Breaks
 * with no text are splits alone. */
function typeAt(plan: Plan, position: number, typing: Typing): Typed {
  if (typing.inner === '') {
    return { at: breakPosition(plan, position, typing.trail), text: typing.trail };
  }
  let at = position;
  for (let step = 0; step < steps(plan); step++) {
    const own = ownContainerAt(plan, at);
    if (own) return extend(plan, own, at, typing);
    const next = leaveEdge(plan, at);
    if (next === at) break;
    at = next;
  }
  const around = plan.containers.filter((c) => !c.own && c.content.from < at && at < c.content.to);
  plan.split.push(...around.map((c) => c.mark.id));
  const id = newMark(plan);
  return {
    at,
    text: splitAround(around, `<!--ins ${id}-->${typing.inner}<!--/${id}-->`, typing.trail),
  };
}

/** A stretch of visible text between markers, and the insertion or substitution it is in. `how`
 * is set for the break of a split that the call takes the break of. */
interface Piece {
  from: number;
  to: number;
  text: string;
  container: Container | undefined;
  how?: 'cancel' | 'join';
}

function innermost(plan: Plan, from: number, to: number): Container | undefined {
  let best: Container | undefined;
  for (const container of plan.containers) {
    const { content } = container;
    if (content.from > from || to > content.to) continue;
    if (!best || content.to - content.from < best.content.to - best.content.from) best = container;
  }
  return best;
}

/** The visible text of `[from, to)`: what lies between the markers. */
function piecesIn(plan: Plan, from: number, to: number): Piece[] {
  const pieces: Piece[] = [];
  let cursor = from;
  const add = (end: number) => {
    if (end <= cursor) return;
    const text = plan.text.slice(cursor, end);
    pieces.push({ from: cursor, to: end, text, container: innermost(plan, cursor, end) });
  };
  for (const marker of plan.markers) {
    if (marker.to <= from) continue;
    if (marker.from >= to) break;
    add(marker.from);
    cursor = Math.max(cursor, marker.to);
  }
  add(to);
  // The break of a split starts a piece, behind the marker; it is a piece of its own.
  return pieces.flatMap((piece) => {
    const unit = plan.units.find((u) => u.how !== undefined && u.marker.to === piece.from);
    if (!unit || piece.to < unit.end) return [piece];
    const split = (a: number, b: number, how?: 'cancel' | 'join'): Piece => ({
      ...piece,
      from: a,
      to: b,
      text: plan.text.slice(a, b),
      ...(how ? { how } : {}),
    });
    const wanted = split(piece.from, unit.end, unit.how);
    return piece.to > unit.end ? [wanted, split(unit.end, piece.to)] : [wanted];
  });
}

/** What a stretch of the range becomes. `isBreak` is the deleted break of another person's split,
 * which is a deletion of its own, right after the marker. */
type Item =
  | { from: number; to: number; kind: 'remove' | 'shell' }
  | { from: number; to: number; kind: 'delete'; text: string; isBreak?: true }
  | { from: number; to: number; kind: 'absorbed'; text: string; id: string };

type Deleted = Extract<Item, { kind: 'delete' | 'absorbed' }>;

function isDeleted(item: Item): item is Deleted {
  return item.kind === 'delete' || item.kind === 'absorbed';
}

/** The author's deletions that touch deleted text, and those that touch them in turn: a new
 * deletion next to one of the author's own is part of it (format §3.9). */
function absorbDeletions(plan: Plan, items: Item[]): void {
  const taken = new Set<OwnDeletion>();
  for (let grew = true; grew;) {
    grew = false;
    for (const old of plan.ownDeletions) {
      if (taken.has(old)) continue;
      // The deleted break of a split stands alone, after its marker.
      const touches = items.some(
        (i) =>
          isDeleted(i) &&
          !(i.kind === 'delete' && i.isBreak) &&
          (i.to === old.from || i.from === old.to),
      );
      if (!touches) continue;
      taken.add(old);
      items.push({ from: old.from, to: old.to, kind: 'absorbed', text: old.text, id: old.id });
      grew = true;
    }
  }
}

/**
 * The changes that delete the pieces. Text in the author's own insertion is removed, and the
 * insertion with it when nothing is left. Other text is written to a deletion: one deletion for
 * each run of text that nothing separates, which is the author's own deletion next to it when
 * there is one, and otherwise one new deletion for all the runs, in segments.
 */
function deletionChanges(
  plan: Plan,
  pieces: readonly Piece[],
  options: { extended?: Container | undefined; merge: boolean },
): TextChange[] {
  const items: Item[] = pieces.map((piece): Item => {
    if (piece.how === 'join') {
      return { from: piece.from, to: piece.to, kind: 'delete', text: piece.text, isBreak: true };
    }
    return piece.how === 'cancel' || piece.container?.own
      ? { from: piece.from, to: piece.to, kind: 'remove' }
      : { from: piece.from, to: piece.to, kind: 'delete', text: piece.text };
  });
  // A split of the author's own that is cancelled goes with its break.
  for (const piece of pieces) {
    const unit = plan.units.find((u) => u.how === 'cancel' && u.marker.to === piece.from);
    if (piece.how === 'cancel' && unit) {
      items.push({ from: unit.marker.from, to: unit.marker.to, kind: 'shell' });
    }
  }
  // An insertion of the author's own that nothing is left in goes, with its markers. One that has
  // nothing left but splits of the author's own goes too, and the splits stay: they are changes of
  // their own, and a closer behind a break would start a line.
  const gone = items
    .filter((item) => item.kind === 'remove' || item.kind === 'shell')
    .toSorted((a, b) => a.from - b.from);
  /** What of `[from, to)` the removals leave. */
  const left = (from: number, to: number): Range[] => {
    const rest: Range[] = [];
    let at = from;
    for (const item of gone) {
      if (item.to <= at) continue;
      if (item.from >= to) break;
      if (item.from > at) rest.push({ from: at, to: item.from });
      at = Math.max(at, item.to);
    }
    if (at < to) rest.push({ from: at, to });
    return rest;
  };
  const ownSplits = splitUnits(plan).filter((unit) => unit.own);
  for (const c of plan.containers) {
    if (!c.own || c.mark.kind !== 'ins' || c === options.extended) continue;
    if (c.content.to <= c.content.from) continue;
    // Something of it is taken out by this change.
    if (!gone.some((g) => g.from >= c.content.from && g.to <= c.content.to)) continue;
    const rest = left(c.content.from, c.content.to);
    const splitsOnly = rest.every((range) =>
      ownSplits.some((unit) => unit.marker.from === range.from && unit.end === range.to),
    );
    if (splitsOnly) {
      items.push(
        { from: c.open.from, to: c.open.to, kind: 'shell' },
        { from: c.close.from, to: c.close.to, kind: 'shell' },
      );
    }
  }
  // A substitution of the author's own whose new text is its old text again changes nothing, as
  // when the text typed after one Enter is deleted (format §3.6): it goes, and its old text stays
  // where it is, plain. Its markers go; the text left between them is that old text.
  for (const c of plan.containers) {
    if (!c.own || c.mark.kind !== 'sub' || c.mark.segments.length !== 1) continue;
    if (!gone.some((g) => g.from >= c.content.from && g.to <= c.content.to)) continue;
    const rest = left(c.content.from, c.content.to);
    const between = (range: Range) =>
      plan.markers.some((m) => m.from < range.to && m.to > range.from);
    if (rest.some(between)) continue;
    const kept = rest.map((range) => plan.text.slice(range.from, range.to)).join('');
    if (kept.replaceAll('\r\n', '\n') !== (c.mark.segments[0]?.payload ?? c.mark.payload)) continue;
    items.push(
      { from: c.open.from, to: c.open.to, kind: 'shell' },
      { from: c.close.from, to: c.close.to, kind: 'shell' },
    );
  }
  const moved = options.merge ? joinSplits(plan, items, ownSplits) : [];
  if (options.merge) absorbDeletions(plan, items);

  const runs: Item[][] = [];
  for (const item of items.toSorted((a, b) => a.from - b.from)) {
    const run = runs.at(-1);
    const apart = item.kind === 'delete' && item.isBreak;
    const last = run?.at(-1);
    const alone = last?.kind === 'delete' && last.isBreak;
    if (run && last?.to === item.from && !apart && !alone) run.push(item);
    else runs.push([item]);
  }
  const changes: TextChange[] = [];
  let sharedId: string | undefined;
  for (const run of runs) {
    const parts = run.filter(isDeleted);
    const first = run[0];
    const last = run.at(-1);
    if (!first || !last) continue;
    let insert = '';
    if (parts.length > 0) {
      const joined = parts.find((p) => p.kind === 'absorbed');
      const id = joined?.kind === 'absorbed' ? joined.id : (sharedId ??= newMark(plan));
      if (joined) plan.touched.push(id);
      const text = parts.map((p) => p.text).join('');
      insert = `<!--del ${id} ${encodePayload(text)}-->`;
    }
    changes.push({ from: first.from, to: last.to, insert });
  }
  return [...changes, ...moved];
}

/**
 * Two splits of the author's own that a deletion brings together, the second right behind the
 * break of the first, are joined as Enter makes them (format §3.4): the first's break takes the
 * second's in, as far as it reads, and the second's marker goes, or moves behind it with the rest
 * of its break, as behind a paragraph break. That is what deleting all the text typed on the blank
 * line of a paragraph break does. Alone on the line after the first's line break, the second split
 * would make that line blank once it was accepted, and rejecting the first would then take both
 * line breaks away. Where the first's break takes no more, nothing is joined. Returns the markers
 * that move, as changes that write them again.
 */
function joinSplits(plan: Plan, items: Item[], ownSplits: readonly SplitUnit[]): TextChange[] {
  // What leaves the file: text of the author's own, and markers. A deletion stays in it.
  const gone = items
    .filter((item) => item.kind === 'remove' || item.kind === 'shell')
    .toSorted((a, b) => a.from - b.from || a.to - b.to);
  const end = gone.at(-1)?.to;
  if (end === undefined) return [];
  const goes = (range: Range) => gone.some((g) => g.from <= range.from && range.to <= g.to);
  /** Whether all of `[from, to)` is taken away. */
  const cleared = (from: number, to: number) => {
    let at = from;
    for (const item of gone) {
      if (item.to <= at) continue;
      if (item.from > at) return false;
      at = item.to;
      if (at >= to) return true;
    }
    return at >= to;
  };
  const { text } = plan;
  const moved: TextChange[] = [];
  for (const first of ownSplits) {
    if (!gone.some((g) => g.from === first.end) || goes(first.marker)) continue;
    const second = ownSplits.find(
      (u) => u.marker.from > first.end && u.marker.from <= end && cleared(first.end, u.marker.from),
    );
    if (!second || goes(second.marker)) continue;
    const own = first.end - first.marker.to;
    const joined =
      text.slice(first.marker.to, first.end) + text.slice(second.marker.to, second.end);
    const rest = joined + text.slice(second.end, second.end + 200);
    const read = breakLength(linePrefixAt(text, first.marker.to), rest);
    if (read <= own) continue;
    items.push({ from: second.marker.from, to: second.marker.to, kind: 'shell' });
    plan.breaks.set(first.id, Math.min(read, joined.length));
    plan.touched.push(first.id);
    if (read < joined.length) {
      const at = second.marker.to + read - own;
      moved.push({ from: at, to: at, insert: text.slice(second.marker.from, second.marker.to) });
      plan.breaks.set(second.id, second.end - at);
      plan.touched.push(second.id);
    }
  }
  return moved;
}

/** A replacement that is one run of text with no marker in it. */
function replaceOne(plan: Plan, piece: Piece, typing: Typing): TextChange {
  if (piece.container?.own) {
    plan.touched.push(piece.container.mark.id);
    return { from: piece.from, to: piece.to, insert: typing.inner + typing.trail };
  }
  const id = newMark(plan);
  const old = encodePayload(piece.text);
  return {
    from: piece.from,
    to: piece.to,
    insert: `<!--sub ${id} ${old}-->${typing.inner}<!--/${id}-->${typing.trail}`,
  };
}

/** Whether replacing `[from, to)` by `typing` is one substitution of a piece of text of the file. */
function soleReplace(plan: Plan, from: number, to: number, typing: Typing): boolean {
  const pieces = piecesIn(plan, from, to);
  const [only] = pieces;
  return (
    typing.inner !== '' &&
    pieces.length === 1 &&
    only !== undefined &&
    !only.how &&
    only.from === from &&
    only.to === to
  );
}

function replaceRange(plan: Plan, from: number, to: number, typing: Typing): void {
  const pieces = piecesIn(plan, from, to);
  const [only] = pieces;
  if (soleReplace(plan, from, to, typing) && only) {
    plan.changes.push(replaceOne(plan, only, typing));
    return;
  }
  // The new text comes after the old, where the range ends.
  const typed = isEmpty(typing) ? undefined : typeAt(plan, to, typing);
  const changes = deletionChanges(plan, pieces, {
    extended: typed?.extended,
    merge: isEmpty(typing),
  });
  if (typed) {
    const host = changes.find((change) => change.to === typed.at);
    if (host) host.insert += typed.text;
    else changes.push({ from: typed.at, to: typed.at, insert: typed.text });
    if (typed.later) {
      changes.push({ from: typed.later.at, to: typed.later.at, insert: typed.later.text });
    }
  }
  plan.changes.push(...changes);
}

const FRONT_MATTER = "Front matter can't be edited with Track Changes on yet.";

/** A piece of typed text: text, or a line break with the prefix of the next line (format §3.4).
 * `prefix` is the container prefix of the line the break ends. A fenced code block is one piece
 * of text with a line break after it (`fence`): no marker goes inside it (format §3.5), and none
 * after the closing fence on its line, where a renderer would no longer read it as one. */
type Token = { text: string; fence?: boolean } | { brk: string; prefix: string };

/** A line of typed text that opens a fenced code block, after the container prefix of its line:
 * up to three spaces, the fence, and the info string, which can't hold a backtick if the fence is
 * made of them. A tab or four spaces make indented code instead. */
const FENCE_OPEN = /^( {0,3})(`{3,}|~{3,})([^\r\n]*)$/;
/** A line that may be a fence, after the container prefix of its line, however indented. */
const FENCE_LIKE = /^[ \t]*(?:`{3,}|~{3,})/;
/** A container prefix whose content column is known: quote markers with one space after them (but
 * the last), and list markers with one space after them. */
const PLAIN_CONTAINER = /^(?:> |(?:[-*+]|\d{1,9}[.)]) )*>?$/;
/** The first list marker of a line, after its quote markers: the number of an ordered one. */
const FIRST_ITEM = /^((?:[ \t]*>[ ]?)*)([ \t]*)(?:[-*+]|(\d{1,9})[.)])([ \t]+)/;

/**
 * Whether the list item that the container `prefix` of a line starts, if it starts one, is an item:
 * an ordered one numbered other than 1 can't interrupt a paragraph (CommonMark), so it is text
 * unless a blank line comes before it (`blankBefore`) or the line before (`above`) is an item of
 * the list that it goes on, whose content starts to the right of its marker.
 */
function startsItem(prefix: string, blankBefore: boolean, above: string): boolean {
  const item = FIRST_ITEM.exec(prefix);
  if (!item || item[3] === undefined || Number(item[3]) === 1 || blankBefore) return true;
  const column = (item[1] ?? '').length + (item[2] ?? '').length;
  const before = FIRST_ITEM.exec(above);
  return (
    before !== null &&
    (before[1] ?? '').split('>').length === (item[1] ?? '').split('>').length &&
    before[0].length > column
  );
}

/** A container prefix with the spaces after its last list marker that its item's content starts
 * after (CommonMark: one to four), taken from `rest`, the line after it. Undefined when five or more
 * follow, or a tab, which make indented code of the rest. */
function withItemSpaces(prefix: string, rest: string): string | undefined {
  if (!/(?:[-*+]|\d[.)]) $/.test(prefix)) return prefix;
  const spaces = /^[ \t]*/.exec(rest)?.[0] ?? '';
  if (spaces.includes('\t') || spaces.length > 3) return undefined;
  return prefix + spaces;
}

/** Why typed text with a fence in it is refused. */
const FENCE_REFUSED =
  "This code block can't be added as a tracked change here. Add it whole, from its opening fence to its closing one, and with a blank line after it in a list or a quote.";

/**
 * The fenced code block that opens on the line of `typed` that starts at `at`, after `container`,
 * the container prefix of that line, as CommonMark reads it: where it ends, at the end of the line
 * of its closing fence, and the prefix that the line after it needs to stay in the same container.
 * Every line of the block has that prefix, or is blank in the same container, and the closing
 * fence is the opening one's character, at least as long, after up to three spaces. Undefined when
 * that can't be told for sure:
 *
 * - a closing fence that ends `typed` closes the block only when the line goes on with nothing
 *   after the typed text (`lineEndsAfter`);
 * - in a list or a quote, the line after the block must be blank (`blankAfter` at the end of the
 *   typed text), or the line break written before the closer would part the block from it with a
 *   blank line, which can make a tight list loose, an enclosing one too.
 */
function fencedBlock(
  typed: string,
  at: number,
  container: string,
  where: TypedAt,
): { end: number; prefix: string } | undefined {
  const open = FENCE_OPEN.exec(typed.slice(at, lineEnd(typed, at)));
  const run = open?.[2];
  if (!run || (run.startsWith('`') && open[3]?.includes('`'))) return undefined;
  const prefix = continuationPrefix(container);
  const quoted = prefix.trimEnd();
  for (let start = typed.indexOf('\n', at) + 1; start > 0; start = typed.indexOf('\n', start) + 1) {
    const end = lineEnd(typed, start);
    const line = typed.slice(start, end);
    if (/^[ \t>]*$/.test(line)) {
      if (!line.startsWith(quoted) || /[>]/.test(line.slice(quoted.length))) return undefined;
      continue;
    }
    if (!line.startsWith(prefix)) return undefined;
    const inner = line.slice(prefix.length);
    const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(inner)?.[1];
    if (close?.startsWith(run.charAt(0)) && close.length >= run.length) {
      const last = end === typed.length;
      if (last && where.rest.trim() !== '') return undefined;
      const after = last ? where.following : followingLine(typed, end, where);
      // In a list or a quote, a blank line must follow: the line after the closing fence, typed
      // or the text that follows the typed text on its line, has nothing but the quote markers of
      // the block's container (`>` is a quote of its own in a list). Nowhere may indented code
      // follow.
      const next = typed.slice(end).replace(/^\r?\n/, '');
      const newline = next.indexOf('\n');
      const line = newline === -1 ? next + where.rest : next.slice(0, newline);
      const blank = last
        ? where.blankAfter
        : line.replace(/\r$/, '').startsWith(quoted) &&
          /^[ \t]*$/.test(line.replace(/\r$/, '').slice(quoted.length));
      if (prefix !== '' && !blank) return undefined;
      if (after !== undefined && indentedCode(after, prefix)) return undefined;
      return { end, prefix };
    }
    // A line of the code that a reader could take for a fence of indented code, were the block's
    // opening fence taken away by a decision: the scan and a renderer may read it otherwise.
    if (/^(?: {4}| {0,3}\t)[ \t]*(?:`{3,}|~{3,})/.test(inner)) return undefined;
  }
  return undefined;
}

/** Whether a line after a block would be indented code: four columns of indentation, or a tab,
 * after `prefix`, the container prefix of the block's lines, or after its quote markers when it
 * is not in that container. */
function indentedCode(line: string, prefix: string): boolean {
  const rest = line.startsWith(prefix)
    ? line.slice(prefix.length)
    : line.slice(/^(?:[ \t]*>[ \t]?)*/.exec(line)?.[0].length ?? 0);
  return /^(?: {4}| {0,3}\t)/.test(rest);
}

/** The first line with text after the line of `typed` that ends at `end`: a line of the typed
 * text, the last of them with the text after it on its line, or the line after the typed text. */
function followingLine(typed: string, end: number, where: TypedAt): string | undefined {
  for (
    let start = typed.indexOf('\n', end) + 1;
    start > 0;
    start = typed.indexOf('\n', start) + 1
  ) {
    const stop = lineEnd(typed, start);
    const line = typed.slice(start, stop) + (stop === typed.length ? where.rest : '');
    if (!/^[ \t>]*$/.test(line)) return line;
    if (stop === typed.length) return where.following;
  }
  return where.rest.trim() === '' ? where.following : where.rest;
}

/** Where a typed text stands, for its fences: `prefix` is what stands before it on its line, when
 * that is nothing but a container prefix, so that the text starts the line's text. */
interface TypedAt {
  prefix?: string;
  /** What comes before the typed text on its line, without markers. */
  before: string;
  /** The line above the one the typed text starts on, without markers, if there is one. */
  above?: string;
  /** What follows the typed text on its line, without markers. */
  rest: string;
  /** The line after the one the typed text ends on is blank, or there is none. */
  blankAfter: boolean;
  /** The first line with text after the one the typed text ends on, if there is one. */
  following?: string;
}

/**
 * The typed text as text and breaks. `linePrefix` is the container prefix of the line it goes in.
 * A fenced code block is one piece (`fencedBlock`); a line that may be a fence and is not one of
 * those is refused, as a fence that its markers would keep open or put inside code.
 *
 * @throws EditError when a line of the typed text may be a fence that is not a whole block.
 */
function tokenize(typed: string, linePrefix: string, where?: TypedAt): Token[] {
  const tokens: Token[] = [];
  const eol = typed.includes('\r\n') ? '\r\n' : '\n';
  let prefix = linePrefix;
  let at = 0;
  // Whether `at` starts the text of a line, and the container prefix of that line when it is
  // known: the prefix of the line the typed text goes in, when that is quote and list markers
  // alone; after a break, the container of the line before as far as the next line goes on with
  // it, or the markers that the break takes, or nothing.
  let lineStarts = where?.prefix !== undefined;
  let container =
    PLAIN_CONTAINER.test(linePrefix) &&
    startsItem(
      linePrefix,
      where?.above === undefined || /^[ \t>]*$/.test(where.above),
      where?.above ?? '',
    )
      ? linePrefix
      : undefined;
  // How much of the line after `at` belongs to its container.
  let skip = 0;
  if (container !== undefined && lineStarts) {
    container = withItemSpaces(container, typed);
    skip = container === undefined ? 0 : container.length - linePrefix.length;
  }
  for (;;) {
    if (where && lineStarts) {
      const block =
        container === undefined ? undefined : fencedBlock(typed, at + skip, container, where);
      if (block) {
        tokens.push({ text: typed.slice(at, block.end) + eol + block.prefix, fence: true });
        prefix = linePrefixAt(typed, block.end);
        at = block.end;
      } else if (FENCE_LIKE.test(typed.slice(at + skip, lineEnd(typed, at)))) {
        throw new EditError(FENCE_REFUSED, 'no-legal-placement');
      }
    }
    const newline = typed.indexOf('\n', at);
    if (newline === -1) break;
    const end = newline > at && typed[newline - 1] === '\r' ? newline - 1 : newline;
    const syntax = HARD_BREAK.exec(typed.slice(at, end))?.[0] ?? '';
    const start = end - syntax.length;
    const length = breakLength(prefix, typed.slice(start));
    if (start > at) tokens.push({ text: typed.slice(at, start) });
    const brk = typed.slice(start, start + length);
    tokens.push({ brk, prefix });
    // The line the break ends, for whether the next line goes on its list.
    const begin = start === 0 ? -1 : typed.lastIndexOf('\n', start - 1);
    const above =
      begin === -1 ? (where?.before ?? '') + typed.slice(0, start) : typed.slice(begin + 1, start);
    prefix = linePrefixAt(brk, brk.length);
    at = Math.max(start + length, at + 1);
    lineStarts = true;
    const taken = brk.slice(brk.lastIndexOf('\n') + 1);
    const goesOn = container === undefined ? undefined : continuationPrefix(container);
    const line = taken + typed.slice(at, lineEnd(typed, at));
    if (goesOn !== undefined && goesOn.startsWith(taken) && line.startsWith(goesOn)) {
      container = goesOn;
    } else if (
      (taken === '' || (PLAIN_CONTAINER.test(taken) && /[^ \t]/.test(taken))) &&
      startsItem(taken, /\n[ \t>]*\r?\n/.test(brk), above)
    ) {
      container = withItemSpaces(taken, typed.slice(at));
    } else container = undefined;
    skip = container === undefined ? 0 : container.length - taken.length;
  }
  if (at < typed.length) tokens.push({ text: typed.slice(at) });
  if (where) wholeIndentedCode(tokens, linePrefix, where, eol);
  return tokens;
}

/** Whether a line break holds a blank line. */
const BLANK_IN_BREAK = /\n[ \t>]*\r?\n/;

/** Whether a token is a line of indented code: text indented four spaces past where the text of
 * its container starts, after the prefix the break before it takes. */
const isCodeLine = (token: Token | undefined): boolean =>
  token !== undefined && 'text' in token && token.fence !== true && /^ {4}/.test(token.text);

/**
 * When the typed text ends with an indented code block, as CommonMark reads it there, or a blank
 * line in it follows one, the block is one piece, as a fenced one is, with the line break after it
 * and the prefix of its container, so that no split stands in it and the closer, or the split of
 * the line break after it, goes alone on the line after it (format §3.3): written at the end of its
 * last line, either would be code. Its lines are indented four spaces past where the text of their
 * container starts, with blank lines between them, back to a blank line in the typed text, or to
 * its start at the start of a line with a blank line or no line above it; nothing follows the last
 * one on its line, and in a list or a quote a blank line comes after it, as after a fence. Any
 * other code is refused (`inside-code`).
 */
function wholeIndentedCode(tokens: Token[], linePrefix: string, where: TypedAt, eol: string): void {
  for (let last = tokens.length - 1; last >= 0; last--) {
    if (!isCodeLine(tokens[last])) continue;
    // The first line of the block, and the container of its lines: what the break before its last
    // line takes of the line, or the prefix of the line the typed text starts on.
    let first = last;
    let container: string | undefined;
    for (let i = last - 1; ; i -= 2) {
      if (i < 0) {
        const above = where.above;
        if (where.prefix === undefined || (above !== undefined && !/^[ \t>]*$/.test(above))) return;
        container ??= linePrefix;
        break;
      }
      const brk = tokens[i];
      if (!brk || !('brk' in brk)) return;
      container ??= brk.brk.slice(brk.brk.lastIndexOf('\n') + 1);
      // A blank line goes on with the code when a line of it comes before; a line of text that the
      // code would go on reads it as no code.
      const code = isCodeLine(tokens[i - 1]);
      if (BLANK_IN_BREAK.test(brk.brk) && !code) break;
      if (!code) return;
      first = i - 1;
    }
    if (continuationPrefix(container) !== container) return;
    // At the end of the typed text, nothing follows on its line; before more of it, a blank line.
    const next = tokens[last + 1];
    const blankAfter = next && 'brk' in next ? BLANK_IN_BREAK.test(next.brk) : where.blankAfter;
    if (next === undefined && where.rest.trim() !== '') return;
    if (tokens.slice(last + 1).some((token) => 'text' in token) && !blankAfter) return;
    if (container !== '' && !blankAfter) return;
    const lines = tokens
      .slice(first, last + 1)
      .map((token) => ('text' in token ? token.text : token.brk));
    tokens.splice(first, last + 1 - first, { text: lines.join('') + eol + container, fence: true });
    last = first;
  }
}

/** What the tokens write: breaks before the last text are in the insertion, those after it behind. */
function typingOf(tokens: readonly Token[]): Typing {
  const lastText = tokens.findLastIndex((token) => 'text' in token);
  const part = (token: Token) =>
    'text' in token
      ? token.text
      : SPLIT + String.fromCharCode(LENGTH + token.brk.length) + token.brk;
  const last = tokens[lastText];
  return {
    inner: tokens
      .slice(0, lastText + 1)
      .map(part)
      .join(''),
    trail: tokens
      .slice(lastText + 1)
      .map(part)
      .join(''),
    ...(last && 'fence' in last && last.fence ? { fenced: true } : {}),
  };
}

/**
 * A change that touches a break takes all of it, with the prefix of the next block: a deletion
 * never leaves a bullet or a `#` behind a marker, and a join takes the break and the prefix of the
 * second block (format §3.4). A point inside a break moves to its start. A change that starts in
 * front of the prefix of a block, or in it, and goes on past it, changes the text after the prefix,
 * and the prefix stays: the block keeps its type.
 *
 * A change that is inside the prefix of a block, such as a number that is replaced by the next one,
 * does not touch the line break in front of it; the marker can't stand in the prefix, so the change
 * is widened to the start of the break and to the end of the prefix, and the text that comes into it
 * is typed again on either side: `lead` before what is typed, `kept` after.
 *
 * The break after the text of a setext heading holds its underline (`breakLength`), but a change
 * that starts inside the underline or behind it, and does not take all of it, does not touch the
 * heading's own text: it starts behind the underline, where no marker may stand, and is refused.
 */
function coverBreaks(plan: Plan, from: number, to: number): Range & { kept: string; lead: string } {
  let kept = '';
  let lead = '';
  // The first line of the file has no break in front of it.
  const first = from < to ? prefixEnd(plan, from) : undefined;
  if (first !== undefined && to > first) from = first;
  for (const found of breaksOfBody(plan, from, to)) {
    const prefix = lineStart(plan.text, found.end);
    if (from === to) {
      // Text typed in the prefix of a block goes after it. Text typed in the blank lines between
      // two blocks stays where it is: it is a block of its own (format §3.4).
      if (prefix < from && from < found.end) {
        from = found.end;
        to = from;
      }
    } else if (found.end > from && found.start < to) {
      // From the very start of a line with a prefix, past the prefix, is a change of the block's
      // text, and does not touch the break in front of it.
      const insidePrefix = from >= prefix && prefix < found.end;
      // Not when the break is the author's own split's: the split branch below cancels it, and
      // the break must not go with it.
      if (
        insidePrefix &&
        to <= found.end &&
        from > found.start &&
        !splitUnits(plan).some((u) => u.own && u.marker.to === found.start)
      ) {
        // Inside the prefix: the line break stays, and so do the rest of the prefix on either side.
        lead = visibleText(plan.text, plan.markers, found.start, from);
        kept = visibleText(plan.text, plan.markers, to, found.end);
        from = found.start;
        to = found.end;
        continue;
      }
      if (from > found.start && (from > prefix || (insidePrefix && to > found.end))) {
        from = found.end;
      } else {
        // A range that starts inside the underline of a setext heading that the break holds, or
        // behind it, and does not take all of it, starts behind it: the underline is the heading's
        // own, and a deletion that took it would leave a paragraph (#372). No marker may stand
        // there, so the change is refused.
        const under = from > found.start ? underlineOfBreak(plan.text, found.start) : undefined;
        const partly = under !== undefined && !(from <= lineStart(plan.text, under) && to >= under);
        from = partly ? under : Math.min(from, found.start);
      }
      // The rest of a prefix that the range ends in is written again after what replaces it.
      if (to > prefix && to < found.end) kept = plan.text.slice(to, found.end);
      to = Math.max(to, found.end);
    }
  }
  return { from, to, kept, lead };
}

/**
 * Where the text of a block starts, when `position` is in front of its prefix (`- `, `> `, `## `),
 * at the start of its line, or in the prefix: after it. Undefined for any other position.
 */
function prefixEnd(plan: Plan, position: number): number | undefined {
  const { text } = plan;
  const found = breaksOfBody(plan, position, position).find(
    (b) => lineStart(text, b.end) <= position && position < b.end,
  );
  if (found) return found.end;
  // The first line of the body has no break in front of it: of the file, or after front matter.
  const start = plan.bodyStart;
  if (lineStart(text, position) === start) {
    const end = start + breakLength('', `\n${text.slice(start, start + 4096)}`, false) - 1;
    if (position < end) return end;
  }
  return undefined;
}

/** Where the text of the body ends: before the ledger and the line breaks that end the text. */
function bodyEnd(plan: Plan): number {
  let end = plan.parsed.ledgerRange?.from ?? plan.text.length;
  while (end > 0 && /\s/.test(plan.text[end - 1] ?? '')) end--;
  return end;
}

/** Where the body's text ends as CommonMark reads it: before the ledger, and before the spaces,
 * tabs and line breaks in front of it. Other white space, a no-break space or a form feed, is
 * text. */
function textEnd(plan: Plan): number {
  let end = plan.parsed.ledgerRange?.from ?? plan.text.length;
  while (end > 0 && /[ \t\r\n]/.test(plan.text[end - 1] ?? '')) end--;
  return end;
}

/**
 * The breaks between lines of the body, near `from` to `to`: not the one in front of the ledger.
 * The body after front matter is read as a file of its own (format §3.8): no change takes the line
 * break that ends the closing line, and the blank lines after it are the body's leading ones.
 */
function breaksOfBody(plan: Plan, from: number, to: number) {
  const end = bodyEnd(plan);
  return breaksBetween(plan.text, from, to, plan.markers, plan.bodyStart).filter(
    (found) => found.start < end,
  );
}

/**
 * Where the line that holds `position` starts, as the text shows it: a line break inside the
 * carrier of an opener (`- <!--ins k3x9-->⏎  text`) is no line break, and the line starts where the
 * line that holds the opener does.
 */
function visualLineStart(plan: Plan, position: number): number {
  let line = lineStart(plan.text, position);
  for (let step = 0; step <= plan.markers.length; step++) {
    const inside = plan.markers.find((m) => m.from < line && line < m.to);
    if (!inside) break;
    line = lineStart(plan.text, inside.from);
  }
  return line;
}

/** A prefix with its numbers taken out, to tell whether two blocks are items of the same list. */
const shape = (prefix: string): string => prefix.replace(/\d+/g, '#');

/** What a block's first line has in front of its text: a container prefix, then the `#`s of a
 * heading. */
const BLOCK_LEAD =
  /^(?:[ \t]*(?:>|[-*+](?=[ \t])|\d{1,9}[.)](?=[ \t])|\[[ xX]\](?=[ \t])))*[ \t]*(?:#{1,6}[ \t]+)?$/;

/** Whether the last line of `text` is a line break and nothing but the prefix of a block after it
 * (`> `, `6. `, `## `): a marker that follows it starts the line of the block. */
function endsInPrefix(text: string): boolean {
  const lineBreak = text.lastIndexOf('\n');
  return lineBreak !== -1 && BLOCK_LEAD.test(text.slice(lineBreak + 1));
}

/** A range to delete, and the position whose surroundings decide where its marker may go, when that
 * is not the start of the range: the start of a deleted prefix is no place for a marker, but the
 * text of the block that it belongs to is. */
interface Cover extends Range {
  at?: number;
}

/**
 * There are no empty blocks (format §3.4): a deletion of all the text of one or more blocks deletes
 * the blocks, with the break that follows the last one, or the break in front of the first one when
 * it is at the end of the text. The range may start in front of the prefix of the first block
 * (`- `, `> `, `## `), where the text of the block starts, and end anywhere in the break after the
 * last block, up to the start of the line of the block that follows. Returns undefined when the
 * range is not that.
 *
 * What the blocks around the deleted ones have for syntax is never touched. The deleted block has
 * its prefix deleted with it, so that the block that follows does not become a part of it
 * (`## Commands⏎⏎Requires` leaves `Requires`, not a heading), unless that block is the next item of
 * the same list or quote: then the prefix stays in front of the deletion and takes the place of
 * the prefix of the next item, which the deletion takes, because a marker can not stand between
 * two items (`- one`, `- two`, `- three` without `two` leaves `- one`, `- three`).
 *
 * The break after the text of a setext heading holds its underline (`breakLength`), which is the
 * heading's own, and no marker may stand behind it (#372). So the blocks at the end of the text,
 * under a heading, go without the break in front of them, as the only block of a text does (the
 * opener stands where the first of them was, and the blank lines above it stay: the deletion is
 * written as that block's alone, with no break at either end of its payload); a range that starts
 * behind the underline starts at the first of the blocks; and a deleted setext heading takes its
 * own underline, with the break after it.
 */
function coverBlocks(plan: Plan, from: number, to: number): Cover | undefined {
  const { text, markers } = plan;
  const breaks = breaksOfBody(plan, 0, text.length);
  const blocks = breaks.filter((found) => found.block);
  // A range that starts behind a setext heading's underline, in the blank lines under it, and goes
  // on into the block after them starts where that block does: the blank lines stay, as they do in
  // front of the first block of the body, and the underline is not the range's to take (#372).
  const through = breaks.find((found) => found.start < from && from < lineStart(text, found.end));
  if (through && to > through.end) {
    const under = underlineOfBreak(text, through.start);
    if (under !== undefined && under <= from) from = lineStart(text, through.end);
  }
  // The text of the first block starts after its prefix, where a range that starts in front of it,
  // or in it, starts too.
  const start = prefixEnd(plan, from) ?? from;
  const before = blocks.findLast((found) => found.end <= start);
  const firstAfter = blocks.find((found) => lineStart(text, found.end) >= to);
  // What stands in front of the text of the first block on its line: its prefix, with the `#`s of a
  // heading. Indentation that Markdown ignores is no text.
  const line = visualLineStart(plan, start);
  const lead = visibleText(text, markers, line, start);
  // The text starts a block when nothing but its prefix comes between it and the break before it,
  // which may be on the other side of the markers of other marks that start the block.
  const gap = visibleText(text, markers, before?.end ?? Math.min(plan.bodyStart, line), line);
  const starts = gap.trim() === '' && BLOCK_LEAD.test(lead);
  const ends = firstAfter
    ? visibleText(text, markers, to, Math.max(to, firstAfter.start)) === ''
    : visibleText(text, markers, to, bodyEnd(plan)).trim() === '';
  if (!starts || !ends) return undefined;
  const first = lead === '' ? start : line;
  const newlines = (a: number, b: number) => text.slice(a, b).split('\n').length - 1;
  // The break in front of the deleted blocks holds the underline of a setext heading above them
  // (`breakLength`), which is the heading's own: no marker may stand behind it, and a deletion that
  // took it would leave the heading's text a paragraph. That break stays, and does not go with the
  // blocks, as no break does in front of the first block of the body.
  const underlined = before !== undefined && underlineOfBreak(text, before.start) !== undefined;
  if (firstAfter) {
    // The blank lines that follow the first break are part of it: the block starts after them.
    let after = firstAfter;
    // Each block of the chain starts where the one before it ends, so it is no longer than the list.
    for (
      let next = blocks.find((b) => b.start === after.end), n = 0;
      next && n < blocks.length;
      n++
    ) {
      after = next;
      const end = after.end;
      next = blocks.find((b) => b.start === end);
    }
    const next = lineStart(text, after.end);
    const prefix = text.slice(next, after.end);
    const sibling = lead !== '' && CONTAINER_PREFIX.test(lead) && shape(lead) === shape(prefix);
    // The blocks around the deleted ones stay as far apart as the break that is left between them
    // keeps them. When the one after the deleted blocks is the stronger, it stays, and the one in
    // front of them goes: the last item of a list and a paragraph after it. The blank lines at the
    // start of the body are no break between blocks: the break after the deleted ones goes. Not
    // where the break in front of them holds an underline (above), nor where the break after them
    // does, because the deleted block is a setext heading: the deletion would end in front of its
    // underline, and leave it under the block in front, to make a heading of that.
    const keepsAfter =
      before &&
      !underlined &&
      underlineOfBreak(text, firstAfter.start) === undefined &&
      visibleText(text, markers, plan.bodyStart, before.start).trim() !== '' &&
      newlines(before.start, lineStart(text, before.end)) < newlines(firstAfter.start, next);
    if (keepsAfter) return { from: before.start, to: Math.max(firstAfter.start, start) };
    if (sibling) return { from: start, to: after.end };
    return lead === '' ? { from: first, to: next } : { from: first, to: next, at: start };
  }
  if (before && !underlined) return { from: before.start, to };
  return lead === '' ? { from: first, to } : { from: first, to, at: start };
}

/**
 * A deletion of the prefix of the first line of the body alone, a list marker or a quote's `>`
 * with the text after it staying (taking a longer list's or quote's first block out of it, #248):
 * the deleted prefix is the mark's text, and its opener stands where the prefix was, alone on the
 * line, for the text that stays is the block it starts, which the opener's line break and blank
 * line carry (format §3.3). Undefined for any other range.
 */
function firstPrefix(plan: Plan, from: number, to: number): Cover | undefined {
  const { text } = plan;
  if (from !== plan.bodyStart || prefixEnd(plan, from) !== to) return undefined;
  const line = text.slice(from, lineEnd(text, from));
  const prefix = text.slice(from, to);
  if (!FIRST_PREFIX.test(prefix) || line.length === prefix.length) return undefined;
  // A marker right after it (another mark's, which the deletion would join, or a comment's) would
  // stand at the start of the line, with the text after it on the line.
  if (plan.markers.some((marker) => marker.from === to || marker.from < to)) {
    throw new EditError(FIRST_PREFIX_MARK, 'no-legal-placement');
  }
  // The lines below it, up to the next blank line, as the file reads them and as the newest and the
  // original view do: an item that can't interrupt a paragraph (an ordered item that isn't numbered
  // 1, an empty one) or an underline would become a line of the text above it, or make a heading of
  // it. Where the three disagree about those lines (a pending deletion that empties an item reads
  // as text in the file and as an empty item in the view), nothing is written. Where a mark is on
  // them the item's reading is not the file's to rely on either, so only plain lines are let through.
  const reads = [below(text), below(newestView(text).text), below(originalView(text).text)];
  const classes = reads.map((lines) => lines.map(lineClass));
  const agree = classes.every((one) => one.join(' ') === (classes[0] ?? []).join(' '));
  const all = classes.flat();
  if (!agree || all.includes('rule') || (all.includes('unlike') && markedBelow(plan, from))) {
    throw new EditError(FIRST_PREFIX_BELOW, 'no-legal-placement');
  }
  return { from, to, at: to };
}

/** The first prefix of a body that is taken out of it: a marker, and a task item's box. */
const FIRST_PREFIX = /^[ \t]*(?:[-+*]|\d{1,9}[.)]|>)[ \t]*(?:\[[ xX]\][ \t]+)?$/;

/** Why a first prefix with another mark right after it can't be taken out. */
const FIRST_PREFIX_MARK =
  'This line starts with a pending change, which would be left at the start of the line. Accept or reject it first, or take the marker out with Track Changes off.';

/** Why a first prefix can't be taken out over the lines below it. */
const FIRST_PREFIX_BELOW =
  'The next lines would read as part of this text without the marker, or read differently with the pending changes in them. Accept or reject the changes below first, or take the marker out with Track Changes off.';

/** The lines of a view after its first line, up to the next blank line, without their CRs. */
function below(view: string): string[] {
  const lines = view.split('\n').map((l) => l.replace(/\r$/, ''));
  const found: string[] = [];
  for (const l of lines.slice(1)) {
    if (/^[ \t>]*$/.test(l)) break;
    found.push(l);
  }
  return found;
}

/** How a line below reads: an item that can't interrupt a paragraph, an underline or rule, other. */
function lineClass(line: string): 'unlike' | 'rule' | 'other' {
  if (/^[ \t>]*(?:=+|-{2,}|[*_]{3,})[ \t]*$/.test(line)) return 'rule';
  const item = /^[ \t>]*(?:(\d{1,9})[.)]|[-+*])(?:[ \t]|$)/.exec(line);
  if (!item) return 'other';
  // An empty item, of any number, can't interrupt a paragraph either.
  if (/^[ \t>]*(?:\d{1,9}[.)]|[-+*])[ \t]*$/.test(line)) return 'unlike';
  return item[1] !== undefined && item[1] !== '1' ? 'unlike' : 'other';
}

/** Whether a marker stands on the lines after the first one, up to the next blank line. */
function markedBelow(plan: Plan, from: number): boolean {
  const { text } = plan;
  let at = nextLineStart(text, from);
  for (; at < text.length; at = nextLineStart(text, at)) {
    const row = text.slice(at, lineEnd(text, at));
    if (/^[ \t>]*$/.test(row)) return false;
    if (row.includes('<!--')) return true;
  }
  return false;
}

/**
 * A deletion of the whole first line of a block that goes on takes the line break after it, with the
 * indentation of the next line. A marker that is alone on its line in front of the lines of a block
 * is the opener of the mark that starts the block (format §3.3), and would take the line break for
 * its own: it is not text of the deleted line, but it would be lost from both views.
 */
function coverLine(plan: Plan, from: number, to: number): Range {
  const { text, markers } = plan;
  const next = breaksOfBody(plan, from, to).find((b) => b.start >= to);
  // The range starts where the text of a block does.
  const starts = lineStartKind(text, from, markers) === 'block';
  if (!starts || !next || next.block || visibleText(text, markers, to, next.start) !== '') {
    return { from, to };
  }
  return { from, to: next.end };
}

/** The refusal of a marker that would start a line of a paragraph (format §3.2). */
const MARKER_STARTS_LINE = 'A marker here would start a line.';

/** Why a deletion that starts at the beginning of a wrapped line, and is not all the text of lines
 * of one paragraph (`wrappedLineStart`), is refused: what to do instead. */
const WRAPPED_LINE_START =
  'This deletion starts at the beginning of a line that goes on a paragraph, where its marker would start the line, and Markdown would read the start of a block there. Start the selection at the end of the line above, so that the line break goes with the deleted text, or leave the first word of the line out of it.';

/** The message of a replacement that would leave a line with no text, which can't be written. */
const BLANK_LINE =
  'This would leave a line with nothing but white space on it, and the marker of a deletion alone on its line takes the line break after it for its own. Take the line out with its line break, or keep some of its text.';

/**
 * A deletion of the whole first line of a block that goes on, in a replacement that keeps the line
 * break after it, which `coverLine` would take: the replacement asks for the line to stay, with
 * nothing on it but white space. Where another person's closer stays on the line after the deleted
 * text, the deletion's marker is not alone on its line, and the line is written as asked. Alone
 * there, the marker would take the line break for its own (format §3.3). A line of white space is a
 * blank line, so the line may go with its break as `coverLine` takes it, when the next line has
 * what the deleted text has in front of it: the next line's text then stands where it stood, and
 * the views read as asked. Anything else is refused.
 *
 * @throws EditError when the line can't be written as asked.
 */
function keepLine(plan: Plan, from: number, to: number): Range {
  const covered = coverLine(plan, from, to);
  if (covered.to === to) return covered;
  const { text, markers } = plan;
  const end = lineEnd(text, to);
  const me = plan.ctx.author.handle;
  const closed = markers.some(
    (marker) =>
      marker.role === 'close' &&
      from <= marker.from &&
      marker.to <= end &&
      marker.mark?.entry.by !== me,
  );
  if (closed) return { from, to };
  const lead = visibleText(text, markers, visualLineStart(plan, from), from);
  const next = visibleText(text, markers, lineStart(text, covered.to), covered.to);
  if (lead !== next) throw new EditError(BLANK_LINE, 'no-legal-placement');
  return covered;
}

/**
 * Breaks at the end of the typed text are followed by the text that stays after it, and the two
 * are read together when the split is decided: a bullet that follows would be taken for the prefix
 * of the break (`breakEnd`). When the break is typed in front of a block that has a prefix, it is
 * written in front of the break that is already there instead, which comes to the same text: a
 * new paragraph before a heading is a new paragraph after the previous block. Where that does not
 * work, the edit is refused.
 */
function settleTrail(
  plan: Plan,
  range: Range,
  tokens: readonly Token[],
): { range: Range; tokens: readonly Token[] } {
  const lastText = tokens.findLastIndex((token) => 'text' in token);
  const trailing = tokens.slice(lastText + 1).flatMap((token) => ('brk' in token ? [token] : []));
  if (trailing.length === 0) return { range, tokens };
  const joined = trailing.map((token) => token.brk).join('');
  const after = plan.text.slice(range.to, range.to + 200);
  let offset = 0;
  let clear = true;
  for (const token of trailing) {
    if (breakLength(token.prefix, joined.slice(offset) + after) !== token.brk.length) clear = false;
    offset += token.brk.length;
  }
  if (clear) return { range, tokens };
  if (range.from === range.to) {
    const found = breaksOfBody(plan, range.from, range.to).find(
      (b) =>
        b.start < range.from &&
        range.from === lineStart(plan.text, b.end) &&
        plan.text.slice(b.start, range.from) === joined,
    );
    if (found) {
      const at = { from: found.start, to: found.start };
      const moved = [...trailing, ...tokens.slice(0, lastText + 1)];
      return beforeItem(plan, at, moved) ?? { range: at, tokens: moved };
    }
  }
  const before = beforeItem(plan, range, tokens);
  if (before) return before;
  throw new EditError(
    'A line break at the end of this text would take the start of the block that follows it.',
    'no-legal-placement',
  );
}

/** A line break of one line, with the container prefix after it and nothing else. */
const ONE_LINE_BREAK = /^[ \t]*\r?\n[ \t>]*$/;

/**
 * The typed text, when it ends with a line break of one line in front of the line break before a
 * list item, as the line break that parts the item from the text above it with a blank line (format
 * §3.4): the line break is text of the change, the last, and the closer stands alone on the line
 * after it, as after a fence, so that the change ends with the line break and rejecting it takes
 * the line break away with it. As a split, its break would take the line break in front of the
 * item and the item's marker, which are not new. Undefined for anything else.
 */
function beforeItem(
  plan: Plan,
  range: Range,
  tokens: readonly Token[],
): { range: Range; tokens: readonly Token[] } | undefined {
  const lastText = tokens.findLastIndex((token) => 'text' in token);
  const trailing = tokens.slice(lastText + 1);
  const last = trailing.at(-1);
  if (!last || !('brk' in last) || !ONE_LINE_BREAK.test(last.brk)) return undefined;
  const after = plan.text.slice(range.to, range.to + 200);
  const next = /^\r?\n([^\r\n]*)/.exec(after);
  const item = next?.[1] ?? '';
  if (!next || !FIRST_ITEM.test(item)) return undefined;
  if (breakLength(last.prefix, last.brk + after) === last.brk.length) return undefined;
  // Only behind text that is no item of that list, which a blank line would make loose: between
  // the items of a tight list a line break alone keeps no bullet (format §3.4).
  const typed = tokens.slice(0, -1).map((token) => ('text' in token ? token.text : token.brk));
  const head = plan.text.slice(Math.max(0, range.from - 4096), range.from) + typed.join('');
  const lines = head
    .split('\n')
    .map((line) => line.replace(/<!--[^]*?-->/g, '').replace(/\r$/, ''));
  // Line breaks alone, with no text typed between them and the item: the text above them is what
  // the item follows, and a list item there would be the same list in the newest view, which
  // reads the blank lines as a loose list, while the closer in front of the item ends it.
  let start = lines.length - 1;
  if (tokens.every((token) => 'brk' in token)) {
    while (start > 0 && /^[ \t>]*$/.test(lines[start] ?? '')) start--;
  }
  for (let i = start; i >= 0; i--) {
    const line = lines[i] ?? '';
    if (/^[ \t>]*$/.test(line)) break;
    if (sameListLevel(line, item)) return undefined;
  }
  return { range, tokens: [...tokens.slice(0, -1), { text: last.brk, fence: true }] };
}

/** Whether two lines start items at the same depth of quotes and the same indentation. */
function sameListLevel(a: string, b: string): boolean {
  const x = FIRST_ITEM.exec(a);
  const y = FIRST_ITEM.exec(b);
  if (!x || !y) return false;
  const depth = (quotes: string | undefined) => (quotes ?? '').split('>').length;
  return depth(x[1]) === depth(y[1]) && (x[2] ?? '').length === (y[2] ?? '').length;
}

/** The first character of `s`, as a whole code point. */
const firstChar = (s: string): string | undefined =>
  s === '' ? undefined : String.fromCodePoint(s.codePointAt(0) ?? 0);

/** The text that follows `position` on its line, without the markers: a few characters of it. */
function visibleAfter(plan: Plan, position: number): string {
  const end = Math.min(plan.text.length, position + 64);
  return visibleText(plan.text, plan.markers, position, end).split(/\r?\n/)[0] ?? '';
}

/** The text that comes before `position` on its line, without the markers: a few characters. */
function visibleBefore(plan: Plan, position: number): string {
  const start = Math.max(0, position - 64);
  return visibleText(plan.text, plan.markers, start, position).split(/\r?\n/).at(-1) ?? '';
}

/** An edit as it will be written: the range it replaces, and the text of that range that is
 * written again on either side of what is typed. */
interface Placed {
  from: number;
  to: number;
  left: string;
  right: string;
}

/** Whether a line that starts with a number, indented `indent`, is left of the content column of the
 * nearest list item above it in the same block: an item of that list, not text of its paragraph. */
function isSiblingNumber(text: string, line: number, indent: number): boolean {
  let at = line;
  for (let n = 0; n < 50 && at > 0; n++) {
    at = lineStart(text, at - 1);
    const above = text.slice(at, lineEnd(text, at));
    if (/^[ \t>]*$/.test(above)) return false;
    const item = /^([ \t>]*)(\d{1,9}[.)]|[-+*])([ \t]+)/.exec(above);
    if (item) {
      return indent < (item[1]?.length ?? 0) + (item[2]?.length ?? 0) + (item[3]?.length ?? 0);
    }
  }
  return false;
}

/**
 * The end of the first word of the text on the line that starts at `at`, past its prefix and a
 * heading's `#`s, where a closer may follow it; past blank lines first, to the next block's first
 * word. Undefined where no text comes before the ledger or the end of the file, or where the line
 * starts with a marker.
 */
function nextWordEnd(plan: Plan, at: number): number | undefined {
  const { text, markers } = plan;
  const limit = plan.parsed.ledgerRange?.from ?? text.length;
  let line = at;
  let blank = false;
  while (line < limit && /^[ \t>]*$/.test(text.slice(line, lineEnd(text, line)))) {
    const next = nextLineStart(text, line);
    if (next > text.length) return undefined;
    line = next;
    blank = true;
  }
  if (line >= limit) return undefined;
  const end = lineEnd(text, line);
  const lineText = text.slice(line, end);
  const lead = prefixLength(lineText);
  // A line that is only syntax, a definition or the start of an HTML block takes no closer (§3.1,
  // 7 and 9): a setext underline there would also stop being one, and a rule be read as text.
  const rest = lineText.slice(lead);
  // A line that opens a container (a deeper quote, a list item) starts the first block of it: a tag
  // alone on it is an HTML block there, as after a blank line.
  const above = text.slice(lineStart(text, line - 1), Math.max(0, line - 1));
  const opens = !blank && line > 0 && opensContainer(above, lineText.slice(0, lead));
  if (SYNTAX_LINE.test(rest) || startsHtmlBlock(rest, blank || opens)) return undefined;
  let p = line + lead + (/^#{1,6}[ \t]+/.exec(lineText.slice(lead))?.[0].length ?? 0);
  if (p >= end || text.startsWith('<!--', p)) return undefined;
  while (p < end && !/\s/.test(text[p] ?? ' ')) p = stepRight(text, markers, p);
  // Not inside a code span, which takes no marker: after it, and the rest of the word. Nor right
  // after a backslash that the word ends with, which would escape it: the character after it goes
  // too, or the line break and the first word of the next line.
  for (let again = 0; again < 8; again++) {
    const span = codeSpanAt(text, markers, p);
    if (span) p = span.to;
    else if (p < end && oddBackslashes(visibleText(text, markers, line, p))) {
      p = stepRight(text, markers, p);
      continue;
    } else if (p >= end && oddBackslashes(visibleText(text, markers, line, p))) {
      return nextWordEnd(plan, nextLineStart(text, p));
    } else break;
    while (p < end && !/\s/.test(text[p] ?? ' ')) p = stepRight(text, markers, p);
  }
  return p;
}

/**
 * Whether the prefix of a line opens a container that the line above is not in: more quote markers
 * than it has, or a list marker (CommonMark's first block of a container is not a continuation of
 * the paragraph above, so a tag alone on the line is an HTML block).
 */
function opensContainer(above: string, prefix: string): boolean {
  const quotes = (line: string) => line.slice(0, prefixLength(line)).split('>').length - 1;
  return quotes(prefix) > quotes(above) || /(?:[-*+]|\d{1,9}[.)])[ \t]/.test(prefix);
}

/** The text of a line, past its container prefix, that is only syntax: a thematic break, a setext
 * underline, an empty heading, a fence, a table's delimiter row or any table row, or a link
 * reference definition. */
const SYNTAX_LINE =
  /^(?:(?:[-*_][ \t]*){3,}|=+[ \t]*|-+[ \t]*|#{1,6}[ \t]*|(?:`{3,}|~{3,}).*|\|.*|\[[^\]]+\]:.*)$/;

/** The block-level tag names of CommonMark's sixth kind of HTML block. */
const HTML_BLOCK_TAGS =
  'address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul';

/** CommonMark's seven starts of an HTML block, the first six of which interrupt a paragraph. */
const HTML_START = [
  /^<(?:script|pre|style|textarea)(?:[ \t>]|$)/i,
  /^<!--/,
  /^<\?/,
  /^<![A-Za-z]/,
  /^<!\[CDATA\[/,
  new RegExp(`^</?(?:${HTML_BLOCK_TAGS})(?:[ \\t>]|/>|$)`, 'i'),
];
/** The seventh: one whole open or closing tag of another name, alone on its line. */
const HTML_START_7 =
  /^(?:<[A-Za-z][A-Za-z0-9-]*(?:[ \t]+[A-Za-z_:][\w.:-]*(?:[ \t]*=[ \t]*(?:[^ \t"'=<>`]+|'[^']*'|"[^"]*"))?)*[ \t]*\/?>|<\/[A-Za-z][A-Za-z0-9-]*[ \t]*>)[ \t]*$/;

/**
 * Whether a line, past its container prefix, starts an HTML block, where a marker is not read: one
 * of CommonMark's seven starts, the seventh only where it can't go on with a paragraph (`blank`:
 * after a blank line). A line that starts with an inline tag or an autolink is text.
 */
function startsHtmlBlock(line: string, blank: boolean): boolean {
  if (HTML_START.some((start) => start.test(line))) return true;
  return blank && HTML_START_7.test(line);
}

/**
 * Whether a closer may stand at `at` (at or after `to`) once `typed` has replaced `from` to `to`:
 * the place read in the text as the edit leaves it (format §3.1).
 */
function closerFits(plan: Plan, from: number, to: number, typed: string, at: number): boolean {
  const { text, markers } = plan;
  const delta = typed.length - (to - from);
  const edited = text.slice(0, from) + typed + text.slice(to);
  const moved = markers.map((m) => (m.from >= to ? { from: m.from + delta, to: m.to + delta } : m));
  return inspectPlace(edited, moved, at + delta).kind === 'ok';
}

/** Your own insertion or substitution of one segment with no marker in its text, around a range. */
function ownPlain(
  plan: Plan,
  kind: 'ins' | 'sub',
  from: number,
  to: number,
): Container | undefined {
  return plan.containers.find(
    (c) =>
      c.own &&
      c.mark.kind === kind &&
      c.mark.segments.length === 1 &&
      c.content.from <= from &&
      to <= c.content.to &&
      !plan.markers.some((m) => c.content.from <= m.from && m.to <= c.content.to),
  );
}

/**
 * Where a change that ends in a backslash puts its closer at the end of the document, where nothing
 * but white space follows it before the ledger or the end of the file (format §3.1): after the line
 * break that ends the last block, which the change takes in, so that the closer stands alone on
 * the line after it, and no block follows to be read with it. The body has none where the ledger
 * follows at once, the line breaks in front of it being its own (§2.5), or the file ends: then the
 * change brings one of its own (`bring`), as its last text. `at` is where the text ends. Undefined
 * where anything but white space follows.
 */
function endOfBody(plan: Plan, at: number): { end: number; bring: boolean } | undefined {
  const { text } = plan;
  const rest = text.slice(at, plan.parsed.ledgerRange?.from ?? text.length);
  if (!/^\s*$/.test(rest)) return undefined;
  const lineBreak = /^\r?\n/.exec(rest);
  return lineBreak ? { end: at + lineBreak[0].length, bring: false } : { end: at, bring: true };
}

/**
 * Why no word follows a backslash at `at` for the closer to stand after: another person's marker
 * starts what follows (named, as `backslashBeforeAt` names it), or the next line takes no closer.
 */
function noWordReason(plan: Plan, at: number): string {
  const { text, markers } = plan;
  const starts = (position: number) =>
    markers.find(
      (m) => m.from === position && m.mark && m.mark.entry.by !== plan.ctx.author.handle,
    );
  let found = starts(at);
  for (let line = nextLineStart(text, at), n = 0; !found && line < text.length && n < 50; n++) {
    const lead = line + prefixLength(text.slice(line, lineEnd(text, line)));
    found = starts(lead);
    if (lead < lineEnd(text, line)) break;
    line = nextLineStart(text, line);
  }
  return found
    ? backslashBeforeAt(plan.parsed, found.from, plan.ctx.author)
    : BACKSLASH_BEFORE_SYNTAX;
}

/**
 * Where the closer of your own insertion or substitution goes once its text ends in a backslash,
 * which would escape it, or in a line break and the prefix of a block (format §3.1): after the next
 * character, or the line break and the first word of the next line, or the paragraph break and the
 * next block's first word, or, at the end of the document, its final line break. `at` is where the
 * closer is now. Returns the end, or the words of why there is none.
 */
function ownBackslashTakes(plan: Plan, at: number): number | string {
  const { text, markers } = plan;
  const last = endOfBody(plan, at);
  if (last) return last.bring ? at : last.end;
  const next = stepRight(text, markers, at);
  if (next === at) return BACKSLASH_AT_END;
  const inWay = markers.find((m) => m.from >= at && m.from < next);
  if (inWay) return backslashBeforeAt(plan.parsed, inWay.from, plan.ctx.author);
  const lineBreak = /[\r\n]/.test(text.slice(at, next));
  const end = lineBreak ? nextWordEnd(plan, nextLineStart(text, at)) : next;
  if (end === undefined) return noWordReason(plan, at);
  const across = markers.find((m) => m.from < end && m.to > at);
  if (across) return backslashBeforeAt(plan.parsed, across.from, plan.ctx.author);
  return end;
}

/**
 * Writes an edit in your own insertion or substitution with its closer moved on to `end`: the
 * insertion becomes a substitution of the same id, and a substitution takes more, `text[at, end)`,
 * where `at` is where its closer is. The edit is made in its text as it is.
 */
function ownTakes(
  plan: Plan,
  c: Container,
  edit: { from: number; to: number; typed: string },
  end: number,
): void {
  const { text } = plan;
  const { id } = c.mark;
  // Nothing to take: the document ends here, and the text gets a line break of its own, in front
  // of the closer (`endOfBody`).
  if (end === c.close.to) {
    const brk = plan.eol;
    if (edit.to === c.close.from) {
      plan.changes.push({ from: edit.from, to: edit.to, insert: edit.typed + brk });
    } else {
      plan.changes.push(
        { from: edit.from, to: edit.to, insert: edit.typed },
        { from: c.close.from, to: c.close.from, insert: brk },
      );
    }
    plan.spans.push({ from: edit.from, to: c.close.to });
    plan.touched.push(id);
    return;
  }
  const was = c.mark.kind === 'sub' ? (c.mark.payload ?? '') : '';
  const old = was + text.slice(c.close.to, end).replaceAll('\r\n', '\n');
  plan.changes.push(
    { from: c.open.from, to: c.open.to, insert: `<!--sub ${id} ${encodePayload(old)}-->` },
    { from: edit.from, to: edit.to, insert: edit.typed },
    { from: c.close.from, to: c.close.to, insert: '' },
    { from: end, to: end, insert: `<!--/${id}-->` },
  );
  plan.spans.push({ from: c.open.from, to: end });
  plan.touched.push(id);
}

/**
 * An edit at the end of your own insertion or substitution after which its text ends in a
 * backslash, which would escape its closer (format §3.1): a backslash typed there, or the text after
 * one deleted, as in correcting a path. The insertion becomes a substitution of the same id, and a
 * substitution takes more (`ownBackslashTakes`), as a typed backslash takes it. Returns whether it
 * wrote that. Where nothing can follow, typing goes on to the rules of ordinary edits, which refuse
 * it or write it there, and a deletion is refused.
 */
function ownBackslashEnd(plan: Plan, from: number, to: number, typed: string): boolean {
  const { text } = plan;
  // Only what the text ends with matters: an edit that leaves a character other than a backslash
  // last, in what follows it, changes no ending.
  const c = ownPlain(plan, 'ins', from, to) ?? ownPlain(plan, 'sub', from, to);
  if (!c || c.open.to !== c.content.from) return false;
  if (to < c.content.to && text[c.content.to - 1] !== '\\') return false;
  const tail = text.slice(to, c.content.to);
  if (!oddBackslashes(text.slice(c.content.from, from) + typed + tail)) return false;
  if (typed !== '' && onDefinitionLine(plan, from)) return false;
  // A deletion has no other form: where nothing can follow, it is refused here, as typing is.
  const none = (reason: string) => {
    if (typed === '') throw new EditError(reason, 'no-legal-placement');
    return false;
  };
  const end = ownBackslashTakes(plan, c.close.to);
  if (typeof end === 'string') return none(end);
  // At the end of the document the closer stands alone on its line, after a line break.
  if (!endOfBody(plan, c.close.to) && !closerFits(plan, from, to, typed, end)) {
    return none(backslashBefore(nameOf(plan.parsed, c.mark, plan.ctx.author), true));
  }
  ownTakes(plan, c, { from, to, typed }, end);
  return true;
}

/** What Enter and Shift-Enter type: a hard break's backslash, line breaks, and the next line's
 * prefix, a list item's bullet or number and box among it. */
const TYPED_BREAK =
  /^\\?(?:[ \t>]*\r?\n)+[ \t>]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[[ xX]\][ \t]+)?)?$/;

/**
 * A line break typed right after a backslash in the text of your own substitution or insertion, as
 * Return after a backslash typed at a line's end (`<!--sub ID \nb-->\\⏎b<!--/ID-->`), in a list
 * item (`⏎- `, `⏎2. `) or after `C:\` in your own insertion: written as it is, plain, in that
 * text, in front of the spaces that the key takes away, as Enter in front of a space does. A split
 * there would stand right after the backslash, which would escape its marker; the change holds the
 * break, and rejecting it gives back the text as it was. Where the text then ends in a backslash
 * (Enter between the two of `\\`), or in the prefix of a line that the closer would start, it
 * takes more, as a typed backslash does (`ownBackslashTakes`).
 */
function ownBreakAfterBackslash(plan: Plan, from: number, to: number, typed: string): boolean {
  const { text } = plan;
  if (!TYPED_BREAK.test(typed) || (from !== to && !/^[ \t]+$/.test(text.slice(from, to)))) {
    return false;
  }
  const c = ownPlain(plan, 'sub', from, to) ?? ownPlain(plan, 'ins', from, to);
  if (!c || c.open.to !== c.content.from) return false;
  if (!oddBackslashes(text.slice(c.content.from, from))) return false;
  const now = typed + text.slice(to, c.content.to);
  const lineEnd = text.indexOf('\n', c.close.to);
  const after = text.slice(c.close.to, lineEnd === -1 ? text.length : lineEnd);
  const start = text.slice(c.content.from, from) + now;
  // The closer would stand after the prefix of a line, in front of text: it takes that text, up to
  // the end of its first word.
  const prefixed = endsInPrefix(start) && after.trim() !== '';
  const end = oddBackslashes(start)
    ? ownBackslashTakes(plan, c.close.to)
    : prefixed
      ? (/^[ \t]*\S+/.exec(after)?.[0].length ?? 0) + c.close.to
      : undefined;
  if (typeof end === 'string') throw new EditError(end, 'no-legal-placement');
  if (end === undefined) {
    plan.changes.push({ from, to, insert: typed });
    plan.spans.push({ from, to });
    plan.touched.push(c.mark.id);
    return true;
  }
  if (plan.markers.some((m) => m.from < end && m.to > c.close.to)) return false;
  ownTakes(plan, c, { from, to, typed }, end);
  return true;
}

/**
 * An edit in the text of your own insertion at the end of the document that a backslash made bring
 * a line break of its own (`endOfBody`), after which its text no longer ends in a backslash: the
 * line break goes, and the closer follows the text again, as the substitution that a backslash made
 * goes back to an insertion (`ownBackslashLeft`). Where the edit takes all the text but the line
 * break, the insertion goes with its markers. Returns whether it wrote the edit.
 */
function ownBringLeft(plan: Plan, from: number, to: number, typed: string): boolean {
  const { text } = plan;
  // Only where an insertion ends the body with a line break: a closer after one.
  const end = plan.parsed.ledgerRange?.from ?? text.length;
  if (!/\n<!--\/\w+-->$/.test(text.slice(Math.max(0, end - 24), end))) return false;
  const c = ownPlain(plan, 'ins', from, to);
  if (!c || c.open.to !== c.content.from) return false;
  const gap = c.content.to - plan.eol.length;
  if (gap < c.content.from || text.slice(gap, c.content.to) !== plan.eol || to > gap) return false;
  if (endOfBody(plan, c.close.to)?.bring !== true) return false;
  if (!oddBackslashes(text.slice(c.content.from, gap))) return false;
  const mine = text.slice(c.content.from, from) + typed + text.slice(to, gap);
  // Not where the closer would then follow a line break and the prefix of a block.
  if (oddBackslashes(mine) || /\n[ \t>]*$/.test(mine)) return false;
  if (mine === '') {
    // All the text of the insertion is gone: it goes, with its markers.
    plan.changes.push({ from: c.open.from, to: c.close.to, insert: '' });
    plan.spans.push({ from: c.open.from, to: c.close.to });
    return true;
  }
  plan.changes.push({ from, to: c.content.to, insert: typed + text.slice(to, gap) });
  plan.spans.push({ from, to: c.content.to });
  plan.touched.push(c.mark.id);
  return true;
}

/**
 * An edit in your own substitution that a backslash made (above, or `legalize`) after which its
 * new text is text of yours and then its old text, unchanged, with no backslash at the end of what
 * is yours: it is an insertion of that text again, of the same id, in front of the old text, which
 * stays where it is, plain. Returns whether it wrote that.
 */
function ownBackslashLeft(plan: Plan, from: number, to: number, typed: string): boolean {
  const { text } = plan;
  const c = ownPlain(plan, 'sub', from, to);
  if (!c || c.open.to !== c.content.from) return false;
  const old = inEol(c.mark.payload ?? '', plan.eol);
  const tail = c.content.to - old.length;
  if (old === '' || tail < c.content.from || to > tail || text.slice(tail, c.content.to) !== old) {
    return false;
  }
  const mine = text.slice(c.content.from, from) + typed + text.slice(to, tail);
  // Only where a backslash is in your text or is taken out of it: the substitution was a
  // backslash's.
  const backslash = mine.includes('\\') || text.slice(from, to).includes('\\');
  if (mine === '' || !backslash || oddBackslashes(mine) || /\n[ \t>]*$/.test(mine)) {
    return false;
  }
  if (!closerFits(plan, from, to, typed, tail)) return false;
  const { id } = c.mark;
  const closer = `<!--/${id}-->`;
  plan.changes.push({ from: c.open.from, to: c.open.to, insert: `<!--ins ${id}-->` });
  if (to === tail) plan.changes.push({ from, to, insert: typed + closer });
  else plan.changes.push({ from, to, insert: typed }, { from: tail, to: tail, insert: closer });
  plan.changes.push({ from: c.close.from, to: c.close.to, insert: '' });
  plan.spans.push({ from: c.open.from, to: c.close.to });
  plan.touched.push(id);
  return true;
}

/** How many markers of a file's body stand right after an unescaped backslash, which escapes them
 * (format §3.1). */
function escapedMarkers(text: string, parsed: Parsed): number {
  const body = text.slice(0, parsed.ledgerRange?.from ?? text.length);
  return body.match(/(?:^|[^\\])(?:\\\\)*\\<!--/g)?.length ?? 0;
}

const AFTER_BRING =
  "A line break can't be typed here while Track Changes is on: the change would leave a marker at the start of a line after a backslash, in a list, where other Markdown readers would read the list otherwise. Type something after the backslash first, or turn off Track Changes.";

/**
 * How many markers of a file's body start a line (after its prefix) right after a line that ends in
 * an unescaped backslash, in a list, with more than the marker on it or text after it: the closer
 * that stands alone after the line break a backslash brought at the end of the document (format
 * §3.2) is the last line, and it is only allowed there, in a list; a blank line and a line with a
 * marker on it read otherwise to the list that goes on or breaks off after it. A marker after a
 * prefix is never allowed there.
 */
function bringsBroken(text: string, parsed: Parsed): number {
  const body = text.slice(0, parsed.ledgerRange?.from ?? text.length);
  const lines = body.split(/\r?\n/);
  const item = (at: number) => {
    // A list item holds the line when a bullet or a number starts it or an unbroken run of lines
    // above it, or when it is indented under one.
    for (let i = at, n = 0; i >= 0 && n < 40; i--, n++) {
      const line = lines[i] ?? '';
      if (/^[ \t>]*(?:[-+*]|\d{1,9}[.)])(?:[ \t]|$)/.test(line)) return true;
      if (line.trim() === '' && !/^[ \t]/.test(lines[at] ?? '')) return false;
    }
    return false;
  };
  let count = 0;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const lead = /^(?:[ \t>]|[-+*][ \t]|\d{1,9}[.)][ \t])*/.exec(line)?.[0].length ?? 0;
    if (!/^<!--\/?[a-z]+ ?\w{0,4}/.test(line.slice(lead))) continue;
    // The line above, past the lines that hold nothing but markers.
    let above = i - 1;
    while (above > 0 && (lines[above] ?? '').replace(/<!--[^>]*-->/g, '') === '') above--;
    if (!oddBackslashes((lines[above] ?? '').replace(/<!--[^>]*-->/g, ''))) continue;
    const alone = lead === 0 && /^(?:<!--[^>]*-->)*$/.test(line);
    const more = lines.slice(i + 1).some((l) => l.trim() !== '');
    // A bullet or a number in front of the marker, or the marker after the indent or the line
    // that ends the item, in a list.
    const bullet = /[-+*\d][.)]?[ \t]/.test(line.slice(0, lead));
    if (bullet || ((!alone || more) && item(above))) count++;
  }
  return count;
}

/** Where the last marker of a file's body that an unescaped backslash escapes starts. */
function escapedMarkerAt(text: string, parsed: Parsed): number | undefined {
  const body = text.slice(0, parsed.ledgerRange?.from ?? text.length);
  let at: number | undefined;
  for (const m of body.matchAll(/(?:^|[^\\])(?:\\\\)*\\(?=<!--)/g)) at = m.index + m[0].length;
  return at;
}

/**
 * Where a marker stands right after the closer of a substitution, or the marker of a deletion, whose
 * old text ends in an unescaped backslash: rejecting that change gives the text back in front of
 * the marker, which it would escape (format §3.1). After a deletion, only the opener of a mark
 * that `created` has (an edit's own new marks): the deletions that were there already, and the
 * closers of other changes after them, are as other edits left them.
 */
function restoredEscapes(text: string, parsed: Parsed, created: ReadonlySet<string>): number[] {
  const limit = parsed.ledgerRange?.from ?? text.length;
  const at: number[] = [];
  for (const mark of parsed.marks) {
    if (mark.kind !== 'sub' && mark.kind !== 'del') continue;
    for (const segment of mark.segments) {
      const old = segment.payload ?? mark.payload ?? '';
      if (!oddBackslashes(old)) continue;
      const end = segment.close?.to ?? segment.open.to;
      if (end >= limit || !text.startsWith('<!--', end)) continue;
      const next = /^<!--[a-z]+ (\w{4})/.exec(text.slice(end, end + 16))?.[1];
      if (mark.kind === 'sub' || (next !== undefined && created.has(next))) at.push(end);
    }
  }
  return at;
}

/** Whether text ends in an unescaped backslash: an odd number of them. */
function oddBackslashes(text: string): boolean {
  return (/\\+$/.exec(text)?.[0].length ?? 0) % 2 === 1;
}

/**
 * Why a backslash can't stand right in front of a marker, naming the change it belongs to (`name`,
 * as `nameOf` gives it): your own, which typing after the backslash makes room for, or another
 * person's, which they must decide first.
 */
function backslashBefore(name: string, own: boolean): string {
  const then = own
    ? 'Type something after the backslash first, or turn off Track Changes.'
    : `Decide ${name} first, or turn off Track Changes.`;
  return `A backslash can't stand right in front of the marker of ${name} while Track Changes is on: other Markdown readers would show the marker as text. ${then}`;
}

/** The words of `backslashBefore` for the mark whose marker starts at `at` in `parsed`. */
function backslashBeforeAt(parsed: Parsed, at: number, author: Person): string {
  const mark = markerRanges(parsed).find((m) => m.from === at && m.mark !== undefined)?.mark;
  if (!mark) return backslashBefore('a change', false);
  return backslashBefore(nameOf(parsed, mark, author), mark.entry.by === author.handle);
}

/** Why a change can't be written next to a mark that someone else has not decided yet. */
function changesHow(parsed: Parsed, mark: MarkRange, author: Person): string {
  return `This would change how ${nameOf(parsed, mark, author)} reads. Decide it first, or turn off Track Changes.`;
}

const BACKSLASH_AT_END =
  "A backslash can't end a block while Track Changes is on: the change's marker would follow it, and other Markdown readers would show the marker as text. Type it with Track Changes off.";

const BACKSLASH_OLD =
  'The text this change replaces ends in a backslash. Deciding the changes in another order could leave it right in front of the marker of the new text, where it would escape the marker. Replace the text in two steps, or turn off Track Changes.';

const BACKSLASH_TAKEN =
  "The backslash that ends the line here can't have a change start after it: the change would take it in, together with other changes next to it, and deciding those in another order could read it otherwise. Decide them first, or turn off Track Changes.";

const BACKSLASH_DEFINITION =
  "A backslash can't end a link reference definition while Track Changes is on: the change's marker would stand in the definition's destination, and other Markdown readers would no longer read the line as a definition. Type it with Track Changes off.";

/** Whether the line that holds `position` is a link reference definition. */
function onDefinitionLine(plan: Plan, position: number): boolean {
  const { text, markers } = plan;
  const line = visibleText(text, markers, lineStart(text, position), lineEnd(text, position));
  return /^[ \t>]*\[[^\]\n]+\]:/.test(line);
}

const BACKSLASH_BEFORE_SYNTAX =
  "A backslash can't end a block while Track Changes is on when the line after it takes no change (a rule, a fence, a table, a definition, a heading's #s, code, a block of HTML, or a word that ends in a backslash at the end of the document): the change's marker would have to follow the backslash, or start that line. Type it with Track Changes off, or after a word on that line.";

/** The characters of emphasis delimiters. */
const DELIMITERS = /[*_~]/;

/** Whether the lines of `from` and `to` start and end a paragraph: the lines around them are blank
 * as they read, or there are none. */
function aloneInBlock(plan: Plan, from: number, to: number): boolean {
  const { text, markers } = plan;
  const blank = (a: number, b: number) => /^\s*$/.test(visibleText(text, markers, a, b));
  const start = lineStart(text, from);
  if (start > 0 && !blank(lineStart(text, start - 1), start - 1)) return false;
  const end = lineEnd(text, to);
  if (end >= text.length) return true;
  const next = nextLineStart(text, end);
  return next >= text.length || blank(next, lineEnd(text, next));
}

/**
 * Whether the markers of a change leave the emphasis in the text around it as it reads without them
 * (format §3.1, rule 5): `content` is the text the change writes, with a `SPLIT` in front of each
 * line break that is a split. A marker reads as punctuation to a delimiter run next to it, which
 * can change what the run does; where the run closes an emphasis that opens in `content`, in the
 * same pair with or without the markers, it is no change (#81). The whole line is read, and
 * only when a delimiter is next to a marker: the check costs nothing for other keys.
 */
function emphasisKept(
  plan: Plan,
  from: number,
  to: number,
  content: string,
  trail: string,
): boolean {
  // The whole line: an emphasis opened far back on it pairs with a closer here (#81).
  const before = visibleText(plan.text, plan.markers, lineStart(plan.text, from), from);
  const after =
    trail !== ''
      ? '\n'
      : (visibleText(plan.text, plan.markers, to, lineEnd(plan.text, to)).split(/\r?\n/)[0] ?? '');
  // The splits are markers too: each stands where its `SPLIT` was.
  let text = before;
  const joints = new Set<number>([before.length]);
  for (let i = 0; i < content.length; i++) {
    if (content[i] === SPLIT) {
      i++;
      joints.add(text.length);
    } else text += content[i];
  }
  joints.add(text.length);
  const near = [before.at(-1), content[0], text.at(-1), after[0]];
  if (!near.some((c) => c !== undefined && DELIMITERS.test(c))) return true;
  const read = unreadDelimiters(text + after);
  // A paragraph of its own, a blank line or the document's edge on either side, with the change at
  // its end, holds every pair its text can make: a run that no pair uses has nothing to open with, whatever the markers
  // make of its flanks (a fence's tildes typed on a line of their own, with Track Changes on).
  if (trail === '' && after === '' && !/\n/.test(content) && aloneInBlock(plan, from, to)) {
    return sameReading(read, joints);
  }
  return sameEmphasis(read, joints);
}

/** Whether `where`, the start of a deletion from `from` to `to`, is the first row of a table that
 * the deletion covers whole: a table is deleted as a block (format §3.4, §3.7). */
function coversTable(plan: Plan, where: number, from: number, to: number): boolean {
  if (from >= to || !plan.text.includes('|')) return false;
  const table = tableStartsAt(plan.text, plan.parsed, where);
  return table !== null && from <= table.from && table.to <= to;
}

/**
 * Widens an edit until none of the markers it needs would stand where format §3.1 and §3.2 do not
 * allow it: over the whole of a construct that takes no marker inside it, by a character where a
 * marker would change how emphasis flanks, over the line break in front of a wrapped line. The text
 * that comes into the range is written again in the same place, so that the newest and the original
 * view stay as they are; it makes a deletion a substitution.
 *
 * @throws EditError when there is no place at all.
 */
function legalize(plan: Plan, range: Range, typing: Typing, at?: number): Placed {
  const { text, markers } = plan;
  let { from, to } = range;
  const start = from;
  let left = '';
  let right = '';
  // A change inside the author's own insertion changes its text and writes no marker. Nor does a
  // deletion of nothing but the author's own text and splits, which goes with its markers, as a
  // line typed on a blank line with a line break of it, where no other marker stands in it: one
  // that stays, as the marker of another person's comment, is placed as for any change.
  const own = plan.containers.find((c) => c.own && c.content.from <= from && to <= c.content.to);
  // Unless the typed text ends the insertion's text with a backslash, which would escape its
  // closer: then the insertion takes the character after it as well, below.
  if (
    own &&
    !(
      to === own.content.to &&
      oddBackslashes(visibleText(text, markers, own.content.from, from) + typing.inner)
    )
  ) {
    return { from, to, left, right };
  }
  const goes = (marker: MarkerRange) =>
    marker.mark?.entry.by === plan.ctx.author.handle &&
    (marker.mark.kind === 'ins' || marker.mark.kind === 'sub' || marker.mark.kind === 'split');
  if (
    isEmpty(typing) &&
    from < to &&
    markers.every((marker) => marker.to <= from || to <= marker.from || goes(marker)) &&
    piecesIn(plan, from, to).every((piece) => piece.how === 'cancel' || piece.container?.own)
  ) {
    return { from, to, left, right };
  }
  const refuse = (reason: string): never => {
    throw new EditError(reason, 'no-legal-placement');
  };
  const grow = (a: number, b: number) => {
    if (plan.frontEnd >= 0 && a <= plan.frontEnd) throw new EditError(FRONT_MATTER, 'front-matter');
    if (a < from) {
      left = visibleText(text, markers, a, from) + left;
      from = a;
    }
    if (b > to) {
      right += visibleText(text, markers, to, b);
      to = b;
    }
  };
  // Whether the closer goes alone on the line after the document's final line break.
  let atEnd = false;
  // The words that say why a change took in more than it was typed with, when it is refused after.
  let tookBackslash = '';
  // Whether the change starts in front of the backslash that a marker would have followed.
  let grew = false;
  /** Whether the markers leave the emphasis next to the change as it reads without them. */
  const kept = () => {
    const now = left + typing.inner + right;
    const next = [text[from - 1], now[0], now.at(-1), text[to]];
    return (
      !next.some((c) => c !== undefined && DELIMITERS.test(c)) ||
      emphasisKept(plan, from, to, now, typing.trail)
    );
  };
  /** Whether a marker stands against the change, which the markers of both read as punctuation to
   * the delimiters between them: then it is written as typed first, and read in every order of
   * decisions (`emphasisReadsAlike`), and written again by a character if that reads otherwise. */
  /** Whether a marker of a mark that is no format change or split touches the change. */
  const stands = (m: MarkerRange) =>
    m.mark !== undefined &&
    m.mark.kind !== 'fmt' &&
    m.mark.kind !== 'split' &&
    m.to >= from &&
    m.from <= to;
  // Whether the change was written again by a character for the sake of the marks against it.
  let byCharacter = false;
  const touch = () => {
    const against = markers.filter((m) => stands(m));
    for (const m of against) if (m.mark) plan.emphasis.near.add(m.mark.id);
    if (against.length > 0) plan.emphasis.touched = true;
    return against.length > 0;
  };
  /** Whether the text from `a` to `b`, which the change would write again, is text of an insertion
   * or substitution: that is not the change's to write again (it would take the mark in). (The marker of a
   * deletion holds no text, and the change may stand on either side of it.) */
  const reaches = (a: number, b: number) =>
    plan.containers.some(
      (c) =>
        c.content.to > a && c.content.from < b && (c.content.to <= from || c.content.from >= to),
    );
  /** The words of a refusal that names the mark that stands against the change. */
  const againstWords = () => {
    const standing = markers.filter((m) => stands(m));
    const other =
      standing.find(
        (m) => m.mark?.kind === 'ins' || m.mark?.kind === 'sub' || m.mark?.kind === 'del',
      ) ?? standing[0];
    return other?.mark
      ? changesHow(plan.parsed, other.mark, plan.ctx.author)
      : 'A marker here would change how the text next to it is emphasized.';
  };
  /** Whether a delimiter stands in the change, next to it, or in or next to a mark that stands
   * against it: then deciding that mark can put delimiters next to the markers of the change. */
  const delimiters = () => {
    const touching = markers.filter((m) => stands(m));
    if (touching.length === 0) return false;
    for (const m of touching) if (m.mark) plan.emphasis.near.add(m.mark.id);
    const chars = [
      left + typing.inner + right,
      visibleBefore(plan, from).at(-1),
      visibleAfter(plan, to)[0],
    ];
    for (const m of touching) {
      const same = markers.filter((o) => o.mark === m.mark);
      const a = Math.min(...same.map((o) => o.from));
      const b = Math.max(...same.map((o) => o.to));
      chars.push(text.slice(a, b), visibleBefore(plan, a).at(-1), visibleAfter(plan, b)[0]);
    }
    return chars.some((c) => c !== undefined && DELIMITERS.test(c));
  };
  for (let attempt = 0; attempt < 24; attempt++) {
    const state = `${from} ${to} ${left} ${right}`;
    let content = left + typing.inner + right;
    const first = firstChar(content);
    // A prefix that the change takes away is no place for the marker, but what it leaves is.
    const where = from === start && at !== undefined ? at : from;
    const open = inspectPlace(text, markers, where, { after: content + visibleAfter(plan, to) });
    // A table that the deletion covers whole goes as a block, its first row an opener's place.
    if (open.kind === 'refuse') {
      if (coversTable(plan, where, from, to)) {
        // No marker stands in front of it.
      } else {
        // Right after a backslash at the end of a line, which would escape the opener: the change
        // takes the backslash in and starts in front of it (format §3.1).
        const backslash = open.backslash;
        if (open.trailing !== undefined && where === from) {
          // Among the trailing spaces of a hard break: the change starts in front of them.
          grow(open.trailing, to);
        } else if (
          backslash === undefined ||
          where !== from ||
          text.slice(backslash, from) !== '\\'
        ) {
          refuse(open.reason);
        } else if (endsInPrefix(`\n${visibleBefore(plan, backslash)}`)) {
          // The backslash starts its line's text: the opener in front of it would start the line.
          refuse(MARKER_STARTS_LINE);
        } else {
          grew = true;
          grow(backslash, to);
        }
      }
    } else if (open.kind === 'construct') grow(open.from, open.to);
    else if (open.kind === 'flank') {
      const p = stepLeft(text, markers, from);
      if (p === from || /[\r\n]/.test(text.slice(p, from))) {
        refuse('A marker here would change how the text next to it is emphasized.');
      }
      grow(p, to);
    } else if (open.kind === 'continuation' && first !== SPLIT) {
      const start = breakStart(text, from);
      // The break belongs to a split, and the line break can't be written twice.
      if (markers.some((m) => m.role === 'open' && m.mark?.kind === 'split' && m.to === start)) {
        refuse('Text can not start the line after a line break that someone inserted yet.');
      }
      grow(start, to);
    }
    // The text as the opener's widening left it.
    content = left + typing.inner + right;
    if (content !== '') {
      // The closer comes right after the text, not at the start of the line it is on now; after a
      // closing fence, alone on the line after it (format §3.3).
      const joined =
        (/[^\r\n]$/.test(content) && !/[\r\n][ \t>]*$/.test(content)) ||
        (typing.fenced === true && right === '');
      const close = inspectPlace(text, markers, to, {
        before: visibleBefore(plan, from) + content,
        ...(typing.trail !== '' ? { after: SPLIT } : {}),
        ...(joined ? { joined: true } : {}),
      });
      if (close.kind === 'refuse' && close.trailing !== undefined) {
        // Among or behind the trailing spaces of a hard break: the change goes on past the line
        // break, to the end of the first word of the next line.
        const ahead = nextWordEnd(plan, nextLineStart(text, to));
        if (ahead === undefined) refuse(close.reason);
        grow(from, ahead ?? to);
      } else if (close.kind === 'refuse') refuse(close.reason + tookBackslash);
      else if (close.kind === 'construct') grow(close.from, close.to);
      else if (
        close.kind === 'flank' &&
        (typing.inner === '' ||
          !kept() ||
          (touch() && plan.emphasis.mode > 0 && !reaches(to, stepRight(text, markers, to))))
      ) {
        const p = stepRight(text, markers, to);
        if (p === to || /[\r\n]/.test(text.slice(to, p))) {
          refuse('A marker here would change how the text next to it is emphasized.');
        }
        grow(from, p);
      } else if (
        (!kept() || (plan.emphasis.mode > 0 && delimiters())) &&
        !markers.some(
          (m) =>
            (m.from < to && m.to > from) ||
            (m.to >= from && m.from <= to && (m.mark?.kind === 'fmt' || m.mark?.kind === 'split')),
        )
      ) {
        // The markers read as punctuation to the delimiters next to them, as to a run that both of
        // them stand next to. Where a marker stands there already, in the range or next to it, the
        // text is read with it. One character more on the right, or on the left, or both, whichever
        // leaves it as it was.
        const l = stepLeft(text, markers, from);
        const r = stepRight(text, markers, to);
        const room = (a: number, b: number) => !/[\r\n]/.test(text.slice(a, b)) && a !== b;
        const keptAt = (a: number, b: number) =>
          emphasisKept(
            plan,
            a,
            b,
            visibleText(text, markers, a, from) +
              left +
              typing.inner +
              right +
              visibleText(text, markers, to, b),
            typing.trail,
          );
        if (!touch()) {
          if (room(to, r) && keptAt(from, r)) grow(from, r);
          else if (room(l, from) && keptAt(l, to)) grow(l, to);
          else if (room(l, from) && room(to, r)) grow(l, r);
          else refuse('A marker here would change how the text next to it is emphasized.');
        } else if (plan.emphasis.mode > 0 && !byCharacter) {
          // Next to another mark, as typed has been read otherwise: by a character on one side or
          // both, never into the text or the marker of another person's mark, and each way is read
          // in every order of decisions, the one that leaves the emphasis as it was first.
          const free = (a: number, b: number) => room(a, b) && !reaches(a, b);
          const ways: [number, number][] = [];
          if (free(to, r)) ways.push([from, r]);
          if (free(l, from)) ways.push([l, to]);
          if (free(l, from) && free(to, r)) ways.push([l, r]);
          ways.sort((x, y) => Number(keptAt(...y)) - Number(keptAt(...x)));
          plan.emphasis.options = Math.max(plan.emphasis.options, ways.length);
          const way = ways[Math.min(plan.emphasis.mode, ways.length) - 1];
          if (way) {
            byCharacter = true;
            grow(...way);
          } else refuse(againstWords());
        }
      }
    }
    // Nor may it follow an unescaped backslash, which would escape it (format §3.1): the change
    // takes the character after the backslash as well, which it escapes or stands in front of, or
    // the line break and the next word.
    const now = left + typing.inner + right;
    if (now !== '' && oddBackslashes(visibleBefore(plan, from) + now)) {
      tookBackslash =
        ' A backslash takes in the character after it, so that the change\u2019s marker does not follow it.';
      if (onDefinitionLine(plan, from)) refuse(BACKSLASH_DEFINITION);
      // At the end of the document: the closer goes after the line break that ends it, or after one
      // of the change's own (`endOfBody`).
      const last = endOfBody(plan, to);
      if (last) {
        atEnd = true;
        if (last.bring) right += plan.eol;
        else grow(from, last.end);
        continue;
      }
      const p = stepRight(text, markers, to);
      const lineBreak = p !== to && /[\r\n]/.test(text.slice(to, p));
      const ahead = lineBreak ? nextWordEnd(plan, nextLineStart(text, to)) : undefined;
      if (p === to) refuse(BACKSLASH_AT_END);
      if (lineBreak && ahead === undefined) refuse(noWordReason(plan, to));
      grow(from, ahead ?? p);
      continue;
    }
    // The closer must not start a line either, after the prefix of its block as well (`6. `): the
    // change goes on to the end of the next word. A line that has nothing but markers after the
    // closer has no text to be read as raw HTML.
    const full = left + typing.inner + right;
    if (
      full !== '' &&
      typing.trail === '' &&
      !(typing.fenced === true && right === '') &&
      endsInPrefix(full) &&
      !atEnd &&
      (/\n[ \t>]*$/.test(full) || visibleAfter(plan, to).trim() !== '')
    ) {
      let p = to;
      while (text[p] === ' ' || text[p] === '\t') p = stepRight(text, markers, p);
      if (p >= text.length || text[p] === '\r' || text[p] === '\n') {
        // Breaks typed after a backslash and the line break that is there: the closer goes after
        // the line break and the first word of the line after it, as for a backslash alone.
        const end =
          typing.plain === true && p === to && p < text.length
            ? nextWordEnd(plan, nextLineStart(text, p))
            : undefined;
        if (end === undefined) refuse(MARKER_STARTS_LINE);
        grow(from, end ?? p);
        continue;
      }
      while (p < text.length && !/\s/.test(text[p] ?? ' ')) p = stepRight(text, markers, p);
      grow(from, p);
    }
    if (state === `${from} ${to} ${left} ${right}`) {
      if (right !== '' && typing.trail !== '') refuse(MARKER_STARTS_LINE);
      // A change that took in the backslash in front of it is one substitution, or nothing: with
      // other changes in its range, deciding them in another order could read it otherwise.
      if (grew && !soleReplace(plan, from, to, { ...typing, inner: left + typing.inner + right })) {
        refuse(BACKSLASH_TAKEN);
      }
      if (delimiters()) plan.emphasis.touched = true;
      return { from, to, left, right };
    }
  }
  return refuse('There is no place for the markers of this change.');
}

/**
 * Where text typed at `position`, or a range that starts there, goes when that is in front of the
 * opener of another person's change of a block's type, quote or indent, and only the container's
 * syntax and markers stand before it on its line: behind the opener and its carrier, at the start
 * of the block's text, where the caret on the other side of the hidden markers would type it
 * (format §2.6). The arrow keys and Home leave the caret on either side. In front of the opener,
 * the text would start the block, and rejecting the change could no longer find its opener where a
 * mark that starts the block stands. Closers of marks that end where the block starts may stand in
 * front of the opener.
 */
function pastBlockOpener(plan: Plan, position: number): number {
  const { text, markers, ctx } = plan;
  const prefix = text.slice(lineStart(text, position), position).replace(/<!--.*?-->/g, '');
  if (!CONTAINER_PREFIX.test(prefix)) return position;
  let at = position;
  for (let step = 0; step <= markers.length; step++) {
    const marker = markers.find((m) => m.from === at && m.to > at);
    if (!marker) return position;
    if (marker.role === 'close') {
      at = marker.to;
      continue;
    }
    const { mark, segment } = marker;
    const isBlockChange =
      marker.role === 'open' &&
      mark?.kind === 'fmt' &&
      mark.entry.by !== ctx.author.handle &&
      /(?:^| )was=/.test(segment?.payload ?? mark.payload ?? '');
    return isBlockChange ? marker.to : position;
  }
  return position;
}

/** Typed text that starts with a line break, perhaps with the syntax of a hard break before it. */
const STARTS_WITH_BREAK = /^(?:[ \t]*|\\)\r?\n/;

/** Line breaks without the white space next to them, which Markdown does not read. */
const breaksOnly = (text: string) => text.replace(/[ \t]*\r?\n[ \t]*/g, '\n');

/**
 * Whether line breaks typed at `at` come out the same written behind the break of `unit`: `at` is
 * where the break ends, or it is in front of the break on its line (at its marker, in front of it
 * with nothing but markers between, or inside it), and the breaks typed and the break that is
 * there read the same in either order, up to the white space next to their line breaks: line
 * breaks alone, or a quote's markers on blank lines. Enter at the end of the line above a split is
 * then Enter on the line after it.
 */
function behindBreak(plan: Plan, unit: SplitUnit, at: number, typed: string): boolean {
  if (at === unit.end) return true;
  if (at > unit.end) return false;
  const { text, markers } = plan;
  if (at < unit.marker.from) {
    if (lineStart(text, unit.marker.from) > at) return false;
    if (visibleText(text, markers, at, unit.marker.from) !== '') return false;
  }
  const jumped = visibleText(text, markers, at, unit.end);
  return breaksOnly(typed + jumped) === breaksOnly(jumped + typed);
}

/** Whether the break of a split takes a blank line: it can take no more (format §3.4). */
function takesBlankLine(text: string, unit: SplitUnit): boolean {
  return text.slice(unit.marker.to, unit.end).split('\n').length > 2;
}

/** How long the break of `unit` is with `typed` written behind it, when it is read that long, as
 * Enter twice makes a break a blank line. */
function grownBreak(plan: Plan, unit: SplitUnit, typed: string): number | undefined {
  const { text } = plan;
  const written = text.slice(unit.marker.to, unit.end) + typed;
  const rest = written + text.slice(unit.end, unit.end + 200);
  const read = breakLength(linePrefixAt(text, unit.marker.to), rest);
  return read === written.length ? read : undefined;
}

/** Where a typed line break goes when it goes behind a break: a split of its own, or the break of
 * the author's own split behind it made longer. */
interface Behind {
  change: TextChange;
  longer?: { id: string; length: number };
}

/**
 * Line breaks typed next to the break of a split that is a blank line already, which can take no
 * more, go behind it, on the line after the blank line (format §3.4). In front of it, the break of
 * a new split would take that blank line in once the split behind it was accepted, and rejecting
 * the new split would then take away the other's line breaks too: the two would read differently
 * in different decision orders. Behind it, the first break takes nothing more, whatever is decided.
 * Where another split stands there already, the author's own makes its break longer, as Enter
 * twice does; behind one whose break is a blank line as well, the break goes on behind that. Else
 * the breaks are a split of their own. Undefined when the text is not that.
 */
function splitBehind(plan: Plan, at: number, typed: string): Behind | undefined {
  const { text, markers } = plan;
  if (!STARTS_WITH_BREAK.test(typed)) return undefined;
  const units = splitUnits(plan);
  // The line breaks typed and those they go behind read the same in either order.
  const commutes = (place: number) => {
    const jumped = visibleText(text, markers, at, place);
    return breaksOnly(typed + jumped) === breaksOnly(jumped + typed);
  };
  for (const unit of units) {
    if (!takesBlankLine(text, unit) || !behindBreak(plan, unit, at, typed)) continue;
    let place = unit.end;
    for (let next = units.find((u) => u.marker.from === place); next;) {
      const length = next.own ? grownBreak(plan, next, typed) : undefined;
      if (length !== undefined) {
        if (!commutes(next.end)) return undefined;
        return {
          change: { from: next.end, to: next.end, insert: typed },
          longer: { id: next.id, length },
        };
      }
      if (!takesBlankLine(text, next) || next.end <= place) break;
      place = next.end;
      next = units.find((u) => u.marker.from === place);
    }
    if (!commutes(place)) return undefined;
    const tokens = tokenize(typed, linePrefixAt(text, place));
    if (tokens.length === 0) return undefined;
    let insert = '';
    for (const token of tokens) {
      if (!('brk' in token)) return undefined;
      insert += SPLIT + String.fromCharCode(LENGTH + token.brk.length) + token.brk;
    }
    return { change: { from: place, to: place, insert } };
  }
  return undefined;
}

/**
 * A line break typed right after the break of the author's own split, or right in front of it (at
 * the end of the line above), makes that break longer and leaves one split (format §3.4): Enter
 * twice in the middle of a paragraph is one split whose break is a blank line. The break is written
 * as it is, behind the break that is there, and the split keeps its marker and its entry. The
 * breaks of other splits may come right after it, one after the other, and the line break goes in
 * front of them. Undefined when the text is not that, or when the break would not be read as long
 * as it was written (it is a blank line already, or a bullet follows it): the break is then a
 * split of its own.
 */
function longerBreak(
  plan: Plan,
  at: number,
  typed: string,
): { change: TextChange; id: string; length: number } | undefined {
  const { text } = plan;
  const units = splitUnits(plan);
  const tokens = tokenize(typed, linePrefixAt(text, at));
  if (tokens.length === 0 || !tokens.every((token) => 'brk' in token)) return undefined;
  for (const unit of units) {
    if (!unit.own) continue;
    // Where its break ends, and where the breaks that follow it end.
    const ends = [unit.end];
    for (let next = units.find((u) => u.marker.from === unit.end); next;) {
      ends.push(next.end);
      const end = next.end;
      next = ends.length > units.length ? undefined : units.find((u) => u.marker.from === end);
    }
    if (!ends.includes(at) && !behindBreak(plan, unit, at, typed)) continue;
    const length = grownBreak(plan, unit, typed);
    if (length === undefined) continue;
    return { change: { from: unit.end, to: unit.end, insert: typed }, id: unit.id, length };
  }
  return undefined;
}

/**
 * Whether a blank line between `from` and `to` is content, not nothing (format §3.4): in fenced or
 * indented code, an HTML comment, or a block of raw text, where it is a line of the code or the
 * text. Blank lines there are never written or taken away without a mark.
 */
function blankLinesMatter(plan: Plan, from: number, to: number): boolean {
  const { text, markers } = plan;
  const verbatim = (plan.verbatim ??= scan(text).verbatim);
  // A range ends at the line break of its last line, which a CRLF's `\r` is part of: a place at the
  // end of that line, before the `\r`, is not in the block.
  const ends = (range: Range) => (text[range.to - 1] === '\r' ? range.to - 1 : range.to);
  return (
    verbatim.some((range) => range.from < to && from < ends(range)) ||
    betweenIndentedCode(text, from, markers)
  );
}

/** What the original text has between two places that the newest text has not: the text of the
 * deletions and substitutions there. */
function originalBetween(plan: Plan, from: number, to: number): string {
  return plan.markers
    .filter((m) => m.role === 'open' && m.from >= from && m.to <= to)
    .map((m) =>
      m.mark?.kind === 'del' || m.mark?.kind === 'sub' ? (m.segment?.payload ?? '') : '',
    )
    .join('');
}

/**
 * Where line breaks typed at `position` are written, when that is at a block boundary and they are
 * written as they are, with no mark (format §3.4): at the end of a block's text, in the blank lines
 * between two blocks, in front of the first block, or at the end of the text. Blank lines between
 * blocks do not change what is rendered, and a split there would leave an empty block. Undefined
 * for a position in the middle of a block, where a line break is a split. `quoteLines`: the lines
 * written are blank lines of a quote, with its markers, which make no list the quote is in loose.
 *
 * `skip`: a split of the author's own at `position` whose marker and break the edit takes away, and
 * whose break stays as the line breaks `kept` (`blankBreak`): the place is read in the text without
 * them, where the text goes on at the end of its break, and the break of the blocks there must have
 * a blank line already, or the blocks around must read the same with `kept` as without it
 * (`readsAlike`), or the place must end the text, so that the line breaks can be taken out plain
 * again as far as the original has them.
 */
function plainBreakAt(
  plan: Plan,
  position: number,
  quoteLines = false,
  skip?: SplitUnit,
  kept = '',
): number | undefined {
  const { text, markers } = plan;
  const after = skip ? skip.end : position;
  // Next to a break that someone inserted, the original text goes on: a split, and not a boundary.
  const units = splitUnits(plan).filter((u) => u.marker.from !== skip?.marker.from);
  const near = (p: number) => units.some((u) => u.marker.from <= p && p <= u.end);
  if (near(position) || near(after)) return undefined;
  // The breaks around the place: one that holds it, or the one at the end of its line.
  const blocks = breaksOfBody(plan, after, lineEnd(text, after)).filter((found) => found.block);
  const end = bodyEnd(plan);
  let at: number | undefined;
  let found = blocks.find((b) => b.start <= after && after <= lineStart(text, b.end));
  const original = (from: number, to: number) => originalBetween(plan, from, to);
  // The end of the closing fence of code in a container (the block reading of the breaks does not
  // see it): the break after it is between two blocks.
  const fenceEnd = !skip && position === lineEnd(text, position) && endsFenceAt(plan, position);
  if (fenceEnd) at = position;
  else if (found) at = position;
  else {
    // At the end of the last line of a block, with only markers after it on that line, and no
    // text of the original in them: the block would go on in the original text.
    found = blocks.find(
      (b) =>
        b.start > after &&
        !text.slice(after, b.start).includes('\n') &&
        visibleText(text, markers, after, b.start) === '' &&
        original(after, b.start).trim() === '',
    );
    if (found) at = skip ? position : found.start;
    // In front of the first block of the body, or in the white space before it.
    else if (
      !skip &&
      visibleText(text, markers, Math.min(plan.bodyStart, position), position).trim() === '' &&
      original(Math.min(plan.bodyStart, position), position).trim() === ''
    ) {
      at = position;
    }
    // After the last block: at the end of its last line, or in the white space after it.
    else if (
      visibleText(text, markers, after, end).trim() === '' &&
      original(after, end).trim() === ''
    ) {
      at = skip || position >= end ? position : pastMarkers(plan, position);
    }
  }
  if (at === undefined || near(at)) return undefined;
  if (skip) {
    const blank =
      found && text.slice(found.start, lineStart(text, found.end)).split('\n').length > 2;
    if (!blank && !readsAlike(plan, skip.marker.from, skip.end, kept, '')) return undefined;
  }
  // A blank line is content in code and raw text, and between the items of a tight list it makes the
  // list loose: there Enter is a split, or is refused, and never plain.
  if ([position, at, after].some((p) => blankLinesMatter(plan, p, p))) return undefined;
  if (quoteLines) return at;
  const read = skip ? text.slice(0, skip.marker.from) + text.slice(skip.end) : text;
  if (loosensList(read, at, skip ? markers.filter((m) => m.to <= at) : markers)) return undefined;
  return at;
}

/**
 * The deletion of line breaks and nothing else, when blank lines are left between the blocks: the
 * Backspace over a line break that Enter wrote (format §3.4). It writes no mark, as Enter did, and
 * brings back the text that was there before. Undefined for any other deletion, which is a join:
 * one that leaves the blocks with less than a blank line between them, or one that takes a line
 * break from code, or from the break of a split, or from next to a marker.
 */
function plainCut(plan: Plan, from: number, to: number): TextChange | undefined {
  const { text, markers } = plan;
  const cut = text.slice(from, to);
  if (!/^[ \t\r\n]*$/.test(cut) || !cut.includes('\n')) return undefined;
  // Not a part of a CRLF.
  const halved = (at: number) => text[at - 1] === '\r' && text[at] === '\n';
  if (halved(from) || halved(to)) return undefined;
  // The white space around it, as far as it goes, with no marker or carrier in it.
  let a = from;
  while (a > 0 && /[ \t\r\n]/.test(text[a - 1] ?? '')) a--;
  let b = to;
  while (b < text.length && /[ \t\r\n]/.test(text[b] ?? '')) b++;
  if (markers.some((m) => m.from < b && m.to > a)) return undefined;
  const breaks = (s: string) => (s.match(/\n/g) ?? []).length;
  const left = breaks(text.slice(a, b)) - breaks(cut);
  // White space with no text before it, or none after it, is no break between blocks: nothing is
  // joined, in the newest text or in the original. White space is spaces, tabs and line breaks: a
  // no-break space or a form feed is text, as CommonMark reads it.
  const end = textEnd(plan);
  const blank = (s: string) => /^[ \t\r\n]*$/.test(s);
  const alone = (text0: string, original: string) => blank(text0) && blank(original);
  // The body starts after front matter, as a file of its own.
  const start = Math.min(plan.bodyStart, a);
  const edge =
    alone(visibleText(text, markers, start, a), originalBetween(plan, start, a)) ||
    alone(visibleText(text, markers, b, end), originalBetween(plan, b, end));
  // One line break left between two blocks that read the same without a blank line between them,
  // as Enter at the end of a paragraph that a heading follows leaves them: as far apart as the
  // original has them.
  const apart = left === 1 && !edge && readsAlike(plan, from, to, cut, '');
  if (left < 2 && !edge && !apart) return undefined;
  if (splitUnits(plan).some((u) => u.marker.from <= b && a <= u.end)) return undefined;
  if (blankLinesMatter(plan, a, b)) return undefined;
  return { from, to, insert: '' };
}

/**
 * The deletion of a run of a quote's blank lines at the end of its text, in one edit: the line
 * breaks, the quote markers and the spaces of lines that have nothing else on them, which leave
 * the blocks around them reading as they did (`readsAlike`). The editor's Return in an empty
 * paragraph of a quote takes the markers one quote at a time (`blankLineCut`); this is the same
 * written at once, plain (format §3.4). Undefined for any other deletion: one that leaves a mark,
 * a split or code in the run, or a quote that goes on after the run, which it would part.
 */
function quoteRunCut(plan: Plan, from: number, to: number): TextChange | undefined {
  const { text, markers } = plan;
  // The spaces left on the last line of the run go with it.
  const end = lineEnd(text, to);
  if (/^[ \t]*$/.test(text.slice(to, end))) to = end;
  const cut = text.slice(from, to);
  if (!/^(?:\r?\n[ \t>]*)+$/.test(cut) || !cut.includes('>')) return undefined;
  const halved = (at: number) => text[at - 1] === '\r' && text[at] === '\n';
  if (halved(from) || halved(to) || to !== end) return undefined;
  // After a line of text, in a quote.
  const before = text.slice(lineStart(text, from), from);
  if (/^[ \t>]*$/.test(before)) return undefined;
  if (markers.some((m) => m.role !== 'ledger' && m.from <= to && m.to >= from - 1)) {
    return undefined;
  }
  if (splitUnits(plan).some((u) => u.marker.from <= to && from <= u.end)) return undefined;
  if (blankLinesMatter(plan, from, to)) return undefined;
  if (!readsAlike(plan, from, to, cut, '')) return undefined;
  return { from, to, insert: '' };
}

/** How many lines above and below the place `readsAlike` reads, at most, to find the top level. */
const READ_LINES = 200;

/**
 * Whether the blocks around `[from, to)` read the same with `blank` there, line breaks that leave a
 * blank line between two blocks, as with `close` there, which leaves none (format §3.4): read from
 * the line at the top level above them to the one below (`sameBlocks`), a line break written or
 * taken out plain there changes nothing that is rendered. Not where a mark is near, whose views
 * could read otherwise (another person's comment is read through: it is in neither view), nor far
 * from the top level.
 */
function readsAlike(plan: Plan, from: number, to: number, blank: string, close: string): boolean {
  const { text, markers } = plan;
  // A carriage return alone ends a line for CommonMark, and not for the lines read here.
  if (text.includes('\r') && /\r(?!\n)/.test(text)) return false;
  const floor = plan.frontEnd >= 0 ? nextLineStart(text, plan.frontEnd) : 0;
  const end = textEnd(plan);
  const verbatim = (plan.verbatim ??= scan(text).verbatim);
  const inside = (at: number) => verbatim.some((range) => range.from < at && at < range.to);
  const blankAt = (at: number) => /^[ \t]*$/.test(text.slice(at, lineEnd(text, at)));
  // The first line: at the first column after a blank line, in no block that goes on over blank
  // lines, or the first line of the body.
  let top = lineStart(text, from);
  for (let n = 0; top > floor; n++) {
    const above = lineStart(text, top - 1);
    if (/[^ \t\r\n]/.test(text[top] ?? '') && blankAt(above) && !inside(top)) break;
    if (n === READ_LINES) return false;
    top = above;
  }
  top = Math.max(top, floor);
  if (htmlOpenAbove(text, top, floor)) return false;
  // The last line: one that blank lines follow, then a line at the first column or the end of the
  // body, in no block that goes on over blank lines.
  let bottom = lineEnd(text, to);
  for (let n = 0; nextLineStart(text, bottom) <= end; n++) {
    let next = nextLineStart(text, bottom);
    if (blankAt(next) && !inside(bottom)) {
      while (next <= end && blankAt(next)) next = nextLineStart(text, next);
      if (next > end || /[^ \t\r\n]/.test(text[next] ?? '')) break;
    }
    if (n === READ_LINES) return false;
    bottom = lineEnd(text, nextLineStart(text, bottom));
  }
  // No mark near but comments, whose markers are read through.
  const comments: MarkerRange[] = [];
  for (const marker of markers) {
    if (marker.role === 'ledger' || marker.to <= top || marker.from >= bottom) continue;
    if (from <= marker.from && marker.to <= to) continue;
    if (marker.mark?.kind !== 'cmt') return false;
    comments.push(marker);
  }
  const marked = (c: Container) =>
    c.mark.kind !== 'cmt' && c.content.from < bottom && top < c.content.to;
  if (plan.containers.some(marked)) return false;
  const head = visibleText(text, comments, top, from);
  const tail = visibleText(text, comments, to, bottom);
  return sameBlocks(head, blank, close, tail);
}

/**
 * Whether an HTML block that only its end ends, blank lines or not, started at the first column of
 * a line above `at` and is open there: one of `<?`, `<!` and a letter, or `<![CDATA[`. (A comment
 * and a block of raw text are `Scan.verbatim`.)
 */
function htmlOpenAbove(text: string, at: number, floor: number): boolean {
  for (const [start, end] of [
    ['<?', '?>'],
    ['<![CDATA[', ']]>'],
    ['<!', '>'],
  ] as const) {
    // Each one above `at`, the last first (`lastIndexOf` takes a place before the text's start for
    // its start, and finds what starts there again).
    let i = at > 0 ? text.lastIndexOf(start, at - 1) : -1;
    for (; i >= floor; i = i > 0 ? text.lastIndexOf(start, i - 1) : -1) {
      if (start === '<!' && !/[A-Za-z]/.test(text[i + 2] ?? '')) continue;
      if (!/^ {0,3}$/.test(text.slice(lineStart(text, i), i))) continue;
      const closed = text.indexOf(end, i + start.length);
      if (closed === -1 || closed >= at) return true;
      break;
    }
  }
  return false;
}

/**
 * Whether the line after the one that holds `position` has nothing on it, no quote marker either, or
 * there is none (the ledger is none): a quote that the line holding `position` is in ends with it.
 */
function quoteEndsAt(text: string, position: number): boolean {
  const next = nextLineStart(text, position);
  return next > text.length || /^[ \t]*$/.test(text.slice(next, lineEnd(text, next)));
}

/**
 * Whether the line after the one that holds `position` is a blank line of `quote`, the quote that
 * line is in: its quote markers and nothing else, as deep, in a quote that goes on from the line
 * above (`blockQuoteAt`). A blank line of the quote written next to it reads as one with it.
 */
function blankQuoteLineAfter(text: string, position: number, quote: string): boolean {
  const next = nextLineStart(text, position);
  if (next > text.length) return false;
  const line = text.slice(next, lineEnd(text, next));
  if (!/^[ \t>]*$/.test(line) || line.trimEnd() !== quote) return false;
  const read = blockQuoteAt(text, next);
  return read !== undefined && !read.opens && read.quote === quote;
}

/**
 * The text with each blank line of a quote that another blank line of the same quote follows left
 * out: a renderer reads the two as one (format §3.4).
 */
function withoutQuoteRuns(text: string): string {
  const lines = text.split('\n');
  let at = 0;
  const kept = lines.filter((line, i) => {
    const start = at;
    at += line.length + 1;
    const next = lines[i + 1];
    if (next === undefined || !/^[ \t]*>[ \t>]*\r?$/.test(line)) return true;
    if (next.trimEnd() !== line.trimEnd()) return true;
    const read = blockQuoteAt(text, start);
    return read === undefined || read.opens;
  });
  return kept.join('\n');
}

/**
 * What starts a fence or an HTML block, at the start of a line's text: after it, a quote marker at
 * the start of a line is code or raw text, not a quote. Of the HTML blocks only those CommonMark
 * starts: a line that begins with a tag of its own, a comment, a declaration or the like, not any
 * `<` (an autolink, or a tag with text after it on its line, is ordinary text).
 */
const FENCE_START = /^(`{3,}|~{3,})(.*)$/;
const HTML_ENDS: readonly [RegExp, RegExp | 'blank'][] = [
  [/^<(?:script|pre|style|textarea)(?=[\s>]|$)/i, /<\/(?:script|pre|style|textarea)>/i],
  [/^<!--/, /-->/],
  [/^<\?/, /\?>/],
  [/^<!\[CDATA\[/, /\]\]>/],
  [/^<![A-Za-z]/, />/],
  [
    /^<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?=[\s>]|\/>|$)/i,
    'blank',
  ],
  // Any other tag alone on its line, which only starts a block where a paragraph is not open.
  [
    /^(?:<[A-Za-z][A-Za-z0-9-]*(?:\s+[A-Za-z_:][\w:.-]*(?:\s*=\s*(?:[^\s"'=<>`]+|'[^']*'|"[^"]*"))?)*\s*\/?>|<\/[A-Za-z][A-Za-z0-9-]*\s*>)\s*$/,
    'blank',
  ],
];

/** A line of a block, as `rawAtEnd` reads it: how many quote markers it is in, and its text. */
interface BlockLine {
  depth: number;
  text: string;
}

/**
 * Whether a fence or an HTML block is open at the end of the last of `lines`, or that line starts
 * one (it is not an ordinary line of text whose end Enter can read). A fence closes with a fence of
 * its kind that is no shorter, an HTML block with its end (a comment's `-->`) or, for the kinds
 * that go on to a blank line, with a line that has nothing in it after the quote markers it was
 * opened in; a line with fewer quote markers ends either, and one with more has them as text.
 */
function rawAtEnd(lines: readonly BlockLine[]): boolean {
  let fence: { mark: string; depth: number } | undefined;
  let html: { end: RegExp | 'blank'; depth: number } | undefined;
  let last = false;
  /** Whether the line above is a line of text of a paragraph. */
  let underText = false;
  for (const [i, { depth, text: raw }] of lines.entries()) {
    const own = raw.replace(/\r$/, '');
    let starts = false;
    /** The line is the closing fence: code, but a break after it is outside the code. */
    let closes = false;
    if (fence && depth < fence.depth) fence = undefined;
    if (html && depth < html.depth) html = undefined;
    if (fence !== undefined) {
      const line = '>'.repeat(depth - fence.depth) + own;
      const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line)?.[1];
      if (close && close[0] === fence.mark[0] && close.length >= fence.mark.length) {
        fence = undefined;
        closes = true;
      }
      starts = true;
    } else if (html !== undefined) {
      const line = '>'.repeat(depth - html.depth) + own;
      if (html.end === 'blank' ? line.trim() === '' : html.end.test(line)) html = undefined;
      starts = html !== undefined || line.trim() !== '';
    } else {
      const text = own.trimStart();
      const opens = FENCE_START.exec(text);
      if (opens && !(opens[1]?.[0] === '`' && (opens[2] ?? '').includes('`'))) {
        fence = { mark: opens[1] ?? '```', depth };
        starts = true;
      } else if (text.startsWith('<')) {
        let kind = HTML_ENDS.find(([start]) => start.test(text));
        // A tag alone on its line (the last kind) cannot interrupt a paragraph: under a line of
        // text it is text of that paragraph.
        if (kind === HTML_ENDS.at(-1) && underText) kind = undefined;
        if (kind) {
          starts = true;
          const [, end] = kind;
          // The kinds with an end condition may end on the line itself.
          if (!(end !== 'blank' && end.test(text.slice(1)))) html = { end, depth };
        }
      }
    }
    underText = !starts && own.trim() !== '';
    // A line that is code or raw text, or starts it, is not read as a line of a quote.
    if (i === lines.length - 1) {
      last = (starts && !closes) || fence !== undefined || html !== undefined;
    }
  }
  return last;
}

/** Container markers that each stand no more than three columns in: a quote's, a list item's. */
const OPENERS = /^(?: {0,3}(?:>[ \t]?|(?:[-*+]|\d{1,9}[.)])[ \t]{1,4}))*/;

/** Whether the line that holds `position` is the closing line of a fenced block, in a container. */
function endsFenceAt(plan: Plan, position: number): boolean {
  const end = lineEnd(plan.text, position);
  const verbatim = (plan.verbatim ??= scan(plan.text).verbatim);
  return verbatim.some(
    (range) => range.kind === 'fence' && (range.to === end || range.to === end + 1),
  );
}

/**
 * The quote that the line holding `position` is a line of, as a renderer reads the blocks, or
 * undefined: its quote markers, with the indentation of the list items around them (`>`, `> >`,
 * `  >`). Read up from the line through the lines of its block (to the top of the text, or a line
 * with nothing on it): the lines down from the one that opens the quote have its markers in front
 * of their text, as deep or deeper; that line is the first of the block, or follows a line in the
 * containers around the quote, and has each of its markers no more than three columns in; no line
 * of the block from its first holds the start of a fence or an HTML block, or code indented in the
 * quote, which would make the quote markers after it code or raw text. `opens` tells whether the
 * line is the one that opens the quote. A line of the quote that does not open it, with nothing but
 * quote markers on it, is a blank line of the quote; one that opens it is a quote of its own, a
 * block that a renderer shows even with nothing in it. Anything else is read as no quote, and
 * edits there take the tracked path.
 */
function blockQuoteAt(
  text: string,
  position: number,
): { quote: string; opens: boolean } | undefined {
  const lineAt = (start: number) => text.slice(start, lineEnd(text, start));
  const prefixOf = (line: string) => line.slice(0, prefixLength(line));
  const quoteOf = (line: string) => continuationPrefix(prefixOf(line)).trimEnd();
  const quote = quoteOf(lineAt(lineStart(text, position)));
  if (!quote.includes('>')) return undefined;
  const around = quote.slice(0, quote.lastIndexOf('>')).trimEnd();
  let opened = false;
  let opens = false;
  /** The lines of the block from the position's line up, after their container syntax. */
  const contents: BlockLine[] = [];
  for (let start = lineStart(text, position); ;) {
    const line = lineAt(start);
    const prefix = prefixOf(line);
    contents.push({ depth: (prefix.match(/>/g) ?? []).length, text: line.slice(prefix.length) });
    if (!opened) {
      if (!quoteOf(line).startsWith(quote)) return undefined;
      // More than the one space after the last quote marker, and three more, is indented code.
      if (indentColumns(prefix.slice(prefix.lastIndexOf('>') + 1)) > 4) return undefined;
    }
    // The first line of the body has none above it, after front matter too (format §3.8).
    const above = isBodyStart(text, start) ? undefined : lineStart(text, start - 1);
    const first = above === undefined || /^[ \t]*$/.test(lineAt(above));
    if (!opened && (first || quoteOf(lineAt(above ?? 0)) === around)) {
      // The line that opens the quote, in the containers of the line above it.
      if ((OPENERS.exec(line)?.[0].length ?? 0) < prefix.trimEnd().length) return undefined;
      opens = start === lineStart(text, position);
      opened = true;
    }
    if (first) return rawAtEnd(contents.toReversed()) ? undefined : { quote, opens };
    start = above ?? 0;
  }
}

/**
 * The text without the blank lines that end a quote (`quoteEndsAt`) and do not open it
 * (`blockQuoteAt`): a renderer reads them as nothing more (format §3.4).
 */
function withoutQuoteEnds(text: string): string {
  const lines = text.split('\n');
  const starts: number[] = [];
  let at = 0;
  for (const line of lines) {
    starts.push(at);
    at += line.length + 1;
  }
  const gone = lines.map(() => false);
  for (let i = lines.length - 1; i > 0; i--) {
    const line = lines[i] ?? '';
    if (!/^[ \t>]*>[ \t>]*\r?$/.test(line)) continue;
    const next = lines[i + 1];
    const ends = next === undefined || /^[ \t]*\r?$/.test(next) || gone[i + 1] === true;
    const start = starts[i] ?? 0;
    const read = blockQuoteAt(text, start);
    gone[i] = ends && read !== undefined && !read.opens;
  }
  return lines.filter((_, i) => !gone[i]).join('\n');
}

/**
 * The deletion of the quote markers or the white space of a blank line, and nothing else, which
 * leaves it a blank line: the Backspace over the `> ` that Enter at the end of a quote wrote, and
 * over the indentation of a list item's lines that is left of it (format §3.4). A renderer reads
 * the line as it did, or the quote as ending a line earlier where the line is a blank line of a
 * quote that goes on from the line above (`blockQuoteAt`) and ends with it (`quoteEndsAt`): it
 * writes no mark, as Enter did. Undefined for any other deletion: of quote markers that open a
 * quote of their own, which a renderer shows, or that are text of an HTML block or code, or of the
 * indentation in front of them, which takes the line out of its list item; or for a line with a
 * marker on it, or in the break of a split. `refused` when the quote goes on after the line, which
 * taking its markers out would part.
 */
function blankLineCut(plan: Plan, from: number, to: number): TextChange | 'refused' | undefined {
  const { text, markers } = plan;
  const cut = text.slice(from, to);
  if (!/^[ \t>]+$/.test(cut)) return undefined;
  const start = lineStart(text, from);
  const end = lineEnd(text, from);
  const line = text.slice(start, end);
  if (to > end || !/^[ \t>]*$/.test(line)) return undefined;
  if (markers.some((m) => m.role !== 'ledger' && m.from < end + 1 && m.to > start)) {
    return undefined;
  }
  if (splitUnits(plan).some((u) => u.marker.from <= end && start < u.end)) return undefined;
  if (blankLinesMatter(plan, start, end)) return undefined;
  const first = line.indexOf('>');
  if (first === -1) return { from, to, insert: '' };
  const read = blockQuoteAt(text, start);
  if (read === undefined || read.opens) return undefined;
  // White space after the first quote marker leaves the line where it is.
  if (!cut.includes('>')) return from > start + first ? { from, to, insert: '' } : undefined;
  return quoteEndsAt(text, end) ? { from, to, insert: '' } : 'refused';
}

/** A word of letters, digits and emoji, with punctuation that no construct starts with: a closer
 * may follow it. */
const PLAIN_WORD =
  /^[\p{L}\p{N}\p{Extended_Pictographic}][\p{L}\p{N}\p{M}\p{Extended_Pictographic}.,;!?'"-]*$/u;

/**
 * Taking out the quote markers of a blank line of a quote that another blank line of the same quote
 * stands next to, as deep, where the quote goes on after them with text: the editor's Backspace on
 * the line that Enter at the end of a paragraph of the quote wrote (format §3.4). The line left,
 * empty or with the markers of the quotes around, parts the quote, which a reader sees, and no
 * marker can stand in a prefix: it is a substitution of the break from the end of the line above to
 * the end of the first word of the line after, whose new text is the break as it now is (the text
 * there, with the edit made). Its old text is the break without the line, which read as one with
 * the other blank line: the original text loses it, plain, and reads as it did. Only a plain word
 * may follow, where the closer goes (`PLAIN_WORD`), behind a heading's `#`s. Returns whether it
 * wrote that.
 */
function quoteRunSub(plan: Plan, from: number, to: number): boolean {
  const { text, markers } = plan;
  const start = lineStart(text, from);
  const end = lineEnd(text, from);
  const markup = text.slice(start, end).trimEnd();
  /** Whether the line that starts at `at` is a blank line with the same quote markers. */
  const same = (at: number) => {
    const line = text.slice(at, lineEnd(text, at));
    return /^[ \t>]*$/.test(line) && line.trimEnd() === markup;
  };
  let first = start;
  while (first > 0 && same(lineStart(text, first - 1))) first = lineStart(text, first - 1);
  let last = start;
  while (nextLineStart(text, last) <= text.length && same(nextLineStart(text, last))) {
    last = nextLineStart(text, last);
  }
  if ((first === start && last === start) || first === 0) return false;
  // Text on the line above and on the line below, in the quote, as deep or deeper.
  const above = lineStart(text, first - 1);
  const below = nextLineStart(text, last);
  if (below > text.length) return false;
  const belowEnd = lineEnd(text, below);
  const belowLine = text.slice(below, belowEnd);
  if (/^[ \t>]*$/.test(text.slice(above, lineEnd(text, above))) || /^[ \t>]*$/.test(belowLine)) {
    return false;
  }
  const read = blockQuoteAt(text, below);
  if (!read || read.opens || !read.quote.startsWith(markup)) return false;
  // The first word of the line's text, behind a heading's `#`s.
  const lead = prefixLength(belowLine);
  const textStart = below + lead + (/^#{1,6}[ \t]+/.exec(belowLine.slice(lead))?.[0].length ?? 0);
  let wordEnd = textStart;
  while (wordEnd < belowEnd && !/\s/.test(text[wordEnd] ?? ' ')) wordEnd++;
  if (!PLAIN_WORD.test(text.slice(textStart, wordEnd))) return false;
  const at = lineEnd(text, above);
  if (markers.some((m) => m.from < wordEnd && m.to > at)) return false;
  const lineBreak = text[start - 2] === '\r' ? start - 2 : start - 1;
  const old = text.slice(at, lineBreak) + text.slice(end, wordEnd);
  const id = newMark(plan);
  // Written as three changes, opener, the edit and closer, around the text that stays: an edit of
  // the same keystroke inside it (the editor's Enter that leaves a quote takes the markers of two
  // blank lines at once) still finds its text there, in the new text of the substitution.
  const opener = `<!--sub ${id} ${encodePayload(old.replaceAll('\r\n', '\n'))}-->`;
  plan.changes.push(
    { from: at, to: at, insert: opener },
    { from, to, insert: '' },
    { from: wordEnd, to: wordEnd, insert: `<!--/${id}-->` },
  );
  plan.spans.push({ from: at, to: wordEnd });
  plan.raw.push(id);
  plan.plain = true;
  return true;
}

/** How many columns white space takes, a tab to the next multiple of four. */
function columns(space: string): number {
  let width = 0;
  for (const c of space) width = c === '\t' ? width + 4 - (width % 4) : width + 1;
  return width;
}

/**
 * Whether `typed` is line breaks with white space alone after the last, typed at the end of a
 * line's text, where the white space is no wider than that line's indentation: a blank line
 * whatever it holds (#204).
 */
function blankLineTyped(plan: Plan, from: number, typed: string): boolean {
  const lines = /^(?:[ \t]*\r?\n)+([ \t]*)$/.exec(typed);
  if (!lines) return false;
  const { text, markers } = plan;
  if (visibleText(text, markers, from, lineEnd(text, from)).trim() !== '') return false;
  return columns(lines[1] ?? '') <= columns(linePrefixAt(text, from).replace(/[^\t]/g, ' '));
}

/**
 * Where a closer may stand after the first word that starts at `start`, once `edit` is made: past
 * the word, and then past a whole construct the place is inside, or a character where the closer
 * would change how emphasis flanks (format §3.1). Undefined where that goes past `end`, the end of
 * the line, or the place is refused.
 */
function closerAfterWord(
  plan: Plan,
  edit: TextChange,
  start: number,
  end: number,
): number | undefined {
  const { text, markers } = plan;
  const delta = edit.insert.length - (edit.to - edit.from);
  const edited = text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
  const moved = markers.map((m) =>
    m.from >= edit.to ? { from: m.from + delta, to: m.to + delta } : m,
  );
  let p = start;
  while (p < end && !/\s/.test(text[p] ?? ' ')) p = stepRight(text, markers, p);
  for (let attempt = 0; attempt < 16 && p <= end; attempt++) {
    // Not inside a code span, which takes no marker: after it, and the rest of the word.
    const span = codeSpanAt(edited, moved, p + delta);
    if (span) {
      p = span.to - delta;
      while (p < end && !/\s/.test(text[p] ?? ' ')) p = stepRight(text, markers, p);
      continue;
    }
    const place = inspectPlace(edited, moved, p + delta);
    if (place.kind === 'ok') return p;
    if (place.kind === 'construct' && place.to - delta > p) p = place.to - delta;
    else if (place.kind === 'construct' || place.kind === 'flank') p = stepRight(text, markers, p);
    else return undefined;
  }
  return undefined;
}

/**
 * Return next to a hard line break (format §3.4): an edit that replaces the syntax of a hard break
 * (a backslash, or two spaces or more, at the end of a line), its line break and the prefix of the
 * line after it by a paragraph break, line breaks and prefix characters with a blank line among
 * them. Kept as the line break the two have in common and the rest typed, it would leave the break
 * syntax as a literal backslash at the end of a paragraph, or a marker where none may stand.
 *
 * - The break of your own pending split (its marker right in front of the syntax): the split takes
 *   the paragraph break as its break, written as it is, and stays.
 * - A hard break in the original text: a substitution of the break, from the syntax to the end of
 *   the first word of the line after, where its closer may stand (`closerAfterWord`), whose new text is
 *   the paragraph break and that word.
 *
 * Returns whether it wrote that; anything else goes on to the rules of ordinary edits.
 */
function hardBreakReturn(plan: Plan, from: number, to: number, typed: string): boolean {
  const { text, markers } = plan;
  if (plan.parsed.ledgerRange !== null && to > plan.parsed.ledgerRange.from) return false;
  if (!/^(?:\r?\n|[ \t>])*$/.test(typed) || (typed.match(/\n/g)?.length ?? 0) < 2) return false;
  const end = lineEnd(text, from);
  const syntax = text.slice(from, end);
  // A backslash that is no escaped one (`\\\\` is a backslash as text, and no hard break).
  const backslash = syntax === '\\' && oddBackslashes(text.slice(lineStart(text, from), from + 1));
  if (!backslash && !(/^ {2,}$/.test(syntax) && text[from - 1] !== ' ')) return false;
  const next = nextLineStart(text, from);
  if (next > text.length) return false;
  const nextEnd = lineEnd(text, next);
  const nextLine = text.slice(next, nextEnd);
  const lead = prefixLength(nextLine);
  if (to < next || to > next + lead) return false;
  if (lead === nextLine.length) return false;
  // In someone's insertion or substitution, the edit is theirs to read: the rules of typing.
  if (plan.containers.some((c) => c.content.from <= from && to <= c.content.to)) return false;
  if (markers.some((m) => m.from < to && m.to > from)) return false;
  const split = markers.find((m) => m.to === from && m.mark?.kind === 'split');
  // Another person's pending hard break has no form: a substitution after their marker, or a join
  // of their break and a split of the author's, reads otherwise in some order of the decisions. It
  // is refused, as any edit of their pending line break is, until it is decided.
  if (split?.mark && split.mark.entry.by !== plan.ctx.author.handle) return false;
  if (split?.mark) {
    // The split's break, as it is now.
    plan.changes.push({ from, to, insert: typed });
    plan.spans.push({ from, to });
    plan.touched.push(split.mark.id);
    return true;
  }
  // The first word of the line after, and what a closer can't stand inside of with it (a whole
  // construct, the run of emphasis it is in), which the closer follows.
  const wordEnd = closerAfterWord(plan, { from, to, insert: typed }, next + lead, nextEnd);
  if (wordEnd === undefined || markers.some((m) => m.from < wordEnd && m.to > from)) return false;
  const old = text.slice(from, wordEnd);
  const id = newMark(plan);
  plan.changes.push(
    { from, to: from, insert: `<!--sub ${id} ${encodePayload(old.replaceAll('\r\n', '\n'))}-->` },
    { from, to, insert: typed },
    { from: wordEnd, to: wordEnd, insert: `<!--/${id}-->` },
  );
  plan.spans.push({ from, to: wordEnd });
  plan.raw.push(id);
  return true;
}

/**
 * Text taken out of the new text of a substitution of the author's own, in one segment with no
 * marker in it, which leaves it new text with its closer behind text: the new text changes in place,
 * as the author's own pending change does (format §3.6), and nothing is widened, for no other
 * change reads it. Where the new text is its old text again, the substitution goes and the old
 * text stays where it is, plain; where the two differ only in a run of blank lines of a quote, which
 * reads as one line, it goes and the new text stays, plain. Returns whether it did that.
 */
function ownSubEdit(plan: Plan, from: number, to: number): boolean {
  const { text, markers } = plan;
  const sub = plan.containers.find(
    (c) =>
      c.own &&
      c.mark.kind === 'sub' &&
      c.mark.segments.length === 1 &&
      c.content.from <= from &&
      to <= c.content.to,
  );
  if (!sub || markers.some((m) => m.from < sub.content.to && m.to > sub.content.from)) {
    return false;
  }
  const now = text.slice(sub.content.from, from) + text.slice(to, sub.content.to);
  const old = sub.mark.segments[0]?.payload ?? sub.mark.payload ?? '';
  const same = now.replaceAll('\r\n', '\n') === old;
  // Or the two read as one another up to a run of blank lines of a quote read as one, as when the
  // old text of a parted quote's substitution left out one blank line of a run (`quoteRunSub`):
  // the substitution goes, and the new text stays, plain, in both views.
  const blankless = (s: string) => s.replace(/\r?\n[ \t>]*(?=\r?\n)/g, '');
  const quietly =
    !same &&
    now.includes('>') &&
    blankless(now.replaceAll('\r\n', '\n')) === blankless(old) &&
    (() => {
      const around = (inner: string) =>
        text.slice(0, sub.open.from) + inner + text.slice(sub.close.to);
      const [a, b] = differingBlocks(around(old), around(now));
      return withoutQuoteRuns(a) === withoutQuoteRuns(b);
    })();
  if (same || quietly) {
    plan.changes.push(
      { from: sub.open.from, to: sub.open.to, insert: '' },
      { from, to, insert: '' },
      { from: sub.close.from, to: sub.close.to, insert: '' },
    );
    if (quietly) plan.plain = true;
  } else if (now.trim() === '' || endsInPrefix(now)) {
    return false;
  } else {
    plan.changes.push({ from, to, insert: '' });
    // New text that now starts with a line break must not become the carrier of the opener.
    if (/^\r?\n/.test(now)) plan.raw.push(sub.mark.id);
  }
  plan.spans.push({ from, to });
  plan.touched.push(sub.mark.id);
  return true;
}

/** Gives every `split` of the changes from `start` on its marker and its entry. */
function materialize(plan: Plan, start: number): void {
  const added = plan.changes.slice(start).toSorted((a, b) => a.from - b.from || a.to - b.to);
  for (const change of added) {
    change.insert = change.insert.replace(/\uE000([\uE100-\uF8FF])/g, (_, length: string) => {
      const id = newMark(plan);
      plan.breaks.set(id, length.charCodeAt(0) - LENGTH);
      return `<!--split ${id}-->`;
    });
  }
}

/** Where text typed in place of `[from, to)` stands on its lines, for its fences. */
function typedAt(plan: Plan, from: number, to: number): TypedAt {
  const { text, markers } = plan;
  const before = visibleBefore(plan, from);
  const end = bodyEnd(plan);
  const lines: string[] = [];
  for (let at = text.indexOf('\n', to) + 1; at > 0 && at < end && lines.length < 100;) {
    const line = visibleText(text, markers, at, lineEnd(text, at)).replace(/\r$/, '');
    lines.push(line);
    if (!/^[ \t>]*$/.test(line)) break;
    at = text.indexOf('\n', at) + 1;
  }
  const following = lines.at(-1);
  const top = lineStart(text, from);
  const above =
    top <= plan.bodyStart
      ? undefined
      : visibleText(text, markers, lineStart(text, top - 1), lineEnd(text, top - 1));
  return {
    ...(CONTAINER_PREFIX.test(before) ? { prefix: before } : {}),
    before,
    ...(above !== undefined ? { above: above.replace(/\r$/, '') } : {}),
    rest: visibleAfter(plan, to),
    blankAfter: lines.length === 0 || /^[ \t>]*$/.test(lines[0] ?? ''),
    ...(following !== undefined && !/^[ \t>]*$/.test(following) ? { following } : {}),
  };
}

/**
 * Changes the break of the author's own split that holds `[from, to)`, when replacing that with
 * `typed` leaves a break that is read as long as what is then written: the white space or the
 * prefix of the next line taken out of it, or replaced by white space, or one of its line breaks
 * taken out, with a line break left. Enter in the middle of a quote or a list item writes the next
 * line's `> ` or bullet in the break, and Backspace right after it takes the `> ` away, or makes
 * the bullet the item's indentation; a space typed on the blank line of a paragraph break is a part
 * of the break too (`typedInBreak`); Backspace after Enter twice takes one of the two line breaks of
 * the blank line. The split stays, with the break so changed, as an insertion of the author's own
 * does when its text changes. Taking out its last line break cancels the split.
 *
 * A split of the author's own right behind the break, as Enter three times leaves it, would stand
 * alone on the line after the line break of a break that took a blank line no more: the break takes
 * the other's in, as far as it reads, and the other's marker goes, or moves behind it with the rest
 * of its break, as `joinSplits` joins them. Returns whether the break was changed.
 */
function editedBreak(plan: Plan, from: number, to: number, typed: string): boolean {
  const { text } = plan;
  if (!/^[ \t]*$/.test(typed)) return false;
  // Not a part of a CRLF.
  if ([from, to].some((at) => text[at - 1] === '\r' && text[at] === '\n')) return false;
  const units = splitUnits(plan);
  const unit = units.find((u) => u.own && u.marker.to <= from && to <= u.end);
  if (!unit) return false;
  const prefix = linePrefixAt(text, unit.marker.to);
  const left = text.slice(unit.marker.to, from) + typed + text.slice(to, unit.end);
  const read = breakLength(prefix, left + text.slice(unit.end, unit.end + 200));
  if (read === 0 || read !== left.length) return blankBreak(plan, unit, from, to, typed, left);
  plan.changes.push({ from, to, insert: typed });
  plan.spans.push({ from, to });
  plan.touched.push(unit.id);
  plan.breaks.set(unit.id, left.length);
  // A split right behind the break that it does not take in stays where it is. Where the break
  // takes no more (it is a blank line still, or a bullet keeps the line after it apart), that is
  // the form Enter makes. Where it is another person's split, or the break is one line break, its
  // marker is alone on the line after that line break, and the last check of the edit refuses it
  // (`checkBreaks`, format §3.4, two breaks side by side).
  const second = units.find((u) => u.own && u.marker.from === unit.end);
  if (!second) return true;
  const joined = left + text.slice(second.marker.to, second.end);
  const reads = breakLength(prefix, joined + text.slice(second.end, second.end + 200));
  if (reads <= left.length) return true;
  plan.changes.push({ from: second.marker.from, to: second.marker.to, insert: '' });
  plan.breaks.set(unit.id, Math.min(reads, joined.length));
  if (reads < joined.length) {
    const at = second.marker.to + reads - left.length;
    plan.changes.push({
      from: at,
      to: at,
      insert: text.slice(second.marker.from, second.marker.to),
    });
    plan.breaks.set(second.id, second.end - at);
    plan.touched.push(second.id);
  }
  return true;
}

/**
 * The break of the author's own split edited into line breaks and white space, or blank lines of
 * the quote its line is in, `left`, which it would not read as written: the editor's Backspace
 * makes the bullet that Enter typed at the end of the last item of a list the item's indentation,
 * and the line it leaves is a blank line (in a quote, one of the quote, at its end), which the
 * break would take together with the line break after it, the one in front of the next block. A
 * blank line at a block boundary changes nothing that is rendered (format §3.4): where Enter would
 * write these line breaks plain in the text without the split (`plainBreakAt`, the split skipped),
 * with a blank line in front of the next block already, a block that keeps apart without one, or
 * the end of the text, the split is cancelled, and the break stays as it now is, plain, as Enter
 * writes it there. Returns whether it did that.
 */
function blankBreak(
  plan: Plan,
  unit: SplitUnit,
  from: number,
  to: number,
  typed: string,
  left: string,
): boolean {
  const [head = '', ...lines] = left.split(/\r?\n/);
  if (!/^[ \t]*$/.test(head) || lines.length === 0) return false;
  if (!lines.every((line) => /^[ \t]*$/.test(line))) {
    // Or blank lines of the quote that the split's line is in, as the bullet of an item in a quote
    // made indentation leaves it, where the quote ends there, or a blank line of it follows, as
    // Enter at the end of a quote writes one.
    const { text } = plan;
    const quote = blockQuoteAt(text, unit.marker.from)?.quote;
    const quoteLine = (line: string) => line.replace(/[ \t]+$/, '') === quote;
    if (quote === undefined || !lines.every(quoteLine)) return false;
    if (!quoteEndsAt(text, unit.end) && !blankQuoteLineAfter(text, unit.end, quote)) return false;
  }
  // Where Enter would write these line breaks plain in the text without the split.
  if (plainBreakAt(plan, unit.marker.from, false, unit, left) !== unit.marker.from) return false;
  plan.changes.push(
    { from: unit.marker.from, to: unit.marker.to, insert: '' },
    { from, to, insert: typed },
  );
  plan.spans.push({ from: unit.marker.from, to: unit.marker.to }, { from, to });
  plan.touched.push(unit.id);
  plan.plain = true;
  return true;
}

/**
 * Whether `[from, to)` takes nothing but text of the break of a split of the author's own: it ends
 * inside the break, past the marker, and starts in the break or in front of the marker with only
 * markers between: Backspace at the start of the line after Enter. An edit after which the break
 * still reads as written was made by `editedBreak` already, so what comes here takes the break's
 * last line break, which cancels the split (format §3.4), and deletes no block: Enter in front of
 * the first word of a list item or a heading leaves the block in front of the split empty (`- `,
 * `## `), and taking out the break must not take that for a block whose text is all deleted.
 */
function inOwnBreak(plan: Plan, from: number, to: number): boolean {
  const { text, markers } = plan;
  return splitUnits(plan).some(
    (unit) =>
      unit.own &&
      unit.marker.to < to &&
      to <= unit.end &&
      (from >= unit.marker.to || visibleText(text, markers, from, unit.marker.to) === ''),
  );
}

/**
 * Whether `[from, to)` deletes nothing but text of insertions of the author's own, and all of it,
 * so that each goes with its markers (`deletionChanges`): it has nothing left in it, or nothing but
 * splits of the author's own, which stay, behind text on the line of its opener. The file is then
 * as it was before the text was typed, which is no block of the original deleted, even when the
 * text was all of a block's: the letter typed after Enter at the end of a list item, in one
 * insertion with the split, leaves the new item as Enter made it; the letter typed on a blank line
 * after a heading, a block of its own, leaves the line breaks as Enter wrote them (format §3.4).
 */
function ownTextOnly(plan: Plan, from: number, to: number): boolean {
  const { text, markers } = plan;
  const pieces = piecesIn(plan, from, to);
  if (pieces.length === 0) return false;
  const containers = new Set<Container>();
  for (const piece of pieces) {
    const container = piece.container;
    if (!container?.own || container.mark.kind !== 'ins') return false;
    containers.add(container);
  }
  const ownSplits = splitUnits(plan).filter((unit) => unit.own);
  for (const { content, open } of containers) {
    // What of its text the deletion leaves.
    const rest: Range[] = [];
    let at = content.from;
    for (const piece of pieces) {
      if (piece.to <= content.from || piece.from >= content.to) continue;
      if (piece.from > at) rest.push({ from: at, to: piece.from });
      at = Math.max(at, piece.to);
    }
    if (at < content.to) rest.push({ from: at, to: content.to });
    const splitsOnly = rest.every((range) =>
      ownSplits.some((unit) => unit.marker.from === range.from && unit.end === range.to),
    );
    if (!splitsOnly) return false;
    // A split that stays must not start the line once the opener in front of it goes.
    const before = visibleText(text, markers, lineStart(text, open.from), open.from);
    if (rest.length > 0 && CONTAINER_PREFIX.test(before)) return false;
  }
  return true;
}

/**
 * Text typed inside the break of a split, past its marker, but for the line after it: in the syntax
 * of a hard break, or on the blank line of a paragraph break (format §3.4). In front of the marker
 * it would stand on the line above, and behind the break on the line below. In the break of a split
 * of the author's own, the break is typed again with the text where it was typed, and the split is
 * cancelled, as if the two had been typed together: one insertion. On the blank line, the text is a
 * line of the split's block, after the prefix that the block's lines have (`> ` in a quote, the
 * indentation of a list item's lines), so that its line breaks read as the split's did. Splits of
 * the author's own right behind the break, which Enter three times leaves, are typed again with it:
 * the line break after the text would stand right in front of theirs. In another person's break,
 * the text is refused until that change is decided: parted by the text, the break would read
 * otherwise once the split is decided.
 *
 * @throws EditError when the split is another person's.
 */
function typedInBreak(
  plan: Plan,
  unit: SplitUnit,
  at: number,
  typed: string,
): { from: number; to: number; typed: string } {
  const { text, parsed } = plan;
  if (!unit.own) {
    const mark = parsed.marks.find((candidate) => candidate.id === unit.id);
    const name = mark ? nameOf(parsed, mark, plan.ctx.author) : 'this line break';
    throw new EditError(
      `Text can't be typed inside ${name} while it is pending. Decide ${name} first.`,
      'no-legal-placement',
    );
  }
  let head = text.slice(unit.marker.to, at);
  let tail = text.slice(at, unit.end);
  // The blank line: from the end of the first line break to the line break that ends it.
  const first = STARTS_WITH_BREAK.exec(text.slice(unit.marker.to, unit.end));
  const start = unit.marker.to + (first?.[0].length ?? 0);
  const newline = text.indexOf('\n', start);
  if (first && at >= start && newline !== -1 && newline < unit.end) {
    const blankEnd = text[newline - 1] === '\r' ? newline - 1 : newline;
    const prefix = continuationPrefix(linePrefixAt(text, unit.marker.from));
    head = text.slice(unit.marker.to, start) + prefix;
    tail = text.slice(blankEnd, unit.end);
  }
  plan.units.push({ ...unit, how: 'cancel' });
  const units = splitUnits(plan);
  let end = unit.end;
  for (
    let next = units.find((u) => u.own && u.marker.from === end);
    next && next.end > end;
    next = units.find((u) => u.own && u.marker.from === end)
  ) {
    plan.units.push({ ...next, how: 'cancel' });
    tail += text.slice(next.marker.to, next.end);
    end = next.end;
  }
  return { from: unit.marker.from, to: end, typed: head + typed + tail };
}

function planEdit(plan: Plan, edit: TextChange): void {
  const { text, markers } = plan;
  if (edit.from < 0 || edit.to < edit.from || edit.to > text.length) {
    throw new RangeError(
      `The edit ${edit.from}-${edit.to} is out of order or outside the text (${text.length} characters)`,
    );
  }
  let typed = inEol(edit.insert, plan.eol);
  if (typed !== '') assertNoMarkup(typed);
  // Front matter takes no change (format §3.8), but line breaks put at the end of its closing line
  // are the body's: the empty paragraph that Enter opens there.
  const afterFront =
    edit.from === plan.frontEnd && edit.to === edit.from && /^(?:\r?\n)+$/.test(typed);
  if (plan.frontEnd >= 0 && edit.from <= plan.frontEnd && !afterFront) {
    throw new EditError(FRONT_MATTER, 'front-matter');
  }
  let from: number;
  let to: number;
  if (edit.from === edit.to) {
    from = to = snapOut(markers, edit.from, false);
  } else {
    from = snapOut(markers, edit.from, true);
    to = snapOut(markers, edit.to, false);
    // Both ends in one marker: no text is touched, and the typed text goes where the range ends.
    if (from >= to) from = to;
    // A range from in front of the opener of another person's block change starts at the block's
    // text, behind the opener, as text typed there does (format §2.6).
    else from = Math.min(pastBlockOpener(plan, from), to);
  }
  // A paragraph break in place of a hard line break (Return next to it) is written whole, before
  // the line break it has in common with the hard break is kept and the rest refused.
  if (from < to && hardBreakReturn(plan, from, to, typed)) return;
  // A backslash that would end your own insertion, typed or left by a deletion, and the text after
  // the one that a backslash ended once it no longer does (format §3.1).
  if (
    ownBringLeft(plan, from, to, typed) ||
    ownBreakAfterBackslash(plan, from, to, typed) ||
    ownBackslashEnd(plan, from, to, typed) ||
    ownBackslashLeft(plan, from, to, typed)
  ) {
    return;
  }
  // The white space that a replacement has in common with the text it replaces, at either end,
  // stays as it is: a line break is not taken away and typed again.
  let keepsBreak = false;
  if (from < to && typed !== '') {
    const old = visibleText(text, markers, from, to);
    const same = (a: string | undefined, b: string | undefined) => a === b && /\s/.test(a ?? '');
    // Not into the middle of a break: it is all kept, or all covered.
    const breaks = breaksOfBody(plan, from, to);
    const inside = (p: number) => breaks.some((b) => b.start < p && p < b.end);
    let head = 0;
    while (head < old.length && head < typed.length && same(old[head], typed[head])) head++;
    // Only a break that is typed again, not any white space.
    if (!old.slice(0, head).includes('\n')) head = 0;
    let start = from;
    for (let i = 0; i < head; i++) start = stepRight(text, markers, start);
    if (inside(start)) {
      start = from;
      head = 0;
    }
    // The end, up to what the start keeps: a break that the start can't keep, as when a blank line
    // is added in front of a quote, the end keeps.
    let tail = 0;
    const limit = Math.min(old.length, typed.length) - head;
    while (tail < limit && same(old.at(-1 - tail), typed.at(-1 - tail))) tail++;
    if (!old.slice(old.length - tail).includes('\n')) tail = 0;
    let end = to;
    for (let i = 0; i < tail; i++) end = stepLeft(text, markers, end);
    if (inside(end)) {
      end = to;
      tail = 0;
    }
    from = start;
    to = end;
    typed = typed.slice(head, typed.length - tail);
    keepsBreak = tail > 0;
  }
  if (from === to && typed === '') return;
  // Past the ledger there is no paragraph: the text goes where it is, without the rules above.
  const past = plan.parsed.ledgerRange !== null && from >= plan.parsed.ledgerRange.to;
  // Text taken out of the new text of a substitution of the author's own changes it in place.
  if (!past && from < to && typed === '' && ownSubEdit(plan, from, to)) return;
  // The quote markers and the white space of a blank line are taken out as Enter put them in, with
  // the white space after them where it ends the text (format §3.4). Where the quote goes on, its
  // markers can't be: a marker can't stand in a prefix, and the quote would be parted in two. Next
  // to another blank line of the quote, the parted quote is a substitution of the break.
  if (!past && from < to && typed === '') {
    const cut = blankLineCut(plan, from, to);
    if (cut === 'refused' && quoteRunSub(plan, from, to)) return;
    if (cut === 'refused') {
      throw new EditError(
        "The quote markers of a blank line can't be taken out as a tracked change where the quote goes on after it: the quote would be parted in two.",
        'no-legal-placement',
      );
    }
    if (cut) {
      plan.changes.push(cut);
      plan.plain = true;
      return;
    }
  }
  // The white space that ends the text is not a part of it: a range that reaches into it stops. In
  // the break of the author's own split, as after Enter at the end of the last item, it is the
  // break's, and the edit of the break is made as it is (`editedBreak`).
  if (!past && from < to) {
    const end = bodyEnd(plan);
    const inBreak = (u: SplitUnit) => u.own && u.marker.to <= from && to <= u.end;
    if (
      from < end &&
      to > end &&
      visibleText(text, markers, end, to).trim() === '' &&
      !splitUnits(plan).some(inBreak)
    ) {
      to = end;
    }
  }
  const first = from;
  const point = from === to;
  // The break of the author's own split gets longer, and stays one split.
  if (!past && point && typed !== '') {
    const longer = longerBreak(plan, from, typed);
    if (longer) {
      plan.changes.push(longer.change);
      plan.touched.push(longer.id);
      plan.breaks.set(longer.id, longer.length);
      return;
    }
    const behind = splitBehind(plan, from, typed);
    if (behind) {
      const start = plan.changes.length;
      plan.changes.push(behind.change);
      plan.spans.push({ from: behind.change.from, to: behind.change.to });
      if (behind.longer) {
        plan.touched.push(behind.longer.id);
        plan.breaks.set(behind.longer.id, behind.longer.length);
      } else materialize(plan, start);
      return;
    }
  }
  // Line breaks and nothing else, at a block boundary, are written as they are (format §3.4).
  if (!past && point && typed !== '') {
    const linePrefix = linePrefixAt(text, from);
    const tokens = tokenize(typed, linePrefix);
    // Only white space, or the quote markers of the line's own quote on a line with nothing else,
    // which goes on from the line above in that quote and is a blank line of it, as the editor's
    // Enter types it at the end of a quote: a bullet or another quote after the break is a block of
    // its own. The line must be a line of a quote as the blocks are read (`blockQuoteAt`), not of
    // an HTML block or code, and the quote must end there, with a line that has nothing on it, or
    // with the text, as Backspace takes the markers out again (`blankLineCut`), or go on with a
    // blank line of the quote, which the new line stands next to, as one with it.
    const [end = '', ...lines] = typed.split(/\r?\n/);
    // White space alone after the last line break, at the end of a line's text, is a blank line
    // too, up to the indentation of that line: the editor's Enter in an item's paragraph indented
    // past the item's text column types the column's spaces, which are no prefix of the line
    // (#204). Never more, and never in front of text, where it could make the text code.
    const breaks =
      (tokens.every((token) => 'brk' in token) || blankLineTyped(plan, from, typed)) &&
      /^[ \t]*$/.test(end);
    // The quote is read only for quote markers typed after a line break.
    const marked = breaks && lines.some((line) => line.includes('>'));
    const quote = marked ? blockQuoteAt(text, from)?.quote : undefined;
    let quoted =
      quote !== undefined &&
      (quoteEndsAt(text, from) ||
        blankQuoteLineAfter(text, from, quote) ||
        // After the closing fence of code, the quote goes on with the text under it, and the blank
        // lines of the break are blank lines of the quote between two of its blocks.
        endsFenceAt(plan, from));
    const plain =
      breaks &&
      lines.every((line) => {
        // A line of white space ends the quote: quote markers after it open a quote of their own.
        if (/^[ \t]*$/.test(line)) quoted = false;
        else if (!quoted || line.trimEnd() !== quote) return false;
        return true;
      });
    // Lines of a quote's markers are no blank lines of a list that the quote is in.
    const quoteLines = lines.length > 0 && lines.every((line) => line.includes('>'));
    const at = plain ? plainBreakAt(plan, from, quoteLines) : undefined;
    if (at !== undefined) {
      plan.changes.push({ from: at, to: at, insert: typed });
      plan.plain = true;
      return;
    }
  }
  // Line breaks taken out of blank lines that stay are taken out as they were put in.
  if (!past && from < to && typed === '') {
    const cut = plainCut(plan, from, to) ?? quoteRunCut(plan, from, to);
    if (cut) {
      plan.changes.push(cut);
      plan.plain = true;
      return;
    }
  }
  // The markup of the line after the break of a split of the author's own, white space in that
  // break, or one of its line breaks, taken out or made white space: the split stays, with the
  // break so changed.
  if (!past && from < to && editedBreak(plan, from, to, typed)) return;
  // A deletion of all the text of blocks deletes the blocks, and leaves the syntax of the ones
  // around them as it is. Any other change that touches a break takes all of it. A deletion of the
  // break of the author's own split cancels the split, and the block in front of it stays, empty as
  // Enter in front of its first word left it. A deletion of all the text of the author's own
  // insertions takes the insertions away, and what was there before they were typed stays.
  const blocks =
    !past &&
    from < to &&
    typed === '' &&
    !inOwnBreak(plan, from, to) &&
    !ownTextOnly(plan, from, to)
      ? (coverBlocks(plan, from, to) ?? firstPrefix(plan, from, to))
      : undefined;
  // The text of a prefix that a change inside it is widened by, in front of what is typed.
  let lead = '';
  if (blocks) ({ from, to } = blocks);
  else if (!past) {
    const covered = coverBreaks(plan, from, to);
    ({ from, to } = covered);
    typed += covered.kept;
    lead = covered.lead;
  }
  const covers = { from, to };
  // Whether the range starts at the text of a line that goes on a paragraph, and no marker may stand
  // there: a refusal of that is told in the words of what to do instead.
  let startsWrapped = false;
  if (from === to && typed === '') return;
  // A range that starts in the prefix of a block keeps the prefix; what is typed in place of it
  // does not write it again.
  const skipped = text.slice(first, from);
  if (from > first && typed.startsWith(skipped)) {
    // Text typed inside the prefix goes after it, and the rest of the prefix after the text.
    typed = typed.slice(skipped.length) + (point ? skipped : '');
  }
  // Text typed at the start of a block's text, in front of the opener of another person's change
  // of the block, goes behind the opener (format §2.6).
  if (!past && from === to && typed !== '' && !STARTS_WITH_BREAK.test(typed)) {
    from = to = pastBlockOpener(plan, from);
  }
  if (!past && !blocks && from < to && typed === '') {
    // All the text of a wrapped line goes with the line break in front of it, where a marker would
    // start the line (#427); a replacement that keeps a break asks for the line to stay.
    const wrapped = keepsBreak ? undefined : wrappedLineStart(text, plan.parsed, markers, from, to);
    if (wrapped !== undefined && !ownTextOnly(plan, from, to)) from = wrapped;
    else {
      startsWrapped = !keepsBreak && atWrappedLine(text, markers, from);
      ({ from, to } = keepsBreak ? keepLine(plan, from, to) : coverLine(plan, from, to));
    }
  }
  // The break of a split stays with its marker (format §3.4).
  if (!past) {
    for (const unit of splitUnits(plan)) {
      if (from === to) {
        // Text typed inside the break, past its marker: at the start of the line after it, in front
        // of that line's prefix, it goes after the prefix, as text typed in the prefix does
        // (`coverBreaks`); in the syntax of a hard break or on a blank line, `typedInBreak` places it.
        if (unit.marker.to < from && from < unit.end) {
          if (from >= lineStart(text, unit.end)) from = to = unit.end;
          else ({ from, to, typed } = typedInBreak(plan, unit, from, typed));
        }
        // Text typed right after the marker, at the end of the line, goes in front of marker and
        // break, which is the same place to the eye.
        if (from !== to) continue;
        if (from === unit.marker.to) from = to = unit.marker.from;
        else if (unit.own && from === unit.end && typed !== '' && !STARTS_WITH_BREAK.test(typed)) {
          // Text typed on the line after the break of a split of the author's own: marker and break
          // are typed again with the text, so that they are part of one insertion with it.
          plan.units.push({ ...unit, how: 'cancel' });
          typed = plan.text.slice(unit.marker.to, unit.end) + typed;
          from = unit.marker.from;
          to = unit.end;
        } else if (from === unit.end && STARTS_WITH_BREAK.test(typed) && !/\d+[.)]/.test(typed)) {
          // Another break right after the break of a split, which it can't make longer (it is a
          // blank line, or a bullet follows): a split of its own, in front of that one. A break
          // that carries a list number stays behind it, where the number was counted for.
          from = to = unit.marker.from;
        }
      } else if (from < unit.end && to > unit.marker.to) {
        // A split that the edit takes the break of already.
        if (plan.units.some((u) => u.marker.from === unit.marker.from && u.how !== undefined)) {
          continue;
        }
        if (unit.own) {
          // A split of the author's own that is deleted is cancelled: marker and break go.
          from = Math.min(from, unit.marker.from);
          to = Math.max(to, unit.end);
          plan.units.push({ ...unit, how: 'cancel' });
        } else if (typed === '' && from >= unit.marker.to && to <= unit.end) {
          // The break of another person's split is deleted, as a deletion of its own after the
          // marker: that is a join.
          from = unit.marker.to;
          to = unit.end;
          plan.units.push({ ...unit, how: 'join' });
        } else {
          throw new EditError(
            "A line break that someone inserted can't be deleted together with other text until that change is decided.",
            'no-legal-placement',
          );
        }
      }
    }
  }
  let typing: Typing = { inner: typed, trail: '' };
  if (!past) {
    const tokens = tokenize(typed, linePrefixAt(text, from), typedAt(plan, from, to));
    // A line break typed right after a backslash is text of the change, with no split: a split
    // would stand right after the backslash, which would escape its marker (format §3.1).
    let plain = false;
    if (tokens.some((token) => 'brk' in token)) {
      let written = visibleBefore(plan, from);
      for (const [i, token] of tokens.entries()) {
        if ('text' in token) written += token.text;
        else {
          if (oddBackslashes(written)) {
            tokens[i] = { text: token.brk };
            plain = true;
          }
          written += token.brk;
        }
      }
    }
    // The line break in front of a prefix is typed again as text, not as a break: it is not new. A
    // split that the range took in is cancelled with its break, and the break is not typed again.
    if (lead !== '' && from === covers.from && to === covers.to) tokens.unshift({ text: lead });
    const settled = settleTrail(plan, { from, to }, tokens);
    ({ from, to } = settled.range);
    typing = { ...typingOf(settled.tokens), ...(plain ? { plain: true } : {}) };
  }
  let placed: Placed;
  try {
    placed = past
      ? { from, to, left: '', right: '' }
      : legalize(plan, { from, to }, typing, blocks?.at);
  } catch (error) {
    if (startsWrapped && error instanceof EditError && error.message === MARKER_STARTS_LINE) {
      throw new EditError(WRAPPED_LINE_START, error.code);
    }
    throw error;
  }
  // The old text ends in a backslash that a marker follows right after it: only a substitution
  // keeps that text in its marker, where deciding the changes in another order would give it back
  // in front of the marker of the new text (format §3.1).
  if (
    !past &&
    placed.from < placed.to &&
    placed.left + typing.inner + placed.right !== '' &&
    text[placed.to - 1] === '\\' &&
    oddBackslashes(
      visibleBefore(plan, placed.from) + visibleText(text, markers, placed.from, placed.to),
    ) &&
    !soleReplace(plan, placed.from, placed.to, {
      ...typing,
      inner: placed.left + typing.inner + placed.right,
    })
  ) {
    throw new EditError(BACKSLASH_OLD, 'no-legal-placement');
  }
  plan.spans.push({ from: placed.from, to: placed.to });
  // Widening can take a split into the range. The break is in the text that is written again.
  if (!past && (placed.from < from || placed.to > to)) {
    for (const unit of splitUnits(plan)) {
      if (!(placed.from < unit.end && placed.to > unit.marker.to)) continue;
      if (plan.units.some((u) => u.marker.from === unit.marker.from && u.how !== undefined))
        continue;
      if (unit.own && placed.from <= unit.marker.from && unit.end <= placed.to) {
        plan.units.push({ ...unit, how: 'cancel' });
      } else {
        throw new EditError(
          "A line break that someone inserted can't be changed together with other text until that change is decided.",
          'no-legal-placement',
        );
      }
    }
  }
  const full: Typing = {
    inner: placed.left + typing.inner + placed.right,
    trail: typing.trail,
  };
  const start = plan.changes.length;
  const createdBefore = plan.created.length;
  if (placed.from === placed.to) {
    const typedAt = typeAt(plan, placed.from, full);
    plan.changes.push({ from: typedAt.at, to: typedAt.at, insert: typedAt.text });
    if (typedAt.later) {
      plan.changes.push({
        from: typedAt.later.at,
        to: typedAt.later.at,
        insert: typedAt.later.text,
      });
    }
  } else replaceRange(plan, placed.from, placed.to, full);
  materialize(plan, start);
  carryFenceOpeners(plan, start, plan.created.slice(createdBefore));
  if (/^\r?\n/.test(full.inner)) plan.raw.push(...plan.created.slice(createdBefore));
  if (past) plan.exempt.push(...plan.created.slice(createdBefore));
}

/**
 * Gives the openers of new marks whose text starts with a fence at the start of a block their own
 * line now (format §3.3), not after the edit as other openers get it: in front of the fence on its
 * line, the opener would keep the fence from being read, and the code block from ending.
 */
function carryFenceOpeners(plan: Plan, start: number, ids: readonly string[]): void {
  const { text, markers } = plan;
  for (const change of plan.changes.slice(start)) {
    for (const id of ids) {
      const opener = new RegExp(`^((?:<!--[^]*?-->)*?)<!--(?:ins|sub) ${id}(?: [^]*?)?-->`).exec(
        change.insert,
      );
      if (!opener) continue;
      const end = opener[0].length;
      if (!/^(?:`{3,}|~{3,})/.test(change.insert.slice(end))) continue;
      if (lineStartKind(text, change.from, markers) !== 'block') continue;
      const prefix = text.slice(lineStart(text, change.from), change.from);
      const form = scaffold(prefix, plan.eol, afterBullet(text, change.from, markers));
      change.insert = change.insert.slice(0, end) + form + change.insert.slice(end);
    }
  }
}

/** Why a tracked change can't go in code, fenced, indented or in a code span, or in an HTML
 * comment (format §2.1). */
const IN_CODE =
  "A tracked change can't go inside code or an HTML comment, where its markers would not be read. Change the whole code span or comment instead.";

/** Why a change on the line of an empty list item is refused when it would make code of it, as
 * Backspace after Enter does when it puts spaces for the bullet in front of the next item's: the
 * code is the change's own, so the words say what to do instead. */
const EMPTY_ITEM_IN_CODE =
  "This would make indented code of the empty list item, where the change's markers would not be read. Undo the line break that made the item instead, or take the item away with Track Changes off.";

/** Why a change under a bullet that a pending line break turned into an underline is refused when
 * it would make code of it: the newest view reads the bullet as the underline of the text above it
 * (an empty item can't interrupt a paragraph), and the lines under it are indented four columns
 * past that text, which is code there (#143). */
const UNDERLINED_BULLET_IN_CODE =
  'The line breaks typed after this bullet make it read as the underline of the text above it, so what is typed under it would be indented code, where its markers would not be read. Reject those line breaks first, or turn Track Changes off.';

/** The line of an empty list item, in a view. */
const EMPTY_ITEM = /^[ \t>]*(?:[-+*]|\d{1,9}[.)])[ \t]*$/;

/** Throws when a marker this call wrote would not be read: it is in code or in an HTML comment.
 * That is the case for a mark it made, and for the marks of other people that it closed and
 * opened again around the new text. */
function checkMarks(plan: Plan, after: string, parsed: Parsed): void {
  // A list number with a marker right behind it and text after it is text to a reader that doesn't
  // know the markers, and a sibling item in the view when it stands at or left of the content of the
  // item above it: the edit wrote one where there was none (a change that took the line break and the
  // number of the next item, #248, walk seed 511). Typed numbers are the person's own.
  const bare = /^([ \t>]*)\d{1,9}[.)]<!--\/[a-z0-9]+--> /gm;
  const wrote = (re: RegExp, text: string) =>
    [...text.matchAll(re)].filter((m) => isSiblingNumber(text, m.index, m[1]?.length ?? 0)).length;
  if (wrote(bare, after) > wrote(bare, plan.text)) {
    throw new EditError(
      'A line break typed here would be read as a different break once the changes are made together. Make the changes one at a time.',
      'no-legal-placement',
    );
  }
  const segments = new Map(parsed.marks.map((mark) => [mark.id, mark.segments.length]));
  const had = new Map(plan.parsed.marks.map((mark) => [mark.id, mark.segments.length]));
  const split = new Map<string, number>();
  for (const id of plan.split) split.set(id, (split.get(id) ?? 0) + 1);
  const unread =
    plan.created.some((id) => !segments.has(id)) ||
    [...split].some(([id, times]) => (segments.get(id) ?? 0) < (had.get(id) ?? 0) + times);
  if (unread) throw new EditError(IN_CODE, 'inside-code');
  // A line break that starts the text of a mark is text. An opener that stands alone on its line
  // after the prefix of a block, such as the line of an empty item, has the line break after it for
  // its carrier, which no view shows and no decision keeps.
  for (const id of plan.raw) {
    if (parsed.marks.find((mark) => mark.id === id)?.segments.some((s) => s.carrier)) {
      throw new EditError(
        'A line break typed here would be read as a different break once the changes are made together. Make the changes one at a time.',
        'no-legal-placement',
      );
    }
  }
  // Each break is read as long as it was written. It is not when the line it follows has another
  // prefix in the new text than in the old, because another change was made on the way.
  const limit = parsed.ledgerRange?.from;
  for (const mark of parsed.marks) {
    const length = plan.breaks.get(mark.id);
    const open = mark.segments[0]?.open;
    if (length === undefined || !open) continue;
    if (breakEnd(after, open.to, limit) - open.to !== length) {
      throw new EditError(
        'A line break typed here would be read as a different break once the changes are made together. Make the changes one at a time.',
        'no-legal-placement',
      );
    }
  }
}

/**
 * Throws when the edit leaves a split whose break could read otherwise once the changes next to it
 * are decided, where the file had no such break of that split (format §3.4): two line breaks side
 * by side, read differently in different decision orders.
 */
function checkBreaks(plan: Plan, after: string, parsed: Parsed): void {
  const depends = breakComesToDepend(plan.text, plan.parsed, after, parsed, plan.markers);
  if (!depends) return;
  const words = pairWords(parsed, depends, plan.ctx.author, plan.ledger, plan.created);
  throw new EditError(
    `This edit would leave ${words.pair}, and deciding one would change the other. Decide ${words.first} first.`,
    'no-legal-placement',
  );
}

/** The message of a change that came out different from the edit. */
export const SELF_CHECK =
  'This change could not be written as tracked changes without altering other text. Make smaller changes.';

/**
 * Looks at what the changes make of the file, as a last check: the newest text is the edits made
 * to the newest text, up to white space that Markdown ignores, and the original text is as it was.
 * A change that comes out different would damage the document without a word, so it is refused.
 * Edits past the ledger are looked at too: there, as in the body, a deleted CR alone would come
 * back as an LF that joins a CR in front of it into one CRLF (format §2.5).
 */
function selfCheck(
  plan: Plan,
  edits: readonly TextChange[],
  changes: readonly TextChange[],
  views: Views,
): void {
  const { text } = plan;
  const view = views.newest(text);
  const edited = edits
    .map((edit) => ({
      from: view.map.fromSource(edit.from),
      to: view.map.fromSource(edit.to),
      insert: inEol(edit.insert, plan.eol),
    }))
    .sort((a, b) => a.from - b.from || a.to - b.to);
  const intended = applyChanges(view.text, edited);
  const after = applyChanges(text, changes);
  // A change that touches a break takes all of it with the prefix of the next block, or the break
  // of a block that is deleted whole: only the letters, and their order, are compared. Where no
  // edit takes a line break away, so are the places of the line breaks among them, however many
  // there are: text that lands on another line than the one it was typed on reads otherwise, with
  // the same letters (#111).
  const lines = edited.every((edit) => !/[\r\n]/.test(view.text.slice(edit.from, edit.to)));
  const letters = (s: string) =>
    s
      .replace(/\r\n?/g, '\n')
      .replace(lines ? /[^\p{L}\n]+/gu : /[^\p{L}]+/gu, '')
      .replace(/\n+/g, '\n')
      .replace(/^\n|\n$/g, '');
  // The original text of a deletion has the line breaks of its payload, which are LF.
  const lf = (s: string) => s.replaceAll('\r\n', '\n').replace(/\n+$/, '');
  // Line breaks that were written plain are in the original text as well, as blank lines, and so
  // are the blank lines of a quote that end it, or that another blank line of the quote follows,
  // which are looked for only where the original texts differ otherwise, and only in the blocks
  // where they differ.
  const blank = (s: string) => s.replace(/\s*\n\s*/g, '\n').trim();
  const was = lf(views.original(text).text);
  const is = lf(views.original(after).text);
  // Blank lines of a quote right under a fence line: between a block of code and the block under
  // it, which no reader sees.
  const underFence = (s: string) =>
    s.replace(/^([ \t>]*(?:`{3,}|~{3,})[ \t]*\n)(?:[ \t]*>[ \t>]*\n)+/gm, '$1');
  const quiet = (s: string) => blank(underFence(withoutQuoteEnds(withoutQuoteRuns(s))));
  const quietly = () => {
    const [a, b] = differingBlocks(is, was);
    return quiet(a) === quiet(b);
  };
  const kept = plan.plain ? blank(is) === blank(was) || quietly() : is === was;
  if (letters(views.newest(after).text) !== letters(intended) || !kept) {
    throw new EditError(SELF_CHECK, 'no-legal-placement');
  }
}

/**
 * The lines of `a` and of `b` where the two differ, with the lines around them out to a line with
 * nothing on it, or to the edge of the text: what the readings of a quote's blank lines look at
 * (`blockQuoteAt`, `withoutQuoteEnds`, `withoutQuoteRuns`), which read the same in the lines that
 * are left out.
 */
function differingBlocks(a: string, b: string): [string, string] {
  const x = a.split('\n');
  const y = b.split('\n');
  let head = 0;
  while (head < x.length && head < y.length && x[head] === y[head]) head++;
  let tail = 0;
  while (
    tail < x.length - head &&
    tail < y.length - head &&
    x[x.length - 1 - tail] === y[y.length - 1 - tail]
  ) {
    tail++;
  }
  const blank = (line: string | undefined) => /^[ \t]*\r?$/.test(line ?? '');
  while (head > 0 && !blank(x[head - 1])) head--;
  while (tail > 0 && !blank(x[x.length - tail])) tail--;
  return [x.slice(head, x.length - tail).join('\n'), y.slice(head, y.length - tail).join('\n')];
}

/** Whether the line of `view` that `position` (of the source) is on is an empty list item. */
function onEmptyItem(view: DocView, position: number): boolean {
  const at = view.map.fromSource(position);
  return EMPTY_ITEM.test(view.text.slice(lineStart(view.text, at), lineEnd(view.text, at)));
}

/**
 * Whether the line of `view` that `position` (of the source) is on comes under a bullet that a
 * split's marker stands on and that the view reads as the underline of the text above it: with, in
 * between, the lines of its break, blank or indented four columns, which are code there (#143).
 */
function underUnderliningBullet(text: string, view: DocView, position: number): boolean {
  const shown = view.text;
  const row = (start: number) => shown.slice(start, lineEnd(shown, start));
  const above = (start: number) => (start === 0 ? -1 : lineStart(shown, start - 1));
  const bare = (line: string) => /^[ \t>]*-[ \t]*$/.test(line);
  /** Whether a line is blank, or indented four columns past its quote markers. */
  const apart = (line: string) =>
    /^[ \t>]*$/.test(line) || /^(?:[ \t]{0,3}>[ \t]?)*(?: {4}|\t)/.test(line);
  let bullet = above(lineStart(shown, view.map.fromSource(position)));
  while (bullet >= 0 && !bare(row(bullet)) && apart(row(bullet))) bullet = above(bullet);
  if (bullet < 0 || !bare(row(bullet))) return false;
  const over = above(bullet);
  if (over < 0 || !underliningBullet(row(over), row(bullet))) return false;
  // The line of the file that the bullet is from holds the marker of the split.
  const source = view.map.toSource(bullet, 1);
  return text.slice(lineStart(text, source), lineEnd(text, source)).includes('<!--split ');
}

/** The words for a change whose markers would stand in indented code (format §2.1). */
function inCodeWords(text: string, edits: readonly TextChange[], views: Views): string {
  const view = views.newest(text);
  if (edits.some((edit) => onEmptyItem(view, edit.from))) return EMPTY_ITEM_IN_CODE;
  // Typed text with a line of four columns in it is code of its own, whatever stands above it.
  const plain = edits.filter((edit) => !/(?:^|\n)(?: {4}|\t)/.test(edit.insert));
  if (plain.some((edit) => underUnderliningBullet(text, view, edit.from))) {
    return UNDERLINED_BULLET_IN_CODE;
  }
  return IN_CODE;
}

/** What `trackedEdits` gives: the changes of the file, and which marks they made or changed. */
export interface TrackedEdits {
  changes: TextChange[];
  /** The marks that are new. */
  markIds: string[];
  /** Marks of the author that grew or changed in place: an insertion that was typed in, a
   * deletion that took more text. */
  extendedIds: string[];
}

/** What a line of a view starts with before its text: quote markers, a bullet or a number with a
 * box, a heading's `#`s, indentation. */
export const LINE_PREFIX =
  /^(?:[ \t]*(?:>[ \t]?|[-*+][ \t]+(?:\[[ xX]\][ \t]+)?|\d{1,9}[.)][ \t]+(?:\[[ xX]\][ \t]+)?|#{1,6}[ \t]+))*[ \t]*/;

/** Text that starts a block of its own at the start of a line's text: a heading, a quote, a list
 * item, a fence, a table row or a thematic break. */
const STARTS_BLOCK =
  /^ {0,3}(?:#{1,6}(?:[ \t]|$)|>|[-*+](?:[ \t]|$)|\d{1,9}[.)](?:[ \t]|$)|```|~~~|\||(?:\*[ \t]*){3,}$|(?:-[ \t]*){3,}$|(?:_[ \t]*){3,}$)/;

/**
 * Throws when an edit inside another person's pending change of a block's type, quote or indent
 * would change what rejecting that change reads as the block's lines: a deletion of the whole text
 * of a line of a block of more than one line, a change of a line's prefix (a heading's `#`s, a
 * bullet, a box, `>`), or a line whose text, as the edit leaves it, starts what it didn't before:
 * a block of its own (`# `, `> `, `- `, `1. `, a fence, `|`), or white space that makes it code
 * once the change is rejected (four columns), or that moves the content of an item, and the
 * blocks under it out of the item, where the text follows a bullet in one reading of the change
 * and not as far in the other. The text of a line is judged as the edit leaves it, whatever was
 * typed, so that two edits can't come to what one may not. Typing words is fine, and so is
 * retyping the whole text of a block of one line.
 */
function checkBlockEdits(
  parsed: Parsed,
  edits: readonly TextChange[],
  author: Person,
  views: Views,
): void {
  const blocks = othersBlockChanges(parsed, author);
  if (blocks.length === 0) return;
  const view = views.newest(parsed.text);
  const { text } = view;
  for (const edit of edits) {
    for (const block of blocks) {
      const segment = block.segments.find(
        (s) => s.close && s.open.from <= edit.from && edit.to <= s.close.to,
      );
      if (!segment?.close) continue;
      const from = view.map.fromSource(edit.from);
      const to = view.map.fromSource(edit.to);
      const top = view.map.fromSource(segment.open.to);
      const bottom = view.map.fromSource(segment.close.from);
      // Where each line of the block starts, where its prefix ends (with the one space after its
      // last marker), where its text starts and where it ends.
      const lines: { start: number; lead: number; text: number; end: number }[] = [];
      for (let at = text.lastIndexOf('\n', top - 1) + 1; at <= bottom;) {
        const end = text.indexOf('\n', at) === -1 ? text.length : text.indexOf('\n', at);
        const prefix = LINE_PREFIX.exec(text.slice(at, end))?.[0] ?? '';
        const bare = prefix.replace(/[ \t]+$/, '');
        lines.push({
          start: at,
          lead: at + (bare === '' ? 0 : Math.min(prefix.length, bare.length + 1)),
          text: at + prefix.length,
          end: Math.min(end, bottom),
        });
        at = end + 1;
      }
      const wholeLine =
        lines.length > 1 &&
        from < to &&
        lines.some((line) => line.text < line.end && from <= line.text && line.end <= to);
      const prefix = from < to && lines.some((line) => from < line.lead && line.start < to);
      const line = lines.find((candidate) => candidate.lead <= from && from <= candidate.end);
      if (
        wholeLine ||
        prefix ||
        (line && startsOtherwise(text, line, from, to, edit.insert, block, segment))
      ) {
        throw decideFirst(parsed, block);
      }
    }
  }
}

/** How many columns of white space a text starts with: a tab goes to the next stop of four. */
function leadingColumns(text: string): number {
  let column = 0;
  for (const char of /^[ \t]*/.exec(text)?.[0] ?? '')
    column = char === '\t' ? column + 4 - (column % 4) : column + 1;
  return column;
}

/**
 * Whether the edit `[from, to)` → `insert` leaves the text of `line` (from the end of its prefix,
 * in the newest view `text`) starting otherwise, under another person's block change: with block
 * syntax, or with white space that makes it code, or that moves an item's content (see
 * `checkBlockEdits`).
 */
function startsOtherwise(
  text: string,
  line: { start: number; lead: number; end: number },
  from: number,
  to: number,
  insert: string,
  block: MarkRange,
  segment: Segment,
): boolean {
  const old = text.slice(line.lead, lineEnd(text, line.lead));
  const now =
    `${text.slice(line.lead, from)}${insert}${text.slice(to, lineEnd(text, to))}`.split('\n')[0] ??
    '';
  if (STARTS_BLOCK.test(now) && !STARTS_BLOCK.test(old)) return true;
  const columns = leadingColumns(now);
  if (columns <= leadingColumns(old)) return false;
  if (columns >= 4) return true;
  // Right after a bullet in one reading and not in the other (a box is text, a paragraph or a
  // heading has none, a number is wider): only an indent change keeps the same marker in both.
  const payload = segment.payload ?? block.payload ?? '';
  const was = /(?:^| )was=([a-z0-9]+)/.exec(payload)?.[1];
  if (was === 'indent') return false;
  const bullet =
    was === 'ul' ||
    was === 'ol' ||
    /(?:[-*+]|\d{1,9}[.)])[ \t]+$/.test(text.slice(line.start, line.lead));
  return bullet && blockUnder(text, line.start);
}

/**
 * Whether a block is under the item whose first line starts at `start` of `text`: a nested list,
 * a quote, a fence or a heading on an indented line, or an indented line after a blank line, as a
 * second paragraph. Lines of the item's paragraph, indented or lazy, are none.
 */
function blockUnder(text: string, start: number): boolean {
  let blank = false;
  for (let at = nextLineStart(text, start); at < text.length; at = nextLineStart(text, at)) {
    const line = text.slice(at, lineEnd(text, at));
    if (/^[ \t]*\r?$/.test(line)) {
      blank = true;
      continue;
    }
    if (leadingColumns(line) === 0) {
      if (blank || STARTS_BLOCK.test(line)) return false;
      continue;
    }
    if (blank || STARTS_BLOCK.test(line.trimStart())) return true;
  }
  return false;
}

/**
 * Throws when the edit put a line break, or the prefix that starts a line, into a pending change in
 * or at the edges of another person's pending change of a block's type, from the end of the block
 * before it to the start of the block after it (`blockEdges`): rejecting that change takes the
 * block's syntax from its lines, and what the block is and where it ends would depend on the other
 * change, as a new line after a heading is a paragraph of its own and after a list item more of the
 * item. For a numbered item that doesn't start at 1, also a break in the lines right above it,
 * where it doesn't go on with a numbered list in one of the views (`continuesList`). The ranges
 * are taken before the edit as well as after it, as the edit can move what touches the block. Also
 * when the edit put text in front of the change's opener on its line, or changed the container's
 * syntax there: rejecting the change needs its opener where a mark that starts the block stands,
 * after that syntax. Typing within a line of the block is fine.
 */
function checkBlockChanges(
  before: Parsed,
  after: string,
  read: Parsed,
  author: Person,
  views: Views,
  /** The edit's changes of the body, in offsets of the text before. */
  changes: readonly TextChange[],
): void {
  const blocks = othersBlockChanges(read, author);
  if (blocks.length === 0) return;
  const old = new Map(before.marks.map((mark) => [mark.id, mark]));
  for (const block of blocks) {
    const was = old.get(block.id);
    if (!was) continue;
    // Text left in front of the opener, or the container's syntax there taken away or changed (a
    // number for another number is the same syntax).
    const lost = opensBlock(before.text, was) && !opensBlock(after, block);
    if (lost || containerOf(before.text, was) !== containerOf(after, block)) {
      throw decideFirst(read, block);
    }
  }
  // A line break that a view reads in its text, or a line's prefix alone as its old text. A line
  // break that only carries a marker is in no view.
  const newestAfter = views.newest(after);
  let newestBeforeView: DocView | undefined;
  const breaksOf = (text: string, mark: MarkRange, view: DocView) => [
    ...viewBreaks(text, mark, view),
    ...mark.segments
      .filter((segment) => /^[ \t]*>[ \t>]*$/.test(segment.payload ?? ''))
      .map((segment) => segment.open.from),
  ];
  // The block of each block change with its edges, after the edit and, once asked for, before it.
  // For a numbered item that doesn't start at 1, now or once the change is rejected, also where the
  // lines right above it start that touch it (`touchingAbove`), as a break there can end the list
  // that it goes on with, and the start of its line, to read that by.
  type Edges = Range & { above: number; top: number; delimiter: string | undefined };
  // Where none of the edit's changes stands in the lines above a block, or at the line break in
  // front of it, those lines read the same before the edit and after it, and their breaks count
  // the same: they aren't read. A change in the block or below it leaves them as they are; one
  // above them stands apart where a blank line that no pending change wrote comes between
  // (`blankBetween`).
  // So it is where the edit only types or takes out words after the start of a line's text: no
  // line break, and every line it changes is the same kind of line after it (`lineKind`).
  const words = () => {
    const lines = new Map<number, TextChange[]>();
    for (const change of changes) {
      if (
        change.insert.includes('\n') ||
        before.text.slice(change.from, change.to).includes('\n')
      ) {
        return false;
      }
      const start = lineStart(before.text, change.from);
      lines.set(start, [...(lines.get(start) ?? []), change]);
    }
    for (const [start, edits] of lines) {
      const was = before.text.slice(start, lineEnd(before.text, start));
      let now = was;
      for (const edit of edits.toSorted((a, b) => b.from - a.from)) {
        now = now.slice(0, edit.from - start) + edit.insert + now.slice(edit.to - start);
      }
      if (lineKind(withoutMarkers(was)) !== lineKind(withoutMarkers(now))) return false;
    }
    return true;
  };
  let typing: boolean | undefined;
  const quiet = new Map<string, boolean>();
  const apart = (was: MarkRange | undefined) => {
    if (!was) return false;
    if ((typing ??= changes.length > 0 && words())) return true;
    let value = quiet.get(was.id);
    if (value === undefined) {
      const first = was.segments[0];
      const top = first ? lineStart(before.text, first.open.from) : 0;
      value =
        changes.length > 0 &&
        changes.every(
          (change) =>
            change.from > top ||
            (change.to < top && blankBetween(before.text, before, change.to, top)),
        );
      quiet.set(was.id, value);
    }
    return value;
  };
  const edges = (text: string, parsed: Parsed, block: MarkRange): Edges => {
    const first = block.segments[0];
    const last = block.segments.at(-1);
    if (!first || !last) return { from: 0, to: -1, above: 0, top: 0, delimiter: undefined };
    const top = lineStart(text, first.open.from);
    const range = blockEdges(text, top, (last.close ?? last.open).to);
    const was = /(?:^| )was=(?:ol|task)=([^ ]*)/.exec(first.payload ?? block.payload ?? '')?.[1];
    const delimiter =
      numberedFromTwo(text.slice(top, first.open.from)) ??
      (was === undefined ? undefined : numberedFromTwo(was.replaceAll('\\x20', ' ')));
    const above =
      delimiter && !apart(old.get(block.id))
        ? Math.min(range.from, linesAboveStart(text, parsed, top))
        : range.from;
    return { ...range, above, top, delimiter };
  };
  const reachBefore = new Map<string, Edges>();
  const edgesBefore = (block: MarkRange) => {
    let range = reachBefore.get(block.id);
    if (!range) {
      range = edges(before.text, before, block);
      reachBefore.set(block.id, range);
    }
    return range;
  };
  // Where the edit changed the body: what it has in common before and after, at either end. The
  // range of a block before the edit counts too, as the text after it has it: a line break that
  // the edit put in the lines that touched the block can part them from it. Worked out once a
  // change holds a break that can be in such a range.
  let changed: { head: number; endBefore: number; endAfter: number; shift: number } | undefined;
  const changedStretch = () => {
    if (changed) return changed;
    const bodyBefore = before.text.slice(0, before.ledgerRange?.from ?? before.text.length);
    const bodyAfter = after.slice(0, read.ledgerRange?.from ?? after.length);
    const most = Math.min(bodyBefore.length, bodyAfter.length);
    let head = 0;
    while (head < most && bodyBefore.charCodeAt(head) === bodyAfter.charCodeAt(head)) head++;
    let tail = 0;
    while (
      tail < most - head &&
      bodyBefore.charCodeAt(bodyBefore.length - 1 - tail) ===
        bodyAfter.charCodeAt(bodyAfter.length - 1 - tail)
    ) {
      tail++;
    }
    changed = {
      head,
      endBefore: bodyBefore.length - tail,
      endAfter: bodyAfter.length - tail,
      shift: bodyAfter.length - bodyBefore.length,
    };
    return changed;
  };
  // A range's start or end in the stretch the edit changed, or at its edge, keeps to the side of it
  // away from what was typed there: text typed at the end of the block before, or at the start of
  // the block after, is not between them.
  const carried = (position: number, end: boolean) => {
    const stretch = changedStretch();
    if (position < stretch.head) return position;
    if (position > stretch.endBefore) return position + stretch.shift;
    return end ? stretch.head : stretch.endAfter;
  };
  // The body grew or shrank by this much: a range of the text before carries over to somewhere in
  // that range moved by up to it, which rules out most breaks without working out the stretch.
  const shift =
    (read.ledgerRange?.from ?? after.length) - (before.ledgerRange?.from ?? before.text.length);
  const spans = blocks.map((block) => {
    const now = edges(after, read, block);
    const was = old.get(block.id);
    const range = was ? edgesBefore(was) : undefined;
    return {
      block,
      was,
      now,
      range,
      from: range ? Math.min(now.above, range.above + Math.min(0, shift)) : now.above,
      to: range ? Math.max(now.to, range.to + Math.max(0, shift)) : now.to,
      reach: undefined as Edges | undefined,
      counts: undefined as { after: () => boolean; before: () => boolean } | undefined,
    };
  });
  const reachOf = (span: (typeof spans)[number]) => {
    if (span.reach) return span.reach;
    const { now, range } = span;
    span.reach = range
      ? {
          ...now,
          from: Math.min(now.from, carried(range.from, false)),
          to: Math.max(now.to, carried(range.to, true)),
          above: Math.min(now.above, carried(range.above, false)),
        }
      : now;
    return span.reach;
  };
  // The breaks of a change that count against a block change: those in its range, and those in
  // the lines right above a numbered item from 2 when, in some decision of the changes there, it
  // does not go on with a numbered list (`listGoesOnEveryWay`), so that a break there decides
  // whether it is an item or text. The decisions take in the newest view and the original view,
  // and others that the two don't read: a split above that one change ends the list with, and a
  // line typed under it that starts it again. Whether those lines count is worked out once for
  // each block and each side of the edit, and only once a break stands in them.
  const everyWay = (
    text: string,
    parsed: Parsed,
    newest: () => DocView,
    original: () => DocView,
    range: Edges,
    mark: MarkRange,
  ) => {
    let value: boolean | undefined;
    return () =>
      (value ??= listGoesOnEveryWay(
        text,
        parsed,
        newest(),
        original,
        range.top,
        range.delimiter ?? '.',
        mark.segments[0]?.payload ?? mark.payload ?? '',
      ));
  };
  const aboveCounts = (span: (typeof spans)[number]) => {
    if (span.counts) return span.counts;
    const { block, was, now, range } = span;
    const newestBefore = () => (newestBeforeView ??= views.newest(before.text));
    const every = everyWay(
      after,
      read,
      () => newestAfter,
      () => views.original(after),
      now,
      block,
    );
    const everyBefore =
      range && was
        ? everyWay(before.text, before, newestBefore, () => views.original(before.text), range, was)
        : undefined;
    span.counts = { after: () => !every(), before: () => !everyBefore?.() };
    return span.counts;
  };
  // A change counts by its line breaks, and in the lines above a numbered item from 2 also where
  // it stands at the start of a line (`lineStartsTouched`): it can make the line an item, or not.
  interface Stands {
    breaks: number[];
    starts: number[];
  }
  const counted = (text: string, at: Stands, range: Edges, above: () => boolean) =>
    at.breaks.filter((position) => {
      if (range.from <= position && position <= range.to) {
        // Not the break of a deletion of a whole block in front of this one (`onlyMarkers`).
        return position >= range.top || !onlyMarkers(text, position);
      }
      return range.above <= position && position < range.from && above();
    }).length +
    at.starts.filter(
      (position) =>
        range.above <= position &&
        position < range.from &&
        !at.breaks.includes(position) &&
        above(),
    ).length;
  // Where the lines above a numbered item from 2 are read, after the edit and before it.
  const aboveSpans = spans.filter(
    (span) => span.now.above < span.now.from || (span.range && span.range.above < span.range.from),
  );
  const standsAt = (text: string, parsed: Parsed, mark: MarkRange, view: () => DocView) => {
    const breaks = breaksOf(text, mark, view());
    const near = mark.segments.some((segment) =>
      aboveSpans.some((span) => span.from <= segment.open.from && segment.open.from <= span.to),
    );
    const starts = near ? lineStartsTouched(text, parsed, mark, view()) : [];
    return { breaks, starts };
  };
  for (const mark of read.marks) {
    if (
      mark.kind !== 'ins' &&
      mark.kind !== 'del' &&
      mark.kind !== 'sub' &&
      mark.kind !== 'split'
    ) {
      continue;
    }
    const now = standsAt(after, read, mark, () => newestAfter);
    if (now.breaks.length === 0 && now.starts.length === 0) continue;
    const positions = [...now.breaks, ...now.starts];
    let had: Stands | undefined;
    for (const [i, block] of blocks.entries()) {
      const span = spans[i];
      if (!span || !positions.some((position) => span.from <= position && position <= span.to)) {
        continue;
      }
      const count = counted(after, now, reachOf(span), aboveCounts(span).after);
      if (count === 0) continue;
      const prior = old.get(mark.id);
      had ??= prior
        ? standsAt(
            before.text,
            before,
            prior,
            () => (newestBeforeView ??= views.newest(before.text)),
          )
        : { breaks: [], starts: [] };
      const was = old.get(block.id);
      const counts =
        was && prior ? counted(before.text, had, edgesBefore(was), aboveCounts(span).before) : 0;
      if (count > counts) {
        // On the block's own lines, or only in the lines next to it.
        const first = block.segments[0];
        const last = block.segments.at(-1);
        const from = first ? lineStart(after, first.open.from) : 0;
        const to = last ? lineEnd(after, (last.close ?? last.open).to) : after.length;
        throw decideFirst(
          read,
          block,
          !positions.some((position) => from <= position && position <= to),
        );
      }
    }
  }
}

/** The pending changes of a block's type, quote or indent that are not `author`'s. */
function othersBlockChanges(parsed: Parsed, author: Person): MarkRange[] {
  return parsed.marks.filter(
    (mark) =>
      mark.kind === 'fmt' &&
      mark.entry.by !== author.handle &&
      mark.segments.some((segment) => /(?:^| )was=/.test(segment.payload ?? mark.payload ?? '')),
  );
}

/** Whether each opener of a block change stands where a mark that starts the block does, after
 * the container's syntax and other markers only, as rejecting it needs (format §2.6). */
function opensBlock(text: string, mark: MarkRange): boolean {
  return mark.segments.every((segment) =>
    CONTAINER_PREFIX.test(
      text.slice(lineStart(text, segment.open.from), segment.open.from).replace(/<!--.*?-->/g, ''),
    ),
  );
}

/** The container's syntax in front of each opener of a block change, without markers, and with its
 * numbers as `#`. */
function containerOf(text: string, mark: MarkRange): string {
  return mark.segments
    .map((segment) =>
      shape(withoutMarkers(text.slice(lineStart(text, segment.open.from), segment.open.from))),
    )
    .join('|');
}

/** The refusal of an edit under another person's block change, or `next` to it: they decide it
 * first. */
function decideFirst(parsed: Parsed, block: MarkRange, next = false): EditError {
  const name = parsed.ledger.people.find((person) => person.handle === block.entry.by)?.name;
  return new EditError(
    next
      ? `Decide ${name ?? block.entry.by}'s change to the block next to this one first.`
      : `Decide ${name ?? block.entry.by}'s change to this block first.`,
    'no-legal-placement',
  );
}

/**
 * Several edits to one file, each in offsets of `text` and none touching another, as tracked
 * changes by `ctx.author`: one list of changes for the text and the ledger, the ids of the marks
 * that are new, and those of the author's marks that changed.
 *
 * @throws EditError as `trackedEdit` does.
 */
export function trackedEdits(
  text: string,
  edits: readonly TextChange[],
  ctx: EditContext,
): TrackedEdits {
  for (const edit of edits) assertWholeCharacters(text, edit);
  const random = ctx.random;
  // The next try draws the ids that the first one did.
  const drawn: Uint8Array[] = [];
  const first: EditContext = random
    ? {
        ...ctx,
        random: (n) => {
          const bytes = random(n);
          drawn.push(Uint8Array.from(bytes));
          return bytes;
        },
      }
    : ctx;
  const again = (): EditContext => {
    let next = 0;
    return random
      ? {
          ...ctx,
          random: (n) => {
            const bytes = drawn[next++];
            return bytes?.length === n ? bytes : random(n);
          },
        }
      : ctx;
  };
  // As typed first; where that reads otherwise next to another mark, each way of writing the change
  // again by a character, until one reads alike in every order of decisions, or none does.
  for (let mode = 0; ; mode++) {
    // Each way of writing the change is tried once; a change that reads otherwise in all of them is
    // refused, never tried again.
    if (mode > MOST_MODES) {
      throw new EditError(
        'This change could not be written so that every order of decisions reads alike. Make smaller changes.',
        'no-legal-placement',
      );
    }
    try {
      return editsOnce(text, edits, mode === 0 ? first : again(), mode);
    } catch (error) {
      if (!(error instanceof ReadsOtherwise)) throw error;
    }
  }
}

/**
 * Edits inside one block of code, display math or raw text (format §3.5, rule 9): a substitution of
 * the whole block, with the old block as its payload and the newest code in the file. Edits in a
 * block that the author's own pending insertion or substitution holds edit the code and make no
 * mark; in one that another person's holds they are refused. Undefined when the edits are not in
 * the code of one block.
 */
function codeEdits(
  plan: Plan,
  edits: readonly TextChange[],
  views: Views,
): TrackedEdits | undefined {
  const { text, ctx } = plan;
  plan.verbatim ??= scan(text).verbatim;
  const found = codeBlockOf(
    text,
    plan.verbatim,
    edits.map((edit) => ({ ...edit, insert: inEol(edit.insert, plan.eol) })),
    plan.frontEnd,
    plan.markers,
  );
  if (!found) {
    // Text that follows a pending deletion of a break, indented as code is: code in the original
    // text, text of the block before it in the newest. No key goes there until it is decided.
    const first = edits[0];
    if (first && edits.length === 1) {
      const start = lineStart(text, first.from);
      const marker = plan.markers.find(
        (m) =>
          m.role === 'open' &&
          m.mark !== undefined &&
          m.from >= start &&
          m.to <= first.from &&
          lineEnd(text, m.to) >= first.from &&
          // Another person's deletion of a blank line: the text after it is code in the original.
          m.mark.entry.by !== ctx.author.handle &&
          /\n[ \t]*\r?\n[ \t]*$/.test(m.segment?.payload ?? '') &&
          /^(?: {4}|\t)/.test(text.slice(m.to, m.to + 4)),
      );
      if (marker?.mark) throw markInCode(plan.parsed, marker.mark, ctx.author);
    }
    return undefined;
  }
  const { block, edits: typed } = found;
  const holders = holdersOf(block, plan.containers);
  // A marker in the block's range, its fence or tag lines included, is a change in the code: the
  // block would go whole into the payload with it. Only the substitution that holds the block is
  // the author's own to edit through.
  for (const mark of plan.parsed.marks) {
    if (holders.some((holder) => holder.mark === mark)) continue;
    const inside = mark.segments.some(
      ({ open, close }) =>
        (open.from < block.to && open.to > block.from) ||
        (close !== undefined && close.from < block.to && close.to > block.from),
    );
    if (inside) throw markInCode(plan.parsed, mark, ctx.author);
  }
  // Another person's pending change that the block or the blank line that opens it holds or touches.
  // Your own marks never refuse a key here.
  for (const mark of block.near ?? []) {
    if (mark.entry.by !== ctx.author.handle && !holders.some((holder) => holder.mark === mark)) {
      throw markInCode(plan.parsed, mark, ctx.author);
    }
  }
  const theirs = holders.find((holder) => !holder.own);
  if (theirs) throw theirChange(plan.parsed, theirs.mark, ctx.author);
  if (!found.inCode) throw new EditError(NOT_CODE, 'no-legal-placement');
  const raw = text.slice(block.from, block.to);
  if (plan.eol === '\r\n' ? /(?<!\r)\n/.test(raw) : /\r\n/.test(raw)) {
    throw new EditError(MIXED_BREAKS, 'no-legal-placement');
  }
  for (const edit of typed) if (edit.insert !== '') assertNoMarkup(edit.insert);
  assertStillBlock(block, edited(text, block, typed));
  const now = edited(text, block, typed);
  if (holders.length > 0) {
    // The pending change already holds the block: the edits are the only change to the file.
    const intended = applyChanges(text, typed);
    const changes = commitEdit(text, typed, plan.ledger, {
      parsed: plan.parsed,
      keepLedger: true,
      views,
      verify: (after) => {
        if (after !== intended) throw new EditError(SELF_CHECK, 'no-legal-placement');
      },
    });
    const own = [...new Set(holders.map((holder) => holder.mark.id))];
    return { changes, markIds: [], extendedIds: own };
  }
  const id = newMark(plan);
  // The first line's prefix stays in front of the opener's line and carries on in its carrier.
  const old = text.slice(block.from + block.prefix.length, block.oldTo ?? block.to);
  // Where a blank line follows the block, the closer takes its place, so that the line break after
  // the closing fence is the block's, and the file keeps as many blank lines as it had: the payload
  // ends with that line break, and the closer stands at the start of the blank line. Otherwise the
  // closer goes on a line of its own, and accepting leaves one blank line more (format §3.3).
  const body = plan.parsed.ledgerRange?.from ?? text.length;
  const roomy =
    block.prefix === '' &&
    text.startsWith(plan.eol + plan.eol, block.to) &&
    block.to + 2 * plan.eol.length <= body;
  const closer = `<!--/${id}-->`;
  const payload = (roomy ? old + plan.eol : old).replace(/\r\n?/g, '\n');
  const tail = roomy ? block.to + plan.eol.length : block.to;
  const content = now.slice(block.prefix.length) + (roomy ? plan.eol : plan.eol + block.prefix);
  const changes = commitEdit(
    text,
    [
      {
        from: block.from,
        to: block.from,
        insert: `${block.prefix}<!--sub ${id} ${encodePayload(payload)}-->${plan.eol}${block.prefix.trimEnd()}${plan.eol}`,
      },
      ...typed,
      roomy
        ? { from: tail, to: tail, insert: closer }
        : { from: block.to, to: block.to, insert: `${plan.eol}${block.prefix}${closer}` },
    ],
    plan.ledger,
    {
      parsed: plan.parsed,
      created: [id],
      views,
      // The substitution holds the old block as its payload and the newest code as its text, and
      // the file is as it was around them: both views read as they did, but for the edits.
      verify: (after, parsed) => {
        const mark = parsed.marks.find((candidate) => candidate.id === id);
        const segment = mark?.segments[0];
        if (
          mark?.kind !== 'sub' ||
          mark.segments.length !== 1 ||
          !segment?.close ||
          !segment.carrier ||
          mark.payload !== payload ||
          after.slice(segment.carrier.to, segment.content.to) !== content ||
          !after.startsWith(text.slice(0, block.from)) ||
          !after.endsWith(text.slice(tail))
        ) {
          throw new EditError(SELF_CHECK, 'no-legal-placement');
        }
      },
    },
  );
  return { changes, markIds: [id], extendedIds: [] };
}

/** How many ways of writing a change next to a mark are tried (as typed, then by a character). */
const MOST_MODES = 8;

/** A change next to another mark, written as typed, reads otherwise in some order of decisions. */
class ReadsOtherwise extends Error {}

function editsOnce(
  text: string,
  edits: readonly TextChange[],
  ctx: EditContext,
  mode: number,
): TrackedEdits {
  const plan = createPlan(text, ctx, mode);
  const views = viewsOnce();
  // A caret between the CR and the LF of a line break is after the line break: text typed there
  // would leave a CR of its own, which Markdown reads as a line break.
  edits = edits.map((edit) =>
    edit.from === edit.to && text[edit.from - 1] === '\r' && text[edit.from] === '\n'
      ? { ...edit, from: edit.from + 1, to: edit.from + 1 }
      : edit,
  );
  // Code, display math and raw text take no markers: a change inside one replaces the block whole
  // (format §3.5).
  const code = codeEdits(plan, edits, views);
  if (code) return code;
  checkTableEdits(text, edits, plan.parsed);
  checkAlignGap(text, edits, plan.parsed);
  // A marker at the start of a row without a leading pipe needs one (format §3.7, rule 7): write a
  // plain one first, and make the edit after it.
  const pipes: PipeWrite[] = edits.flatMap((edit) => {
    const at = leadingPipeAt(text, edit, plan.parsed);
    return [
      ...(at === null ? [] : [{ at, insert: '| ', leading: true }]),
      ...outerPipeWrites(text, edit, plan.parsed),
    ];
  });
  const unique = pipes.filter(
    (write, i) => pipes.findIndex((o) => o.at === write.at && o.leading === write.leading) === i,
  );
  if (unique.length > 0) return withPipes(text, edits, ctx, unique);
  checkBlockEdits(plan.parsed, edits, ctx.author, views);
  for (const edit of edits) {
    // Text typed in a row or column the author inserted is part of its insertion (format §3.7).
    if (
      inOwnInsertedRow(text, edit, plan.parsed, ctx.author.handle) ||
      inOwnInsertedCol(text, edit, plan.parsed, ctx.author.handle)
    ) {
      const typed = inEol(edit.insert, plan.eol);
      if (typed !== '') assertNoMarkup(typed);
      plan.changes.push({ from: edit.from, to: edit.to, insert: typed });
    } else planEdit(plan, edit);
  }
  if (plan.changes.length === 0) return { changes: [], markIds: [], extendedIds: [] };
  // Widening an edit over a link or a break can make it reach into the next one. The changes of
  // one edit stand around the markers in its range, and another edit can fall between them: the
  // text that the widened edit writes again would then stand on the wrong side of it.
  const sorted = plan.changes.toSorted((a, b) => a.from - b.from || a.to - b.to);
  const meets = (a: Range, b: Range) =>
    b.from === b.to ? a.from < b.from && b.from < a.to : a.from < b.to && b.from < a.to;
  if (
    sorted.some((change, i) => i > 0 && change.from < (sorted[i - 1]?.to ?? 0)) ||
    plan.spans.some((a, i) => plan.spans.some((b, j) => i !== j && meets(a, b)))
  ) {
    throw new EditError(
      'Two of these changes would land in the same place. Make them one change, or one at a time.',
      'no-legal-placement',
    );
  }
  // An edit that changes the author's own mark in place gives it the new note, which replaces the
  // old one (format §5.4); with no note, the old one stays.
  if (ctx.note !== undefined) {
    for (const id of new Set(plan.touched)) {
      const entry = plan.ledger.marks[id];
      if (entry !== undefined && !plan.created.includes(id)) entry.note = ctx.note;
    }
  }
  const changes = commitEdit(text, plan.changes, plan.ledger, {
    parsed: plan.parsed,
    created: [...new Set([...plan.created, ...plan.split])].filter(
      (id) => !plan.exempt.includes(id),
    ),
    exempt: plan.exempt,
    verify: (after, parsed, changes) => {
      checkMarks(plan, after, parsed);
      checkBlockChanges(plan.parsed, after, parsed, ctx.author, views, changes);
      checkBreaks(plan, after, parsed);
      // A change that stands against another mark reads as typed in every order of decisions, or
      // is written again by a character, or is refused (format §3.1, rule 5).
      if (plan.emphasis.touched) {
        const ids = new Set(plan.emphasis.near);
        if (!emphasisReadsAlike(after, ids)) {
          if (mode === 0 || mode < plan.emphasis.options) throw new ReadsOtherwise();
          const next = neighbours(after, ids);
          const other =
            next.find(
              (mark) => mark.entry.by !== ctx.author.handle && mark.entry.by !== 'unknown',
            ) ?? next[0];
          throw new EditError(
            other
              ? changesHow(parsed, other, ctx.author)
              : 'A marker here would change how the text next to it is emphasized.',
            'no-legal-placement',
          );
        }
      }
      // Whatever the path: no marker this edit brings right after an unescaped backslash.
      if (escapedMarkers(after, parsed) > escapedMarkers(text, plan.parsed)) {
        const at = escapedMarkerAt(after, parsed) ?? -1;
        throw new EditError(backslashBeforeAt(parsed, at, ctx.author), 'no-legal-placement');
      }
      if (bringsBroken(after, parsed) > bringsBroken(text, plan.parsed)) {
        throw new EditError(AFTER_BRING, 'no-legal-placement');
      }
      // Nor in any other order of decisions: the old text of a change, given back, ends in one.
      const now = restoredEscapes(after, parsed, new Set([...plan.created, ...plan.split]));
      if (now.length > 0 && now.length > restoredEscapes(text, plan.parsed, new Set()).length) {
        throw new EditError(
          backslashBeforeAt(parsed, now.at(-1) ?? -1, ctx.author),
          'no-legal-placement',
        );
      }
    },
    inCode: inCodeWords(text, edits, views),
    views,
  });
  selfCheck(plan, edits, changes, views);
  const markIds = [...new Set(plan.created)];
  const extendedIds = [...new Set(plan.touched)].filter((id) => !markIds.includes(id));
  return { changes, markIds, extendedIds };
}

/** The edits of `text` made as they are after the plain pipes `writes` (a leading `| ` before a marker
 * or in front of a first cell that the edit empties, a trailing ` |` after a last one) are written, in
 * order, and the changes mapped back, with the pipes written before them (format §3.7, rule 7). */
function withPipes(
  text: string,
  edits: readonly TextChange[],
  ctx: EditContext,
  writes: readonly PipeWrite[],
): TrackedEdits {
  const sorted = writes.toSorted((a, b) => a.at - b.at || Number(b.leading) - Number(a.leading));
  const written = sorted.map(({ at, insert }) => ({ from: at, to: at, insert }));
  // Text at the place of a leading pipe moves after it; text at a trailing one stays before it.
  const shifted = (at: number) =>
    at +
    sorted
      .filter((write) => (write.leading ? write.at <= at : write.at < at))
      .reduce((sum, write) => sum + write.insert.length, 0);
  const moved = edits.map((edit) => ({
    ...edit,
    from: shifted(edit.from),
    to: shifted(edit.to),
  }));
  const done = trackedEdits(applyChanges(text, written), moved, ctx);
  // A position of the text with the pipes in it, back in the text without them: those just after a
  // pipe are where the pipe is written.
  const back = (at: number) => {
    let offset = 0;
    let passed = 0;
    for (const write of sorted) {
      const place = write.at + offset;
      if (place + write.insert.length <= at) passed += write.insert.length;
      offset += write.insert.length;
    }
    return at - passed;
  };
  const changes: TextChange[] = [];
  const used = new Set<PipeWrite>();
  for (const change of done.changes) {
    const from = back(change.from);
    for (const write of sorted) {
      if (write.at <= from && !used.has(write)) {
        used.add(write);
        changes.push({ from: write.at, to: write.at, insert: write.insert });
      }
    }
    changes.push({ ...change, from, to: back(change.to) });
  }
  for (const write of sorted) {
    if (!used.has(write)) changes.push({ from: write.at, to: write.at, insert: write.insert });
  }
  return { ...done, changes: changes.toSorted((a, b) => a.from - b.from || a.to - b.to) };
}

/**
 * The tracked change that an edit becomes, in offsets of `text`: the changes of the body and of the
 * ledger, where new marks get their entries `{ by, at }` with `note` and `group` when `ctx` has
 * them, and the author is added to the people. `edit` covers visible text; its offsets are UTF-16
 * code units, as in CodeMirror. Inserted text gets the file's line breaks.
 *
 * Which side of the hidden markers at a position the text lands on is the caller's choice, as is
 * the rule that typing at the end of a comment's range extends it and at its start does not
 * (format §4): `rangeEdge` gives the place that rule asks for. A file with a ledger ends with the
 * line break after the ledger, which the newest view shows as text; deleting the final line break
 * of the body leaves that one.
 *
 * @throws RangeError when the edit lies outside the text.
 * @throws EditError when the inserted text holds Redlines markup, when the change would be inside
 *   code or an HTML comment, or when the ledger can't be read.
 */
export function trackedEdit(text: string, edit: TextChange, ctx: EditContext): TextChange[] {
  return trackedEdits(text, [edit], ctx).changes;
}
