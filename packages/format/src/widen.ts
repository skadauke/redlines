// Widening an edit (format §3.12). An edit that can't be written as marks at the grain it was made,
// so that every order of decisions reads alike, is written as one substitution of the smallest unit
// that holds it: the unit as the old text, the unit as it reads with the edit made as the new text.
// Other people's pending changes in the unit stay in the old text, as the marks they are, in the
// payload's encoding; your own fold into the replacement, as rejecting them would leave the unit.
//
// Nothing calls this yet: the writers that refuse today will call it in their turn. It is the one
// writer all of them share: they differ in why the fine form failed, not in what to write.

import { scaffold, continuationPrefix, bodyStart } from './blocks.ts';
import { applyChanges, eolOf } from './changes.ts';
import { rejectMarks } from './decide.ts';
import { addPerson, changesBetween, paragraphBreaks, workingLedger } from './edit-support.ts';
import { EditError } from './errors.ts';
import { idsIn, newId } from './ids.ts';
import { normalizeLedger } from './ledger-order.ts';
import { setLedger } from './ledger-write.ts';
import { parse } from './parse.ts';
import { encodePayload } from './payload.ts';
import { unitsOf } from './widen-units.ts';
import type { Unit, UnitKind } from './widen-units.ts';
import type { EditContext, MarkEntry, MarkRange, Parsed, Range, TextChange } from './types.ts';
import { newestView, originalView } from './views.ts';

/** The most top-level blocks one replacement holds, after closure (format §3.12). A list and a table
 * count as one. Past it the unit is not a reasonable thing to ask a reviewer to read. */
export const WIDEN_MOST_BLOCKS = 8;

export type UntrackableReason =
  /** The edit is in front matter, which no unit can hold. */
  | 'front-matter'
  /** The unit that holds the edit and what it touches is longer than `WIDEN_MOST_BLOCKS`. */
  | 'too-large'
  /** No unit passes the gate, or the end of the file can't hold the marks. */
  | 'no-unit';

/**
 * An edit that no unit can hold. It is not a refusal: the person is asked, and the edit is made
 * without tracking (format §3.13); an agent's edit is refused with words for the agent.
 */
export class Untrackable extends Error {
  override name = 'Untrackable';
  readonly reason: UntrackableReason;
  /** The number of blocks the unit would have held, for `too-large`. */
  readonly blocks: number | undefined;
  /** The people whose pending changes are in it. */
  readonly others: readonly string[];

  constructor(reason: UntrackableReason, message: string, blocks?: number, others: string[] = []) {
    super(message);
    this.reason = reason;
    this.blocks = blocks;
    this.others = others;
  }
}

/** What is replaced: the unit, in the file the replacement is written in. */
export interface WidenedUnit {
  kind: UnitKind;
  /** The rung of the ladder: 0 is the block (or the table, or the code block) the edit is in. */
  rung: number;
  /** Where the replaced text starts and ends in the file before the edit. */
  from: number;
  to: number;
  /** How many top-level blocks it holds. */
  blocks: number;
}

export interface Widened {
  /** Changes of the file as it was, for the body and the ledger. */
  changes: TextChange[];
  /** The file after them. */
  text: string;
  /** The id of the new substitution. */
  id: string;
  unit: WidenedUnit;
  /** The ids of other people's pending changes that are in its old text. */
  held: string[];
}

/**
 * Writes `edits`, which are changes to the text of the newest view (what typing with Track
 * Changes off would write), as the replacement of the smallest unit that holds them and passes the
 * gate: the file with the replacement pending reads the newest text as intended, and the original
 * text as it was, and no marker starts a line that did not.
 *
 * @throws Untrackable when no unit holds the edit; EditError when the ledger can't be read.
 */
