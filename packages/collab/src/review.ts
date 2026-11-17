// Roles and the review guard (docs/research/multiuser.md §4.4, §4.9). The authority reads every
// push with the format library and refuses what the pusher's role does not allow:
//
// - A viewer pushes nothing.
// - A commenter may only add comments and suggestions in their own name: take away every mark and
//   ledger entry of theirs from the text before and after, and what is left must be the same.
// - An editor, or the owner, edits directly and decides. A decision carries the marks as the
//   person saw them (a digest of each). A decision on a mark that changed, or is gone, is answered
//   with what changed, and the first decision wins.

import {
  applyChanges,
  isDecidable,
  openerRange,
  parse,
  rejectMarks,
  acceptMarks,
} from '@redlines/format';
import type { Ledger, MarkEntry, MarkRange, Parsed, Range, Thread } from '@redlines/format';
import type { PushContext, PushRefusal } from './authority.ts';
import type { Decision } from './protocol.ts';
import { sha256 } from './sha256.ts';

/** A decision that was logged: who, and how. The first decision on a mark wins. */
export interface DecidedRecord {
  by: string;
  kind: 'accept' | 'reject';
  /** The version the decision made. */
  version: number;
}

/** A mark as it reads now, for telling a reviewer what changed. */
export interface MarkSnapshot {
  id: string;
  kind: string;
  by: string;
  at: string;
  payload?: string;
  /** The text from the mark's first marker to its last, as written. */
  text: string;
  digest: string;
}

const LONGEST_DECISION = 1000;

// --- digests -----------------------------------------------------------------------------------

const hash = sha256;

const isRowOrColumn = (mark: MarkRange) =>
  (mark.kind === 'ins' && (mark.payload === 'row' || mark.payload === 'col')) ||
  (mark.kind === 'del' && /^(?:row|col)=/.test(mark.payload ?? ''));

/**
 * The text a reviewer sees of a mark: from its first marker to the end of its last segment, and for
 * a row or column the whole of the lines they are on (what a reviewer saw is the whole row).
 */
export function markSpan(text: string, mark: MarkRange): Range {
  const first = mark.segments[0];
  const last = mark.segments[mark.segments.length - 1];
  if (!first || !last) return { from: 0, to: 0 };
  let from = first.open.from;
  let to = Math.max(last.close?.to ?? 0, last.content.to, last.open.to);
  if (isRowOrColumn(mark)) {
    from = text.lastIndexOf('\n', from - 1) + 1;
    const end = text.indexOf('\n', to);
    to = end === -1 ? text.length : end;
  }
  return { from, to };
}

/** The digest of a mark: what it is, who made it, and the text it spans. */
export function markDigest(parsed: Parsed, mark: MarkRange): string {
  const { from, to } = markSpan(parsed.text, mark);
  const { by, at, note, group, move, parts } = mark.entry;
  return hash(
    JSON.stringify([
      mark.kind,
      mark.payload ?? null,
      by,
      at,
      note,
      group,
      move,
      parts,
      parsed.text.slice(from, to),
    ]),
  );
}

export function snapshotOf(parsed: Parsed, mark: MarkRange): MarkSnapshot {
  const { from, to } = markSpan(parsed.text, mark);
  return {
    id: mark.id,
    kind: mark.kind,
    by: mark.entry.by,
    at: mark.entry.at,
    ...(mark.payload !== undefined ? { payload: mark.payload } : {}),
    text: parsed.text.slice(from, to),
    digest: markDigest(parsed, mark),
  };
}

/** What a client puts in a decision's `seen`: the digest of each mark at the text it is looking at.
 * A mark that isn't there is left out. */
export function seenDigests(text: string, ids: readonly string[]): Record<string, string> {
  const parsed = parse(text);
  const seen: Record<string, string> = {};
  for (const id of ids) {
    const mark = parsed.marks.find((m) => m.id === id);
    if (mark) seen[id] = markDigest(parsed, mark);
  }
  return seen;
}

// --- the commenter ------------------------------------------------------------------------------

