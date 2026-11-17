// A paste over cells as an intent (docs/research/multiuser.md §4.2): the columns and rows it adds,
// then the values written into the cells, kept as the steps they were, each on the text the one
// before it left. `deriveSteps` writes them again, one after the other, and gives the paste's
// changes, in the offsets of the text it was made on.

import { ChangeSet } from '@codemirror/state';
import type { EditorState } from '@codemirror/state';
import { readRowCells } from '@redlines/format';
import { deriveIntent } from '../tracked/typing.ts';
import type { StepsIntent } from '../tracked/intent.ts';
import { deriveTable } from './intent.ts';

/**
 * The changes the steps make together on `state`'s text.
 *
 * @throws EditError when the format refuses a step.
 */
export function deriveSteps(state: EditorState, intent: StepsIntent): ChangeSet {
  let now = state;
  let total = ChangeSet.empty(state.doc.length);
  for (const step of intent.steps) {
    const changes =
      step.kind === 'table'
        ? ChangeSet.of(
            deriveTable(now.doc.toString(), step).changes.map(({ from, to, insert }) => ({
              from,
              to,
              // The values pasted into the rows it adds (a paste's insertion of rows).
              insert:
                step.filled && from === to && /^\r?\n\|/.test(insert)
                  ? fillRows(insert, step.filled.range, step.filled.first, step.filled.col)
                  : insert,
            })),
            now.doc.length,
          )
        : deriveIntent(now, step);
    total = total.compose(changes);
    now = now.update({ changes, filter: false }).state;
  }
  return total;
}

/** Fills the cells of the rows that an insertion writes with the values of `range`, from row `first`
 * of the range on. */
export function fillRows(
  insert: string,
  range: readonly (readonly string[])[],
  first: number,
  col: number,
) {
  const lines = insert.split(/(?<=\n)/);
  let row = first;
  return lines
    .map((piece) => {
      const eol = /\r?\n$/.exec(piece)?.[0] ?? '';
      const line = piece.slice(0, piece.length - eol.length);
      if (!line.startsWith('|')) return piece;
      const values = range[row++] ?? [];
      const cells = readRowCells(line, 0, line.length).cells;
      let out = line;
      for (let j = values.length - 1; j >= 0; j--) {
        const cell = cells[col + j];
        const value = values[j];
        if (!cell || !value) continue;
        // Spaces between the value and the pipes, where the row has none there.
        const before = line[cell.textFrom - 1] === ' ' ? '' : ' ';
        const after = line[cell.textFrom] === ' ' ? '' : ' ';
        out = out.slice(0, cell.textFrom) + before + value + after + out.slice(cell.textFrom);
      }
      return out + eol;
    })
    .join('');
}
