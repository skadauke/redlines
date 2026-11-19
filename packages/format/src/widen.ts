// Widening an edit (format §3.12). An edit that can't be written as marks at the grain it was made,
// so that every order of decisions reads alike, is written as one substitution of the smallest unit
// that holds it: the unit as the old text, the unit as it reads with the edit made as the new text.
// Other people's pending changes in the unit stay in the old text, as the marks they are, in the
// payload's encoding; your own fold into the replacement, as rejecting them would leave the unit.
//
// Nothing calls this yet: the writers that refuse today will call it in their turn. It is the one
// writer all of them share: they differ in why the fine form failed, not in what to write.

import { isPandoc, withDialect } from './dialect.ts';
import {
  INCLUDE_LINE,
  scaffold,
  continuationPrefix,
  bodyStart,
  lineEnd,
  lineStart,
} from './blocks.ts';
import { micromark } from 'micromark';
import {
  gfmAutolinkLiteral,
  gfmAutolinkLiteralHtml,
} from 'micromark-extension-gfm-autolink-literal';
import { gfmStrikethrough, gfmStrikethroughHtml } from 'micromark-extension-gfm-strikethrough';
import { gfmTable, gfmTableHtml } from 'micromark-extension-gfm-table';
import { gfmTaskListItem, gfmTaskListItemHtml } from 'micromark-extension-gfm-task-list-item';
import { applyChanges, eolOf } from './changes.ts';
import { accept, isDecidable, reject, rejectMarks } from './decide.ts';
import { addPerson, changesBetween, paragraphBreaks, workingLedger } from './edit-support.ts';
import { EditError } from './errors.ts';
import { idsIn, newId } from './ids.ts';
import { normalizeLedger } from './ledger-order.ts';
import { setLedger } from './ledger-write.ts';
import { parse } from './parse.ts';
import { intact, ledgerFor, payloadFile, payloadIdsOf, payloadOfFile } from './payload-marks.ts';
import { decodePayload, encodePayload } from './payload.ts';
import { shapeOf, unitsOf } from './widen-units.ts';
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
  /** The ids of other people's pending changes that end at the unit's edge without being in its old
   * text (a split's break right in front of it, an insertion right after it): they are decided
   * with the block next to them, and the replacement does not read alike in every order of
   * decisions with them (#107), so a widened edit keeps its refusal (#808). */
  touchingOthers: string[];
  /** The ids of the author's own pending changes in the unit, which folded into the replacement:
   * its old text has them rejected. */
  folded: string[];
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
  /** Where another person's mark ends at the unit's edge, the unit with the block beside it, which
   * holds the mark whole, is tried before the unit is given with the mark left out (#265). */
  beside = false,
): Widened {
  const done = withDialect(ctx.dialect, () => widenIn(text, edits, ctx, beside));
  heard.push(done.unit);
  // What nobody took in this turn of the event loop was a try that was not written: it is dropped.
  if (heard.length === 1) queueMicrotask(() => (heard.length = 0));
  return done;
}

/** The units `widen` wrote since the last `drainWidenings`, in this turn of the event loop. */
const heard: WidenedUnit[] = [];

/**
 * The units that edits were widened to since the last call, for the editor to say so (#1188): the
 * writer that makes a transaction takes them as it records the edit. Only what `widen` wrote in
 * this turn of the event loop is there, so that a try made long ago is not told as an edit's.
 */
export function drainWidenings(): WidenedUnit[] {
  return heard.splice(0, heard.length);
}

