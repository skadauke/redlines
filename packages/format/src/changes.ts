import { findLedger } from './ledger-read.ts';
import type { Range, TextChange } from './types.ts';

/**
 * Applies changes to a text. The changes are in offsets of `text`, sorted and not overlapping, as
 * `TextChange` says.
 *
 * @throws RangeError when a change is out of order, overlaps the one before, or lies outside the text.
 */
export function applyChanges(text: string, changes: readonly TextChange[]): string {
  let result = '';
  let position = 0;
  for (const { from, to, insert } of changes) {
    if (from < position || to < from || to > text.length) {
      throw new RangeError(
        `The change ${from}-${to} is out of order or outside the text (${text.length} characters)`,
      );
    }
    result += text.slice(position, from) + insert;
    position = to;
  }
  return result + text.slice(position);
}

export type Eol = '\r\n' | '\n';

/** A ledger's first line, ended by a CRLF. */
const CRLF_HEAD = /<!-- redlines[ \t]*\r\n/y;

/**
 * The file's line break, which the line breaks the format writes take, the ledger's among them
 * (format §2.5, §5.1): CRLF when the body has a CRLF. The body is the file without its ledger and
 * the blank line in front of it, so that adding the ledger never changes it: a CR that ends the
 * body and an LF that starts the blank line are no CRLF. A body with no CRLF has the ledger's, the
 * line break of its first line, which was written in the body's while it had one, as when its
 * last CRLFs are deleted; with no ledger, LF. Pass the ledger's range, `parse(text).ledgerRange`,
 * when you have it.
 */
export function eolOf(text: string, ledger?: Range | null): Eol {
  const first = text.indexOf('\r\n');
  if (first === -1) return '\n';
  const range = ledger === undefined ? (findLedger(text)?.range ?? null) : ledger;
  if (!range) return '\r\n';
  const { from, to } = range;
  if (first + 2 <= from || text.includes('\r\n', to)) return '\r\n';
  CRLF_HEAD.lastIndex = text.indexOf('<!-- redlines', from);
  return CRLF_HEAD.test(text) ? '\r\n' : '\n';
}

/** `s` with its line breaks written as `eol`. */
export function inEol(s: string, eol: Eol): string {
  return s.replace(/\r\n?|\n/g, eol);
}
