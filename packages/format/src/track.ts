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
  HARD_BREAK,
  breakEnd,
  breakLength,
  breakStart,
  breaksBetween,
  frontMatterEnd,
  linePrefixAt,
  lineStartKind,
  lineStart,
} from './blocks.ts';
import { EditError } from './errors.ts';
import {
  addPerson,
  assertNoMarkup,
  commitEdit,
  eolOf,
  inEol,
  markerRanges,
  snapOut,
  visibleText,
  workingLedger,
} from './edit-support.ts';
import type { Eol, MarkerRange } from './edit-support.ts';
import { idsIn, newId } from './ids.ts';
import { inspectPlace, stepLeft, stepRight } from './inline.ts';
import { applyChanges } from './changes.ts';
import { parse } from './parse.ts';
import { encodePayload } from './payload.ts';
import { newestView, originalView } from './views.ts';
import type {
  EditContext,
  Ledger,
  MarkEntry,
  MarkRange,
  Parsed,
  Range,
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
  /** The marks this call made or changed. */
  readonly touched: string[];
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
    for (const { open, content, close } of mark.segments) {
      if (close) containers.push({ mark, open, content, close, own: mark.entry.by === me });
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
    touched: [],
  };
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
 * last text, which go behind the insertion, so that its closer does not start a line. */
interface Typing {
  inner: string;
  trail: string;
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
 * breaks of `trail` between the two. */
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
  return closers + middle + trail + openers;
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

/** The place for breaks that are typed with no text: outside the insertions and substitutions that
 * end or start there, so that no closer or opener starts a line. */
function breakPosition(plan: Plan, position: number): number {
  let at = position;
  for (let step = 0; step < steps(plan); step++) {
    const next = leaveEdge(plan, at, undefined, true);
    if (next === at) break;
    at = next;
  }
  return at;
}

/** What typing `typing` at `position` writes: part of the author's own insertion, or a new
 * insertion, which splits the insertions and substitutions of other people around it. Breaks
 * with no text are splits alone. */
function typeAt(plan: Plan, position: number, typing: Typing): Typed {
  if (typing.inner === '') return { at: breakPosition(plan, position), text: typing.trail };
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

/** A stretch of visible text between markers, and the insertion or substitution it is in. */
interface Piece {
  from: number;
  to: number;
  text: string;
  container: Container | undefined;
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
  return pieces;
}

/** What a stretch of the range becomes. */
type Item =
  | { from: number; to: number; kind: 'remove' | 'shell' }
  | { from: number; to: number; kind: 'delete'; text: string }
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
      const touches = items.some((i) => isDeleted(i) && (i.to === old.from || i.from === old.to));
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
  const items: Item[] = pieces.map((piece) =>
    piece.container?.own
      ? { from: piece.from, to: piece.to, kind: 'remove' }
      : { from: piece.from, to: piece.to, kind: 'delete', text: piece.text },
  );
  for (const c of plan.containers) {
    if (!c.own || c.mark.kind !== 'ins' || c === options.extended) continue;
    const empty = pieces.some(
      (p) => p.container === c && p.from === c.content.from && p.to === c.content.to,
    );
    if (empty) {
      items.push(
        { from: c.open.from, to: c.open.to, kind: 'shell' },
        { from: c.close.from, to: c.close.to, kind: 'shell' },
      );
    }
  }
  if (options.merge) absorbDeletions(plan, items);

  const runs: Item[][] = [];
  for (const item of items.toSorted((a, b) => a.from - b.from)) {
    const run = runs.at(-1);
    if (run && run.at(-1)?.to === item.from) run.push(item);
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
  return changes;
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
  if (typing.inner !== '' && pieces.length === 1 && only && only.from === from && only.to === to) {
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
 * `prefix` is the container prefix of the line the break ends. */
type Token = { text: string } | { brk: string; prefix: string };

/** The typed text as text and breaks. `linePrefix` is the container prefix of the line it goes in. */
function tokenize(typed: string, linePrefix: string): Token[] {
  const tokens: Token[] = [];
  let prefix = linePrefix;
  let at = 0;
  for (;;) {
    const newline = typed.indexOf('\n', at);
    if (newline === -1) break;
    const end = newline > at && typed[newline - 1] === '\r' ? newline - 1 : newline;
    const syntax = HARD_BREAK.exec(typed.slice(at, end))?.[0] ?? '';
    const start = end - syntax.length;
    const length = breakLength(prefix, typed.slice(start));
    if (start > at) tokens.push({ text: typed.slice(at, start) });
    const brk = typed.slice(start, start + length);
    tokens.push({ brk, prefix });
    prefix = linePrefixAt(brk, brk.length);
    at = start + length;
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
  return {
    inner: tokens
      .slice(0, lastText + 1)
      .map(part)
      .join(''),
    trail: tokens
      .slice(lastText + 1)
      .map(part)
      .join(''),
  };
}

/**
 * A change that touches a break takes all of it, with the prefix of the next block: a deletion
 * never leaves a bullet or a `#` behind a marker, and a join takes the break and the prefix of the
 * second block (format §3.4). A point inside a break moves to its start. A change that starts in
 * the prefix of a block changes the text after it, and the prefix stays.
 */
function coverBreaks(plan: Plan, from: number, to: number): Range & { kept: string } {
  let kept = '';
  for (const found of breaksOfBody(plan, from, to)) {
    const prefix = lineStart(plan.text, found.end);
    if (from === to) {
      // At the start of the line, in front of the prefix, text goes in front of the block.
      if (found.start < from && from < found.end && from !== prefix) {
        from = from > prefix ? found.end : found.start;
        to = from;
      }
    } else if (found.end > from && found.start < to) {
      from = from > found.start && from > prefix ? found.end : Math.min(from, found.start);
      // The rest of a prefix that the range ends in is written again after what replaces it.
      if (to > prefix && to < found.end) kept = plan.text.slice(to, found.end);
      to = Math.max(to, found.end);
    }
  }
  return { from, to, kept };
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
 * There are no empty blocks (format §3.4): a deletion of all the text of one or more blocks takes
 * the break that follows the last one too, or the break in front of the first one when it is at the
 * end of the text.
 */
function coverBlocks(plan: Plan, from: number, to: number): Range {
  const { text, markers } = plan;
  const blocks = breaksOfBody(plan, 0, text.length).filter((found) => found.block);
  const before = blocks.findLast((found) => found.end <= from);
  const after = blocks.find((found) => found.start >= to);
  const starts = before
    ? visibleText(text, markers, before.end, from) === ''
    : visibleText(text, markers, 0, from).trim() === '';
  const ends = after
    ? visibleText(text, markers, to, after.start) === ''
    : visibleText(text, markers, to, bodyEnd(plan)).trim() === '';
  if (!starts || !ends) return { from, to };
  // The break after the block goes with it. The prefix of the block that follows goes too when the
  // deleted block has a prefix of its own that stays, or there would be two: `- two` and `- three`
  // leave `- three`. A paragraph in front of a list leaves the list as it is.
  if (after)
    return { from, to: linePrefixAt(text, from) === '' ? lineStart(text, after.end) : after.end };
  if (before) return { from: before.start, to };
  return { from, to };
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
function legalize(plan: Plan, range: Range, typing: Typing): Placed {
  const { text, markers } = plan;
  let { from, to } = range;
  let left = '';
  let right = '';
  // A change inside the author's own insertion changes its text and writes no marker.
  if (plan.containers.some((c) => c.own && c.content.from <= from && to <= c.content.to)) {
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
    const open = inspectPlace(text, markers, from, { after: content + visibleAfter(plan, to) });
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
      const close = inspectPlace(text, markers, to, {
        before: visibleBefore(plan, from) + content,
        ...(typing.trail !== '' ? { after: SPLIT } : {}),
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
    // The closer must not start a line either: the change goes on to the end of the next word.
    const full = left + typing.inner + right;
    if (full !== '' && typing.trail === '' && /\n[ \t>]*$/.test(full)) {
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

/** The split whose break holds `position`: after its marker, and not after the break. The marker
 * and its break go together. */
function splitBreakAt(plan: Plan, from: number, to: number): MarkerRange | undefined {
  return plan.markers.find((marker) => {
    if (marker.role !== 'open' || marker.mark?.kind !== 'split') return false;
    const end = breakEnd(plan.text, marker.to);
    return end > marker.to && from < end && (from === to ? marker.to <= from : marker.to < to);
  });
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
  }
  // The white space that a replacement has in common with the text it replaces, at either end,
  // stays as it is: a line break is not taken away and typed again.
  if (from < to && typed !== '') {
    const old = visibleText(text, markers, from, to);
    const same = (a: string | undefined, b: string | undefined) => a === b && /\s/.test(a ?? '');
    let head = 0;
    while (head < old.length && head < typed.length && same(old[head], typed[head])) head++;
    let tail = 0;
    const limit = Math.min(old.length, typed.length) - head;
    while (tail < limit && same(old.at(-1 - tail), typed.at(-1 - tail))) tail++;
    // Only a break that is typed again, not any white space.
    if (!old.slice(0, head).includes('\n')) head = 0;
    if (!old.slice(old.length - tail).includes('\n')) tail = 0;
    let start = from;
    for (let i = 0; i < head; i++) start = stepRight(text, markers, start);
    let end = to;
    for (let i = 0; i < tail; i++) end = stepLeft(text, markers, end);
    // Not into the middle of a break: it is all kept, or all covered.
    const breaks = breaksOfBody(plan, from, to);
    const inside = (p: number) => breaks.some((b) => b.start < p && p < b.end);
    if (inside(start)) {
      start = from;
      head = 0;
    }
    if (inside(end)) {
      end = to;
      tail = 0;
    }
    from = start;
    to = end;
    typed = typed.slice(head, typed.length - tail);
  }
  if (from === to && typed === '') return;
  // Past the ledger there is no paragraph: the text goes where it is, without the rules above.
  const past = plan.parsed.ledgerRange !== null && from >= plan.parsed.ledgerRange.to;
  const first = from;
  const point = from === to;
  if (!past) {
    const covered = coverBreaks(plan, from, to);
    ({ from, to } = covered);
    typed += covered.kept;
  }
  // A range that starts in the prefix of a block keeps the prefix; what is typed in place of it
  // does not write it again.
  const skipped = text.slice(first, from);
  if (from > first && typed.startsWith(skipped)) {
    // Text typed inside the prefix goes after it, and the rest of the prefix after the text.
    typed = typed.slice(skipped.length) + (point ? skipped : '');
  }
  if (!past && from < to && typed === '') {
    const wide = coverBlocks(plan, from, to);
    ({ from, to } = wide.to === to && wide.from === from ? coverLine(plan, from, to) : wide);
  }
  // A break that a split inserted stays with its marker: text goes in front of both, and nothing
  // takes the break away before the split is decided.
  const unit = past ? undefined : splitBreakAt(plan, from, to);
  if (unit && from === to) from = to = unit.from;
  else if (unit) {
    throw new EditError(
      "A line break that someone inserted can't be deleted until that change is decided.",
      'no-legal-placement',
    );
  }
  let typing: Typing = { inner: typed, trail: '' };
  if (!past) {
    const settled = settleTrail(plan, { from, to }, tokenize(typed, linePrefixAt(text, from)));
    ({ from, to } = settled.range);
    typing = typingOf(settled.tokens);
  }
  const placed = past ? { from, to, left: '', right: '' } : legalize(plan, { from, to }, typing);
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
  if (past) plan.exempt.push(...plan.created.slice(createdBefore));
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

/** The message of a change that came out different from the edit. */
export const SELF_CHECK =
  'This change could not be written as tracked changes without altering other text. Make smaller changes.';

/**
 * Looks at what the changes make of the file, as a last check: the newest text is the edits made
 * to the newest text, up to white space that Markdown ignores, and the original text is as it was.
 * A change that comes out different would damage the document without a word, so it is refused.
 * Edits past the ledger are left out.
 */
function selfCheck(plan: Plan, edits: readonly TextChange[], changes: readonly TextChange[]): void {
  const { text } = plan;
  if (plan.exempt.length > 0) return;
  const view = newestView(text);
  const intended = applyChanges(
    view.text,
    edits
      .map((edit) => ({
        from: view.map.fromSource(edit.from),
        to: view.map.fromSource(edit.to),
        insert: inEol(edit.insert, plan.eol),
      }))
      .sort((a, b) => a.from - b.from || a.to - b.to),
  );
  const after = applyChanges(text, changes);
  // A change that touches a break takes all of it with the prefix of the next block, or the break
  // of a block that is deleted whole: only the letters, and their order, are compared.
  const letters = (s: string) => s.replace(/[^\p{L}]+/gu, '');
  // The original text of a deletion has the line breaks of its payload, which are LF.
  const lf = (s: string) => s.replaceAll('\r\n', '\n').replace(/\n+$/, '');
  if (
    letters(newestView(after).text) !== letters(intended) ||
    lf(originalView(after).text) !== lf(originalView(text).text)
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
  for (const edit of edits) planEdit(plan, edit);
  if (plan.changes.length === 0) return { changes: [], markIds: [], extendedIds: [] };
  // Widening an edit over a link or a break can make it reach into the next one.
  const sorted = plan.changes.toSorted((a, b) => a.from - b.from || a.to - b.to);
  if (sorted.some((change, i) => i > 0 && change.from < (sorted[i - 1]?.to ?? 0))) {
    throw new EditError(
      'Two of these changes would land in the same place. Make them one change, or one at a time.',
      'no-legal-placement',
    );
  }
  const changes = commitEdit(text, plan.changes, plan.ledger, {
    parsed: plan.parsed,
    created: [...new Set([...plan.created, ...plan.split])].filter(
      (id) => !plan.exempt.includes(id),
    ),
    verify: (after, parsed) => checkMarks(plan, after, parsed),
  });
  selfCheck(plan, edits, changes);
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
 * (format §4). A file with a ledger ends with the line break after the ledger, which the newest
 * view shows as text; deleting the final line break of the body leaves that one.
 *
 * @throws RangeError when the edit lies outside the text.
 * @throws EditError when the inserted text holds Redlines markup, when the change would be inside
 *   code or an HTML comment, or when the ledger can't be read.
 */
export function trackedEdit(text: string, edit: TextChange, ctx: EditContext): TextChange[] {
  return trackedEdits(text, [edit], ctx).changes;
}
