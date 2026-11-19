// Pasting a range over cells (design: tables, "Copy and paste", In). A range (an HTML table, or text
// with tabs) goes over the cells from the caret's rightward and down, as Sheets and Excel do, and
// from the top-left cell of selected cells; the rows it needs that the table lacks are added (Stage
// 1's insertion, one row each), and so are the columns, added at the table's right. One value onto
// selected cells fills every one of them.
//
// With Track Changes on each overwritten cell is a substitution (an insertion in an empty one), the
// added columns and rows are inserted columns and rows, and the whole paste is one group and one step
// to undo. The paste is worked out on the text: the columns' insertion first, then the rows', with the
// new rows' cells written in them (text in your own new row or column is part of its insertion), then
// the edits to the cells that were there, by the same rules as typing there; they are composed into one
// change.

import { isolateHistory } from '@codemirror/commands';
import { ChangeSet, EditorSelection, type EditorState, Transaction } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import {
  applyChanges,
  EditError,
  idsIn,
  newId,
  parse,
  readRowCells,
  type TextChange,
  Untrackable,
} from '@redlines/format';
import {
  markupViewFacet,
  setViewModeEffect,
  trackedEditAnnotation,
  viewModeField,
} from '../tracked/field.ts';
import { heldEditEffect, untrackedAnswerAnnotation, untrackedAskFacet } from '../tracked/ask.ts';
import {
  authoredWrite,
  contextFor,
  editSourceFacet,
  refusedEditEffect,
  trackingField,
  untrackedWrite,
} from '../tracked/typing.ts';
import { cellOfRef, cellsOfRect, clearedCells, headCell, rectOf } from './cells.ts';
import { type Table, cellAtCol, tablesField } from './model.ts';
import { planned } from './ops.ts';
import { fillRows } from './paste-intent.ts';
import { newIntentId, recordedAs } from '../tracked/intent.ts';
import type { StepsIntent, TypingIntent, Unnamed } from '../tracked/intent.ts';
import type { TableIntent } from './intent.ts';
import { type WidenedPasteIntent, writeWidenedPaste } from './widened-paste.ts';

/** The cell of a row at a column, if the row has it. */

function refuse(view: EditorView, message: string): true {
  view.dispatch({ effects: refusedEditEffect.of(message) });
  return true;
}

/** What a paste is: the table, the edits to its cells, the rows to add, and what ends up selected. */
interface Plan {
  table: Table;
  edits: TextChange[];
  /** Rows to add below the table's last. */
  extra: number;
  /** Columns to add right of the table's last. */
  extraCols?: number;
  /** The first and last cell pasted, by row and column. */
  corners: [[number, number], [number, number]];
  /** The range, for the cells of the rows to add. */
  range: readonly (readonly string[])[];
  /** The row of the table that range[0] is pasted in. */
  top: number;
  left: number;
}

/**
 * Pastes `range`, the cells as the Markdown each is written in, over the cells from the caret's or
 * the selected cells' top left. False where there is no cell to paste into (the caller pastes it as
 * it would outside a table); true when it pasted or said why it could not.
 */
export function pasteRange(view: EditorView, range: readonly (readonly string[])[]): boolean {
  const { state } = view;
  if (state.field(viewModeField, false) === 'raw' || range.length === 0) return false;
  const rect = rectOf(state);
  const head = rect ? null : headCell(state);
  const table = rect?.table ?? head?.table;
  if (!table) return false;
  const edits: TextChange[] = [];
  const height = range.length;
  const width = Math.max(1, ...range.map((row) => row.length));

  // One value, onto selected cells: every one of them.
  if (rect && height === 1 && width === 1) {
    const value = range[0]?.[0] ?? '';
    for (const cell of cellsOfRect(rect)) {
      if (state.sliceDoc(cell.textFrom, cell.textTo) !== value) {
        edits.push({ from: cell.textFrom, to: cell.textTo, insert: value });
      }
    }
    return write(view, {
      table,
      edits,
      extra: 0,
      corners: [
        [rect.rows[0], rect.cols[0]],
        [rect.rows[1], rect.cols[1]],
      ],
      range,
      top: rect.rows[0],
      left: rect.cols[0],
    });
  }

  const top = rect ? rect.rows[0] : head!.row.index;
  const left = rect ? rect.cols[0] : head!.cell.col;
  const extraCols = Math.max(0, left + width - table.columns);
  for (let i = 0; i < height && top + i < table.rows.length; i++) {
    const row = table.rows[top + i]!;
    for (let j = 0; j < (range[i]?.length ?? 0); j++) {
      // The cells of the columns to be added are written once they are there.
      if (left + j >= table.columns) {
        if (row.cells.length < table.columns) {
          return refuse(
            view,
            `Row ${top + i} has fewer cells than the table. Write the cells it lacks first.`,
          );
        }
        continue;
      }
      const cell = cellAtCol(table, row, left + j);
      if (!cell) {
        return refuse(
          view,
          `Row ${top + i} has fewer cells than the table. Write the cells it lacks first.`,
        );
      }
      const value = range[i]![j]!;
      if (state.sliceDoc(cell.textFrom, cell.textTo) !== value) {
        edits.push({ from: cell.textFrom, to: cell.textTo, insert: value });
      }
    }
  }
  return write(view, {
    table,
    edits,
    extra: Math.max(0, top + height - table.rows.length),
    extraCols,
    corners: [
      [top, left],
      [top + height - 1, left + width - 1],
    ],
    range,
    top,
    left,
  });
}