function widenIn(
  text: string,
  edits: readonly TextChange[],
  ctx: EditContext,
  beside: boolean,
): Widened {
  const parsed = parse(text);
  const view = newestView(text);
  const sorted = edits.toSorted((a, b) => a.from - b.from || a.to - b.to);
  const first = sorted[0];
  const last = sorted.at(-1);
  if (!first || !last) throw new Untrackable('no-unit', 'There is no edit to write.');
  const spanFrom = first.from;
  const spanTo = Math.max(...sorted.map((edit) => edit.to));
  let sourceFrom = view.map.toSource(spanFrom, 1);
  // The end of the body, a point that the newest view's last line break stands at: the point is the
  // one before the ledger, not the ledger's end (an item with no text, last in the file).
  if (
    spanFrom === spanTo &&
    parsed.ledgerRange &&
    sourceFrom > parsed.ledgerRange.from &&
    // Only an item that has no text: the line up to the point is markers alone (a table's cell or
    // a paragraph at the end of the file keeps what it did).
    /^[ \t>]*(?:(?:[-+*]|\d{1,9}[.)])[ \t]*)+$/.test(
      text
        .slice(text.lastIndexOf('\n', sourceFrom - 1) + 1, sourceFrom)
        .replace(/<!--[^]*?-->/g, ''),
    ) &&
    // An opening fence that nothing closes is the code lane's, which keeps its refusal.
    !sorted.some((edit) => /^[ \t]*(?:`{3,}|~{3,})/.test(edit.insert))
  ) {
    sourceFrom = Math.min(sourceFrom, view.map.toSource(spanFrom, -1));
  }
  // The end of the body right after a deletion that rejecting would leave a bare marker behind: the
  // point is before the deletion, as it is for an item with no text (#1104).
  if (
    spanFrom === spanTo &&
    parsed.ledgerRange &&
    sourceFrom > parsed.ledgerRange.from &&
    afterBareDeletion(text, parsed.ledgerRange.from)
  ) {
    sourceFrom = Math.min(sourceFrom, view.map.toSource(spanFrom, -1));
  }
  const sourceTo = Math.max(sourceFrom, view.map.toSource(spanTo, -1));
  if (
    sourceFrom < bodyStart(text) ||
    (parsed.ledgerRange && sourceFrom > parsed.ledgerRange.from)
  ) {
    throw new Untrackable('front-matter', "Front matter can't be marked as a change.");
  }
  const intended = applyChanges(view.text, sorted);
  const region = replacementText(parsed, text, sourceFrom, sourceTo);
  const units = unitsOf(text, parsed, region);
  const others = (range: Range) => othersIn(parsed, range, ctx);
  const id = newId(idsIn(text), ctx.random);
  let rung = rungOf(units, sourceFrom, sourceTo);
  // Where no unit of its own holds the edit, the unit and the block after it are replaced together.
  let fromSpare = false;
  const boundary =
    rung !== undefined &&
    (atBlockBoundary(text, edits) ||
      // Indented code started in an empty line (the edits are in the newest view's places, and the
      // file's are those of the block's start).
      (sorted.some((edit) => /^(?: {4}|\t)/.test(edit.insert)) &&
        atBlockBoundary(
          text,
          sorted.map((edit) => ({
            ...edit,
            from: view.map.toSource(edit.from, 1),
            to: Math.max(view.map.toSource(edit.from, 1), view.map.toSource(edit.to, -1)),
          })),
        ))) &&
    !(rung.parent && rung.kind === 'code');
  const spares: Rung[] = [];
  if (rung && boundary) {
    const spare = withNext(units, rung);
    if (spare) spares.push(spare);
  }
  // The opener of a replacement that starts right under a bare marker's line is read as that item's
  // text by the shape check (a mark stands right behind a bare marker): the block before goes with it.
  if (rung && boundary && endsInBare(lineBefore(text, rung.lineFrom))) {
    const [only] = rung.units;
    const siblings = rung.parent ? rung.parent.children : units;
    const at = only ? siblings.indexOf(only) : -1;
    const before = siblings[at - 1];
    const after = siblings[at + 1];
    if (only && rung.units.length === 1 && before && at > 0) {
      spares.push(rungOfUnits(after ? [before, only, after] : [before, only], rung.parent));
    }
  }
  // A unit that closure brought back to one already tried would go up and down for ever.
  const tried = new Set<string>();
  // The first write that another person's mark touches at the edge, kept if no wider unit holds it.
  let touching: Widened | undefined;
  const besides: Rung[] = [];
  let besideTried = false;
  for (let index = 0; rung; index++) {
    const closed = closure(parsed, units, rung, sourceFrom, sourceTo, region);
    // A quote in an item and the blocks in it span the same text: each is tried, as the blocks
    // can't be written where the quote starts on the item's marker line (#107).
    const inItem = closed.kind === 'quote' && closed.parent?.kind === 'item';
    const key = `${closed.lineFrom}:${closed.to}${ofOneParagraph(closed) ? ':list' : ''}${inItem ? ':quote' : ''}`;
    if (tried.has(key)) {
      rung = widerThan(rung);
      continue;
    }
    tried.add(key);
    const blocks = topLevelBlocks(units, closed);
    if (blocks > WIDEN_MOST_BLOCKS) {
      throw new Untrackable(
        'too-large',
        `This change would replace ${blocks} blocks.`,
        blocks,
        others({ from: closed.lineFrom, to: closed.to }),
      );
    }
    const done = tryRung(
      text,
      parsed,
      view,
      intended,
      sorted,
      closed,
      ctx,
      id,
      index,
      blocks,
      region,
    );
    // The unit with the block after it is kept only where micromark reads its file as the newest
    // view (the check of the oracle's reader), else the ladder ends in an alert.
    // A fence in the unit is read too where an edit starts in a line's indentation: one that leaves
    // the fence open (a line of its code less deep than its item) makes the closer a line of the
    // code, where the newest view reads the text otherwise. A keystroke in code costs what it did.
    const fenced =
      /^[ \t>]*(?:`{3,}|~{3,})/m.test(text.slice(closed.lineFrom, closed.to)) &&
      sorted.some((edit) => /^[ \t>]*$/.test(text.slice(lineStart(text, edit.from), edit.from)));
    // A line break typed in a unit that holds code is read too: the text after it may stand less deep
    // than the container, and the blocks after the unit read otherwise beside the closer (#586).
    const broken =
      sorted.some(
        (edit) => edit.insert.includes('\n') || text.slice(edit.from, edit.to).includes('\n'),
      ) && /^(?: {4,}|\t)\S|^[ \t>]*(?:`{3,}|~{3,})/m.test(text.slice(closed.lineFrom, closed.to));
    const kept =
      done && !((fromSpare || fenced || broken) && readsOtherMicromark(text, done.changes))
        ? done
        : undefined;
    if (kept && (!beside || kept.touchingOthers.length === 0)) return kept;
    if (
      beside &&
      !besideTried &&
      (kept
        ? kept.touchingOthers.length > 0
        : parsed.marks.some(
            (mark) =>
              mark.entry.by !== ctx.author.handle &&
              touches(mark, edgeOf(text, closed.lineFrom, closed.to)),
          ))
    ) {
      // A rung that another person's mark touches at its edge, or that its decisions with the mark
      // do not read alike for (#107), is tried with the block beside it, which holds the mark.
      besideTried = true;
      for (const next of [withNext(units, rung), withPrev(units, rung)]) {
        if (next) besides.push(next);
      }
    }
    touching ??= kept;
    const next = besides.shift();
    if (next) {
      rung = next;
      fromSpare = false;
      continue;
    }
    const wider = widerThan(closed);
    const spare = wider ? undefined : spares.shift();
    if (wider) spares.length = 0;
    fromSpare = spare !== undefined;
    rung = wider ?? spare;
  }
  if (touching) return touching;
  trace?.('ladder-end');
  throw new Untrackable(
    'no-unit',
    'No unit can hold this change.',
    undefined,
    others({ from: sourceFrom, to: sourceTo }),
  );
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
/** A unit with the one after it: the rung that holds both, for an edit that falls in the gap between
 * them (a line break typed after a bare marker, #588) or code that a list line follows (#601). */
function withNext(units: Unit[], rung: Rung): Rung | undefined {
  const [only] = rung.units;
  if (rung.units.length !== 1 || !only) return undefined;
  const siblings = rung.parent ? rung.parent.children : units;
  const at = siblings.indexOf(only);
  const next = siblings[at + 1];
  return at < 0 || !next ? undefined : rungOfUnits([only, next], rung.parent);
}

/** A unit with the one before it (see `withNext`). */
function withPrev(units: Unit[], rung: Rung): Rung | undefined {
  const [only] = rung.units;
  if (rung.units.length !== 1 || !only) return undefined;
  const siblings = rung.parent ? rung.parent.children : units;
  const at = siblings.indexOf(only);
  const previous = siblings[at - 1];
  return at < 1 || !previous ? undefined : rungOfUnits([previous, only], rung.parent);
}

function widerThan(rung: Rung): Rung | undefined {
  const parent = rung.parent;
  return parent ? rungOfUnits([parent], parent.parent) : undefined;
}

/**
 * The new text of the innermost substitution that holds the edit, where the edit is typed in text
 * that someone else's replacement wrote: the unit is found in that text, and written inside the
 * replacement (format §3.12, "Editing it"). Only where the new text starts a line, at the top.
 */
function replacementText(
  parsed: Parsed,
  text: string,
  from: number,
  to: number,
): Range | undefined {
  let found: Range | undefined;
  for (const mark of parsed.marks) {
    if (mark.kind !== 'sub') continue;
    for (const segment of mark.segments) {
      if (!segment.close) continue;
      const start = segment.carrier?.to ?? segment.content.from;
      const end = segment.content.to;
      if (start > from || to > end) continue;
      if (start !== 0 && text[start - 1] !== '\n') continue;
      if (!found || start >= found.from) found = { from: start, to: end };
    }
  }
  return found;
}

/** Whether the text of a mark holds all of `region`: the mark is around it, not in it. */
function encloses(mark: MarkRange, region: Range | undefined): boolean {
  return (
    region !== undefined &&
    mark.segments.some(
      (segment) =>
        segment.close !== undefined &&
        segment.content.from <= region.from &&
        region.to <= segment.content.to,
    )
  );
}

/**
 * The unit's range with what lies beside it that carries no text: the line breaks, white space and
 * quote marks between it and the next text on either side, so that a mark in the paragraph before
 * a quote's blank line (`>`) touches the unit as it does across a blank line (#107).
 */
function edgeOf(text: string, from: number, to: number): Range {
  let a = from;
  while (a > 0 && /[ \t>\r\n]/.test(text[a - 1] ?? '')) a--;
  let b = to;
  while (b < text.length && /[ \t>\r\n]/.test(text[b] ?? '')) b++;
  return { from: Math.min(a, from - 2), to: Math.max(b, to + 2) };
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
    to: Math.max(
      ...mark.segments.map((segment) => (segment.close ?? segment.carrier ?? segment.open).to),
    ),
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
  region: Range | undefined,
): Rung {
  let rung = start;
  for (let round = 0; round <= parsed.marks.length; round++) {
    let from = Math.min(rung.lineFrom, spanFrom);
    let to = Math.max(rung.to, spanTo);
    let grew = false;
    for (const mark of parsed.marks) {
      if (!touches(mark, { from: rung.lineFrom, to: rung.to })) continue;
      if (encloses(mark, region)) continue;
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

function tryRung(
  text: string,
  parsed: Parsed,
  view: ReturnType<typeof newestView>,
  intended: string,
  edits: readonly TextChange[],
  rung: Rung,
  ctx: EditContext,
  id: string,
  index: number,
  blocks: number,
  region: Range | undefined,
): Widened | undefined {
  // The new text: the unit as the newest view has it, with the edits made.
  const viewFrom = view.map.fromSource(rung.from);
  let viewTo = view.map.fromSource(rung.to);
  // A unit that ends the body, whose last mark is another person's format change spelled in the view
  // with a delimiter of its own (`_f_` as `*f*`): the map ends the unit in front of that delimiter,
  // and the new text would lose it (#1136). The unit then runs to the end of the view's text.
  const bodyEnd = parsed.ledgerRange?.from ?? text.length;
  if (text.slice(rung.to, bodyEnd).trim() === '') {
    viewTo = Math.max(viewTo, view.text.replace(/\s+$/, '').length);
  }
  if (edits.some((edit) => edit.from < viewFrom || edit.to > viewTo)) return giveUp('span');
  let now = applyChanges(
    view.text.slice(viewFrom, viewTo),
    edits.map((edit) => ({ ...edit, from: edit.from - viewFrom, to: edit.to - viewFrom })),
  );
  // Nothing left of the unit is a deletion of it, not a replacement.
  if (now.trim() === '') return giveUp('empty');
  const range = { from: rung.lineFrom, to: rung.to };
  // The new text is one unit of the kind the old one was: an edit that makes an item two, or takes
  // a block of it out of its container, is a change of the unit around it.
  if (!sameFrame(rung.kind, rung.prefix, now, ofOneParagraph(rung))) return giveUp('frame');
  // Your own pending changes in the unit fold into the replacement: they are rejected in its old
  // text, as they would be by rejecting them, and their text is in the new text.
  const own = parsed.marks.filter(
    (mark) =>
      mark.entry.by === ctx.author.handle &&
      mark.kind !== 'cmt' &&
      mark.kind !== 'hl' &&
      isDecidable(mark) &&
      touches(mark, range) &&
      !encloses(mark, region),
  );
  const from = rung.from;
  const to = rung.to;
  let old = text.slice(from, to);
  if (own.length > 0) {
    // The unit holds its marks whole, so they are decided in it as a file of its own, with the
    // prefix of its first line (format §3.12, the same way a mark in an old text is decided).
    try {
      const inside = parsed.marks.filter((mark) => touches(mark, range));
      const ids = new Set(inside.flatMap((mark) => [mark.id, ...payloadIdsOf(parsed, mark)]));
      const proxy = payloadFile(text.slice(rung.lineFrom, to), ledgerFor(parsed, ids));
      if (!intact(proxy, text.slice(rung.lineFrom, to))) return giveUp('fold: unclosed');
      const made = applyChanges(
        proxy,
        rejectMarks(
          proxy,
          own.map((mark) => mark.id),
        ),
      );
      const folded = payloadOfFile(made, parse(made));
      if (!folded.startsWith(rung.prefix)) return giveUp('fold prefix');
      old = folded.slice(rung.prefix.length);
    } catch (error) {
      if (error instanceof EditError) return giveUp(`fold: ${error.message.slice(0, 60)}`);
      throw error;
    }
  }
  const before = text;
  const eol = eolOf(text, parsed.ledgerRange);
  const ledger = workingLedger(parsed.ledger);
  addPerson(ledger, ctx.author);
  const entry: MarkEntry = { by: ctx.author.handle, at: ctx.time };
  if (ctx.group !== undefined) entry.group = ctx.group;
  if (ctx.note !== undefined) entry.note = ctx.note;
  ledger.marks[id] = entry;
  const next = before.slice(to);
  // A block that is atomic, or a table, stands in the form of rule 9: where a blank line follows at
  // the top level, the closer stands in it and the payload ends with the block's line break.
  // A closer on a line of its own inside an item reads as a block of the item, which no marker may be:
  // a text that needs one there (it ends in a delimiter) goes to a unit that is not in a container.
  // A new text that ends in one line break (an Enter typed at the end of the unit) keeps the
  // break after the closer, as a plain line break: the closer then ends the line before it.
  const trail =
    rung.prefix !== '' && !rung.atomic && !endsInDelimiter(now) && !riskyEnd(now, rung.prefix)
      ? (/(?<![\r\n])\r?\n$/.exec(now)?.[0] ?? '')
      : '';
  if (trail !== '' && now.slice(0, now.length - trail.length).trim() !== '') {
    now = now.slice(0, now.length - trail.length);
  } else if (
    rung.prefix !== '' &&
    !rung.atomic &&
    (endsInDelimiter(now) || riskyEnd(now, rung.prefix) || /\n[ \t>]*$/.test(now))
  ) {
    return giveUp('delimiter');
  }
  // An HTML block goes on over the line after it, a closer included: the closer stands after a blank
  // line, where it is an HTML block of its own (#597).
  const html = HTML_LINE.test(lastLineOf(now, rung.prefix));
  // (a setext underline or a rule is a line of its own, which the closer cannot join)
  const bare =
    endsInBare(now) && !/(?:^|\n)[ \t>]*(?:[-*+][ \t]+)*(?:-{2,}|={2,})[ \t]*$/.test(now);
  // (a table that is deleted leaves the lines after it, the HTML block that was its next line, which
  // is a block of its own once the table is gone: no table's closer is then in its way)
  const tableLeft = rung.kind === 'table' && now.includes('|');
  if (html && (rung.prefix !== '' || tableLeft)) return giveUp('html');
  const atomic =
    html ||
    rung.atomic ||
    rung.kind === 'table' ||
    endsInFence(old) ||
    endsInFence(now) ||
    endsInBare(now) ||
    endsInDelimiter(now) ||
    riskyEnd(now, rung.prefix);
  const blankAfter =
    atomic &&
    rung.prefix === '' &&
    /^\r?\n\r?\n[ \t]*\S/.test(next) &&
    !/^\r?\n\r?\n<!-- redlines/.test(next);
  // An indented line after the blank line goes on the indented code that the unit ends in: the closer
  // standing in the blank line would cut that block in two.
  if (blankAfter && /(?:^|\n)( {4}|\t)[^\n]*$/.test(now) && /^\r?\n\r?\n( {4}|\t)/.test(next)) {
    return giveUp('code goes on');
  }
  const payload = blankAfter ? `${old}${eol}` : old;
  const opener = `<!--sub ${id} ${encodePayload(payload, eol)}-->`;
  const closer = `<!--/${id}-->`;
  // The lines before and after the unit stand in its container, whose tightness is the item's: a
  // list's own tightness (it holds a blank line) says nothing of the blank line before it.
  const tight = rung.kind === 'list' && rung.parent ? rung.parent.tight : rung.tight;
  const lead = scaffold(rung.prefix, eol, tight);
  const body = now.replaceAll('\r\n', '\n').replaceAll('\n', eol);
  // Where a blank line follows the unit already, the break it would write is that blank line.
  const trailBreak = /^\r?\n[ \t>]*\r?\n/.test(next)
    ? ''
    : trail.replaceAll('\r\n', '\n').replaceAll('\n', eol);
  let written: string;
  let end = to;
  if (atomic) {
    const line = `${continuationPrefix(rung.prefix)}${closer}`;
    written = `${opener}${lead}${body}${html || (bare && rung.prefix === '') ? eol : ''}${eol}${line}`;
    if (blankAfter) end = to + eol.length;
  } else {
    written = `${opener}${lead}${body}${closer}${trailBreak}`;
  }
  const result = applyChanges(before, [{ from, to: end, insert: written }]);
  const done = withLedger(result, ledger);
  if (!done) return giveUp('ledger');
  if (!passes(text, parsed, done, intended, id)) return undefined;
  const read = parse(done);
  const holder = read.marks.find((mark) => mark.id === id);
  const held = holder ? payloadIdsOf(read, holder) : [];
  return {
    changes: changesBetween(text, done),
    text: done,
    id,
    unit: { kind: rung.kind, rung: index, from: rung.from, to: rung.to, blocks },
    held,
    // Another person's mark that ends at the unit's edge (a split's break right in front of it, an
    // insertion right after it) is decided with the block next to it: the replacement would read
    // differently in some order (#107).
    touchingOthers: parsed.marks
      .filter(
        (mark) =>
          mark.entry.by !== ctx.author.handle &&
          !held.includes(mark.id) &&
          // A change that holds the unit in its new text is no neighbour: the unit is written
          // inside it (format §3.12).
          !encloses(mark, { from: rung.from, to: rung.to }) &&
          touches(mark, edgeOf(text, rung.lineFrom, rung.to)),
      )
      .map((mark) => mark.id),
    folded: own.map((mark) => mark.id),
  };
}

/** Whether the new text of a unit makes one unit of its kind after the prefix of the old: an item
 * stays one item, a list stays a list, a block of text stays one block. An edit that makes an item
 * two, or takes its text out of the list, belongs to the unit around it. */
function sameFrame(kind: UnitKind, prefix: string, now: string, single = false): boolean {
  // Code in a container that an edit makes text of is no code: its closer, on a line of its own,
  // would end a paragraph that the closer is no part of, so the unit around it takes it.
  if (kind === 'code' && /^ +$/.test(prefix)) {
    // A line of the text that stands less deep than its item leaves the item, and its code.
    return now
      .split(/\r?\n/)
      .slice(1)
      .every((line) => line.trim() === '' || line.startsWith(prefix));
  }
  if (kind !== 'item' && kind !== 'list') return true;
  const source = `${prefix}${now}`;
  const units = unitsOf(source, parse(source));
  // The prefix may hold quote markers: look inside them for the list.
  let top: readonly Unit[] = units;
  while (top.length === 1 && top[0]?.kind === 'quote') top = top[0].children;
  const [only] = top;
  // A list at the top of the document may turn into several blocks: nothing around it holds them.
  if (single && top.length > 1 && top.every((unit) => unit.kind === 'list')) return true;
  if (top.length !== 1 || only?.kind !== 'list') return false;
  return kind === 'list' || only.children.length === 1;
}

/** Whether a rung is a list at the top of the document with one item that holds one paragraph: the
 * same range as the paragraph's and the item's, which may turn into several lists (#1104). */
function ofOneParagraph(rung: Rung): boolean {
  const [list] = rung.units;
  const [item] = list?.children ?? [];
  const [text] = item?.children ?? [];
  return (
    rung.kind === 'list' &&
    rung.prefix === '' &&
    rung.units.length === 1 &&
    list?.children.length === 1 &&
    item?.children.length === 1 &&
    text?.children.length === 0
  );
}

/** The line before the one that starts at `at`, without the markers of changes in it. */
function lineBefore(text: string, at: number): string {
  if (at <= 0) return '';
  const from = lineStart(text, at - 1);
  const end = text[at - 2] === '\r' ? at - 2 : at - 1;
  return text.slice(from, end).replace(/<!--[^]*?-->/g, '');
}

/** Whether the last line of a text closes a fenced block: a closer written after it would be read
 * as part of the fence's line, so it stands alone on the line after (format §3.5). */
function endsInFence(text: string): boolean {
  return /(?:^|\n)[ \t>]*(?:`{3,}|~{3,})[ \t]*$/.test(text);
}

/** Whether the last line of a text is a bare list marker (`-` or `1.` alone, after its quote and
 * list markers): no mark stands right behind one (format §3.2). */
function endsInBare(text: string): boolean {
  return /(?:^|\n)[ \t>]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]*)+$/.test(text);
}

