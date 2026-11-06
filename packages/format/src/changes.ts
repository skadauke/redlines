import type { TextChange } from './types.ts';

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

/** The file's line break: CRLF when it has any, as `setLedger` writes them. */
export function eolOf(text: string): Eol {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

/** `s` with its line breaks written as `eol`. */
export function inEol(s: string, eol: Eol): string {
  return s.replace(/\r\n?|\n/g, eol);
}
