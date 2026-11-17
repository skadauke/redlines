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
import { EditError } from './errors.ts';
import { tablesOfText } from './table.ts';
import { tableExtent } from './table-rules.ts';
import { Untrackable } from './widen.ts';
import type { TableRead } from './table.ts';
import { tableEdit } from './table-ops.ts';
import type { MarkRange, Parsed, TextChange } from './types.ts';

/**
 * The changes that reject `marks`, the inserted columns that are every column of a table with one
 * pending deletion of a column, as the deletion of the table in that deletion's mark, the table's other
 * pending changes in its payload (§3.12); or undefined for any other decision. `rejectBoth` rejects the marks given, which with that
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
    // One pending deletion of a column is the table's deletion (below). Several can't be one deletion:
    // `decideCols` widens the decision to the table's columns, which come back with it (format §3.7).
    const colLines = table.deletions.filter((d) => d.axis === 'col');
    const [line] = colLines;
    if (!line || colLines.length > 1 || line.mark.entry.move !== undefined) return undefined;
    const deletion = line.mark;
    // Every other pending change in the table (rows, other deletions, alignment) stays pending in the
    // deletion's payload (format §3.12), written by the edit that deletes the table.
    const original = applyChanges(text, rejectBoth([...marks, deletion]));
    const back = tablesOfText(original, parse(original)).find((t) => t.from === table.from);
    if (!back) return undefined;
    const author = parsed.ledger.people.find((person) => person.handle === deletion.entry.by) ?? {
      handle: deletion.entry.by,
      name: deletion.entry.by,
    };
    // The deletion of the whole table as the table's own operation writes it (rule 6): the other changes
    // pending in the table stay pending in its payload (§3.12).
    let edit: TextChange[];
    try {
      edit = tableEdit(
        original,
        { kind: 'deleteTable', table: back.from },
        {
          author,
          time: deletion.entry.at,
          random: randomFor(deletion.id),
          ...(deletion.entry.note === undefined ? {} : { note: deletion.entry.note }),
        },
      ).changes;
    } catch (error) {
      const held =
        error instanceof Untrackable ||
        (error instanceof EditError && error.code === 'no-legal-placement');
      if (!held) throw error;
      // No unit holds the table with those changes in it (it is the whole text, and the closer of a
      // replacement would stand alone): the decision is widened to the table's changes, which are
      // all rejected with it, the table as it was. Every order reads alike, since the changes are
      // gone with the decision, whichever of them was decided before.
      return rejectBoth(everyChangeIn(text, parsed, table));
    }
    return changesBetween(text, applyChanges(original, edit));
  }
  return undefined;
}

/** Every change with all its markers in the lines of the table: its inserted and deleted columns and rows
 * and any other mark but a comment or a highlight (a change that runs out of the table stays). */
function everyChangeIn(text: string, parsed: Parsed, table: TableRead): MarkRange[] {
  const extent = tableExtent(text, table);
  return parsed.marks.filter(
    (mark) =>
      mark.kind !== 'cmt' &&
      mark.kind !== 'hl' &&
      mark.segments.every((segment) =>
        [segment.open, segment.close].every(
          (range) => range === undefined || (extent.from <= range.from && range.to <= extent.to),
        ),
      ),
  );
}