/** The body of a text: everything before its ledger, and what follows the ledger. */
function bodyOf(text: string, parsed: Parsed): string {
  const range = parsed.ledgerRange;
  if (!range) return text;
  return `${text.slice(0, range.from)}\u0000${text.slice(range.to)}`;
}

/**
 * The text with everything `handle` added taken away: their suggestions rejected, their comments
 * and highlights unmarked. Null when that can't be done (a mark of theirs that rejecting would
 * refuse), which the guard takes as a refusal.
 */
function withoutOwn(text: string, handle: string): string | null {
  let parsed = parse(text);
  // Other people's marks inside the commenter's own marks go with them when those are taken away,
  // so they are kept apart and compared as they are.
  const own = parsed.marks.filter((m) => m.entry.by === handle).map((m) => markSpan(text, m));
  const nested = parsed.marks
    .filter((m) => m.entry.by !== handle)
    .filter((m) =>
      own.some(
        (o) =>
          (m.segments[0]?.open.from ?? -1) >= o.from && (m.segments[0]?.open.from ?? -1) < o.to,
      ),
    )
    .map((m) => {
      const span = markSpan(text, m);
      return [m.id, text.slice(span.from, span.to)];
    });
  const suggestions = parsed.marks.filter(
    (mark) => mark.entry.by === handle && mark.kind !== 'cmt' && mark.kind !== 'hl',
  );
  if (suggestions.some((mark) => !isDecidable(mark))) return null;
  let current = text;
  if (suggestions.length) {
    try {
      current = applyChanges(
        text,
        rejectMarks(
          text,
          suggestions.map((m) => m.id),
        ),
      );
    } catch {
      return null;
    }
    parsed = parse(current);
  }
  const cuts: Range[] = [];
  for (const mark of parsed.marks) {
    if (mark.entry.by !== handle || (mark.kind !== 'cmt' && mark.kind !== 'hl')) continue;
    for (const segment of mark.segments) {
      cuts.push(openerRange(segment));
      if (segment.close) cuts.push(segment.close);
    }
  }
  cuts.sort((a, b) => a.from - b.from);
  let out = '';
  let at = 0;
  for (const cut of cuts) {
    if (cut.from < at) continue;
    out += current.slice(at, cut.from);
    at = cut.to;
  }
  out += current.slice(at);
  return `${bodyOf(out, parse(out))}\u0001${JSON.stringify(nested)}`;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * A thread as other people's: without the replies, likes and resolve of `handle`. What is left must
 * not change.
 */
function othersView(thread: Thread, handle: string) {
  const { replies, likes, resolved, ...rest } = thread;
  return {
    ...rest,
    ...(resolved && resolved.by !== handle ? { resolved } : {}),
    replies: replies.filter((r) => r.by !== handle),
    likes: likes.filter((l) => l.by !== handle),
  };
}

/** Whether a thread of the commenter's own says anything in someone else's name. */
function forgedThread(thread: Thread, handle: string): boolean {
  return (
    thread.by !== handle ||
    thread.replies.some((r) => r.by !== handle) ||
    thread.likes.some((l) => l.by !== handle) ||
    (thread.resolved !== undefined && thread.resolved.by !== handle)
  );
}

/** Why the ledger after is not the ledger before plus what `handle` may add, or null. */
function ledgerRefusal(before: Ledger, after: Ledger, handle: string): string | null {
  const { people: bp, marks: bm, comments: bc, ...restBefore } = before;
  const { people: ap, marks: am, comments: ac, ...restAfter } = after;
  if (!same(restBefore, restAfter)) return 'A commenter cannot change the settings.';
  if (
    !same(
      bp.filter((p) => p.handle !== handle),
      ap.filter((p) => p.handle !== handle),
    )
  ) {
    return 'A commenter cannot change other people.';
  }
  const entries = (marks: Record<string, MarkEntry>) =>
    Object.entries(marks).filter(([, entry]) => entry.by !== handle);
  if (!same(entries(bm), entries(am))) return 'A commenter cannot change other people’s marks.';
  if (ac.some((t) => t.by === handle && forgedThread(t, handle))) {
    return 'A commenter can only write in their own name.';
  }
  const mine = ap.find((p) => p.handle === handle);
  if (mine && (mine.aliases || mine.accounts || mine.members || mine.deleted || mine.extra)) {
    return 'A commenter cannot set who they are.';
  }
  if (Object.values(am).some((e) => e.by === handle && e.move !== undefined)) {
    return 'A commenter cannot move marks.';
  }
  const others = (threads: Thread[]) =>
    threads.filter((t) => t.by !== handle).map((t) => othersView(t, handle));
  if (!same(others(bc), others(ac))) return 'A commenter cannot change other people’s comments.';
  return null;
}

/** The refusal for a commenter's push, or null. */
function commenterRefusal(context: PushContext): string | null {
  const { handle } = context.identity;
  if (context.update.decision) return 'A commenter cannot accept or reject.';
  const ledger = ledgerRefusal(context.before.ledger, context.after.ledger, handle);
  if (ledger) return ledger;
  const beforeIds = new Set(context.before.marks.map((m) => m.id));
  for (const mark of context.after.marks) {
    if (mark.entry.by !== handle && !beforeIds.has(mark.id)) {
      return 'A commenter can only add marks in their own name.';
    }
  }
  const was = withoutOwn(context.beforeText, handle);
  const now = withoutOwn(context.afterText, handle);
  if (was === null || now === null) return 'A commenter’s marks must be ones that can be rejected.';
  if (was !== now) return 'A commenter can only add comments and suggestions.';
  return null;
}

// --- decisions ---------------------------------------------------------------------------------

function decisionShape(decision: Decision): string | null {
  const { kind, ids, seen } = decision as Partial<Decision>;
  if (kind !== 'accept' && kind !== 'reject') return 'A decision is accept or reject.';
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > LONGEST_DECISION) {
    return 'A decision names its marks.';
  }
  if (!ids.every((id) => typeof id === 'string')) return 'A decision names its marks.';
  if (typeof seen !== 'object' || seen === null) return 'A decision carries what was seen.';
  return null;
}

