// Row grips and their menu (design: tables, "Grips and +"): in a layer over the editor, hidden from
// assistive technology (the Table menu carries every command), a grip (⋮⋮) shows in the left margin
// beside the row under the pointer, left of the change bars and never off the window. It shows while
// the pointer is over the table or the strips beside it, and hides at the next keystroke. A click
// selects the row (⇧-click extends) when it is released, a right-click selects it and opens its menu,
// and a drag moves the rows (`drag.ts`) with nothing highlighted while it lasts; a + shows within 8 px
// of a row boundary (`plus.ts`). Interface text takes the theme's sizes.

import { type EditorState, type Extension } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';
import {
  alignCols,
  caretAlign,
  clearCells,
  colTitles,
  deleteCols,
  deleteRows,
  deleteTable,
  insertCols,
  insertColsAt,
  insertRows,
  insertRowsAt,
  moveCols,
  moveColsTo,
  canMoveCols,
  canMoveRows,
  moveRows,
  moveRowsTo,
  rectOf,
  rectSelection,
  rowTitles,
  selectedCells,
  tablesOf,
  touchedCols,
  touchedRows,
  type Table,
  type TableCell,
} from '@redlines/editor';
import { beginDrag, DRAG_SLOP, type Drag } from './drag.ts';
import { boundariesOf, colBoundariesOf, PLUS_REACH, plusBoundary } from './plus.ts';

/**
 * The cells a grip menu's Clear Contents clears: the rectangle the grip selected; where the selection is
 * the text of one cell, which is no rectangle (the column of a table of a header alone, the row of a
 * table of one column and a header alone), that cell.
 */
function cellsToClear(state: EditorState): readonly TableCell[] {
  const cells = selectedCells(state);
  if (cells.length > 0 || rectOf(state)) return cells;
  const { from, to } = state.selection.main;
  const all = tablesOf(state).flatMap((table) => table.rows.flatMap((row) => row.cells));
  const cell = all.find((c) => c.textFrom === from && c.textTo === to);
  return cell ? [cell] : [];
}

/** How far above a table its column handles are looked for: the strip above it. */
const COL_STRIP = 28;
/** A handle's reach, across and along its edge, in px; its pill is smaller and grows within it. */
const GRIP_REACH = 14;
const GRIP_SPAN = 26;
/** The room between a handle's reach and the table's edge. */
const GRIP_GAP = 2;
/** The widgets at the table's edges: Add column and Add row are strips this thick, 4 px from the table,
 * and the table's corner widget is a square; the pointer is looked for within `EDGE_REACH` of them. */
const EDGE_SIZE = 20;
const EDGE_GAP = 4;
const EDGE_REACH = EDGE_GAP + EDGE_SIZE + 4;
const CORNER_SIZE = 16;

export const GRIPS_STYLE = `
.rl-grips { position: absolute; inset: 0; pointer-events: none; z-index: 5; overflow: visible; }
.rl-grips > * { pointer-events: auto; }
.rl-plus, .rl-col-plus {
  position: absolute; box-sizing: border-box; display: flex; align-items: center; justify-content: center;
  width: 18px; height: 22px; border-radius: 4px; user-select: none;
  color: var(--rl-ink-3); font-size: var(--rl-size-ui); line-height: 1;
}
.rl-edge-add, .rl-table-select {
  position: absolute; box-sizing: border-box; display: flex; align-items: center; justify-content: center;
  border-radius: 4px; cursor: pointer; user-select: none; background: var(--rl-rule); color: var(--rl-ink);
  border: 1px solid transparent; font-size: var(--rl-size-ui); line-height: 1;
}
.rl-edge-add:hover, .rl-table-select:hover { border-color: var(--rl-ink-3); }
.rl-edge-col { width: ${EDGE_SIZE}px; }
.rl-edge-row { height: ${EDGE_SIZE}px; }
.rl-table-select { width: ${CORNER_SIZE}px; height: ${CORNER_SIZE}px; }
.rl-table-select::before {
  content: ''; box-sizing: border-box; width: 8px; height: 8px; border: 1.5px solid currentColor; border-radius: 2px;
  background: linear-gradient(currentColor, currentColor) center / 1.5px 100% no-repeat,
    linear-gradient(currentColor, currentColor) center / 100% 1.5px no-repeat;
}
.rl-plus:hover, .rl-col-plus:hover { background: var(--rl-rule); color: var(--rl-ink); }
.rl-plus, .rl-col-plus { cursor: pointer; border: 1px solid var(--rl-rule); background: var(--rl-page); }
/* A handle is a small pill at the table's edge: the element is its reach (wider than the pill, so it
   is easy to hit), the pill is its ::before, which grows when the pointer is over it to say it can be
   dragged. A row's and a column's are the same pill, turned. */
.rl-grip, .rl-col-grip {
  position: absolute; box-sizing: border-box; display: flex; align-items: center; justify-content: center;
  cursor: grab; user-select: none;
}
.rl-grip { width: ${GRIP_REACH}px; height: ${GRIP_SPAN}px; }
.rl-col-grip { width: ${GRIP_SPAN}px; height: ${GRIP_REACH}px; }
.rl-grip::before, .rl-col-grip::before {
  content: ''; box-sizing: border-box; border-radius: 999px; border: 1px solid var(--rl-ink-2);
  background: var(--rl-rule); transition: width 0.1s, height 0.1s, background-color 0.1s;
}
.rl-grip::before { width: 5px; height: 16px; }
.rl-col-grip::before { width: 16px; height: 5px; }
.rl-grip:hover::before, .rl-col-grip:hover::before { background: var(--rl-ink-2); }
.rl-grip:hover::before { width: 8px; height: 22px; }
.rl-col-grip:hover::before { width: 22px; height: 8px; }
.rl-grip:active, .rl-col-grip:active { cursor: grabbing; }
@media (prefers-reduced-motion: reduce) { .rl-grip::before, .rl-col-grip::before { transition: none; } }
.rl-plus-line, .rl-col-plus-line { position: absolute; height: 1px; background: var(--rl-ink-3); pointer-events: none; }
.rl-col-plus-line { width: 1px; }
.rl-drop-line { position: absolute; height: 3px; border-radius: 2px; background: var(--rl-ink-2); pointer-events: none; }
.rl-drop-line[hidden] { display: none; }
.rl-drag-copy {
  position: absolute; max-width: 320px; padding: 4px 10px; border-radius: 4px; opacity: 0.85;
  background: var(--rl-page); color: var(--rl-ink); border: 1px solid var(--rl-rule); box-shadow: 0 2px 8px rgb(0 0 0 / 0.2);
  font-size: var(--rl-size-ui); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  pointer-events: none;
}
.rl-row-dim { opacity: 0.4; }
.rl-grip-menu {
  position: absolute; min-width: 180px; padding: 4px; border-radius: 6px; background: var(--rl-page);
  color: var(--rl-ink); box-shadow: 0 4px 16px rgb(0 0 0 / 0.22); border: 1px solid var(--rl-rule);
  font-size: var(--rl-size-ui);
}
.rl-grip-hint {
  position: absolute; z-index: 6; padding: 6px 10px; border-radius: 8px; pointer-events: none;
  border: 1px solid var(--rl-rule); background: var(--rl-card); color: var(--rl-ink);
  font-size: var(--rl-size-ui-small); line-height: 1.3; white-space: nowrap; box-shadow: var(--rl-shadow);
}
.rl-grip-hint[hidden] { display: none; }
.rl-grip-item { position: relative; padding: 5px 10px 5px 24px; border-radius: 4px; cursor: default; white-space: nowrap; }
.rl-grip-item:hover { background: var(--rl-rule); }
.rl-grip-item[aria-disabled="true"] { opacity: 0.45; }
.rl-grip-item[aria-disabled="true"]:hover { background: none; }
.rl-grip-item[aria-checked="true"]::before { content: '✓'; position: absolute; left: 8px; font-size: var(--rl-size-ui); }
`;

