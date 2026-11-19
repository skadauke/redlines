// Intents: what a person did, anchored to visible words, and the code that derives their tracked
// form again, with the real `trackedEdits`, against whatever text is newest (multiuser §4.2).

import {
  EditError,
  accept,
  addComment,
  emptiedFormats,
  newestView,
  parse,
  reject,
  reply,
  trackedEdits,
  trackedFormat,
  trackedFormatRanges,
} from '@redlines/format';
import type { EditContext, FormatOp, MarkRange, Range, TextChange } from '@redlines/format';
import { Rng } from './rng.ts';
import { tokenRanges } from './text.ts';
import type { Actor, VisibleToken } from './text.ts';

/** Where typed words go: after a word, or before one. Later anchors are tried when the first
 * word isn't visible any more. */
export interface Anchor {
  token: string;
  side: 'after' | 'before';
}

export type IntentBody =
  | { kind: 'type'; anchors: Anchor[]; words: string[] }
  | { kind: 'delete'; tokens: string[] }
  | { kind: 'sub'; tokens: string[]; words: string[] }
  | { kind: 'bold'; tokens: string[]; on: boolean }
  /** `note` is the unique text of the thread; the thread's id is only known once it is written. */
  | { kind: 'comment'; tokens: string[]; anchors: Anchor[]; note: string }
  | { kind: 'reply'; note: string; body: string }
  /** `seen` is the mark as the person saw it. */
  | { kind: 'decide'; mark: string; decision: 'accept' | 'reject'; seen: string };

export interface Intent {
  /** Unique in a session. */
  id: string;
  author: Actor;
  /** To the minute, as the ledger writes it. */
  time: string;
  /** The random bytes of its ids, which stay the same each time it is derived. */
  seed: number;
  /** When the person did it, in milliseconds of the session. */
  at: number;
  body: IntentBody;
}

/** What an edit was, for the oracle. It travels with a push but is no part of any decision. */
export interface Summary {
  kind: IntentBody['kind'];
  author: string;
  /** Tokens the edit meant to remove. */
  removes: string[];
  /** Tokens it meant to add. */
  adds: string[];
  /** The mark a decision was about, and the tokens it holds as the decided text has them. */
  mark?: { id: string; kind: string; ins: string[]; old: string[] };
  decision?: 'accept' | 'reject';
  note?: string;
  replyBody?: string;
}

type Derived =
  | { ok: true; changes: TextChange[]; summary: Summary }
  | { ok: false; reason: string; crash?: boolean };

const skip = (reason: string): Derived => ({ ok: false, reason });

/** The mark as a person saw it: its kind, author and every character from its first marker to its
 * last, payloads and everything inside it included. */
function defaultSignature(text: string, mark: MarkRange): string {
  let from = Infinity;
  let to = 0;
  for (const segment of mark.segments) {
    from = Math.min(from, segment.carrier ? segment.open.from : segment.open.from);
    to = Math.max(to, segment.close?.to ?? Math.max(segment.content.to, segment.open.to));
  }
  return `${mark.kind}|${mark.entry.by}|${text.slice(from, to)}`;
}

/** What an intent is derived with: the writers of the tracked form. The default is the format
 * library called as the first simulations called it; the editor's own are in `real.ts`. */
export interface Writers {
  /** Typing, deleting and substituting: the edits of one transaction, tracked. */
  edits(
    text: string,
    edits: TextChange[],
    ctx: EditContext,
    how: 'type' | 'delete' | 'sub',
  ): TextChange[];
  format(text: string, runs: Range[], op: FormatOp, ctx: EditContext): TextChange[];
  comment(text: string, range: Range, note: string, ctx: EditContext): TextChange[];
  reply(text: string, thread: string, body: string, ctx: EditContext): TextChange[];
  /** The changes of a decision, or null when the mark is not as it was seen (the guard). */
  decide(
    text: string,
    decision: 'accept' | 'reject',
    mark: MarkRange,
    seen: string,
    guard: boolean,
  ): TextChange[] | null;
  /** The mark as a person saw it, which a decision carries. */
  signature(text: string, mark: MarkRange): string;
}

