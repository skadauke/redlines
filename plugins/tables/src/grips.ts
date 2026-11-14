// Row grips and their menu (design: tables, "Grips and +"): in a layer over the editor, hidden from
// assistive technology (the Table menu carries every command), a grip (⋮⋮) shows in the left margin
// beside the row under the pointer, left of the change bars and never off the window. It shows while
// the pointer is over the table or the strips beside it, and hides at the next keystroke. A press
// selects the row (⇧-press extends) and opens its menu; a drag moves the rows (`drag.ts`); a + shows
// within 8 px of a row boundary (`plus.ts`). Interface text takes the theme's sizes.

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

/** How far above a table its column grips stand: the strip above it. */
const COL_STRIP = 28;

export const GRIPS_STYLE = `
.rl-grips { position: absolute; inset: 0; pointer-events: none; z-index: 5; overflow: visible; }
.rl-grips > * { pointer-events: auto; }
.rl-grip, .rl-plus, .rl-col-grip, .rl-col-plus {
  position: absolute; box-sizing: border-box; display: flex; align-items: center; justify-content: center;
  width: 18px; height: 22px; border-radius: 4px; cursor: grab; user-select: none;
  color: var(--rl-ink-3); font-size: var(--rl-size-ui); line-height: 1; letter-spacing: -2px;
}
.rl-grip:hover, .rl-plus:hover, .rl-col-grip:hover, .rl-col-plus:hover { background: var(--rl-rule); color: var(--rl-ink); }
.rl-plus, .rl-col-plus { cursor: pointer; letter-spacing: 0; border: 1px solid var(--rl-rule); background: var(--rl-paper); }
.rl-plus-line, .rl-col-plus-line { position: absolute; height: 1px; background: var(--rl-ink-3); pointer-events: none; }
.rl-col-plus-line { width: 1px; }
.rl-col-grip { width: 22px; height: 18px; cursor: grab; letter-spacing: 0; }
.rl-drop-line { position: absolute; height: 2px; background: var(--rl-ink); pointer-events: none; }
.rl-drag-copy {
  position: absolute; max-width: 320px; padding: 4px 10px; border-radius: 4px; opacity: 0.85;
  background: var(--rl-paper); color: var(--rl-ink); box-shadow: 0 2px 8px rgb(0 0 0 / 0.2);
  font-size: var(--rl-size-ui); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  pointer-events: none;
}
.rl-row-dim { opacity: 0.4; }
.rl-grip-menu {
  position: absolute; min-width: 180px; padding: 4px; border-radius: 6px; background: var(--rl-paper);
  color: var(--rl-ink); box-shadow: 0 4px 16px rgb(0 0 0 / 0.22); border: 1px solid var(--rl-rule);
  font-size: var(--rl-size-ui);
}
.rl-grip-item { position: relative; padding: 5px 10px 5px 24px; border-radius: 4px; cursor: default; white-space: nowrap; }
.rl-grip-item:hover { background: var(--rl-rule); }
.rl-grip-item[aria-checked="true"]::before { content: '✓'; position: absolute; left: 8px; font-size: var(--rl-size-ui); }
`;

