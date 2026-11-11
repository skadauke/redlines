// An edit with Track Changes off in a pending move's copy (format §3.7, §3.10): a plain edit changes
// both views as it says, and a move's copy is in one of them only at its new place, while the kept copy
// below the table is what the original reads at the old. So the edit is written in both: the cell at
// the new place, and the same cell in the kept copy, escaped as its payload is. Accepting the move keeps
// the text at the new place, rejecting gives it back at the old, and the original view has it too.

import { accept, reject } from './decide.ts';
import { applyChanges, eolOf, inEol } from './changes.ts';
import { EditError } from './errors.ts';
import { encodePayload } from './payload.ts';
import { parse } from './parse.ts';
import { readLine, readTables } from './table.ts';
import { deletedColPayload, gridOf } from './table-cols.ts';
import { originalCells, originalRowText } from './table-ops.ts';
import { rowMarker } from './table-rows.ts';
import { movedCopyAt } from './table-rules.ts';
import type { MovedCopy } from './table-rules.ts';
import type { Parsed, TextChange } from './types.ts';
import { untrackedEditHalf } from './untracked.ts';
import type { UntrackedContext } from './untracked.ts';

/** Where a position of the text after `changes` is in the text before them (in text they leave). */
function before(changes: readonly TextChange[], position: number): number {
  let delta = 0;
  for (const change of changes.toSorted((a, b) => a.from - b.from)) {
    const size = change.insert.length - (change.to - change.from);
    if (change.to + delta + size > position) break;
    delta += size;
  }
  return position - delta;
}

/**
 * The kept copy's new cell from the edit's offsets, for a cell that holds no mark: the payload's cell
 * is the cell as the copy has it (the original reads it the same, nothing in it is pending), so the
 * same replacement at the same offset gives the cell afterwards. Null for any other cell, which is
 * worked out by reading the original after the edit (below).
 */
