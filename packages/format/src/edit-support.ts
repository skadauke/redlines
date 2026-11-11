// What the editing functions share (format §3.6, §4, §5): where the markers are, moving a position
// out of one, the file's line breaks, and writing the ledger once the body has changed.

import { applyChanges } from './changes.ts';
import { EditError } from './errors.ts';
import {
  htmlOpenAt,
  lineOutOfCode,
  markersInIndentedCode,
  mayIndent,
  neverCode,
  readsAlike,
} from './indented-code.ts';
import { normalizeLedger } from './ledger-order.ts';
import { setLedger } from './ledger-write.ts';
import { parse } from './parse.ts';
import { bodyStart, lineEnd, lineStart, openerRange } from './blocks.ts';
import { forward, leavesPhantomCarrier, movedPhantoms, placementRepairs } from './placement.ts';
import { scan } from './scan.ts';
import { newestView, originalView, viewsOnce } from './views.ts';
import type { Views } from './views.ts';
import type { Ledger, MarkKind, MarkRange, Parsed, Person, Range, TextChange } from './types.ts';

// The file's line breaks, which views need without the rest of this.
export { eolOf, inEol } from './changes.ts';
export type { Eol } from './changes.ts';

// The markers of a file, which views and the reading of formats need without the rest of this.
export { markerRanges } from './markers.ts';
export type { MarkerRange } from './markers.ts';
import type { MarkerRange } from './markers.ts';

/** The words for a kind of mark. */
export const KIND_WORDS: Record<MarkKind, string> = {
  ins: 'insertion',
  del: 'deletion',
  sub: 'replacement',
  fmt: 'format change',
  hl: 'highlight',
  cmt: 'comment',
  split: 'line break',
};

/** A mark as a refusal names it: "Bo Chen's insertion", "your insertion", "this insertion". */
export function nameOf(parsed: Parsed, mark: MarkRange, author: Person | undefined): string {
  const kind = KIND_WORDS[mark.kind];
  const { by } = mark.entry;
  if (by === 'unknown') return `this ${kind}`;
  if (by === author?.handle) return `your ${kind}`;
  const name = parsed.ledger.people.find((person) => person.handle === by)?.name ?? by;
  return `${name}'s ${kind}`;
}

/**
 * A position inside a marker is moved out of it: to its start, or to its end when `after`. Callers
 * map positions through hidden markers, so this only guards against a position that is not a place
 * for text. The ledger is always left by its start, because nothing belongs after it but the final
 * line break.
 */
export function snapOut(markers: readonly MarkerRange[], position: number, after: boolean): number {
  for (const marker of markers) {
    if (marker.from >= position) break;
    if (position < marker.to) return after && marker.role !== 'ledger' ? marker.to : marker.from;
  }
  return position;
}

/** The text of `[from, to)` as the newest view shows it: without markers, the text a deletion
 * keeps in its payload, and the ledger. */
export function visibleText(
  text: string,
  markers: readonly MarkerRange[],
  from: number,
  to: number,
): string {
  let result = '';
  let cursor = from;
  for (const marker of markers) {
    if (marker.to <= from) continue;
    if (marker.from >= to) break;
    if (marker.from > cursor) result += text.slice(cursor, marker.from);
    cursor = Math.max(cursor, marker.to);
  }
  return cursor < to ? result + text.slice(cursor, to) : result;
}

/** A copy of the ledger that a function can change while it works. */
export function workingLedger(ledger: Ledger): Ledger {
  return {
    ...ledger,
    people: [...ledger.people],
    marks: { ...ledger.marks },
    comments: [...ledger.comments],
  };
}

/** Adds `author` to the ledger's people, unless they are there. */
export function addPerson(ledger: Ledger, author: Person): void {
  if (!ledger.people.some((person) => person.handle === author.handle)) {
    ledger.people.push({ ...author });
  }
}

/**
 * Text that is typed, pasted or suggested becomes the content of a mark. If it held a marker or a
 * ledger, it would be read as one: it could close someone else's insertion or forge a mark.
 */
