// The ledger as a keyed map, and the entry operations on it (multiuser research §4.3). In a live
// session the body syncs as text and the ledger as entries: a mark's entry, a thread, a reply, a
// like, a resolve, a person, a setting. Entries with different keys commute, and the operations of
// one key are applied in the order the authority gives them. Nothing here changes how today's edits
// write the ledger (`ledger-write.ts`); a map is written with the same serializer, in the same
// canonical order, so that every copy that holds the same map writes the same bytes.

import { EditError } from './errors.ts';
import { findLedger, readSpan } from './ledger-read.ts';
import { normalizeLedger } from './ledger-order.ts';
import { keepsLedger, serializeLedger, setLedger } from './ledger-write.ts';
import type { SetLedgerOptions } from './ledger-write.ts';
import type {
  Ledger,
  LedgerView,
  MarkEntry,
  Person,
  Reply,
  TextChange,
  Thread,
  YamlValue,
} from './types.ts';

/** The ledger's one-word settings. */
export interface LedgerSettings {
  tracking?: 'everyone';
  view?: LedgerView;
  history?: 'current' | 'full';
}

/**
 * A ledger, keyed. Marks by id, threads by id (with their replies, likes and resolved state), people
 * by handle, and the settings. `extra` holds the keys of the top level that the ledger has beside
 * these, `frontmatter` among them (format §5.2). Each map keeps the order it was filled in, which
 * is only the order of threads whose anchor is gone: `writeLedger` puts the rest in document order.
 */
export interface LedgerMap {
  settings: LedgerSettings;
  people: Map<string, Person>;
  marks: Map<string, MarkEntry>;
  threads: Map<string, Thread>;
  extra: Map<string, YamlValue>;
}

/** A map with nothing in it. */
export function emptyLedgerMap(): LedgerMap {
  return {
    settings: {},
    people: new Map(),
    marks: new Map(),
    threads: new Map(),
    extra: new Map(),
  };
}

/** The map of a `Ledger` that is already read. Nothing is shared with it that an operation changes. */
export function ledgerMapOf(ledger: Ledger): LedgerMap {
  const map = emptyLedgerMap();
  if (ledger.tracking) map.settings.tracking = ledger.tracking;
  if (ledger.view) map.settings.view = ledger.view;
  if (ledger.history) map.settings.history = ledger.history;
  for (const person of ledger.people) map.people.set(person.handle, person);
  for (const [id, entry] of Object.entries(ledger.marks)) map.marks.set(id, entry);
  for (const thread of ledger.comments) map.threads.set(thread.id, thread);
  for (const [name, value] of Object.entries(ledger.extra ?? {})) map.extra.set(name, value);
  return map;
}

/**
 * Reads the ledger of a file into a map. A file with no ledger gives an empty map.
 *
 * @throws EditError when the file's ledger can't be read: a map of it would be empty, and writing
 *   that map would lose what is in it.
 */
export function ledgerEntries(text: string): LedgerMap {
  const span = findLedger(text);
  if (!span) return emptyLedgerMap();
  const read = readSpan(span);
  if (!read.valid) {
    throw new EditError(
      "The ledger at the end of this file can't be read, so it has no entries.",
      'unreadable-ledger',
    );
  }
  return ledgerMapOf(read.ledger);
}

/** The `Ledger` of a map, its marks and threads in the order the map holds them. */
export function ledgerOfMap(map: LedgerMap): Ledger {
  const ledger: Ledger = {
    version: 1,
    people: [...map.people.values()],
    marks: Object.fromEntries(map.marks),
    comments: [...map.threads.values()],
  };
  if (map.settings.tracking) ledger.tracking = map.settings.tracking;
  if (map.settings.view) ledger.view = map.settings.view;
  if (map.settings.history) ledger.history = map.settings.history;
  if (map.extra.size > 0) ledger.extra = Object.fromEntries(map.extra);
  return ledger;
}

/**
 * The ledger of `body` as the file holds it: the whole comment, from `<!-- redlines` to `-->`, with
 * LF line breaks, or an empty string when the map holds nothing that keeps a ledger (format §5.1).
 * Marks and threads come in the document order of `body`, as every edit writes them
 * (`normalizeLedger`), so the entries of marks that are not in `body` are left out, as they are on
 * every save (format §5.4). `body` may still hold the old ledger, which is not read.
 */
export function writeLedger(map: LedgerMap, body: string): string {
  const ledger = normalizeLedger(body, ledgerOfMap(map));
  return keepsLedger(ledger) ? serializeLedger(ledger) : '';
}

/** The changes that make the ledger of `text` the one `map` holds, in `text`'s own body. */
export function setLedgerEntries(
  text: string,
  map: LedgerMap,
  options: SetLedgerOptions = {},
): TextChange[] {
  return setLedger(text, normalizeLedger(text, ledgerOfMap(map)), options);
}

