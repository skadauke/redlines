// A document joined from several files has several ledgers (format §5.1). A marker reads the first
// ledger after it, and a marker after the last reads the last. This is where that is decided, for
// reading (`mergeLedgers`) and for writing (`splitLedger`, which gives each entry back to the ledger
// it is in, and a new one to the first ledger after its marker).

import { MOST_PAYLOAD_DEPTH } from './ledger-order.ts';
import { holdsMarks, scanPayload } from './scan.ts';
import type { Marker, Scan } from './scan.ts';
import type { Ledger, MarkEntry, Person, Thread } from './types.ts';

/**
 * Where each id stands in the file: the offset of its first marker, or, for a mark in the old text
 * of a replacement (format §3.12), of the marker that holds it. An id that stands in the body too
 * is the body's.
 */
export function idPositions(scanned: Scan): Map<string, number> {
  const at = new Map<string, number>();
  for (const marker of scanned.markers) if (!at.has(marker.id)) at.set(marker.id, marker.from);
  const walk = (markers: readonly Marker[], outer: number, depth: number) => {
    for (const marker of markers) {
      if (marker.type !== 'open' || depth >= MOST_PAYLOAD_DEPTH || !holdsMarks(marker)) continue;
      const inner = scanPayload(marker.payload ?? '').markers;
      for (const found of inner) if (!at.has(found.id)) at.set(found.id, outer);
      walk(inner, outer, depth + 1);
    }
  };
  for (const marker of scanned.markers) walk([marker], marker.from, 0);
  return at;
}

/** The index of the ledger that a marker at `at` reads: the first after it, or the last. */
export function ledgerAfter(starts: readonly number[], at: number): number {
  const index = starts.findIndex((start) => start > at);
  return index === -1 ? starts.length - 1 : index;
}

/**
 * One ledger from several: each mark and thread is the entry of the ledger its marker reads (none
 * when that ledger has none), and the settings and the keys of a later version are the last
 * ledger's. An id with no marker anywhere is read from the last ledger that holds it. People are
 * everyone the ledgers list, the last ledger's entry for a handle first.
 */
export function mergeLedgers(
  ledgers: readonly Ledger[],
  starts: readonly number[],
  positions: ReadonlyMap<string, number>,
): Ledger {
  const last = ledgers[ledgers.length - 1]!;
  const marks: Record<string, MarkEntry> = {};
  const comments: Thread[] = [];
  const taken = new Set<string>();
  ledgers.forEach((ledger, index) => {
    const reads = (id: string) => {
      const at = positions.get(id);
      return at === undefined
        ? ledgerOwner(ledgers, id) === index
        : ledgerAfter(starts, at) === index;
    };
    for (const [id, entry] of Object.entries(ledger.marks)) {
      if (reads(id) && !Object.hasOwn(marks, id)) marks[id] = entry;
    }
    for (const thread of ledger.comments) {
      if (reads(thread.id) && !taken.has(thread.id)) {
        taken.add(thread.id);
        comments.push(thread);
      }
    }
  });
  const people: Person[] = [];
  const handles = new Set<string>();
  for (const ledger of ledgers.toReversed()) {
    for (const person of ledger.people) {
      if (handles.has(person.handle)) continue;
      handles.add(person.handle);
      people.push(person);
    }
  }
  return { ...last, people, marks, comments };
}

/** The last ledger that holds an entry or a thread for `id`. */
function ledgerOwner(ledgers: readonly Ledger[], id: string): number {
  for (let i = ledgers.length - 1; i >= 0; i--) {
    const ledger = ledgers[i]!;
    if (Object.hasOwn(ledger.marks, id) || ledger.comments.some((thread) => thread.id === id)) {
      return i;
    }
  }
  return -1;
}

/** The handles an entry or a thread names. */
function handlesOf(entry: MarkEntry | Thread): string[] {
  const names = [entry.by];
  if ('replies' in entry) {
    for (const reply of entry.replies) names.push(reply.by);
    for (const like of entry.likes) names.push(like.by);
    if (entry.resolved) names.push(entry.resolved.by);
    if (entry.assigned) names.push(entry.assigned);
  }
  return names;
}

/**
 * The ledgers as they should be written, from the one `ledger` that was read from them (and then
 * changed): each mark and thread goes to the ledger its marker reads, which for a new one is the
 * first ledger after the marker (the last when none is after it), and for an id with no marker is
 * the ledger that held it. Settings are the last ledger's, and the other ledgers keep theirs. A
 * person stays in every ledger that listed them, goes into any other that names them in an entry it
 * holds, and into the last when no ledger does.
 */
export function splitLedger(
  ledger: Ledger,
  current: readonly Ledger[],
  starts: readonly number[],
  positions: ReadonlyMap<string, number>,
): Ledger[] {
  const lastIndex = current.length - 1;
  const place = (id: string): number => {
    const at = positions.get(id);
    if (at !== undefined) return ledgerAfter(starts, at);
    const held = ledgerOwner(current, id);
    return held === -1 ? lastIndex : held;
  };
  const out: Ledger[] = current.map((was, index) => ({
    ...(index === lastIndex ? ledger : was),
    people: [],
    marks: {},
    comments: [],
  }));
  const named = out.map(() => new Set<string>());
  for (const [id, entry] of Object.entries(ledger.marks)) {
    const index = place(id);
    out[index]!.marks[id] = entry;
    for (const handle of handlesOf(entry)) named[index]!.add(handle);
  }
  for (const thread of ledger.comments) {
    const index = place(thread.id);
    out[index]!.comments.push(thread);
    for (const handle of handlesOf(thread)) named[index]!.add(handle);
  }
  for (const person of ledger.people) {
    let placed = false;
    out.forEach((target, index) => {
      const listed = current[index]!.people.some((p) => p.handle === person.handle);
      if (listed || named[index]!.has(person.handle)) {
        target.people.push(person);
        placed = true;
      }
    });
    if (!placed) out[lastIndex]!.people.push(person);
  }
  return out;
}
