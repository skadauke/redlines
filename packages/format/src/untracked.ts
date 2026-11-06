// Editing with Track Changes off (format §3.10). An edit that is not tracked is an edit of the text
// itself, as a direct edit is in Word: the newest and the original text both change as it says, and
// nothing it types becomes part of a pending change.
//
// - Typed text goes outside an insertion or a substitution at whose edge it is typed: before its
//   opener, after its closer. Typed in the middle of one's new text, it splits the mark: the part
//   after it is a mark of its own, with a new id and a copy of the ledger entry. A comment or a
//   highlight takes text typed at the end of its range, not at its start (format §4).
// - Deleted text is gone for good, with what was pending about it: a mark that has no text left
//   goes, with its ledger entry, and a pending deletion in the deleted text goes with its old text.
//   A substitution keeps what is left of it, and a comment keeps a point where its text was.
//
// What has no legal form is refused. The result is checked against the plain edit of both views,
// and an edit that would come out otherwise is refused too, so the file is never damaged.

import { CONTAINER_PREFIX, breakEnd, lineEnd, lineStart, openerRange } from './blocks.ts';
import { applyChanges } from './changes.ts';
import { breakComesToDepend, pairWords } from './break-reach.ts';
import {
  KIND_WORDS,
  assertNoMarkup,
  commitEdit,
  eolOf,
  inEol,
  markerRanges,
  nameOf,
  snapOut,
  workingLedger,
} from './edit-support.ts';
import type { MarkerRange } from './edit-support.ts';

export { nameOf } from './edit-support.ts';
import { EditError } from './errors.ts';
import { idsIn, newId } from './ids.ts';
import { inspectPlace } from './inline.ts';
import { parse } from './parse.ts';
import { scan } from './scan.ts';
import type { MarkEntry, MarkRange, Parsed, Person, Range, Segment, TextChange } from './types.ts';
import { newestView, originalChanges, originalViewOfText } from './views.ts';

/**
 * What an untracked edit needs besides the text: the random bytes of the ids of the marks that it
 * splits (format §2.3), and who is editing, which a refusal names ("your insertion") but no change
 * records. An `EditContext` will do.
 */
export interface UntrackedContext {
  random?: (n: number) => Uint8Array;
  author?: Person;
}

/** The message of an edit that would come out other than the plain edit of the text, which the
 * last check refuses. */
export const UNTRACKED_SELF_CHECK =
  "This edit can't be made with Track Changes off without changing other text or the changes around it. Accept or reject those changes first, or turn on Track Changes.";

const HIDES =
  'This edit would turn the changes after it into code or an HTML comment, where they would no longer be read. Accept or reject them first, or edit the source in Raw.';

/** The way around a refusal next to a mark: decide it, or for a comment, which has nothing to
 * decide, work on the source. */
const wayAround = (mark: MarkRange | undefined) =>
  mark?.kind === 'cmt'
    ? 'Turn on Track Changes, or edit the source in Raw.'
    : 'Accept or reject it first, or turn on Track Changes.';

/** A stretch of the file: text, or a marker (an opener with its carrier), or the ledger. */
interface Item extends Range {
  marker?: MarkerRange;
  /** The edit takes it away. */
  removed: boolean;
  /** The marker the edit writes in its place; the carrier of an opener stays. */
  rewrite?: string;
}

/** A segment of a mark, with the items of its markers. */
interface Seg {
  mark: MarkRange;
  segment: Segment;
  open: Item;
  close?: Item;
}

/** The file as items, in order, with text cut at `cuts`. */
function itemsOf(text: string, markers: readonly MarkerRange[], cuts: readonly number[]): Item[] {
  const items: Item[] = [];
  let at = 0;
  const addText = (end: number) => {
    const points = cuts.filter((cut) => cut > at && cut < end).toSorted((a, b) => a - b);
    for (const point of [...points, end]) {
      if (point > at) items.push({ from: at, to: point, removed: false });
      at = Math.max(at, point);
    }
  };
  for (const marker of markers) {
    if (marker.from < at) {
      throw new EditError(
        "The changes here overlap in a way that Redlines can't edit around. Accept or reject them first.",
        'no-legal-placement',
      );
    }
    addText(marker.from);
    items.push({ from: marker.from, to: marker.to, marker, removed: false });
    at = marker.to;
  }
  addText(text.length);
  return items;
}

