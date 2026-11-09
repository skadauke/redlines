// Drafts that outlast the page (design §5.7): the comments and replies being written in a document,
// kept for it in the host's store (plugin API `HostDocumentData`) as they are typed, and given back
// when the document opens again, in any window. Writes are gathered: a change is written a moment
// later, with whatever else changed meanwhile, so no keystroke waits on the store.
//
// The host binds the store to the document, by its real path, and moves it on Rename and Save As;
// it says when the document's data can be read (`onReady`). The record of a document's drafts is
// one value in it. Each draft in the record is a slot of its own (the new comment, the comment set
// aside with Escape, each reply), with the version of its text. A window writes only the slots it
// changed, so that two windows on one document don't take each other's drafts: the text typed last
// is the one kept. It forgets a slot only while the store still holds the version it wrote or took,
// so that posting in one window never loses what was typed since in another.

import type { Text } from '@codemirror/state';
import type { HostDocumentData } from '@redlines/plugin-api';
import { type Anchor, contextOf, type KeptAnchor } from './anchors.ts';

/** How long after the last change the drafts are written, with what changed meanwhile. */
export const DRAFT_DELAY = 500;

/** The longest the drafts wait to be written while changes go on without a pause. */
export const DRAFT_LONGEST = 2000;

/** Under what the review keeps a document's drafts in its store. */
export const DRAFTS_KEY = 'drafts';

/**
 * The longest document a new comment keeps a copy of, in characters, to find its text again as a
 * reload would. A longer one keeps the anchor's text and what is around it, to look for.
 */
export const MAX_COPY = 200_000;

/** A new comment as it is kept: what it is on, and what is written. */
export interface KeptComment extends KeptAnchor {
  text: string;
  /** The version of its text. */
  v: string;
}

/** A reply as it is kept. */
export interface KeptReply {
  text: string;
  v: string;
}

/**
 * A document's drafts as they are kept. As read, each new comment has its anchor's copy of the
 * document; as stored, a copy that both share is kept once, as `doc`.
 */
export interface KeptDrafts {
  /** The copy of the document that the new comments without a copy of their own are on. */
  doc?: string;
  /** The new comment open in its box. */
  comment?: KeptComment;
  /** The new comment set aside with Escape. */
  aside?: KeptComment;
  /** The replies being written, by thread. */
  replies?: Record<string, KeptReply>;
  /** The box last typed in: `comment`, or a reply's thread. */
  last?: string;
}

/** A new comment in the rail now: what it is on, and what is written in it. */
export interface CommentNow {
  range: Anchor;
  text: string;
}

/** The drafts in the rail now. */
export interface DraftsNow {
  doc: Text;
  comment: CommentNow | null;
  aside: CommentNow | null;
  /** The replies with text in their box, by thread. */
  replies: ReadonlyMap<string, string>;
}

/** The slot of each reply, apart from the two of new comments. No thread's id has a space. */
const REPLY = 'reply ';
const replySlot = (thread: string) => REPLY + thread;
/** The box a slot is, as a record's `last` names it: `comment`, or a reply's thread. */
const boxOfSlot = (slot: string) => (slot.startsWith(REPLY) ? slot.slice(REPLY.length) : slot);
const slotOfBox = (box: string | undefined) =>
  box === undefined || box === 'comment' ? box : replySlot(box);

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isOffset = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** A written draft's text and version, or null. */
function keptText(value: unknown): KeptReply | null {
  if (!isObject(value)) return null;
  const { text, v } = value;
  return typeof text === 'string' && text.trim() && typeof v === 'string' ? { text, v } : null;
}

/**
 * A new comment as stored: on its own copy of the document; else on what was around its text, kept
 * in a document too long to copy; and only with neither, on the record's `shared` copy. The shared
 * copy is the other comment's, which may be of another version of the document.
 */
function keptComment(value: unknown, shared: string | undefined): KeptComment | null {
  const written = keptText(value);
  if (!written || !isObject(value)) return null;
  const { from, to, changed, doc, quote, before, after } = value;
  if (!isOffset(from) || !isOffset(to) || to < from) return null;
  const anchor: KeptComment = { ...written, from, to };
  if (changed === true) anchor.changed = true;
  const context =
    typeof quote === 'string' &&
    quote.length === to - from &&
    typeof before === 'string' &&
    typeof after === 'string';
  if (typeof doc === 'string' && to <= doc.length) anchor.doc = doc;
  else if (context) Object.assign(anchor, { quote, before, after });
  else if (shared !== undefined && to <= shared.length) anchor.doc = shared;
  else return null;
  return anchor;
}

