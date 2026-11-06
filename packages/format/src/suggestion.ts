// Suggestions (format §6, `group`). One edit by an agent can be several marks: a `str_replace` is
// compared word by word (design §8.3), and a range across blocks is a mark per block. The marks of
// one edit share a `group` and a `note`, and a person reads and decides them as one suggestion.

import type { MarkRange, Parsed } from './types.ts';

/**
 * What the marks of one suggestion share: the group, the author and the note. Null for a mark that
 * is a suggestion alone: it has no group, or it is a comment.
 */
function sharedBy(mark: MarkRange): string | null {
  const { group, by, note } = mark.entry;
  if (mark.kind === 'cmt' || group === undefined) return null;
  return JSON.stringify([group, by, note ?? null]);
}

/** Where a mark starts, for putting marks in document order. */
const startOf = (mark: MarkRange) => mark.segments[0]?.open.from ?? 0;

/**
 * The marks of `marks` split into suggestions: the marks that share a `group`, an author and a
 * `note` are one, and any other mark is its own. Each suggestion is in document order, and the
 * suggestions are in the order of their first marks.
 */
export function suggestions(marks: readonly MarkRange[]): MarkRange[][] {
  const ordered = [...marks].sort((a, b) => startOf(a) - startOf(b));
  const found: MarkRange[][] = [];
  const byKey = new Map<string, MarkRange[]>();
  for (const mark of ordered) {
    const key = sharedBy(mark);
    const known = key === null ? undefined : byKey.get(key);
    if (known) {
      known.push(mark);
      continue;
    }
    const created = [mark];
    found.push(created);
    if (key !== null) byKey.set(key, created);
  }
  return found;
}

/**
 * The ids of the marks that make up the suggestion that mark `markId` is in, in document order:
 * the marks that share its `group`, author and `note`, or only itself when it has no group. A
 * group with several notes is several suggestions. `among` limits which marks count (all the
 * marks by default), such as the changes that an editor draws and decides. Empty when there is no
 * such mark, or it is a comment, or it is not among `among`.
 */
export function suggestionOf(
  parsed: Parsed,
  markId: string,
  among: readonly MarkRange[] = parsed.marks,
): string[] {
  const mine = among.find((mark) => mark.id === markId);
  if (!mine || mine.kind === 'cmt') return [];
  const group = suggestions(among).find((marks) => marks.includes(mine));
  return (group ?? [mine]).map((mark) => mark.id);
}