function writeFromOffsets(
  text: string,
  own: readonly TextChange[],
  found: MovedCopy,
): TextChange[] | null {
  const [change] = own;
  if (own.length !== 1 || !change || /[`<\\]/.test(change.insert)) return null;
  const { table } = found;
  const row = table.rows.find((r) => r.from <= change.from && change.to <= r.to);
  const open = found.twin.mark.segments[0]?.open;
  const payload = found.twin.mark.payload;
  if (!row || !open || payload === undefined) return null;
  const prefix = /^(?:row|col)=\d+ ?/.exec(payload)?.[0] ?? '';
  const body = payload.slice(prefix.length);
  let rewritten: string;
  if (found.axis === 'col') {
    const line = readLine(text, row.from, row.to);
    const cell = line.cells[found.index];
    if (!cell || change.from < cell.contentFrom || change.to > cell.contentTo) return null;
    const content = text.slice(cell.contentFrom, cell.contentTo);
    const lines = body.split('\n');
    const k = table.rows.indexOf(row) === 0 ? 0 : table.rows.indexOf(row) + 1;
    if (content.includes('<!--') || lines[k] !== content) return null;
    if (lines.length !== table.rows.length + 1) return null;
    lines[k] =
      content.slice(0, change.from - cell.contentFrom) +
      change.insert +
      content.slice(change.to - cell.contentFrom);
    rewritten = prefix + lines.join('\n');
  } else {
    const marker = rowMarker(text, row);
    const line = text.slice(row.from, row.to);
    if (!marker || row !== table.rows[found.index] || change.from < marker.to) return null;
    const bare = line.slice(0, marker.from - row.from) + line.slice(marker.to - row.from);
    const place = change.from - row.from - (marker.to - marker.from);
    const to = change.to - row.from - (marker.to - marker.from);
    // The cell the edit is in, in the row without its marker and in the kept row (the cells of the
    // two are the same cells: nothing pending holds a pipe), holds no mark and reads alike.
    const mine = readLine(bare, 0, bare.length).cells;
    const kept = readLine(body, 0, body.length).cells;
    const i = mine.findIndex((c) => c.open <= place && to <= c.close);
    const cell = mine[i];
    const old = kept[i];
    if (!cell || !old || mine.length !== kept.length || change.to > row.to) return null;
    const content = bare.slice(cell.open, cell.close);
    if (content.includes('<!--') || body.slice(old.open, old.close) !== content) return null;
    const rel = place - cell.open;
    const end = to - cell.open;
    rewritten = prefix + body.slice(0, old.open + rel) + change.insert + body.slice(old.open + end);
  }
  const twin = `<!--del ${found.twin.mark.id} ${encodePayload(rewritten)}-->`;
  return [change, { from: open.from, to: open.to, insert: twin }].sort(
    (a, b) => a.from - b.from || a.to - b.to,
  );
}

/**
 * The changes of a plain edit in a cell of a move's copy: the edit, and the new payload of the kept
 * copy. Refused, in words, if the two halves can't be decided afterwards.
 *
 * @throws EditError
 */
export function editMoveCopy(
  text: string,
  parsed: Parsed,
  edit: TextChange,
  ctx: UntrackedContext,
  at?: MovedCopy,
): TextChange[] {
  const found = at ?? (movedCopyAt(text, edit, parsed) as MovedCopy);
  // A row with no mark in it but the move's own, and plain text typed: the edit is the change, as
  // it is, and the kept copy's cell is the old one with the same replacement.
  const typed = inEol(edit.insert, eolOf(text, parsed.ledgerRange));
  const quick = writeFromOffsets(text, [{ from: edit.from, to: edit.to, insert: typed }], found);
  if (quick) return quick;
  const own = untrackedEditHalf(text, edit, ctx);
  const noun = found.axis === 'col' ? 'column' : 'row';
  const by = found.copy.entry.by;
  const who =
    by === ctx.author?.handle
      ? 'Your'
      : `${parsed.ledger.people.find((person) => person.handle === by)?.name ?? by}'s`;
  const refuse = () =>
    new EditError(
      `${who} move of this ${noun} is pending. Decide it first, or turn on Track Changes.`,
      'no-legal-placement',
    );
  try {
    const after = applyChanges(text, own);
    const read = parse(after);
    const twin = read.marks.find((mark) => mark.id === found.twin.mark.id);
    const open = twin?.segments[0]?.open;
    if (!twin || !open) throw refuse();
    // The cell at the new place as the original reads it, with the move accepted: the edit is in both
    // views there.
    const accepted = applyChanges(after, accept(after, found.copy.id));
    const table = readTables(accepted, parse(accepted)).find((t) => t.from === found.table.from);
    if (!table) throw refuse();
    const prefix = /^(?:row|col)=\d+ ?/.exec(twin.payload ?? '')?.[0] ?? '';
    let payload: string;
    if (found.axis === 'col') {
      const cells = originalCells(accepted, parse(accepted), gridOf(accepted, table), found.index);
      payload = deletedColPayload(Number(/\d+/.exec(prefix)?.[0] ?? 1), cells);
    } else {
      const row = table.rows[found.index];
      if (!row) throw refuse();
      payload = prefix + originalRowText(accepted, parse(accepted), row);
    }
    const marker = `<!--del ${twin.id} ${encodePayload(payload)}-->`;
    const kept = [
      ...own,
      { from: before(own, open.from), to: before(own, open.to), insert: marker },
    ].sort((a, b) => a.from - b.from || a.to - b.to);
    const done = applyChanges(text, kept);
    // The move can be decided either way afterwards, or the edit is not made.
    accept(done, found.copy.id);
    reject(done, found.copy.id);
    return kept;
  } catch (error) {
    if (error instanceof EditError && error.message.includes('move of this')) throw error;
    if (error instanceof EditError) throw refuse();
    throw error;
  }
}
