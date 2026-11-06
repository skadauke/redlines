// Where a stretch of text is after a reload. A reload's changes cover the whole of a changed
// stretch of a line, so a range inside one collapses when mapped, though its own text is unchanged.

import type { ChangeDesc, Text } from '@codemirror/state';

/**
 * Where the text of `range` (a stretch of `before`) is in `after`, which `changes` turn `before`
 * into, or null when it isn't there as it was: changed, cut or grown into a longer word.
 *
 * Where the changes leave the range alone, it is where they map it. Where they touch it, its text
 * is looked for in what they put in, with the same characters beside it as before, and as the
 * same one of several places in it. Only a range with text is followed; an empty one is for the
 * caller to map.
 */
export function followText(
  changes: ChangeDesc,
  before: Text,
  after: Text,
  range: { from: number; to: number },
): { from: number; to: number } | null {
  const { from, to } = range;
  if (from >= to) return null;
  const was = before.sliceString(from, to);
  const mappedFrom = changes.mapPos(from, 1);
  const mappedTo = Math.max(mappedFrom, changes.mapPos(to, -1));
  if (mappedTo - mappedFrom === was.length && after.sliceString(mappedFrom, mappedTo) === was) {
    return { from: mappedFrom, to: mappedTo };
  }
  // The stretches the changes that touch the range cover, before and after.
  const hit: number[][] = [];
  changes.iterChangedRanges((a, b, c, d) => {
    if (a <= to && b >= from) hit.push([a, b, c, d]);
  });
  if (!hit.length) return null;
  const stretch = (doc: Text, i: number) => {
    const start = Math.min(...hit.map((h) => h[i]!));
    const text = doc.sliceString(start, Math.max(...hit.map((h) => h[i + 1]!)));
    const found: number[] = [];
    for (let at = text.indexOf(was); at >= 0; at = text.indexOf(was, at + 1))
      found.push(start + at);
    return found;
  };
  // Which of the stretch's places for this text the range is on, counted from its start. With the
  // same count of them after, the same one is it; otherwise nothing says which, and the range
  // isn't followed rather than put on text that may be another's.
  const old = stretch(before, 0);
  const now = stretch(after, 2);
  const start = now[old.indexOf(from)];
  if (start === undefined || now.length !== old.length) return null;
  const end = start + was.length;
  // The same character on either side, or the text would have grown or been cut.
  const around = (doc: Text, a: number, b: number) =>
    `${doc.sliceString(Math.max(0, a - 1), a)}|${doc.sliceString(b, b + 1)}`;
  return around(after, start, end) === around(before, from, to) ? { from: start, to: end } : null;
}
