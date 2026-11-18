// An edit's ledger write, placed over what others wrote to the ledger since (multiuser research
// §4.3). The body of an edit is mapped over the other windows' changes as text. The ledger is not:
// it is rewritten as a whole by every edit that touches it, so a deletion or a replacement of it
// mapped over another window's rewrite leaves a ledger torn in two, or none, and the file breaks.
// Here the ledger is read as entries: what the edit did to it (a mark's entry added or removed, a
// reply, a resolve) is found by comparing the text it was made on with the text it made, and is
// done again to the ledger of the newest text, entry by entry. Entries with other keys stay as
// they are.

import { ChangeSet, Text } from '@codemirror/state';
import {
  applyLedgerOps,
  ledgerEntries,
  ledgerOps,
  parse,
  setLedgerEntries,
} from '@redlines/format';
import type { TextChange } from '@redlines/format';

/**
 * `mapped`, the edit `made` on `start`, as it applies to `doc` after others' changes, with its
 * ledger write made again on the ledger of `doc`; or null when the edit didn't write the ledger or
 * a ledger can't be read, and `mapped` is all there is.
 */
export function placeLedgerWrite(
  doc: Text,
  mapped: ChangeSet,
  start: Text,
  made: ChangeSet,
): ChangeSet | null {
  const startText = start.toString();
  const base = ledgerEntries(startText);
  const mine = ledgerEntries(made.apply(start).toString());
  if (base.unreadable || mine.unreadable) return null;
  const ops = ledgerOps(base, mine);
  if (!ops.length) return null;
  const text = doc.toString();
  const theirs = ledgerEntries(text);
  if (theirs.unreadable) return null;

  // The edit's changes to the body: what it did to the ledger is left out, and made again below.
  const ledgerAt = parse(text).ledgerRange?.from ?? null;
  const edits: TextChange[] = [];
  mapped.iterChanges((from, to, _fromB, _toB, inserted) => {
    if (ledgerAt !== null && from >= ledgerAt) return;
    edits.push({
      from,
      to: ledgerAt === null ? to : Math.min(to, ledgerAt),
      insert: inserted.toString(),
    });
  });
  const body = ChangeSet.of(edits, doc.length, '\n');
  const next = body.apply(doc);
  try {
    const writes = setLedgerEntries(next.toString(), applyLedgerOps(theirs, ops));
    return body.compose(ChangeSet.of(writes, next.length, '\n'));
  } catch {
    return null;
  }
}
