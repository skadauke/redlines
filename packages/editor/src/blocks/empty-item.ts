// The empty list item that Markdown can't hold (design: block editing, "The empty paragraph"): right
// under a line of text in a tight list, an empty bullet item is a setext underline and an empty
// numbered one is more of the text, so `- one⏎- two⏎  - ` is `<li><h2>two</h2></li>`. An empty item
// is fine after a blank line, or after an item of its own list. Pure functions of the text.

import type { Text } from '@codemirror/state';

/** An empty item's line: what is in front of its marker, the marker, and the space after it. */
export const EMPTY_ITEM = /^((?:[ \t]*>)*)([ \t]*)([-*+]|\d{1,9}[.)])[ \t]*$/;

/** The kind of list a marker starts: its bullet, or the delimiter of its number. */
const kindOf = (marker: string) => (/^\d/.test(marker) ? marker.slice(-1) : marker);

/**
 * Whether an empty item with `marker`, indented by `indent` columns after the quote markers
 * `quote`, as line `n` of `doc`, would be no item in Markdown: nothing but text and deeper lines
 * above it before an item of its list or a blank line, a line less indented, or text at its own
 * indentation. Never for a top-level item, whose text above is its own list's.
 */
export function unsoundEmptyItem(
  doc: Text,
  n: number,
  quote: string,
  indent: number,
  marker: string,
): boolean {
  if (indent === 0) return false;
  for (let m = n - 1; m >= 1; m--) {
    const text = doc.line(m).text;
    const above = /^((?:[ \t]*>)*)([ \t]*)(.*)$/.exec(text)!;
    if (above[1]!.replaceAll(/[ \t]/g, '') !== quote.replaceAll(/[ \t]/g, '')) return false;
    if (above[3]!.trim() === '') return false;
    const deep = above[2]!.length;
    if (deep > indent) continue;
    if (deep < indent) return true;
    const item = /^([-*+]|\d{1,9}[.)])(?:[ \t]|$)/.exec(above[3]!);
    return !item || kindOf(item[1]!) !== kindOf(marker);
  }
  return true;
}

/** Whether line `n` of `doc` is an empty item that Markdown can't hold. */
export function unsoundEmptyLine(doc: Text, n: number): boolean {
  const found = EMPTY_ITEM.exec(doc.line(n).text);
  return !!found && unsoundEmptyItem(doc, n, found[1]!, found[2]!.length, found[3]!);
}