/** Pending text that typed text never joins: an insertion or a substitution with a closer. */
const isContainerKind = (mark: MarkRange) => mark.kind === 'ins' || mark.kind === 'sub';

/** A marker that draws nothing, so that the caret looks the same on either side of it: a closer, or
 * an opener with no old text and no carrier. Deleted text, the old text of a substitution, a split
 * and the marks of a table draw something or stand for something there. */
function isBlank(marker: MarkerRange, oldTextGone = false): boolean {
  const { mark, segment } = marker;
  if (marker.role === 'ledger' || !mark || !segment) return false;
  if (marker.role === 'close') return true;
  if (segment.carrier) return false;
  switch (mark.kind) {
    case 'cmt':
    case 'hl':
    case 'fmt':
      return true;
    case 'ins':
      return segment.close !== undefined;
    case 'sub':
      return oldTextGone || !segment.payload;
    default:
      return false;
  }
}

/**
 * Which side of a hidden marker of a comment's or a highlight's range text typed beside it goes on
 * (format §4), or undefined for any other marker. Text goes in front of the marker, so that a range
 * takes text typed at its end and not at its start. A line break is not text of a range, and no
 * marker may start a line (format §3.2): text that starts with a line break goes after a closer, so
 * that the closer ends its line; text that ends with one, as Enter's does, after the bullet of the
 * next item if Enter writes one, goes after a closer and after an opener too, which would otherwise
 * start the new line, and after a point comment for the same reason. The opener of a range of
 * whole blocks stands on a line of its own, which a line break leaves as it is.
 */
function rangeSide(marker: MarkerRange, typed: string): 'before' | 'after' | undefined {
  const { mark, segment, role } = marker;
  if ((mark?.kind !== 'cmt' && mark?.kind !== 'hl') || !segment || typed === '') return undefined;
  const starts = /^(?:[ \t]*|\\)\r?\n/.test(typed);
  const lastLine = typed.slice(typed.lastIndexOf('\n') + 1);
  const ends =
    typed.includes('\n') && (CONTAINER_PREFIX.test(lastLine) || /^#{1,6}[ \t]+$/.test(lastLine));
  if (!segment.close) return ends && !segment.carrier ? 'after' : undefined;
  if (role === 'close') return starts || ends ? 'after' : 'before';
  if (segment.carrier) return starts || ends ? undefined : 'before';
  return ends ? 'after' : 'before';
}

/**
 * Where text typed at `position` of the parsed text goes among the hidden markers of comment and
 * highlight ranges there, whichever side of them `position` is on (format §4, `rangeSide`): in a
 * range at its end, in front of it at its start, and a line break past them. An untracked edit puts
 * typed text there itself; for a tracked edit, which side of hidden markers text lands on is the
 * caller's choice, and this is the choice the format asks for.
 */
export function rangeEdge(parsed: Parsed, position: number, typed: string): number {
  const markers = markerRanges(parsed);
  let at = position;
  // Each step crosses a marker, and none is crossed back.
  for (let step = 0; step <= markers.length; step++) {
    const after = markers.find((m) => m.from === at && rangeSide(m, typed) === 'after');
    const before = after
      ? undefined
      : markers.find((m) => m.to === at && rangeSide(m, typed) === 'before');
    if (!after && !before) break;
    at = after ? after.to : before!.from;
  }
  return at;
}

/** A marker that a pending change needs where it is: it keeps an insertion that holds it from
 * being empty. Comments, highlights and format changes are about text, and hold none of their own. */
function isChange(item: Item): boolean {
  const kind = item.marker?.mark?.kind;
  return kind === 'ins' || kind === 'sub' || kind === 'del' || kind === 'split';
}

/** The changes, sorted, as `applyChanges` takes them. */
const sorted = (changes: TextChange[]) =>
  changes.toSorted((a, b) => a.from - b.from || a.to - b.to);

/** Sorted changes with those that touch made one. */
function joined(changes: readonly TextChange[]): TextChange[] {
  const result: TextChange[] = [];
  for (const change of changes) {
    const last = result.at(-1);
    if (last && last.to === change.from) {
      result[result.length - 1] = {
        from: last.from,
        to: change.to,
        insert: last.insert + change.insert,
      };
    } else result.push({ ...change });
  }
  return result;
}

/** The text with blank lines and line endings as Markdown reads them: a carrier may take in the blank
 * lines next to it (format §3.3), and blank lines at either end of the text are no block. */
const loose = (s: string) =>
  s
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]*\n(?:[ \t]*\n)+[ \t]*/g, '\n\n')
    .trim();

