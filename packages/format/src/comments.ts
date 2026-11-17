// Comments (format §4): a thread is anchored in the body and stored in the ledger under the same
// id. Adding a thread writes its anchor and its entry; replying, resolving and reopening change
// only the ledger; deleting a thread removes both. Where the anchor's markers go is the same for a
// highlight (anchors.ts).

import { withDialect } from './dialect.ts';
import { closerRange, openerRange } from './blocks.ts';
import { aroundFences } from './div-ends.ts';
import { awayFromIncludes, type AroundInclude } from './include.ts';
import { recordIds } from './edits-widen.ts';
import { EditError } from './errors.ts';
import { addPerson, commitEdit, markerRanges, visibleText, workingLedger } from './edit-support.ts';
import type { MarkerRange } from './edit-support.ts';
import { anchorRange, assertRange, checkAnchor } from './anchors.ts';
import type { AnchorWords } from './anchors.ts';
import { idsIn, newId } from './ids.ts';
import { parse } from './parse.ts';
import { decisionsHold, hasTableChange, nearRanges, refusalsOf } from './table-settle.ts';
import { readTables } from './table.ts';
import {
  beforeHeaderPipe,
  commentAcrossRows,
  inPendingRow,
  pastRowMark,
  rowWidenings,
} from './table-rules.ts';
import type { TableRead } from './table.ts';
import { applyChanges, eolOf } from './changes.ts';
import type { EditContext, Ledger, Parsed, Range, TextChange, Thread } from './types.ts';

/** The thread with this id. When there is none, a ledger that can't be read is the reason to give
 * if it is the cause: it has no threads as far as the parser can tell. */
function findThread(text: string, parsed: Parsed, id: string): Thread {
  const found = parsed.ledger.comments.find((thread) => thread.id === id);
  if (found) return found;
  commitEdit(text, [], parsed.ledger);
  throw new EditError(`There is no comment thread with the id ${id}.`, 'unknown-id');
}

function replaceThread(ledger: Ledger, thread: Thread): void {
  ledger.comments = ledger.comments.map((old) => (old.id === thread.id ? thread : old));
}

/** Why a comment can't be anchored in code, fenced, indented or in a code span, or in an HTML
 * comment (format §2.1). */
const IN_CODE =
  "A comment can't be anchored inside code or an HTML comment, where its markers would not be read. Anchor it on the whole code span or comment instead.";

/** What a refused comment says (see `AnchorWords`). */
const COMMENT_WORDS: AnchorWords = {
  frontMatter: "A comment can't be anchored in front matter yet.",
  noPlace: 'There is no place for the markers of this comment.',
  inCode: IN_CODE,
};

/**
 * Adds a comment thread by `ctx.author` on a range of the file, which is written as
 * `<!--cmt ID-->text<!--/ID-->`, or on a point when the range is empty: `<!--cmt ID-->`. An end of
 * the range that falls inside a marker is moved out of it, so the comment covers the marker, and a
 * range that reaches into the ledger ends where the body does. The thread records the text it
 * covers as it reads in the newest view (`quote`), so that the comment can say what it was about
 * when the text is gone (format §4).
 *
 * @returns the changes, in offsets of `text`, and the id of the thread.
 * @throws RangeError when the range lies outside the text.
 * @throws EditError when the anchor would be inside code or an HTML comment, or where no place keeps
 *   the text as it reads, or when the ledger can't be read.
 */