/** One change to the ledger's entries. */
export type LedgerOp =
  /** Sets a mark's entry. An entry that is there is replaced: an author editing their own mark. */
  | { op: 'addMark'; id: string; entry: MarkEntry }
  | { op: 'removeMark'; id: string }
  /** A thread that is already there is left as it is: it keeps its replies. */
  | { op: 'addThread'; thread: Thread }
  | { op: 'removeThread'; id: string }
  /** A reply to a thread that isn't there, or with an id that is used in it, is ignored. */
  | { op: 'reply'; thread: string; reply: Reply }
  /** One like for each person: a second is ignored. */
  | { op: 'like'; thread: string; by: string; at: string }
  | { op: 'unlike'; thread: string; by: string }
  | { op: 'resolve'; thread: string; by: string; at: string }
  | { op: 'reopen'; thread: string }
  /** A person whose handle is taken is ignored: the earlier one keeps it (format §5.3). */
  | { op: 'addPerson'; person: Person }
  | { op: 'setTracking'; value: 'everyone' | undefined }
  | { op: 'setView'; value: LedgerView | undefined }
  | { op: 'setHistory'; value: 'current' | 'full' | undefined }
  /** A key of the top level that the ledger has beside the ones above, `frontmatter` for one. */
  | { op: 'setField'; name: string; value: YamlValue | undefined };

function cloneMap(map: LedgerMap): LedgerMap {
  return {
    settings: { ...map.settings },
    people: new Map(map.people),
    marks: new Map(map.marks),
    threads: new Map(map.threads),
    extra: new Map(map.extra),
  };
}

function withThread(map: LedgerMap, id: string, change: (thread: Thread) => Thread): LedgerMap {
  const thread = map.threads.get(id);
  if (!thread) return map;
  const next = change(thread);
  if (next === thread) return map;
  const copy = cloneMap(map);
  copy.threads.set(id, next);
  return copy;
}

function usesReplyId(thread: Thread, id: string): boolean {
  return thread.replies.some((reply) => reply.id === id);
}

/**
 * The map after one operation; `map` is not changed, and is returned itself when the operation
 * changes nothing. Applying every update in the authority's order gives every copy the same map.
 *
 * A reply made after a thread was resolved reopens it, as the format says (§4). A reply that is not
 * later than the resolve does not: a resolve and a reply made at the same time leave the thread
 * resolved, and the editor flags the newer reply.
 */
export function applyLedgerOp(map: LedgerMap, op: LedgerOp): LedgerMap {
  switch (op.op) {
    case 'addMark': {
      const copy = cloneMap(map);
      copy.marks.set(op.id, op.entry);
      return copy;
    }
    case 'removeMark': {
      if (!map.marks.has(op.id)) return map;
      const copy = cloneMap(map);
      copy.marks.delete(op.id);
      return copy;
    }
    case 'addThread': {
      if (map.threads.has(op.thread.id)) return map;
      const copy = cloneMap(map);
      copy.threads.set(op.thread.id, op.thread);
      return copy;
    }
    case 'removeThread': {
      if (!map.threads.has(op.id)) return map;
      const copy = cloneMap(map);
      copy.threads.delete(op.id);
      return copy;
    }
    case 'reply':
      return withThread(map, op.thread, (thread) => {
        if (usesReplyId(thread, op.reply.id)) return thread;
        const next: Thread = { ...thread, replies: [...thread.replies, op.reply] };
        if (thread.resolved && op.reply.at > thread.resolved.at) delete next.resolved;
        return next;
      });
    case 'like':
      return withThread(map, op.thread, (thread) =>
        thread.likes.some((like) => like.by === op.by)
          ? thread
          : { ...thread, likes: [...thread.likes, { by: op.by, at: op.at }] },
      );
    case 'unlike':
      return withThread(map, op.thread, (thread) =>
        thread.likes.some((like) => like.by === op.by)
          ? { ...thread, likes: thread.likes.filter((like) => like.by !== op.by) }
          : thread,
      );
    case 'resolve':
      return withThread(map, op.thread, (thread) => ({
        ...thread,
        resolved: { by: op.by, at: op.at },
      }));
    case 'reopen':
      return withThread(map, op.thread, (thread) => {
        if (!thread.resolved) return thread;
        const next = { ...thread };
        delete next.resolved;
        return next;
      });
    case 'addPerson': {
      if (map.people.has(op.person.handle)) return map;
      const copy = cloneMap(map);
      copy.people.set(op.person.handle, op.person);
      return copy;
    }
    case 'setTracking':
    case 'setView':
    case 'setHistory': {
      const name = op.op === 'setTracking' ? 'tracking' : op.op === 'setView' ? 'view' : 'history';
      if (map.settings[name] === op.value) return map;
      const copy = cloneMap(map);
      const settings = copy.settings as Record<string, string | undefined>;
      if (op.value === undefined) delete settings[name];
      else settings[name] = op.value;
      return copy;
    }
    case 'setField': {
      const copy = cloneMap(map);
      if (op.value === undefined) copy.extra.delete(op.name);
      else copy.extra.set(op.name, op.value);
      return copy;
    }
  }
}

/** The map after `ops`, applied in order. */
export function applyLedgerOps(map: LedgerMap, ops: readonly LedgerOp[]): LedgerMap {
  return ops.reduce(applyLedgerOp, map);
}