/** Whether a text ends in an emphasis delimiter, whose flanking looks at the character after it, or
 * in a backslash, which would escape a marker written right after it. */
function endsInDelimiter(text: string): boolean {
  return /[*_~\\]$/.test(text);
}

/** Hears why a rung was given up, for a test that asks (see `traceWidening`). */
let trace: ((why: string) => void) | undefined;

/** Asks to be told why each rung of the ladder is given up. Pass undefined to stop. */
export function traceWidening(hear: ((why: string) => void) | undefined): void {
  trace = hear;
}

/** The last lines that don't hold a marker glued to them: indented code, a setext underline, a
 * thematic break, an ATX heading (its closing `#`s), a link reference definition, a table's
 * delimiter row, an HTML block. A closer stands alone on the line after them (format §3.12). */
const RISKY_LINES = [
  /^( {4,}|\t)/,
  /^ {0,3}(?:=+|-+)[ \t]*$/,
  /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/,
  /^ {0,3}#{1,6}(?:[ \t].*)?#[ \t]*$/,
  /^ {0,3}\[[^\]]+\]:/,
  /^[ \t]*\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/,
];

/** An HTML block, which goes on over the line after it, a closer included, to a blank line. */
const HTML_LINE = /^ {0,3}<[/A-Za-z!?]/;

