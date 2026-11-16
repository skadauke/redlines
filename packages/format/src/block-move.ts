// Moving blocks (format §3.14): the edits that take whole blocks, a run of siblings, from where they
// stand and put them where a gap between siblings is. The units are those of a widened edit
// (`widen-units.ts`): a paragraph, heading or other block, a code block, a table, a quote, a list, a
// list item. They are read from the newest view, so that other people's pending changes are no part
// of what moves: the copy at the new place holds the text as it reads now, and the old place keeps
// the text, with their changes in it, as a deletion. The edits are made as every edit is, by the
// tracked layer (`trackedEdits`, with one group for the marks) or plainly, so a move with Track
// Changes on is one suggestion that is accepted or rejected whole, and reads alike in every order.

import { EditError } from './errors.ts';
import { idsIn, newId } from './ids.ts';
import { parse } from './parse.ts';
import { trackedEdits } from './track.ts';
import type { EditContext, Range, TextChange } from './types.ts';
import { widen } from './widen.ts';
import { unitsOf } from './widen-units.ts';
import type { Unit, UnitKind } from './widen-units.ts';
import { newestView } from './views.ts';

/** A place between two siblings where a run can land. Offsets are in the source of the file. */
export interface BlockGap {
  /** Where the sibling after the gap starts (its line's start); for the gap after the last
   * sibling, where that one ends. Information only: the edits are made from `index`. */
  at: number;
  /** The gap is below the line that `at` ends: the one after the last sibling. */
  after: boolean;
  /** Where the sibling above the gap ends (its last line's end), if there is one. */
  above?: number;
  /** Which gap of the siblings it is: 0 above the first, the count below the last. */
  index: number;
}

/** A run of whole siblings that can move: a block, an item, several of them. */
export interface BlockRun {
  /** The kind of the first, and how many there are. */
  kind: UnitKind;
  count: number;
  /** Where the first block's text starts, past its bullet or quote marker. */
  textFrom: number;
  /** The run in the source: its first line's start to its last line's end. */
  from: number;
  to: number;
  /** The same in the newest view, which names it again for `moveBlockEdits`. */
  viewFrom: number;
  viewTo: number;
  /** Where the run could land, without the places it already stands at. */
  gaps: BlockGap[];
  /** The indexes of its first and last sibling. */
  first: number;
  last: number;
  /** Whether there is a place above and below it. */
  canMoveUp: boolean;
  canMoveDown: boolean;
}

interface Read {
  view: string;
  siblings: Unit[];
  first: number;
  last: number;
  map: ReturnType<typeof newestView>['map'];
}

const overlaps = (unit: Unit, from: number, to: number) =>
  unit.lineFrom <= Math.max(from, to) && Math.min(from, to) <= unit.to;

/** The siblings that `from` to `to` (offsets of the newest view) touches, at the deepest level that
 * holds the whole selection: through lists and quotes, and through an item only into a list or
 * a quote in it. */
function readRun(text: string, from: number, to: number): Read | undefined {
  const { text: view, map } = newestView(text);
  let siblings = unitsOf(view, parse(view));
  if (siblings.length === 0) return undefined;
  let first: number;
  let last: number;
  for (;;) {
    const touched = siblings.flatMap((unit, i) => (overlaps(unit, from, to) ? [i] : []));
    const a = touched[0];
    const b = touched.at(-1);
    if (a === undefined || b === undefined) return undefined;
    first = a;
    last = b;
    const only = siblings[a];
    if (a !== b || !only) break;
    const inside = only.children.filter((child) => overlaps(child, from, to));
    // A selection of the whole unit moves the unit. Otherwise a list or a quote is moved by what
    // is in it; an item is, when the selection is inside a list or a quote of its own (otherwise
    // the item moves whole, with what it holds).
    const whole = Math.min(from, to) < Math.max(from, to) && Math.min(from, to) <= only.lineFrom;
    const covered = Math.max(from, to) >= only.to;
    if (whole && covered) break;
    const low = Math.min(from, to);
    const deeper =
      only.kind === 'list' || only.kind === 'quote'
        ? inside
        : only.kind === 'item'
          ? inside.filter(
              (child) => (child.kind === 'list' || child.kind === 'quote') && low >= child.lineFrom,
            )
          : [];
    if (deeper.length === 0) break;
    siblings = only.children;
  }
  return { view, siblings, first, last, map };
}