/**
 * The paste as one change, worked out on the text: the columns' insertion first, then the rows', with
 * the values in them, then the edits to the cells that were there. `untracked` writes it as Track
 * Changes off does, whatever the setting; the refusal is the message of what could not be written.
 */
function compute(
  view: EditorView,
  plan: Plan,
  untracked: boolean,
): { total: ChangeSet; steps: StepsIntent['steps'] } | { why: string } {
  const { state } = view;
  const { table, extra } = plan;
  const extraCols = plan.extraCols ?? 0;
  let edits = plan.edits;
  const text0 = state.doc.toString();
  let rows: ChangeSet = ChangeSet.empty(text0.length);
  let text1 = text0;
  let group: string | undefined;
  const steps: (TypingIntent | TableIntent)[] = [];
  const named = <T extends object>(intent: T): T & { id: string } => ({
    ...intent,
    id: newIntentId(),
  });
  const tracked = state.field(trackingField) && !untracked;
  if (extra > 0 || extraCols > 0) {
    // The columns, the rows and the cell edits are one change, so they share one group, even for one.
    group =
      tracked && extra + extraCols + edits.length > 1
        ? newId(idsIn(text0), editRandom(state))
        : undefined;
  }
  if (extraCols > 0) {
    const insertion = planned(
      view,
      { kind: 'insertCols', table: table.from, after: table.columns, count: extraCols },
      group,
      undefined,
      true,
      untracked,
    );
    if ('refusal' in insertion) return { why: insertion.refusal };
    if (insertion.intent) steps.push(named<Unnamed<TableIntent>>(insertion.intent));
    rows = ChangeSet.of(
      insertion.changes.map(({ from, to, insert }) => ({ from, to, insert })),
      text0.length,
    );
    text1 = applyChanges(text0, insertion.changes);
    // The edits to the cells that were there, where the columns' insertion leaves them: in front of
    // what it writes at the end of a row.
    edits = edits.map((edit) => ({
      ...edit,
      from: rows.mapPos(edit.from, -1),
      to: rows.mapPos(edit.to, -1),
    }));
  }
  if (extra > 0) {
    const insertion = planned(
      view,
      { kind: 'insertRows', table: table.from, after: table.rows.length - 1, count: extra },
      group,
      text1,
      true,
      untracked,
    );
    if ('refusal' in insertion) return { why: insertion.refusal };
    // The new rows hold the values they are pasted: text in your own new row is its insertion.
    const first = table.rows.length - plan.top;
    let filled = false;
    const changes = insertion.changes.map((change) => {
      if (!/^\r?\n\|/.test(change.insert) || change.from !== change.to) return change;
      filled = true;
      return { ...change, insert: fillRows(change.insert, plan.range, first, plan.left) };
    });
    // Values are never dropped: if the rows are not where they are expected, the paste is refused.
    if (!filled) return { why: "Redlines can't add the rows this paste needs to this table." };
    if (insertion.intent) {
      steps.push(
        named({
          ...insertion.intent,
          filled: { range: plan.range, first, col: plan.left },
        }),
      );
    }
    const step = ChangeSet.of(
      changes.map(({ from, to, insert }) => ({ from, to, insert })),
      text1.length,
    );
    rows = rows.compose(step);
    text1 = applyChanges(text1, changes);
  }
  // The values of the columns added to rows that were there are written in their new cells.
  if (extraCols > 0) {
    for (let i = 0; i < plan.range.length && plan.top + i < table.rows.length; i++) {
      const row = table.rows[plan.top + i]!;
      const start = rows.mapPos(row.from, 1);
      const line = text1
        .slice(start, text1.indexOf('\n', start) === -1 ? undefined : text1.indexOf('\n', start))
        .replace(/\r$/, '');
      const cells = readRowCells(line, 0, line.length).cells;
      for (let j = 0; j < (plan.range[i]?.length ?? 0); j++) {
        if (plan.left + j < table.columns) continue;
        const cell = cells[plan.left + j];
        const value = plan.range[i]![j]!;
        if (cell && value !== '') {
          edits.push({ from: start + cell.textFrom, to: start + cell.textTo, insert: value });
        }
      }
    }
  }
  let cells = ChangeSet.empty(text1.length);
  if (edits.length) {
    try {
      const written = untracked
        ? untrackedWrite(state, text1, parse(text1), edits)
        : authoredWrite(state, text1, parse(text1), edits, group);
      cells = written.changes;
      steps.push(named<Omit<TypingIntent, 'id'>>(written.intent));
    } catch (error) {
      if (error instanceof EditError) return { why: error.message };
      throw error;
    }
  }
  return { total: rows.compose(cells), steps };
}