/** The last line of a text, without the prefix of its container (quote markers, bullets, the
 * indentation of an item's lines). */
function lastLineOf(text: string, prefix: string): string {
  const lines = text.split('\n');
  let last = lines.at(-1) ?? '';
  const inner = continuationPrefix(prefix);
  if (lines.length > 1 && inner !== '' && last.startsWith(inner)) last = last.slice(inner.length);
  return last.replace(/^(?: {0,3}(?:>|(?:[-*+]|\d{1,9}[.)])(?=[ \t]|$))[ \t]?)+/, '');
}

function riskyEnd(text: string, prefix: string): boolean {
  const line = lastLineOf(text, prefix);
  // The fence of a pandoc div: nothing but the fence may be on its line (format §3.1, rule 9).
  if (isPandoc() && /^[ \t>]*:{3,}/.test(line)) return true;
  // A Quarto include line, alone on its line, takes no marker after it either (#1087).
  if (isPandoc() && INCLUDE_LINE.test(line)) return true;
  return RISKY_LINES.some((risky) => risky.test(line));
}

function giveUp(why: string): undefined {
  trace?.(why);
  return undefined;
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
  const why = failure(text, before, after, intended, id);
  if (why) trace?.(why);
  return why === undefined;
}

function failure(
  text: string,
  before: Parsed,
  after: string,
  intended: string,
  id: string,
): string | undefined {
  const read = parse(after);
  if (!read.marks.some((mark) => mark.id === id && mark.kind === 'sub')) return 'not read';
  const grew = (code: string) =>
    read.warnings.filter((w) => w.code === code).length >
    before.warnings.filter((w) => w.code === code).length;
  const bad = [
    'line-start-marker',
    'payload-mark',
    'unclosed-mark',
    'unopened-close',
    'kind-mismatch',
    'duplicate-id',
    'missing-entry',
    'orphan-entry',
    'orphan-thread',
  ].find(grew);
  if (bad) return `warning ${bad}`;
  if (paragraphBreaks(newestView(after).text) !== paragraphBreaks(intended)) return 'newest';
  if (shapeOf(unitsOf(after, read)) !== shapeOf(unitsOf(intended, parse(intended)))) {
    return 'shape';
  }
  if (paragraphBreaks(originalView(after).text) !== paragraphBreaks(originalView(text).text)) {
    return 'original';
  }
  // Both decisions of the replacement can be made, and the new text is what it was meant to be.
  try {
    const kept = applyChanges(after, accept(after, id));
    if (paragraphBreaks(newestView(kept).text) !== paragraphBreaks(intended)) return 'accept';
    reject(after, id);
  } catch (error) {
    if (error instanceof EditError) return `decide: ${error.message.slice(0, 60)}`;
    throw error;
  }
  return undefined;
}

