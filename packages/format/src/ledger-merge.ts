// A three-way merge of ledgers (format §7.4), for the merge driver: two ledgers and their common
// base give one. It is a set merge by key. An entry that one side added or changed is kept, one that
// a side removed and the other left alone is removed, and two sides that changed the same field
// leave the one that sorts later, so that the result doesn't depend on which side is which.
// Duplicate ids and handles, which two sides can draw alike, are renamed (format §2.3, §7.3).

import { applyChanges } from './changes.ts';
import { idsIn, newId } from './ids.ts';
import { emptyLedgerMap } from './ledger-map.ts';
import type { LedgerMap } from './ledger-map.ts';
import { scan } from './scan.ts';
import type { MarkEntry, Person, Reply, TextChange, Thread, YamlValue } from './types.ts';

export type MergeSide = 'ours' | 'theirs';

/** A rename the merge made on one side. Rename an id in that side's body too (`renameMarkId`) before
 * the bodies are merged; a handle is in no body. */
export interface LedgerRename {
  side: MergeSide;
  kind: 'id' | 'handle';
  from: string;
  to: string;
}

export interface LedgerMerge {
  ledger: LedgerMap;
  renames: LedgerRename[];
}

export interface LedgerMergeOptions {
  /** Ids used elsewhere, such as every id in the bodies (`idsIn`), which a new id must avoid. */
  taken?: Iterable<string>;
  /** Draws a new id that isn't in `taken`. Tests pass a fixed one. */
  newId?: (taken: ReadonlySet<string>) => string;
}

type Rec = Record<string, unknown>;

