// Deriving table, steps, widened-paste and review intents again on newer text (docs/research/
// multiuser.md §4.2), as `rederive-other.ts` does for format and move. A table operation names its
// table by offset and its rows and columns by index, none of which mean the same once another
// window has added a row above or a column before. So the table is anchored to its header's words,
// each row to its text and each column to its header cell, and found again on the newest text.
//
// Place, don't refuse. What can't be found is said, never dropped silently.

import { ChangeSet } from '@codemirror/state';
import type { EditorState } from '@codemirror/state';
import { EditError, newestView, parse, readTables, Untrackable } from '@redlines/format';
import type { DocView, PasteOnTable, Range, TableOp, TableRead } from '@redlines/format';
import { deriveTable } from '../table/intent.ts';
import type { TableIntent } from '../table/intent.ts';
import { fillRows } from '../table/paste-intent.ts';
import { deriveWidenedPaste } from '../table/widened-paste.ts';
import type { WidenedPasteIntent } from '../table/widened-paste.ts';
import { anchorIntent, rederiveIntent } from './rederive.ts';
import type { Part, Rederived } from './rederive.ts';
import { partOf, placed } from './rederive-other.ts';
import { deriveIntent } from './typing.ts';
import type { StepsIntent } from './intent.ts';
import { fileLineBreak, mixedFileText } from '../line-breaks.ts';
import { FileView } from './file-view.ts';
import { deriveReview } from './review-intent.ts';
import type { ReviewIntent, ReviewOp } from './review-intent.ts';

// -- The shape of a table ------------------------------------------------------------------

interface RowKey {
  full: string;
  first: string;
}

/** What names a table's rows and columns: each row's words, each column's header. */
interface Shape {
  head: Part;
  rows: RowKey[];
  cols: string[];
}

const visible = (view: DocView, from: number, to: number): string => {
  const a = view.map.fromSource(from);
  return view.text.slice(a, Math.max(a, view.map.fromSource(to)));
};

function keysOf(view: DocView, table: TableRead): { rows: RowKey[]; cols: string[] } {
  const rows = table.rows.map((row) => ({
    full: visible(view, row.from, row.to),
    first: row.cells[0] ? visible(view, row.cells[0].textFrom, row.cells[0].textTo).trim() : '',
  }));
  const cols = (table.rows[0]?.cells ?? []).map((cell) =>
    visible(view, cell.textFrom, cell.textTo).trim(),
  );
  return { rows, cols };
}

function shapeOf(text: string, offset: number): Shape | null {
  const view = newestView(text);
  const tables = readTables(text, parse(text));
  const table =
    tables.find((t) => t.from === offset) ?? tables.find((t) => t.from <= offset && offset <= t.to);
  const header = table?.rows[0];
  if (!table || !header) return null;
  return { head: partOf(text, view, header.from, header.to), ...keysOf(view, table) };
}

/** The table of `shape` as `text` reads it now, with its rows and columns as they are. */
function found(
  text: string,
  shape: Shape,
): { table: number; rows: RowKey[]; cols: string[] } | null {
  const view = newestView(text);
  const tables = readTables(text, parse(text));
  const at = placed(view, shape.head);
  let table: TableRead | undefined;
  if (at) {
    const source = view.map.toSource(at.from, 1);
    table = tables.find((t) => {
      const header = t.rows[0];
      return header !== undefined && header.from <= source && source <= header.to;
    });
  } else {
    // The header itself changed (a column of it was deleted, say): the table that starts where
    // the words in front of it say, if there is one.
    const before = shape.head.before.slice(-8);
    const there = tables.filter((t) => {
      const header = t.rows[0];
      if (!header) return false;
      const a = view.map.fromSource(header.from);
      // The same number of columns, and the same words in front, or the start of the file.
      return (
        t.rows[0]!.cells.length === shape.cols.length &&
        (before.length >= 3 || a < 3) &&
        view.text.slice(Math.max(0, a - before.length), a) === before
      );
    });
    if (there.length === 1) table = there[0];
  }
  return table ? { table: table.from, ...keysOf(view, table) } : null;
}

