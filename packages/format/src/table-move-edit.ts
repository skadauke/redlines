// An edit with Track Changes off in a pending move's copy (format §3.7, §3.10): a plain edit changes
// both views as it says, and a move's copy is in one of them only at its new place, while the kept copy
// below the table is what the original reads at the old. So the edit is written in both: the cell at
// the new place, and the same cell in the kept copy, escaped as its payload is. Accepting the move keeps
// the text at the new place, rejecting gives it back at the old, and the original view has it too.

import { accept, reject } from './decide.ts';
import { applyChanges } from './changes.ts';
import { EditError } from './errors.ts';
import { encodePayload } from './payload.ts';
import { parse } from './parse.ts';
import { readTables } from './table.ts';
import { deletedColPayload, gridOf } from './table-cols.ts';
import { originalCells, originalRowText } from './table-ops.ts';
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
): TextChange[] {
  const found = movedCopyAt(text, edit, parsed) as MovedCopy;
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