export function addComment(
  text: string,
  range: Range,
  body: string,
  ctx: EditContext,
  rowsWidened = false,
  settled = false,
): { changes: TextChange[]; id: string } {
  return withDialect(ctx.dialect, () => {
    const recorded = recordIds(ctx);
    if (!rowsWidened) ctx = recorded.ctx;
    assertRange(text, range);
    const parsed = parse(text);
    const markers = markerRanges(parsed);
    // An end on a `:::` fence goes to the whole div, or into its body (div-ends.ts); an end on the
    // line of a Quarto include goes around it (include.ts).
    const fenced = aroundFences(text, range);
    let around: AroundInclude;
    if (fenced.whole) around = fenced.whole;
    else {
      let placed = anchorRange(text, parsed, markers, fenced.inner, COMMENT_WORDS);
      placed = pastPendingRowMarks(text, parsed, markers, placed);
      placed = beforePipes(text, parsed, markers, placed, COMMENT_WORDS);
      around = fenced.apply(awayFromIncludes(text, placed));
    }
    const { from, to } = around;
    const point = from === to;

    const id = newId(idsIn(text), ctx.random);
    const thread: Thread = {
      id,
      by: ctx.author.handle,
      at: ctx.time,
      likes: [],
      replies: [],
      text: body,
    };
    const quote = point ? '' : visibleText(text, markers, from, to);
    if (quote !== '') thread.quote = quote;
    const ledger = workingLedger(parsed.ledger);
    addPerson(ledger, ctx.author);
    ledger.comments.push(thread);

    // Next to an include, each marker is a line of its own, and the line break goes with it.
    const eol = eolOf(text, parsed.ledgerRange);
    const anchors: TextChange[] = [
      { from, to: from, insert: `<!--cmt ${id}-->${around.openerLine ? eol : ''}` },
    ];
    if (!point) {
      anchors.push({
        from: to,
        to,
        insert: `${around.closerLine ? eol : ''}<!--/${id}-->`,
      });
    }
    const changes = commitEdit(text, anchors, ledger, {
      parsed,
      created: [id],
      verify: (after) => checkAnchor(after, id, !point, IN_CODE),
      inCode: IN_CODE,
    });
    const after = applyChanges(text, changes);
    const across = acrossMovedRows(after, id, rowsWidened);
    if (!across) {
      // In a table with a change pending, the ends stand where no decision of it becomes impossible (#376).
      if (settled || !hasTableChange(text)) return { changes, id };
      const before = refusalsOf(text);
      if (decisionsHold(text, changes, before)) return { changes, id };
      for (const candidate of nearRanges(text, range, 60)) {
        try {
          const found = addComment(text, candidate, body, recorded.replay(), rowsWidened, true);
          if (decisionsHold(text, found.changes, before)) return found;
        } catch (error) {
          if (!(error instanceof EditError)) throw error;
        }
      }
      return { changes, id };
    }
    // A comment that runs from one row into another while a move is pending can't be left as a point
    // when the move is decided: its ends are taken to rows that are not pending (format §3.12).
    if (rowsWidened) throw across.error;
    const table = readTables(text, parsed).find(
      (read) => range.from <= read.to && read.from <= range.to,
    );
    for (const candidate of table ? rowWidenings(table, text, range) : []) {
      try {
        return addComment(text, candidate, body, recorded.replay(), true);
      } catch (error) {
        if (!(error instanceof EditError)) throw error;
      }
    }
    throw across.error;
  });
}

/**
 * `placed`, with an end that would stand in front of the mark of an inserted or moved row, at the
 * start of its first cell, or between the mark and its space, moved past the mark and its space:
 * there it hides the mark from the table, and the row could not be decided. The comment then
 * covers the mark, which is no text, and the row stays decidable in every order.
 */
function pastPendingRowMarks(
  text: string,
  parsed: Parsed,
  markers: readonly MarkerRange[],
  placed: Range,
): Range {
  if (!text.includes(' row-->')) return placed;
  let { from, to } = placed;
  for (const table of readTables(text, parsed)) {
    from = pastRowMark(table, text, from);
    to = pastRowMark(table, text, to);
  }
  if (from === placed.from && to === placed.to) return placed;
  // Where the ends are now, the rules of every anchor hold again.
  const range = { from, to: Math.max(from, to) };
  return anchorRange(text, parsed, markers, range, COMMENT_WORDS);
}

/**
 * `placed`, with an end after the closing pipe of a header moved in front of it (`beforeHeaderPipe`).
 */
export function beforePipes(
  text: string,
  parsed: Parsed,
  markers: readonly MarkerRange[],
  placed: Range,
  words: AnchorWords,
): Range {
  let { from, to } = placed;
  const tables = readTables(text, parsed);
  for (const table of tables) {
    from = beforeHeaderPipe(table, text, from);
    to = beforeHeaderPipe(table, text, to);
  }
  if (from === placed.from && to === placed.to) return placed;
  // Where the rules of an anchor hold again, which may be after the pipe once more (a delimiter run
  // that the marker would split): then the end goes on, further in front of the pipe.
  const after = (at: number) => tables.some((table) => beforeHeaderPipe(table, text, at) !== at);
  let want = Math.max(from, to);
  let moved = anchorRange(text, parsed, markers, { from, to: want }, words);
  for (let step = 0; step < 24 && (after(moved.to) || after(moved.from)); step++) {
    // In front of the marker that it is in or after, or a character back.
    const inside = markers.find((marker) => marker.from < want && want <= marker.to);
    want = Math.max(0, inside ? inside.from : want - 1);
    from = Math.min(from, want);
    moved = anchorRange(text, parsed, markers, { from, to: Math.max(from, want) }, words);
  }
  return moved;
}