/** Where the row or column `i` of `was` is in `now`: the only one like it, or the nearest. */
function indexOf<T>(
  was: readonly T[],
  i: number,
  now: readonly T[],
  same: (a: T, b: T) => boolean,
) {
  const old = was[i];
  if (old === undefined) return null;
  const hits = now.flatMap((item, j) => (same(item, old) ? [j] : []));
  if (!hits.length) return null;
  const before = was.flatMap((item, j) => (same(item, old) ? [j] : []));
  // Rows or columns that read alike (empty headers, say) can't be told apart by words: when their
  // number changed, which one was meant isn't known, so none is chosen.
  if (before.length > 1 && before.length !== hits.length) return null;
  if (before.length > 1) return hits[before.indexOf(i)] ?? null;
  return hits.reduce((a, b) => (Math.abs(b - i) < Math.abs(a - i) ? b : a));
}

/** Rows and columns, and the notices for what had to be placed near or left out. */
function placer(was: Shape, now: { rows: RowKey[]; cols: string[] }) {
  const notices = new Set<string>();
  const row = (i: number): number | null => {
    const full = indexOf(was.rows, i, now.rows, (a, b) => a.full === b.full);
    if (full !== null) return full;
    const old = was.rows[i];
    const firsts = now.rows.flatMap((r, j) => (old?.first && r.first === old.first ? [j] : []));
    return firsts.length === 1 ? firsts[0]! : null;
  };
  const col = (i: number): number | null => indexOf(was.cols, i, now.cols, (a, b) => a === b);
  const lost = () =>
    notices.add('A row or column of the table was changed by someone else, and was left out.');
  const list = (items: readonly number[], map: (i: number) => number | null): number[] => {
    const out: number[] = [];
    for (const i of items) {
      const j = map(i);
      if (j === null) lost();
      else out.push(j);
    }
    return [...new Set(out)].sort((a, b) => a - b);
  };
  // A boundary: in front of item `b` of `count`, which is the end when `b` is past the last.
  const boundary = (b: number, count: number, map: (i: number) => number | null, size: number) => {
    if (b >= count) return size;
    const j = map(b);
    if (j !== null) return j;
    notices.add(
      'The place for your change in the table was changed by someone else; it is the nearest one.',
    );
    return Math.min(b, size);
  };
  return { row, col, list, boundary, notices };
}

/** The operation as the newest text reads it, or null (and a notice) when nothing is left of it. */
function placeOp(
  op: TableOp,
  was: Shape,
  now: { table: number; rows: RowKey[]; cols: string[] },
): { op: TableOp; notices: string[] } | { gone: string } {
  const p = placer(was, now);
  const table = now.table;
  const near = (message: string) => p.notices.add(message);
  switch (op.kind) {
    case 'insertRows': {
      let after = -1;
      if (op.after >= 0) {
        const j = p.row(op.after);
        if (j === null) {
          near(
            'The row your new rows go below was changed by someone else; they go at the nearest place.',
          );
          after = Math.min(op.after, now.rows.length - 1);
        } else after = j;
      }
      return { op: { ...op, table, after }, notices: [...p.notices] };
    }
    case 'insertCols': {
      let after = 0;
      if (op.after > 0) {
        const j = p.col(op.after - 1);
        if (j === null) {
          near(
            'The column your new columns follow was changed by someone else; they go at the nearest place.',
          );
          after = Math.min(op.after, now.cols.length);
        } else after = j + 1;
      }
      return { op: { ...op, table, after }, notices: [...p.notices] };
    }
    case 'deleteRows': {
      const rows = p.list(op.rows, p.row);
      return rows.length
        ? { op: { ...op, table, rows }, notices: [...p.notices] }
        : { gone: 'The rows you deleted were changed by someone else, so nothing was deleted.' };
    }
    case 'deleteCols': {
      const cols = p.list(op.cols, p.col);
      return cols.length
        ? { op: { ...op, table, cols }, notices: [...p.notices] }
        : { gone: 'The columns you deleted were changed by someone else, so nothing was deleted.' };
    }
    case 'moveRows': {
      const rows = p.list(op.rows, p.row);
      if (!rows.length)
        return { gone: 'The rows you moved were changed by someone else, so nothing was moved.' };
      const to = p.boundary(op.to, was.rows.length, p.row, now.rows.length);
      return { op: { ...op, table, rows, to }, notices: [...p.notices] };
    }
    case 'moveCols': {
      const cols = p.list(op.cols, p.col);
      if (!cols.length)
        return {
          gone: 'The columns you moved were changed by someone else, so nothing was moved.',
        };
      const to = p.boundary(op.to, was.cols.length, p.col, now.cols.length);
      return { op: { ...op, table, cols, to }, notices: [...p.notices] };
    }
    case 'align': {
      const cols = p.list(op.cols, p.col);
      return cols.length
        ? { op: { ...op, table, cols }, notices: [...p.notices] }
        : {
            gone: 'The columns you aligned were changed by someone else, so they were not aligned.',
          };
    }
    case 'deleteTable':
      return { op: { ...op, table }, notices: [] };
    case 'fillCells': {
      const row = op.row === 0 ? 0 : p.row(op.row);
      const col = p.col(op.col);
      if (row === null || col === null) {
        return {
          gone: 'The cell you filled was changed by someone else, so nothing was written in it.',
        };
      }
      return { op: { ...op, table, row, col }, notices: [] };
    }
  }
}

