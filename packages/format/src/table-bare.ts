// Rejecting the last inserted column of a table whose original column is a pending deletion (format §3.7,
// #477). The table then has no column of its own, so the newest view has no table, and the original has
// the table with its deleted column back: that is a deletion of the whole table (rule 6), in the mark of
// the column's deletion, and deciding it either way reads as deciding the column's deletion would have.
// Rejecting the inserted column and rejecting the column's deletion give the original table in either
// order; accepting the deletion after the insertion is rejected, or before, gives no table.

import { applyChanges } from './changes.ts';
import { changesBetween } from './edit-support.ts';
import { randomFor } from './ids.ts';
import { parse } from './parse.ts';
import { tablesOfText } from './table.ts';
import { tableExtent } from './table-rules.ts';
import { trackedEdit } from './track.ts';
import type { MarkRange, Parsed, TextChange } from './types.ts';

/**
 * The changes that reject `marks`, the inserted columns that are every column of a table whose only
 * other pending change is the deletion of one column, as the deletion of the table in that deletion's
 * mark; or undefined for any other decision. `rejectBoth` rejects the marks given, which with that
 * deletion gives the original table back.
 */
export function wholeTableDeleted(
  text: string,
  parsed: Parsed,
  marks: readonly MarkRange[],
  rejectBoth: (all: readonly MarkRange[]) => TextChange[],
): TextChange[] | undefined {
  if (marks.length === 0) return undefined;
  if (!marks.every((m) => m.kind === 'ins' && m.payload === 'col' && m.entry.move === undefined)) {
    return undefined;
  }
  const ids = new Set(marks.map((mark) => mark.id));
  for (const table of tablesOfText(text, parsed)) {
    const mine = table.colMarks.filter((c) => ids.has(c.mark.id));
    if (mine.length !== marks.length || mine.length !== table.aligns.length) continue;
    const [line, ...more] = table.deletions;
    if (!line || more.length > 0 || line.axis !== 'col' || line.mark.entry.move !== undefined) {
      return undefined;
    }
    const deletion = line.mark;
    // Nothing else is pending in it: a mark with a marker in the table, but for comments and the
    // columns decided, is another change, and the column keeps its refusal.
    const extent = tableExtent(text, table);
    const other = parsed.marks.some(
      (mark) =>
        mark.kind !== 'cmt' &&
        mark.kind !== 'hl' &&
        mark.id !== deletion.id &&
        !ids.has(mark.id) &&
        mark.segments.some((segment) =>
          [segment.open, segment.close].some(
            (range) => range !== undefined && extent.from <= range.from && range.to <= extent.to,
          ),
        ),
    );
    if (other) return undefined;
    const original = applyChanges(text, rejectBoth([...marks, deletion]));
    const back = tablesOfText(original, parse(original)).find((t) => t.from === table.from);
    if (!back) return undefined;
    const author = parsed.ledger.people.find((person) => person.handle === deletion.entry.by) ?? {
      handle: deletion.entry.by,
      name: deletion.entry.by,
    };
    const edit = trackedEdit(
      original,
      { from: back.from, to: back.to, insert: '' },
      {
        author,
        time: deletion.entry.at,
        random: randomFor(deletion.id),
        ...(deletion.entry.note === undefined ? {} : { note: deletion.entry.note }),
      },
    );
    return changesBetween(text, applyChanges(original, edit));
  }
  return undefined;
}
