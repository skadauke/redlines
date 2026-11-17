// Intents (docs/research/multiuser.md §4.2). An edit made in the editor, kept as what the person
// did, from which the tracked form is derived by the same code as always: the edits as the
// transaction made them, who made them, when, and the random bytes the format drew for new ids.
//
// The tracking filter records one beside each edit it writes, as an annotation of the rewritten
// transaction. Recording changes nothing in the document: the same transaction, the same bytes.
// Deriving an intent on the text it was made on gives that transaction's changes again, ids and
// all, and a later change to deriving it on newer text starts from the same record.
//
// This is the first kind, the typing family: typing, deleting and replacing, tracked or not. Other
// kinds of command join `Intent` as they get theirs.

import { Annotation } from '@codemirror/state';
import type { Transaction } from '@codemirror/state';
import type { Person, TextChange } from '@redlines/format';
import type { MoveIntent } from '../blocks/move-intent.ts';
import type { TableIntent } from '../table/intent.ts';
import type { WidenedPasteIntent } from '../table/widened-paste.ts';
import type { FormatIntent } from './format-intent.ts';

/** An edit of an intent, in the offsets of the text it was made to. */
export interface IntentEdit extends TextChange {
  /** The edit the main selection ends at, which the caret follows. */
  main: boolean;
}

/** The typing family: what `trackEdits` and `untrackEdits` of the tracked layer are given. */
export interface TypingIntent {
  kind: 'typing';
  /** Unique, from a source of its own: it never draws from the edit source's bytes. */
  id: string;
  /** Whether the edits were tracked, or made to the text itself (format §3.10). */
  tracking: boolean;
  edits: readonly IntentEdit[];
  backward: boolean;
  /** The marks' group: `true` for one id of its own, a string for the caller's. */
  grouped: boolean | string;
  /** How the edit was widened, when the fine form was refused. */
  widening: boolean | 'first';
  /** Who made it. With Track Changes off, the person is not recorded in the file, but is here. */
  author: Person | null;
  /** To the minute, as the ledger writes it. Empty when the edit wasn't tracked. */
  time: string;
  /** The bytes the format drew for ids, call by call, in order. */
  drawn: readonly (readonly number[])[];
  /**
   * For text composed by an input method: the change that puts the text as it was before the
   * composition back, which the transaction's start text has composed in. The edits are of that
   * text, and the transaction's changes are this one followed by what they wrote.
   */
  revert?: readonly TextChange[];
}

/**
 * An edit of several writes, each made on the text the one before it left, as a paste over cells
 * that adds columns and rows and then fills the cells: its steps in order, each an intent of its own.
 */
export interface StepsIntent {
  kind: 'steps';
  id: string;
  steps: readonly (TypingIntent | TableIntent)[];
}

export type Intent =
  | TypingIntent
  | FormatIntent
  | TableIntent
  | StepsIntent
  | MoveIntent
  | WidenedPasteIntent;

/** An intent with no id yet: what the writers make. */
export type Unnamed<T = Intent> = T extends unknown ? Omit<T, 'id'> : never;

/** The annotation that records an intent a writer made, with an id of its own. */
export function recordedAs(intent: Unnamed): ReturnType<typeof intentAnnotation.of> {
  return intentAnnotation.of({ ...intent, id: newIntentId() });
}

/** The intent a transaction was rewritten from, when the tracking filter made it. */
export const intentAnnotation = Annotation.define<Intent>();

/** The intent recorded for a transaction, if the tracked layer rewrote it. */
export function intentOf(tr: Transaction): Intent | undefined {
  return tr.annotation(intentAnnotation);
}

let counter = 0;

/** An id for an intent: unique in this page, and in others by its random part. */
export function newIntentId(): string {
  const random = new Uint8Array(6);
  crypto.getRandomValues(random);
  let hex = '';
  for (const byte of random) hex += byte.toString(16).padStart(2, '0');
  return `${hex}-${(counter++).toString(36)}`;
}

/** A random source and the log of what it gave. */
export interface Drawing {
  random: ((n: number) => Uint8Array) | undefined;
  drawn: number[][];
}

/**
 * A source that gives what `source` gives, and keeps the bytes. With no source (the system's, in
 * the app) the format is left to draw its own, as it always did, and nothing is kept: deriving such
 * an intent draws ids from a stream of its own id's, the same each time. A session sets a source.
 */
export function recording(source?: (n: number) => Uint8Array): Drawing {
  const drawn: number[][] = [];
  if (!source) return { drawn, random: undefined };
  return {
    drawn,
    random: (n) => {
      const bytes = source(n);
      drawn.push([...bytes]);
      return bytes;
    },
  };
}

/**
 * A source that gives the recorded bytes again, call by call. A write on newer text may draw more
 * than the first did (an id was taken meanwhile); those further draws come from a stream that
 * depends only on the intent's id and the draw's place, so deriving twice gives the same.
 */
export function replaying(
  intent: Pick<Exclude<Intent, StepsIntent>, 'id' | 'drawn'>,
): (n: number) => Uint8Array {
  let next = 0;
  return (n) => {
    const at = next++;
    const was = intent.drawn[at];
    if (was && was.length === n) return Uint8Array.from(was);
    return stream(`${intent.id}/${at}`, n);
  };
}

/** `n` bytes from a string, by FNV-1a stepped through a xorshift: not secret, only repeatable. */
function stream(seed: string, n: number): Uint8Array {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 0x01000193);
  if (h === 0) h = 1;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    out[i] = (h >>> 0) & 0xff;
  }
  return out;
}
