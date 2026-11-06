// What the editing functions share (format §3.6, §4, §5): where the markers are, moving a position
// out of one, the file's line breaks, and writing the ledger once the body has changed.

import { applyChanges } from './changes.ts';
import { EditError } from './errors.ts';
import { normalizeLedger } from './ledger-order.ts';
import { setLedger } from './ledger-write.ts';
import { parse } from './parse.ts';
import { openerRange } from './blocks.ts';
import { forward, leavesPhantomCarrier, movedPhantoms, placementRepairs } from './placement.ts';
import { scan } from './scan.ts';
import { newestView, originalView } from './views.ts';
import type { Ledger, Parsed, Person, Range, TextChange } from './types.ts';

// The file's line breaks, which views need without the rest of this.
export { eolOf, inEol } from './changes.ts';
export type { Eol } from './changes.ts';

// The markers of a file, which views and the reading of formats need without the rest of this.
export { markerRanges } from './markers.ts';
export type { MarkerRange } from './markers.ts';
import type { MarkerRange } from './markers.ts';

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
    throw new EditError(
      removing
        ? 'This decision would hide other changes in code or an HTML comment, where they would no longer be read. Decide the changes next to it first.'
        : 'This edit would hide other changes in code or an HTML comment, where they would no longer be read. Accept or reject them first, or edit the source in Raw with Track Changes off.',
      'would-hide-marks',
    );
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
  // A decision that takes away the marker after an opener on its line can make the line break
  // after it the opener's carrier. This is looked at before the other repairs, which write
  // carriers of their own.
  for (let round = 0; removing && round < 24; round++) {
    const moves = movedPhantoms(text, result, current, before);
    if (moves.length === 0) break;
    result = spliceRepairs(text, result, current, moves);
    current = applyChanges(text, result);
  }
  for (let round = 0; round < 24; round++) {
    const repairs = placementRepairs(text, result, current, before, read(current), removing);
    if (repairs.length === 0) break;
    result = spliceRepairs(text, result, current, repairs);
    current = applyChanges(text, result);
  }
  return result;
}

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
 * as one paragraph break, and without the blank lines at its very start and end: Markdown reads
 * them the same, so the views check counts them the same. Everything else is compared as it is:
 * whether there is a break between two lines of text at all, a single line break, `>` and `_`.
 */
function paragraphBreaks(view: string): string {
  return view
    .replace(/^(?:[ \t]*\r?\n)+/, '')
    .replace(/(?:\r?\n[ \t]*)+$/, '')
    .replace(/\r?\n(?:[ \t]*\r?\n)+/g, '\n\n');
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
  /** Looks at the new body, and what `parse` reads in it, before the ledger is written. It may
   * throw. */
  verify?: (after: string, parsed: Parsed) => void;
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
  if (before) {
    const parsedAfter = parse(after);
    options.verify?.(after, parsedAfter);
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
  if (options.keepLedger) return changes;
  const ledgerChanges = setLedger(after, normalizeLedger(after, ledger));
  return joinChanges(text, changes, after, ledgerChanges);
}
