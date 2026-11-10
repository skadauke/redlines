// The table keymap (design: tables, "The caret and the keys"): one set of keys, above the editor's
// others, that acts only while the caret is in a cell of a table and the view is Clean, Simple or
// Redlines. Raw keeps CodeMirror's. A key that moves the caret writes nothing; the keys that edit
// plan plain edits that the tracked layer records as it records typing, and never write markers.
//
// ← and → are CodeMirror's: the caret steps over the atoms of `stops.ts`, so a press at a cell's
// edge lands in the next cell's text. Everything else that depends on the cell's edges, or on the
// cells around it, is here.

import { EditorSelection, type EditorState, type Extension, Prec } from '@codemirror/state';
import { type Command, type EditorView, keymap } from '@codemirror/view';
import { returnAtEnd as planOpenAfter } from '../blocks/edits.ts';
import { applyKeyEdit } from '../blocks/keys.ts';
import { endOf, outOfHidden, restingAfter, restingBefore, startOf } from '../blocks/motion.ts';
import { blockAt } from '../blocks/structure.ts';
import { visibleSelection } from '../tracked/decorations.ts';
import { bodyEnd, parsedField, viewModeField } from '../tracked/field.ts';
import { type Cell, type Row, type Table } from './model.ts';
import { shownCellAt } from './stops.ts';

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

/** The top of the line that holds `pos`, or null where nothing is laid out. */
function lineTop(view: EditorView, pos: number): number | null {
  return view.coordsAtPos(pos)?.top ?? null;
}

/** Whether `pos` is on the cell's first (or last) visual line. Where nothing is laid out, a cell is
 * one line. */
function onEdgeLine(view: EditorView, cell: Cell, pos: number, first: boolean): boolean {
  const mine = lineTop(view, pos);
  const edge = lineTop(view, first ? cell.textFrom : cell.textTo);
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
  const mine = view.coordsAtPos(here.head);
  const edge = view.coordsAtPos(down ? target.textFrom : target.textTo);
  if (!mine || !edge) return clamp(target.textFrom + (here.head - here.cell.textFrom), target);
  const hit = view.posAtCoords({ x: mine.left, y: (edge.top + edge.bottom) / 2 }, false);
  if (hit >= target.textFrom && hit <= target.textTo) return hit;
  // The point is in another cell, or outside the text: the stop on that side of the line.
  const line = (pos: number, forward: boolean) =>
    clamp(view.moveToLineBoundary(EditorSelection.cursor(pos), forward, true).head, target);
  const start = down ? target.textFrom : line(target.textTo, false);
  const end = down ? line(target.textFrom, true) : target.textTo;
  const at = view.coordsAtPos(start);
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
  return Prec.highest(
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
    ]),
  );
}