/** What a store holds for a document, read as drafts; what isn't understood is left out. */
export function readDrafts(value: unknown): KeptDrafts {
  if (!isObject(value)) return {};
  const drafts: KeptDrafts = {};
  const shared = typeof value['doc'] === 'string' ? value['doc'] : undefined;
  const comment = keptComment(value['comment'], shared);
  const aside = keptComment(value['aside'], shared);
  if (comment) drafts.comment = comment;
  if (aside) drafts.aside = aside;
  const replies = value['replies'];
  if (isObject(replies)) {
    for (const [thread, reply] of Object.entries(replies)) {
      const kept = keptText(reply);
      if (kept && !thread.includes(' ')) (drafts.replies ??= {})[thread] = kept;
    }
  }
  if (typeof value['last'] === 'string') drafts.last = value['last'];
  return drafts;
}

/** Each document's text as a string, made once: a document's text never changes. */
const copies = new WeakMap<Text, string>();
const copyOf = (doc: Text): string => {
  let copy = copies.get(doc);
  if (copy === undefined) copies.set(doc, (copy = doc.toString()));
  return copy;
};

/** A new comment as it is kept: with a copy of the document, unless that is too long. */
export function keepComment(
  { range, text }: CommentNow,
  doc: Text,
  v: string,
  maxCopy = MAX_COPY,
): KeptComment {
  const kept: KeptComment = { from: range.from, to: range.to, text, v };
  if (range.changed) kept.changed = true;
  if (doc.length <= maxCopy) kept.doc = copyOf(doc);
  else Object.assign(kept, contextOf(range, doc));
  return kept;
}

/** A draft as this window holds it, for comparing with what it last wrote. */
interface Slot {
  text: string;
  /** What else makes it what it is: a new comment's anchor. */
  place: string;
  /** The document its anchor is in. */
  doc?: Text;
  keep(v: string): KeptComment | KeptReply;
}

/** What this window knows the store holds of a slot: the version it wrote or took. */
interface Known {
  v: string;
  text: string;
  place: string;
  doc?: Text;
}

const newVersion = () => Math.random().toString(36).slice(2, 10);

function slotsNow(now: DraftsNow): Map<string, Slot> {
  const slots = new Map<string, Slot>();
  const comment = (draft: CommentNow): Slot => ({
    text: draft.text,
    place: `${draft.range.from} ${draft.range.to} ${draft.range.changed ? 1 : 0}`,
    doc: now.doc,
    keep: (v) => keepComment(draft, now.doc, v),
  });
  if (now.comment) slots.set('comment', comment(now.comment));
  if (now.aside) slots.set('aside', comment(now.aside));
  for (const [thread, text] of now.replies) {
    slots.set(replySlot(thread), { text, place: '', keep: (v) => ({ text, v }) });
  }
  return slots;
}

function slotsOf(drafts: KeptDrafts): Map<string, KeptComment | KeptReply> {
  const slots = new Map<string, KeptComment | KeptReply>();
  if (drafts.comment) slots.set('comment', drafts.comment);
  if (drafts.aside) slots.set('aside', drafts.aside);
  for (const [thread, reply] of Object.entries(drafts.replies ?? {})) {
    slots.set(replySlot(thread), reply);
  }
  return slots;
}

/**
 * A record of the slots, with the box last typed in when it has one. The new comments' copy of the
 * document is kept once, when they share it, as they do when one window wrote both.
 */
function draftsOf(slots: Map<string, KeptComment | KeptReply>, last?: string): KeptDrafts {
  const drafts: KeptDrafts = {};
  const comment = slots.get('comment') as KeptComment | undefined;
  const aside = slots.get('aside') as KeptComment | undefined;
  const shared = comment?.doc ?? aside?.doc;
  if (shared !== undefined) drafts.doc = shared;
  for (const [slot, kept] of slots) {
    if (slot === 'comment' || slot === 'aside') {
      const { doc, ...rest } = kept as KeptComment;
      drafts[slot] = doc === undefined || doc === shared ? rest : { ...rest, doc };
    } else (drafts.replies ??= {})[boxOfSlot(slot)] = kept;
  }
  if (last !== undefined && last !== 'aside' && slots.has(last)) drafts.last = boxOfSlot(last);
  return drafts;
}

/**
 * Keeps one document's drafts in the host's store, for as long as the document is open in the
 * editor: the rail makes one for each document, and tells it when the host says the document's
 * data can be read.
 */
export class DraftKeeper {
  readonly #store: HostDocumentData;
  readonly #now: () => DraftsNow;
  /** Whether the document's data can be read and kept: the host found its file. */
  #placed = false;
  readonly #known = new Map<string, Known>();
  /** The write that comes once changes pause, and the one that comes at the longest. */
  #timer: ReturnType<typeof setTimeout> | undefined;
  #longest: ReturnType<typeof setTimeout> | undefined;
  /** The slot last typed in, in this window. */
  #last: string | undefined;