export function widen(
  text: string,
  edits: readonly TextChange[],
  ctx: EditContext,
): Widened {
  const parsed = parse(text);
  const view = newestView(text);
  const sorted = edits.toSorted((a, b) => a.from - b.from || a.to - b.to);
  const first = sorted[0];
  const last = sorted.at(-1);
  if (!first || !last) throw new Untrackable('no-unit', 'There is no edit to write.');
  const spanFrom = first.from;
  const spanTo = Math.max(...sorted.map((edit) => edit.to));
  const sourceFrom = view.map.toSource(spanFrom, 1);
  const sourceTo = Math.max(sourceFrom, view.map.toSource(spanTo, -1));
  if (sourceFrom < bodyStart(text) || (parsed.ledgerRange && sourceFrom > parsed.ledgerRange.from)) {
    throw new Untrackable('front-matter', "Front matter can't be marked as a change.");
  }
  const intended = applyChanges(view.text, sorted);
  const units = unitsOf(text, parsed);
  const others = (range: Range) => othersIn(parsed, range, ctx);
  let rung = rungOf(units, sourceFrom, sourceTo);
  let blocks = 0;
  for (let index = 0; rung; index++) {
    const closed = closure(parsed, units, rung, sourceFrom, sourceTo);
    blocks = topLevelBlocks(units, closed);
    if (blocks > WIDEN_MOST_BLOCKS) {
      throw new Untrackable(
        'too-large',
        `This change would replace ${blocks} blocks.`,
        blocks,
        others({ from: closed.lineFrom, to: closed.to }),
      );
    }
    const done = tryRung(text, parsed, view, intended, sorted, closed, ctx, index, blocks);
    if (done) return done;
    rung = widerThan(closed);
  }
  throw new Untrackable('no-unit', 'No unit can hold this change.', undefined, others({ from: sourceFrom, to: sourceTo }));
}

/** The people, other than the author, who have pending changes in `range`. */
function othersIn(parsed: Parsed, range: Range, ctx: EditContext): string[] {
  const people = new Set<string>();
  for (const mark of parsed.marks) {
    if (mark.entry.by === ctx.author.handle || !touches(mark, range)) continue;
    const person = parsed.ledger.people.find((p) => p.handle === mark.entry.by);
    people.add(person?.name ?? mark.entry.by);
  }
  return [...people];
}

/** A unit, or the stretch of sibling units that a span covers. */
interface Rung {
  kind: UnitKind;
  from: number;
  lineFrom: number;
  to: number;
  prefix: string;
  tight: boolean;
  atomic: boolean;
  /** The units it is made of, and the one that holds them. */
  units: Unit[];
  parent: Unit | undefined;
}

function rungOfUnits(units: Unit[], parent: Unit | undefined): Rung {
  const first = units[0]!;
  const last = units.at(-1)!;
  return {
    kind: units.length === 1 ? first.kind : 'block',
    from: first.from,
    lineFrom: first.lineFrom,
    to: last.to,
    prefix: first.prefix,
    tight: first.tight,
    atomic: units.length === 1 && first.atomic,
    units,
    parent,
  };
}

/** The smallest unit, or stretch of siblings, that holds the source range `[from, to]`. */
function rungOf(units: readonly Unit[], from: number, to: number): Rung | undefined {
  let level: readonly Unit[] = units;
  let parent: Unit | undefined;
  for (;;) {
    const hit = level.filter((unit) => unit.lineFrom <= to && from <= unit.to);
    if (hit.length === 0) {
      // The range is between blocks, in blank lines: the block above it.
      const above = level.filter((unit) => unit.to < from).at(-1) ?? level[0];
      return above ? rungOfUnits([above], parent) : undefined;
    }
    const [only] = hit;
    if (hit.length === 1 && only) {
      // Down into the unit when what it holds is one block that holds the range.
      const inner = only.children.filter((unit) => unit.lineFrom <= to && from <= unit.to);
      if (inner.length > 0 && only.kind !== 'table' && !only.atomic) {
        level = only.children;
        parent = only;
        continue;
      }
      return rungOfUnits([only], parent);
    }
    return rungOfUnits(hit, parent);
  }
}