export function assertNoMarkup(text: string): void {
  const found = scan(text);
  if (found.markers.length > 0 || found.ledgers.length > 0) {
    throw new EditError(
      "This text holds Redlines markup, such as <!--ins …-->, which can't be added as a change. Edit it in the raw view.",
      'markup',
    );
  }
}

/** A change from `before` to `after` as one change: what the two do not share in the middle. */
function singleChange(before: string, after: string): TextChange[] {
  if (before === after) return [];
  const limit = Math.min(before.length, after.length);
  let start = 0;
  while (start < limit && before.charCodeAt(start) === after.charCodeAt(start)) start++;
  let end = 0;
  while (
    end < limit - start &&
    before.charCodeAt(before.length - 1 - end) === after.charCodeAt(after.length - 1 - end)
  ) {
    end++;
  }
  return [{ from: start, to: before.length - end, insert: after.slice(start, after.length - end) }];
}

/** Where a position of the changed text was in the original, or null when it lay inside text that
 * a change inserted. At the edge of an inserted text it is before or after it, and a change that
 * only removes text leaves two original positions for one: `preferAfter` picks the later one. */
function positionBefore(
  changes: readonly TextChange[],
  position: number,
  preferAfter: boolean,
): number | null {
  let delta = 0;
  for (const change of changes) {
    const start = change.from + delta;
    const end = start + change.insert.length;
    if (position < start) break;
    if (position <= end) {
      if (start === end) return preferAfter ? change.to : change.from;
      if (position === start) return change.from;
      if (position === end) return change.to;
      return null;
    }
    delta += change.insert.length - (change.to - change.from);
  }
  return position - delta;
}

/**
 * The changes of the body followed by the changes of the ledger, as changes of the original text.
 * The ledger changes were worked out for the text after the body changes. When they can't be put
 * back in place, because a body change reaches into the ledger, one change covers the lot.
 */
function joinChanges(
  text: string,
  body: readonly TextChange[],
  after: string,
  ledgerChanges: readonly TextChange[],
): TextChange[] {
  if (ledgerChanges.length === 0) return [...body];
  const single = () => singleChange(text, applyChanges(after, ledgerChanges));
  const mapped: TextChange[] = [];
  for (const change of ledgerChanges) {
    const from = positionBefore(body, change.from, true);
    const to = change.to === change.from ? from : positionBefore(body, change.to, false);
    if (from === null || to === null || to < from) return single();
    mapped.push({ from, to, insert: change.insert });
  }
  const all = [...body, ...mapped].sort((a, b) => a.from - b.from || a.to - b.to);
  for (let i = 1; i < all.length; i++) {
    const previous = all[i - 1];
    const current = all[i];
    if (previous && current && current.from < previous.to) return single();
  }
  return all;
}

/** The refusal of a change that would hide other changes in code or an HTML comment: in the words
 * of a decision, or of an edit, which can be made in Raw instead. A decision that would hide the
 * markers of a comment, which no decision takes away, says to delete the comment (`comment`). */
function hiddenError(removing: boolean, comment = false): EditError {
  if (removing && comment) {
    return new EditError(
      'This decision would bring the markers of the comment next to it into code, where they would no longer be read. Delete that comment first.',
      'would-hide-marks',
    );
  }
  return new EditError(
    removing
      ? 'This decision would hide other changes in code or an HTML comment, where they would no longer be read. Decide the changes next to it first.'
      : 'This edit would hide other changes in code or an HTML comment, where they would no longer be read. Accept or reject them first, or edit the source in Raw with Track Changes off.',
    'would-hide-marks',
  );
}

/**
 * Throws when a marker the file had is no longer read after the changes, although the changes did
 * not remove it. An edit can do that without touching the marker: a backtick that changes which
 * backticks pair, or a `<!--` that opens a comment, turns every marker after it into code or
 * comment text, and the ledger would lose their entries, or a mark would lose one of its ends.
 * `body` are the changes that were asked for, and `changes` all of them.
 */