/** The sheet's question for a paste that no tracked write holds. */
const PASTE_UNTRACKED =
  "This paste can't be tracked while another person's change is pending in the table. Make it without tracking?";

function write(view: EditorView, plan: Plan): boolean {
  const { state } = view;
  const { table } = plan;
  const tracked = state.field(trackingField);
  let done = compute(view, plan, false);
  let widened: WidenedPasteIntent | undefined;
  // The rows and columns it needs, where the table's own rules refuse them (another person's change
  // in the table): the table as a replacement, with the paste made in it (format §3.12).
  if ('why' in done && tracked && (plan.extra > 0 || (plan.extraCols ?? 0) > 0)) {
    try {
      const ctx = contextFor(state);
      const wide = writeWidenedPaste(state.doc.toString(), {
        paste: { table: table.from, range: plan.range, top: plan.top, left: plan.left },
        author: ctx.author,
        time: ctx.time,
        ...(ctx.dialect === undefined ? {} : { dialect: ctx.dialect }),
        ...(ctx.random ? { random: ctx.random } : {}),
      });
      widened = { ...wide.intent, id: newIntentId() };
      done = { total: ChangeSet.of(wide.changes, state.doc.length), steps: [] };
    } catch (error) {
      if (!(error instanceof EditError) && !(error instanceof Untrackable)) throw error;
    }
  }
  // No tracked write holds it (another person's change in the table): the person is asked, and the
  // paste is made without tracking, never refused (design: widen, alert or disable, §3.1).
  let untracked = false;
  if ('why' in done && tracked) {
    const plain = compute(view, plan, true);
    if (!('why' in plain)) {
      done = plain;
      untracked = true;
    }
  }
  if ('why' in done) return refuse(view, done.why);
  const total = done.total;
  // One write is its own intent (rows that are filled need the steps' derive); several, each on the text the one before left, are steps.
  const intent: StepsIntent | TypingIntent | TableIntent | WidenedPasteIntent | undefined = widened
    ? widened
    : done.steps.length === 1 && !(done.steps[0]?.kind === 'table' && done.steps[0].filled)
      ? done.steps[0]
      : done.steps.length
        ? { kind: 'steps', id: newIntentId(), steps: done.steps }
        : undefined;
  if (total.empty) return true;
  const annotations = [
    trackedEditAnnotation.of(true),
    clearedCells.of(true),
    isolateHistory.of('full'),
    ...(intent ? [recordedAs(intent)] : []),
  ];
  if (untracked) {
    const asker = state.facet(untrackedAskFacet);
    if (asker) {
      // Held for the sheet: Make Edit makes the same paste without tracking, Cancel drops it.
      view.dispatch({
        effects: heldEditEffect.of({
          reason: 'accept-pending',
          words: { title: PASTE_UNTRACKED },
          doc: state.doc,
          changes: total,
          selection: undefined,
          annotations: [Transaction.userEvent.of('input.paste'), ...annotations],
          scrollIntoView: true,
        }),
      });
      return true;
    }
    annotations.push(untrackedAnswerAnnotation.of(true));
  }
  view.dispatch({
    changes: total,
    userEvent: 'input.paste',
    annotations,
    // A tracked change made in Clean shows in the markup view, as typing's do.
    effects:
      tracked && !untracked && state.field(viewModeField) === 'clean'
        ? [setViewModeEffect.of(state.facet(markupViewFacet))]
        : [],
    scrollIntoView: true,
  });
  // What was pasted stays selected.
  const now = view.state.field(tablesField, false)?.find((t) => t.id === table.id);
  const a = now && cellOfRef(now, { row: plan.corners[0][0], col: plan.corners[0][1] });
  const b = now && cellOfRef(now, { row: plan.corners[1][0], col: plan.corners[1][1] });
  if (a && b && a !== b) {
    view.dispatch({ selection: EditorSelection.single(a.textFrom, b.textTo), userEvent: 'select' });
  }
  return true;
}

/** The random source tracked edits draw ids from. */
const editRandom = (state: EditorState) => state.facet(editSourceFacet).random;