export const formatWriters: Writers = {
  // A deletion that empties a format takes its delimiters too, as the editor's tracking filter
  // makes it before the library sees it (#584): `trackedEdits` writes the edit it is given.
  edits: (text, edits, ctx, how) =>
    trackedEdits(text, how === 'delete' ? [...emptiedFormats(text, edits)] : edits, ctx).changes,
  format: (text, runs, op, ctx) =>
    (runs.length === 1 && runs[0]
      ? trackedFormat(text, runs[0], op, ctx)
      : trackedFormatRanges(text, runs, op, ctx)
    ).changes,
  comment: (text, range, note, ctx) => addComment(text, range, note, ctx).changes,
  reply: (text, thread, body, ctx) => reply(text, thread, body, ctx),
  decide: (text, decision, mark, seen, guard) => {
    if (guard && defaultSignature(text, mark) !== seen) return null;
    return decision === 'accept' ? accept(text, mark.id) : reject(text, mark.id);
  },
  signature: defaultSignature,
};

let writers: Writers = formatWriters;

/** Derives with other writers, until `useWriters(formatWriters)`. */
export function useWriters(next: Writers): void {
  writers = next;
}

export function signatureOf(text: string, mark: MarkRange): string {
  return writers.signature(text, mark);
}

interface Seen {
  view: ReturnType<typeof newestView>;
  tokens: VisibleToken[];
}

function see(text: string): Seen {
  const view = newestView(text);
  return { view, tokens: tokenRanges(view.text) };
}

/** Runs of the wanted tokens that stand next to each other in the newest view, as ranges of the
 * file. Tokens between them that nobody asked about stay out of every run. */
function runsOf(seen: Seen, wanted: readonly string[]): Range[] {
  const want = new Set(wanted);
  const runs: Range[] = [];
  let start = -1;
  for (let i = 0; i <= seen.tokens.length; i++) {
    const token = seen.tokens[i];
    if (token && want.has(token.token)) {
      if (start < 0) start = i;
      continue;
    }
    if (start >= 0) {
      const first = seen.tokens[start];
      const last = seen.tokens[i - 1];
      if (first && last) {
        runs.push({
          from: seen.view.map.toSource(first.from, 1),
          to: seen.view.map.toSource(last.to, -1),
        });
      }
      start = -1;
    }
  }
  return runs;
}

/** Where an anchor puts the caret, as an offset of the file, or undefined when its word has gone. */
function anchorAt(
  seen: Seen,
  anchor: Anchor,
): { at: number; side: 'after' | 'before' } | undefined {
  const found = seen.tokens.find((t) => t.token === anchor.token);
  if (!found) return undefined;
  return anchor.side === 'after'
    ? { at: seen.view.map.toSource(found.to, -1), side: 'after' }
    : { at: seen.view.map.toSource(found.from, 1), side: 'before' };
}

function placeFirst(seen: Seen, anchors: readonly Anchor[]) {
  for (const anchor of anchors) {
    const at = anchorAt(seen, anchor);
    if (at) return at;
  }
  return undefined;
}

function contextOf(intent: Intent): EditContext {
  const rng = new Rng(intent.seed);
  return { author: intent.author, time: intent.time, random: (n) => rng.bytes(n) };
}

function mapMarkTokens(text: string, mark: MarkRange): { ins: string[]; old: string[] } {
  const ins: string[] = [];
  for (const segment of mark.segments) {
    for (const t of tokenRanges(text.slice(segment.content.from, segment.content.to))) {
      ins.push(t.token);
    }
  }
  const old = tokenRanges(mark.payload ?? '').map((t) => t.token);
  return { ins, old };
}

/**
 * The tracked form of an intent against `text`: the changes of the file (text and ledger), or why
 * there are none. Deterministic: the same intent over the same text always gives the same changes.
 */
