// An edit that types, deletes or stands against an emphasis delimiter in a table that holds changes (#490, #265):
// the file it writes can read as its newest view as it stands, and some order of decisions of the changes in the
// table (another person's bold, deletion or substitution next to the delimiter run) can leave the run cut by a
// marker or a letter, which micromark reads otherwise than the view. The fine write is then not kept: the unit that
// holds the cell is replaced (the editor's answer, as for a delimiter beside a break), and every order reads alike.

import { applyChanges } from './changes.ts';
import { parse } from './parse.ts';
import { besideDelimiter, marksOfTablesAt, refusalsOf } from './table-settle.ts';
import { readTables } from './table.ts';
import type { TextChange } from './types.ts';

/** The decisions after which Markdown reads the table's file otherwise than its newest view, by the same key. */
function misreadsOf(text: string, from: number, to: number): Set<string> {
  const scope = marksOfTablesAt(text, { from, to });
  const found = new Set<string>();
  for (const key of refusalsOf(text, scope, true)) if (key.startsWith('reads')) found.add(key);
  return found;
}

/**
 * Whether `changes`, the fine write of `edits` in `text`, are in a table, stand against an emphasis delimiter, and
 * leave a decision of a change of the table that Markdown reads otherwise than its view, where the file before the
 * edit had none: the fine form can't hold it.
 */
export function readsOtherInDecisions(
  text: string,
  edits: readonly TextChange[],
  changes: readonly TextChange[],
): boolean {
  if (edits.length === 0 || changes.length === 0) return false;
  const from = Math.min(...edits.map((edit) => edit.from));
  const to = Math.max(...edits.map((edit) => edit.to));
  if (!/<!--(?!\/)/.test(text) || !besideDelimiter(text, { from, to })) return false;
  if (!readTables(text, parse(text)).some((table) => from <= table.to && table.from <= to)) {
    return false;
  }
  const after = applyChanges(text, changes);
  const delta = after.length - text.length;
  const now = misreadsOf(after, from, Math.max(from, to + delta));
  if (now.size === 0) return false;
  const before = misreadsOf(text, from, to);
  for (const key of now) if (!before.has(key)) return true;
  return false;
}
