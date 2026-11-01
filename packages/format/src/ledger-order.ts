// Keeping the ledger in step with the body after an edit (format §5.4, §5.7). `serializeLedger`
// writes marks and threads in the order the `Ledger` holds them and does not prune, so every edit
// that writes the ledger runs it through `normalizeLedger` first.

import { scan } from './scan.ts';
import type { Ledger, MarkEntry, MarkKind } from './types.ts';

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
  for (const marker of scan(textAfter).markers) {
    if (marker.type === 'open' && !firstOpener.has(marker.id)) {
      firstOpener.set(marker.id, marker.kind);
    }
  }

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