function assertMarksKept(
  before: Parsed,
  after: Parsed,
  body: readonly TextChange[],
  changes: readonly TextChange[],
  removing: boolean,
): void {
  const hidden = () => {
    throw hiddenError(removing);
  };
  const read = new Set<number>();
  for (const mark of after.marks) {
    for (const { open, close } of mark.segments) {
      read.add(open.from);
      if (close) read.add(close.from);
    }
  }
  const removed = (range: Range) => body.some((c) => c.from <= range.from && range.to <= c.to);
  for (const mark of before.marks) {
    for (const segment of mark.segments) {
      const { close } = segment;
      const opener = openerRange(segment);
      for (const range of close ? [opener, close] : [opener]) {
        if (removed(range)) continue;
        const at = forward(changes, range.from);
        if (at === null || !read.has(at)) hidden();
      }
    }
  }
  // A marker hidden from the middle of a mark leaves the rest of it unclosed or opened twice.
  const count = (parsed: Parsed) => {
    const counts = new Map<string, number>();
    for (const { code, id } of parsed.warnings) {
      if (!MARK_STRUCTURE.has(code)) continue;
      counts.set(`${code} ${id ?? ''}`, (counts.get(`${code} ${id ?? ''}`) ?? 0) + 1);
    }
    return counts;
  };
  const was = count(before);
  for (const [key, number] of count(after)) if (number > (was.get(key) ?? 0)) hidden();
}

/**
 * Whether the changes leave every marker in or out of indented code as it was, as `readCode` reads
 * the file and each view, judged from the one line they change, without reading the rest (format
 * §2.1). They take away and write no line break, and change one line of the file and one line of
 * each view (or none), each of which is read as it was whatever lines are around it, so that no
 * other line is read otherwise; and each such line that has markers, or where the markers they
 * write go in a view, is no line of code. `full` is the text after them, with the ledger that is
 * going to be written, and `limit` where the body of `text` ends.
 */
export function keepsIndentedCode(
  text: string,
  limit: number,
  full: string,
  changes: readonly TextChange[],
  views: Views,
): boolean {
  const sorted = changes.toSorted((a, b) => a.from - b.from || a.to - b.to);
  const first = sorted[0];
  const last = sorted.at(-1);
  if (!first || !last) return true;
  if (last.to > limit) return false;
  if (sorted.some((change) => /[\r\n]/.test(change.insert))) return false;
  if (/[\r\n]/.test(text.slice(first.from, last.to))) return false;
  const delta = sorted.reduce((sum, c) => sum + c.insert.length - (c.to - c.from), 0);
  const start = lineStart(text, first.from);
  const end = lineEnd(text, last.to);
  const line = full.slice(start, end + delta);
  if (!readsAlike(text.slice(start, end), line, htmlOpenAt(text, start))) return false;
  const marked = line.includes('<!--');
  if (marked && !neverCode(line)) return false;
  const writes = sorted.some((change) => change.insert.includes('<!--'));
  for (const view of [(t: string) => views.newest(t), (t: string) => views.original(t)]) {
    const was = view(text);
    const now = view(full);
    // Where the line is in the view: its text, which may be all hidden, on one line of the view.
    const from = was.map.fromSource(start);
    const to = was.map.fromSource(end);
    const until = now.map.fromSource(end + delta);
    if (now.map.fromSource(start) !== from || was.text.slice(0, from) !== now.text.slice(0, from)) {
      return false;
    }
    if (was.text.slice(to) !== now.text.slice(until)) return false;
    const old = was.text.slice(from, to);
    const changed = now.text.slice(from, until);
    if (old.includes('\n') || changed.includes('\n')) return false;
    // A view the changes leave as it was has its markers where they were, but those they write.
    if (old === changed) {
      if (writes && !lineOutOfCode(now.text, from)) return false;
      continue;
    }
    const lineFrom = lineStart(now.text, from);
    const viewLine = now.text.slice(lineFrom, lineEnd(now.text, until));
    const open = htmlOpenAt(now.text, lineFrom);
    if (!readsAlike(was.text.slice(lineFrom, lineEnd(was.text, to)), viewLine, open)) return false;
    if (marked && !neverCode(viewLine)) return false;
  }
  return true;
}

