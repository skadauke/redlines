// The mark of a tracked alignment change is a point at the end of the text of the header's last cell
// (format §3.7, #281), and what Markdown readers that don't know the markers make of the text in front of it
// is what it must not change: a backslash right before it would escape its `<`, and a delimiter run right
// before it reads otherwise once `<` follows it. The writer of the mark, and every edit written beside it,
// hold it to this, so that the file reads as its views do.

import { lineEnd, lineStart } from './blocks.ts';
import { EditError } from './errors.ts';
import { isSpace } from './flanking.ts';
import { isAlignOps, opsOf } from './format-ops.ts';
import { inspectPlace, isWord } from './inline.ts';
import { markerRanges } from './markers.ts';
import { readRowCells } from './table.ts';
import type { MarkRange, Parsed, Range, TextChange } from './types.ts';

/** Whether a mark is the point form of an alignment change: an `align=` format change of one
 * segment with no closer (format §3.7). The writer puts it at the end of the header's last cell. */
export function isAlignPoint(mark: MarkRange): boolean {
  const [segment, ...more] = mark.segments;
  return (
    mark.kind === 'fmt' &&
    segment !== undefined &&
    more.length === 0 &&
    segment.close === undefined &&
    isAlignOps(opsOf(mark, segment))
  );
}

/** Whether a marker at `position` of `body` (the markers in `hidden` are not text) would be read
 * otherwise (format §3.1): after an odd run of backslashes, which would escape it, or where
 * `inspectPlace` finds a construct or a refusal. With `flank`, also where it finds a delimiter whose
 * flanking the marker would change by the rule that keeps a marker off an underscore: the writer's
 * (an underscore at the end of the text, as in `_b_`, is refused: Call 9). An edit written beside a
 * mark that is there already is held to the exact checks only: a marker after `Price_` reads as the
 * view does, and a key is not refused for a rule that is stricter than Markdown. */
export function readsOtherwise(
  body: string,
  hidden: readonly Range[],
  position: number,
  flank = true,
): boolean {
  let slashes = 0;
  while (body[position - 1 - slashes] === '\\') slashes++;
  if (slashes % 2 === 1) return true;
  const place = inspectPlace(body, hidden, position);
  return place.kind === 'refuse' || place.kind === 'construct' || (flank && place.kind === 'flank');
}

/**
 * Whether a mark written right after `before`, the text of a cell as it stands in the file with its
 * markers, changes how the run of `*` or `_` that ends `before` reads. The mark starts with `<`, which
 * Markdown counts as punctuation: a run that closes an emphasis, with punctuation in front of it (a full
 * stop, or the `>` that ends a marker), can open one as well once `<` follows it, and the rule of three
 * then keeps it from closing an earlier run of the same character whose size and its own add up to a
 * multiple of three (`**a .*`), unless both are multiples of three. A run after a letter, a digit or white
 * space reads as it did, and so does a run with no such earlier one. A `~` has no such rule: GFM's
 * strikethrough closes the earlier run whether the run can open too or not. The text is the file's,
 * markers included, because that is what other Markdown readers read, and the views leave out the
 * markers that make the difference.
 */
export function changesRun(before: string): boolean {
  const char = before.at(-1);
  if (char !== '*' && char !== '_') return false;
  const runs = runsOf(before, char);
  const closer = runs.at(-1);
  // The last character is escaped by a backslash: it is text, and no delimiter.
  if (!closer || closer.from + closer.size !== before.length) return false;
  const beside = before[closer.from - 1];
  if (beside === undefined || isSpace(beside) || isWord(beside)) return false;
  return runs.slice(0, -1).some(({ size }) => {
    const sum = size + closer.size;
    return sum % 3 === 0 && !(size % 3 === 0 && closer.size % 3 === 0);
  });
}

/** The runs of `char` in `text` that Markdown reads as delimiters, where they start and how long they
 * are: a character that a backslash escapes is text, and cuts a run. */
function runsOf(text: string, char: string): { from: number; size: number }[] {
  const runs: { from: number; size: number }[] = [];
  for (let at = 0; at < text.length;) {
    if (text[at] === '\\') at += 2;
    else if (text[at] === char) {
      let to = at;
      while (text[to] === char) to++;
      runs.push({ from: at, size: to - at });
      at = to;
    } else at++;
  }
  return runs;
}

/** Whether the mark that stands at `at`, the end of the text of a header's last cell that starts at
 * `from`, is read where it stands in `text` (`parsed` is its reading): not after a backslash, not in a
 * construct, and without changing a delimiter run that it follows. `flank` is `readsOtherwise`'s. */
export function placeReads(
  text: string,
  parsed: Parsed,
  from: number,
  at: number,
  flank = true,
): boolean {
  return (
    !readsOtherwise(text, markerRanges(parsed), at, flank) && !changesRun(text.slice(from, at))
  );
}

/** Whether a point alignment change is not read where it stands in `text`, in the cell that its line
 * holds it in. A mark that no cell of its line holds the end of is read where it is (a merge can leave
 * one elsewhere), and is no matter. */
function misread(text: string, parsed: Parsed, mark: MarkRange): boolean {
  const open = mark.segments[0]?.open;
  if (!open) return false;
  const { cells } = readRowCells(text, lineStart(text, open.from), lineEnd(text, open.to));
  const cell = cells.find((candidate) => candidate.from <= open.from && open.from <= candidate.to);
  if (!cell || open.from < cell.textFrom) return false;
  // The edits' own reading: the writer's rule about an underscore is for where the mark is written.
  return !placeReads(text, parsed, cell.textFrom, open.from, false);
}

/**
 * Throws when an edit leaves a point alignment change where it is read otherwise than it was before the
 * edit (`text` and `after` are the file before and after it, `parsed` and `parsedAfter` their readings,
 * `changes` the edit's, in offsets of `text`): a backslash typed or left right in front of it, which
 * escapes its `<`, or a delimiter run that now ends the text in front of it, which the mark changes the
 * reading of (`placeReads`). The mark stands at the end of its cell, where typing lands, and a comment or
 * a format change written beside it can bring the run, so these edits are within reach; refused, in words
 * that name the change, they leave the file as it was. An edit that leaves it as it read, one that is not
 * on its line, and a file with no such mark are no matter. A decision is no edit: it may not be refused.
 *
 * @throws EditError naming the person whose alignment change it is.
 */
export function assertPointsRead(
  text: string,
  parsed: Parsed,
  after: string,
  parsedAfter: Parsed,
  changes: readonly TextChange[],
): void {
  for (const mark of parsedAfter.marks) {
    if (!isAlignPoint(mark)) continue;
    const was = parsed.marks.find((candidate) => candidate.id === mark.id);
    const open = was?.segments[0]?.open;
    // A mark that was there is looked at when an edit touches its line; a new one, always.
    if (open) {
      const from = lineStart(text, open.from);
      const to = lineEnd(text, open.to);
      if (!changes.some((change) => change.from <= to && from <= change.to)) continue;
    }
    if ((was && misread(text, parsed, was)) || !misread(after, parsedAfter, mark)) continue;
    const { by } = mark.entry;
    const name = parsedAfter.ledger.people.find((person) => person.handle === by)?.name ?? by;
    throw new EditError(
      `${name}'s alignment change is at the end of this cell, where this edit would make Markdown read it, or the text before it, otherwise. Decide it first.`,
      'no-legal-placement',
    );
  }
}
