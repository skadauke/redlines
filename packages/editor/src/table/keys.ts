// The table keymap (design: tables, "The caret and the keys"): one set of keys, above the editor's
// others, that acts only while the caret is in a cell of a table and the view is Clean, Simple or
// Redlines. Raw keeps CodeMirror's. A key that moves the caret writes nothing; the keys that edit
// plan plain edits that the tracked layer records as it records typing, and never write markers.
//
// ← and → are CodeMirror's: the caret steps over the atoms of `stops.ts`, so a press at a cell's
// edge lands in the next cell's text. Everything else that depends on the cell's edges, or on the
// cells around it, is here.

import { EditorSelection, type EditorState, type Extension, Prec } from '@codemirror/state';
import { type Command, EditorView, keymap } from '@codemirror/view';
import { returnAtEnd as planOpenAfter } from '../blocks/edits.ts';
import { applyKeyEdit } from '../blocks/keys.ts';
import { endOf, outOfHidden, restingAfter, restingBefore, startOf } from '../blocks/motion.ts';
import { blockAt } from '../blocks/structure.ts';
import { pastHidden, visibleSelection } from '../tracked/decorations.ts';
import { bodyEnd, parsedField, viewModeField } from '../tracked/field.ts';
import { refusedEditEffect } from '../tracked/typing.ts';
import { type Cell, type Row, type Table } from './model.ts';
import { deleteRows, insertRowAfter, insertRows, moveRows } from './ops.ts';
import { cellOfRef, cellsOfRect, clearCells, rectOf, selectRect, whole } from './cells.ts';
import { deleteReach } from './reach.ts';
import { selectionInTable, shownCellAt } from './stops.ts';

/** A key that moves the caret in a table, as the keymap names it. */
export type MoveKey =
  | 'ArrowUp'
  | 'ArrowDown'
  | 'Home'
  | 'End'
  | 'Alt-ArrowLeft'
  | 'Alt-ArrowRight'
  | 'Mod-ArrowUp'
  | 'Mod-ArrowDown';

/** Where the caret is: a table, its row and its cell, with one empty selection in a view that draws
 * tables. */
interface Here {
  table: Table;
  row: Row;
  cell: Cell;
  head: number;
}

function hereIn(state: EditorState): Here | null {
  if (state.field(viewModeField, false) === 'raw') return null;
  const { main } = state.selection;
  if (state.selection.ranges.length > 1 || !main.empty) return null;
  const found = shownCellAt(state, main.head);
  if (!found) return null;
  const row = found.table.rows.find((r) => r.cells.includes(found.cell));
  return row ? { table: found.table, row, cell: found.cell, head: main.head } : null;
}

/** Whether the caret is in a cell of a table. */
export function inTable(state: EditorState): boolean {
  return hereIn(state) !== null;
}

function goTo(view: EditorView, pos: number): boolean {
  const selection = visibleSelection(view.state, EditorSelection.single(pos));
  if (!selection.eq(view.state.selection)) {
    view.dispatch({ selection, userEvent: 'select', scrollIntoView: true });
  }
  return true;
}

const clamp = (pos: number, cell: Cell) => Math.min(Math.max(pos, cell.textFrom), cell.textTo);

/** The top of the line that holds `pos`, or null where nothing is laid out. At a cell's end the
 * character before is the one asked, as the text beyond is hidden, and drawn elsewhere. */
function lineTop(view: EditorView, pos: number, side: -1 | 1): number | null {
  return view.coordsAtPos(pos, side)?.top ?? null;
}

/** Whether `pos` is on the cell's first (or last) visual line. Where nothing is laid out, and in an
 * empty cell, a cell is one line. */
function onEdgeLine(view: EditorView, cell: Cell, pos: number, first: boolean): boolean {
  if (cell.textFrom === cell.textTo) return true;
  const mine = lineTop(view, pos, pos >= cell.textTo ? -1 : 1);
  const edge = first ? lineTop(view, cell.textFrom, 1) : lineTop(view, cell.textTo, -1);
  return mine === null || edge === null || Math.abs(mine - edge) < 2;
}

/** The cell above or below the caret's, in the same column: the last of a short row. */
function neighbourCell(here: Here, down: boolean): Cell | null {
  const row = here.table.rows[here.row.index + (down ? 1 : -1)];
  if (!row) return null;
  const shown = row.cells.filter((cell) => cell.col < here.table.columns);
  return shown.find((cell) => cell.col === here.cell.col) ?? shown.at(-1) ?? null;
}

