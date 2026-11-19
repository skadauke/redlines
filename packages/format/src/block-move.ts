// Moving blocks (format §3.14): the edits that take whole blocks, a run of siblings, from where they
// stand and put them where a gap between siblings is. The units are those of a widened edit
// (`widen-units.ts`): a paragraph, heading or other block, a code block, a table, a quote, a list, a
// list item. They are read from the newest view, so that other people's pending changes are no part
// of what moves: the copy at the new place holds the text as it reads now, and the old place keeps
// the text, with their changes in it, as a deletion. The edits are made as every edit is, by the
// tracked layer (`trackedEdits`, with one group for the marks) or plainly, so a move with Track
// Changes on is one suggestion that is accepted or rejected whole, and reads alike in every order.

import { applyChanges } from './changes.ts';
import { withDialect } from './dialect.ts';
import { EditError } from './errors.ts';
import { idsIn, newId } from './ids.ts';
import { setLedger } from './ledger-write.ts';
import { parse } from './parse.ts';
import { fineEdits as trackedEdits } from './track.ts';
import type { EditContext, Range, TextChange } from './types.ts';
import { Untrackable, widen } from './widen.ts';
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
  /** The run ends in a code fence that nothing closes, which holds what follows it: wherever the
   * run goes but last, it would hold other blocks, so it has no place to go (#1103). */
  unclosed?: boolean;
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

/** Whether a unit is a fenced code block whose fence nothing closes, which holds the rest of its
 * container (#1103). */
