// Highlights (format §2.2, §4): a reviewer's highlight is a range of text written as
// `<!--hl ID-->text<!--/ID-->`, with its entry in the ledger. It changes no text, so no view is
// different once it is made. It has no thread and no point form. Where its markers go is where a
// comment's go (anchors.ts), and accepting or rejecting it, which dismisses it and leaves the text
// (decide.ts), is how it is taken away.

import { anchorRange, assertRange, checkAnchor, withinBody } from './anchors.ts';
import type { AnchorWords } from './anchors.ts';
import { addPerson, commitEdit, markerRanges, workingLedger } from './edit-support.ts';
import { EditError } from './errors.ts';
import { idsIn, newId } from './ids.ts';
import { parse } from './parse.ts';
import { readTables } from './table.ts';
import { highlightAgainstRows } from './table-rules.ts';
import type { EditContext, MarkEntry, Parsed, Range, TextChange } from './types.ts';
import { viewsOnce } from './views.ts';

/** Why a highlight can't be made on a range that covers no text. */
const NO_TEXT = 'Select some text to highlight.';

/** What a person can do when the markers of a highlight have no place where they chose. */
const SELECT_OTHER = 'Select other text to highlight.';

/** What a refused highlight says (see `AnchorWords`). Code, fenced or indented or in a code span,
 * and an HTML comment, read their markers as text (format §2.1). */
const HIGHLIGHT_WORDS: AnchorWords = {
  frontMatter: "A highlight can't be made in front matter yet. Select text in the body instead.",
  noPlace: 'There is no place for the markers of this highlight.',
  inCode:
    "A highlight can't be made inside code or an HTML comment, where its markers would not be read. Highlight the whole code span or comment instead, or the text around a code block.",
};

/**
 * Whether `from`–`to`, a range of `text` whose ends are placed, covers text that reads in the newest
 * view (format §2.2): not line breaks alone, markers alone (an insertion's opener or closer, a
 * comment's or a highlight's), or a deletion alone, whose old text is in no view of the file. A
 * range that holds a deletion and text does.
 */
function coversText(text: string, from: number, to: number): boolean {
  const written = text.slice(from, to);
  // Without a marker in it all of it reads in the view, as it is written.
  if (!written.includes('<!--')) return /[^\r\n]/.test(written);
  const { text: view, map } = viewsOnce().newest(text);
  return /[^\r\n]/.test(view.slice(map.fromSource(from), map.fromSource(to)));
}

/**
 * A highlight that would leave a row of a table, into another or out of the table, is refused when
 * it is made if a row of the table is inserted or moved and still pending, as a comment that would
 * run across the rows of a table with a move pending is: a decision that takes the row of one of
 * its markers away, or moves it, would leave the other, and could not be made one way or the other.
 * A highlight has no point form to be left as. So is one that would stand in front of the mark of
 * a pending row, at the start of its first cell, where the table is read by it
 * (`highlightAgainstRows`). A row with no pipe at its start can't begin with a marker, so a
 * highlight on its first cell starts at the end of the row above, and is refused too; the words say
 * so, as "highlight inside one row" would not help it. The words name the person who made the
 * change of rows. `wanted` is the range the person asked for, and `placed` where the markers go,
 * in offsets of `text`.
 */