/**
 * Where ↑ or ↓ lands in `target`, the cell above or below: at the same x, on the line that is next
 * to the one it left (the last line going up, the first going down), or its stop for an empty cell.
 * Where nothing is laid out, at the same place in its text.
 */
function placeIn(view: EditorView, here: Here, target: Cell, down: boolean): number {
  if (target.textFrom === target.textTo) return target.textFrom;
  const mine = view.coordsAtPos(here.head, here.head >= here.cell.textTo ? -1 : 1);
  const edge = down ? view.coordsAtPos(target.textFrom, 1) : view.coordsAtPos(target.textTo, -1);
  if (!mine || !edge) return clamp(target.textFrom + (here.head - here.cell.textFrom), target);
  const hit = view.posAtCoords({ x: mine.left, y: (edge.top + edge.bottom) / 2 }, false);
  if (hit >= target.textFrom && hit <= target.textTo) return hit;
  // The point is in another cell, or outside the text: the stop on that side of the line.
  const line = (pos: number, forward: boolean) =>
    clamp(view.moveToLineBoundary(EditorSelection.cursor(pos), forward, true).head, target);
  const start = down ? target.textFrom : line(target.textTo, false);
  const end = down ? line(target.textFrom, true) : target.textTo;
  const at = view.coordsAtPos(start, start >= target.textTo ? -1 : 1);
  return at && mine.left <= at.left ? start : end;
}

/** ↑ and ↓. */
function vertical(view: EditorView, down: boolean): boolean {
  const here = hereIn(view.state);
  if (!here) return false;
  const { state } = view;
  // By visual line inside the cell, while the caret has one to go to.
  if (!onEdgeLine(view, here.cell, here.head, !down)) {
    const moved = view.moveVertically(state.selection.main, down).head;
    if (moved !== here.head) return goTo(view, clamp(moved, here.cell));
  }
  const target = neighbourCell(here, down);
  if (target) return goTo(view, placeIn(view, here, target, down));
  // Out of the table: to the block above or below.
  const block = blockAt(state, here.head);
  if (!block) return true;
  const next = down ? restingAfter(state, block) : restingBefore(state, block);
  if (!next) {
    // A table at the start of the document has nothing above it; one that ends it gets E1's empty
    // paragraph, as Word and Docs always keep one after a table.
    if (down) applyKeyEdit(view, planOpenAfter(state, block));
    return true;
  }
  return goTo(view, down ? outOfHidden(state, startOf(state, next), true) : endOf(state, next));
}

/** ⌥← and ⌥→: by word inside the cell; at its edge, as ← and → go, to the next cell. */
function byWord(view: EditorView, forward: boolean): boolean {
  const here = hereIn(view.state);
  if (!here) return false;
  const { main } = view.state.selection;
  const atEdge = forward ? here.head >= here.cell.textTo : here.head <= here.cell.textFrom;
  const to = atEdge ? view.moveByChar(main, forward) : view.moveByGroup(main, forward);
  return goTo(view, atEdge ? to.head : clamp(to.head, here.cell));
}

/** Home, End, ⌘←, ⌘→, ⌃A and ⌃E: the start or end of the visual line, never past the cell's text. */
function lineEdge(forward: boolean): Command {
  return (view) => {
    const here = hereIn(view.state);
    if (!here) return false;
    const boundary = view.moveToLineBoundary(view.state.selection.main, forward, true).head;
    return goTo(view, clamp(boundary, here.cell));
  };
}

/** ⌘↑ and ⌘↓: the start or end of the document. */
function documentEdge(end: boolean): Command {
  return (view) => {
    if (!hereIn(view.state)) return false;
    const pos = end ? (bodyEnd(view.state.field(parsedField)) ?? view.state.doc.length) : 0;
    return goTo(view, pos);
  };
}

/** ⌥↑ and ⌥↓, and with ⇧ selecting: a cell's text reads as a paragraph, so they go to its start or
 * end, and never out of the cell (the block keys would take them across the whole table). */
