// Where a stretch of text is after a reload. A reload's changes cover the whole of a changed
// stretch of a line, so a range inside one collapses when mapped, though its own text is unchanged.

import type { ChangeDesc, Text } from '@codemirror/state';

const WORD = /[\p{L}\p{N}_]/u;

/**
 * Where the text of `range` (a stretch of `before`) is in `after`, which `changes` turn `before`
 * into, or null when it isn't there as it was: changed, cut or grown into a longer word, or one of
 * several places that the changes may have shifted between.
 *
 * Where the changes leave the range alone, it is where they map it. Where they touch it, its text
 * is looked for in what they put in. The text must also have the same neighbours: a character
 * beside it that is part of a word now but wasn't before (or the other way) means it grew or was
 * cut. And it must be the only place for that text in the changed lines, before and after; with
 * more, an agent may have deleted one and added another and nothing says which is which. Only a
 * range with text is followed; an empty one is for the caller to map.
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
  // The characters on either side of a place for the text, which must be alike before and after.
  const edges = (doc: Text, a: number, b: number) => [
    doc.sliceString(Math.max(0, a - 1), a),
    doc.sliceString(b, b + 1),
  ];
  const alike = (a: number, b: number) => {
    const now = edges(after, a, b);
    return edges(before, from, to).every((was, i) => {
      const next = now[i]!;
      return was === next || !(WORD.test(was) || WORD.test(next));
    });
  };
  const mappedFrom = changes.mapPos(from, 1);
  const mappedTo = Math.max(mappedFrom, changes.mapPos(to, -1));
  if (mappedTo - mappedFrom === was.length && after.sliceString(mappedFrom, mappedTo) === was) {
    return alike(mappedFrom, mappedTo) ? { from: mappedFrom, to: mappedTo } : null;
  }
  // The stretches the changes that touch the range cover, before and after.
  const hit: number[][] = [];
  changes.iterChangedRanges((a, b, c, d) => {
    if (a <= to && b >= from) hit.push([a, b, c, d]);
  });
  if (!hit.length) return null;
  // Where the text is in a stretch, and whether it is anywhere else in the stretch's lines.
  const stretch = (doc: Text, i: number) => {
    const start = Math.min(...hit.map((h) => h[i]!));
    const end = Math.max(...hit.map((h) => h[i + 1]!));
    const places = (a: number, b: number) => {
      const text = doc.sliceString(a, b);
      const found: number[] = [];
      for (let at = text.indexOf(was); at >= 0; at = text.indexOf(was, at + 1)) found.push(a + at);
      return found;
    };
    const found = places(start, end);
    const lines = places(doc.lineAt(start).from, doc.lineAt(end).to);
    return found.length === lines.length ? found : [];
  };
  const old = stretch(before, 0);
  const now = stretch(after, 2);
  const start = now[old.indexOf(from)];
  if (start === undefined || now.length !== old.length) return null;
  const end = start + was.length;
  return alike(start, end) ? { from: start, to: end } : null;
}
