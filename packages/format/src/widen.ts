// Widening an edit (format §3.12). An edit that can't be written as marks at the grain it was made,
// so that every order of decisions reads alike, is written as one substitution of the smallest unit
// that holds it: the unit as the old text, the unit as it reads with the edit made as the new text.
// Other people's pending changes in the unit stay in the old text, as the marks they are, in the
// payload's encoding; your own fold into the replacement, as rejecting them would leave the unit.
//
// Nothing calls this yet: the writers that refuse today will call it in their turn. It is the one
// writer all of them share: they differ in why the fine form failed, not in what to write.

import { scaffold, continuationPrefix, bodyStart, lineEnd, lineStart } from './blocks.ts';
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
import { encodePayload } from './payload.ts';
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
  /** The part of `held` that is not the author's own, and others' marks that touch the unit's edges:
   * those keep a widened edit refused (#808, #107). */
  heldByOthers: string[];
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
export function widen(text: string, edits: readonly TextChange[], ctx: EditContext): Widened {
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
  let spare =
    rung && atBlockBoundary(text, edits) && !(rung.parent && rung.kind === 'code')
      ? withNext(units, rung)
      : undefined;
  // A unit that closure brought back to one already tried would go up and down for ever.
  const tried = new Set<string>();
  for (let index = 0; rung; index++) {
    const closed = closure(parsed, units, rung, sourceFrom, sourceTo, region);
    const key = `${closed.lineFrom}:${closed.to}`;
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
    if (done && !(fromSpare && readsOtherMicromark(text, done.changes))) return done;
    const wider = widerThan(closed);
    fromSpare = !wider && spare !== undefined;
    rung = wider ?? spare;
    spare = undefined;
  }
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
  const viewTo = view.map.fromSource(rung.to);
  if (edits.some((edit) => edit.from < viewFrom || edit.to > viewTo)) return giveUp('span');
  const now = applyChanges(
    view.text.slice(viewFrom, viewTo),
    edits.map((edit) => ({ ...edit, from: edit.from - viewFrom, to: edit.to - viewFrom })),
  );
  // Nothing left of the unit is a deletion of it, not a replacement.
  if (now.trim() === '') return giveUp('empty');
  const range = { from: rung.lineFrom, to: rung.to };
  // The new text is one unit of the kind the old one was: an edit that makes an item two, or takes
  // a block of it out of its container, is a change of the unit around it.
  if (!sameFrame(rung.kind, rung.prefix, now)) return giveUp('frame');
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
  if (
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
  if (html && (rung.prefix !== '' || rung.kind === 'table')) return giveUp('html');
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
  const payload = blankAfter ? `${old}\n` : old;
  const opener = `<!--sub ${id} ${encodePayload(payload)}-->`;
  const closer = `<!--/${id}-->`;
  // The lines before and after the unit stand in its container, whose tightness is the item's: a
  // list's own tightness (it holds a blank line) says nothing of the blank line before it.
  const tight = rung.kind === 'list' && rung.parent ? rung.parent.tight : rung.tight;
  const lead = scaffold(rung.prefix, eol, tight);
  const body = now.replaceAll('\r\n', '\n').replaceAll('\n', eol);
  let written: string;
  let end = to;
  if (atomic) {
    const line = `${continuationPrefix(rung.prefix)}${closer}`;
    written = `${opener}${lead}${body}${html || (bare && rung.prefix === '') ? eol : ''}${eol}${line}`;
    if (blankAfter) end = to + eol.length;
  } else {
    written = `${opener}${lead}${body}${closer}`;
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
    heldByOthers: [
      ...held.filter(
        (held_id) => parsed.marks.find((m) => m.id === held_id)?.entry.by !== ctx.author.handle,
      ),
      // Another person's mark that ends at the unit's edge (a split's break right in front of it,
      // an insertion right after it) is decided with the block next to it: the replacement would
      // read differently in some order (#107).
      ...parsed.marks
        .filter(
          (mark) =>
            mark.entry.by !== ctx.author.handle &&
            !held.includes(mark.id) &&
            touches(mark, { from: rung.lineFrom - 2, to: rung.to + 2 }),
        )
        .map((mark) => mark.id),
    ],
    folded: own.map((mark) => mark.id),
  };
}

/** Whether the new text of a unit makes one unit of its kind after the prefix of the old: an item
 * stays one item, a list stays a list, a block of text stays one block. An edit that makes an item
 * two, or takes its text out of the list, belongs to the unit around it. */
function sameFrame(kind: UnitKind, prefix: string, now: string): boolean {
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
  if (top.length !== 1 || only?.kind !== 'list') return false;
  return kind === 'list' || only.children.length === 1;
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
  /^(?:#{1,6}[ \t]*|[-*+][ \t]*|\d{1,9}[.)][ \t]*|<[^\s>]*|`{3,}[^`]*|~{3,}.*)$/;
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
      edit.from === edit.to &&
      edit.insert !== '' &&
      !/[\n\t]/.test(edit.insert) &&
      /^[ \t]*(?:<!--[^]*?-->[ \t]*)*(?:\r?\n|$)/.test(text.slice(edit.from));
    if (
      !typed &&
      prefix !== '' &&
      SYNTAX_PREFIX.test(prefix) &&
      ((edit.insert.includes('\n') && (edit.from < edit.to || !/[ \t]$/.test(prefix))) ||
        !/[ \t]$/.test(prefix))
    ) {
      return true;
    }
    // Text typed in indented code or an item's text never changes the blocks: only a line break can.
    if (!edit.insert.includes('\n') && edit.from === edit.to) return false;
    if (!/^(?: {4}|\t)/.test(text.slice(start))) return false;
    let at = lineEnd(text, edit.to);
    for (let i = 0; i < 4 && at < text.length; i++) {
      const next = lineEnd(text, at + 1);
      if (LIST_LINE.test(text.slice(at + 1, next))) return true;
      at = next;
    }
    return false;
  });
}

/** Whether micromark reads the file the changes make otherwise than its newest view. */
export function readsOtherMicromark(text: string, changes: readonly TextChange[]): boolean {
  const file = applyChanges(text, changes);
  const ledger = parse(file).ledgerRange;
  const read = (source: string) =>
    micromark(source, {
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
  return read(ledger ? file.slice(0, ledger.from) : file) !== read(newestView(file).text);
}
