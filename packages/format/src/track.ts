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
// Not done in v0.1: the rules of format §3.1 to §3.5 for where a marker may go (at a line start,
// inside a link, in atomic content). The text lands where the caller says, except that a change
// that would put its markers inside code or an HTML comment, where nothing would read them, is
// refused.

import { EditError } from './errors.ts';
import {
  addPerson,
  assertNoMarkup,
  commitEdit,
  eolOf,
  inEol,
  markerRanges,
  snapOut,
  workingLedger,
} from './edit-support.ts';
import type { Eol, MarkerRange } from './edit-support.ts';
import { idsIn, newId } from './ids.ts';
import { parse } from './parse.ts';
import { encodePayload } from './payload.ts';
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
  readonly ctx: EditContext;
  readonly markers: MarkerRange[];
  readonly containers: Container[];
  readonly ownDeletions: OwnDeletion[];
  readonly taken: Set<string>;
  readonly ledger: Ledger;
  readonly changes: TextChange[];
  /** The marks this call made. They must be there afterwards. */
  readonly created: string[];
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
    ctx,
    markers,
    containers,
    ownDeletions,
    taken: idsIn(text),
    ledger: workingLedger(parsed.ledger),
    changes: [],
    created: [],
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

/** Text to write at a place: where, and what. `extended` is the insertion it became part of. */
interface Typed {
  at: number;
  text: string;
  extended?: Container;
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
function leaveEdge(plan: Plan, position: number, within?: Range): number {
  for (const container of plan.containers) {
    if (container.own) continue;
    if (within && (container.open.from < within.from || container.close.to > within.to)) continue;
    if (container.content.from === position) return container.open.from;
    if (container.content.to === position) return container.close.to;
  }
  return position;
}

/** The text with other people's marks closed in front of it and opened again after it. */
function splitAround(containers: readonly Container[], middle: string): string {
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
  return closers + middle + openers;
}

/** The step limit of the loops that move a position out of marks: each step crosses a marker. */
function steps(plan: Plan): number {
  return plan.containers.length * 2 + 2;
}

/** Text typed in the author's own insertion or substitution is part of it. Another person's mark
 * inside it is not extended, so it is closed around the text. */
function extend(plan: Plan, own: Container, position: number, typed: string): Typed {
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
  return { at, text: splitAround(around, typed), extended: own };
}

/** What typing `typed` at `position` writes: part of the author's own insertion, or a new
 * insertion, which splits the insertions and substitutions of other people around it. */
function typeAt(plan: Plan, position: number, typed: string): Typed {
  let at = position;
  for (let step = 0; step < steps(plan); step++) {
    const own = ownContainerAt(plan, at);
    if (own) return extend(plan, own, at, typed);
    const next = leaveEdge(plan, at);
    if (next === at) break;
    at = next;
  }
  const around = plan.containers.filter((c) => !c.own && c.content.from < at && at < c.content.to);
  const id = newMark(plan);
  return { at, text: splitAround(around, `<!--ins ${id}-->${typed}<!--/${id}-->`) };
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
function replaceOne(plan: Plan, piece: Piece, typed: string): TextChange {
  if (piece.container?.own) {
    plan.touched.push(piece.container.mark.id);
    return { from: piece.from, to: piece.to, insert: typed };
  }
  const id = newMark(plan);
  const old = encodePayload(piece.text);
  return { from: piece.from, to: piece.to, insert: `<!--sub ${id} ${old}-->${typed}<!--/${id}-->` };
}

function replaceRange(plan: Plan, from: number, to: number, typed: string): void {
  const pieces = piecesIn(plan, from, to);
  const [only] = pieces;
  if (typed !== '' && pieces.length === 1 && only && only.from === from && only.to === to) {
    plan.changes.push(replaceOne(plan, only, typed));
    return;
  }
  // The new text comes after the old, where the range ends.
  const typing = typed === '' ? undefined : typeAt(plan, to, typed);
  const changes = deletionChanges(plan, pieces, {
    extended: typing?.extended,
    merge: typed === '',
  });
  if (typing) {
    const host = changes.find((change) => change.to === typing.at);
    if (host) host.insert += typing.text;
    else changes.push({ from: typing.at, to: typing.at, insert: typing.text });
  }
  plan.changes.push(...changes);
}

function planEdit(plan: Plan, edit: TextChange): void {
  const { text, markers } = plan;
  if (edit.from < 0 || edit.to < edit.from || edit.to > text.length) {
    throw new RangeError(
      `The edit ${edit.from}-${edit.to} is out of order or outside the text (${text.length} characters)`,
    );
  }
  const typed = inEol(edit.insert, plan.eol);
  if (typed !== '') assertNoMarkup(typed);
  const insertAt = (position: number) => {
    const typing = typeAt(plan, position, typed);
    plan.changes.push({ from: typing.at, to: typing.at, insert: typing.text });
  };
  if (edit.from === edit.to) {
    if (typed !== '') insertAt(snapOut(markers, edit.from, false));
    return;
  }
  const from = snapOut(markers, edit.from, true);
  const to = snapOut(markers, edit.to, false);
  if (from >= to) {
    // Both ends are in one marker, so no text is touched.
    if (typed !== '') insertAt(to);
    return;
  }
  replaceRange(plan, from, to, typed);
}

/** Throws when a mark this call made would not be read: its markers are in code or in an HTML
 * comment. */
function checkMarks(parsed: Parsed, created: readonly string[]): void {
  const found = new Set(parsed.marks.map((mark) => mark.id));
  if (created.some((id) => !found.has(id))) {
    throw new EditError(
      "A tracked change can't go inside code or an HTML comment, where its markers would not be read. Change the whole code span or comment instead.",
      'inside-code',
    );
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
  const changes = commitEdit(text, plan.changes, plan.ledger, {
    parsed: plan.parsed,
    verify: (_after, parsed) => checkMarks(parsed, plan.created),
  });
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