/** The syntax of a block's first line, up to where an edit starts. */
const SYNTAX_PREFIX =
  /^(?:#{1,6}[ \t]*|[-*+][ \t]*|\d{1,9}[.)][ \t]*|<[^\s>]*|`{3,}[^`]*|~{3,}.*|\[[^\]\n]*\]:.*)$/;
const LIST_LINE = /^[ \t>]*(?:\d{1,9}[.)]|[-*+])(?:[ \t]|$)/;

/**
 * Whether an edit is where a fine write can read otherwise in the file than in the newest view: it
 * starts inside a block's syntax (the `>` of a tag, the space of `## `, right behind a bare
 * marker), or it is in indented code with a list item close below it. Only these are read by
 * micromark (`readsOtherMicromark`), so that a keystroke elsewhere costs what it did.
 */
export function atBlockBoundary(text: string, edits: readonly TextChange[]): boolean {
  return edits.some((edit) => {
    const start = lineStart(text, edit.from);
    const prefix = text
      .slice(start, edit.from)
      .replace(/<!--[^]*?-->/g, '')
      .replace(/^[ \t]*(?:>[ \t]*)*/, '');
    // A key typed into an empty line (a block start typed into an empty paragraph or item) is the
    // typed-syntax code's, not this check's.
    const typed =
      !/^[ \t]*\[[^\]\n]*\]:/.test(prefix) &&
      edit.from === edit.to &&
      edit.insert !== '' &&
      !/[\n\t]/.test(edit.insert) &&
      /^[ \t]*(?:<!--[^]*?-->[ \t]*)*(?:\r?\n|$)/.test(text.slice(edit.from));
    if (
      !typed &&
      prefix !== '' &&
      SYNTAX_PREFIX.test(prefix) &&
      // (a link definition only where a key is typed in it, #262)
      (edit.from === edit.to || !/^\[[^\]\n]*\]:/.test(prefix)) &&
      ((edit.insert.includes('\n') && (edit.from < edit.to || !/[ \t]$/.test(prefix))) ||
        !/[ \t]$/.test(prefix))
    ) {
      return true;
    }
    // Indented code started on an empty line (a tab or four spaces first) with a list line close
    // below it: micromark reads that line as text after the code, and as an item once a comment
    // line stands between (#1104).
    const startsCode =
      /^(?: {4}|\t)/.test(edit.insert) &&
      prefix === '' &&
      /^[ \t]*(?:<!--[^]*?-->[ \t]*)*(?:\r?\n|$)/.test(text.slice(edit.to));
    // Text typed in indented code or an item's text never changes the blocks: only a line break can.
    if (!startsCode && !edit.insert.includes('\n') && edit.from === edit.to) return false;
    if (!startsCode && !/^(?: {4}|\t)/.test(text.slice(start))) return false;
    let at = lineEnd(text, edit.to);
    for (let i = 0; i < 4 && at < text.length; i++) {
      const next = lineEnd(text, at + 1);
      if (LIST_LINE.test(text.slice(at + 1, next))) return true;
      at = next;
    }
    return false;
  });
}

