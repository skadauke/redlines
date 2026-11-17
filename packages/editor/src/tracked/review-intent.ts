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
  acceptAll,
  acceptMarks,
  addComment,
  addHighlight,
  parse,
  reject,
  rejectAll,
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
      /**
       * Accept All: `ids` are the changes at the click, each decided on its own. On newer text a
       * mark that changed or is gone is left out, with its whole group, and the rest is decided.
       */
      bulk?: true;
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
      bulk?: true;
    };

/**
 * The mark as a person sees it: its kind, payload, author, time, note and group, and every
 * character from its first marker to its last, with the text of an opener's carrier. A change to
 * any of them makes it another mark to decide. It errs toward "changed": text between the segments
 * of a mark that spans blocks counts, which asks a person to look again rather than decide blind.
 */
export function markSignature(text: string, mark: MarkRange): string {
  let from = Infinity;
  let to = 0;
  for (const segment of mark.segments) {
    from = Math.min(from, segment.open.from);
    to = Math.max(
      to,
      segment.close?.to ?? 0,
      segment.content.to,
      segment.open.to,
      segment.carrier?.to ?? 0,
    );
  }
  const { by, at, note, group } = mark.entry;
  return `${JSON.stringify([mark.kind, mark.payload ?? null, by, at, note ?? null, group ?? null])}|${text.slice(from, to)}`;
}

/** What a person sees of the marks `ids` name in `text`, to be carried by a decision; '' for one that isn't there. */
export function seenOf(text: string, ids: readonly string[]): string[] {
  return signaturesOf(text, ids).map((signature) => signature ?? '');
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
      changes = decide(
        text,
        request.decision,
        request.ids,
        request.many === true,
        request.bulk === true,
      );
      op = {
        op: 'decide',
        decision: request.decision,
        ids: request.ids,
        seen,
        ...(request.many || request.bulk ? { many: true as const } : {}),
        ...(request.bulk ? { bulk: true as const } : {}),
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
  bulk = false,
): TextChange[] {
  if (bulk) {
    // Each on its own, as Accept All has always decided them: the same bytes as before.
    const wanted = new Set(ids);
    return (decision === 'accept' ? acceptAll : rejectAll)(text, (mark) => wanted.has(mark.id));
  }
  if (ids.length === 1 && !many) return (decision === 'accept' ? accept : reject)(text, ids[0]!);
  return (decision === 'accept' ? acceptMarks : rejectMarks)(text, ids);
}

/** A mark a decision leaves alone on newer text, and why. */
export interface SkippedMark {
  id: string;
  reason: 'changed' | 'gone';
}

export type DerivedReview =
  | { ok: true; changes: TextChange[]; id?: string; skipped?: readonly SkippedMark[] }
  /** A decision not applied: the mark `id` changed since it was seen, or is gone. */
  | { ok: false; reason: 'changed' | 'gone'; id: string };

type Decide = Extract<ReviewOp, { op: 'decide' }>;

/**
 * Which marks of a decision still stand as they were seen, on `text`. A decision on one mark, or
 * on the marks of one suggestion, stands or falls together: the first that changed or is gone is
 * the reason. Accept All's decision (`bulk`) is of many, each its own: the marks that changed or
 * are gone are left out, and with them the rest of their group, since a group is decided whole.
 */
export function guardDecision(
  text: string,
  op: Decide,
): { apply: string[]; skipped: SkippedMark[] } {
  const marks = parse(text).marks;
  const now = signaturesOf(text, op.ids);
  const skipped: SkippedMark[] = [];
  for (let i = 0; i < op.ids.length; i++) {
    const id = op.ids[i]!;
    if (now[i] === null) skipped.push({ id, reason: 'gone' });
    else if (op.seen[i] !== undefined && op.seen[i] !== '' && now[i] !== op.seen[i]) {
      skipped.push({ id, reason: 'changed' });
    }
  }
  if (!op.bulk) {
    return skipped.length ? { apply: [], skipped: [skipped[0]!] } : { apply: [...op.ids], skipped };
  }
  const groupOf = (id: string) => marks.find((mark) => mark.id === id)?.entry.group;
  // The group a mark was in when it was seen counts too: a mark that is gone, or left its group,
  // still takes its old group out (the signature starts with its JSON header, the group last).
  const seenGroup = (id: string): string | undefined => {
    const signature = op.seen[op.ids.indexOf(id)];
    if (!signature) return undefined;
    try {
      const header = JSON.parse(signature.slice(0, signature.indexOf('|'))) as unknown[];
      const group = header[5];
      return typeof group === 'string' ? group : undefined;
    } catch {
      return undefined;
    }
  };
  const groups = new Set<string>();
  for (const { id } of skipped) {
    for (const group of [groupOf(id), seenGroup(id)]) if (group) groups.add(group);
  }
  const out = new Set(skipped.map(({ id }) => id));
  const apply = op.ids.filter((id) => {
    if (out.has(id)) return false;
    if ([groupOf(id), seenGroup(id)].some((group) => group && groups.has(group))) {
      skipped.push({ id, reason: 'changed' });
      return false;
    }
    return true;
  });
  return { apply, skipped };
}

/**
 * The changes an intent makes on `text`: what it wrote the first time, on the text it was made on.
 * On newer text a decision is applied only to marks as they were seen; for a mark that changed or
 * is gone it is not applied at all, and says which (the guard, §4.4). Accept All's decision is
 * applied to the marks that still stand and says which it left out. Nothing here refuses an edit.
 *
 * @throws EditError when the format refuses it there.
 */
export function deriveReview(
  text: string,
  intent: ReviewIntent,
  op: ReviewOp = intent.op,
): DerivedReview {
  let skipped: readonly SkippedMark[] = [];
  if (op.op === 'decide') {
    const guarded = guardDecision(text, op);
    if (guarded.apply.length === 0 && guarded.skipped.length > 0) {
      return { ok: false, ...guarded.skipped[0]! };
    }
    skipped = guarded.skipped;
    if (skipped.length > 0) {
      const was = op;
      op = {
        ...was,
        ids: guarded.apply,
        seen: guarded.apply.map((id) => was.seen[was.ids.indexOf(id)] ?? ''),
      };
    }
  }
  const request: ReviewRequest = op;
  const done = writeReview(text, request, {
    author: intent.author,
    time: intent.time,
    random: replaying(intent),
  });
  return {
    ok: true,
    changes: done.changes,
    ...(done.id === undefined ? {} : { id: done.id }),
    ...(skipped.length ? { skipped } : {}),
  };
}
