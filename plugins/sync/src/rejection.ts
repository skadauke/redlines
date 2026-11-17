// An Undo of a tracked step, placed on newer text (multiuser research §4.2). Undo takes a step back
// by rejecting the step's own marks. Written before another window's edit arrives, it is mapped over
// that edit as text, and an edit inside what it removes (typing in a moved paragraph) tears the
// marks it removes. So an edit that is nothing but the rejection of marks is recognized, and is done
// again as the rejection of those marks on the newest text, which the format writes whole, leaving
// what the other window typed.

import { ChangeSet, Text } from '@codemirror/state';
import { applyChanges, EditError, parse, rejectMarks } from '@redlines/format';

/**
 * The rejection that `made` (on `start`) was, written on `doc`; null when `made` was something
 * else. An empty set of changes when every mark it rejected is gone from `doc` already.
 */
export function placeRejection(
  doc: Text,
  start: Text,
  made: ChangeSet,
): { changes: ChangeSet; gone: number } | null {
  const startText = start.toString();
  const was = new Set(parse(startText).marks.map((mark) => mark.id));
  const result = made.apply(start).toString();
  const left = new Set(parse(result).marks.map((mark) => mark.id));
  const ids = [...was].filter((id) => !left.has(id));
  if (!ids.length) return null;
  try {
    // Only an edit that is exactly the rejection of those marks is placed this way.
    if (applyChanges(startText, rejectMarks(startText, ids)) !== result) return null;
    const text = doc.toString();
    const present = new Set(parse(text).marks.map((mark) => mark.id));
    const here = ids.filter((id) => present.has(id));
    if (!here.length) return { changes: ChangeSet.empty(doc.length), gone: ids.length };
    const list = rejectMarks(text, here);
    return {
      changes: ChangeSet.of(
        list.map(({ from, to, insert }) => ({ from, to, insert })),
        doc.length,
      ),
      gone: ids.length - here.length,
    };
  } catch (error) {
    if (error instanceof EditError) return null;
    throw error;
  }
}