/** Equal, as values are: the order of keys doesn't matter. */
function canon(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return `[${value.map(canon).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Rec)
      .filter(([, item]) => item !== undefined)
      .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canon(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

const same = (a: unknown, b: unknown) => canon(a) === canon(b);

/** One value of a field: the side that changed it wins; when both did, a value beats none, and of
 * two values the one that sorts later does. */
function pick3<T>(base: T | undefined, ours: T | undefined, theirs: T | undefined): T | undefined {
  if (same(ours, theirs)) return ours;
  if (same(base, ours)) return theirs;
  if (same(base, theirs)) return ours;
  if (ours === undefined) return theirs;
  if (theirs === undefined) return ours;
  return canon(ours) >= canon(theirs) ? ours : theirs;
}

/** The version of a later Redlines, which is the higher number: never a downgrade (format §5.2). */
function newerVersion(base: unknown, ours: unknown, theirs: unknown): unknown {
  const number = (value: unknown) => (typeof value === 'string' ? Number(value) : 0);
  return number(ours) >= number(theirs) ? (ours ?? base) : theirs;
}

/** A list of strings as a set: what either side added is kept, and what either removed is gone. */
function set3(
  base: string[] | undefined,
  ours: string[] | undefined,
  theirs: string[] | undefined,
): string[] | undefined {
  const b = new Set(base);
  const o = new Set(ours);
  const t = new Set(theirs);
  const kept = [
    ...(ours ?? []).filter((x) => t.has(x) || !b.has(x)),
    ...(theirs ?? []).filter((x) => !o.has(x) && !b.has(x)),
  ];
  return kept.length > 0 ? kept : undefined;
}

type FieldMerge = (base: unknown, ours: unknown, theirs: unknown) => unknown;

/** An object field by field. `special` holds the fields that merge in their own way. */
function mergeFields<T extends object>(
  base: T | undefined,
  ours: T,
  theirs: T,
  special: Record<string, FieldMerge> = {},
): T {
  const b = (base ?? {}) as Rec;
  const o = ours as Rec;
  const t = theirs as Rec;
  const result: Rec = {};
  for (const name of new Set([...Object.keys(b), ...Object.keys(o), ...Object.keys(t)])) {
    const merge = special[name] ?? pick3;
    const value = merge(b[name], o[name], t[name]);
    if (value !== undefined) result[name] = value;
  }
  return result as T;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * A list of things with keys, in order of time, merged. Ours keeps its order, and what only theirs
 * has goes in after the last item that is not later, by time and then key, so that two replies to
 * one thread are both kept, in conversation order.
 */
function mergeList<V extends object>(
  base: readonly V[],
  ours: readonly V[],
  theirs: readonly V[],
  keyOf: (value: V) => string,
  atOf: (value: V) => string,
): V[] {
  const b = new Map(base.map((v) => [keyOf(v), v]));
  const o = new Map(ours.map((v) => [keyOf(v), v]));
  const t = new Map(theirs.map((v) => [keyOf(v), v]));
  const result: V[] = [];
  for (const mine of ours) {
    const key = keyOf(mine);
    const other = t.get(key);
    const was = b.get(key);
    if (other) result.push(same(mine, other) ? mine : mergeFields(was, mine, other));
    else if (was === undefined || !same(was, mine)) result.push(mine);
  }
  const after = (item: V, than: V) =>
    atOf(than) < atOf(item) || (atOf(than) === atOf(item) && keyOf(than) < keyOf(item));
  for (const other of theirs) {
    const key = keyOf(other);
    if (o.has(key)) continue;
    const was = b.get(key);
    if (was !== undefined && same(was, other)) continue;
    let at = result.length;
    while (at > 0 && !after(other, result[at - 1] as V)) at--;
    result.splice(at, 0, other);
  }
  return result;
}

/** A set of entries by key, merged. */
function mergeKeyed<V>(
  base: ReadonlyMap<string, V>,
  ours: ReadonlyMap<string, V>,
  theirs: ReadonlyMap<string, V>,
  merge: (base: V | undefined, ours: V, theirs: V) => V,
): Map<string, V> {
  const keys = [...new Set([...base.keys(), ...ours.keys(), ...theirs.keys()])].sort(compareText);
  const result = new Map<string, V>();
  for (const key of keys) {
    const was = base.get(key);
    const mine = ours.get(key);
    const other = theirs.get(key);
    if (mine !== undefined && other !== undefined) {
      result.set(key, same(mine, other) ? mine : merge(was, mine, other));
    } else if (mine !== undefined) {
      // The other side removed it: that stands unless this side changed it.
      if (was === undefined || !same(was, mine)) result.set(key, mine);
    } else if (other !== undefined) {
      if (was === undefined || !same(was, other)) result.set(key, other);
    }
  }
  return result;
}

type Resolved = { by: string; at: string } | undefined;

/** A thread resolved on either side is resolved: a resolve and a reply that reopens it, made apart,
 * leave it resolved (format §4). A side that only reopened gives way to the other. */
function mergeResolved(base: Resolved, ours: Resolved, theirs: Resolved): Resolved {
  if (same(ours, theirs)) return ours;
  if (same(base, ours)) return theirs;
  if (same(base, theirs)) return ours;
  if (ours === undefined) return theirs;
  if (theirs === undefined) return ours;
  if (ours.at !== theirs.at) return ours.at > theirs.at ? ours : theirs;
  return canon(ours) >= canon(theirs) ? ours : theirs;
}

type Like = { by: string; at: string };

function mergeThread(base: Thread | undefined, ours: Thread, theirs: Thread): Thread {
  return mergeFields(base, ours, theirs, {
    resolved: (b, o, t) => mergeResolved(b as Resolved, o as Resolved, t as Resolved),
    likes: (b, o, t) =>
      mergeList(
        (b ?? []) as Like[],
        (o ?? []) as Like[],
        (t ?? []) as Like[],
        (like) => like.by,
        (like) => like.at,
      ),
    replies: (b, o, t) =>
      mergeList(
        (b ?? []) as Reply[],
        (o ?? []) as Reply[],
        (t ?? []) as Reply[],
        (reply) => reply.id,
        (reply) => reply.at,
      ),
  });
}

const setOf: FieldMerge = (b, o, t) =>
  set3(b as string[] | undefined, o as string[] | undefined, t as string[] | undefined);

function mergePerson(base: Person | undefined, ours: Person, theirs: Person): Person {
  return mergeFields(base, ours, theirs, { accounts: setOf, aliases: setOf, members: setOf });
}

function mergeEntry(base: MarkEntry | undefined, ours: MarkEntry, theirs: MarkEntry): MarkEntry {
  return mergeFields(base, ours, theirs);
}

/** Pending front matter changes are a list of `{key, by, at, was}`: one per key, merged by key. */
function mergeFrontmatter(base: unknown, ours: unknown, theirs: unknown): unknown {
  const list = (value: unknown) =>
    Array.isArray(value) ? (value as { [key: string]: YamlValue }[]) : [];
  if (![ours, theirs].every((v) => v === undefined || Array.isArray(v)))
    return pick3(base, ours, theirs);
  const merged = mergeList(
    list(base),
    list(ours),
    list(theirs),
    (item) => (typeof item['key'] === 'string' ? item['key'] : canon(item)),
    (item) => (typeof item['at'] === 'string' ? item['at'] : ''),
  );
  return merged.length > 0 ? merged : undefined;
}

// --- Duplicate ids and handles ---------------------------------------------------------------

interface IdUse {
  /** What the id names, with what tells two things that share it apart. */
  identity: string;
  at: string;
}

/** Every id in a map, with what it names: marks, threads and replies share the one set of ids. */
function idUses(map: LedgerMap): Map<string, IdUse> {
  const uses = new Map<string, IdUse>();
  for (const [id, entry] of map.marks) {
    uses.set(id, { identity: `mark ${entry.by} ${entry.at}`, at: entry.at });
  }
  for (const thread of map.threads.values()) {
    uses.set(thread.id, {
      identity: `thread ${thread.by} ${thread.at} ${thread.text}`,
      at: thread.at,
    });
    for (const reply of thread.replies) {
      uses.set(reply.id, { identity: `reply ${reply.by} ${reply.at} ${reply.text}`, at: reply.at });
    }
  }
  return uses;
}

/** `map` with the id `from` named `to` everywhere it is a key or a reference. */
function renameId(map: LedgerMap, from: string, to: string): LedgerMap {
  const swap = (id: string | undefined) => (id === from ? to : id);
  const marks = new Map<string, MarkEntry>();
  for (const [id, entry] of map.marks) {
    const next: MarkEntry = { ...entry };
    if (entry.group === from) next.group = to;
    if (entry.move === from) next.move = to;
    marks.set(swap(id) as string, next);
  }
  const threads = new Map<string, Thread>();
  for (const thread of map.threads.values()) {
    const next: Thread = {
      ...thread,
      id: swap(thread.id) as string,
      replies: thread.replies.map((reply) => ({ ...reply, id: swap(reply.id) as string })),
    };
    if (thread.about === from) next.about = to;
    threads.set(next.id, next);
  }
  return { ...map, marks, threads };
}

/** A handle in running text: `@handle` after a space or punctuation. */
function mentionOf(handle: string): RegExp {
  const escaped = handle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![A-Za-z0-9_@])@${escaped}(?![A-Za-z0-9_]|-[A-Za-z0-9_])`, 'g');
}