function isUnclosed(view: string, unit: Unit): boolean {
  if (unit.kind !== 'code') return false;
  const tail = view.slice(unit.lineFrom, unit.to).split('\n');
  const fence = /^[ \t>]*(`{3,}|~{3,})/.exec(tail[0] ?? '')?.[1];
  if (fence === undefined) return false;
  const closing = new RegExp(`^[ \\t>]*${fence[0] === '~' ? '~' : '`'}{${fence.length},}[ \\t]*$`);
  return !(tail.length > 1 && closing.test(tail.at(-1) ?? ''));
}

/** The gaps of a read: all but the two that touch the run. */
function gapsOf(read: Read): BlockGap[] {
  const { siblings, first, last, map } = read;
  const gaps: BlockGap[] = [];
  // Nothing goes below a fence that nothing closes: it would be the fence's own text.
  const held = siblings.findIndex((unit) => isUnclosed(read.view, unit));
  for (let i = 0; i <= siblings.length; i++) {
    if (i >= first && i <= last + 1) continue;
    if (held !== -1 && i > held) continue;
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
  const unclosed = isUnclosed(read.view, lastUnit);
  return {
    kind: firstUnit.kind,
    count: read.last - read.first + 1,
    from: read.map.toSource(firstUnit.lineFrom, 1),
    textFrom: read.map.toSource(firstUnit.from, 1),
    to: read.map.toSource(lastUnit.to, -1),
    viewFrom: firstUnit.lineFrom,
    viewTo: lastUnit.to,
    gaps: unclosed ? [] : gapsOf(read),
    first: read.first,
    last: read.last,
    ...(unclosed ? { unclosed } : {}),
    canMoveUp: read.first > 0 && !unclosed,
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
): { edits: TextChange[]; moved: Range; verbatim?: true } | undefined {
  const [plan] = plansOf(text, run, gap, false, true);
  if (plan && (plan.anchors > 0 || plan.pending)) {
    // Every way takes out a comment's or a highlight's marker, which typed text can't put back, and
    // the marker left alone would split a list that the move keeps whole (#1052): the text goes as
    // the file has it, markers and all, as edits that are made as they are.
    const own = plansOf(text, run, gap, true, true)[0];
    if (own) return { edits: own.source, moved: own.moved, verbatim: true };
  }
  return plan && { edits: plan.source, moved: plan.moved };
}

/** The edits of one way of writing a move, in offsets of the source and of the newest view (for
 * `widen`). */
interface Plan {
  source: TextChange[];
  view: TextChange[];
  /** Where the moved blocks are in the newest view after the move. */
  moved: Range;
  /** The move brings two lists side by side (`joinsLists`): the fine write isn't sound (#871). */
  joins?: boolean;
  /** How many comments and highlights have a marker in the text that the plan takes out. */
  anchors: number;
  /** The text that the plan takes out holds pending changes (insertions, deletions, replacements,
   * splits, format changes), of anyone. */
  pending: boolean;
  /** The edits are the file's own text, markers and all, taken out and put in again: they can't go
   * through the writers of typed text, which refuse markup. */
  verbatim?: boolean;
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
  verbatim = false,
  plain = false,
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
  const between = left && right ? view.slice(left.to, right.lineFrom) : '\n\n';
  const target = siblings[g];
  const above = siblings[g - 1];
  // A block put right below or above an HTML block is put apart from it by a blank line, where the siblings
  // stand apart by a line break alone: the HTML block takes the next line as its own (#1103).
  const precede = target && !(behind && above) ? above : (above ?? siblings.at(-1));
  const before1 = target && !(behind && above);
  const html =
    (precede !== undefined && view[precede.from] === '<') ||
    (before1 && view[firstUnit.from] === '<');
  const breakOf =
    html && left?.kind !== 'item' && !/\n[ \t>]*\n/.test(between)
      ? between.replace(
          /^(\n)([ \t>]*)$/,
          (_, nl: string, prefix: string) => `${nl}${prefix.trimEnd()}\n${prefix}`,
        )
      : between;

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
  const takenFrom = map.toSource(taken.from, 1);
  const takenTo = map.toSource(taken.to, -1);
  const anchors = parse(text).marks.filter(
    (mark) =>
      (mark.kind === 'cmt' || mark.kind === 'hl') &&
      mark.segments.some(
        (segment) => segment.open.from < takenTo && (segment.close ?? segment.open).to > takenFrom,
      ),
  ).length;
  const pending = parse(text).marks.some(
    (mark) =>
      mark.kind !== 'cmt' &&
      mark.kind !== 'hl' &&
      mark.segments.some(
        (segment) => segment.open.from < takenTo && (segment.close ?? segment.open).to > takenFrom,
      ),
  );
  const lead = place.insert.startsWith(chunk) ? 0 : breakOf.length;
  let insert = place.insert;
  const cut = verbatim
    ? { from: map.toSource(taken.from, -1), to: takenTo }
    : { from: takenFrom, to: takenTo };
  if (verbatim) {
    const own = verbatimChunk(text, map, firstUnit.lineFrom, lastUnit.to, cut);
    if (!own) return undefined;
    insert = place.insert.startsWith(chunk) ? own + breakOf : breakOf + own;
  }
  const removed = taken.to - taken.from;
  // An empty item can't start a list under a line of text: when the move makes one the first of its
  // siblings, a blank line goes above the list, as the file needs to read it (#1103).
  const blank = blankAbove(view, siblings, a, b, g);
  const gain = blank ? blank.insert.length : 0;
  const start = place.at + lead - (place.at > taken.from ? removed : 0) + gain;
  // The blank line goes in with the edit that stands where the list starts: in front of the moved
  // text where it lands first, and in place of the text taken out where that was first.
  const lead1 = blank && g === 0 ? blank.insert : '';
  const gone = plain && blank && g !== 0 ? blank.insert : '';
  const apart: TextChange[] =
    blank && g !== 0 && !plain
      ? [{ from: map.toSource(blank.at, -1), to: map.toSource(blank.at, -1), insert: blank.insert }]
      : [];
  return {
    anchors,
    pending,
    ...(verbatim ? { verbatim } : {}),
    moved: { from: start, to: start + chunk.length },
    source: [
      { from: cut.from, to: cut.to, insert: gone },
      { from: landing, to: landing, insert: lead1 + insert },
      ...apart,
    ].toSorted(byFrom),
    view: [
      { from: taken.from, to: taken.to, insert: gone },
      { from: place.at, to: place.at, insert: lead1 + place.insert },
      ...(blank && g !== 0 && !plain
        ? [{ from: blank.at, to: blank.at, insert: blank.insert }]
        : []),
    ].toSorted(byFrom),
  };
}

/** A line that can't start a list under a line of text: a bare marker, or a number other than 1. */
const CANT_START = /^[ \t>]*(?:(?:[-+*]|\d{1,9}[.)])[ \t]*$|(?!0*1[.)])\d{1,9}[.)])/;

/**
 * Where a blank line is needed above a list after a move: the move makes an item with no text the
 * first of the siblings (the moved run, or the one after it where the run was first), and a line of
 * text stands right above the list. Undefined when none is.
 */
function blankAbove(
  view: string,
  siblings: readonly Unit[],
  a: number,
  b: number,
  g: number,
): { at: number; insert: string } | undefined {
  const top = siblings[0];
  if (!top || top.kind !== 'item') return undefined;
  const next = siblings[b + 1];
  const lineAt = (from: number) => {
    const end = view.indexOf('\n', from);
    return view.slice(from, end === -1 ? undefined : end);
  };
  const first =
    g === 0
      ? lineAt(siblings[a]?.lineFrom ?? 0)
      : a === 0 && next
        ? lineAt(next.lineFrom)
        : undefined;
  if (first === undefined || !CANT_START.test(first)) return undefined;
  if (top.lineFrom === 0) return undefined;
  const above = view.slice(view.lastIndexOf('\n', top.lineFrom - 2) + 1, top.lineFrom - 1);
  if (/^[ \t>]*$/.test(above)) return undefined;
  const quote = /^(?:[ \t]*>)*/.exec(view.slice(top.lineFrom))?.[0] ?? '';
  return { at: top.lineFrom, insert: `${quote}\n` };
}

/**
 * The run's own text in the source, with its markers, to be taken out and put in again as it is: the
 * source from the start of the first block's text to the end of the last, and the closers of marks
 * that end it. Undefined when a mark reaches out of it, or lies in what the deletion `cut` takes
 * besides it, which a verbatim move could not carry whole.
 */
function verbatimChunk(
  text: string,
  map: Read['map'],
  viewFrom: number,
  viewTo: number,
  cut: Range,
): string | undefined {
  const from = map.toSource(viewFrom, -1);
  let to = map.toSource(viewTo, -1);
  // The markers that stand right after the last text on its line (a pending deletion, say) go with it.
  const past = map.toSource(viewTo, 1);
  if (past > to && !text.slice(to, past).includes('\n')) to = past;
  for (let m = CLOSER.exec(text.slice(to)); m; m = CLOSER.exec(text.slice(to))) to += m[0].length;
  if (cut.from > from || cut.to < to) return undefined;
  for (const mark of parse(text).marks) {
    for (const segment of mark.segments) {
      const low = segment.open.from;
      const high = Math.max(segment.carrier?.to ?? 0, segment.close?.to ?? segment.open.to);
      const touches = low < cut.to && high > cut.from;
      if (touches && !(low >= from && high <= to)) return undefined;
    }
  }
  return text.slice(from, to);
}

/**
 * The ways to write the move of `run` to `gap`, the first preferred: the run itself moves, put in
 * above the sibling at the gap or after the one above it, then the same text again with the
 * siblings that it passes moving the other way, which reads as the same file.
 */
function plansOf(
  text: string,
  run: BlockRun,
  gap: BlockGap,
  verbatim = false,
  plain = false,
): Plan[] {
  const read = readRun(text, run.viewFrom, run.viewTo);
  const firstUnit = read?.siblings[read.first];
  const lastUnit = read?.siblings[read.last];
  if (!read || !firstUnit || !lastUnit) return [];
  if (firstUnit.lineFrom !== run.viewFrom || lastUnit.to !== run.viewTo) return [];
  const { first, last } = read;
  const g = gap.index;
  if (g >= first && g <= last + 1) return [];
  const plans = [
    build(text, read, first, last, g, false, verbatim, plain),
    build(text, read, first, last, g, true, verbatim, plain),
  ];
  // The siblings that the run passes move the other way, to where the run was.
  plans.push(
    g < first
      ? build(text, read, g, first - 1, last + 1, true, verbatim, plain)
      : build(text, read, last + 1, g - 1, first, false, verbatim, plain),
  );
  const [primary, ...others] = plans.filter((plan): plan is Plan => plan !== undefined);
  if (!primary) return [];
  const joins = joinsLists(read.siblings, first, last, g);
  // Every way reads as the same file, and the run the person moved is where the first puts it.
  const all = [primary, ...others.map((plan) => ({ ...plan, moved: primary.moved }))];
  return all.map((plan) => ({ ...plan, joins }));
}

/**
 * Whether moving siblings `first` to `last` to the gap `g` brings two lists side by side that were
 * not. The newest view reads them as one list (the second nested in the last item of the first, or
 * both a loose list), where the file, with a marker of the move between them, reads two.
 */
function joinsLists(siblings: readonly Unit[], first: number, last: number, g: number): boolean {
  const run = siblings.slice(first, last + 1);
  const rest = siblings.filter((_, i) => i < first || i > last);
  const at = g <= first ? g : g - run.length;
  const after = [...rest.slice(0, at), ...run, ...rest.slice(at)];
  return after.some((unit, i) => {
    const next = after[i + 1];
    return (
      unit.kind === 'list' &&
      next?.kind === 'list' &&
      Math.abs(siblings.indexOf(next) - siblings.indexOf(unit)) !== 1
    );
  });
}

/** Whether the tracked `changes` and the plain `source` edits leave the same newest view, but for
 * blank lines (a closer stands alone on its line, §3.12) and the numbers of ordered lists. */
function readsAs(text: string, source: readonly TextChange[], changes: readonly TextChange[]) {
  const flat = (edits: readonly TextChange[]) =>
    newestView(
      applyChanges(
        text,
        edits.toSorted((x, y) => x.from - y.from || x.to - y.to),
      ),
    )
      .text.trimEnd()
      .replace(/^(\s*(?:>\s*)*)\d{1,9}([.)])/gm, '$1N$2')
      .replace(/\n(?:[ \t]*\n)+/g, '\n');
  try {
    return flat(source) === flat(changes);
  } catch (error) {
    if (error instanceof RangeError) return true; // overlapping edits: nothing to compare
    throw error;
  }
}

/** Whether a change writes a marker inside a code unit (a fenced block, indented code, a raw HTML block), past its first line: a move takes
 * whole blocks, and a marker there is read as the code's own text. */
function insideCode(text: string, changes: readonly TextChange[]): boolean {
  const code: Range[] = [];
  const walk = (units: readonly Unit[]) => {
    for (const unit of units) {
      if (unit.kind === 'code') {
        const open = text.indexOf('\n', unit.lineFrom);
        if (open !== -1 && open < unit.to) code.push({ from: open, to: unit.to });
      }
      walk(unit.children);
    }
  };
  walk(unitsOf(text, parse(text)));
  return changes.some(
    (change) =>
      change.insert.includes('<!--') &&
      code.some((range) => range.from < change.from && change.from < range.to),
  );
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
  return withDialect(ctx.dialect, () => {
    const plans = plansOf(text, run, gap);
    const [plan] = plans;
    if (!plan) return undefined;
    const group = ctx.group ?? newId(idsIn(text), ctx.random);
    if (plan.pending && !plan.joins) {
      // Text that holds pending changes goes one way only: the blocks from the old place to the
      // new replaced, with the changes kept in the old text. The fine write puts deletions among
      // the markers of an insertion, a mark each on a line of its own, which read otherwise when
      // some of them are decided and others not (#1052, walk seed 44).
      try {
        return { changes: widen(text, plan.view, ctx).changes, moved: plan.moved };
      } catch (error) {
        if (!(error instanceof EditError) && !(error instanceof Untrackable)) throw error;
      }
    }
    for (const next of plans.filter((other) => !other.joins)) {
      try {
        const { changes } = trackedEdits(text, next.source, { ...ctx, group });
        // A fine write whose newest view has other fences than the file's (a replacement that starts
        // at the closing fence of an earlier code block and writes a stray one, #586 seed 102) is
        // wrong: the next way, then the widened one, which asks if it can't be made.
        if (insideCode(text, changes)) continue;
        // A fine write that joins the line above to the item below (a deletion that ends where an
        // item starts takes its bullet, as a Delete over the break does) reads otherwise than the
        // plain move: the next way, then the widened one (#586, block-move-random seed 142).
        if (!readsAs(text, next.source, changes)) continue;
        return { changes: linkMove(text, changes, group), moved: next.moved };
      } catch (error) {
        if (!(error instanceof EditError)) throw error;
      }
    }
    return { changes: widen(text, plan.view, ctx).changes, moved: plan.moved };
  });
}

/**
 * The marks of a fine move linked as a move (format §3.14): each insertion's ledger entry names the
 * first deletion of the group in `move`, and each deletion's the first insertion, as the two halves
 * of a moved table row do (§3.7). The link changes nothing a reader sees or any decision: it says
 * that the insertion is the deletion's text at a new place, so that it can be drawn as a move. The
 * changes are the move's, with the ledger written once, with the links.
 */
function linkMove(text: string, changes: TextChange[], group: string): TextChange[] {
  const after = applyChanges(text, changes);
  const parsed = parse(after);
  const marks = parsed.marks.filter((mark) => mark.entry.group === group);
  const insertion = marks.find((mark) => mark.kind === 'ins');
  const deletion = marks.find((mark) => mark.kind === 'del');
  if (
    !insertion ||
    !deletion ||
    marks.some((mark) => mark.kind !== 'ins' && mark.kind !== 'del' && mark.kind !== 'split')
  ) {
    return changes;
  }
  const ledger = structuredClone(parsed.ledger);
  for (const mark of marks) {
    const entry = ledger.marks[mark.id];
    if (entry && mark.kind !== 'split')
      entry.move = mark.kind === 'ins' ? deletion.id : insertion.id;
  }
  const linked = applyChanges(after, setLedger(after, ledger));
  if (linked === after) return changes;
  // The ledger is the end of the file: the move's own changes without the ledger's, and one change
  // from where the text they make first differs from the linked one.
  const ledgerAt = parse(text).ledgerRange?.from;
  const inLedger = (change: TextChange) =>
    change.insert.includes('<!-- redlines') || (ledgerAt !== undefined && change.from >= ledgerAt);
  const body = changes.filter((change) => !inLedger(change));
  const mid = applyChanges(text, body);
  if (mid === linked) return body;
  let start = 0;
  while (start < mid.length && mid[start] === linked[start]) start++;
  let end = 0;
  while (
    end < mid.length - start &&
    mid[mid.length - 1 - end] === linked[linked.length - 1 - end]
  ) {
    end++;
  }
  const delta = mid.length - text.length;
  let shift = 0;
  let lastEnd = 0;
  for (const change of body.toSorted((a, b) => a.from - b.from)) {
    lastEnd = change.from + shift + change.insert.length;
    shift += change.insert.length - (change.to - change.from);
  }
  if (start < lastEnd) return changes;
  return [
    ...body,
    {
      from: Math.max(start - delta, 0),
      to: mid.length - end - delta,
      insert: linked.slice(start, linked.length - end),
    },
  ];
}
