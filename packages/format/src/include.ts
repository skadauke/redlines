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
  return {
    from,
    to: Math.max(from, to),
    openerLine: first !== undefined,
    closerLine: last !== undefined,
  };
}
