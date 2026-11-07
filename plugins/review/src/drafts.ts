// Drafts that outlast the page (design §5.7): the comments and replies being written in a document,
// kept for it in the host's store (plugin API `HostDocumentData`) as they are typed, and given back
// when the document opens again, in any window. Writes are gathered: a change is written a moment
// later, with whatever else changed meanwhile, so no keystroke waits on the store.
//
// The store holds one record for each document, named by its real path, which the host gives the
// review. Each draft in it is a slot of its own (the new comment, the comment set aside with Escape,
// each reply), with the version of its text. A window writes only the slots it changed, so that two
// windows on one document don't take each other's drafts: the text typed last is the one kept. It
// forgets a slot only while the store still holds the version it wrote or took, so that posting in
// one window never loses what was typed since in another.

import type { Text } from '@codemirror/state';
import type { HostDocumentData } from '@redlines/plugin-api';
import { type Anchor, aroundAnchor, type KeptAnchor } from './anchors.ts';

/** How long after a change the drafts are written, with what changed meanwhile. */
export const DRAFT_DELAY = 500;

/** Under what the review keeps a document's drafts in the host's store. */
export const DRAFTS_KEY = 'review.drafts';

/**
 * The longest document a new comment keeps a copy of, in characters, to find its text again as a
 * reload would. A longer one keeps the text around the anchor, which is found only where it was.
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

/** A document's drafts as they are kept. */
export interface KeptDrafts {
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

function keptComment(value: unknown): KeptComment | null {
  const written = keptText(value);
  if (!written || !isObject(value)) return null;
  const { from, to, changed, doc, around } = value;
  if (!isOffset(from) || !isOffset(to) || to < from) return null;
  const anchor: KeptComment = { ...written, from, to };
  if (changed === true) anchor.changed = true;
  if (typeof doc === 'string' && to <= doc.length) anchor.doc = doc;
  else if (typeof around === 'string') anchor.around = around;
  else return null;
  return anchor;
}

/** What a store holds for a document, read as drafts; what isn't understood is left out. */
export function readDrafts(value: unknown): KeptDrafts {
  if (!isObject(value)) return {};
  const drafts: KeptDrafts = {};
  const comment = keptComment(value['comment']);
  const aside = keptComment(value['aside']);
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

/** A new comment as it is kept: with a copy of the document, unless that is too long. */
export function keepComment(
  { range, text }: CommentNow,
  doc: Text,
  v: string,
  maxCopy = MAX_COPY,
): KeptComment {
  const kept: KeptComment = { from: range.from, to: range.to, text, v };
  if (range.changed) kept.changed = true;
  if (doc.length <= maxCopy) kept.doc = doc.toString();
  else kept.around = aroundAnchor(range, doc);
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

/** A record of the slots, with the box last typed in when it has one. */
function draftsOf(slots: Map<string, KeptComment | KeptReply>, last?: string): KeptDrafts {
  const drafts: KeptDrafts = {};
  for (const [slot, kept] of slots) {
    if (slot === 'comment' || slot === 'aside') drafts[slot] = kept as KeptComment;
    else (drafts.replies ??= {})[boxOfSlot(slot)] = kept;
  }
  if (last !== undefined && last !== 'aside' && slots.has(last)) drafts.last = boxOfSlot(last);
  return drafts;
}

/**
 * Keeps one document's drafts in the host's store, for as long as the document is open in the
 * editor: the rail makes one for each document, and tells it where the document is.
 */
export class DraftKeeper {
  readonly #store: HostDocumentData;
  readonly #now: () => DraftsNow;
  /** The document's real path: undefined until the host says, null for a document never saved. */
  #path: string | null | undefined;
  readonly #known = new Map<string, Known>();
  #timer: ReturnType<typeof setTimeout> | undefined;
  /** The slot last typed in, in this window. */
  #last: string | undefined;

  constructor(store: HostDocumentData, now: () => DraftsNow) {
    this.#store = store;
    this.#now = now;
  }

  /** Whether the host has said where the document is. */
  get placed(): boolean {
    return this.#path !== undefined;
  }

  /**
   * The first time: where the document is, and the drafts kept for it, which the rail gives back.
   * Then call `took` with what it gave back.
   */
  place(path: string | null): KeptDrafts {
    this.#path = path;
    if (path === null) return {};
    return readDrafts(this.#store.get(path, DRAFTS_KEY));
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
   * The document is now at `path`: renamed, or saved as. Its drafts go with it, and take the place
   * of whatever was kept for the file it now is, which was another document's.
   */
  move(path: string | null): void {
    if (path === this.#path) return;
    this.discard();
    this.#path = path;
    this.save(true);
  }

  /** Something changed in the drafts: they are written in a moment. */
  changed(): void {
    if (typeof this.#path !== 'string' || this.#timer !== undefined) return;
    this.#timer = setTimeout(() => this.save(), DRAFT_DELAY);
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
    clearTimeout(this.#timer);
    this.#timer = undefined;
    const path = this.#path;
    if (typeof path !== 'string') return;
    const kept = replace ? {} : readDrafts(this.#store.get(path, DRAFTS_KEY));
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
    this.#store.set(path, DRAFTS_KEY, stored.size ? drafts : undefined);
  }

  /**
   * Forgets this window's drafts in the store, and what was about to be written: the person
   * discarded them. What is typed after this is kept again.
   */
  discard(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    const path = this.#path;
    if (typeof path === 'string' && this.#known.size) {
      const kept = readDrafts(this.#store.get(path, DRAFTS_KEY));
      const stored = slotsOf(kept);
      for (const [slot, known] of this.#known) {
        if (stored.get(slot)?.v === known.v) stored.delete(slot);
      }
      const drafts = draftsOf(stored, slotOfBox(kept.last));
      this.#store.set(path, DRAFTS_KEY, stored.size ? drafts : undefined);
    }
    this.#known.clear();
  }

  /** Writes what is waiting to be written, as the document leaves the editor. */
  flush(): void {
    if (this.#timer !== undefined) this.save();
  }
}