/** The title bar's hint delay, which the app passes in (`TOOLTIP_MS`). */
const DEFAULT_TOOLTIP_MS = 400;

const STYLE_ID = 'rl-grips-style';
function installStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = GRIPS_STYLE;
  document.head.append(style);
}

/**
 * Where the row handle stands, as a `left` in the editor's box: its reach ends 2 px before the table's
 * edge, so its pill is close to the table, over the strip of the change bars (a bar is a mark on a
 * changed row, and a handle is drawn over it). It never goes off the window (4 px in).
 */
export function gripLeft(tableLeft: number, editorLeft: number): number {
  return Math.max(4, tableLeft - GRIP_GAP - GRIP_REACH) - editorLeft;
}

/** Where the + between rows stands: where the row handle's reach ends, 18 px wide and, as the handle
 * does, 2 px from the table, so that the + comes up under the pointer where the handle was. */
export function plusLeft(tableLeft: number, editorLeft: number): number {
  return Math.max(4, tableLeft - GRIP_GAP - 18) - editorLeft;
}

/** Whether the pointer is over the table's corner square, which a + at the first boundary would cover. */
function inCorner(drawn: { left: number; top: number }, x: number, y: number): boolean {
  const left = drawn.left - GRIP_GAP - CORNER_SIZE;
  const top = drawn.top - GRIP_GAP - CORNER_SIZE;
  return x >= left && x <= left + CORNER_SIZE && y >= top && y <= top + CORNER_SIZE;
}

/** How far above the table a column handle's reach begins. */
export const colGripTop = (tableTop: number): number => tableTop - GRIP_GAP - GRIP_REACH;

/** A table drawn: its id, its box and the line of each of its real rows. */
interface Drawn {
  table: Table;
  left: number;
  right: number;
  lines: HTMLElement[];
  rects: { top: number; bottom: number }[];
  /** The table's top and bottom, and each column's left and right, by the header's real cells. */
  top: number;
  bottom: number;
  cols: { left: number; right: number }[];
}

/** A row's drawn box: the union of its cells' boxes, which WebKit and Chromium agree on, where a
 * table row's own box differs between them; the line's own when it has no cells with a size. */
function rowBox(line: HTMLElement): { top: number; bottom: number } {
  const cells = [...line.querySelectorAll<HTMLElement>(':scope > .rl-tc')]
    .map((cell) => cell.getBoundingClientRect())
    .filter((box) => box.height > 0);
  if (cells.length === 0) return line.getBoundingClientRect();
  return {
    top: Math.min(...cells.map((box) => box.top)),
    bottom: Math.max(...cells.map((box) => box.bottom)),
  };
}

/**
 * What is measured of each table, kept until the state (the text, the selection, a decoration), the
 * scroll or the table's place changes: its place is its top and its left, which moves when the
 * table scrolls sideways in its box.
 */
const measured = new WeakMap<
  HTMLElement,
  { state: unknown; scroll: number; top: number; left: number; drawn: Drawn }
>();

/**
 * The tables drawn, with their rows' boxes. With `near`, only a table whose box (and the strip beside
 * it) holds the pointer is measured by its rows, the others by their box alone with no rows: the
 * pointer moves over a document, and a table of 300 rows is 900 cells to read.
 */