function problem(error: unknown): { ok: false; reason: string } {
  if (error instanceof EditError || error instanceof Untrackable) {
    return { ok: false, reason: error.message };
  }
  throw error;
}

const none = (length: number, notice: string): Rederived => ({
  ok: true,
  changes: ChangeSet.empty(length),
  notices: [notice],
  moved: true,
});

// -- Table ----------------------------------------------------------------------------------

export interface AnchoredTable {
  intent: TableIntent;
  shape: Shape | null;
}

export function anchorTable(text: string, intent: TableIntent): AnchoredTable {
  return { intent, shape: shapeOf(text, intent.op.table) };
}

/** The intent's changes on `text` for `op`, with the values of a paste written into the rows it adds. */
function tableChanges(text: string, intent: TableIntent, op: TableOp): ChangeSet {
  return ChangeSet.of(
    deriveTable(text, intent, op).changes.map(({ from, to, insert }) => ({
      from,
      to,
      insert:
        intent.filled && from === to && /^\r?\n\|/.test(insert)
          ? fillRows(insert, intent.filled.range, intent.filled.first, intent.filled.col)
          : insert,
    })),
    text.length,
  );
}

export function rederiveTable(state: EditorState, anchored: AnchoredTable): Rederived {
  const { intent, shape } = anchored;
  const text = state.doc.toString();
  const lost = 'The table you changed was changed by someone else, so your change was not made.';
  if (!shape) return none(text.length, lost);
  const now = found(text, shape);
  if (!now) return none(text.length, lost);
  const op = placeOp(intent.op, shape, now);
  if ('gone' in op) return none(text.length, op.gone);
  try {
    return {
      ok: true,
      changes: tableChanges(text, intent, op.op),
      notices: op.notices,
      moved: true,
    };
  } catch (error) {
    return problem(error);
  }
}

// -- Widened paste --------------------------------------------------------------------------

export interface AnchoredPaste {
  intent: WidenedPasteIntent;
  shape: Shape | null;
}

export function anchorPaste(text: string, intent: WidenedPasteIntent): AnchoredPaste {
  return { intent, shape: shapeOf(text, intent.paste.table) };
}

export function rederivePaste(state: EditorState, anchored: AnchoredPaste): Rederived {
  const { intent, shape } = anchored;
  const text = state.doc.toString();
  const lost = 'The table you pasted into was changed by someone else, so your paste was not made.';
  if (!shape) return none(text.length, lost);
  const now = found(text, shape);
  if (!now) return none(text.length, lost);
  const p = placer(shape, now);
  const top = p.row(intent.paste.top);
  const left = p.col(intent.paste.left);
  if (top === null || left === null) {
    return none(
      text.length,
      'The cells you pasted over were changed by someone else, so your paste was not made.',
    );
  }
  const paste: PasteOnTable = { ...intent.paste, table: now.table, top, left };
  try {
    const changes = deriveWidenedPaste(text, intent, paste);
    return {
      ok: true,
      changes: ChangeSet.of(
        changes.map(({ from, to, insert }) => ({ from, to, insert })),
        text.length,
      ),
      notices: [],
      moved: true,
    };
  } catch (error) {
    return problem(error);
  }
}