const lineEnd = (unit: Unit) => unit.to;
const CLOSER = /^<!--\/[a-z0-9]{4}-->/;

/** The gaps of a read: all but the two that touch the run. */
function gapsOf(read: Read): BlockGap[] {
  const { siblings, first, last, map } = read;
  const gaps: BlockGap[] = [];
  for (let i = 0; i <= siblings.length; i++) {
    if (i >= first && i <= last + 1) continue;
    const next = siblings[i];
    const previous = siblings[i - 1];
    const above = previous ? { above: map.toSource(lineEnd(previous), -1) } : {};
    if (next) gaps.push({ at: map.toSource(next.lineFrom, -1), after: false, index: i, ...above });
    else if (previous)
      gaps.push({ at: map.toSource(lineEnd(previous), -1), after: true, index: i, ...above });
  }
  return gaps;
}

/**
 * The run of siblings that the selection `range` (offsets of the source) touches, or undefined
 * where there is nothing to move (an empty file, a range in front matter or the ledger). A caret in
 * a paragraph names the paragraph; in an item, the item; a selection of several blocks, those.
 */
export function blockRunAt(text: string, range: Range): BlockRun | undefined {
  const { map } = newestView(text);
  const read = readRun(text, map.fromSource(range.from), map.fromSource(range.to));
  const firstUnit = read?.siblings[read.first];
  const lastUnit = read?.siblings[read.last];
  if (!read || !firstUnit || !lastUnit) return undefined;
  return {
    kind: firstUnit.kind,
    count: read.last - read.first + 1,
    from: read.map.toSource(firstUnit.lineFrom, 1),
    textFrom: read.map.toSource(firstUnit.from, 1),
    to: read.map.toSource(lastUnit.to, -1),
    viewFrom: firstUnit.lineFrom,
    viewTo: lastUnit.to,
    gaps: gapsOf(read),
    first: read.first,
    last: read.last,
    canMoveUp: read.first > 0,
    canMoveDown: read.last < read.siblings.length - 1,
  };
}

/** The gap just above the run, or just below it, if there is one. */
export function neighbourGap(run: BlockRun, up: boolean): BlockGap | undefined {
  return run.gaps.find((gap) => gap.index === (up ? run.first - 1 : run.last + 2));
}

/**
 * The edits that move `run` to `gap` (one of its `gaps`): the run's text and the break that follows
 * it (or, for the last of its siblings, the break before it) are taken out, and the text with a
 * break of the siblings' kind goes in at the gap. In offsets of the source, for the tracked layer
 * or for a plain edit, with where the run is in the newest view after them. Exact in the newest
 * view only: another person's pending changes are not carried (§3.14). Undefined when the run, as the file reads now, is not the one the run names
 * (the text has changed since).
 */
export function moveBlockEdits(
  text: string,
  run: BlockRun,
  gap: BlockGap,
): { edits: TextChange[]; moved: Range } | undefined {
  const plan = plansOf(text, run, gap)[0];
  return plan && { edits: plan.source, moved: plan.moved };
}

/** The edits of one way of writing a move, in offsets of the source and of the newest view (for
 * `widen`). */
interface Plan {
  source: TextChange[];
  view: TextChange[];
  /** Where the moved blocks are in the newest view after the move. */
  moved: Range;
}

/**
 * The edits that move siblings `a` to `b` to the gap `g`. The text goes in at the start of the
 * sibling that the gap is above, or, with `behind`, after the end of the sibling above the gap.
 */