function refuseAcrossPendingRows(text: string, parsed: Parsed, wanted: Range, placed: Range): void {
  if (!text.includes(' row-->')) return;
  for (const table of readTables(text, parsed)) {
    const pending = table.rows.find((row) => row.insertion !== null)?.insertion;
    const trouble = pending ? highlightAgainstRows(table, text, placed) : null;
    if (!pending || !trouble) continue;
    const by = pending.entry.by;
    const name = parsed.ledger.people.find((p) => p.handle === by)?.name ?? by;
    const pendingRows = `${name}'s change of rows in this table is pending`;
    // Where the range asked for is in one row of the table, the highlight leaves it only because
    // it starts at the end of the row above.
    const rowOf = (at: number) => table.rows.findIndex((row) => row.from <= at && at <= row.to);
    const first = rowOf(wanted.from);
    const inOneRow = first !== -1 && first === rowOf(wanted.to);
    let words: string;
    if (trouble === 'hides') {
      words = `${pendingRows}, and this highlight would start at the very start of the first cell of a row that is inserted or moved, where the mark of the row is. Decide the change first, or start the highlight at the text of the row.`;
    } else if (inOneRow) {
      words = `${pendingRows}, and this highlight would start at the end of the row above, as a row with no pipe at its start can't hold a marker at its start. Decide the change first, or start the highlight after the first cell of the row.`;
    } else {
      words = `${pendingRows}, and this highlight would run from one row into the next, or out of the table. Decide the change first, or highlight inside one row.`;
    }
    throw new EditError(words, 'no-legal-placement');
  }
}

/**
 * Adds a highlight by `ctx.author` on a range of the file, which is written as
 * `<!--hl ID-->text<!--/ID-->`, with an entry for it in the ledger: its author and time, and the
 * note and group that `ctx` has. An end of the range that falls inside a marker is moved out of it,
 * so the highlight covers the marker, and the ends go where a comment's go (format §3.1 to §3.3,
 * §4): out of a link destination and an image, off a delimiter whose flanking a marker would
 * change, and off the start of a block, where its opener gets a line of its own. A range that
 * reaches into the ledger ends where the body does. No text changes.
 *
 * @returns the changes, in offsets of `text`, and the id of the highlight.
 * @throws RangeError when the range lies outside the text.
 * @throws EditError when the range covers no text that reads in the newest view, which a highlight
 *   has no form for (`empty-range`): a point, line breaks, markers or a deletion alone; or is in
 *   front matter, or would put the markers inside code or an HTML comment,
 *   or where no place keeps the text as it reads, or across rows of a table, or out of it, with a
 *   row inserted or moved and pending; and when the ledger can't be read.
 */
export function addHighlight(
  text: string,
  range: Range,
  ctx: EditContext,
): { changes: TextChange[]; id: string } {
  assertRange(text, range);
  const parsed = parse(text);
  // A range that reaches into the ledger ends where the body does, and one that is only in it is none.
  const wanted = withinBody(text, parsed, range);
  if (wanted.from === wanted.to) throw new EditError(NO_TEXT, 'empty-range');
  const markers = markerRanges(parsed);
  let placed: Range;
  try {
    placed = anchorRange(text, parsed, markers, wanted, HIGHLIGHT_WORDS);
  } catch (error) {
    // Where a marker can't go is told in words that every edit shares, which say why but not what
    // to do (format §3.1): a highlight says that too.
    if (error instanceof EditError && error.code === 'no-legal-placement') {
      throw new EditError(`${error.message} ${SELECT_OTHER}`, error.code);
    }
    throw error;
  }
  const { from, to } = placed;
  // The ends moved together, or what is between them is not text of the newest view: the range was
  // white space between blocks, or lines, or markers, or a deletion, and nothing that reads.
  if (from === to || !coversText(text, from, to)) throw new EditError(NO_TEXT, 'empty-range');

  const id = newId(idsIn(text), ctx.random);
  const entry: MarkEntry = { by: ctx.author.handle, at: ctx.time };
  if (ctx.group !== undefined) entry.group = ctx.group;
  if (ctx.note !== undefined) entry.note = ctx.note;
  const ledger = workingLedger(parsed.ledger);
  addPerson(ledger, ctx.author);
  ledger.marks[id] = entry;

  const anchors: TextChange[] = [
    { from, to: from, insert: `<!--hl ${id}-->` },
    { from: to, to, insert: `<!--/${id}-->` },
  ];
  const changes = commitEdit(text, anchors, ledger, {
    parsed,
    created: [id],
    verify: (after) => checkAnchor(after, id, true, HIGHLIGHT_WORDS.inCode),
    inCode: HIGHLIGHT_WORDS.inCode,
  });
  refuseAcrossPendingRows(text, parsed, wanted, placed);
  return { changes, id };
}
