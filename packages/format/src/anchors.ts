// Where the markers of a comment or a highlight go (format §3.1 to §3.3, §4): both are anchored on a
// range of the text, which changes no text, so their markers are placed by one set of rules.
//
// In v0.1 a range is written as one segment, even across blocks. Its ends are moved to where
// format §3.1 to §3.3 allow a marker, which changes what the mark covers by whitespace or by a
// whole construct but never by text: out of a link destination or an image, off a delimiter whose
// flanking a marker would change, back over the line break in front of a wrapped line, back from
// the start of the next block to the end of the last, and on from a blank line to the text of the
// block after it. An opener that starts a block gets its own line.

import {
  breakStart,
  frontMatterEnd,
  lineEnd,
  lineStart,
  nextLineStart,
  prefixLength,
} from './blocks.ts';
import { EditError } from './errors.ts';
import { snapOut } from './edit-support.ts';
import type { MarkerRange } from './edit-support.ts';
import { inspectPlace, stepLeft, stepRight } from './inline.ts';
import { scan } from './scan.ts';
import type { Parsed, Range } from './types.ts';

/**
 * The words of the refusals that placing an anchor can end in, which say what is being anchored:
 * "A comment can't be anchored in front matter yet" is no answer to a person who made a highlight.
 */
export interface AnchorWords {
  /** The range is in front matter, where nothing is anchored yet (format §3.8). */
  frontMatter: string;
  /** No place keeps the markers where format §3.1 to §3.3 allow them. */
  noPlace: string;
  /** The markers would be in code, indented or fenced, or in an HTML comment, where they would not
   * be read (format §2.1). */
  inCode: string;
}

/** Throws a RangeError when `range` is out of order or reaches outside `text`. */
export function assertRange(text: string, range: Range): void {
  if (range.from < 0 || range.to < range.from || range.to > text.length) {
    throw new RangeError(
      `The range ${range.from}-${range.to} is out of order or outside the text (${text.length} characters)`,
    );
  }
}

/** Throws when the anchor of a new mark would not be read: its markers are in code or in an HTML
 * comment. A comment anchor that isn't in the ledger yet is not a mark to `parse`, so the scan of
 * the new text is asked. `range` is whether the anchor has a closer. */
export function checkAnchor(after: string, id: string, range: boolean, inCode: string): void {
  const markers = scan(after).markers.filter((marker) => marker.id === id);
  const opens = markers.some((marker) => marker.type === 'open');
  const closes = !range || markers.some((marker) => marker.type === 'close');
  if (!opens || !closes) throw new EditError(inCode, 'inside-code');
}

/** Where the text of the line that holds `position` starts: after the prefix of its block (`- `,
 * `> `) and the `#`s of a heading. */
function lineTextStart(text: string, position: number): number {
  const start = lineStart(text, position);
  const line = text.slice(start, lineEnd(text, start));
  const prefix = prefixLength(line);
  const heading = /^#{1,6}[ \t]+/.exec(line.slice(prefix))?.[0].length ?? 0;
  return start + prefix + heading;
}

/** Whether the line that holds `position` has nothing on it but its container prefix: spaces, tabs
 * and quote markers, which a blank line of a quote or a list item has. */
function onBlankLine(text: string, position: number): boolean {
  return /^[ \t>]*$/.test(text.slice(lineStart(text, position), lineEnd(text, position)));
}

/**
 * Where the text of the block after the blank lines that `position` is on starts, before `end`, or
 * `position` when no block comes. An opener alone on a blank line in front of a block would take
 * the line break after it for its carrier, and the blank line would go from the views (format
 * §3.3): at the start of the body, where no line with text comes before it (§3.8), or under another
 * blank line.
 */
function pastBlankLines(text: string, position: number, end: number): number {
  for (let line = lineStart(text, position); line < end; line = nextLineStart(text, line)) {
    if (!onBlankLine(text, line)) return lineTextStart(text, line);
  }
  return position;
}

/** The range of an anchor, moved to where its markers may stand (see the head of this file).
 * `end` is where the body ends. */