function build(
  text: string,
  read: Read,
  a: number,
  b: number,
  g: number,
  behind: boolean,
): Plan | undefined {
  const { view, siblings, map } = read;
  const firstUnit = siblings[a];
  const lastUnit = siblings[b];
  if (!firstUnit || !lastUnit) return undefined;
  const chunk = view.slice(firstUnit.lineFrom, lastUnit.to);
  const after = siblings[b + 1];
  const before = siblings[a - 1];
  // What takes the run's place in the text: the break after it, or, at the end, the break before.
  const taken: Range = after
    ? { from: firstUnit.lineFrom, to: after.lineFrom }
    : before
      ? { from: before.to, to: lastUnit.to }
      : { from: firstUnit.lineFrom, to: lastUnit.to };
  // The break that stands between siblings here, as the first two of them have it.
  const [left, right] = siblings;
  const breakOf = left && right ? view.slice(left.to, right.lineFrom) : '\n\n';
  const target = siblings[g];
  const above = siblings[g - 1];
  const place =
    target && !(behind && above)
      ? { at: target.lineFrom, insert: chunk + breakOf }
      : { at: (above ?? siblings.at(-1) ?? firstUnit).to, insert: breakOf + chunk };
  // After a block, past the closers of the marks that end it, but not past the ledger.
  let landing = map.toSource(place.at, -1);
  if (place.insert.startsWith(breakOf) && !place.insert.endsWith(breakOf)) {
    for (let m = CLOSER.exec(text.slice(landing)); m; m = CLOSER.exec(text.slice(landing))) {
      landing += m[0].length;
    }
  }
  const byFrom = (x: TextChange, y: TextChange) => x.from - y.from;
  const lead = place.insert.startsWith(chunk) ? 0 : breakOf.length;
  const removed = taken.to - taken.from;
  const start = place.at + lead - (place.at > taken.from ? removed : 0);
  return {
    moved: { from: start, to: start + chunk.length },
    source: [
      { from: map.toSource(taken.from, 1), to: map.toSource(taken.to, -1), insert: '' },
      { from: landing, to: landing, insert: place.insert },
    ].toSorted(byFrom),
    view: [
      { from: taken.from, to: taken.to, insert: '' },
      { from: place.at, to: place.at, insert: place.insert },
    ].toSorted(byFrom),
  };
}

/**
 * The ways to write the move of `run` to `gap`, the first preferred: the run itself moves, put in
 * above the sibling at the gap or after the one above it, then the same text again with the
 * siblings that it passes moving the other way, which reads as the same file.
 */
function plansOf(text: string, run: BlockRun, gap: BlockGap): Plan[] {
  const read = readRun(text, run.viewFrom, run.viewTo);
  const firstUnit = read?.siblings[read.first];
  const lastUnit = read?.siblings[read.last];
  if (!read || !firstUnit || !lastUnit) return [];
  if (firstUnit.lineFrom !== run.viewFrom || lastUnit.to !== run.viewTo) return [];
  const { first, last } = read;
  const g = gap.index;
  if (g >= first && g <= last + 1) return [];
  const plans = [build(text, read, first, last, g, false), build(text, read, first, last, g, true)];
  // The siblings that the run passes move the other way, to where the run was.
  plans.push(
    g < first
      ? build(text, read, g, first - 1, last + 1, true)
      : build(text, read, last + 1, g - 1, first, false),
  );
  const [primary, ...others] = plans.filter((plan): plan is Plan => plan !== undefined);
  // Every way reads as the same file, and the run the person moved is where the first puts it.
  return primary ? [primary, ...others.map((plan) => ({ ...plan, moved: primary.moved }))] : [];
}

/**
 * The tracked move of `run` to `gap`: the edits of `moveBlockEdits` (with where the run lands) written as the author's tracked
 * changes, a deletion at the old place and an insertion at the new, all in one group so that they
 * are decided together. Where a fine write isn't sound (a line break that someone else inserted
 * lies between, a block that can't take a mark), the move is widened: the blocks from the old place
 * to the new are replaced by a substitution, one change, that keeps others' pending changes in its
 * old text (§3.12). Undefined when the run is no longer there.
 *
 * @throws Untrackable when not even the widened write can be made (too many blocks between the
 * places): the caller asks first, and makes the move without tracking (§3.13).
 */
export function trackedBlockMove(
  text: string,
  run: BlockRun,
  gap: BlockGap,
  ctx: EditContext,
): { changes: TextChange[]; moved: Range } | undefined {
  const plans = plansOf(text, run, gap);
  const [plan] = plans;
  if (!plan) return undefined;
  const group = ctx.group ?? newId(idsIn(text), ctx.random);
  for (const next of plans) {
    try {
      return {
        changes: trackedEdits(text, next.source, { ...ctx, group }).changes,
        moved: next.moved,
      };
    } catch (error) {
      if (!(error instanceof EditError)) throw error;
    }
  }
  return { changes: widen(text, plan.view, ctx).changes, moved: plan.moved };
}