  /** Told when drafts start waiting to be written, and when they no longer are. */
  readonly #onPending: (pending: boolean) => void;

  constructor(
    store: HostDocumentData,
    now: () => DraftsNow,
    onPending: (pending: boolean) => void = () => {},
  ) {
    this.#store = store;
    this.#now = now;
    this.#onPending = onPending;
  }

  /** Whether the document's data can be read and kept yet. */
  get placed(): boolean {
    return this.#placed;
  }

  /**
   * The document's data can be read: the drafts kept for it, which the rail gives back. Then call
   * `took` with what it gave back.
   */
  place(): KeptDrafts {
    this.#placed = true;
    return readDrafts(this.#store.get(DRAFTS_KEY));
  }

  /**
   * The rail gave these drafts back: this window holds the versions they were kept with. They are
   * written again at once, with the document as it is now, which also says it was opened.
   */
  took(drafts: KeptDrafts): void {
    for (const [slot, kept] of slotsOf(drafts)) {
      // Nothing to compare with yet, so the slot is written again, with its version.
      this.#known.set(slot, { v: kept.v, text: kept.text, place: '\n' });
    }
    this.#last = slotOfBox(drafts.last);
    this.save();
  }

  /**
   * A document that had no file was saved, and nothing is kept for it yet: its drafts are kept now,
   * all of them, as this window's.
   */
  saved(): void {
    this.#known.clear();
    this.save(true);
  }

  /**
   * Something changed in the drafts: they are written once changes pause for a moment, and at the
   * longest a little while after the first change that is waiting.
   */
  changed(): void {
    if (!this.#placed) return;
    const waiting = this.#timer !== undefined;
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => this.save(), DRAFT_DELAY);
    this.#longest ??= setTimeout(() => this.save(), DRAFT_LONGEST);
    if (!waiting) this.#onPending(true);
  }

  /** Puts away the writes that were coming. */
  #stop(): void {
    const waiting = this.#timer !== undefined;
    clearTimeout(this.#timer);
    clearTimeout(this.#longest);
    this.#timer = undefined;
    this.#longest = undefined;
    if (waiting) this.#onPending(false);
  }

  /** The person typed in a box: its slot is the one to give the caret back to. */
  typedIn(box: 'comment' | { thread: string }): void {
    this.#last = box === 'comment' ? box : replySlot(box.thread);
  }

  /**
   * Writes the drafts now: each slot changed in this window since it last wrote it, and what this
   * window forgot. With `replace`, what is kept for the document becomes this window's alone.
   */
  save(replace = false): void {
    this.#stop();
    if (!this.#placed) return;
    const kept = replace ? {} : readDrafts(this.#store.get(DRAFTS_KEY));
    const stored = slotsOf(kept);
    const now = slotsNow(this.#now());
    let wrote = replace;
    for (const [slot, draft] of now) {
      const known = this.#known.get(slot);
      if (!known || known.text !== draft.text) {
        // Typed here: the text typed last is the one kept.
        const v = newVersion();
        stored.set(slot, draft.keep(v));
        this.#known.set(slot, { v, text: draft.text, place: draft.place, doc: draft.doc });
        wrote = true;
      } else if (replace || known.place !== draft.place || known.doc !== draft.doc) {
        // Only moved with its text, as typing in the document moves an anchor: written over this
        // window's own version only, and never over another window's text.
        known.place = draft.place;
        known.doc = draft.doc;
        if (replace || stored.get(slot)?.v === known.v) {
          stored.set(slot, draft.keep(known.v));
          wrote = true;
        }
      }
    }
    for (const [slot, known] of this.#known) {
      if (now.has(slot)) continue;
      this.#known.delete(slot);
      if (stored.get(slot)?.v !== known.v) continue;
      stored.delete(slot);
      wrote = true;
    }
    if (!wrote) return;
    const drafts = draftsOf(stored, this.#last ?? slotOfBox(kept.last));
    this.#store.set(DRAFTS_KEY, stored.size ? drafts : undefined);
  }

  /**
   * Forgets this window's drafts in the store, and what was about to be written: the person
   * discarded them. What is typed after this is kept again.
   */
  discard(): void {
    this.#stop();
    if (this.#placed && this.#known.size) {
      const kept = readDrafts(this.#store.get(DRAFTS_KEY));
      const stored = slotsOf(kept);
      for (const [slot, known] of this.#known) {
        if (stored.get(slot)?.v === known.v) stored.delete(slot);
      }
      const drafts = draftsOf(stored, slotOfBox(kept.last));
      this.#store.set(DRAFTS_KEY, stored.size ? drafts : undefined);
    }
    this.#known.clear();
  }

  /** Writes what is waiting to be written, as the document leaves the editor. */
  flush(): void {
    if (this.#timer !== undefined) this.save();
  }
}
