// Review actions as intents (docs/research/multiuser.md §4.2, §4.4): a comment, a highlight, a reply,
// a resolve or reopen, and a decision, kept as what the person did, with who, when and the bytes of
// the ids the format drew. `writeReview` is the one place that writes them; `deriveReview` writes
// the same again.
//
// A decision carries the marks as the person saw them: each mark's signature, from its first marker
// to its last. Derived again on newer text, a decision on a mark that changed or is gone is not
// applied, and says which: the guard of §4.4. The same click on the same text is applied as it was.

import {
  accept,
  acceptMarks,
  addComment,
  addHighlight,
  parse,
  reject,
  rejectMarks,
  reopen,
  reply,
  resolve,
} from '@redlines/format';
import type { EditContext, MarkRange, Person, Range, TextChange } from '@redlines/format';
import { recording, replaying } from './intent.ts';

export type ReviewOp =
  | { op: 'comment'; range: Range; body: string }
  | { op: 'highlight'; range: Range }
  | { op: 'reply'; thread: string; body: string }
  | { op: 'resolve'; thread: string }
  | { op: 'reopen'; thread: string }
  /** `seen` holds the signature of each mark as the person saw it (see `markSignature`). */
  | {
      op: 'decide';
      decision: 'accept' | 'reject';
      ids: readonly string[];
      seen: readonly string[];
      many?: true;
    };

export interface ReviewIntent {
  kind: 'review';
  id: string;
  op: ReviewOp;
  author: Person;
  time: string;
  drawn: readonly (readonly number[])[];
}

/** What a caller asks of a review action. A decision's `seen` is read from `text` when not given. */
export type ReviewRequest =
  | { op: 'comment'; range: Range; body: string }
  | { op: 'highlight'; range: Range }
  | { op: 'reply'; thread: string; body: string }
  | { op: 'resolve'; thread: string }
  | { op: 'reopen'; thread: string }
  | {
      op: 'decide';
      decision: 'accept' | 'reject';
      ids: readonly string[];
      seen?: readonly string[];
      many?: true;
    };

/** The mark as a person sees it: its kind, author and every character from its first marker to its
 * last, payloads and everything inside it included. */
export function markSignature(text: string, mark: MarkRange): string {
  let from = Infinity;
  let to = 0;
  for (const segment of mark.segments) {
    from = Math.min(from, segment.open.from);
    to = Math.max(to, segment.close?.to ?? Math.max(segment.content.to, segment.open.to));
  }
  return `${mark.kind}|${mark.entry.by}|${text.slice(from, to)}`;
}

/** The signatures of the marks `ids` name in `text`; null for one that isn't there. */
function signaturesOf(text: string, ids: readonly string[]): (string | null)[] {
  const marks = parse(text).marks;
  return ids.map((id) => {
    const mark = marks.find((candidate) => candidate.id === id);
    return mark ? markSignature(text, mark) : null;
  });
}

/**
 * The changes the format writes for a review action, and the intent that says how. For a
 * comment or highlight, `id` is the one the format drew.
 *
 * @throws EditError when the format refuses it.
 */
export function writeReview(
  text: string,
  request: ReviewRequest,
  who: { author: Person; time: string; random?: (n: number) => Uint8Array },
): { changes: TextChange[]; id?: string; intent: Omit<ReviewIntent, 'id'> } {
  const drawing = recording(who.random);
  const ctx: EditContext = { author: who.author, time: who.time, random: drawing.random };
  let changes: TextChange[];
  let id: string | undefined;
  let op: ReviewOp;
  switch (request.op) {
    case 'comment': {
      const made = addComment(text, request.range, request.body, ctx);
      ({ changes, id } = made);
      op = request;
      break;
    }
    case 'highlight': {
      const made = addHighlight(text, request.range, ctx);
      ({ changes, id } = made);
      op = request;
      break;
    }
    case 'reply':
      changes = reply(text, request.thread, request.body, ctx);
      op = request;
      break;
    case 'resolve':
      changes = resolve(text, request.thread, ctx);
      op = request;
      break;
    case 'reopen':
      changes = reopen(text, request.thread);
      op = request;
      break;
    case 'decide': {
      const seen = request.seen ?? signaturesOf(text, request.ids).map((s) => s ?? '');
      changes = decide(text, request.decision, request.ids, request.many === true);
      op = {
        op: 'decide',
        decision: request.decision,
        ids: request.ids,
        seen,
        ...(request.many ? { many: true as const } : {}),
      };
      break;
    }
  }
  return {
    changes,
    ...(id === undefined ? {} : { id }),
    intent: {
      kind: 'review',
      op,
      author: who.author,
      time: who.time,
      drawn: drawing.drawn,
    },
  };
}

function decide(
  text: string,
  decision: 'accept' | 'reject',
  ids: readonly string[],
  many: boolean,
): TextChange[] {
  if (ids.length === 1 && !many) return (decision === 'accept' ? accept : reject)(text, ids[0]!);
  return (decision === 'accept' ? acceptMarks : rejectMarks)(text, ids);
}

export type DerivedReview =
  | { ok: true; changes: TextChange[]; id?: string }
  /** A decision not applied: the mark `id` changed since it was seen, or is gone. */
  | { ok: false; reason: 'changed' | 'gone'; id: string };

/**
 * The changes an intent makes on `text`: what it wrote the first time, on the text it was made on.
 * On newer text a decision is applied only to marks as they were seen; for a mark that changed or
 * is gone it is not applied at all, and says which (the guard, §4.4). Nothing here refuses an edit.
 *
 * @throws EditError when the format refuses it there.
 */
export function deriveReview(
  text: string,
  intent: ReviewIntent,
  op: ReviewOp = intent.op,
): DerivedReview {
  if (op.op === 'decide') {
    const now = signaturesOf(text, op.ids);
    for (let i = 0; i < op.ids.length; i++) {
      const id = op.ids[i]!;
      if (now[i] === null) return { ok: false, reason: 'gone', id };
      if (op.seen[i] !== undefined && op.seen[i] !== '' && now[i] !== op.seen[i]) {
        return { ok: false, reason: 'changed', id };
      }
    }
  }
  const request: ReviewRequest = op;
  const done = writeReview(text, request, {
    author: intent.author,
    time: intent.time,
    random: replaying(intent),
  });
  return { ok: true, changes: done.changes, ...(done.id === undefined ? {} : { id: done.id }) };
}
