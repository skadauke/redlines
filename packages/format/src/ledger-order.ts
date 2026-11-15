// Keeping the ledger in step with the body after an edit (format §5.4, §5.7). `serializeLedger`
// writes marks and threads in the order the `Ledger` holds them and does not prune, so every edit
// that writes the ledger runs it through `normalizeLedger` first.

import { holdsMarks, scan, scanPayload } from './scan.ts';
import type { Marker } from './scan.ts';
import type { Ledger, MarkEntry, MarkKind } from './types.ts';

/** The deepest payload that holds marks that are read (format §3.12). */
export const MOST_PAYLOAD_DEPTH = 3;

/**
 * The ledger as it should be written for a body: `marks` in the document order of each mark's first
 * opener, without the entries of marks that are no longer there, and `comments` in the document
 * order of the anchors.
 *
 * A thread whose anchor is gone stays, after the others and in the order it had: a thread leaves
 * the file only when someone deletes it (format §4). The entry of a marker that the parser reads
 * as text, such as an opener whose closer was lost to a hand edit, stays too, so that repairing
 * the closer brings the mark back with its author.
 *
 * `textAfter` is the body as it will be written. It may still hold the old ledger, which is not
 * read here. Markers in code are not markers, as everywhere else.
 */
export function normalizeLedger(textAfter: string, ledger: Ledger): Ledger {
  // Map keeps the order of insertion, and the scan finds markers in the order they appear.
  const firstOpener = new Map<string, MarkKind>();
  // The marks in the old text of a replacement stay in the ledger as long as the replacement
  // does: they are in the order of the replacement's place in the body (format §3.12).
  const top = scan(textAfter).markers;
  // An id that stands in more than one place is text where it stands in a payload: it is no mark of
  // the replacement, and its entry is not kept for it (format §3.12).
  const times = new Map<string, number>();
  const count = (markers: readonly Marker[], depth: number) => {
    // Once for each place an id stands in: a mark with several segments stands in one.
    for (const id of new Set(markers.map((marker) => marker.id)))
      times.set(id, (times.get(id) ?? 0) + 1);
    for (const marker of markers) {
      if (marker.type === 'open' && depth < MOST_PAYLOAD_DEPTH && holdsMarks(marker)) {
        count(scanPayload(marker.payload ?? '').markers, depth + 1);
      }
    }
  };
  count(top, 0);
  const topIds = new Set(top.map((marker) => marker.id));
  const walk = (markers: readonly Marker[], depth: number) => {
    for (const marker of markers) {
      if (marker.type !== 'open') continue;
      // An id that stands in the body too is text in a payload (format §3.12): it has no place here.
      if (depth > 0 && (topIds.has(marker.id) || (times.get(marker.id) ?? 0) > 1)) continue;
      if (!firstOpener.has(marker.id)) firstOpener.set(marker.id, marker.kind);
      if (depth < MOST_PAYLOAD_DEPTH && holdsMarks(marker)) {
        walk(scanPayload(marker.payload ?? '').markers, depth + 1);
      }
    }
  };
  walk(top, 0);

  const marks: Record<string, MarkEntry> = {};
  const anchorOrder = new Map<string, number>();
  for (const [id, kind] of firstOpener) {
    if (kind === 'cmt') {
      anchorOrder.set(id, anchorOrder.size);
    } else {
      const entry = Object.hasOwn(ledger.marks, id) ? ledger.marks[id] : undefined;
      if (entry) marks[id] = entry;
    }
  }

  const detached = anchorOrder.size;
  const comments = ledger.comments.toSorted(
    (a, b) => (anchorOrder.get(a.id) ?? detached) - (anchorOrder.get(b.id) ?? detached),
  );
  return { ...ledger, marks, comments };
}
