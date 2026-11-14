// A deletion of all the text of a wrapped line (#427): a middle or a last line of a paragraph or of
// an item, the lines that hard-wrapped Markdown is made of. The line goes with the line break in
// front of it, with the prefix of the line (`> `, the indentation of an item's lines) and the syntax
// of a hard break that ends the line above: the block is as long as it was, less one line, and does
// not part in two. Left in the file, the line would be a blank line, which is a paragraph break;
// written as a tracked change, the marker would start the line, where Markdown reads it as the
// start of a block (format §3.2). The break after the line is the one that stays: it is the line
// above's break to the line below. The first line of a block does it the other way round, with the
// break after it (`coverLine` in `track.ts`).
//
// Shared by the tracked edit and the plain one (Track Changes off), so that both take the same
// range and the same text stays.

import {
  bodyStart,
  breaksBetween,
  lineEnd,
  lineStart,
  lineStartKind,
  prefixLength,
} from './blocks.ts';
import { visibleText } from './edit-support.ts';
import { formatReader, isRawParagraph } from './format-reader.ts';
import { paragraphRange } from './inline.ts';
import type { MarkerRange } from './markers.ts';
import type { Parsed } from './types.ts';

/** Where the text of the body ends: before the ledger and the white space in front of it. */
function bodyEnd(text: string, parsed: Parsed): number {
  let end = parsed.ledgerRange?.from ?? text.length;
  while (end > 0 && /\s/.test(text[end - 1] ?? '')) end--;
  return end;
}

/**
 * How many characters in front of `at`, the end of a line, are the syntax of a hard break: two
 * spaces or more, or a backslash that no other backslash escapes. One space, or a tab, is white
 * space that Markdown drops.
 */
function hardBreakSyntax(text: string, at: number, floor: number): number {
  let spaces = 0;
  while (at - spaces > floor && text[at - spaces - 1] === ' ') spaces++;
  if (spaces >= 2) return spaces;
  let slashes = 0;
  while (at - slashes > floor && text[at - slashes - 1] === '\\') slashes++;
  return slashes % 2 === 1 ? 1 : 0;
}

/**
 * Whether `from` is where the text of a wrapped line starts, a line that goes on a paragraph or an
 * item: after its prefix, in a paragraph that starts as a block does (a line under the underline of
 * a heading is not one, as the paragraph's first line is the underline).
 */
export function atWrappedLine(
  text: string,
  markers: readonly MarkerRange[],
  from: number,
): boolean {
  if (lineStartKind(text, from, markers) !== 'continuation') return false;
  const first = paragraphRange(text, markers, from).from;
  const lead = first + prefixLength(text.slice(first, lineEnd(text, first)));
  return lineStartKind(text, lead, markers) === 'block';
}

/**
 * Where a deletion of `[from, to)` starts, when it is all the text of one or more wrapped lines of a
 * paragraph: the end of the line above the first of them, in front of the syntax of its hard break.
 * The range goes on to `to`, which stays. Undefined when the range is not that: it starts anywhere
 * but at the start of the text of a line that goes on a paragraph (not its first line, a heading, a
 * table row, code, or an HTML block), goes past the paragraph, or ends in the text of its last line.
 * White space after the range on its line stays, and so does the syntax of a hard break there,
 * which then ends the line above: `one  ⏎two  ⏎three` without `two` is `one  ⏎three`.
 */
export function wrappedLineStart(
  text: string,
  parsed: Parsed,
  markers: readonly MarkerRange[],
  from: number,
  to: number,
): number | undefined {
  const floor = bodyStart(text);
  const end = bodyEnd(text, parsed);
  if (from >= to || from <= floor || to > end) return undefined;
  const breaks = breaksBetween(text, from, to, markers, floor).filter((found) => found.start < end);
  // A range that starts in front of the prefix of its line, or in it (the quote markers, the
  // indentation), starts at the text of the line, as a tracked change's does (`coverBreaks`): the
  // prefix goes with the break in front.
  const inPrefix = breaks.find((found) => lineStart(text, found.end) <= from && from < found.end);
  if (inPrefix && to > inPrefix.end) from = inPrefix.end;
  // The range starts where the text of a line that goes on a paragraph does.
  if (!atWrappedLine(text, markers, from)) return undefined;
  const old = visibleText(text, markers, from, to);
  if (old.trim() === '') return undefined;
  // The break in front of that line, with nothing but the line's indentation between it and the
  // text: the indentation goes with the line.
  const front = breaks.findLast((found) => found.end <= from);
  if (!front || front.block || !/^[ \t]*$/.test(visibleText(text, markers, front.end, from))) {
    return undefined;
  }
  // The range ends where its line does: white space after it may stay, and a backslash that is a
  // hard break's, which the text of the range doesn't end in the escape of.
  const ahead = breaksBetween(text, to, lineEnd(text, to), markers, floor).find(
    (found) => found.start >= to && found.start < end,
  );
  const rest = visibleText(text, markers, to, ahead?.start ?? end);
  const hard = rest === '\\' && ahead !== undefined && !old.endsWith('\\');
  if (!hard && !/^[ \t]*$/.test(rest)) return undefined;
  // The lines are lines of one paragraph, and of one that has syntax: not code or an HTML block.
  const paragraph = paragraphRange(text, markers, from);
  if (to > paragraph.to) return undefined;
  const first = paragraph.from;
  const reader = formatReader(text, parsed);
  if (isRawParagraph(reader, { from: first, to: Math.min(paragraph.to, end) })) return undefined;
  // Not a line that follows code or is in it, which the reading of the lines may take for the
  // line of a paragraph (a fence that closes inside an item, as the text of a list item's lines
  // leaves it open).
  const above = lineStart(text, front.start);
  if (reader.verbatim.some((v) => v.from < to && above <= v.to)) return undefined;
  return front.start - hardBreakSyntax(text, front.start, floor);
}