function decisionRefusal(context: PushContext): PushRefusal | null {
  const decision = context.update.decision;
  if (!decision) return null;
  const shape = decisionShape(decision);
  if (shape) return { error: 'invalid', message: shape };
  const { before, beforeText, afterText } = context;
  for (const id of decision.ids) {
    const mark = before.marks.find((m) => m.id === id);
    if (!mark) {
      const done = context.decided.get(id);
      if (done) {
        return {
          error: 'stale',
          reason: 'decided',
          message: `${done.by} ${done.kind === 'accept' ? 'accepted' : 'rejected'} this a moment ago.`,
          detail: { id, by: done.by, kind: done.kind, version: done.version },
        };
      }
      return {
        error: 'stale',
        reason: 'changed',
        message: 'This mark is gone.',
        detail: { id, gone: true },
      };
    }
    if (decision.seen[id] !== markDigest(before, mark)) {
      return {
        error: 'stale',
        reason: 'changed',
        message: `${mark.entry.by} changed this suggestion. Review it again.`,
        detail: { id, now: snapshotOf(before, mark) },
      };
    }
  }
  let expected: string;
  try {
    const decide = decision.kind === 'accept' ? acceptMarks : rejectMarks;
    expected = applyChanges(beforeText, decide(beforeText, decision.ids));
  } catch (cause) {
    return {
      error: 'invalid',
      message: cause instanceof Error ? cause.message : 'The decision can not be made.',
    };
  }
  if (expected !== afterText) {
    return {
      error: 'stale',
      reason: 'changed',
      message: 'The text moved under this decision. Review it again.',
    };
  }
  return null;
}

/** Roles first, then the decision guard. */
export function reviewCheck(context: PushContext): PushRefusal | null {
  const { role } = context.identity;
  if (role === 'viewer') return { error: 'forbidden', message: 'Viewers can not edit.' };
  if (role === 'commenter') {
    const reason = commenterRefusal(context);
    return reason ? { error: 'forbidden', message: reason } : null;
  }
  return decisionRefusal(context);
}
