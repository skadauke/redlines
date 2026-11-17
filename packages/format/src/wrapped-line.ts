// A deletion of all the text of a wrapped line (#427): a middle or a last line of a paragraph or of
// an item, the lines that hard-wrapped Markdown is made of. The line goes with the line break in
// front of it, with the prefix of the line (`> `, the indentation of an item's lines) and the white
// space or the syntax of a hard break that ends the line above: the block is as long as it was,
// less one line, and does not part in two. Left in the file, the line would be a blank line, which
// is a paragraph break; written as a tracked change, the marker would start the line, where
// Markdown reads it as the start of a block (format §3.2). The break after the line is the one that
// stays: it is the line above's break to the line below. The first line of a block does it the
// other way round, with the break after it (`coverLine` in `track.ts`).
//
// Shared by the tracked edit and the plain one (Track Changes off), so that both take the same
// range and the same text stays. The lines that the rule is for are those of a paragraph of text.
// Where the reading of the lines can't tell (a definition, a table, an alert, code, an HTML block
// or comment), the deletion is what it was.

import {
  CONTAINER_PREFIX,
  bodyStart,
  breaksBetween,
  lineEnd,
  lineStart,
  lineStartKind,
  nextLineStart,
  prefixLength,
} from './blocks.ts';
import { visibleText } from './edit-support.ts';
import { formatReader, isRawParagraph } from './format-reader.ts';
import { DELIMITER_ROW, paragraphRange } from './inline.ts';
import type { MarkerRange } from './markers.ts';
import type { Verbatim } from './scan.ts';
import type { Parsed, Range } from './types.ts';

/** Where the text of the body ends: before the ledger and the white space in front of it. */
function bodyEnd(text: string, parsed: Parsed): number {
  let end = parsed.ledgerRange?.from ?? text.length;
  while (end > 0 && /\s/.test(text[end - 1] ?? '')) end--;
  return end;
}

/**
 * How many characters in front of `at`, the end of a line, go with the line break that follows:
 * the spaces (one is white space that Markdown drops, two or more are a hard break's: either way
 * the deleted line's own spaces, which stay, must not meet them and make a hard break of one), or
 * a backslash that no other backslash escapes, which is a hard break's too.
 */
function trailingSyntax(text: string, at: number, floor: number): number {
  let spaces = 0;
  while (at - spaces > floor && text[at - spaces - 1] === ' ') spaces++;
  if (spaces > 0) return spaces;
  let slashes = 0;
  while (at - slashes > floor && text[at - slashes - 1] === '\\') slashes++;
  return slashes % 2 === 1 ? 1 : 0;
}

/** A line of a link reference definition or of a footnote's, after its container prefix. */
const DEFINITION = /^(?:[ \t>]|(?:[-*+]|\d{1,9}[.)])(?=[ \t]))*\[\^?[^\]\n]+\]:/;

/** The underline of a setext heading, after its container prefix. */
const SETEXT_UNDERLINE = /^[ \t>]*(?:=+|-+)[ \t]*\r?$/;

/** Whether the line above `underline` is words a heading can hold: not a definition, a comment or HTML. */
function isHeadingText(text: string, markers: readonly MarkerRange[], underline: number): boolean {
  const above = lineStart(text, underline - 1);
  const line = visibleText(text, markers, above, lineEnd(text, above));
  return line.trim() !== '' && !DEFINITION.test(line) && !/^[ \t>]*</.test(line);
}

/** The line of a GitHub alert that names its type, which takes nothing after it (`> [!NOTE]`). */
const ALERT = /^[ \t>]*\[![A-Za-z]+\]/;

/** An emphasis delimiter that ends a text. */
const DELIMITER_AT_END = /[*_~]$/;

/**
 * The paragraph that the line holding `from` is a wrapped line of, when `from` is where the text
 * of that line starts (after its prefix): a line that goes on a paragraph or an item, whose first
 * line starts a block (a line under the underline of a heading is no wrapped line: the paragraph's
 * first line is the underline), and of text: not a definition, a table, code, an HTML block or
 * comment, or a fence's line, and, for a change that is tracked (`marker`), not the line under the
 * one that names the type of an alert (`> [!NOTE]`), which takes nothing after it. Undefined where
 * `from` is anything else.
 */