/**
 * What the original text keeps of `text` after `[from, to)` is deleted with Track Changes off: the
 * text that both views have, outside the range, and the old text of the deletions and substitutions
 * whose opener is outside it.
 */
function originalKept(text: string, parsed: Parsed, from: number, to: number): string {
  let result = '';
  let at = 0;
  const keep = (a: number, b: number) => {
    if (from === to || b <= from || a >= to) result += text.slice(a, b);
    else result += text.slice(a, Math.max(a, from)) + text.slice(Math.min(b, to), b);
  };
  for (const change of originalChanges(text, parsed)) {
    keep(at, change.from);
    const { opener } = change;
    const deleted = opener !== undefined && from < to && from <= opener.from && opener.to <= to;
    if (!deleted) result += change.insert;
    at = change.to;
  }
  keep(at, text.length);
  return result;
}

/** How many marks of a parse have nothing between their markers, and how many splits have no
 * break: what no edit should leave, as a carrier can take in the text of a mark (format §3.3). */
function emptyCount(parsed: Parsed): number {
  const limit = parsed.ledgerRange?.from;
  let count = 0;
  for (const { kind, segments } of parsed.marks) {
    for (const segment of segments) {
      const start = segment.carrier?.to ?? segment.content.from;
      if (segment.close && kind !== 'cmt' && start === segment.content.to) count++;
      if (kind === 'split' && breakEnd(parsed.text, segment.open.to, limit) === segment.open.to) {
        count++;
      }
    }
  }
  return count;
}

/** How many warnings of each code a parse has. */
function warningCounts(parsed: Parsed): Map<string, number> {
  const counts = new Map<string, number>();
  for (const { code } of parsed.warnings) counts.set(code, (counts.get(code) ?? 0) + 1);
  return counts;
}

/**
 * Throws when the changes do not make the edit (format §3.10): the newest text is the plain edit of
 * the newest text; the original text loses what the edit deleted of the text both views had and the
 * old text whose marker it deleted, and has the typed text where it was typed; and the file has no
 * warning more than it had.
 */
function selfCheck(
  text: string,
  parsed: Parsed,
  edit: { from: number; to: number; typed: string },
  changes: readonly TextChange[],
): void {
  const fail = () => {
    throw new EditError(UNTRACKED_SELF_CHECK, 'no-legal-placement');
  };
  const after = applyChanges(text, changes);
  const before = newestView(text);
  const start = before.map.fromSource(edit.from);
  const end = before.map.fromSource(edit.to);
  const expected = applyChanges(before.text, [{ from: start, to: end, insert: edit.typed }]);
  const newest = newestView(after);
  if (loose(newest.text) !== loose(expected)) fail();
  const original = originalViewOfText(after);
  let rest = original.text;
  if (edit.typed !== '') {
    // The typed text is plain: both views have it, where it was typed.
    const at = newest.map.toSource(start, 1);
    if (!after.startsWith(edit.typed, at)) fail();
    const k = original.map.fromSource(at);
    if (rest.slice(k, k + edit.typed.length) !== edit.typed) fail();
    rest = rest.slice(0, k) + rest.slice(k + edit.typed.length);
  }
  if (loose(rest) !== loose(originalKept(text, parsed, edit.from, edit.to))) fail();
  const read = parse(after);
  const had = warningCounts(parsed);
  for (const [code, count] of warningCounts(read)) {
    if (count > (had.get(code) ?? 0)) fail();
  }
  if (emptyCount(read) > emptyCount(parsed)) fail();
}

