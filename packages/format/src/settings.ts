// The two settings of the ledger that a person changes in the editor (format §5.6): Track Changes,
// and the view the document opens in. Both are recorded when the file is saved for another reason,
// never when they are switched, and each is a line put in, changed or taken out where it stands, so
// that a save touches nothing else of a ledger. Neither ever makes a ledger.

import { eolOf } from './changes.ts';
import { findLedger, readSpan } from './ledger-read.ts';
import { keepsLedger, setLedger } from './ledger-write.ts';
import type { Ledger, LedgerView, TextChange } from './types.ts';

/**
 * The changes that record Track Changes in the file's ledger, as the host saves the file for
 * another reason (format §5.6): `tracking: everyone` when it is on, and none when it is off. Like
 * the view, it is a line put in or taken out where it stands, so that a save touches nothing else
 * of a ledger. It never makes a ledger: a file with none, one that can't be read and one that holds
 * nothing else are left as they are, so that turning Track Changes on in a plain file writes
 * nothing until a first change gives the file a ledger, and recording it is never why a save
 * fails. When turning it off leaves a ledger with nothing in it, the ledger goes (§5.1).
 */
export function recordTracking(text: string, on: boolean): TextChange[] {
  const span = findLedger(text);
  if (!span) return [];
  const { ledger, valid } = readSpan(span);
  if (!valid) return [];
  const { start } = span;
  const written = text.slice(start, span.range.to);
  const eol = eolOf(text, span.range);
  if (!on) {
    // Only a setting that the ledger reads is the file's to take back.
    if (ledger.tracking !== 'everyone') return [];
    const rest: Ledger = { ...ledger };
    delete rest.tracking;
    // The ledger goes with its last setting, whole.
    if (!keepsLedger(rest)) return setLedger(text, rest);
    // Each line of the setting, which a merge may have left twice, goes with its line break.
    return [...written.matchAll(/(?<![^\r\n])tracking:[^\r\n]*(?:\r\n|\r|\n)/g)].map((line) => ({
      from: start + line.index,
      to: start + line.index + line[0].length,
      insert: '',
    }));
  }
  if (!keepsLedger(ledger)) return [];
  const wanted = 'tracking: everyone';
  // What the ledger says already, in any spelling a reader reads as it, stays as it is.
  if (ledger.tracking === 'everyone') return [];
  const changes: TextChange[] = [];
  for (const line of written.matchAll(/(?<![^\r\n])tracking:[^\r\n]*/g)) {
    changes.push({
      from: start + line.index,
      to: start + line.index + line[0].length,
      insert: wanted,
    });
  }
  if (changes.length > 0) return changes;
  // A new line, after the version's in the layout of §5.2, or after the line that opens the ledger
  // of one with no version line: the rest of it stays byte for byte.
  const after =
    /(?<![^\r\n])version:[^\r\n]*/.exec(written) ?? /^<!-- redlines[^\r\n]*/.exec(written);
  if (!after) return [];
  const at = start + after.index + after[0].length;
  return [{ from: at, to: at, insert: `${eol}${wanted}` }];
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
  for (const line of written.matchAll(/(?<![^\r\n])view:[^\r\n]*/g)) {
    const wanted = `view: ${view}`;
    if (line[0] !== wanted) {
      changes.push({
        from: start + line.index,
        to: start + line.index + line[0].length,
        insert: wanted,
      });
    }
  }
  if (changes.length > 0 || /(?<![^\r\n])view:/.test(written)) return changes;
  // A new line, after the setting before it in the layout of §5.2.
  const after =
    /(?<![^\r\n])tracking:[^\r\n]*/.exec(written) ?? /(?<![^\r\n])version:[^\r\n]*/.exec(written);
  if (!after) return [];
  const at = start + after.index + after[0].length;
  return [{ from: at, to: at, insert: `${eolOf(text, span.range)}view: ${view}` }];
}