function cellParagraph(forward: boolean, extend: boolean): Command {
  return (view) => {
    const here = extend ? cellOfHead(view.state) : hereIn(view.state);
    if (!here) return false;
    const to = forward ? here.cell.textTo : here.cell.textFrom;
    if (!extend) return goTo(view, to);
    const { anchor } = view.state.selection.main;
    if (shownCellAt(view.state, anchor)?.cell !== here.cell) return false;
    const selection = visibleSelection(view.state, EditorSelection.single(anchor, to));
    if (!selection.eq(view.state.selection)) {
      view.dispatch({ selection, userEvent: 'select.extend', scrollIntoView: true });
    }
    return true;
  };
}

/** The cell that holds the whole of the main selection's text, or null: a selection that reaches
 * out of a cell is for `reach.ts`. */
function cellOfSelection(state: EditorState): Here | null {
  if (state.field(viewModeField, false) === 'raw' || state.selection.ranges.length > 1) return null;
  const { from, to } = state.selection.main;
  const a = shownCellAt(state, from);
  const b = shownCellAt(state, to);
  if (!a || a.cell !== b?.cell || from < a.cell.textFrom || to > a.cell.textTo) return null;
  const row = a.table.rows.find((r) => r.cells.includes(a.cell));
  return row ? { table: a.table, row, cell: a.cell, head: state.selection.main.head } : null;
}

const BREAK = /<br\s*\/?>/gi;

/** The `<br>` that ends at `pos`, past any hidden markers behind it (the end of an insertion that
 * holds it), or the one that starts there; within the cell's text. */
function breakAt(state: EditorState, cell: Cell, pos: number, forward: boolean): Span | null {
  const edge = pastHidden(state, pos, forward);
  const text = state.sliceDoc(cell.textFrom, cell.textTo);
  for (const found of text.matchAll(BREAK)) {
    const from = cell.textFrom + found.index;
    const to = from + found[0].length;
    if (forward ? from === edge : to === edge) return { from, to };
  }
  return null;
}

interface Span {
  from: number;
  to: number;
}

/** Whether the caret is at the cell's start (end), past hidden markers: where ⌫ (⌦) does nothing. */
const atEdge = (state: EditorState, cell: Cell, pos: number, forward: boolean) =>
  forward
    ? pastHidden(state, pos, true) >= cell.textTo
    : pastHidden(state, pos, false) <= cell.textFrom;

/** Deletes `span` as a key does, the caret where the deletion leaves it. */
function remove(view: EditorView, span: Span, forward: boolean): boolean {
  view.dispatch({
    changes: span,
    selection: EditorSelection.cursor(span.from),
    userEvent: forward ? 'delete.forward' : 'delete.backward',
    scrollIntoView: true,
  });
  return true;
}

/** The cell after (before) the caret's in reading order, or null at the table's end (start). */
function nextCell(here: Here, forward: boolean): Cell | null {
  const shown = (row: Row) => row.cells.filter((cell) => cell.col < here.table.columns);
  const mine = shown(here.row);
  const beside = mine[mine.indexOf(here.cell) + (forward ? 1 : -1)];
  if (beside) return beside;
  const row = here.table.rows[here.row.index + (forward ? 1 : -1)];
  if (!row) return null;
  const cells = shown(row);
  return (forward ? cells[0] : cells.at(-1)) ?? null;
}

/** Selects a cell's text (an empty cell gets the caret). */
function selectCell(view: EditorView, cell: Cell): boolean {
  const selection = visibleSelection(
    view.state,
    EditorSelection.single(cell.textFrom, cell.textTo),
  );
  view.dispatch({ selection, userEvent: 'select', scrollIntoView: true });
  return true;
}

/** The cell that holds the head of the selection, with one selection in a view that draws tables. */
function cellOfHead(state: EditorState): Here | null {
  if (state.field(viewModeField, false) === 'raw' || state.selection.ranges.length > 1) return null;
  const { head } = state.selection.main;
  const found = shownCellAt(state, head);
  const row = found && found.table.rows.find((r) => r.cells.includes(found.cell));
  return found && row ? { table: found.table, row, cell: found.cell, head } : null;
}

/** Tab and ⇧Tab: the next or previous cell, its text selected; Tab in the last cell adds a row, and
 * ⇧Tab in the first does nothing. */
