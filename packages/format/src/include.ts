// Quarto's include shortcode (docs/research/quarto.md, "Includes and several ledgers"):
// `{{< include _part.qmd >}}` alone on a line is expanded as text before the file is parsed, with the
// included file's own ledger comment in it. So no marker ever stands on that line: a comment around
// it has its opener alone on the line before and its closer alone on the line after, as the marks of
// a block change have theirs, so that every view reads the file as it was.

import { isPandoc } from './dialect.ts';
import { INCLUDE_LINE, lineEnd, lineStart } from './blocks.ts';
import type { Range } from './types.ts';

/** The line of the body that holds `position`, when it is an include line. */
function includeAt(text: string, position: number): Range | undefined {
  const from = lineStart(text, position);
  const to = lineEnd(text, position);
  return INCLUDE_LINE.test(text.slice(from, to).replace(/\r$/, '')) ? { from, to } : undefined;
}

/** A range for a comment whose ends are off every include line, and which ends are on a line of
 * their own: the marker is then written with a line break, in front of the start and behind the end. */
export interface AroundInclude extends Range {
  openerLine: boolean;
  closerLine: boolean;
}

const OPENERS = /^(?:<!--(?:cmt|hl) \w+-->)+\r?$/;
const CLOSERS = /^(?:<!--\/\w+-->)+\r?$/;

/** Whether the line at `at` is one of opener markers alone, and the lines under it, alone with
 * markers too, lead to an include line: the marks around it are nested, one on each line. */
function openersLeadToInclude(text: string, at: number): boolean {
  for (let line = at; line < text.length;) {
    const end = lineEnd(text, line);
    const content = text.slice(line, end);
    if (INCLUDE_LINE.test(content.replace(/\r$/, ''))) return true;
    if (!OPENERS.test(content)) return false;
    line = end + (text[end] === '\r' ? 2 : 1);
  }
  return false;
}

/** Whether the line that ends at `to` holds closers alone, with only such lines between it and an
 * include line above. */
function closersFollowInclude(text: string, to: number): boolean {
  let line = lineStart(text, to);
  for (;;) {
    const content = text.slice(line, lineEnd(text, line));
    if (!CLOSERS.test(content)) return INCLUDE_LINE.test(content.replace(/\r$/, ''));
    if (line === 0) return false;
    line = lineStart(text, line - 1);
  }
}

/**
 * The range with an end that is on an include line taken to that line's start (for the start) or to
 * its end (for the end), to be written as a line of its own; pandoc files only.
 */
export function awayFromIncludes(text: string, range: Range): AroundInclude {
  const plain = { ...range, openerLine: false, closerLine: false };
  if (!isPandoc()) return plain;
  let { from, to } = range;
  const first = includeAt(text, from);
  const last = includeAt(text, to > from && text[to - 1] === '\n' ? to - 1 : to);
  if (first) from = first.from;
  if (last) to = last.to;
  // A mark already around the include has its markers on lines of their own: so do these.
  const nestedOpen = !first && from === lineStart(text, from) && openersLeadToInclude(text, from);
  const nestedClose =
    !last && to === lineEnd(text, to) && to > from && closersFollowInclude(text, to);
  return {
    from,
    to: Math.max(from, to),
    openerLine: first !== undefined || nestedOpen,
    closerLine: last !== undefined || nestedClose,
  };
}
