// Comments (format §4): a thread is anchored in the body and stored in the ledger under the same
// id. Adding a thread writes its anchor and its entry; replying, resolving and reopening change
// only the ledger; deleting a thread removes both.
//
// In v0.1 a range is written as one segment, even across blocks, and its markers go where the
// range ends: the placement rules of format §3.1 to §3.3 are not applied.

import { EditError } from './errors.ts';
import {
  addPerson,
  commitEdit,
  markerRanges,
  snapOut,
  visibleText,
  workingLedger,
} from './edit-support.ts';
import { idsIn, newId } from './ids.ts';
import { parse } from './parse.ts';
import { scan } from './scan.ts';
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

/** Throws when the anchor of a new comment would not be read: its markers are in code or in an
 * HTML comment. A comment anchor that isn't in the ledger yet is not a mark to `parse`, so the
 * scan of the new text is asked. */
function checkAnchor(after: string, id: string, range: boolean): void {
  const markers = scan(after).markers.filter((marker) => marker.id === id);
  const opens = markers.some((marker) => marker.type === 'open');
  const closes = !range || markers.some((marker) => marker.type === 'close');
  if (!opens || !closes) {
    throw new EditError(
      "A comment can't be anchored inside code or an HTML comment, where its markers would not be read. Anchor it on the whole code span or comment instead.",
      'inside-code',
    );
  }
}

/**
 * Adds a comment thread by `ctx.author` on a range of the file, which is written as
 * `<!--cmt ID-->text<!--/ID-->`, or on a point when the range is empty: `<!--cmt ID-->`. An end of
 * the range that falls inside a marker is moved out of it, so the comment covers the marker. The
 * thread records the text it covers as it reads in the newest view (`quote`), so that the comment
 * can say what it was about when the text is gone (format §4).
 *
 * @returns the changes, in offsets of `text`, and the id of the thread.
 * @throws RangeError when the range lies outside the text.
 * @throws EditError when the anchor would be inside code or an HTML comment, or when the ledger
 *   can't be read.
 */
export function addComment(
  text: string,
  range: Range,
  body: string,
  ctx: EditContext,
): { changes: TextChange[]; id: string } {
  if (range.from < 0 || range.to < range.from || range.to > text.length) {
    throw new RangeError(
      `The range ${range.from}-${range.to} is out of order or outside the text (${text.length} characters)`,
    );
  }
  const parsed = parse(text);
  const markers = markerRanges(parsed);
  const point = range.from === range.to;
  const from = snapOut(markers, range.from, false);
  const to = point ? from : snapOut(markers, range.to, true);

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

  const anchors: TextChange[] = [{ from, to: from, insert: `<!--cmt ${id}-->` }];
  if (!point) anchors.push({ from: to, to, insert: `<!--/${id}-->` });
  const changes = commitEdit(text, anchors, ledger, {
    parsed,
    verify: (after) => checkAnchor(after, id, !point),
  });
  return { changes, id };
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
    removals.push({ ...segment.open, insert: '' });
    if (segment.close) removals.push({ ...segment.close, insert: '' });
  }
  return commitEdit(text, removals, ledger, { parsed });
}