function drawnTables(view: EditorView, near?: { x: number; y: number }): Drawn[] {
  const tables = tablesOf(view.state);
  const drawn: Drawn[] = [];
  for (const wrapper of view.contentDOM.querySelectorAll<HTMLElement>('.rl-tbl')) {
    const table = tables.find((t) => String(t.id) === wrapper.dataset['table']);
    if (!table) continue;
    const box = wrapper.getBoundingClientRect();
    const reach = 24 + 44;
    const here =
      !near ||
      (near.x >= box.left - reach &&
        near.x <= box.right + EDGE_REACH &&
        near.y >= box.top - Math.max(PLUS_REACH, COL_STRIP) &&
        near.y <= box.bottom + Math.max(PLUS_REACH, EDGE_REACH));
    if (!here) continue;
    const known = measured.get(wrapper);
    if (
      known &&
      known.state === view.state &&
      known.scroll === view.scrollDOM.scrollTop &&
      known.top === box.top &&
      known.left === box.left &&
      known.drawn.table === table
    ) {
      drawn.push(known.drawn);
      continue;
    }
    const lines = [...wrapper.querySelectorAll<HTMLElement>(':scope > .rl-trow:not(.rl-ghost)')];
    // The columns by the header's real cells: a ghost cell between two is in the gap that is
    // their boundary.
    const cells = [
      ...(lines[0]?.querySelectorAll<HTMLElement>(':scope > .rl-tc[data-col]') ?? []),
    ].filter((cell) => Number(cell.dataset['col']) < table.columns);
    // A column is drawn between the faint lines that divide the columns, which stand half the gap
    // (the right padding of the cell before) left of each cell but the first: not over the cell's
    // box, which is that far to the right of them (#673).
    const lefts = cells.map((cell, i) => {
      const before = cells[i - 1];
      const gap = before ? (Number.parseFloat(getComputedStyle(before).paddingRight) || 0) / 2 : 0;
      return cell.getBoundingClientRect().left - gap;
    });
    const cols = cells.map((cell, i) => ({
      left: lefts[i] ?? 0,
      right: lefts[i + 1] ?? cell.getBoundingClientRect().right,
    }));
    const one: Drawn = {
      table,
      left: box.left,
      right: box.right,
      top: box.top,
      bottom: box.bottom,
      lines,
      rects: lines.map(rowBox),
      cols,
    };
    measured.set(wrapper, {
      state: view.state,
      scroll: view.scrollDOM.scrollTop,
      top: box.top,
      left: box.left,
      drawn: one,
    });
    drawn.push(one);
  }
  return drawn;
}