// -- Steps ----------------------------------------------------------------------------------

/**
 * A paste's steps placed one after the other on `state`'s text, each among the words of the text its
 * own first writing left (`origin` with the steps before it written as they were).
 */
export function rederiveSteps(state: EditorState, origin: string, intent: StepsIntent): Rederived {
  let was: EditorState = state.update({
    changes: { from: 0, to: state.doc.length, insert: origin },
    filter: false,
  }).state;
  let now = state;
  let total = ChangeSet.empty(state.doc.length);
  const notices: string[] = [];
  try {
    for (const step of intent.steps) {
      const start = was.doc.toString();
      const done =
        step.kind === 'table'
          ? rederiveTable(now, anchorTable(start, step))
          : rederiveIntent(now, anchorIntent(start, step));
      if (!done.ok) return done;
      // A step of the table that was lost leaves the later ones with nothing to go on: the whole
      // paste is not made, and that is said, not half of it.
      if (step.kind === 'table' && done.changes.empty) {
        return none(
          state.doc.length,
          'The table you pasted into was changed by someone else, so your paste was not made.',
        );
      }
      notices.push(...done.notices);
      total = total.compose(done.changes);
      now = now.update({ changes: done.changes, filter: false }).state;
      const first =
        step.kind === 'table' ? tableChanges(start, step, step.op) : deriveIntent(was, step);
      was = was.update({ changes: first, filter: false }).state;
    }
  } catch (error) {
    return problem(error);
  }
  return { ok: true, changes: total, notices: [...new Set(notices)], moved: true };
}

// -- Review ---------------------------------------------------------------------------------

export interface AnchoredReview {
  intent: ReviewIntent;
  /** The words a comment or highlight was made on. */
  part: Part | null;
}

export function anchorReview(text: string, intent: ReviewIntent): AnchoredReview {
  const { op } = intent;
  if (op.op !== 'comment' && op.op !== 'highlight') return { intent, part: null };
  return {
    intent,
    part: partOf(text, newestView(text), op.range.from, op.range.to),
  };
}

/**
 * The review action on `state`'s text. A comment or highlight goes on the words it was made on; a
 * reply, resolve or reopen names its thread; a decision is judged by the guard of §4.4: a mark that
 * changed or is gone is left as it is, and the person is told.
 */
export function rederiveReview(state: EditorState, anchored: AnchoredReview): Rederived {
  const { intent, part } = anchored;
  const text = state.doc.toString();
  let op: ReviewOp = intent.op;
  if (part && (op.op === 'comment' || op.op === 'highlight')) {
    const view = newestView(text);
    const at = placed(view, part);
    if (!at) {
      const what = op.op === 'comment' ? 'comment' : 'highlight';
      return none(
        text.length,
        `The text you wanted a ${what} on was changed by someone else, so it was not added.`,
      );
    }
    const range: Range = {
      from: view.map.toSource(at.from, 1),
      to: view.map.toSource(at.to, -1),
    };
    op = { ...op, range };
  }
  try {
    // A decision in a file with line breaks of more than one kind is written on the file's own
    // text, so that a break it restores has the kind its payload names, and brings that kind back
    // in the styles (#924, #1057).
    const file = op.op === 'decide' ? mixedFileText(state, true) : null;
    const onFile = file === null ? null : new FileView(file);
    const done = deriveReview(text, intent, op, onFile ? onFile.text : text);
    if (!done.ok) {
      return none(
        text.length,
        done.reason === 'gone'
          ? 'A suggestion you decided on is gone: someone else decided it or removed it, so nothing was changed.'
          : 'Someone changed a suggestion you decided on, so your decision was not applied. Review it again.',
      );
    }
    const brought = onFile?.changesToDoc(done.changes, fileLineBreak(state) ?? '\n');
    return {
      ok: true,
      changes: ChangeSet.of(
        (brought ? brought.changes : done.changes).map(({ from, to, insert }) => ({
          from,
          to,
          insert,
        })),
        text.length,
      ),
      ...(brought?.styles.length ? { styles: brought.styles } : {}),
      notices: done.skipped?.length
        ? [
            'Some suggestions you decided on were changed by someone else, and were left as they are.',
          ]
        : [],
      moved: true,
    };
  } catch (error) {
    return problem(error);
  }
}