/** The next larger unit around a rung: the unit that holds it. Undefined at the top. */
function widerThan(rung: Rung): Rung | undefined {
  const parent = rung.parent;
  return parent ? rungOfUnits([parent], parent.parent) : undefined;
}

/** Whether a mark has any marker in `range`. */
function touches(mark: MarkRange, range: Range): boolean {
  return mark.segments.some((segment) => {
    const end = (segment.close ?? segment.carrier ?? segment.open).to;
    return segment.open.from <= range.to && end >= range.from;
  });
}

/** Where a mark starts and ends. */
function extentOf(mark: MarkRange): Range {
  return {
    from: Math.min(...mark.segments.map((segment) => segment.open.from)),
    to: Math.max(...mark.segments.map((segment) => (segment.close ?? segment.carrier ?? segment.open).to)),
  };
}

/**
 * A unit must hold every mark it touches whole (format §3.12): a comment, a highlight or a change
 * that starts inside it and ends outside makes it grow to the blocks that hold the mark.
 */
function closure(
  parsed: Parsed,
  units: readonly Unit[],
  start: Rung,
  spanFrom: number,
  spanTo: number,
): Rung {
  let rung = start;
  for (let round = 0; round <= parsed.marks.length; round++) {
    let from = Math.min(rung.lineFrom, spanFrom);
    let to = Math.max(rung.to, spanTo);
    let grew = false;
    for (const mark of parsed.marks) {
      if (!touches(mark, { from: rung.lineFrom, to: rung.to })) continue;
      const extent = extentOf(mark);
      if (extent.from < from) {
        from = extent.from;
        grew = true;
      }
      if (extent.to > to) {
        to = extent.to;
        grew = true;
      }
    }
    if (!grew) return rung;
    const bigger = rungOf(units, from, to);
    if (!bigger) return rung;
    rung = bigger;
  }
  return rung;
}

/** The top-level blocks that a rung's lines are in. */
function topLevelBlocks(units: readonly Unit[], rung: Rung): number {
  return units.filter((unit) => unit.lineFrom <= rung.to && rung.lineFrom <= unit.to).length;
}

/** What a position becomes when `changes` are made: inside a change, at its start. */
function mapped(changes: readonly TextChange[], position: number): number {
  let delta = 0;
  for (const change of changes) {
    if (position < change.from) break;
    if (position <= change.to && position > change.from) return change.from + delta;
    delta += change.insert.length - (change.to - change.from);
  }
  return position + delta;
}

