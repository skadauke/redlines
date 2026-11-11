// The pointer in a table (design: tables, "The pointer"). A press in a cell's box lands in that cell:
// both engines' own hit-testing find another cell's text for a point in an empty cell, or beside a
// short text, so the cells' boxes are found first and the caret goes to the nearest place in the
// cell's own text. Double and triple press select a word and the cell's text. A drag is the text of
// the cell it started in until the pointer enters another cell of the table, and then the cells from
// the first to the one under the pointer (back in the first cell, it is text again); a shift-press
// does the same from the selection's anchor. Other modifiers are the editor's own. A drag of a
// selected rectangle moves nothing: the browser's own drag of a selection is refused for it.

import { EditorSelection, type EditorState, type Extension } from '@codemirror/state';
import { EditorView, type MouseSelectionStyle } from '@codemirror/view';
import { viewModeField } from '../tracked/field.ts';
import { rectOf } from './cells.ts';
import { type Cell, type Table, cellAt } from './model.ts';

/** A cell found under a point. */
interface Under {
  table: Table;
  cell: Cell;
}

const contains = (rect: DOMRect, x: number, y: number) =>
  rect.left <= x && x <= rect.right && rect.top <= y && y <= rect.bottom;

/** The cell whose box is under the point, or null outside every cell. */
function cellUnder(view: EditorView, x: number, y: number): Under | null {
  const wrapper = view.contentDOM.querySelectorAll<HTMLElement>('.rl-tbl');
  for (const table of wrapper) {
    // Not inside the table's box, no cell of it is.
    if (
      table.getBoundingClientRect().height > 0 &&
      !contains(table.getBoundingClientRect(), x, y)
    ) {
      continue;
    }
    for (const element of table.querySelectorAll<HTMLElement>('.rl-tc:not(.rl-tc-hidden)')) {
      if (!contains(element.getBoundingClientRect(), x, y)) continue;
      const line = element.closest<HTMLElement>('.cm-line');
      if (!line) continue;
      const found = cellAt(view.state, view.posAtDOM(line, 0));
      const col = Number(element.dataset['col']);
      const cell = found?.row.cells[col];
      if (found && cell) return { table: found.table, cell };
    }
  }
  return null;
}

const clamp = (pos: number, cell: Cell) => Math.min(Math.max(pos, cell.textFrom), cell.textTo);

/** The place in `cell`'s text nearest the point: where the text is hit, else its start or end. */
function placeIn(view: EditorView, cell: Cell, x: number, y: number): number {
  if (cell.textFrom === cell.textTo) return cell.textFrom;
  const hit = view.posAtCoords({ x, y }, false);
  return clamp(hit, cell);
}

/** The selection a press or a drag makes: in `cell`, `click` presses deep. */
function selectionIn(
  state: EditorState,
  view: EditorView,
  cell: Cell,
  anchor: number | null,
  click: number,
  x: number,
  y: number,
): EditorSelection {
  const here = placeIn(view, cell, x, y);
  if (click >= 3) return EditorSelection.single(cell.textFrom, cell.textTo);
  if (click === 2) {
    const word = state.wordAt(here);
    if (word) return EditorSelection.single(clamp(word.from, cell), clamp(word.to, cell));
    return EditorSelection.single(here);
  }
  return EditorSelection.single(anchor ?? here, here);
}

/** The selection from `anchor` to the place the pointer is at: in the cell under it when that is a
 * cell of `table`, else in `fallback`'s text (the pointer is out of the table: at the cell's edge). */
function reaching(
  view: EditorView,
  table: Table,
  anchor: number,
  fallback: Cell,
  x: number,
  y: number,
): EditorSelection {
  const over = cellUnder(view, x, y);
  if (over && over.table.id === table.id) {
    return EditorSelection.single(anchor, placeIn(view, over.cell, x, y));
  }
  return EditorSelection.single(anchor, placeIn(view, fallback, x, y));
}

/** Presses and drags in a table's cells. */
export function tableMouse(): Extension {
  return [
    EditorView.mouseSelectionStyle.of((view, event): MouseSelectionStyle | null => {
      if (event.button !== 0 || view.state.field(viewModeField, false) === 'raw') return null;
      if (event.altKey || event.metaKey || event.ctrlKey) return null;
      const first = cellUnder(view, event.clientX, event.clientY);
      if (!first) return null;
      if (event.shiftKey) {
        // Extends the selection: into another cell, cells.
        const anchor = view.state.selection.main.anchor;
        return {
          get: (current) =>
            reaching(view, first.table, anchor, first.cell, current.clientX, current.clientY),
          update: () => false,
        };
      }
      const click = Math.max(1, Math.min(3, event.detail));
      const start = selectionIn(
        view.state,
        view,
        first.cell,
        null,
        click,
        event.clientX,
        event.clientY,
      );
      const anchor = start.main.anchor;
      return {
        get(current) {
          // Inside the first cell, text; the pointer gone into another cell of the table, cells;
          // out of the table, at the edge of the first cell's text.
          if (current === event || click > 1) return start;
          return reaching(view, first.table, anchor, first.cell, current.clientX, current.clientY);
        },
        update() {
          return false;
        },
      };
    }),
    // A selected rectangle is not dragged anywhere: cells move by copy and paste.
    EditorView.domEventHandlers({
      dragstart(event, view) {
        if (!rectOf(view.state)) return false;
        event.preventDefault();
        return true;
      },
    }),
  ];
}
