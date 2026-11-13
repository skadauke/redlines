// What a file has waiting in it, in one line over the preview ("4 changes and 2 comments by Claude
// and Bo. Open in Redlines to review them."). The count is the editor's: the changes it lists and
// decides, as suggestions (format §6), the way the review bar counts them, and the comment threads
// that are still open, a detached one too. A resolved thread, a highlight and the history that a
// ledger keeps are not waiting for anyone.

import { isDecidable, parse, suggestions } from '@redlines/format';
import type { MarkRange, Parsed } from '@redlines/format';

/** A deleted row or column of a table, kept below it and drawn as a ghost (format §3.7). */
const isTableDeletion = (mark: MarkRange): boolean =>
  mark.kind === 'del' && /^(?:row|col)=/.test(mark.payload ?? '');

/** Whether the editor draws a mark as a change: an insertion, a deletion, a substitution, a split, a
 * format change that Accept and Reject decide, and a table's inserted or deleted row or column. */
function isDrawnChange(mark: MarkRange): boolean {
  if (mark.kind === 'sub' || mark.kind === 'split') return true;
  if (mark.kind === 'fmt') return isDecidable(mark);
  if (mark.kind === 'ins') {
    return mark.payload === undefined || mark.payload === 'row' || mark.payload === 'col';
  }
  return mark.kind === 'del';
}

/**
 * Whether a mark is a change that waits, as the editor lists them for the review bar and its counts:
 * not a comment or a highlight, and not the half of a move that stays behind (a moved row is one
 * change, the row at its new place). This is `isChange` of packages/editor/src/tracked/field.ts,
 * repeated here since the editor draws with CodeMirror and a preview takes none of that;
 * apps/desktop/src/quicklook-changes.test.ts holds the two to each other.
 */
export function isChange(mark: MarkRange): boolean {
  if (isTableDeletion(mark)) return mark.entry.move === undefined;
  if (mark.kind === 'ins' && (mark.payload === 'row' || mark.payload === 'col')) return true;
  return isDrawnChange(mark) && mark.entry.move === undefined;
}

export interface Pending {
  /** Suggestions, as "Change 3 of 17" in the review bar counts them. */
  changes: number;
  /** Threads that aren't resolved. */
  comments: number;
  /** The names of who made them, in the order of the document. */
  authors: string[];
}

/** Where a mark starts in the text. */
const startOf = (mark: MarkRange): number => mark.segments[0]?.open.from ?? 0;

/** What waits in a parsed file. */
export function pendingOf(parsed: Parsed): Pending {
  const marks = new Map(parsed.marks.map((mark) => [mark.id, mark]));
  const changes = parsed.marks.filter(isChange);
  // Every thread that isn't resolved waits, as the review rail's notes do: one whose anchor is gone
  // too, which is kept (format §4) and shown at the end of the document.
  const end = parsed.ledgerRange?.from ?? parsed.text.length;
  const open: { by: string; at: number }[] = [];
  for (const thread of parsed.ledger.comments) {
    if (thread.resolved) continue;
    const anchor = marks.get(thread.id) ?? (thread.about ? marks.get(thread.about) : undefined);
    open.push({ by: thread.by, at: anchor ? startOf(anchor) : end });
  }
  const people = new Map(parsed.ledger.people.map((person) => [person.handle, person.name]));
  const nameOf = (handle: string) =>
    people.get(handle) ?? (handle === 'unknown' ? 'someone' : handle);
  const authors = [...changes.map((mark) => ({ by: mark.entry.by, at: startOf(mark) })), ...open]
    .sort((a, b) => a.at - b.at)
    .map(({ by }) => nameOf(by));
  return {
    changes: suggestions(changes).length,
    comments: open.length,
    authors: [...new Set(authors)],
  };
}

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

/** Names as people read them: "Claude", "Claude and Bo", "Ada, Claude and Bo", and from the fourth
 * on "Ada, Claude and 2 others". */
export function namesIn(names: readonly string[]): string {
  const shown = names.length > 3 ? [...names.slice(0, 2), count(names.length - 2, 'other')] : names;
  const last = shown.at(-1) ?? '';
  return shown.length < 2 ? last : `${shown.slice(0, -1).join(', ')} and ${last}`;
}

/** The line over the preview, or null when nothing waits. */
export function noticeOf(text: string): string | null {
  const { changes, comments, authors } = pendingOf(parse(text));
  if (changes + comments === 0) return null;
  const what = [
    ...(changes > 0 ? [count(changes, 'change')] : []),
    ...(comments > 0 ? [count(comments, 'comment')] : []),
  ].join(' and ');
  const by = authors.length > 0 ? ` by ${namesIn(authors)}` : '';
  const them = changes + comments === 1 ? 'it' : 'them';
  return `${what}${by}. Open in Redlines to ${changes > 0 ? 'review' : 'read'} ${them}.`;
}