/** `map` with the handle `from` named `to`: the person, every author and time, and the mentions. */
function renameHandle(map: LedgerMap, from: string, to: string): LedgerMap {
  const swap = (handle: string) => (handle === from ? to : handle);
  const swapAll = (handles: string[] | undefined) => handles?.map(swap);
  const mention = mentionOf(from);
  const say = (text: string) => text.replace(mention, `@${to}`);
  const people = new Map<string, Person>();
  for (const person of map.people.values()) {
    const next: Person = { ...person, handle: swap(person.handle) };
    if (person.for !== undefined) next.for = swap(person.for);
    const members = swapAll(person.members);
    if (members) next.members = members;
    people.set(next.handle, next);
  }
  const marks = new Map<string, MarkEntry>();
  for (const [id, entry] of map.marks) {
    const next: MarkEntry = { ...entry, by: swap(entry.by) };
    if (entry.note !== undefined) next.note = say(entry.note);
    marks.set(id, next);
  }
  const threads = new Map<string, Thread>();
  for (const thread of map.threads.values()) {
    const next: Thread = {
      ...thread,
      by: swap(thread.by),
      text: say(thread.text),
      likes: thread.likes.map((like) => ({ ...like, by: swap(like.by) })),
      replies: thread.replies.map((reply) => ({
        ...reply,
        by: swap(reply.by),
        text: say(reply.text),
      })),
    };
    if (thread.resolved) next.resolved = { ...thread.resolved, by: swap(thread.resolved.by) };
    if (thread.assigned !== undefined) next.assigned = swap(thread.assigned);
    threads.set(next.id, next);
  }
  return { ...map, people, marks, threads };
}

/** The same person: the same name and email, or an account both have. */
function samePerson(a: Person, b: Person): boolean {
  if (a.accounts?.some((account) => b.accounts?.includes(account))) return true;
  return a.name === b.name && a.email === b.email;
}

// --- The merge -------------------------------------------------------------------------------

/**
 * Merges two ledgers made from one `base`. `ours` and `theirs` are alike: swapping them gives the
 * same ledger, but for the ids drawn for renames.
 *
 * - Marks, threads, replies, likes and people are sets by key. A key that one side added is kept;
 *   one that a side removed goes unless the other side changed it; one that both changed is merged
 *   field by field.
 * - Replies and likes from both sides are kept, in order of time.
 * - A thread that is resolved on either side is resolved (format §4).
 * - An id that two sides drew alike for different things is renamed on the side whose thing is later
 *   (format §2.3), and so is a handle that two sides gave to different people (format §7.3: it gets
 *   a suffix, `-2`, `-3`). `renames` says what, so the caller renames the id in that side's body.
 *   Things that are the same, by author and time and text, are merged as one.
 */
