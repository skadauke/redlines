// What the editing functions share (format §3.6, §4, §5): where the markers are, moving a position
// out of one, the file's line breaks, and writing the ledger once the body has changed.

import { applyChanges } from './changes.ts';
import { EditError } from './errors.ts';
import { normalizeLedger } from './ledger-order.ts';
import { setLedger } from './ledger-write.ts';
import { scan } from './scan.ts';
import type { Ledger, MarkRange, Parsed, Person, Segment, TextChange } from './types.ts';

export type Eol = '\r\n' | '\n';

/** The file's line break: CRLF when it has any, as `setLedger` writes them. */
export function eolOf(text: string): Eol {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

/** `s` with its line breaks written as `eol`. */
export function inEol(s: string, eol: Eol): string {
  return s.replace(/\r\n?|\n/g, eol);
}

/** A stretch of the file that is not text: one marker, or the ledger with the blank line before it. */
export interface MarkerRange {
  from: number;
  to: number;
  /** The mark a marker belongs to. Absent for the ledger. */
  mark?: MarkRange;
  segment?: Segment;
  role: 'open' | 'close' | 'ledger';
}

/** Every marker of the parsed marks, and the ledger, in the order they appear. */
export function markerRanges(parsed: Parsed): MarkerRange[] {
  const ranges: MarkerRange[] = [];
  for (const mark of parsed.marks) {
    for (const segment of mark.segments) {
      ranges.push({ ...segment.open, mark, segment, role: 'open' });
      if (segment.close) ranges.push({ ...segment.close, mark, segment, role: 'close' });
    }
  }
  if (parsed.ledgerRange) ranges.push({ ...parsed.ledgerRange, role: 'ledger' });
  return ranges.sort((a, b) => a.from - b.from || a.to - b.to);
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
 * Finishes an edit: the body changes, and the ledger that goes with them. The ledger is put in
 * document order and loses the entries of marks that are gone (`normalizeLedger`), then written
 * with `setLedger`, which throws when the ledger in the file can't be read. The result is a list
 * of changes of `text`.
 *
 * `verify` sees the new body before the ledger is written, and may throw.
 *
 * @throws EditError when the ledger can't be read or can't be added.
 */
export function commitEdit(
  text: string,
  body: readonly TextChange[],
  ledger: Ledger,
  verify?: (after: string) => void,
): TextChange[] {
  const sorted = body.toSorted((a, b) => a.from - b.from || a.to - b.to);
  const after = applyChanges(text, sorted);
  verify?.(after);
  const ledgerChanges = setLedger(after, normalizeLedger(after, ledger));
  return joinChanges(text, sorted, after, ledgerChanges);
}