function tab(forward: boolean): Command {
  return (view) => {
    // A selection that reaches out of its cell acts on the cell of its head, as Tab there would, and
    // never moves the focus out of the document with the selection in a table.
    const here = cellOfSelection(view.state) ?? cellOfHead(view.state);
    if (!here) return selectionInTable(view.state);
    const to = nextCell(here, forward);
    if (to) return selectCell(view, to);
    if (!forward) return true;
    const last = here.table.rows.at(-1) ?? here.row;
    return insertRowAfter(view, here.table, last);
  };
}

/** ⌘A: in a cell, the cell's text; with that selected already (or the cell empty), the whole table;
 * with the table selected, the document (CodeMirror's Select All, which this declines). Outside a
 * cell, and in Raw, not for this. */
export const selectAllInCell: Command = (view) => {
  const { state } = view;
  const rect = rectOf(state);
  if (rect) return whole(rect) === 'table' ? false : selectRect(view, 'table');
  const here = cellOfSelection(state);
  if (!here) return false;
  const { from, to } = state.selection.main;
  const cell = here.cell;
  if (cell.textFrom < cell.textTo && !(from === cell.textFrom && to === cell.textTo)) {
    return selectCell(view, cell);
  }
  // A table of one cell has nothing between the cell and the document.
  if (here.table.rows.length === 1 && here.table.columns === 1) return false;
  return selectRect(view, 'table');
};

/** Esc, with cells selected: a caret in the cell where the selection ended. */
const collapseCells: Command = (view) => {
  if (!rectOf(view.state)) return false;
  view.dispatch({
    selection: EditorSelection.cursor(view.state.selection.main.head),
    userEvent: 'select',
    scrollIntoView: true,
  });
  return true;
};

/** ⇧ with an arrow, while cells are selected: the selection grows or shrinks by a cell, from the
 * cell where it ended; at the table's edge nothing happens. When it shrinks to the cell it started
 * in, it is a caret there. */
function growCells(dRow: number, dCol: number): Command {
  return (view) => {
    const { state } = view;
    const rect = rectOf(state);
    if (!rect) return false;
    const { table } = rect;
    const row = rect.head.row + dRow;
    const col = rect.head.col + dCol;
    if (row < 0 || row >= table.rows.length || col < 0 || col >= table.columns) return true;
    const target = cellOfRef(table, { row, col });
    const home = cellOfRef(table, rect.anchor);
    if (!target) return true;
    const { anchor } = state.selection.main;
    if (target === cellOfRef(table, rect.head)) return true;
    const to = target === home ? anchor : dRow + dCol > 0 ? target.textTo : target.textFrom;
    const selection = visibleSelection(state, EditorSelection.single(anchor, to));
    view.dispatch({ selection, userEvent: 'select.extend', scrollIntoView: true });
    return true;
  };
}

/** ⇧↑ and ⇧↓ in a cell's text: by visual line in the cell, and from its first or last line into the
 * cell above or below, which makes cells. Out of the table, and for a selection that began outside
 * the cell, the editor's own. */
function extendVertical(down: boolean): Command {
  return (view) => {
    const { state } = view;
    if (rectOf(state)) return growCells(down ? 1 : -1, 0)(view);
    const here = cellOfHead(state);
    if (!here) return false;
    const { anchor } = state.selection.main;
    if (shownCellAt(state, anchor)?.cell !== here.cell) return false;
    let to: number;
    if (!onEdgeLine(view, here.cell, here.head, !down)) {
      const moved = view.moveVertically(state.selection.main, down).head;
      if (moved === here.head) return false;
      to = clamp(moved, here.cell);
    } else {
      const target = neighbourCell(here, down);
      if (!target) return false;
      to = placeIn(view, here, target, down);
    }
    const selection = visibleSelection(state, EditorSelection.single(anchor, to));
    view.dispatch({ selection, userEvent: 'select.extend', scrollIntoView: true });
    return true;
  };
}

/** ⇧← and ⇧→ while cells are selected; otherwise the editor's own, which crosses a cell's edge. */
function extendSideways(forward: boolean): Command {
  return (view) => (rectOf(view.state) ? growCells(0, forward ? 1 : -1)(view) : false);
}

