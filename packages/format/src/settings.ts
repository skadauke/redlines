// The two settings of the ledger that a person changes in the editor (format §5.6): Track Changes,
// which is written when it is turned on or off, and the view the document opens in, which is
// recorded when the file is saved. Track Changes is written through `setLedger`, so the ledger is
// placed, laid out and refused as it is for any other change, and a file that never had it gets
// back exactly its bytes when it is turned off. The view is a line put in or changed where it
// stands, so that a save touches nothing else of a ledger.

import { eolOf } from './changes.ts';
import { emptyLedger, findLedger, readSpan } from './ledger-read.ts';
import { keepsLedger, setLedger } from './ledger-write.ts';
import type { Ledger, LedgerView, TextChange } from './types.ts';

/** The file's ledger, read: none (an empty one, `found` false), or one that can't be read (an empty
 * one, `valid` false). */
function readLedgerOf(text: string): { ledger: Ledger; found: boolean; valid: boolean } {
  const span = findLedger(text);
  if (!span) return { ledger: emptyLedger(), found: false, valid: true };
  const { ledger, valid } = readSpan(span);
  return { ledger, found: true, valid };
}

/**
 * The changes that turn Track Changes on or off in the file: `tracking: everyone` is written into
 * the ledger, which is added to a file that has none, or taken away with the setting (format §5.6).
 * A file that already says so, and a ledger that can't be read when turning it off, which says
 * nothing, are left as they are.
 *
 * @throws EditError when the ledger can't be written: it can't be read, which `setLedger` says, or
 *   the end of the file is inside a code block or a comment that is never closed, where a ledger
 *   would be taken for its text. Both say what to do.
 */
export function setTracking(text: string, on: boolean): TextChange[] {
  const { ledger } = readLedgerOf(text);
  if ((ledger.tracking === 'everyone') === on) return [];
  const next: Ledger = { ...ledger };
  if (on) next.tracking = 'everyone';
  else delete next.tracking;
  return setLedger(text, next);
}

/**
 * The changes that record `view` as the view the file opens in, in a ledger that holds something
 * else already (format §5.6). Only the `view` line changes: its value, or a new line after
 * `tracking`'s, or after `version`'s, so that what a save didn't mean to touch, a ledger of another
 * tool's or version's, an entry the format ignores, a comment, stays byte for byte. A view alone is
 * no reason for a ledger, so a file with none, a ledger that holds nothing else, one that can't be
 * read and one with no place for the line are left as they are: recording the view is never why a
 * save fails.
 */
export function setView(text: string, view: LedgerView): TextChange[] {
  const span = findLedger(text);
  if (!span) return [];
  const { ledger, valid } = readSpan(span);
  if (!valid || !keepsLedger(ledger)) return [];
  const { start } = span;
  const written = text.slice(start, span.range.to);
  // Each line of the setting, which a merge may have left twice, gets the value.
  const changes: TextChange[] = [];
  for (const line of written.matchAll(/^view:[^\r\n]*/gm)) {
    const wanted = `view: ${view}`;
    if (line[0] !== wanted) {
      changes.push({
        from: start + line.index,
        to: start + line.index + line[0].length,
        insert: wanted,
      });
    }
  }
  if (changes.length > 0 || /^view:/m.test(written)) return changes;
  // A new line, after the setting before it in the layout of §5.2.
  const after = /^tracking:[^\r\n]*/m.exec(written) ?? /^version:[^\r\n]*/m.exec(written);
  if (!after) return [];
  const at = start + after.index + after[0].length;
  return [{ from: at, to: at, insert: `${eolOf(text, span.range)}view: ${view}` }];
}