const STYLE_ID = 'rl-grips-style';
function installStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = GRIPS_STYLE;
  document.head.append(style);
}

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
        near.x <= box.right &&
        near.y >= box.top - Math.max(PLUS_REACH, COL_STRIP) &&
        near.y <= box.bottom + PLUS_REACH);
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
    const cols = [...(lines[0]?.querySelectorAll<HTMLElement>(':scope > .rl-tc[data-col]') ?? [])]
      .filter((cell) => Number(cell.dataset['col']) < table.columns)
      .map((cell) => cell.getBoundingClientRect())
      .map((rect) => ({ left: rect.left, right: rect.right }));
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
  } | null = null;
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

  constructor(view: EditorView) {
    this.view = view;
    installStyle();
    this.layer.className = 'rl-grips';
    this.layer.setAttribute('aria-hidden', 'true');
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
    this.grip?.remove();
    this.plus?.remove();
    this.plusLine?.remove();
    this.grip = this.plus = this.plusLine = null;
    this.at = null;
    this.boundary = null;
    this.hideCols();
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
    const viewLeft = this.view.dom.getBoundingClientRect().left;
    const { clientX: x, clientY: y } = event;
    this.movedOverColumns(tables, x, y);
    // A boundary near the pointer, in the strip: a + there.
    for (const drawn of tables) {
      if (x > drawn.left + 12 || x < viewLeft) continue;
      const index = plusBoundary(y, boundariesOf(drawn.rects));
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
      const boundary = inStrip ? plusBoundary(x, edges) : null;
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

  private hideColPlus(): void {
    this.colPlus?.remove();
    this.colPlusLine?.remove();
    this.colPlus = this.colPlusLine = null;
    this.colBoundary = null;
  }

  private showColGrip(at: { drawn: Drawn; col: number }): void {
    this.colAt = at;
    const rect = at.drawn.cols[at.col];
    if (!rect) return;
    const grip = this.colGrip ?? document.createElement('div');
    if (!this.colGrip) {
      grip.className = 'rl-col-grip';
      grip.textContent = '⋯';
      grip.addEventListener('mousedown', (event) => this.pressedCol(event));
      this.layer.append(grip);
      this.colGrip = grip;
    }
    const base = this.view.dom.getBoundingClientRect();
    // Above the column, in the strip above the table, and never above the window's top.
    grip.style.left = `${rect.left + (rect.right - rect.left - 22) / 2 - base.left}px`;
    grip.style.top = `${Math.max(4 - base.top, at.drawn.top - COL_STRIP + 2 - base.top)}px`;
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

  /** A press on a column grip: the column is selected (⇧ extends), and the menu opens when it is
   * released. */
  private pressedCol(event: MouseEvent): void {
    event.preventDefault();
    const at = this.colAt;
    if (!at || event.button !== 0) return;
    this.closeMenu();
    const { table } = at.drawn;
    const touched = touchedCols(this.view.state);
    let first = at.col;
    let last = at.col;
    if (event.shiftKey && touched && touched.table.id === table.id) {
      first = Math.min(touched.first, at.col);
      last = Math.max(touched.last, at.col);
    } else if (
      touched?.rectangle &&
      touched.table.id === table.id &&
      at.col >= touched.first &&
      at.col <= touched.last
    ) {
      first = touched.first;
      last = touched.last;
    }
    this.selectCols(table, first, last);
    this.press = {
      x: event.clientX,
      y: event.clientY,
      row: at.col,
      axis: 'col',
      drawn: at.drawn,
      shift: event.shiftKey,
    };
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
    const touched = touchedCols(this.view.state);
    if (!touched) return;
    const { drawn } = press;
    const now = () => drawnTables(this.view).find((d) => d.table.id === drawn.table.id) ?? drawn;
    this.drag = beginDrag({
      view: this.view,
      axis: 'col',
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
      grip.textContent = '⋮⋮';
      grip.addEventListener('mousedown', (event) => this.pressed(event));
      this.layer.append(grip);
      this.grip = grip;
    }
    const base = this.view.dom.getBoundingClientRect();
    // Left of the change bars (24 px left of the column), and never off the window.
    const left = Math.max(4 - base.left, at.drawn.left - 24 - 4 - 18 - base.left);
    grip.style.left = `${left}px`;
    grip.style.top = `${rect.top + (rect.bottom - rect.top - 22) / 2 - base.top}px`;
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
    const left = Math.max(4 - base.left, drawn.left - 24 - 4 - 18 - base.left);
    this.plus.style.left = `${left}px`;
    this.plus.style.top = `${y - 11 - base.top}px`;
    if (this.plusLine) {
      this.plusLine.style.left = `${drawn.left - base.left}px`;
      this.plusLine.style.width = `${Math.max(0, drawn.right - drawn.left)}px`;
      this.plusLine.style.top = `${y - base.top}px`;
    }
    this.plus.dataset['boundary'] = String(index);
  }

  /** A press on the grip: the row is selected (⇧ extends), and the menu opens when it is released. */
  private pressed(event: MouseEvent): void {
    event.preventDefault();
    const at = this.at;
    if (!at || event.button !== 0) return;
    this.closeMenu();
    const { table } = at.drawn;
    const touched = touchedRows(this.view.state);
    let first = at.row;
    let last = at.row;
    if (event.shiftKey && touched && touched.table.id === table.id) {
      first = Math.min(touched.first, at.row);
      last = Math.max(touched.last, at.row);
    } else if (
      touched?.rectangle &&
      touched.table.id === table.id &&
      at.row >= touched.first &&
      at.row <= touched.last
    ) {
      // A press on a grip of a row that is selected drags the rows selected with it.
      first = touched.first;
      last = touched.last;
    }
    this.selectRows(table, first, last);
    this.press = {
      x: event.clientX,
      y: event.clientY,
      row: at.row,
      axis: 'row',
      drawn: at.drawn,
      shift: event.shiftKey,
    };
  }

  private selectRows(table: Table, first: number, last: number): void {
    const current = tablesOf(this.view.state).find((t) => t.id === table.id) ?? table;
    const end = Math.max(0, (current.rows[last]?.cells.length ?? 1) - 1);
    const selection = rectSelection(current, { row: first, col: 0 }, { row: last, col: end });
    if (selection) this.view.dispatch({ selection, userEvent: 'select' });
  }

  private startDrag(): void {
    const press = this.press;
    if (!press) return;
    const touched = touchedRows(this.view.state);
    if (!touched) return;
    const { drawn } = press;
    const linesNow = () => {
      const now = drawnTables(this.view).find((d) => d.table.id === drawn.table.id) ?? drawn;
      return now.lines.slice(touched.first, touched.last + 1);
    };
    this.drag = beginDrag({
      view: this.view,
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
      label: (linesNow()[0]?.textContent ?? '').replace(/\s+/g, ' ').trim(),
    });
    this.hide();
  }

  private released(event: MouseEvent): void {
    const press = this.press;
    if (!press) return;
    this.press = null;
    if (this.drag) {
      this.drag.move(event.clientX, event.clientY);
      const boundary = this.drag.end();
      this.drag = null;
      if (press.axis === 'col') {
        const cols = touchedCols(this.view.state);
        if (boundary !== null && cols) {
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
      if (boundary !== null && touched) {
        moveRowsTo(
          this.view,
          touched.table,
          touched.first,
          touched.last,
          boundary,
          touched.rectangle,
        );
      }
      return;
    }
    this.openMenu(event.clientX, event.clientY, press);
  }

  private openMenu(
    x: number,
    y: number,
    press: { row: number; axis: 'row' | 'col'; drawn: Drawn },
  ): void {
    const { state } = this.view;
    const now = caretAlign(state);
    const items: [string, () => boolean, boolean?][] =
      press.axis === 'col'
        ? [
            [colTitles.insertLeft(state), () => insertCols(this.view, true)],
            [colTitles.insertRight(state), () => insertCols(this.view, false)],
            [colTitles.delete(state), () => deleteCols(this.view)],
            ['Delete Table', () => deleteTable(this.view)],
            [colTitles.moveLeft(state), () => moveCols(this.view, true)],
            [colTitles.moveRight(state), () => moveCols(this.view, false)],
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
            [rowTitles.moveUp(state), () => moveRows(this.view, true)],
            [rowTitles.moveDown(state), () => moveRows(this.view, false)],
            ['Clear Contents', () => clearCells(this.view, cellsToClear(state))],
          ];
    const menu = document.createElement('div');
    menu.className = 'rl-grip-menu';
    menu.setAttribute('role', 'menu');
    for (const [title, run, checked] of items) {
      const item = document.createElement('div');
      item.className = 'rl-grip-item';
      // An item that says what the selection has is a check mark: the role says it to assistive technology.
      item.setAttribute('role', checked === undefined ? 'menuitem' : 'menuitemradio');
      if (checked !== undefined) item.setAttribute('aria-checked', String(checked));
      item.textContent = title;
      item.addEventListener('mousedown', (event) => {
        event.preventDefault();
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
export function tableGrips(): Extension {
  const plugin = ViewPlugin.fromClass(Grips);
  return [
    plugin,
    // The page scrolls under a grip: it goes (the editor takes this listener away with the view).
    EditorView.domEventObservers({ scroll: (_event, view) => view.plugin(plugin)?.hide() }),
    EditorView.decorations.of((view) => view.plugin(plugin)?.dimmed ?? Decoration.none),
  ];
}