function placeAnchor(
  text: string,
  markers: readonly MarkerRange[],
  frontEnd: number,
  range: Range,
  end: number,
  words: AnchorWords,
): Range {
  let { from, to } = range;
  const refuse = (reason: string): never => {
    throw new EditError(reason, 'no-legal-placement');
  };
  // A range of whole blocks starts at the first column of the first and ends at the first column
  // of the block after the last. That is in front of a prefix, where no marker goes: it starts at
  // the text of the block, and ends where the block before the line ends.
  if (from < lineTextStart(text, from)) from = lineTextStart(text, from);
  if (from < to && to < lineTextStart(text, to)) {
    const line = lineStart(text, to);
    to = line === 0 ? from : Math.max(from, breakStart(text, line));
  }
  if (to < from) to = from;
  for (let attempt = 0; attempt < 24; attempt++) {
    const state = `${from} ${to}`;
    const open = inspectPlace(text, markers, from);
    if (open.kind === 'refuse') refuse(open.reason);
    else if (open.kind === 'construct') {
      from = open.from;
      to = Math.max(to, from === to ? from : to);
    } else if (open.kind === 'flank') from = stepLeft(text, markers, from);
    else if (open.kind === 'continuation') from = snapOut(markers, breakStart(text, from), false);
    // On a blank line in front of a block, the range starts at the block's text.
    else if (open.kind === 'block' && onBlankLine(text, from)) {
      from = pastBlankLines(text, from, end);
    }
    if (frontEnd >= 0 && from <= frontEnd) {
      throw new EditError(words.frontMatter, 'front-matter');
    }
    if (to < from) to = from;
    if (to > from) {
      const close = inspectPlace(text, markers, to);
      if (close.kind === 'refuse') refuse(close.reason);
      else if (close.kind === 'construct') to = close.to;
      else if (close.kind === 'flank') {
        const next = stepRight(text, markers, to);
        // At the end of the body the step would hop over the ledger, which is a marker to it, and
        // the closer would be written after it, where the editor writes no text (format §5.1): a
        // range that ends at the end of the body, in a closing delimiter, has no place.
        if (next > end) refuse(words.noPlace);
        to = next;
      }
      // The closer must not start the next block or line: the range ends where the last ends.
      else if (close.kind === 'block' || close.kind === 'continuation') {
        // Not inside the opener of a mark that starts the block, or between it and its carrier.
        to = Math.max(from, snapOut(markers, breakStart(text, to), false));
      }
    }
    if (state === `${from} ${to}`) return { from, to };
  }
  return refuse(words.noPlace);
}

/**
 * `range` with its ends no further than where the body ends: a range that reaches into the ledger,
 * as select all does by ending at the end of the file, ends where the body does (format §4). An
 * anchor is never written in the ledger or after it.
 */
export function withinBody(text: string, parsed: Parsed, range: Range): Range {
  const end = parsed.ledgerRange?.from ?? text.length;
  return { from: Math.min(range.from, end), to: Math.min(range.to, end) };
}

/**
 * The range of `text` that an anchor on `range` is written around, with its ends moved out of the
 * markers that they fall in and then to where its markers may stand. An empty range is a point:
 * `from` and `to` are the same place. A range that reaches into the ledger ends where the body does
 * (`withinBody`).
 *
 * @throws EditError when the range is in front matter (`front-matter`), or no place for the markers
 *   keeps the text as it reads (`no-legal-placement`).
 */
export function anchorRange(
  text: string,
  parsed: Parsed,
  markers: readonly MarkerRange[],
  range: Range,
  words: AnchorWords,
): Range {
  const frontEnd = frontMatterEnd(text);
  const inBody = withinBody(text, parsed, range);
  if (frontEnd >= 0 && inBody.from <= frontEnd) {
    throw new EditError(words.frontMatter, 'front-matter');
  }
  const point = inBody.from === inBody.to;
  const start = snapOut(markers, inBody.from, false);
  return placeAnchor(
    text,
    markers,
    frontEnd,
    { from: start, to: point ? start : snapOut(markers, inBody.to, true) },
    parsed.ledgerRange?.from ?? text.length,
    words,
  );
}
