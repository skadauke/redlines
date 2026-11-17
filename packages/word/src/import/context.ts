// What the mapper keeps while it walks the model: the people, the ledger's marks and threads, the
// ids already used, and the report.

import { encodePayload, newId } from '@redlines/format';
import type {
  Handle,
  Ledger,
  MarkEntry,
  Person as LedgerPerson,
  Reply,
  Thread,
} from '@redlines/format';
import { NO_TIME, ledgerTime } from '../shared/dates.ts';
import type { ImportReport, ReportEntry } from '../shared/report.ts';
import type { Comment, DocxModel, Revision } from './model.ts';

/** Words YAML 1.1 reads as something else, and the handle that is kept for nobody (format §2.4). */
const RESERVED = new Set(['y', 'n', 'yes', 'no', 'on', 'off', 'true', 'false', 'null', 'unknown']);

/** A ledger time from a revision's best time, or the epoch for one nobody timed. */
export function timeOf(at: string): string {
  return at !== '' ? at : ledgerTime(NO_TIME);
}

/** Handles from names (format §5.3): the same name is the same person, a clash gets `-2`. */
export class People {
  private readonly byName = new Map<string, Handle>();
  private readonly taken = new Set<string>();
  private readonly list: LedgerPerson[] = [];

  private readonly model: DocxModel;

  constructor(model: DocxModel) {
    this.model = model;
  }

  private slug(name: string): string {
    const folded = name
      .normalize('NFKD')
      .replace(/\p{M}+/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    let handle = folded === '' ? 'user' : folded;
    if (!/^[a-z]/.test(handle)) handle = `u-${handle}`;
    if (RESERVED.has(handle)) handle = `${handle}-user`;
    return handle;
  }

  /** The handle of a Word author name. */
  handle(author: string): Handle {
    const name = author.trim();
    if (name === '' || /^unknown$/i.test(name)) return 'unknown';
    const known = this.byName.get(name);
    if (known) return known;
    const base = this.slug(name);
    let handle = base;
    for (let n = 2; this.taken.has(handle); n++) handle = `${base}-${n}`;
    this.taken.add(handle);
    this.byName.set(name, handle);
    const person: LedgerPerson = { handle, name };
    const account = this.model.people.find((p) => p.name === name && p.providerId && p.userId);
    if (account) person.accounts = [`${account.providerId}:${account.userId}`];
    this.list.push(person);
    return handle;
  }

  /** The people met so far, in the order they were met. */
  people(): LedgerPerson[] {
    return this.list;
  }
}

/** A thread being built: its anchor appears in the text, its entry in the ledger. */
export interface ThreadState {
  id: string;
  root: Comment;
  replies: Comment[];
  /** The range is open: the start was written and the end hasn't been. */
  open: boolean;
  /** The thread's marker has been written. */
  placed: boolean;
  /** Where its first marker stands among the threads. */
  order: number;
}

export class Ctx {
  readonly people: People;
  readonly marks: Record<string, MarkEntry> = {};
  readonly taken = new Set<string>();
  readonly entries: ReportEntry[] = [];
  readonly counts = new Map<string, { entry: ReportEntry; count: number }>();
  readonly threadOfComment = new Map<number, ThreadState>();
  readonly threads: ThreadState[] = [];
  private placedCount = 0;
  readonly moves = new Map<string, { from?: string; to?: string }>();
  readonly media: Record<string, Uint8Array> = {};
  /** The footnote labels, in the order they are first used, and what each holds. */
  readonly notes = new Map<string, { label: string; kind: 'footnote' | 'endnote'; id: number }>();

  readonly model: DocxModel;

  constructor(model: DocxModel) {
    this.model = model;
    this.people = new People(model);
    for (const entry of model.report) this.entries.push(entry);
    for (const thread of model.threads) {
      const state: ThreadState = {
        id: '',
        root: thread.root,
        replies: thread.replies,
        open: false,
        placed: false,
        order: 0,
      };
      this.threads.push(state);
      this.threadOfComment.set(thread.root.id, state);
      for (const reply of thread.replies) this.threadOfComment.set(reply.id, state);
    }
  }

  /** Says something once, and counts how often it came up. */
  note(kind: string, message: string): void {
    const found = this.counts.get(`${kind}:${message}`);
    if (found) {
      found.count++;
      return;
    }
    const entry = { kind, message };
    this.counts.set(`${kind}:${message}`, { entry, count: 1 });
    this.entries.push(entry);
  }

  newId(): string {
    const id = newId(this.taken);
    this.taken.add(id);
    return id;
  }

  /** A mark's id, with its ledger entry. */
  mark(revision: Pick<Revision, 'author' | 'at'>, extras: Partial<MarkEntry> = {}): string {
    const id = this.newId();
    this.marks[id] = {
      by: this.people.handle(revision.author),
      at: timeOf(revision.at),
      ...extras,
    };
    return id;
  }

  /** The id of a thread, drawn when its first marker is written. */
  threadId(state: ThreadState): string {
    if (state.id === '') {
      state.id = this.newId();
      state.placed = true;
      state.order = this.placedCount++;
    }
    return state.id;
  }

  /** Remembers the id of a move's two ends, by the move's name. */
  moveEnd(name: string | undefined, direction: 'from' | 'to', id: string): void {
    if (name === undefined || name === '') return;
    const ends = this.moves.get(name) ?? {};
    ends[direction] = id;
    this.moves.set(name, ends);
  }

  /** The ledger, from what was kept. `textOf` writes a comment's text. */
  ledger(textOf: (comment: Comment) => string): Ledger {
    for (const [, ends] of this.moves) {
      if (!ends.from || !ends.to) continue;
      const from = this.marks[ends.from];
      const to = this.marks[ends.to];
      if (from && to) {
        from.move = ends.to;
        to.move = ends.from;
      }
    }
    const comments: Thread[] = this.threads
      .filter((state) => state.placed)
      .toSorted((a, b) => a.order - b.order)
      .map((state) => this.threadOf(state, textOf));
    return {
      version: 1,
      people: this.people.people(),
      marks: this.marks,
      comments,
    };
  }

  private threadOf(state: ThreadState, textOf: (comment: Comment) => string): Thread {
    const root = state.root;
    const thread: Thread = {
      id: state.id,
      by: this.people.handle(root.author),
      at: timeOf(root.at),
      likes: [],
      replies: state.replies.map((reply): Reply => {
        return {
          id: this.newId(),
          by: this.people.handle(reply.author),
          at: timeOf(reply.at),
          text: textOf(reply),
        };
      }),
      text: textOf(root),
    };
    if (root.done) thread.resolved = { by: thread.by, at: thread.at };
    return thread;
  }

  /** The report, with how often each thing came up. */
  report(): ImportReport {
    return {
      entries: this.entries.map((entry) => {
        const counted = this.counts.get(`${entry.kind}:${entry.message}`);
        return counted && counted.count > 1
          ? { kind: entry.kind, message: `${entry.message} (${counted.count} places)` }
          : entry;
      }),
    };
  }
}

/** Payload text as the format writes it. */
export function payload(text: string): string {
  return encodePayload(text);
}
