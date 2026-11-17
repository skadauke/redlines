// What the editor says when a decision isn't applied (docs/research/multiuser.md §4.4): "Ada
// accepted this a moment ago", "Bo changed this suggestion. Review it again." The first decision on
// a mark wins; a later one finds the mark gone, and the record of who decided it says so. A record
// is only read for a mark that is gone: when a decision is undone and the mark is back, nothing is
// said of it, and the record is dropped.

import { parse } from '@redlines/format';
import type { Parsed } from '@redlines/format';
import type { SkippedMark } from './review-intent.ts';

/** Who decided a mark, and how. */
export interface DecidedNote {
  /** The name to show: Ada's, not her handle. */
  by: string;
  kind: 'accept' | 'reject';
}

/** The marks decided, here or in another window, with who decided them. */
export class DecidedLog {
  readonly #notes = new Map<string, DecidedNote>();

  /** Records a decision. The first on a mark stays: a later one never replaces it. */
  note(id: string, note: DecidedNote): void {
    if (!this.#notes.has(id)) this.#notes.set(id, note);
  }

  /** Takes away the records of marks that are in `parsed` again, as after an Undo. */
  prune(parsed: Parsed): void {
    if (this.#notes.size === 0) return;
    for (const mark of parsed.marks) this.#notes.delete(mark.id);
  }

  /** The record for a mark that is gone from `parsed`. */
  about(id: string, parsed: Parsed): DecidedNote | undefined {
    if (parsed.marks.some((mark) => mark.id === id)) {
      this.#notes.delete(id);
      return undefined;
    }
    return this.#notes.get(id);
  }

  get size(): number {
    return this.#notes.size;
  }
}

/** The message for one mark a decision left alone. */
export function skippedMessage(text: string, skipped: SkippedMark, log?: DecidedLog): string {
  const parsed = parse(text);
  if (skipped.reason === 'gone') {
    const done = log?.about(skipped.id, parsed);
    if (done)
      return `${done.by} ${done.kind === 'accept' ? 'accepted' : 'rejected'} this a moment ago.`;
    return 'This change is gone.';
  }
  const mark = parsed.marks.find((candidate) => candidate.id === skipped.id);
  const handle = mark?.entry.by;
  const name = parsed.ledger.people.find((person) => person.handle === handle)?.name ?? handle;
  return name
    ? `${name} changed this suggestion. Review it again.`
    : 'This suggestion changed. Review it again.';
}

/** What a decision did on the text it met: the marks it decided, and those it left alone. */
export interface DecisionOutcome {
  applied: readonly string[];
  skipped: readonly (SkippedMark & { message: string })[];
}