/**
 * Throws when the changes leave more of a mark's markers in indented code than the file had
 * (format §2.1): a reader reads them as markers, but every renderer shows them as code, in the file
 * or once the changes around them are decided. A marker the changes wrote, or moved, is refused in
 * the words of the edit (`inCode`, code `inside-code`); another one that the code came to, as when a
 * blank line typed above a line that goes on a paragraph makes the line code, in those of hidden
 * changes (`would-hide-marks`). `after` is the text after the changes, with the ledger as it was,
 * and `ledger` the changes that write the one that is going to be written, or why it can't be
 * written: a new comment's anchor is a mark only with it. Most edits change one line, which tells
 * that no marker comes into code (`keepsIndentedCode`); for the others, the file and both views
 * are read.
 */
function assertOutOfIndentedCode(
  text: string,
  before: Parsed,
  after: string,
  parsedAfter: Parsed,
  ledger: readonly TextChange[] | EditError | undefined,
  changes: readonly TextChange[],
  options: CommitOptions,
): void {
  // A ledger that can't be written is refused where it is written, after the other checks.
  if (ledger instanceof EditError) return;
  const limit = parsedAfter.ledgerRange?.from ?? after.length;
  if (!mayIndent(after.slice(0, limit))) return;
  const full = ledger ? applyChanges(after, ledger) : after;
  const end = Math.min(limit, ...(ledger ?? []).map((change) => change.from));
  const views = options.views ?? viewsOnce();
  const bodyEnd = before.ledgerRange?.from ?? text.length;
  if (keepsIndentedCode(text, bodyEnd, full, changes, views)) return;
  const now = markersInIndentedCode(full, end, views);
  if (now.size === 0) return;
  const was = markersInIndentedCode(text, bodyEnd, views);
  const grown = [...now].filter(([id, count]) => count > (was.get(id) ?? 0)).map(([id]) => id);
  if (grown.length === 0) return;
  // The markers the changes wrote: those in text that a change inserted.
  const inserted: Range[] = [];
  let delta = 0;
  for (const change of changes) {
    const from = change.from + delta;
    inserted.push({ from, to: from + change.insert.length });
    delta += change.insert.length - (change.to - change.from);
  }
  const written = scan(full.slice(0, end)).markers.some(
    (marker) =>
      grown.includes(marker.id) &&
      inserted.some((range) => range.from < marker.to && marker.from < range.to),
  );
  if (written && options.inCode !== undefined) throw new EditError(options.inCode, 'inside-code');
  const marks = [...before.marks, ...parsedAfter.marks];
  const comment = marks.some((mark) => mark.kind === 'cmt' && grown.includes(mark.id));
  throw hiddenError(options.removes === true, comment);
}

/** Warnings about how the markers of a mark fit together, which a change must not cause. */
const MARK_STRUCTURE = new Set([
  'unclosed-mark',
  'unopened-close',
  'kind-mismatch',
  'duplicate-id',
]);

/**
 * Changes of `text` that give `current`, which is `text` with `changes`, the `repairs` as well. A
 * repair that lies inside text a change inserted becomes part of that text; one outside is moved
 * back to the offsets of `text`. When neither works, one change covers the lot.
 */