function wrappedParagraph(
  text: string,
  parsed: Parsed,
  markers: readonly MarkerRange[],
  from: number,
  marker: boolean,
): Range | undefined {
  if (lineStartKind(text, from, markers) !== 'continuation') return undefined;
  let paragraph = paragraphRange(text, markers, from);
  let underlined = false;
  // A paragraph under a setext heading starts at the underline, which belongs to the heading: its
  // first line is the one after (#469).
  if (
    paragraph.from > 0 &&
    SETEXT_UNDERLINE.test(text.slice(paragraph.from, lineEnd(text, paragraph.from))) &&
    isHeadingText(text, markers, paragraph.from)
  ) {
    const next = nextLineStart(text, paragraph.from);
    // (the line right under the underline is a paragraph's first line: it is covered as before)
    if (next <= paragraph.to && lineStart(text, from) !== next) {
      paragraph = { from: next, to: paragraph.to };
      underlined = true;
    }
  }
  const first = paragraph.from;
  const lead = first + prefixLength(text.slice(first, lineEnd(text, first)));
  if (!underlined && lineStartKind(text, lead, markers) !== 'block') return undefined;
  // What the lines are made of: no definition, no delimiter row of a table (a row without pipes at
  // its edges goes on a table), and no line above this one that only names the type of an alert.
  const above = lineStart(text, from) - 1;
  for (let at = first; at <= paragraph.to; at = nextLineStart(text, at)) {
    const line = visibleText(text, markers, at, lineEnd(text, at));
    if (DEFINITION.test(line) || (line.includes('|') && DELIMITER_ROW.test(line))) return undefined;
    if (marker && at === lineStart(text, above) && ALERT.test(line)) return undefined;
  }
  const reader = formatReader(text, parsed);
  if (isRawParagraph(reader, { from: first, to: Math.min(paragraph.to, bodyEnd(text, parsed)) })) {
    return undefined;
  }
  // Not a line that follows or is in code, which the reading of the lines may take for the line of
  // a paragraph: a fence that closes right above it (inside an item, as the text of its lines
  // leaves it open), or an HTML comment or a raw block that it is in.
  const end = lineEnd(text, above);
  // (`formatReader` has the ranges of `scan`, with their kinds.)
  const verbatim = (reader.verbatim as readonly Verbatim[]).some((v) =>
    v.kind === 'fence' ? v.from < from && v.to >= end : v.from < end && v.to > end,
  );
  return verbatim ? undefined : paragraph;
}

/**
 * Whether `from` is where the text of a wrapped line starts (see `wrappedParagraph`): a deletion
 * that starts there and is not all the text of lines of its paragraph is refused for a marker that
 * would start the line, and says what to do instead (`track.ts`).
 */
export function atWrappedLine(
  text: string,
  parsed: Parsed,
  markers: readonly MarkerRange[],
  from: number,
): boolean {
  return wrappedParagraph(text, parsed, markers, from, true) !== undefined;
}

/**
 * Where a deletion of `[from, to)` starts, when it is all the text of one or more wrapped lines of a
 * paragraph: the end of the line above the first of them, in front of the spaces or the backslash
 * that go with its line break. The range goes on to `to`, which stays. Undefined when the range is
 * not that: it starts anywhere but at the start of the text of a line that goes on a paragraph (not
 * its first line, a heading, a table row, a definition, code, or an HTML block), goes past the
 * paragraph, or ends in the text of its last line. White space after the range on its line stays,
 * and so does the syntax of a hard break there, which then ends the line above: `one  ⏎two  ⏎three`
 * without `two` is `one  ⏎three`.
 *
 * `marker`: a tracked change stands at the end of the line above, where it follows what ends that
 * line: an emphasis delimiter there (`a *⏎middle⏎x* b`) would be followed by the marker, not by
 * white space, and open emphasis that the views do not read. With Track Changes off nothing stands
 * there.
 */
export function wrappedLineStart(
  text: string,
  parsed: Parsed,
  markers: readonly MarkerRange[],
  from: number,
  to: number,
  { marker }: { marker: boolean },
): number | undefined {
  // A line made only of an insertion: the range starts after its opener and ends in front of its
  // closer, and takes them (#469).
  if (from < to && from > lineStart(text, from)) {
    const open = markers.find((m) => m.role === 'open' && m.to === from);
    if (open && visibleText(text, markers, lineStart(text, from), open.from).trim() === '') {
      for (let again = markers.find((m) => m.role === 'close' && m.from === to); again;) {
        to = again.to;
        again = markers.find((m) => m.role === 'close' && m.from === to);
      }
      from = open.from;
    }
  }
  // Most deletions are inside a line: text in front of the range on its line is no prefix.
  if (
    from >= to ||
    !CONTAINER_PREFIX.test(visibleText(text, markers, lineStart(text, from), from))
  ) {
    return undefined;
  }
  const floor = bodyStart(text);
  const end = bodyEnd(text, parsed);
  if (from <= floor || to > end) return undefined;
  const breaks = breaksBetween(text, from, to, markers, floor).filter((found) => found.start < end);
  // A range that starts in front of the prefix of its line, or in it (the quote markers, the
  // indentation), starts at the text of the line, as a tracked change's does (`coverBreaks`): the
  // prefix goes with the break in front.
  const inPrefix = breaks.find((found) => lineStart(text, found.end) <= from && from < found.end);
  if (inPrefix && to > inPrefix.end) from = inPrefix.end;
  // The range starts where the text of a line that goes on a paragraph does.
  if (lineStartKind(text, from, markers) !== 'continuation') return undefined;
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
  // The lines are lines of one paragraph of text.
  const paragraph = wrappedParagraph(text, parsed, markers, from, marker);
  if (!paragraph || to > paragraph.to) return undefined;
  const start = front.start - trailingSyntax(text, front.start, floor);
  // A marker that follows a delimiter run would open what the views do not.
  if (
    marker &&
    DELIMITER_AT_END.test(visibleText(text, markers, lineStart(text, start), start).trimEnd())
  ) {
    return undefined;
  }
  return start;
}
