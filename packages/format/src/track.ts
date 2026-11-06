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
  breakEnd,
  breakLength,
  breakStart,
  breaksBetween,
  continuationPrefix,
  frontMatterEnd,
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
  viewBreaks,
  withoutMarkers,
} from './blocks.ts';
import { breakComesToDepend, pairWords } from './break-reach.ts';
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
import { inspectPlace, stepLeft, stepRight } from './inline.ts';
import { applyChanges } from './changes.ts';
import { parse } from './parse.ts';
import { encodePayload } from './payload.ts';
import { scan } from './scan.ts';
import { newestView, originalView } from './views.ts';
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
  verbatim?: readonly Range[];
  /** The marks this call made or changed. */
  readonly touched: string[];
  /** The range each edit replaces once it is widened, a point for typing. */
  readonly spans: Range[];
}

/** A deletion of a table row or column (format §3.7), which text is not merged into. */
const TABLE_DELETION = /^(?:row|col)=/;

function createPlan(text: string, ctx: EditContext): Plan {
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
    eol: eolOf(text),
    frontEnd: frontMatterEnd(text),
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

function replaceRange(plan: Plan, from: number, to: number, typing: Typing): void {
  const pieces = piecesIn(plan, from, to);
  const [only] = pieces;
  if (
    typing.inner !== '' &&
    pieces.length === 1 &&
    only &&
    !only.how &&
    only.from === from &&
    only.to === to
  ) {
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
  return tokens;
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
      from =
        from > found.start && (from > prefix || (insidePrefix && to > found.end))
          ? found.end
          : Math.min(from, found.start);
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
  // The first line of the file has no break in front of it.
  if (lineStart(text, position) === 0) {
    const end = breakLength('', `\n${text.slice(0, 4096)}`) - 1;
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

/** The breaks between lines of the body, near `from` to `to`: not the one in front of the ledger. */
function breaksOfBody(plan: Plan, from: number, to: number) {
  const end = bodyEnd(plan);
  return breaksBetween(plan.text, from, to, plan.markers).filter((found) => found.start < end);
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
 */
function coverBlocks(plan: Plan, from: number, to: number): Cover | undefined {
  const { text, markers } = plan;
  const breaks = breaksOfBody(plan, 0, text.length);
  const blocks = breaks.filter((found) => found.block);
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
  const gap = visibleText(text, markers, before?.end ?? 0, line);
  const starts = gap.trim() === '' && BLOCK_LEAD.test(lead);
  const ends = firstAfter
    ? visibleText(text, markers, to, Math.max(to, firstAfter.start)) === ''
    : visibleText(text, markers, to, bodyEnd(plan)).trim() === '';
  if (!starts || !ends) return undefined;
  const first = lead === '' ? start : line;
  const newlines = (a: number, b: number) => text.slice(a, b).split('\n').length - 1;
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
    // front of them goes: the last item of a list and a paragraph after it.
    const keepsAfter =
      before &&
      newlines(before.start, lineStart(text, before.end)) < newlines(firstAfter.start, next);
    if (keepsAfter) return { from: before.start, to: Math.max(firstAfter.start, start) };
    if (sibling) return { from: start, to: after.end };
    return lead === '' ? { from: first, to: next } : { from: first, to: next, at: start };
  }
  if (before) return { from: before.start, to };
  return lead === '' ? { from: first, to } : { from: first, to, at: start };
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
      return { range: at, tokens: [...trailing, ...tokens.slice(0, lastText + 1)] };
    }
  }
  throw new EditError(
    'A line break at the end of this text would take the start of the block that follows it.',
    'no-legal-placement',
  );
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
  if (plan.containers.some((c) => c.own && c.content.from <= from && to <= c.content.to)) {
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
  for (let attempt = 0; attempt < 24; attempt++) {
    const state = `${from} ${to} ${left} ${right}`;
    const content = left + typing.inner + right;
    const first = firstChar(content);
    // A prefix that the change takes away is no place for the marker, but what it leaves is.
    const where = from === start && at !== undefined ? at : from;
    const open = inspectPlace(text, markers, where, { after: content + visibleAfter(plan, to) });
    if (open.kind === 'refuse') refuse(open.reason);
    else if (open.kind === 'construct') grow(open.from, open.to);
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
      if (close.kind === 'refuse') refuse(close.reason);
      else if (close.kind === 'construct') grow(close.from, close.to);
      else if (close.kind === 'flank') {
        const p = stepRight(text, markers, to);
        if (p === to || /[\r\n]/.test(text.slice(to, p))) {
          refuse('A marker here would change how the text next to it is emphasized.');
        }
        grow(from, p);
      }
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
      (/\n[ \t>]*$/.test(full) || visibleAfter(plan, to).trim() !== '')
    ) {
      let p = to;
      while (text[p] === ' ' || text[p] === '\t') p = stepRight(text, markers, p);
      if (p >= text.length || text[p] === '\r' || text[p] === '\n') {
        refuse('A marker here would start a line.');
      }
      while (p < text.length && !/\s/.test(text[p] ?? ' ')) p = stepRight(text, markers, p);
      grow(from, p);
    }
    if (state === `${from} ${to} ${left} ${right}`) {
      if (right !== '' && typing.trail !== '') refuse('A marker here would start a line.');
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
  return (
    verbatim.some((range) => range.from < to && from < range.to) ||
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
 * for a position in the middle of a block, where a line break is a split.
 */
function plainBreakAt(plan: Plan, position: number): number | undefined {
  const { text, markers } = plan;
  // Next to a break that someone inserted, the original text goes on: a split, and not a boundary.
  const units = splitUnits(plan);
  if (units.some((u) => u.marker.from <= position && position <= u.end)) return undefined;
  const blocks = breaksOfBody(plan, 0, text.length).filter((found) => found.block);
  const end = bodyEnd(plan);
  let at: number | undefined;
  const inside = blocks.find(
    (found) => found.start <= position && position <= lineStart(text, found.end),
  );
  const original = (from: number, to: number) => originalBetween(plan, from, to);
  if (inside) at = position;
  else {
    // At the end of the last line of a block, with only markers after it on that line, and no
    // text of the original in them: the block would go on in the original text.
    const before = blocks.find(
      (found) =>
        found.start > position &&
        !text.slice(position, found.start).includes('\n') &&
        visibleText(text, markers, position, found.start) === '' &&
        original(position, found.start).trim() === '',
    );
    if (before) at = before.start;
    // In front of the first block, or in the white space before it.
    else if (
      visibleText(text, markers, 0, position).trim() === '' &&
      original(0, position).trim() === ''
    ) {
      at = position;
    }
    // After the last block: at the end of its last line, or in the white space after it.
    else if (
      visibleText(text, markers, position, end).trim() === '' &&
      original(position, end).trim() === ''
    ) {
      at = position < end ? pastMarkers(plan, position) : position;
    }
  }
  if (at === undefined || units.some((u) => u.marker.from <= at && at <= u.end)) return undefined;
  // A blank line is content in code and raw text, and between the items of a tight list it makes the
  // list loose: there Enter is a split, or is refused, and never plain.
  if (blankLinesMatter(plan, position, position) || blankLinesMatter(plan, at, at))
    return undefined;
  if (loosensList(text, at, markers)) return undefined;
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
  // joined, in the newest text or in the original.
  const end = bodyEnd(plan);
  const alone = (text0: string, original: string) => text0.trim() === '' && original.trim() === '';
  const edge =
    alone(visibleText(text, markers, 0, a), originalBetween(plan, 0, a)) ||
    alone(visibleText(text, markers, b, end), originalBetween(plan, b, end));
  if (left < 2 && !edge) return undefined;
  if (splitUnits(plan).some((u) => u.marker.from <= b && a <= u.end)) return undefined;
  if (blankLinesMatter(plan, a, b)) return undefined;
  return { from, to, insert: '' };
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
 * Whether `line`, a line of quote markers and white space, goes on from the line `above` in its
 * quote: the quote of `above` is as deep, or deeper. Such a line is a blank line of that quote. One
 * that does not, with a line of no quote above it or a shallower one, opens a quote of its own, a
 * block that a renderer shows even with nothing in it.
 */
function continuesQuote(above: string, line: string): boolean {
  const quote = continuationPrefix(above.slice(0, prefixLength(above))).trimEnd();
  return quote.startsWith(line.trimEnd());
}

/**
 * The text without the blank lines that end a quote and go on from the line above in it
 * (`continuesQuote`): a renderer reads them as nothing more (format §3.4).
 */
function withoutQuoteEnds(text: string): string {
  const lines = text.split('\n');
  const gone = lines.map(() => false);
  for (let i = lines.length - 1; i > 0; i--) {
    const line = lines[i] ?? '';
    if (!/^[ \t>]*>[ \t>]*$/.test(line)) continue;
    const next = lines[i + 1];
    const ends = next === undefined || /^[ \t]*$/.test(next) || gone[i + 1] === true;
    gone[i] = ends && continuesQuote(lines[i - 1] ?? '', line);
  }
  return lines.filter((_, i) => !gone[i]).join('\n');
}

/**
 * The deletion of the quote markers or the white space of a blank line, and nothing else, which
 * leaves it a blank line: the Backspace over the `> ` that Enter at the end of a quote wrote, and
 * over the indentation of a list item's lines that is left of it (format §3.4). A renderer reads
 * the line as it did, or the quote as ending a line earlier where the line goes on from the line
 * above in its quote (`continuesQuote`) and the quote ends with it (`quoteEndsAt`): it writes no
 * mark, as Enter did. Undefined for any other deletion: of quote markers that open a quote of their
 * own, which a renderer shows, or of the indentation in front of them, which takes the line out of
 * its list item; or for a line with a marker on it, or in the break of a split. `refused` when the
 * quote goes on after the line, which taking its markers out would part.
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
  // White space after the first quote marker leaves the line where it is.
  if (!cut.includes('>')) return from > start + first ? { from, to, insert: '' } : undefined;
  if (start === 0 || !continuesQuote(text.slice(lineStart(text, start - 1), start - 1), line)) {
    return undefined;
  }
  return quoteEndsAt(text, end) ? { from, to, insert: '' } : 'refused';
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
    top === 0
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
  if (read === 0 || read !== left.length) return false;
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
  if (plan.frontEnd >= 0 && edit.from <= plan.frontEnd) {
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
  // The quote markers and the white space of a blank line are taken out as Enter put them in, with
  // the white space after them where it ends the text (format §3.4). Where the quote goes on, its
  // markers can't be: a marker can't stand in a prefix, and the quote would be parted in two.
  if (!past && from < to && typed === '') {
    const cut = blankLineCut(plan, from, to);
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
  // The white space that ends the text is not a part of it: a range that reaches into it stops.
  if (!past && from < to) {
    const end = bodyEnd(plan);
    if (from < end && to > end && visibleText(text, markers, end, to).trim() === '') to = end;
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
    // its own. The quote must end there, with a line that has nothing on it, or with the text, as
    // Backspace takes the markers out again (`blankLineCut`).
    const quote = continuationPrefix(linePrefix).trimEnd();
    let quoted = quote.includes('>') && quoteEndsAt(text, from);
    const [end = '', ...lines] = typed.split(/\r?\n/);
    const plain =
      tokens.every((token) => 'brk' in token) &&
      /^[ \t]*$/.test(end) &&
      lines.every((line) => {
        // A line of white space ends the quote: quote markers after it open a quote of their own.
        if (/^[ \t]*$/.test(line)) quoted = false;
        else if (!quoted || line.trimEnd() !== quote) return false;
        return true;
      });
    const at = plain ? plainBreakAt(plan, from) : undefined;
    if (at !== undefined) {
      plan.changes.push({ from: at, to: at, insert: typed });
      plan.plain = true;
      return;
    }
  }
  // Line breaks taken out of blank lines that stay are taken out as they were put in.
  if (!past && from < to && typed === '') {
    const cut = plainCut(plan, from, to);
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
  // around them as it is. Any other change that touches a break takes all of it.
  const blocks = !past && from < to && typed === '' ? coverBlocks(plan, from, to) : undefined;
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
    ({ from, to } = keepsBreak ? keepLine(plan, from, to) : coverLine(plan, from, to));
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
    // The line break in front of a prefix is typed again as text, not as a break: it is not new. A
    // split that the range took in is cancelled with its break, and the break is not typed again.
    if (lead !== '' && from === covers.from && to === covers.to) tokens.unshift({ text: lead });
    const settled = settleTrail(plan, { from, to }, tokens);
    ({ from, to } = settled.range);
    typing = typingOf(settled.tokens);
  }
  const placed = past
    ? { from, to, left: '', right: '' }
    : legalize(plan, { from, to }, typing, blocks?.at);
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

/** Throws when a marker this call wrote would not be read: it is in code or in an HTML comment.
 * That is the case for a mark it made, and for the marks of other people that it closed and
 * opened again around the new text. */
function checkMarks(plan: Plan, after: string, parsed: Parsed): void {
  const segments = new Map(parsed.marks.map((mark) => [mark.id, mark.segments.length]));
  const had = new Map(plan.parsed.marks.map((mark) => [mark.id, mark.segments.length]));
  const split = new Map<string, number>();
  for (const id of plan.split) split.set(id, (split.get(id) ?? 0) + 1);
  const unread =
    plan.created.some((id) => !segments.has(id)) ||
    [...split].some(([id, times]) => (segments.get(id) ?? 0) < (had.get(id) ?? 0) + times);
  if (unread) {
    throw new EditError(
      "A tracked change can't go inside code or an HTML comment, where its markers would not be read. Change the whole code span or comment instead.",
      'inside-code',
    );
  }
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

/** The newest and the original view of a text, each worked out once for an edit: the checks of
 * one edit read the same views of the text before it and after it. */
interface Views {
  newest(text: string): DocView;
  original(text: string): DocView;
}

function viewsOnce(): Views {
  const once = (make: (text: string) => DocView) => {
    const made = new Map<string, DocView>();
    return (text: string) => {
      let view = made.get(text);
      if (!view) {
        view = make(text);
        made.set(text, view);
      }
      return view;
    };
  };
  return { newest: once(newestView), original: once(originalView) };
}

/**
 * Looks at what the changes make of the file, as a last check: the newest text is the edits made
 * to the newest text, up to white space that Markdown ignores, and the original text is as it was.
 * A change that comes out different would damage the document without a word, so it is refused.
 * Edits past the ledger are left out.
 */
function selfCheck(
  plan: Plan,
  edits: readonly TextChange[],
  changes: readonly TextChange[],
  views: Views,
): void {
  const { text } = plan;
  if (plan.exempt.length > 0) return;
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
  // are the blank lines that end a quote and go on from the line above in it.
  const original = (s: string) =>
    plan.plain
      ? withoutQuoteEnds(lf(s))
          .replace(/\s*\n\s*/g, '\n')
          .trim()
      : lf(s);
  if (
    letters(views.newest(after).text) !== letters(intended) ||
    original(views.original(after).text) !== original(views.original(text).text)
  ) {
    throw new EditError(SELF_CHECK, 'no-legal-placement');
  }
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
const LINE_PREFIX =
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
  const plan = createPlan(text, ctx);
  const views = viewsOnce();
  // A caret between the CR and the LF of a line break is after the line break: text typed there
  // would leave a CR of its own, which Markdown reads as a line break.
  edits = edits.map((edit) =>
    edit.from === edit.to && text[edit.from - 1] === '\r' && text[edit.from] === '\n'
      ? { ...edit, from: edit.from + 1, to: edit.from + 1 }
      : edit,
  );
  checkBlockEdits(plan.parsed, edits, ctx.author, views);
  for (const edit of edits) planEdit(plan, edit);
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
    },
  });
  selfCheck(plan, edits, changes, views);
  const markIds = [...new Set(plan.created)];
  const extendedIds = [...new Set(plan.touched)].filter((id) => !markIds.includes(id));
  return { changes, markIds, extendedIds };
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