export function spliceRepairs(
  text: string,
  changes: readonly TextChange[],
  current: string,
  repairs: readonly TextChange[],
): TextChange[] {
  const result = changes.map((change) => ({ ...change }));
  const regions: { index: number; start: number; end: number }[] = [];
  let delta = 0;
  changes.forEach((change, index) => {
    const start = change.from + delta;
    regions.push({ index, start, end: start + change.insert.length });
    delta += change.insert.length - (change.to - change.from);
  });
  const outside: TextChange[] = [];
  // From the end, so that a repair does not move the ones before it.
  for (const repair of repairs.toSorted((a, b) => b.from - a.from || b.to - a.to)) {
    const region = regions.find(
      (r) => r.end > r.start && r.start <= repair.from && repair.to <= r.end,
    );
    const target = region ? result[region.index] : undefined;
    if (region && target) {
      target.insert =
        target.insert.slice(0, repair.from - region.start) +
        repair.insert +
        target.insert.slice(repair.to - region.start);
      continue;
    }
    // A repair that takes away some of the text a change inserted and some besides (a delimiter row
    // written by one decision and removed with its row by the next) can't be moved back whole: one
    // change covers the lot.
    if (
      repair.to > repair.from &&
      regions.some((r) => r.end > r.start && r.start < repair.to && repair.from < r.end)
    ) {
      return singleChange(text, applyChanges(current, repairs));
    }
    // A repair keeps clear of the text a change takes away: a range shrinks, a point sits at the
    // start of it.
    const point = repair.to === repair.from;
    const from = positionBefore(changes, repair.from, !point);
    const to = point ? from : positionBefore(changes, repair.to, false);
    if (from === null || to === null || to < from) {
      return singleChange(text, applyChanges(current, repairs));
    }
    outside.push({ from, to, insert: repair.insert });
  }
  const all = [...result, ...outside].sort((a, b) => a.from - b.from || a.to - b.to);
  for (let i = 1; i < all.length; i++) {
    const previous = all[i - 1];
    const next = all[i];
    if (previous && next && next.from < previous.to) {
      return singleChange(text, applyChanges(current, repairs));
    }
  }
  return all;
}

/**
 * The changes with the repairs that format §3.3 asks for, until there are none: an opener at the
 * start of a block gets its own line, and one that is not at the start of a block loses the
 * carrier of its old place.
 */
function withPlacement(
  text: string,
  changes: TextChange[],
  before: Parsed,
  ledger: Ledger,
  strict: boolean,
  removing: boolean,
  keepLedger = false,
): TextChange[] {
  // What is read in the body, with the ledger that is going to be written: a comment is only a
  // mark once its thread is there. A ledger that is kept is the one in the text.
  const read = (body: string) =>
    parse(keepLedger ? body : applyChanges(body, setLedger(body, normalizeLedger(body, ledger))));
  let result = changes;
  let current = applyChanges(text, result);
  if (strict && leavesPhantomCarrier(text, changes, current, before)) {
    throw new EditError(
      "A change can't be made here: a marker would be left alone on its line, and the line break after it would be read as part of it.",
      'no-legal-placement',
    );
  }
  // Each round puts right what the round before left, as when the openers on the lines under a
  // bullet that is typed over come onto its line one after the other, each losing its carrier: as
  // many rounds as there are markers, and more. Repairs still left after that are refused, never
  // written, and so are repairs that make no progress: a round that brings back a text an earlier
  // round had, which the rounds after it would only go round again.
  const rounds = 24 + 2 * before.marks.reduce((n, mark) => n + mark.segments.length, 0);
  let seen: Set<string> | undefined;
  const step = (repairs: readonly TextChange[]) => {
    seen ??= new Set([fingerprint(current)]);
    result = spliceRepairs(text, result, current, repairs);
    current = applyChanges(text, result);
    const print = fingerprint(current);
    if (seen.has(print)) throw new EditError(UNPLACED, 'no-legal-placement');
    seen.add(print);
  };
  // A decision that takes away the marker after an opener on its line can make the line break
  // after it the opener's carrier. This is looked at before the other repairs, which write
  // carriers of their own.
  for (let round = 0; removing; round++) {
    const moves = movedPhantoms(text, result, current, before);
    if (moves.length === 0) break;
    if (round === rounds) throw new EditError(UNPLACED, 'no-legal-placement');
    step(moves);
  }
  for (let round = 0; ; round++) {
    const repairs = placementRepairs(text, result, current, before, read(current), removing);
    if (repairs.length === 0) break;
    if (round === rounds) throw new EditError(UNPLACED, 'no-legal-placement');
    step(repairs);
  }
  return result;
}

