// The empty list item that Markdown can't hold (design: block editing, "The empty paragraph"): right
// under a line of text in a tight list, an empty bullet item is a setext underline and an empty
// numbered one is more of the text, so `- one⏎- two⏎  - ` is `<li><h2>two</h2></li>`. The same for
// the first item of a list right under a paragraph (`Para.⏎- ` is `<h2>Para.</h2>`). An empty item
// is fine after a blank line, or after an item of its own list. Pure functions of the text.

import type { Text } from '@codemirror/state';

/** An empty item's line: what is in front of its marker, the marker, and the space after it. */
export const EMPTY_ITEM = /^((?:[ \t]*>)*)([ \t]*)([-*+]|\d{1,9}[.)])[ \t]*$/;

/** The markers of tracked changes and comments, which the newest view doesn't show. */
export const MARKER =
  /<!--(?:\/[a-z0-9]+|(?:split|ins|del|sub|fmt|cmt|hl) [a-z0-9]+(?: [^]*?)?)-->/g;

/** The kind of list a marker starts: its bullet, or the delimiter of its number. */
const kindOf = (marker: string) => (/^\d/.test(marker) ? marker.slice(-1) : marker);

/**
 * How far in a line is, in the container the quote markers `quote` make: the one space after the
 * last `>` is the quote's own (`> - ` is an item at the margin of the quote), the rest is indentation.
 */
const indentIn = (quote: string, spaces: number): number =>
  quote.includes('>') ? Math.max(0, spaces - 1) : spaces;

/**
 * Whether an empty item with `marker`, `spaces` columns of white space after the quote markers
 * `quote`, as line `n` of `doc`, would be no item in Markdown: nothing but text and deeper lines
 * above it before an item of its list or a blank line, a line less indented, or text at its own
 * indentation. A top-level item is so only right under a line of text (`underText`): above it is
 * otherwise its own list's, or another block. Never on the first line: nothing is above it.
 */
export function unsoundEmptyItem(
  doc: Text,
  n: number,
  quote: string,
  spaces: number,
  marker: string,
): boolean {
  if (n < 2) return false;
  const indent = indentIn(quote, spaces);
  if (indent === 0) return underText(doc, n, quote);
  const same = quote.replaceAll(/[ \t]/g, '');
  for (let m = n - 1; m >= 1; m--) {
    const text = doc.line(m).text;
    const above = /^((?:[ \t]*>)*)([ \t]*)(.*)$/.exec(text)!;
    if (above[1]!.replaceAll(/[ \t]/g, '') !== same) return false;
    if (above[3]!.trim() === '') {
      // Right after a blank line the item is fine; further up, blank lines among deeper lines
      // (the paragraphs of an item above) are part of what is read through.
      if (m === n - 1) return false;
      continue;
    }
    const deep = indentIn(above[1]!, above[2]!.length);
    if (deep > indent) continue;
    if (deep < indent) return true;
    const item = /^([-*+]|\d{1,9}[.)])(?:[ \t]|$)/.exec(above[3]!);
    // At its own indentation: an item of another list, or text. Not another block's line.
    return item ? kindOf(item[1]!) !== kindOf(marker) : textLike(above[3]!);
  }
  return true;
}

/** A list item's line: its marker, and what follows it or the end of the line. */
const ITEM_LINE = /^(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;

/**
 * Whether a line is text that a paragraph is made of, which an underline or a lazy line follows:
 * not a heading, a quote, a block of HTML, a table row, a fence, a link reference, a rule or an
 * underline (`===` under a paragraph ends it as a heading; as a lazy line of an item it is rare).
 */
const textLike = (line: string): boolean =>
  line.trim() !== '' &&
  !/^(?:#{1,6}(?:[ \t]|$)|[>|<]|`{3}|~{3}|\[[^\]]*\]:)/.test(line) &&
  !/^(?:[-*_][ \t]*){3,}$/.test(line) &&
  !/^[=-]+[ \t]*$/.test(line);

/**
 * Whether an empty item that starts its line (in the quote `quote`) as line `n` stands right under
 * text that is no item's: the empty bullet is then the underline of that text, and the empty
 * numbered item more of it (`Para.⏎- ` is `<h2>Para.</h2>`, `Para.⏎1. ` is `<p>Para.1.</p>` to
 * CommonMark). The lines above it up to a blank line are read: an item among them (up to three
 * columns in) owns the lines below it, indented or lazy, and the empty item is an item of that
 * list or of the next; a heading, a rule, a fence or another block right above it is fine. A quote
 * above it owns the lines below it too, as lazy lines, and the item is read as one then. Only a
 * paragraph that starts at the margin is read as one: what is indented may be an item's paragraph
 * (`- a⏎⏎  b⏎- `) or code, which only the item above it tells.
 */
function underText(doc: Text, n: number, quote: string): boolean {
  const same = quote.replaceAll(/[ \t]/g, '');
  // The topmost line of the paragraph that the lines above make, below the nearest underline.
  let first: number | null = null;
  // An underline or a definition was met: the text above it is no part of the paragraph.
  let sealed = false;
  for (let m = n - 1; m >= 1; m--) {
    const above = /^((?:[ \t]*>)*)([ \t]*)(.*)$/.exec(doc.line(m).text)!;
    // Another quote level: the lines below it may be its lazy lines, which no reading here tells.
    if (above[1]!.replaceAll(/[ \t]/g, '') !== same) return false;
    const text = above[3]!;
    if (text.trim() === '') break;
    const deep = indentIn(above[1]!, above[2]!.length);
    if (deep <= 3 && ITEM_LINE.test(text)) return false;
    if (deep <= 3 && !textLike(text)) {
      // A table row: what follows it may be its rows, and no reading here tells.
      if (text.startsWith('|')) return false;
      // Another block's line, which an item's paragraph can't take as a lazy line.
      if (!/^(?:=+|\[[^\]]*\]:.*)[ \t]*$/.test(text)) break;
      // An underline or a definition: the end of the paragraph above it, unless an item or a quote
      // further up owns it as a lazy line, which the lines up there tell.
      sealed = true;
      continue;
    }
    if (!sealed) first = deep;
  }
  return first === 0;
}

/** Whether line `n` of `doc` is an empty item that Markdown can't hold. */
export function unsoundEmptyLine(doc: Text, n: number): boolean {
  const found = EMPTY_ITEM.exec(doc.line(n).text);
  return !!found && unsoundEmptyItem(doc, n, found[1]!, found[2]!.length, found[3]!);
}