export function derive(text: string, intent: Intent, options: { guard?: boolean } = {}): Derived {
  try {
    return deriveUnsafe(text, intent, options.guard !== false);
  } catch (error) {
    if (error instanceof EditError) return skip(error.code ?? 'edit-error');
    return { ok: false, reason: `crash: ${(error as Error).message}`, crash: true };
  }
}

function summaryOf(intent: Intent, extra: Partial<Summary>): Summary {
  return {
    kind: intent.body.kind,
    author: intent.author.handle,
    removes: [],
    adds: [],
    ...extra,
  };
}

function deriveUnsafe(text: string, intent: Intent, guard: boolean): Derived {
  const body = intent.body;
  const ctx = contextOf(intent);
  switch (body.kind) {
    case 'type': {
      const seen = see(text);
      const place = placeFirst(seen, body.anchors);
      if (!place) return skip('anchor-gone');
      const insert =
        place.side === 'after' ? ` ${body.words.join(' ')}` : `${body.words.join(' ')} `;
      const changes = writers.edits(text, [{ from: place.at, to: place.at, insert }], ctx, 'type');
      // The editor may decline an edit (it asks, or tells the person why): nothing was written.
      if (changes.length === 0) return skip('declined');
      return { ok: true, changes, summary: summaryOf(intent, { adds: body.words }) };
    }
    case 'delete':
    case 'sub': {
      const seen = see(text);
      const runs = runsOf(seen, body.tokens);
      if (runs.length === 0) return skip('nothing-left');
      const here = new Set(seen.tokens.map((t) => t.token));
      const removes = body.tokens.filter((t) => here.has(t));
      const words = body.kind === 'sub' ? body.words : [];
      const edits: TextChange[] = runs.map((run, i) => ({
        ...run,
        insert: i === 0 ? words.join(' ') : '',
      }));
      const changes = writers.edits(text, edits, ctx, body.kind);
      if (changes.length === 0) return skip('declined');
      return { ok: true, changes, summary: summaryOf(intent, { removes, adds: words }) };
    }
    case 'bold': {
      const seen = see(text);
      const runs = runsOf(seen, body.tokens);
      if (runs.length === 0) return skip('nothing-left');
      const op: FormatOp = { kind: 'inline', format: 'bold', on: body.on };
      const changes = writers.format(text, runs, op, ctx);
      if (changes.length === 0) return skip('no-change');
      return { ok: true, changes, summary: summaryOf(intent, {}) };
    }
    case 'comment': {
      const seen = see(text);
      const runs = runsOf(seen, body.tokens);
      let range: Range | undefined = runs[0];
      if (runs.length > 1 && runs[0] && runs[runs.length - 1]) {
        range = { from: runs[0].from, to: (runs[runs.length - 1] as Range).to };
      }
      if (!range) {
        const place = placeFirst(seen, body.anchors);
        if (!place) return skip('anchor-gone');
        range = { from: place.at, to: place.at };
      }
      const changes = writers.comment(text, range, body.note, ctx);
      return { ok: true, changes, summary: summaryOf(intent, { note: body.note }) };
    }
    case 'reply': {
      const thread = parse(text).ledger.comments.find((c) => c.text === body.note);
      if (!thread) return skip('thread-gone');
      const changes = writers.reply(text, thread.id, body.body, ctx);
      return {
        ok: true,
        changes,
        summary: summaryOf(intent, { note: body.note, replyBody: body.body }),
      };
    }
    case 'decide': {
      const parsed = parse(text);
      const mark = parsed.marks.find((m) => m.id === body.mark);
      if (!mark) return skip('already-decided');
      const changes = writers.decide(text, body.decision, mark, body.seen, guard);
      if (changes === null) return skip('guard');
      const tokens = mapMarkTokens(text, mark);
      return {
        ok: true,
        changes,
        summary: summaryOf(intent, {
          decision: body.decision,
          mark: { id: mark.id, kind: mark.kind, ...tokens },
        }),
      };
    }
  }
}