/**
 * A comment that would run from one row of a table into another, in a table with a row move pending,
 * is refused when it is made: the move could then be accepted but not rejected. (A row with no pipe
 * at its start can't begin with a marker, so a comment on its first word starts at the end of the
 * row above.) The words name the person who moved the rows.
 */
function acrossMovedRows(
  after: string,
  id: string,
  widened: boolean,
): { error: EditError; table: TableRead } | undefined {
  if (!after.includes(' row-->')) return undefined;
  const parsed = parse(after);
  for (const table of readTables(after, parsed)) {
    const moved = table.rows.find((row) => row.insertion?.entry.move !== undefined);
    if (!moved?.insertion) continue;
    const across = commentAcrossRows(table, parsed);
    if (across?.mark.id !== id) continue;
    // Widened to rows that are not pending, no decision of a row takes an end away.
    const segment = across.mark.segments[0];
    if (
      widened &&
      segment?.close &&
      !inPendingRow(table, after, segment.open.from) &&
      !inPendingRow(table, after, segment.close.from)
    ) {
      continue;
    }
    const by = moved.insertion.entry.by;
    const name = parsed.ledger.people.find((p) => p.handle === by)?.name ?? by;
    return {
      error: new EditError(
        `${name}'s move of rows in this table is pending, and this comment would run from one row into the next. Decide the move first, or comment inside one row.`,
        'no-legal-placement',
      ),
      table,
    };
  }
  return undefined;
}

/**
 * Adds a reply to a thread. Replying to a resolved thread reopens it, as in Google Docs (format §4).
 *
 * @throws EditError when there is no such thread, or the ledger can't be read.
 */
export function reply(
  text: string,
  threadId: string,
  body: string,
  ctx: EditContext,
): TextChange[] {
  const parsed = parse(text);
  const thread = findThread(text, parsed, threadId);
  const ledger = workingLedger(parsed.ledger);
  addPerson(ledger, ctx.author);
  const id = newId(idsIn(text), ctx.random);
  const next: Thread = {
    ...thread,
    replies: [...thread.replies, { id, by: ctx.author.handle, at: ctx.time, text: body }],
  };
  delete next.resolved;
  replaceThread(ledger, next);
  return commitEdit(text, [], ledger);
}

/**
 * Marks a thread resolved by `ctx.author`. A thread that is resolved already stays as it is, with
 * whoever resolved it first.
 *
 * @throws EditError when there is no such thread, or the ledger can't be read.
 */
export function resolve(text: string, threadId: string, ctx: EditContext): TextChange[] {
  const parsed = parse(text);
  const thread = findThread(text, parsed, threadId);
  if (thread.resolved) return [];
  const ledger = workingLedger(parsed.ledger);
  addPerson(ledger, ctx.author);
  replaceThread(ledger, { ...thread, resolved: { by: ctx.author.handle, at: ctx.time } });
  return commitEdit(text, [], ledger);
}

/**
 * Reopens a resolved thread. A thread that is open stays as it is.
 *
 * @throws EditError when there is no such thread, or the ledger can't be read.
 */
export function reopen(text: string, threadId: string): TextChange[] {
  const parsed = parse(text);
  const thread = findThread(text, parsed, threadId);
  if (!thread.resolved) return [];
  const ledger = workingLedger(parsed.ledger);
  const open: Thread = { ...thread };
  delete open.resolved;
  replaceThread(ledger, open);
  return commitEdit(text, [], ledger);
}

/**
 * Deletes a thread with its replies, and its anchor: the markers go and the text stays. A thread
 * whose anchor is gone is deleted from the ledger alone.
 *
 * @throws EditError when there is no such thread, or the ledger can't be read.
 */
export function deleteThread(text: string, threadId: string): TextChange[] {
  const parsed = parse(text);
  const thread = findThread(text, parsed, threadId);
  const ledger = workingLedger(parsed.ledger);
  ledger.comments = ledger.comments.filter((old) => old.id !== thread.id);
  const anchor = parsed.marks.find((mark) => mark.id === thread.id && mark.kind === 'cmt');
  const removals: TextChange[] = [];
  for (const segment of anchor?.segments ?? []) {
    removals.push({ ...openerRange(segment), insert: '' });
    if (segment.close) removals.push({ ...closerRange(text, segment.close), insert: '' });
  }
  return commitEdit(text, removals, ledger, { parsed, removes: true, keeps: 'both' });
}