/** ↩ and ⇧↩: a `<br>` at the caret, over a selection in the cell, and the caret after it. */
const lineBreak: Command = (view) => {
  // Cells selected: nothing to break, and nothing refused.
  if (rectOf(view.state)) return true;
  if (deleteReach(view, 'return')) return true;
  const here = cellOfSelection(view.state);
  if (!here) return false;
  const { from, to } = view.state.selection.main;
  return applyKeyEdit(view, {
    changes: [{ from, to, insert: '<br>' }],
    selection: EditorSelection.single(from + 4),
    userEvent: 'input.break.line',
    record: false,
  });
};

/** ⌫ and ⌦ with cells selected: their text goes, as one change. */
function clearSelectedCells(view: EditorView): boolean {
  const rect = rectOf(view.state);
  return rect ? clearCells(view, cellsOfRect(rect)) : false;
}

/** ⌫: nothing at a cell's start, a `<br>` whole after it; a selection or a character is the
 * editor's. */
const backspace: Command = (view) => {
  if (clearSelectedCells(view)) return true;
  if (deleteReach(view)) return true;
  const here = cellOfSelection(view.state);
  if (!here || !view.state.selection.main.empty) return false;
  const { state } = view;
  const br = breakAt(state, here.cell, here.head, false);
  if (br) return remove(view, br, false);
  return atEdge(state, here.cell, here.head, false);
};

/** ⌦: nothing at a cell's end, a `<br>` whole in front of the caret. */
const forwardDelete: Command = (view) => {
  if (clearSelectedCells(view)) return true;
  if (deleteReach(view)) return true;
  const here = cellOfSelection(view.state);
  if (!here || !view.state.selection.main.empty) return false;
  const { state } = view;
  const br = breakAt(state, here.cell, here.head, true);
  if (br) return remove(view, br, true);
  return atEdge(state, here.cell, here.head, true);
};

const mac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);

/** ⌥⌫, ⌥⌦ and the line deletions: as in a paragraph, never past the cell's edge. */
function deleteBy(forward: boolean, unit: 'group' | 'line'): Command {
  return (view) => {
    const here = cellOfSelection(view.state);
    if (!here) return false;
    const { main } = view.state.selection;
    if (!main.empty) return false;
    const { state } = view;
    if (atEdge(state, here.cell, here.head, forward)) return true;
    const moved =
      unit === 'group'
        ? view.moveByGroup(main, forward).head
        : view.moveToLineBoundary(main, forward, true).head;
    const edge = clamp(moved, here.cell);
    if (edge === here.head) return true;
    return remove(
      view,
      { from: Math.min(edge, here.head), to: Math.max(edge, here.head) },
      forward,
    );
  };
}

/** A key that CodeMirror's command would break the row with (a line indented, commented, deleted or
 * selected): nothing is done in a cell, and the notice says so. */
function notInCell(name: string): Command {
  return (view) => {
    if (!selectionInTable(view.state)) return false;
    view.dispatch({ effects: refusedEditEffect.of(`${name} doesn't work in a table cell.`) });
    return true;
  };
}

/** ⌃T: nothing across a cell's edge. */
const transpose: Command = (view) => {
  const here = hereIn(view.state);
  return !!here && (here.head <= here.cell.textFrom || here.head >= here.cell.textTo);
};

/** An input method's or the page's own paragraph or line break: a `<br>` in a cell. */
const cellBreaks = EditorView.domEventHandlers({
  beforeinput(event, view) {
    if (event.inputType !== 'insertParagraph' && event.inputType !== 'insertLineBreak') {
      return false;
    }
    if (view.composing || !lineBreak(view)) return false;
    event.preventDefault();
    return true;
  },
});

/** The keys that move the caret in a table, by the Mac key that runs them, for tests, which run
 * where CodeMirror's `mac` bindings don't apply. */
export const macTableCommands: Readonly<Record<string, Command>> = {
  'Cmd-ArrowLeft': lineEdge(false),
  'Cmd-ArrowRight': lineEdge(true),
  'Ctrl-a': lineEdge(false),
  'Ctrl-e': lineEdge(true),
  'Cmd-ArrowUp': documentEdge(false),
  'Cmd-ArrowDown': documentEdge(true),
};

/** Moves the caret as `key` says, where it is in a table; false where it isn't, or the key is
 * CodeMirror's. */