function tryRung(
  text: string,
  parsed: Parsed,
  view: ReturnType<typeof newestView>,
  intended: string,
  edits: readonly TextChange[],
  rung: Rung,
  ctx: EditContext,
  index: number,
  blocks: number,
): Widened | undefined {
  // The new text: the unit as the newest view has it, with the edits made.
  const viewFrom = view.map.fromSource(rung.from);
  const viewTo = view.map.fromSource(rung.to);
  if (edits.some((edit) => edit.from < viewFrom || edit.to > viewTo)) return undefined;
  const now = applyChanges(
    view.text.slice(viewFrom, viewTo),
    edits.map((edit) => ({ ...edit, from: edit.from - viewFrom, to: edit.to - viewFrom })),
  );
  const range = { from: rung.lineFrom, to: rung.to };
  // Your own pending changes in the unit fold into the replacement: they are rejected in its old
  // text, as they would be by rejecting them, and their text is in the new text.
  const own = parsed.marks.filter(
    (mark) => mark.entry.by === ctx.author.handle && touches(mark, range),
  );
  let before = text;
  let from = rung.from;
  let to = rung.to;
  if (own.length > 0) {
    try {
      const folded = rejectMarks(text, own.map((mark) => mark.id));
      before = applyChanges(text, folded);
      from = mapped(folded, rung.from);
      to = mapped(folded, rung.to);
    } catch (error) {
      if (error instanceof EditError) return undefined;
      throw error;
    }
  }
  const eol = eolOf(text, parsed.ledgerRange);
  const old = before.slice(from, to);
  const held = idsHeld(parse(before), from, to);
  const ledger = workingLedger(parse(before).ledger);
  const id = newId(idsIn(before), ctx.random);
  addPerson(ledger, ctx.author);
  const entry: MarkEntry = { by: ctx.author.handle, at: ctx.time };
  if (ctx.group !== undefined) entry.group = ctx.group;
  if (ctx.note !== undefined) entry.note = ctx.note;
  ledger.marks[id] = entry;
  const next = before.slice(to);
  // A block that is atomic, or a table, stands in the form of rule 9: where a blank line follows at
  // the top level, the closer stands in it and the payload ends with the block's line break.
  const atomic = rung.atomic || rung.kind === 'table';
  const blankAfter = atomic && rung.prefix === '' && /^\r?\n\r?\n[ \t]*\S/.test(next) && !/^\r?\n\r?\n<!-- redlines/.test(next);
  const payload = blankAfter ? `${old}\n` : old;
  const opener = `<!--sub ${id} ${encodePayload(payload)}-->`;
  const closer = `<!--/${id}-->`;
  const lead = scaffold(rung.prefix, eol, rung.tight);
  const body = now.replaceAll('\r\n', '\n').replaceAll('\n', eol);
  let written: string;
  let end = to;
  if (atomic) {
    const line = `${continuationPrefix(rung.prefix)}${closer}`;
    written = `${opener}${lead}${body}${eol}${line}${blankAfter ? eol : ''}`;
    if (blankAfter) end = to + (next.startsWith('\r\n') ? 2 : 1);
  } else {
    written = `${opener}${lead}${body}${closer}`;
  }
  const result = applyChanges(before, [{ from, to: end, insert: written }]);
  const done = withLedger(result, ledger);
  if (!done) return undefined;
  if (!passes(text, parsed, done, intended, id)) return undefined;
  return {
    changes: changesBetween(text, done),
    text: done,
    id,
    unit: { kind: rung.kind, rung: index, from: rung.from, to: rung.to, blocks },
    held,
  };
}

/** The ids of the marks of `parsed` that start inside `[from, to)`. */
function idsHeld(parsed: Parsed, from: number, to: number): string[] {
  return parsed.marks
    .filter((mark) => touches(mark, { from, to }))
    .map((mark) => mark.id);
}

/** The text with the ledger written for its body; undefined where it can't be written. */
function withLedger(body: string, ledger: ReturnType<typeof workingLedger>): string | undefined {
  try {
    return applyChanges(body, setLedger(body, normalizeLedger(body, ledger)));
  } catch (error) {
    if (error instanceof EditError) return undefined;
    throw error;
  }
}

/**
 * The gate of a rung (format §3.12): the file with the replacement pending reads the newest text as
 * intended and the original text as it was, the replacement and the marks in its old text are all
 * read, and no marker starts a line that did not.
 */
function passes(
  text: string,
  before: Parsed,
  after: string,
  intended: string,
  id: string,
): boolean {
  const read = parse(after);
  if (!read.marks.some((mark) => mark.id === id && mark.kind === 'sub')) return false;
  const grew = (code: string) =>
    read.warnings.filter((w) => w.code === code).length >
    before.warnings.filter((w) => w.code === code).length;
  if (['line-start-marker', 'payload-mark', 'unclosed-mark', 'unopened-close', 'kind-mismatch', 'duplicate-id', 'missing-entry', 'orphan-entry', 'orphan-thread'].some(grew)) {
    return false;
  }
  if (paragraphBreaks(newestView(after).text) !== paragraphBreaks(intended)) return false;
  return paragraphBreaks(originalView(after).text) === paragraphBreaks(originalView(text).text);
}