/**
 * Whether the text before `at` ends in pending deletions that, put back, leave its line a bare list
 * marker (`alpha<!--del k3x9 ⏎*-->`): rejecting them would put whatever is written there behind it.
 */
export function afterBareDeletion(text: string, at: number): boolean {
  const line = text.slice(lineStart(text, at), at);
  const tail = /(?:<!--del [a-z][a-z0-9]* (?:(?!-->)[^])*-->)+$/.exec(line);
  if (!tail) return false;
  let put = line.slice(0, tail.index).replace(/<!--[^]*?-->/g, '');
  for (const found of tail[0].matchAll(/<!--del [a-z][a-z0-9]* ((?:(?!-->)[^])*)-->/g)) {
    put += decodePayload(found[1] ?? '');
  }
  return /(?:^|\n)[ \t>]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]*)*(?:[-*+]|\d{1,9}[.)])$/.test(put);
}

/**
 * Whether an edit is made at an emphasis delimiter in a paragraph that holds a marker: it replaces
 * or deletes a `*`, `_` or `~`, types one, or sits right against one (a marker between them does not
 * part them). A fine write there can leave the delimiter run cut by a marker, which micromark reads
 * otherwise than the newest view (#299, #265). Only these are read by micromark, so that a
 * keystroke elsewhere costs what it did.
 */
export function atDelimiter(text: string, edits: readonly TextChange[]): boolean {
  const DELIMITER = /[*_~]/;
  return edits.some((edit) => {
    let from = text.lastIndexOf('\n\n', Math.max(0, edit.from - 1));
    from = from < 0 ? 0 : from;
    let to = text.indexOf('\n\n', edit.to);
    to = to < 0 ? text.length : to;
    const paragraph = text.slice(from, to);
    // A marker in the paragraph, or just over its edge (a split's break, a deletion of one).
    const near = text.slice(Math.max(0, edit.from - 100), edit.to + 100);
    if (!paragraph.includes('<!--') && !/<!--(?:split|del)/.test(near)) return false;
    if (DELIMITER.test(edit.insert) || DELIMITER.test(text.slice(edit.from, edit.to))) return true;
    const before = text.slice(from, edit.from).replace(/<!--[^]*?-->/g, '');
    const after = text.slice(edit.to, to).replace(/<!--[^]*?-->/g, '');
    return DELIMITER.test(before.slice(-1)) || DELIMITER.test(after.slice(0, 1));
  });
}

/**
 * Whether an edit that types or touches a delimiter run stands right against a pending split or
 * deletion (a block break, a word): deciding it reads the run in another place than the file shows
 * it, which only the replacement of the blocks that hold it keeps alike (#265). Not gated by
 * micromark's reading of the file as written: it reads alike as written, and not after the break
 * is decided.
 */
export function delimiterBesideBreak(text: string, edits: readonly TextChange[]): boolean {
  const DELIMITER = /[*_~]/;
  return edits.some((edit) => {
    const before = text.slice(Math.max(0, edit.from - 400), edit.from);
    const after = text.slice(edit.to, edit.to + 40);
    const beside =
      /<!--(?:split|del) [^>]*-->\s*$/.test(before) || /^\s*<!--(?:split|del) /.test(after);
    if (!beside) return false;
    const around = `${before.replace(/<!--[^]*?-->/g, '').slice(-1)}${after.replace(/<!--[^]*?-->/g, '').slice(0, 1)}`;
    return (
      DELIMITER.test(edit.insert) ||
      DELIMITER.test(text.slice(edit.from, edit.to)) ||
      DELIMITER.test(around)
    );
  });
}

