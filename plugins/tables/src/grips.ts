// Row grips and their menu (design: tables, "Grips and +"): in a layer over the editor, hidden from
// assistive technology (the Table menu carries every command), a grip (⋮⋮) shows in the left margin
// beside the row under the pointer, left of the change bars and never off the window. It shows while
// the pointer is over the table or the strips beside it, and hides at the next keystroke. A press
// selects the row (⇧-press extends) and opens its menu; a drag moves the rows (`drag.ts`); a + shows
// within 8 px of a row boundary (`plus.ts`). Interface text takes the theme's sizes.

import { type Extension } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';
import {
  clearCells,
  deleteRows,
  insertRows,
  insertRowsAt,
  moveRows,
  moveRowsTo,
  rectSelection,
  rowTitles,
  selectedCells,
  tablesOf,
  touchedRows,
  type Table,
} from '@redlines/editor';
import { beginDrag, DRAG_SLOP, type Drag } from './drag.ts';
import { boundariesOf, PLUS_REACH, plusBoundary } from './plus.ts';

export const GRIPS_STYLE = `
.rl-grips { position: absolute; inset: 0; pointer-events: none; z-index: 5; overflow: visible; }
.rl-grips > * { pointer-events: auto; }
.rl-grip, .rl-plus {
  position: absolute; box-sizing: border-box; display: flex; align-items: center; justify-content: center;
  width: 18px; height: 22px; border-radius: 4px; cursor: grab; user-select: none;
  color: var(--rl-ink-3); font-size: var(--rl-size-ui); line-height: 1; letter-spacing: -2px;
}
.rl-grip:hover, .rl-plus:hover { background: var(--rl-rule); color: var(--rl-ink); }
.rl-plus { cursor: pointer; letter-spacing: 0; border: 1px solid var(--rl-rule); background: var(--rl-paper); }
.rl-plus-line { position: absolute; height: 1px; background: var(--rl-ink-3); pointer-events: none; }
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
.rl-grip-item { padding: 5px 10px; border-radius: 4px; cursor: default; white-space: nowrap; }
.rl-grip-item:hover { background: var(--rl-rule); }
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

/** What is measured of each table, kept until the state (the text, the selection, a decoration), the scroll or the table's place changes. */
const measured = new WeakMap<
  HTMLElement,
  { state: unknown; scroll: number; top: number; drawn: Drawn }
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
        near.y >= box.top - PLUS_REACH &&
        near.y <= box.bottom + PLUS_REACH);
    if (!here) continue;
    const known = measured.get(wrapper);
    if (
      known &&
      known.state === view.state &&
      known.scroll === view.scrollDOM.scrollTop &&
      known.top === box.top &&
      known.drawn.table === table
    ) {
      drawn.push(known.drawn);
      continue;
    }
    const lines = [...wrapper.querySelectorAll<HTMLElement>(':scope > .rl-trow:not(.rl-ghost)')];
    const one: Drawn = {
      table,
      left: box.left,
      right: box.right,
      lines,
      rects: lines.map(rowBox),
    };
    measured.set(wrapper, {
      state: view.state,
      scroll: view.scrollDOM.scrollTop,
      top: box.top,
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
  private press: { x: number; y: number; row: number; drawn: Drawn; shift: boolean } | null = null;
  private readonly onMove = (event: MouseEvent) => this.moved(event);
  private readonly onLeave = (event: MouseEvent) => {
    if (!this.drag && !this.layer.contains(event.relatedTarget as Node | null)) this.hide();
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
    if (!keepMenu) this.closeMenu();
  }

  private moved(event: MouseEvent): void {
    if (this.press && !this.drag) {
      const far = Math.hypot(event.clientX - this.press.x, event.clientY - this.press.y);
      if (far > DRAG_SLOP) this.startDrag();
    }
    if (this.drag) {
      this.drag.move(event.clientX, event.clientY);
      return;
    }
    if (this.menu) return;
    const tables = drawnTables(this.view, { x: event.clientX, y: event.clientY });
    const viewLeft = this.view.dom.getBoundingClientRect().left;
    const { clientX: x, clientY: y } = event;
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

  private openMenu(x: number, y: number, press: { row: number; drawn: Drawn }): void {
    const { state } = this.view;
    const items: [string, () => boolean][] = [
      [rowTitles.insertAbove(state), () => insertRows(this.view, true)],
      [rowTitles.insertBelow(state), () => insertRows(this.view, false)],
      [rowTitles.delete(state), () => deleteRows(this.view)],
      [rowTitles.moveUp(state), () => moveRows(this.view, true)],
      [rowTitles.moveDown(state), () => moveRows(this.view, false)],
      ['Clear Contents', () => clearCells(this.view, selectedCells(state))],
    ];
    const menu = document.createElement('div');
    menu.className = 'rl-grip-menu';
    menu.setAttribute('role', 'menu');
    for (const [title, run] of items) {
      const item = document.createElement('div');
      item.className = 'rl-grip-item';
      item.setAttribute('role', 'menuitem');
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
    menu.style.top = `${(rect?.bottom ?? y) - base.top + 2}px`;
    this.layer.append(menu);
    this.menu = menu;
  }

  closeMenu(): void {
    this.menu?.remove();
    this.menu = null;
  }
}

/** The row grips, the + between rows and the dragging of rows, for the tables plugin. */
export function tableGrips(): Extension {
  const plugin = ViewPlugin.fromClass(Grips);
  return [
    plugin,
    // The page scrolls under a grip: it goes (the editor takes this listener away with the view).
    EditorView.domEventObservers({ scroll: (_event, view) => view.plugin(plugin)?.hide() }),
    EditorView.decorations.of((view) => view.plugin(plugin)?.dimmed ?? Decoration.none),
  ];
}