/**
 * The plain edit, as the one change, when it is away from every mark: no marker, carrier or
 * ledger stands on the lines it touches, no new text of an insertion or a substitution and no
 * break of a split reaches them, and the file reads the same marks the same way after it, with no
 * warning more (a backtick typed elsewhere can turn markers into code). Such an edit changes both
 * views as it says, and nothing else. Undefined for any other edit, which `untrackedEdit` works
 * out; this only saves that work, which most edits don't need.
 */
function awayFromMarks(
  text: string,
  parsed: Parsed,
  markers: readonly MarkerRange[],
  edit: TextChange,
): TextChange[] | undefined {
  const start = lineStart(text, edit.from);
  const end = lineEnd(text, edit.to);
  const touches = (range: Range) => range.from <= end && start <= range.to;
  // The ledger, which starts at the end of the body's last line, only when the edit reaches into it.
  const ledger = parsed.ledgerRange;
  if (ledger && edit.from < ledger.to && ledger.from < edit.to) return undefined;
  if (markers.some((marker) => marker.role !== 'ledger' && touches(marker))) return undefined;
  const limit = parsed.ledgerRange?.from;
  for (const { kind, segments } of parsed.marks) {
    for (const segment of segments) {
      const { open, close, carrier, content } = segment;
      if (kind === 'split' && touches({ from: open.to, to: breakEnd(text, open.to, limit) })) {
        return undefined;
      }
      const isNew = (kind === 'ins' || kind === 'sub') && close;
      if (isNew && touches({ from: carrier?.to ?? content.from, to: content.to })) return undefined;
    }
  }
  const read = parse(applyChanges(text, [edit]), parsed);
  const shape = (p: Parsed) =>
    p.marks
      .map((m) => {
        const segments = m.segments.map((s) => `${!!s.carrier} ${s.payload ?? ''}`).join('|');
        return `${m.id} ${m.kind} ${segments}`;
      })
      .join('\n');
  if (read.marks.length !== parsed.marks.length || shape(read) !== shape(parsed)) return undefined;
  const had = warningCounts(parsed);
  for (const [code, count] of warningCounts(read))
    if (count > (had.get(code) ?? 0)) return undefined;
  return [edit];
}

/** An error of `commitEdit`, in the words of an edit with Track Changes off; `near` is the mark
 * next to the edit, `name` how to call it. */
function untrackedError(error: EditError, near: MarkRange | undefined, name: string): EditError {
  if (error.code === 'would-hide-marks') return new EditError(HIDES, error.code);
  if (error.code !== 'no-legal-placement') return error;
  return new EditError(
    `This edit can't be made with Track Changes off: it would leave a hidden mark of ${name} at the start of a line or alone on it, where Markdown would read it as text. ${wayAround(near)}`,
    error.code,
  );
}

/**
 * The changes that an edit with Track Changes off makes, in offsets of `text`: the changes of the
 * body, and of the ledger when a mark comes or goes (format §3.10). `edit` covers visible text, as
 * `trackedEdit`'s does, and which side of hidden markers its ends are on does not matter, but for a
 * deletion or the old text of a substitution, which the editor draws: text typed at the edge of an
 * insertion or a substitution goes outside it, and a comment or highlight takes text typed at its
 * end. Inserted text gets the file's line breaks.
 *
 * @throws RangeError when the edit lies outside the text.
 * @throws EditError when the typed text holds Redlines markup (`markup`); when the edit has no legal
 *   form (`no-legal-placement`), such as a line break in front of an insertion, whose opener would
 *   start the new line; when it would hide other changes in code (`would-hide-marks`); and when the
 *   ledger has to change and can't be read.
 */