export function mergeLedgers(
  base: LedgerMap,
  ours: LedgerMap,
  theirs: LedgerMap,
  options: LedgerMergeOptions = {},
): LedgerMerge {
  const renames: LedgerRename[] = [];
  const sides: Record<MergeSide, LedgerMap> = { ours, theirs };

  // Ids drawn alike.
  const baseUses = idUses(base);
  const uses = { ours: idUses(ours), theirs: idUses(theirs) };
  const taken = new Set<string>([...baseUses.keys(), ...uses.ours.keys(), ...uses.theirs.keys()]);
  for (const id of options.taken ?? []) taken.add(id);
  const draw = options.newId ?? ((used: ReadonlySet<string>) => newId(used));
  const clashes = [...uses.ours.keys()]
    .filter((id) => !baseUses.has(id) && uses.theirs.has(id))
    .sort(compareText);
  for (const id of clashes) {
    const mine = uses.ours.get(id) as IdUse;
    const other = uses.theirs.get(id) as IdUse;
    if (mine.identity === other.identity) continue;
    const key = (use: IdUse) => `${use.at} ${use.identity}`;
    const later: MergeSide = key(mine) >= key(other) ? 'ours' : 'theirs';
    const to = draw(taken);
    taken.add(to);
    sides[later] = renameId(sides[later], id, to);
    renames.push({ side: later, kind: 'id', from: id, to });
  }

  // Handles given alike to different people.
  const added = (side: MergeSide, handle: string) =>
    sides[side].people.has(handle) && !base.people.has(handle);
  for (const handle of [...sides.ours.people.keys()].sort(compareText)) {
    if (!added('ours', handle) || !added('theirs', handle)) continue;
    const mine = sides.ours.people.get(handle) as Person;
    const other = sides.theirs.people.get(handle) as Person;
    if (samePerson(mine, other)) continue;
    const later: MergeSide = canon(mine) >= canon(other) ? 'ours' : 'theirs';
    const handles = new Set([
      ...base.people.keys(),
      ...sides.ours.people.keys(),
      ...sides.theirs.people.keys(),
    ]);
    let n = 2;
    while (handles.has(`${handle}-${n}`)) n++;
    const to = `${handle}-${n}`;
    sides[later] = renameHandle(sides[later], handle, to);
    renames.push({ side: later, kind: 'handle', from: handle, to });
  }

  const o = sides.ours;
  const t = sides.theirs;
  const ledger = emptyLedgerMap();
  ledger.settings = {};
  for (const name of ['tracking', 'view', 'history'] as const) {
    const value = pick3<string>(base.settings[name], o.settings[name], t.settings[name]);
    if (value !== undefined) (ledger.settings as Record<string, string>)[name] = value;
  }
  ledger.people = mergeKeyed(base.people, o.people, t.people, mergePerson);
  ledger.marks = mergeKeyed(base.marks, o.marks, t.marks, mergeEntry);
  ledger.threads = mergeKeyed(base.threads, o.threads, t.threads, mergeThread);
  const names = new Set([...base.extra.keys(), ...o.extra.keys(), ...t.extra.keys()]);
  for (const name of [...names].sort(compareText)) {
    const merge =
      name === 'frontmatter' ? mergeFrontmatter : name === 'version' ? newerVersion : pick3;
    const value = merge(base.extra.get(name), o.extra.get(name), t.extra.get(name));
    if (value !== undefined) ledger.extra.set(name, value as YamlValue);
  }
  return { ledger, renames };
}

/**
 * `body` with the mark `from` named `to` in each of its markers: every segment's opener and closer.
 * A marker inside the payload of another is not renamed.
 */
export function renameMarkId(body: string, from: string, to: string): string {
  const changes: TextChange[] = [];
  for (const marker of scan(body).markers) {
    if (marker.id !== from) continue;
    const text = body.slice(marker.from, marker.to);
    const at = marker.from + (marker.type === 'open' ? text.indexOf(' ') + 1 : '<!--/'.length);
    changes.push({ from: at, to: at + from.length, insert: to });
  }
  return applyChanges(body, changes);
}

/** Every id a body uses, for `LedgerMergeOptions.taken`. */
export const idsOfBodies = (...bodies: string[]): Set<string> =>
  new Set(bodies.flatMap((body) => [...idsIn(body)]));