/** A short print of a text: its length and a 32-bit FNV-1a hash of it. */
function fingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${text.length}:${hash >>> 0}`;
}

/** The message of a change whose markers can't all be put where format §3.3 wants them. */
const UNPLACED =
  "The markers next to this change can't all be put where they belong. Decide the changes next to it first.";

/** The number of markers of each mark that start a line that has other text. */
function lineStarts(parsed: Parsed): Map<string, number> {
  const counts = new Map<string, number>();
  for (const warning of parsed.warnings) {
    if (warning.code === 'line-start-marker' && warning.id !== undefined) {
      counts.set(warning.id, (counts.get(warning.id) ?? 0) + 1);
    }
  }
  return counts;
}

/** Throws when the changes made a marker of one of these marks start a line that has other text, or
 * when `strict`, any marker at all: an edit leaves no more of them than the file had. */
function assertPlaced(
  before: Parsed,
  after: Parsed,
  written: readonly string[],
  strict: boolean,
  exempt: readonly string[],
): void {
  const was = lineStarts(before);
  const now = lineStarts(after);
  // The marks that were made past the ledger have nothing to say about their lines.
  const total = (counts: Map<string, number>) =>
    [...counts].reduce((sum, [id, count]) => sum + (exempt.includes(id) ? 0 : count), 0);
  if (
    written.some((id) => (now.get(id) ?? 0) > (was.get(id) ?? 0)) ||
    (strict && total(now) > total(was))
  ) {
    throw new EditError(
      "A change can't be marked here: a marker would start a line of a paragraph, where a renderer would read the rest of the line as raw HTML.",
      'no-legal-placement',
    );
  }
}

/**
 * Throws when a decision changes a view that it must leave as it is: accepting leaves the newest
 * view, rejecting leaves the original, and deleting a thread leaves both. A decision that does
 * not is a bug of the file's markers, not a choice: a marker that is taken away lets text next to
 * it be read otherwise (`* ` as a bullet that a split's break takes, a line break as the carrier of
 * an opener), and the text that is lost or moved is lost from the document without a word.
 */
function assertViewsKept(text: string, after: string, keeps: 'newest' | 'original' | 'both'): void {
  for (const [name, view] of [
    ['newest', newestView],
    ['original', originalView],
  ] as const) {
    if (keeps !== 'both' && keeps !== name) continue;
    if (paragraphBreaks(view(after).text) !== paragraphBreaks(view(text).text)) {
      throw new EditError(
        `This decision would change the ${name} text, because a marker that goes lets the text next to it be read otherwise. Decide the changes next to it first.`,
        'no-legal-placement',
      );
    }
  }
}

/**
 * A view with each run of two or more line breaks, with only spaces or tabs between them, written
 * as one paragraph break, and without the blank lines at the very start of its body (after front
 * matter, format §3.8) and at its end: Markdown reads them the same, so the views check counts them
 * the same. Everything else is compared as it is: whether there is a break between two lines of
 * text at all, a single line break, `>` and `_`.
 */
export function paragraphBreaks(view: string): string {
  const start = bodyStart(view);
  const body = view
    .slice(start)
    .replace(/^(?:[ \t]*\r?\n)+/, '')
    .replace(/(?:\r?\n[ \t]*)+$/, '')
    .replace(/\r?\n(?:[ \t]*\r?\n)+/g, '\n\n');
  return view.slice(0, start) + body;
}

/** What `commitEdit` can be given besides the changes. */
export interface CommitOptions {
  /** `parse(text)`, when the caller has it. */
  parsed?: Parsed;
  /** The marks this edit wrote markers of, new or not, which must stand where format §3.1 and §3.2
   * allow. */
  created?: readonly string[];
  /** Marks that were made past the ledger, where the placement rules have nothing to say. */
  exempt?: readonly string[];
  /** The changes take markers away and write none: a decision, or the deletion of a thread. A
   * closer they leave at the start of a line is moved back to the end of the line before, or gets
   * a line of its own, and they leave no more markers at the start of a line than the file had. */
  removes?: boolean;
  /** The view a decision must leave as it is (`removes`): the one it decides toward, or both. */
  keeps?: 'newest' | 'original' | 'both';
  /** The ledger is left as it is, unread and unwritten: the edit makes no mark and removes none,
   * so nothing in it changes. An edit with Track Changes off is one (format §3.10). */
  keepLedger?: boolean;
  /** Looks at the new body, and what `parse` reads in it, before the ledger is written, with the
   * changes that made it, in offsets of the text before. It may throw. */
  verify?: (after: string, parsed: Parsed, changes: readonly TextChange[]) => void;
  /** The words of the refusal of a marker that the changes write in indented code, where every
   * renderer would show it (format §2.1), in the words of the same edit inside fenced code. Without
   * them, it is refused as hiding a change. */
  inCode?: string;
  /** The views of the text before and after the changes, when the caller works them out too. */
  views?: Views;
}

/**
 * Finishes an edit: the body changes, and the ledger that goes with them. The ledger is put in
 * document order and loses the entries of marks that are gone (`normalizeLedger`), then written
 * with `setLedger`, which throws when the ledger in the file can't be read. The result is a list
 * of changes of `text`.
 *
 * An opener that the changes leave at the start of a block gets the form of format §3.3, and one
 * they take out of it loses its carrier (`placementRepairs`). Marks that are read in `text` must
 * be read in the new body too, unless the changes remove them (`would-hide-marks`). The markers of
 * the marks in `created` must not start a line, and an edit that has `created`, or that `removes`
 * markers (a decision), leaves no more markers at the start of a line than the file had, whose they
 * are (`no-legal-placement`). What a decision leaves at the start of a line is put right where it
 * can be (`scaffolds`); an edit that leaves a closer there is refused.
 *
 * @throws EditError when the ledger can't be read or can't be added, when other marks would be
 *   hidden, or when a marker would start a line.
 */
export function commitEdit(
  text: string,
  body: readonly TextChange[],
  ledger: Ledger,
  options: CommitOptions = {},
): TextChange[] {
  const sorted = body.toSorted((a, b) => a.from - b.from || a.to - b.to);
  const before = sorted.length > 0 ? (options.parsed ?? parse(text)) : undefined;
  const removing = options.removes === true;
  const changes = before
    ? withPlacement(
        text,
        sorted,
        before,
        ledger,
        options.created !== undefined,
        removing,
        options.keepLedger,
      )
    : sorted;
  const after = applyChanges(text, changes);
  // The ledger that goes with the new body, worked out once. One that can't be written is refused
  // after the other checks.
  let ledgerChanges: TextChange[] | EditError | undefined;
  if (!options.keepLedger) {
    try {
      ledgerChanges = setLedger(after, normalizeLedger(after, ledger));
    } catch (error) {
      if (!(error instanceof EditError)) throw error;
      ledgerChanges = error;
    }
  }
  if (before) {
    const parsedAfter = parse(after);
    options.verify?.(after, parsedAfter, changes);
    assertOutOfIndentedCode(text, before, after, parsedAfter, ledgerChanges, changes, options);
    assertMarksKept(before, parsedAfter, sorted, changes, removing);
    if (options.keeps) assertViewsKept(text, after, options.keeps);
    assertPlaced(
      before,
      parsedAfter,
      options.created ?? [],
      options.created !== undefined || removing,
      options.exempt ?? [],
    );
  }
  if (ledgerChanges === undefined) return changes;
  if (ledgerChanges instanceof EditError) throw ledgerChanges;
  return joinChanges(text, changes, after, ledgerChanges);
}