export function moveInTable(view: EditorView, key: MoveKey): boolean {
  switch (key) {
    case 'ArrowUp':
      return vertical(view, false);
    case 'ArrowDown':
      return vertical(view, true);
    case 'Home':
      return lineEdge(false)(view);
    case 'End':
      return lineEdge(true)(view);
    case 'Alt-ArrowLeft':
      return byWord(view, false);
    case 'Alt-ArrowRight':
      return byWord(view, true);
    case 'Mod-ArrowUp':
      return documentEdge(false)(view);
    case 'Mod-ArrowDown':
      return documentEdge(true)(view);
  }
}

const key =
  (name: MoveKey): Command =>
  (view) =>
    moveInTable(view, name);

/** The table keymap, at the highest precedence; it acts only with the caret in a cell. */
export function tableKeymap(): Extension {
  return [
    cellBreaks,
    Prec.highest(
      keymap.of([
        { key: 'ArrowUp', run: key('ArrowUp') },
        { key: 'ArrowDown', run: key('ArrowDown') },
        { key: 'Home', run: key('Home') },
        { key: 'End', run: key('End') },
        { key: 'Alt-ArrowLeft', run: key('Alt-ArrowLeft') },
        { key: 'Alt-ArrowRight', run: key('Alt-ArrowRight') },
        { key: 'Ctrl-ArrowLeft', run: key('Alt-ArrowLeft') },
        { key: 'Ctrl-ArrowRight', run: key('Alt-ArrowRight') },
        { mac: 'Cmd-ArrowLeft', run: lineEdge(false) },
        { mac: 'Cmd-ArrowRight', run: lineEdge(true) },
        { mac: 'Ctrl-a', run: lineEdge(false) },
        { mac: 'Ctrl-e', run: lineEdge(true) },
        { mac: 'Cmd-ArrowUp', key: 'Ctrl-Home', run: key('Mod-ArrowUp') },
        { mac: 'Cmd-ArrowDown', key: 'Ctrl-End', run: key('Mod-ArrowDown') },
        { key: 'Shift-ArrowRight', run: extendSideways(true) },
        { key: 'Shift-ArrowLeft', run: extendSideways(false) },
        { key: 'Shift-ArrowDown', run: extendVertical(true) },
        { key: 'Shift-ArrowUp', run: extendVertical(false) },
        { key: 'Escape', run: collapseCells },
        { key: 'Ctrl-l', run: (view) => selectRect(view, 'row') },
        { key: 'Tab', run: tab(true) },
        { key: 'Shift-Tab', run: tab(false) },
        { key: 'Mod-Enter', run: (view) => insertRows(view, false) },
        { key: 'Alt-Mod-ArrowUp', run: (view) => insertRows(view, true) },
        { key: 'Alt-Mod-ArrowDown', run: (view) => insertRows(view, false) },
        { key: 'Alt-Mod-Backspace', run: deleteRows },
        { key: 'Shift-Mod-k', run: deleteRows },
        { key: 'Mod-a', run: selectAllInCell },
        { key: 'Enter', run: lineBreak },
        { key: 'Shift-Enter', run: lineBreak },
        { key: 'Alt-Enter', run: lineBreak },
        { key: 'Alt-Shift-Enter', run: lineBreak },
        { key: 'Backspace', run: backspace },
        { key: 'Delete', run: forwardDelete },
        { mac: 'Ctrl-h', run: backspace },
        { mac: 'Ctrl-d', run: forwardDelete },
        { key: 'Alt-Backspace', run: deleteBy(false, 'group') },
        { key: 'Alt-Delete', run: deleteBy(true, 'group') },
        { key: 'Mod-Backspace', run: deleteBy(false, mac ? 'line' : 'group') },
        { key: 'Mod-Delete', run: deleteBy(true, mac ? 'line' : 'group') },
        { mac: 'Ctrl-k', run: deleteBy(true, 'line') },
        { mac: 'Ctrl-t', run: transpose },
        { key: 'Alt-ArrowUp', run: (view) => moveRows(view, true) },
        { key: 'Alt-ArrowDown', run: (view) => moveRows(view, false) },
        { key: 'Shift-Alt-ArrowUp', run: cellParagraph(false, true) },
        { key: 'Shift-Alt-ArrowDown', run: cellParagraph(true, true) },
        // These would break the row (a line indented or commented) and say so.
        { key: 'Mod-[', run: notInCell('Outdent') },
        { key: 'Mod-]', run: notInCell('Indent') },
        { key: 'Mod-/', run: notInCell('Toggle Comment') },
      ]),
    ),
  ];
}