class Grips {
  readonly layer = document.createElement('div');
  /** The hint a grip or a + shows after a rest of the pointer, as the title bar's buttons do. */
  private readonly tip = document.createElement('div');
  private tipTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly tooltipMs: number;
  private grip: HTMLElement | null = null;
  private plus: HTMLElement | null = null;
  private plusLine: HTMLElement | null = null;
  private menu: HTMLElement | null = null;
  private at: { drawn: Drawn; row: number } | null = null;
  private boundary: { drawn: Drawn; index: number } | null = null;
  private drag: Drag | null = null;
  private press: {
    x: number;
    y: number;
    /** The row or the column pressed. */
    row: number;
    axis: 'row' | 'col';
    drawn: Drawn;
    shift: boolean;
    /** The rows (or columns) the press takes, which are selected when it is released, not before. */
    first: number;
    last: number;
  } | null = null;
  private addCol: HTMLElement | null = null;
  private addRow: HTMLElement | null = null;
  private selectAll: HTMLElement | null = null;
  /** The table the edge widgets act on. */
  private edgeOf: Drawn | null = null;
  private colGrip: HTMLElement | null = null;
  private colPlus: HTMLElement | null = null;
  private colPlusLine: HTMLElement | null = null;
  private colAt: { drawn: Drawn; col: number } | null = null;
  private colBoundary: { drawn: Drawn; index: number } | null = null;
  private readonly onMove = (event: MouseEvent) => this.moved(event);
  private readonly onLeave = (event: MouseEvent) => {
    if (!this.drag && !this.layer.contains(event.relatedTarget as Node | null)) this.hide();
  };
  private readonly onBoxScroll = (event: Event) => {
    // The editor's own scroll is heard by the plugin's observer; this is what scrolls inside it.
    if (event.target !== this.view.scrollDOM && !this.drag) this.hide();
  };
  private readonly onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && (this.drag || this.menu)) {
      event.preventDefault();
      event.stopPropagation();
      this.drag?.end(true);
      this.drag = null;
      this.press = null;
      this.closeMenu();
      return;
    }
    this.hide();
  };
  private readonly onUp = (event: MouseEvent) => this.released(event);
  private readonly onAway = (event: MouseEvent) => {
    if (this.menu && !this.menu.contains(event.target as Node)) this.closeMenu();
  };

  private readonly view: EditorView;
  /** The dragged rows' line decorations. */
  dimmed: DecorationSet = Decoration.none;

  private dim(lines: readonly HTMLElement[]): void {
    const marks = lines
      .map((line) => this.view.posAtDOM(line))
      .map((from) => Decoration.line({ class: 'rl-row-dim' }).range(from));
    this.dimmed = Decoration.set(marks, true);
    this.view.dispatch({});
  }

  constructor(view: EditorView, tooltipMs = DEFAULT_TOOLTIP_MS) {
    this.view = view;
    this.tooltipMs = tooltipMs;
    installStyle();
    this.layer.className = 'rl-grips';
    this.layer.setAttribute('aria-hidden', 'true');
    this.tip.className = 'rl-grip-hint';
    this.tip.setAttribute('role', 'tooltip');
    this.tip.hidden = true;
    this.layer.append(this.tip);
    view.dom.append(this.layer);
    view.dom.addEventListener('mousemove', this.onMove);
    view.dom.addEventListener('mouseleave', this.onLeave);
    // A table scrolls sideways in its own box, and a scroll doesn't bubble to the editor: the grip
    // would stay where the column was.
    view.dom.addEventListener('scroll', this.onBoxScroll, true);
    window.addEventListener('keydown', this.onKey, true);
    window.addEventListener('mouseup', this.onUp);
    window.addEventListener('mousedown', this.onAway, true);
  }

  update(update: ViewUpdate): void {
    if (update.docChanged || update.selectionSet) this.hide(false);
  }

  destroy(): void {
    // A drag in progress goes with the view: its timer would run on.
    this.drag?.end(true);
    this.drag = null;
    this.view.dom.removeEventListener('mousemove', this.onMove);
    this.view.dom.removeEventListener('mouseleave', this.onLeave);
    this.view.dom.removeEventListener('scroll', this.onBoxScroll, true);
    window.removeEventListener('keydown', this.onKey, true);
    window.removeEventListener('mouseup', this.onUp);
    window.removeEventListener('mousedown', this.onAway, true);
    this.layer.remove();
  }

  private local(x: number, y: number): { x: number; y: number } {
    const box = this.view.dom.getBoundingClientRect();
    return { x: x - box.left, y: y - box.top };
  }

  hide(keepMenu = true): void {
    this.hideHint();
    this.grip?.remove();
    this.plus?.remove();
    this.plusLine?.remove();
    this.grip = this.plus = this.plusLine = null;
    this.at = null;
    this.boundary = null;
    this.hideCols();
    this.hideEdges();
    if (!keepMenu) this.closeMenu();
  }

  private hideCols(): void {
    this.colGrip?.remove();
    this.colPlus?.remove();
    this.colPlusLine?.remove();
    this.colGrip = this.colPlus = this.colPlusLine = null;
    this.colAt = null;
    this.colBoundary = null;
  }

  private moved(event: MouseEvent): void {
    if (this.press && !this.drag) {
      const far = Math.hypot(event.clientX - this.press.x, event.clientY - this.press.y);
      if (far > DRAG_SLOP) {
        if (this.press.axis === 'col') this.startColDrag();
        else this.startDrag();
      }
    }
    if (this.drag) {
      this.drag.move(event.clientX, event.clientY);
      return;
    }
    if (this.menu) return;
    const tables = drawnTables(this.view, { x: event.clientX, y: event.clientY });
    this.movedOverGrips(tables, event.clientX, event.clientY);
    this.movedOverEdges(tables, event.clientX, event.clientY);
  }

  /** The row handle and the + between rows and columns, for the pointer at `x`, `y`. */
  private movedOverGrips(tables: readonly Drawn[], x: number, y: number): void {
    const viewLeft = this.view.dom.getBoundingClientRect().left;
    this.movedOverColumns(tables, x, y);
    // A boundary near the pointer, in the strip: a + there.
    for (const drawn of tables) {
      if (x > drawn.left + 12 || x < viewLeft) continue;
      let index = plusBoundary(y, boundariesOf(drawn.rects));
      // Over the corner square the + at the first boundary stands aside: a click is its.
      if (index === 0 && inCorner(drawn, x, y)) index = null;
      if (index !== null) {
        this.showPlus(drawn, index);
        this.showGrip(null);
        return;
      }
    }
    this.hidePlus();
    // The row under the pointer: over the table, or the strip beside it.
    for (const drawn of tables) {
      if (x < viewLeft || x > drawn.right) continue;
      const row = drawn.rects.findIndex((rect) => y >= rect.top && y < rect.bottom);
      if (row !== -1) {
        this.showGrip({ drawn, row });
        return;
      }
    }
    this.showGrip(null);
  }

  /** The strip above a table: its column grip, and a + within 8 px of a column boundary. The grip
   * shows while the pointer is over the table or the strip above it, and stays in that strip. */
  private movedOverColumns(tables: readonly Drawn[], x: number, y: number): void {
    for (const drawn of tables) {
      const inStrip = y >= drawn.top - COL_STRIP && y <= drawn.top + PLUS_REACH;
      const over = y >= drawn.top - COL_STRIP && y <= drawn.bottom;
      if (!over || x < drawn.left || x > drawn.right) continue;
      const edges = colBoundariesOf(drawn.cols);
      let boundary = inStrip ? plusBoundary(x, edges) : null;
      if (boundary === 0 && inCorner(drawn, x, y)) boundary = null;
      if (boundary !== null) {
        this.showColPlus(drawn, boundary);
        this.colGrip?.remove();
        this.colGrip = null;
        this.colAt = null;
        return;
      }
      this.hideColPlus();
      const col = drawn.cols.findIndex((rect) => x >= rect.left && x < rect.right);
      if (col !== -1) {
        this.showColGrip({ drawn, col });
        return;
      }
    }
    this.hideCols();
  }

  /**
   * The widgets at the table's edges: Add column, just right of the table, while the pointer is over
   * its rightmost column (or the widget); Add row, just below, while it is over the bottom row; and
   * the corner square that selects the table, while it is over the table or the strips beside it
   * (not while a + stands where the square would).
   */
  private movedOverEdges(tables: readonly Drawn[], x: number, y: number): void {
    for (const drawn of tables) {
      const lastCol = drawn.cols[drawn.cols.length - 1];
      const lastRow = drawn.rects[drawn.rects.length - 1];
      const inColumns = x >= drawn.left && x <= drawn.right;
      const inRows = y >= drawn.top && y <= drawn.bottom;
      const col = !!lastCol && inRows && x >= lastCol.left && x <= drawn.right + EDGE_REACH;
      // Not where the next table's own strip above it is: Add row would cover its handles.
      const crowded = [...this.view.contentDOM.querySelectorAll<HTMLElement>('.rl-tbl')].some(
        (el) => {
          const top = el.getBoundingClientRect().top;
          return top > drawn.bottom && top - COL_STRIP < drawn.bottom + EDGE_REACH;
        },
      );
      const row =
        !crowded && !!lastRow && inColumns && y >= lastRow.top && y <= drawn.bottom + EDGE_REACH;
      const corner =
        x >= drawn.left - 24 && x <= drawn.right && y >= drawn.top - COL_STRIP && y <= drawn.bottom;
      if (!col && !row && !corner) continue;
      this.edgeOf = drawn;
      this.showEdge('addCol', col);
      this.showEdge('addRow', row);
      // The + at a table's first boundary stands where the square is; the others don't.
      const covered = this.boundary?.index === 0 || this.colBoundary?.index === 0;
      this.showEdge('selectAll', corner && !covered);
      return;
    }
    this.hideEdges();
  }

  private hideEdges(): void {
    this.addCol?.remove();
    this.addRow?.remove();
    this.selectAll?.remove();
    this.addCol = this.addRow = this.selectAll = null;
    this.edgeOf = null;
  }

  /** Shows (or takes away) one of the edge widgets, at the edge of the table `edgeOf`. */
  private showEdge(which: 'addCol' | 'addRow' | 'selectAll', on: boolean): void {
    const drawn = this.edgeOf;
    if (!on || !drawn) {
      this[which]?.remove();
      this[which] = null;
      return;
    }
    let el = this[which];
    if (!el) {
      el = document.createElement('div');
      if (which === 'selectAll') {
        el.className = 'rl-table-select';
        this.hint(el, 'Select the table');
      } else {
        el.className = `rl-edge-add ${which === 'addCol' ? 'rl-edge-col' : 'rl-edge-row'}`;
        el.textContent = '+';
        this.hint(el, which === 'addCol' ? 'Add a column' : 'Add a row');
      }
      el.addEventListener('mousedown', (event) => {
        event.preventDefault();
        // A Control-click is a right-click on a Mac: no insertion.
        if (event.button !== 0 || event.ctrlKey) return;
        const at = this.edgeOf;
        if (!at) return;
        const table = tablesOf(this.view.state).find((t) => t.id === at.table.id) ?? at.table;
        if (which === 'addCol') insertColsAt(this.view, table, table.columns);
        else if (which === 'addRow') insertRowsAt(this.view, table, table.rows.length);
        else {
          const selection = rectSelection(
            table,
            { row: 0, col: 0 },
            { row: table.rows.length - 1, col: table.columns - 1 },
          );
          if (selection) this.view.dispatch({ selection, userEvent: 'select' });
        }
        this.hide();
      });
      this.layer.append(el);
      this[which] = el;
    }
    const base = this.view.dom.getBoundingClientRect();
    if (which === 'addCol') {
      // Just right of the table, as tall as it, and never off the window.
      // At the table's edge, or at its box's when the table scrolls sideways and its end is out of view.
      const clipBox = drawn.lines[0]?.closest('.rl-tbl-scroll')?.getBoundingClientRect();
      const right =
        clipBox && clipBox.width > 0 ? Math.min(drawn.right, clipBox.right) : drawn.right;
      const left = Math.min(right + EDGE_GAP, base.right - EDGE_SIZE - 4);
      el.style.left = `${left - base.left}px`;
      el.style.top = `${drawn.top - base.top}px`;
      el.style.height = `${Math.max(0, drawn.bottom - drawn.top)}px`;
    } else if (which === 'addRow') {
      el.style.left = `${drawn.left - base.left}px`;
      el.style.top = `${drawn.bottom + EDGE_GAP - base.top}px`;
      el.style.width = `${Math.max(0, drawn.right - drawn.left)}px`;
    } else {
      el.style.left = `${Math.max(4, drawn.left - GRIP_GAP - CORNER_SIZE) - base.left}px`;
      el.style.top = `${Math.max(4, drawn.top - GRIP_GAP - CORNER_SIZE) - base.top}px`;
    }
  }

  private hideColPlus(): void {
    this.colPlus?.remove();
    this.colPlusLine?.remove();
    this.colPlus = this.colPlusLine = null;
    this.colBoundary = null;
  }

  /** Gives a grip or a + its hint: shown after the pointer rests on it, gone when it leaves or presses. */
  private hint(el: HTMLElement, text: string): void {
    el.setAttribute('aria-label', text);
    el.addEventListener('mouseenter', () => {
      clearTimeout(this.tipTimer);
      // A drag or an open menu has the pointer's attention.
      if (this.drag || this.menu) return;
      this.tipTimer = setTimeout(() => {
        // The grip may have gone since the pointer came (hiding doesn't say mouseleave).
        if (!el.isConnected) return;
        const base = this.view.dom.getBoundingClientRect();
        const box = el.getBoundingClientRect();
        this.tip.textContent = text;
        this.tip.hidden = false;
        const room = base.width - this.tip.offsetWidth - 4;
        this.tip.style.left = `${Math.max(4, Math.min(box.left - base.left, room))}px`;
        this.tip.style.top = `${box.bottom - base.top + 6}px`;
      }, this.tooltipMs);
    });
    const hide = () => this.hideHint();
    el.addEventListener('mouseleave', hide);
    el.addEventListener('mousedown', hide);
  }

  private hideHint(): void {
    clearTimeout(this.tipTimer);
    this.tip.hidden = true;
  }

  private showColGrip(at: { drawn: Drawn; col: number }): void {
    this.colAt = at;
    const rect = at.drawn.cols[at.col];
    if (!rect) return;
    const grip = this.colGrip ?? document.createElement('div');
    if (!this.colGrip) {
      grip.className = 'rl-col-grip';
      grip.addEventListener('mousedown', (event) => this.pressedCol(event));
      grip.addEventListener('contextmenu', (event) => this.menuOf(event, 'col'));
      this.hint(grip, 'Drag to move the column, right-click for its menu');
      this.layer.append(grip);
      this.colGrip = grip;
    }
    const base = this.view.dom.getBoundingClientRect();
    // Above the column, just over the table's edge, and never above the window's top.
    const span = Math.max(8, Math.min(GRIP_SPAN, rect.right - rect.left));
    const centered = rect.left + (rect.right - rect.left - span) / 2 - base.left;
    grip.style.width = `${span}px`;
    grip.style.left = `${Math.max(4, Math.min(centered, base.width - span - 4))}px`;
    grip.style.top = `${Math.max(4 - base.top, colGripTop(at.drawn.top) - base.top)}px`;
    grip.dataset['col'] = String(at.col);
  }

  private showColPlus(drawn: Drawn, index: number): void {
    this.colBoundary = { drawn, index };
    const edges = colBoundariesOf(drawn.cols);
    const x = edges[index] ?? 0;
    const base = this.view.dom.getBoundingClientRect();
    if (!this.colPlus) {
      const plus = document.createElement('div');
      plus.className = 'rl-col-plus';
      plus.textContent = '+';
      this.hint(plus, 'Add a column');
      plus.addEventListener('mousedown', (event) => {
        event.preventDefault();
        const at = this.colBoundary;
        if (!at) return;
        insertColsAt(this.view, at.drawn.table, at.index);
        this.hide();
      });
      const line = document.createElement('div');
      line.className = 'rl-col-plus-line';
      this.layer.append(line, plus);
      this.colPlus = plus;
      this.colPlusLine = line;
    }
    this.colPlus.style.left = `${x - 9 - base.left}px`;
    this.colPlus.style.top = `${Math.max(4 - base.top, drawn.top - COL_STRIP + 2 - base.top)}px`;
    if (this.colPlusLine) {
      this.colPlusLine.style.left = `${x - base.left}px`;
      this.colPlusLine.style.top = `${drawn.top - base.top}px`;
      this.colPlusLine.style.height = `${Math.max(0, drawn.bottom - drawn.top)}px`;
    }
    this.colPlus.dataset['boundary'] = String(index);
  }

  /** A press on a column grip: it takes the column (⇧ extends), which is selected when the press is
   * released, or moved when it becomes a drag. */
  private pressedCol(event: MouseEvent): void {
    event.preventDefault();
    const at = this.colAt;
    if (!at || event.button !== 0) return;
    this.closeMenu();
    const { first, last } = this.spanOf('col', at.drawn, at.col, event.shiftKey);
    this.press = {
      x: event.clientX,
      y: event.clientY,
      row: at.col,
      axis: 'col',
      drawn: at.drawn,
      shift: event.shiftKey,
      first,
      last,
    };
  }

  /** The rows (or columns) a press on the grip of `index` takes: the one, those from the selection to
   * it with ⇧, or all that are selected when it is one of them (they are dragged together). */
  private spanOf(
    axis: 'row' | 'col',
    drawn: Drawn,
    index: number,
    shift: boolean,
  ): { first: number; last: number } {
    const touched = axis === 'col' ? touchedCols(this.view.state) : touchedRows(this.view.state);
    if (!touched || touched.table.id !== drawn.table.id) return { first: index, last: index };
    if (shift) {
      return { first: Math.min(touched.first, index), last: Math.max(touched.last, index) };
    }
    if (touched.rectangle && index >= touched.first && index <= touched.last) {
      return { first: touched.first, last: touched.last };
    }
    return { first: index, last: index };
  }

  /** A right-click on a grip: its row or column is selected, and the menu opens at the pointer. */
  private menuOf(event: MouseEvent, axis: 'row' | 'col'): void {
    event.preventDefault();
    // A Control-click is a press and a right-click: the press is no drag or click now.
    this.press = null;
    const at = axis === 'col' ? this.colAt : this.at;
    if (!at) return;
    const index = 'col' in at ? at.col : at.row;
    const { first, last } = this.spanOf(axis, at.drawn, index, event.shiftKey);
    this.closeMenu();
    this.select(axis, at.drawn.table, first, last);
    this.openMenu(event.clientX, event.clientY, { row: index, axis, drawn: at.drawn });
  }

  private select(axis: 'row' | 'col', table: Table, first: number, last: number): void {
    if (axis === 'col') this.selectCols(table, first, last);
    else this.selectRows(table, first, last);
  }

  /** The selection is a caret while a drag lasts: the cells are highlighted after a click and its
   * release, never during a drag. */
  private clearHighlight(): void {
    const { state } = this.view;
    if (state.selection.ranges.length === 1 && state.selection.main.empty && !rectOf(state)) return;
    this.view.dispatch({ selection: { anchor: state.selection.main.head }, userEvent: 'select' });
  }

  private selectCols(table: Table, first: number, last: number): void {
    const current = tablesOf(this.view.state).find((t) => t.id === table.id) ?? table;
    const selection = rectSelection(
      current,
      { row: 0, col: first },
      { row: current.rows.length - 1, col: last },
    );
    if (selection) this.view.dispatch({ selection, userEvent: 'select' });
  }

  private startColDrag(): void {
    const press = this.press;
    if (!press) return;
    const touched = { table: press.drawn.table, first: press.first, last: press.last };
    const { drawn } = press;
    this.clearHighlight();
    const now = () => drawnTables(this.view).find((d) => d.table.id === drawn.table.id) ?? drawn;
    this.drag = beginDrag({
      view: this.view,
      axis: 'col',
      moving: touched,
      // The dragged columns dim: their cells carry a class by decoration.
      dim: (on) => this.dimCols(on ? touched : null),
      boundaries: () => colBoundariesOf(now().cols),
      table: () => {
        const box = now();
        return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
      },
      scroller: () =>
        this.view.contentDOM.querySelector<HTMLElement>(`.rl-tbl[data-table="${drawn.table.id}"]`)
          ?.parentElement ?? null,
      layer: this.layer,
      label: (now().lines[0]?.querySelectorAll(':scope > .rl-tc')[touched.first]?.textContent ?? '')
        .replace(/\s+/g, ' ')
        .trim(),
    });
    this.hide();
  }

  /** Dims the cells of the dragged columns, by decoration. */
  private dimCols(touched: { table: Table; first: number; last: number } | null): void {
    if (!touched) {
      this.dimmed = Decoration.none;
      this.view.dispatch({});
      return;
    }
    const table = tablesOf(this.view.state).find((t) => t.id === touched.table.id);
    const marks = (table?.rows ?? []).flatMap((row) =>
      row.cells
        .filter((cell) => cell.col >= touched.first && cell.col <= touched.last)
        .filter((cell) => cell.to > cell.from)
        .map((cell) => Decoration.mark({ class: 'rl-row-dim' }).range(cell.from, cell.to)),
    );
    this.dimmed = Decoration.set(marks, true);
    this.view.dispatch({});
  }

  private hidePlus(): void {
    this.plus?.remove();
    this.plusLine?.remove();
    this.plus = this.plusLine = null;
    this.boundary = null;
  }

  private showGrip(at: { drawn: Drawn; row: number } | null): void {
    if (!at) {
      this.grip?.remove();
      this.grip = null;
      this.at = null;
      return;
    }
    this.at = at;
    const rect = at.drawn.rects[at.row];
    if (!rect) return;
    const grip = this.grip ?? document.createElement('div');
    if (!this.grip) {
      grip.className = 'rl-grip';
      grip.addEventListener('mousedown', (event) => this.pressed(event));
      grip.addEventListener('contextmenu', (event) => this.menuOf(event, 'row'));
      this.hint(grip, 'Drag to move the row, right-click for its menu');
      this.layer.append(grip);
      this.grip = grip;
    }
    const base = this.view.dom.getBoundingClientRect();
    const left = gripLeft(at.drawn.left, base.left);
    // As tall as its row when the row is shorter than the usual reach, so it never stands over the next.
    const span = Math.max(8, Math.min(GRIP_SPAN, rect.bottom - rect.top));
    grip.style.left = `${left}px`;
    grip.style.height = `${span}px`;
    grip.style.top = `${rect.top + (rect.bottom - rect.top - span) / 2 - base.top}px`;
    grip.dataset['row'] = String(at.row);
  }

  private showPlus(drawn: Drawn, index: number): void {
    this.boundary = { drawn, index };
    const edges = boundariesOf(drawn.rects);
    const y = edges[index] ?? 0;
    const base = this.view.dom.getBoundingClientRect();
    if (!this.plus) {
      const plus = document.createElement('div');
      plus.className = 'rl-plus';
      plus.textContent = '+';
      this.hint(plus, 'Add a row');
      plus.addEventListener('mousedown', (event) => {
        event.preventDefault();
        const at = this.boundary;
        if (!at) return;
        insertRowsAt(this.view, at.drawn.table, at.index);
        this.hide();
      });
      const line = document.createElement('div');
      line.className = 'rl-plus-line';
      this.layer.append(line, plus);
      this.plus = plus;
      this.plusLine = line;
    }
    this.plus.style.left = `${plusLeft(drawn.left, base.left)}px`;
    this.plus.style.top = `${y - 11 - base.top}px`;
    if (this.plusLine) {
      this.plusLine.style.left = `${drawn.left - base.left}px`;
      this.plusLine.style.width = `${Math.max(0, drawn.right - drawn.left)}px`;
      this.plusLine.style.top = `${y - base.top}px`;
    }
    this.plus.dataset['boundary'] = String(index);
  }

  /** A press on the grip: it takes the row (⇧ extends), which is selected when the press is released,
   * or moved when it becomes a drag. */
  private pressed(event: MouseEvent): void {
    event.preventDefault();
    const at = this.at;
    if (!at || event.button !== 0) return;
    this.closeMenu();
    const { first, last } = this.spanOf('row', at.drawn, at.row, event.shiftKey);
    this.press = {
      x: event.clientX,
      y: event.clientY,
      row: at.row,
      axis: 'row',
      drawn: at.drawn,
      shift: event.shiftKey,
      first,
      last,
    };
  }

  private selectRows(table: Table, first: number, last: number): void {
    const current = tablesOf(this.view.state).find((t) => t.id === table.id) ?? table;
    // Whole rows, to the table's last column: a last row that is shorter than an earlier one must not
    // narrow the rectangle (#455), and a row that lacks cells ends early (a range can't name a corner in a column the end rows lack).
    const selection = rectSelection(
      current,
      { row: first, col: 0 },
      { row: last, col: current.columns - 1 },
    );
    if (selection) this.view.dispatch({ selection, userEvent: 'select' });
  }

  private startDrag(): void {
    const press = this.press;
    if (!press) return;
    const touched = { table: press.drawn.table, first: press.first, last: press.last };
    const { drawn } = press;
    this.clearHighlight();
    const linesNow = () => {
      const now = drawnTables(this.view).find((d) => d.table.id === drawn.table.id) ?? drawn;
      return now.lines.slice(touched.first, touched.last + 1);
    };
    this.drag = beginDrag({
      view: this.view,
      moving: touched,
      dim: (on) => this.dim(on ? linesNow() : []),
      boundaries: () =>
        boundariesOf(
          drawnTables(this.view).find((d) => d.table.id === drawn.table.id)?.rects ?? drawn.rects,
        ),
      table: () => {
        const now = drawnTables(this.view).find((d) => d.table.id === drawn.table.id) ?? drawn;
        return { left: now.left, right: now.right };
      },
      layer: this.layer,
      label: [...(linesNow()[0]?.querySelectorAll(':scope > .rl-tc') ?? [])]
        .map((cell) => (cell.textContent ?? '').replace(/\s+/g, ' ').trim())
        .join(' · '),
    });
    this.hide();
  }

  private released(event: MouseEvent): void {
    const press = this.press;
    if (!press) return;
    this.press = null;
    const { axis, first, last } = press;
    const table = press.drawn.table;
    let boundary: number | null = null;
    if (this.drag) {
      this.drag.move(event.clientX, event.clientY);
      const own = this.drag.atOwn();
      const dropped = this.drag.end();
      boundary = own ? null : dropped;
      this.drag = null;
    }
    // The cells are highlighted now, after the release (a drop's move selects what it moved again).
    this.select(axis, table, first, last);
    if (boundary === null) return;
    if (axis === 'col') {
      const cols = touchedCols(this.view.state);
      if (cols) {
        moveColsTo(
          this.view,
          cols.table,
          cols.first,
          cols.last,
          boundary,
          cols.rectangle,
          cols.row,
        );
      }
      return;
    }
    const touched = touchedRows(this.view.state);
    if (touched) {
      moveRowsTo(
        this.view,
        touched.table,
        touched.first,
        touched.last,
        boundary,
        touched.rectangle,
      );
    }
  }

  private openMenu(
    x: number,
    y: number,
    press: { row: number; axis: 'row' | 'col'; drawn: Drawn },
  ): void {
    const { state } = this.view;
    const now = caretAlign(state);
    // The last is the reason the item is disabled, when it is.
    const items: [string, () => boolean, boolean?, string?][] =
      press.axis === 'col'
        ? [
            [colTitles.insertLeft(state), () => insertCols(this.view, true)],
            [colTitles.insertRight(state), () => insertCols(this.view, false)],
            [colTitles.delete(state), () => deleteCols(this.view)],
            ['Delete Table', () => deleteTable(this.view)],
            [
              colTitles.moveLeft(state),
              () => moveCols(this.view, true),
              undefined,
              canMoveCols(state, true) ? undefined : 'The column is at the left.',
            ],
            [
              colTitles.moveRight(state),
              () => moveCols(this.view, false),
              undefined,
              canMoveCols(state, false) ? undefined : 'The column is at the right.',
            ],
            // The columns' alignment, the caret's column checked.
            ['Align Left', () => alignCols(this.view, 'left'), now === 'left'],
            ['Align Center', () => alignCols(this.view, 'center'), now === 'center'],
            ['Align Right', () => alignCols(this.view, 'right'), now === 'right'],
            ['Default Alignment', () => alignCols(this.view, ''), now === ''],
            ['Clear Contents', () => clearCells(this.view, cellsToClear(state))],
          ]
        : [
            [rowTitles.insertAbove(state), () => insertRows(this.view, true)],
            [rowTitles.insertBelow(state), () => insertRows(this.view, false)],
            [rowTitles.delete(state), () => deleteRows(this.view)],
            ['Delete Table', () => deleteTable(this.view)],
            [
              rowTitles.moveUp(state),
              () => moveRows(this.view, true),
              undefined,
              canMoveRows(state, true) ? undefined : 'The row is at the top.',
            ],
            [
              rowTitles.moveDown(state),
              () => moveRows(this.view, false),
              undefined,
              canMoveRows(state, false) ? undefined : 'The row is at the bottom.',
            ],
            ['Clear Contents', () => clearCells(this.view, cellsToClear(state))],
          ];
    const menu = document.createElement('div');
    menu.className = 'rl-grip-menu';
    menu.setAttribute('role', 'menu');
    for (const [title, run, checked, why] of items) {
      const item = document.createElement('div');
      item.className = 'rl-grip-item';
      // An item that says what the selection has is a check mark: the role says it to assistive technology.
      item.setAttribute('role', checked === undefined ? 'menuitem' : 'menuitemradio');
      if (checked !== undefined) item.setAttribute('aria-checked', String(checked));
      item.textContent = title;
      if (why) {
        // Disabled: it stays in the menu, says why, and a click leaves the menu open.
        item.setAttribute('aria-disabled', 'true');
        item.title = why;
      }
      item.addEventListener('mousedown', (event) => {
        event.preventDefault();
        if (why) return;
        this.closeMenu();
        run();
      });
      menu.append(item);
    }
    const base = this.view.dom.getBoundingClientRect();
    const rect = press.drawn.rects[press.row];
    menu.style.left = `${Math.max(4, x - base.left)}px`;
    menu.style.top =
      press.axis === 'col'
        ? `${press.drawn.top - base.top + 2}px`
        : `${(rect?.bottom ?? y) - base.top + 2}px`;
    this.layer.append(menu);
    this.menu = menu;
  }

  closeMenu(): void {
    this.menu?.remove();
    this.menu = null;
  }
}

/** The row and column grips, the + between rows and columns and the dragging of both, for the tables plugin. */
export function tableGrips(options: { tooltipMs?: number } = {}): Extension {
  const plugin = ViewPlugin.define((view) => new Grips(view, options.tooltipMs));
  return [
    plugin,
    // The page scrolls under a grip: it goes (the editor takes this listener away with the view).
    EditorView.domEventObservers({ scroll: (_event, view) => view.plugin(plugin)?.hide() }),
    EditorView.decorations.of((view) => view.plugin(plugin)?.dimmed ?? Decoration.none),
  ];
}