/** Where each change of `changes` ends up in the text they make: the stretch they touch there. */
function changedStretch(
  changes: readonly TextChange[],
  limit: number,
): { from: number; to: number } | undefined {
  let delta = 0;
  let from = Infinity;
  let to = -Infinity;
  for (const change of changes.toSorted((a, b) => a.from - b.from || a.to - b.to)) {
    // (the ledger is no text of the file's body)
    if (change.from + delta < limit) {
      from = Math.min(from, change.from + delta);
      to = Math.max(to, change.from + delta + change.insert.length);
    }
    delta += change.insert.length - (change.to - change.from);
  }
  return from === Infinity ? undefined : { from, to };
}

/** Raw HTML that goes on past a blank line: a tag of raw text, a processing instruction, a declaration. */
const RAW_HTML = /<(?:pre|script|style|textarea)\b|<\?|<![A-Za-z[]/i;

/**
 * Whether text above a stretch can leave a block open in it: a fence that isn't plainly one (not
 * at the start of a line, or of the other kind, or not closed), raw HTML, or a comment that
 * isn't closed.
 */
function opensBlock(above: string): boolean {
  const fences = above.match(/^.*(?:`{3,}|~{3,}).*$/gm) ?? [];
  if (fences.length % 2 === 1) return true;
  let kind = '';
  for (const line of fences) {
    const plain = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (!plain) return true;
    if (kind && kind !== plain[1]![0]) return true;
    kind = plain[1]![0]!;
  }
  return RAW_HTML.test(above) || above.split('<!--').length !== above.split('-->').length;
}

/**
 * The paragraphs the changes are in, between blank lines, of `body` (the file without its ledger),
 * where reading them alone reads them as the file does: no fence or raw HTML open above or in them,
 * no mark across their edges, no CRLF; undefined where it is not so.
 */
function stretchOf(
  body: string,
  parsed: Parsed,
  changes: readonly TextChange[],
): string | undefined {
  const stretch = changedStretch(changes, body.length);
  if (!stretch || stretch.to > body.length || body.length <= 2000 || body.includes('\r')) {
    return undefined;
  }
  const lastBreak = body.lastIndexOf('\n\n', Math.max(0, stretch.from - 1));
  const nextBreak = body.indexOf('\n\n', stretch.to);
  const from = lastBreak < 0 ? 0 : lastBreak + 2;
  const to = nextBreak < 0 ? body.length : nextBreak;
  const here = body.slice(from, to);
  if (opensBlock(body.slice(0, from)) || opensBlock(here)) return undefined;
  // A mark that runs across a blank line is cut in two by the stretch.
  const across = (at: number) =>
    parsed.marks.some((mark) =>
      mark.segments.some(
        (segment) => segment.open.from < at && (segment.close?.to ?? Infinity) > at,
      ),
    );
  return across(from) || across(to) ? undefined : here;
}

/** The HTML that micromark, with GFM, reads `source` as, with comments and white space folded. */
function readHtml(source: string): string {
  return micromark(source, {
    allowDangerousHtml: true,
    extensions: [gfmAutolinkLiteral(), gfmStrikethrough(), gfmTable(), gfmTaskListItem()],
    htmlExtensions: [
      gfmAutolinkLiteralHtml(),
      gfmStrikethroughHtml(),
      gfmTableHtml(),
      gfmTaskListItemHtml(),
    ],
  })
    .replace(/<!--[^]*?-->/g, '')
    .replace(/\s+/g, ' ')
    .replace(/ ?(<[^>]*>) ?/g, '$1')
    .trim();
}

/** The most marks in a paragraph that are decided in every order, and the most states read; over
 * either the unit is replaced, which is safe (#265). */
const MOST_NEAR_MARKS = 4;
const MOST_STATES = 100;

/**
 * Whether the marks of the paragraphs from `first` to `last` of `file` (four at most) give another
 * text in one order of deciding them than in another, each decision the same: a change that is
 * written with its block breaks as syntax (a deletion of a paragraph, an insertion of one) leaves a
 * blank line behind in some orders and not in others (#1136). Each state is read exactly, not by
 * micromark; the file is cut to the stretch with the ledger after it.
 */
export function ordersDifferNear(file: string, first: number, last: number): boolean {
  const parsed = parse(file);
  const end = parsed.ledgerRange?.from ?? file.length;
  const from = Math.max(0, file.lastIndexOf('\n\n', Math.max(0, first - 1)) + 2);
  const after = file.indexOf('\n\n', Math.min(last, end));
  const to = after < 0 || after > end ? end : after;
  const ids = [
    ...new Set(
      parsed.marks
        .filter(
          (mark) =>
            mark.kind !== 'cmt' &&
            mark.kind !== 'hl' &&
            mark.segments.some((g) => g.open.from >= from && (g.close?.to ?? g.open.to) <= to),
        )
        .map((mark) => mark.id),
    ),
  ];
  if (ids.length === 0 || ids.length > 4) return false;
  const orders = (list: string[]): string[][] =>
    list.length <= 1
      ? [list]
      : list.flatMap((id, i) =>
          orders([...list.slice(0, i), ...list.slice(i + 1)]).map((rest) => [id, ...rest]),
        );
  const every = orders(ids);
  for (let mask = 0; mask < 1 << ids.length; mask++) {
    const results = new Set<string>();
    for (const order of every) {
      let current = file;
      let refused = false;
      for (const id of order) {
        if (!parse(current).marks.some((mark) => mark.id === id)) continue;
        try {
          current = applyChanges(
            current,
            ((mask >> ids.indexOf(id)) & 1 ? accept : reject)(current, id),
          );
        } catch (error) {
          if (!(error instanceof EditError)) throw error;
          refused = true;
          break;
        }
      }
      if (!refused) results.add(current);
    }
    if (results.size > 1) return true;
  }
  return false;
}

/**
 * Whether `file`, a write that took in text of another person's format change, reads otherwise than
 * its newest view (micromark) in some order of deciding the marks of the paragraph or paragraphs
 * from `first` to `last`, or has more than four of them, or more states than are read, or a mark
 * that runs out of them (#265). Only that stretch is read in each state, with the ledger after it,
 * so that the cost does not grow with the file. A decision that is refused ends its order.
 */
export function ordersReadOtherwiseNear(file: string, first: number, last: number): boolean {
  const parsed = parse(file);
  const end = parsed.ledgerRange?.from ?? file.length;
  const startOf = (at: number) => {
    const before = file.lastIndexOf('\n\n', Math.max(0, at - 1));
    return before < 0 ? 0 : before + 2;
  };
  const endOf = (at: number) => {
    const after = file.indexOf('\n\n', Math.min(at, end));
    return after < 0 || after > end ? end : after;
  };
  let from = startOf(first);
  let to = endOf(last);
  // A mark that runs out of the paragraphs takes the paragraphs it spans in, a few times over; past
  // that the unit is replaced.
  let ids = new Set<string>();
  for (let round = 0; ; round++) {
    ids = new Set<string>();
    let grown = false;
    for (const mark of parsed.marks) {
      if (mark.kind === 'cmt' || mark.kind === 'hl') continue;
      for (const segment of mark.segments) {
        const stop = segment.close?.to ?? segment.open.to;
        const inside = segment.open.from >= from && stop <= to;
        const touches = segment.open.to > from && segment.open.from < to;
        if (touches && !inside) {
          from = Math.min(from, startOf(segment.open.from));
          to = Math.max(to, endOf(stop));
          grown = true;
        } else if (inside) ids.add(mark.id);
      }
    }
    if (!grown) break;
    if (round >= 3) return true;
  }
  if (ids.size > MOST_NEAR_MARKS) return true;
  // The ledger only: the body after the stretch holds no mark that a decision here could reach.
  const tail = file.slice(end);
  const seen = new Set<string>();
  const walk = (stretch: string): boolean => {
    if (seen.has(stretch)) return true;
    seen.add(stretch);
    if (seen.size > MOST_STATES) return false;
    if (readHtml(stretch) !== readHtml(newestView(stretch).text)) return false;
    const current = stretch + tail;
    for (const mark of parse(current).marks) {
      if (!ids.has(mark.id)) continue;
      for (const decide of [accept, reject]) {
        let next: string;
        try {
          next = applyChanges(current, decide(current, mark.id));
        } catch (error) {
          if (!(error instanceof EditError)) throw error;
          continue;
        }
        // The ledger changes with a decision; the stretch is what comes before it.
        if (!walk(next.slice(0, parse(next).ledgerRange?.from ?? next.length))) return false;
      }
    }
    return true;
  };
  return !walk(file.slice(from, to));
}

/**
 * Whether micromark reads the file the changes make otherwise than its newest view. Only the
 * paragraphs the changes are in are read (`stretchOf`); otherwise, or with `whole`, the whole file,
 * which costs the size of the file: 380 ms for a key in 100 KB.
 */
export function readsOtherMicromark(
  text: string,
  changes: readonly TextChange[],
  whole = false,
): boolean {
  const file = applyChanges(text, changes);
  const parsed = parse(file);
  const ledger = parsed.ledgerRange;
  const read = readHtml;
  const body = ledger ? file.slice(0, ledger.from) : file;
  const here = whole ? undefined : stretchOf(body, parsed, changes);
  const afterRead = here ?? body;
  const afterNewest = here !== undefined ? newestView(here).text : newestView(file).text;
  if (read(afterRead) === read(afterNewest)) return false;
  // A paragraph that begins with a marker is raw HTML to micromark, and reads otherwise than its
  // newest view before the change as well (#1092). That is the file's, not the change's: the change
  // reads otherwise only if it is read in the file differently than it is in the newest view.
  const old = parse(text);
  const oldBody = old.ledgerRange ? text.slice(0, old.ledgerRange.from) : text;
  const same = changes.map((c) => ({ from: c.from, to: c.to, insert: ' '.repeat(c.to - c.from) }));
  const oldHere = here !== undefined ? stretchOf(oldBody, old, same) : undefined;
  if (here !== undefined && oldHere === undefined) return true;
  const oldRead = oldHere ?? oldBody;
  const oldNewest = oldHere !== undefined ? newestView(oldHere).text : newestView(text).text;
  if (read(oldRead) === read(oldNewest)) return true;
  const alike = (a: string, b: string): [string, string] => {
    let start = 0;
    while (start < a.length && start < b.length && a[start] === b[start]) start++;
    let end = 0;
    while (
      end < a.length - start &&
      end < b.length - start &&
      a[a.length - 1 - end] === b[b.length - 1 - end]
    ) {
      end++;
    }
    return [a.slice(start, a.length - end), b.slice(start, b.length - end)];
  };
  const [markedA, markedB] = alike(read(oldRead), read(afterRead));
  const [viewA, viewB] = alike(read(oldNewest), read(afterNewest));
  return markedA !== viewA || markedB !== viewB;
}

/**
 * Whether micromark reads the body of `text` otherwise than its newest view: the file as it stands, with no
 * change in question. A paragraph that begins with a marker is read so before any edit (#1092), which is no
 * cell's doing: only the table blocks are compared by callers that mean cells (`table-settle.ts`).
 */
export function readsOtherAsIs(text: string): boolean {
  const parsed = parse(text);
  const ledger = parsed.ledgerRange;
  const body = ledger ? text.slice(0, ledger.from) : text;
  return micromarkText(body) !== micromarkText(newestView(text).text);
}

function micromarkText(source: string): string {
  return micromark(source, {
    allowDangerousHtml: true,
    extensions: [gfmAutolinkLiteral(), gfmStrikethrough(), gfmTable(), gfmTaskListItem()],
    htmlExtensions: [
      gfmAutolinkLiteralHtml(),
      gfmStrikethroughHtml(),
      gfmTableHtml(),
      gfmTaskListItemHtml(),
    ],
  })
    .replace(/<!--[^]*?-->/g, '')
    .replace(/\s+/g, ' ')
    .replace(/ ?(<[^>]*>) ?/g, '$1')
    .trim();
}