export function untrackedEdit(
  text: string,
  edit: TextChange,
  ctx: UntrackedContext = {},
): TextChange[] {
  if (edit.from < 0 || edit.to < edit.from || edit.to > text.length) {
    throw new RangeError(
      `The edit ${edit.from}-${edit.to} is out of order or outside the text (${text.length} characters)`,
    );
  }
  const typed = inEol(edit.insert, eolOf(text));
  if (typed !== '') assertNoMarkup(typed);
  const parsed = parse(text);
  const markers = markerRanges(parsed);
  let from: number;
  let to: number;
  if (edit.from === edit.to) from = to = snapOut(markers, edit.from, false);
  else {
    from = snapOut(markers, edit.from, true);
    to = Math.max(from, snapOut(markers, edit.to, false));
  }
  if (from === to && typed === '') return [];
  // A file without marks and ledger takes the edit as it is, unless the edit makes one.
  if (markers.length === 0) {
    const plain = [{ from, to, insert: typed }];
    const made = scan(applyChanges(text, plain));
    if (made.markers.length === 0 && made.ledgers.length === 0) return plain;
  }
  // So does an edit away from every mark, which is most of them.
  const away = awayFromMarks(text, parsed, markers, { from, to, insert: typed });
  if (away) return away;
  // The ends of a range that draw nothing on either side are on the side of the text: the range
  // starts and ends with what it deletes.
  const shrinks = (m: MarkerRange) => m.role === 'ledger' || isBlank(m);
  for (let m = markers.find((r) => r.from === from); from < to && m && m.to <= to && shrinks(m);) {
    from = m.to;
    m = markers.find((r) => r.from === from && r.to > from);
  }
  for (let m = markers.find((r) => r.to === to); from < to && m && m.from >= from && shrinks(m);) {
    to = m.from;
    m = markers.find((r) => r.to === to && r.from < to);
  }
  const point = from === to;
  if (point && typed === '') return [];

  const items = itemsOf(text, markers, [from, to]);
  const index = new Map(items.map((item, i) => [item, i]));
  const segs: Seg[] = [];
  const opens = new Map<Segment, Item>();
  const closes = new Map<Segment, Item>();
  for (const item of items) {
    const { marker } = item;
    if (marker?.role === 'open' && marker.segment) opens.set(marker.segment, item);
    if (marker?.role === 'close' && marker.segment) closes.set(marker.segment, item);
  }
  for (const mark of parsed.marks) {
    for (const segment of mark.segments) {
      const open = opens.get(segment);
      const close = closes.get(segment);
      if (open) segs.push(close ? { mark, segment, open, close } : { mark, segment, open });
    }
  }
  /** The items between a segment's markers. */
  const inner = (seg: Seg) => items.slice((index.get(seg.open) ?? 0) + 1, index.get(seg.close!));
  const inRange = (range: Range) => !point && from <= range.from && range.to <= to;
  /** A substitution segment whose old text is deleted with its opener. */
  const oldTextDeleted = (seg: Seg) =>
    seg.mark.kind === 'sub' && !!seg.segment.payload && inRange(openerRange(seg.segment));

  // Deleting (format §3.10): the text in the range goes, and with it the marks that have nothing
  // left. A segment of a mark is empty when no text and no change of another person is left in it.
  /** Substitution segments that are left with their old text and nothing else. */
  const oldTextOnly = new Set<Seg>();
  if (!point) {
    for (const item of items) if (!item.marker && inRange(item)) item.removed = true;
    for (const seg of segs) {
      const { kind } = seg.mark;
      // A pending deletion, or a table's mark, whose marker is in the range.
      if ((kind === 'del' || (kind === 'ins' && !seg.close)) && inRange(seg.open)) {
        seg.open.removed = true;
      }
    }
    const limit = parsed.ledgerRange?.from;
    for (const seg of segs) {
      if (seg.mark.kind !== 'split') continue;
      // A split goes when its break does. One whose break was deleted with Track Changes on goes
      // with that deletion (format §3.4).
      const end = breakEnd(text, seg.open.to, limit);
      const next = items[(index.get(seg.open) ?? 0) + 1];
      const joined = next?.removed === true && next.marker?.mark?.kind === 'del';
      if (end > seg.open.to ? from <= seg.open.to && end <= to : inRange(seg.open) || joined) {
        seg.open.removed = true;
      }
    }
    const containers = segs.filter((seg) => isContainerKind(seg.mark) && seg.close);
    const empty = (seg: Seg) => {
      const items = inner(seg);
      return (
        items.some((item) => item.removed) &&
        items.every(
          (item) => item.removed || (item.marker ? !isChange(item) : item.to === item.from),
        )
      );
    };
    for (let changed = true; changed;) {
      changed = false;
      for (const seg of containers) {
        if (seg.open.removed || oldTextOnly.has(seg) || !empty(seg)) continue;
        changed = true;
        if (seg.segment.payload && !oldTextDeleted(seg)) oldTextOnly.add(seg);
        else seg.open.removed = seg.close!.removed = true;
      }
    }
    for (const mark of parsed.marks) {
      if (mark.kind !== 'sub') continue;
      const alive = segs.filter((seg) => seg.mark === mark && !seg.open.removed);
      // The old text that is deleted with the opener goes; the new text left stays new.
      for (const seg of alive) if (oldTextDeleted(seg)) seg.open.rewrite = `<!--sub ${mark.id}-->`;
      // Old text and nothing else is a deletion (format §3.9).
      const [only] = alive;
      if (alive.length === 1 && only && oldTextOnly.has(only)) {
        const { open } = only.segment;
        only.open.rewrite = `<!--del${text.slice(open.from + '<!--sub'.length, open.to)}`;
        only.close!.removed = true;
      }
    }
  }

  // Typing (format §3.10): where the text goes, among the markers that are left there.
  const kept = items.filter((item) => !item.removed);
  const at = new Map(kept.map((item, i) => [item, i]));
  const segOfOpen = new Map(segs.map((seg) => [seg.open, seg]));
  const segOfClose = new Map(segs.flatMap((seg) => (seg.close ? [[seg.close, seg] as const] : [])));
  const blank = (item: Item | undefined) =>
    !!item?.marker &&
    !item.rewrite?.startsWith('<!--del') &&
    isBlank(item.marker, item.rewrite !== undefined);
  const isContainer = (seg: Seg | undefined): seg is Seg & { close: Item } =>
    !!seg && isContainerKind(seg.mark) && !!seg.close && !seg.close.removed && !seg.open.removed;
  /** The insertion or substitution whose new text starts at gap `g`, past markers that draw nothing:
   * one that is open at `g`, not one that closes before it. */
  const startsAt = (g: number) => {
    for (let i = g - 1; i >= 0; i--) {
      const seg = segOfOpen.get(kept[i]!);
      if (isContainer(seg) && at.get(seg.close)! >= g) return seg;
      if (!blank(kept[i])) return undefined;
    }
    return undefined;
  };
  /** The insertion or substitution whose new text ends at gap `g`, past markers that draw nothing:
   * one that is open at `g`, not one that opens after it. */
  const endsAt = (g: number) => {
    for (let i = g; i < kept.length; i++) {
      const seg = segOfClose.get(kept[i]!);
      if (isContainer(seg) && at.get(seg.open)! < g) return seg;
      if (!blank(kept[i])) return undefined;
    }
    return undefined;
  };
  const isSplit = (item: Item | undefined) => item?.marker?.mark?.kind === 'split';
  /** The side of the item's marker that typed text goes on, at the edge of a range (`rangeSide`). */
  const side = (item: Item | undefined) =>
    item?.marker ? rangeSide(item.marker, typed) : undefined;
  // The text goes where the edit starts.
  let g = kept.findIndex((item) => item.from >= from);
  if (g === -1) g = kept.length;
  // Each step moves the gap over a marker; a few times the markers are plenty.
  for (let step = 0, was = -1; typed !== '' && g !== was && step <= 4 * kept.length; step++) {
    was = g;
    // Never between a split and its break.
    while (g > 0 && isSplit(kept[g - 1])) g--;
    // The edges of comments and highlights (format §4). Text that replaces text stays where the
    // text was, unless a marker would start a line.
    while (g < kept.length && side(kept[g]) === 'after') g++;
    if (point) while (g > 0 && side(kept[g - 1]) === 'before') g--;
    const start = startsAt(g);
    const end = start ? undefined : endsAt(g);
    if (start) g = at.get(start.open)!;
    else if (end) g = at.get(end.close)! + 1;
  }

  // Typed text in the middle of an insertion or a substitution splits it: the part after the text
  // is a new mark, of the same kind, with a copy of the ledger entry. The old text of a
  // substitution, and a thread about the change, stay with the first part.
  const ledger = workingLedger(parsed.ledger);
  const created: string[] = [];
  let closers = '';
  let openers = '';
  /** The mark that typed text splits, or the one next to the edit: a refusal names it. */
  let named: MarkRange | undefined;
  for (const i of [g, g - 1, g + 1, g - 2]) named ??= kept[i]?.marker?.mark;
  if (typed !== '') {
    const around = segs
      .filter((seg) => isContainer(seg) && at.get(seg.open)! < g && g <= at.get(seg.close)!)
      .toSorted((a, b) => at.get(a.open)! - at.get(b.open)!);
    named = around[0]?.mark ?? named;
    const taken = idsIn(text);
    for (const seg of around) {
      const { mark } = seg;
      const entry = Object.hasOwn(parsed.ledger.marks, mark.id)
        ? parsed.ledger.marks[mark.id]
        : undefined;
      if (!entry) {
        throw new EditError(
          `Text can't be typed in this ${KIND_WORDS[mark.kind]} with Track Changes off: who made it isn't recorded in the file, so it can't be split. Accept or reject it first, or turn on Track Changes.`,
          'no-legal-placement',
        );
      }
      const id = newId(taken, ctx.random);
      taken.add(id);
      const copy: MarkEntry = { ...entry };
      // The other half of a move, and the parts a substitution was simplified from, are the first's.
      delete copy.move;
      delete copy.parts;
      ledger.marks[id] = copy;
      created.push(mark.id, id);
      for (const later of segs) {
        if (later.mark !== mark) continue;
        for (const item of [later.open, later.close]) {
          if (!item || item.removed || at.get(item)! < g) continue;
          const { open } = later.segment;
          const written = item.rewrite ?? text.slice(open.from, open.to);
          item.rewrite =
            item === later.close ? `<!--/${id}-->` : written.replace(` ${mark.id}`, ` ${id}`);
        }
      }
      openers += `<!--${mark.kind} ${id}-->`;
    }
    closers = around
      .toReversed()
      .map((seg) => `<!--/${seg.mark.id}-->`)
      .join('');
  }
  // A closer can't start the block after the break of a split (format §3.2): the marks that would
  // end there end in front of the split instead, and the split and its break are in neither part.
  // No view changes.
  let closeAt = -1;
  let moved = '';
  if (typed !== '') {
    let c = g;
    while (c > 0 && isContainer(segOfClose.get(kept[c - 1]!))) c--;
    const brk = kept[c - 1];
    const split = kept[c - 2];
    if (
      (c < g || closers !== '') &&
      brk &&
      !brk.marker &&
      split &&
      isSplit(split) &&
      split.to === brk.from &&
      breakEnd(text, split.to, parsed.ledgerRange?.from) === brk.to
    ) {
      closeAt = split.from;
      for (const item of kept.slice(c, g)) {
        moved += item.rewrite ?? text.slice(item.from, item.to);
        item.removed = true;
      }
    }
  }

  // A comment, a highlight or a format change that the deletion left with nothing in it goes; a
  // comment keeps a point where its text was (format §4).
  if (!point) {
    for (const mark of parsed.marks) {
      if (mark.kind !== 'cmt' && mark.kind !== 'hl' && mark.kind !== 'fmt') continue;
      const gone = segs.filter((seg) => {
        if (seg.mark !== mark || !seg.close) return false;
        const a = at.get(seg.open)!;
        const b = at.get(seg.close)!;
        if (typed !== '' && a < g && g <= b) return false;
        const items = inner(seg);
        return (
          items.some((item) => item.removed) &&
          items.every(
            (item) => item.removed || (item.marker ? !isChange(item) : item.to === item.from),
          )
        );
      });
      const pointer =
        mark.kind === 'cmt' && gone.length === mark.segments.length ? gone[0] : undefined;
      for (const seg of gone) {
        if (seg !== pointer) seg.open.removed = true;
        seg.close!.removed = true;
      }
    }
  }

  const body: TextChange[] = [];
  for (const item of items) {
    const segment = item.marker?.segment;
    if (item.removed) body.push({ from: item.from, to: item.to, insert: '' });
    else if (item.rewrite !== undefined && segment) {
      const range = item.marker?.role === 'close' ? segment.close! : segment.open;
      body.push({ from: range.from, to: range.to, insert: item.rewrite });
    }
  }
  const place = g > 0 ? kept[g - 1]!.to : 0;
  const ahead = closeAt >= 0;
  const closing = { from: closeAt, to: closeAt, insert: moved + closers };
  const insertion = { from: place, to: place, insert: (ahead ? '' : closers) + typed + openers };
  if (typed !== '') body.push(insertion);
  if (ahead) body.push(closing);
  const separate = sorted(body);
  if (separate.length === 0) return [];
  /** Where the text of a change starts once the changes are made. */
  const startOf = (wanted: TextChange) => {
    let position = wanted.from;
    for (const change of separate) {
      if (change === wanted) break;
      position += change.insert.length - (change.to - change.from);
    }
    return position;
  };
  const changes = joined(separate);
  const name = named ? nameOf(parsed, named, ctx.author) : 'the change next to it';

  if (created.length > 0 || ahead) {
    // The markers around the typed text must stand where format §3.1 and §3.2 allow them.
    const mid = applyChanges(text, changes);
    const hidden = markerRanges(parse(mid));
    const typedAt = startOf(insertion) + (ahead ? 0 : closers.length);
    const close = inspectPlace(mid, hidden, ahead ? startOf(closing) : startOf(insertion));
    const open = inspectPlace(mid, hidden, typedAt + typed.length);
    if (close.kind !== 'ok' || (openers !== '' && open.kind !== 'ok' && open.kind !== 'block')) {
      throw new EditError(
        `Text can't be typed here with Track Changes off: it would split ${name} where Markdown can't hold its hidden marks, such as at the start of a line or inside a link. ${wayAround(named)}`,
        'no-legal-placement',
      );
    }
  }

  const gone = parsed.marks.some(
    (mark) =>
      mark.kind !== 'cmt' &&
      segs.some((seg) => seg.mark === mark) &&
      segs.every((seg) => seg.mark !== mark || seg.open.removed),
  );
  let result: TextChange[];
  let depends: ReturnType<typeof breakComesToDepend>;
  let read: Parsed | undefined;
  try {
    result = commitEdit(text, changes, ledger, {
      parsed,
      removes: true,
      ...(created.length > 0 ? { created } : {}),
      keepLedger: created.length === 0 && !gone,
      verify: (after, parsedAfter) => {
        read = parsedAfter;
        if (created.some((id) => !parsedAfter.marks.some((mark) => mark.id === id))) {
          throw new EditError(
            `Text can't be typed here with Track Changes off: it would put the hidden marks of ${name} inside code or an HTML comment, where they would not be read. ${wayAround(named)}`,
            'inside-code',
          );
        }
        depends = breakComesToDepend(text, parsed, after, parsedAfter, markers);
      },
    });
  } catch (error) {
    if (error instanceof EditError) throw untrackedError(error, named, name);
    throw error;
  }
  // No break of a split may come to depend on the decisions of the changes next to it (format
  // §3.4), as when the blank line between two splits' breaks is taken out.
  if (depends && read) {
    const words = pairWords(read, depends, ctx.author, ledger, created);
    throw new EditError(
      `This edit can't be made with Track Changes off: it would leave ${words.pair}, and deciding one would change the other. Accept or reject ${words.first} first.`,
      'no-legal-placement',
    );
  }
  selfCheck(text, parsed, { from, to, typed }, result);
  return result;
}
