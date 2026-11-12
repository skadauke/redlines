// A table laid out as a table (design: tables, "Layout"). The table stays its Markdown source, one
// line a row; CodeMirror draws the lines as a table through its block wrappers, line decorations and
// outer marks. A wrapper around the lines is the table, a line is a row, a cell is a mark that
// nothing else splits. Pipes, padding and the delimiter row are hidden (the caret steps over them:
// `stops.ts`), `<br>` is drawn as a line break, and an empty cell has a filler for the caret to
// stand on. Raw draws none of it.
//
// What the prototype found, and the layout keeps to: nothing but a cell is a direct child of a row
// (the change bar is drawn by the first cell, not the row); a wrapper ends at the table's last line,
// so the blank line after the table, a struck block widget or the ledger are in none; a table in a
// quote or a list item is no table here (`model.ts`), and stays source.

import {
  type EditorState,
  type Range,
  RangeSet,
  StateField,
  type Transaction,
} from '@codemirror/state';
import {
  BlockWrapper,
  Decoration,
  type DecorationSet,
  EditorView,
  WidgetType,
} from '@codemirror/view';
import { tableMarkerEnd } from '@redlines/format';
import { viewModeField } from '../tracked/field.ts';
import {
  colGhostField,
  ghostColPress,
  ghostColumnsOf,
  GhostColsWidget,
  insertedColumnsOf,
} from './colghosts.ts';
import { colorClass } from '../tracked/colors.ts';
import { type Dirty, dirtyOf, type Span } from './dirty.ts';
import { type Cell, type Row, type Table, tablesField } from './model.ts';
import { BR } from './stops.ts';

/** What the layout builds for a state. */
export interface Layout {
  /** The wrappers around the lines of each table: the one that scrolls and the one that is the table. */
  wrappers: RangeSet<BlockWrapper>;
  /** Rows, hidden pipes and padding, line breaks and fillers. */
  decorations: DecorationSet;
  /** The cells, which nothing else splits. */
  cells: DecorationSet;
}

/** An empty cell's filler: a zero-width stop that gives the caret a line to stand on. */
class FillerWidget extends WidgetType {
  override eq(other: WidgetType): boolean {
    return other instanceof FillerWidget;
  }
  override toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'rl-tc-fill';
    span.textContent = '​';
    return span;
  }
  override ignoreEvent(): boolean {
    return false;
  }
}

/** A `<br>` written in a cell, drawn as the line break it is. */
class BreakWidget extends WidgetType {
  override eq(other: WidgetType): boolean {
    return other instanceof BreakWidget;
  }
  override toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'rl-tbr';
    span.append(document.createElement('br'));
    return span;
  }
  override ignoreEvent(): boolean {
    return false;
  }
}

const HIDDEN = Decoration.replace({});
const FILLER = Decoration.widget({ widget: new FillerWidget(), side: 1 });
const BREAK = Decoration.replace({ widget: new BreakWidget() });

/** The data-align attribute of a cell, the delimiter row's alignment of its column. */
function alignOf(table: Table, col: number): string {
  return table.aligns[col] || 'default';
}

/**
 * The marker of an inserted row or column at the start of a cell, as a range, or null: it is hidden
 * by the tracked layer, and the pipe and padding in front of it and the space after it are hidden here,
 * around it, so that no two replacements overlap.
 */
function markerIn(state: EditorState, cell: Cell): { from: number; to: number } | null {
  const text = state.sliceDoc(cell.from, Math.max(cell.from, cell.textFrom));
  const open = text.indexOf('<!--ins ');
  if (open < 0) return null;
  const from = cell.from + open;
  const to = tableMarkerEnd(state.sliceDoc(from, from + 40), 0);
  return to === null ? null : { from, to: from + to };
}

/** The rows built, for tests: the layout builds only the rows a change touches. */
export const layoutStats = { rows: 0 };

function rowDecorations(
  state: EditorState,
  table: Table,
  row: Row,
  out: Range<Decoration>[],
  cells: Range<Decoration>[],
): void {
  layoutStats.rows++;
  // The deleted columns drawn in the table, each in the place of the pipe in front of the cell it comes
  // back before (the cell's own mark starts after it), or of the closing pipe for one that comes
  // back after the last (Redlines only).
  const ghosts = ghostColumnsOf(state, table.id);
  const inserted = insertedColumnsOf(state, table.id);
  const shownCount = Math.min(row.cells.length, table.columns);
  // How the ghosts that come back after the last column are drawn: in the place of the closing pipe;
  // or, in a row that has none (a table without outer pipes), at the end of its text, with the
  // header's delimiter row hidden under it.
  let appended: 'pipe' | 'end' | null = null;
  const lastCell = row.cells[shownCount - 1];
  if (lastCell && ghosts.some((ghost) => ghost.position === shownCount)) {
    const tail = state.sliceDoc(lastCell.textTo, lastCell.to);
    const pipe = tail.lastIndexOf('|');
    const here = ghosts.filter((ghost) => ghost.position === shownCount);
    const visual = shownCount + ghosts.filter((g) => g.position < shownCount).length;
    const widget = new GhostColsWidget(here, row.index, visual, table.aligns);
    if (pipe !== -1 && tail.slice(pipe + 1).trim() === '') {
      out.push(
        Decoration.replace({ widget }).range(
          lastCell.textTo + pipe,
          row.header ? table.delimiter.to : lastCell.to,
        ),
      );
      appended = 'pipe';
    } else if (pipe === -1) {
      out.push(
        row.header
          ? Decoration.replace({ widget }).range(lastCell.to, table.delimiter.to)
          : Decoration.widget({ widget, side: 1 }).range(lastCell.to),
      );
      appended = 'end';
    }
  }
  // The delimiter row: its line break and the row, hidden in one piece with the header's end (or held
  // by the ghost that takes the header's closing pipe).
  if (row.header && !appended) out.push(HIDDEN.range(row.to, table.delimiter.to));
  out.push(
    Decoration.line({
      class: row.header ? 'rl-trow rl-th' : 'rl-trow',
      attributes: { role: 'row', 'aria-rowindex': String(row.index + 1) },
    }).range(row.from),
  );
  const last = row.cells.length - 1;
  row.cells.forEach((cell, i) => {
    const shown = cell.col < table.columns;
    const here = shown ? ghosts.filter((ghost) => ghost.position === i) : [];
    const behind = shown ? ghosts.filter((ghost) => ghost.position <= i).length : 0;
    const added = shown ? inserted.find((column) => column.col === i) : undefined;
    let start = cell.from;
    // The ghosts in front of a first cell that has no pipe of its own to stand in the place of
    // (a row without a leading pipe) stand before the cell, which does not take them in.
    let before = false;
    if (here.length > 0) {
      const widget = new GhostColsWidget(
        here,
        row.index,
        cell.col + behind - here.length,
        table.aligns,
      );
      if (state.sliceDoc(cell.from, cell.from + 1) === '|') {
        out.push(Decoration.replace({ widget }).range(cell.from, cell.from + 1));
        start = cell.from + 1;
      } else if (i === 0) {
        out.push(Decoration.widget({ widget, side: -1 }).range(cell.from));
        before = true;
      }
    }
    // The header's last cell holds the delimiter row too, hidden with the line break before it. Where
    // a ghost takes the closing pipe, the ghost holds them and the cell ends before it.
    let end = row.header && i === last && appended !== 'end' ? table.delimiter.to : cell.to;
    if (appended === 'pipe' && i === shownCount - 1) {
      const tail = state.sliceDoc(cell.textTo, cell.to);
      end = cell.textTo + tail.lastIndexOf('|');
    }
    if (end > start) {
      cells.push(
        Decoration.mark({
          class: shown
            ? `rl-tc${added ? ` rl-ins-col${added.moved ? ' rl-moved-col' : ''} ${colorClass(added.color)}` : ''}`
            : 'rl-tc rl-tc-hidden',
          inclusive: true,
          // (a ghost before or after the cell is not in it)
          inclusiveStart: !before,
          inclusiveEnd: !(appended === 'end' && i === shownCount - 1),
          attributes: {
            ...(added ? { 'data-mark': added.id } : {}),
            role: row.header ? 'columnheader' : 'cell',
            'aria-colindex': String(cell.col + behind + 1),
            'data-col': String(cell.col),
            'data-vcol': String(cell.col + behind),
            'data-align': alignOf(table, cell.col),
          },
        }).range(start, end),
      );
    }
    if (!shown) return;
    // The pipe and the padding in front of the text, around a marker; the padding after it, and the
    // closing pipe.
    const marker = markerIn(state, cell);
    if (marker) {
      if (marker.from > start) out.push(HIDDEN.range(start, marker.from));
      if (cell.textFrom > marker.to) out.push(HIDDEN.range(marker.to, cell.textFrom));
    } else if (cell.textFrom > start) out.push(HIDDEN.range(start, cell.textFrom));
    if (appended === 'pipe' && i === shownCount - 1) {
      if (end > cell.textTo) out.push(HIDDEN.range(cell.textTo, end));
    } else if (cell.to > cell.textTo) out.push(HIDDEN.range(cell.textTo, cell.to));
    if (cell.textFrom === cell.textTo) out.push(FILLER.range(cell.textFrom));
    else {
      const text = state.sliceDoc(cell.textFrom, cell.textTo);
      for (const found of text.matchAll(BR)) {
        const at = cell.textFrom + found.index;
        out.push(BREAK.range(at, at + found[0].length));
      }
    }
  });
}

/** The two wrappers around the lines of a table: the one that scrolls and the one that is the table. */
function wrappersOf(table: Table): Range<BlockWrapper>[] {
  // A block that starts at the end of the last row's text, as a ghost row after it does, is in the
  // wrapper: its end is inclusive. The next line starts after it.
  const end = table.to;
  const attributes = {
    role: 'table',
    'aria-rowcount': String(table.rows.length),
    'aria-colcount': String(table.columns),
    'data-table': String(table.id),
  };
  return [
    BlockWrapper.create({
      tagName: 'div',
      attributes: { class: 'rl-tbl-scroll' },
      rank: 1,
    }).range(table.from, end),
    BlockWrapper.create({
      tagName: 'div',
      attributes: { class: 'rl-tbl', ...attributes },
      rank: 0,
    }).range(table.from, end),
  ];
}

/** The layout of the tables of a state: none in Raw. */
export function layoutOf(state: EditorState): Layout {
  const none: Layout = {
    wrappers: BlockWrapper.set([]),
    decorations: Decoration.none,
    cells: Decoration.none,
  };
  if (state.field(viewModeField, false) === 'raw') return none;
  const tables = state.field(tablesField, false) ?? [];
  const wrappers: Range<BlockWrapper>[] = [];
  const out: Range<Decoration>[] = [];
  const cells: Range<Decoration>[] = [];
  for (const table of tables) {
    wrappers.push(...wrappersOf(table));
    for (const row of table.rows) rowDecorations(state, table, row, out, cells);
  }
  return {
    wrappers: BlockWrapper.set(wrappers, true),
    decorations: Decoration.set(out, true),
    cells: Decoration.set(cells, true),
  };
}

/** What a set keeps when the ranges that start in `from`..`to` and end by it are taken out. */
const without = (from: number, to: number) => ({
  filter: (a: number, b: number) => !(a >= from && b <= to),
  filterFrom: from,
  filterTo: to,
});

/**
 * The layout after a change that is in the tables' text: the sets mapped through it, the tables it
 * doesn't touch as they were, the rows it touches built again, and a table whose shape it changes
 * (or that is new) built whole.
 */
function patchLayout(value: Layout, tr: Transaction, dirty: Dirty): Layout {
  let { wrappers, decorations, cells } = {
    wrappers: value.wrappers.map(tr.changes),
    decorations: value.decorations.map(tr.changes),
    cells: value.cells.map(tr.changes),
  };
  const dropRows = (span: Span) => {
    decorations = decorations.update(without(span.from, span.to));
    cells = cells.update(without(span.from, span.to));
  };
  for (const span of dirty.gone) {
    wrappers = wrappers.update(without(span.from, span.to));
    dropRows(span);
  }
  // Everything that is to be built again is taken out first: what a change touches can lie where
  // another table's drawing starts, and nothing built may be taken out after.
  for (const { rows, clear } of dirty.tables) {
    wrappers = wrappers.update(without(clear.from, clear.to));
    if (rows === null) dropRows(clear);
    else for (const { clear: span } of rows) dropRows(span);
  }
  for (const { table, rows } of dirty.tables) {
    const built = rows ? rows.map((r) => r.row) : table.rows;
    const out: Range<Decoration>[] = [];
    const inCells: Range<Decoration>[] = [];
    for (const row of built) rowDecorations(tr.state, table, row, out, inCells);
    wrappers = wrappers.update({ add: wrappersOf(table), sort: true });
    decorations = decorations.update({ add: out, sort: true });
    cells = cells.update({ add: inCells, sort: true });
  }
  return { wrappers, decorations, cells };
}

const layoutField = StateField.define<Layout>({
  create: layoutOf,
  update(value, tr) {
    const tables = tr.state.field(tablesField, false);
    // Deleted columns come and go with the line below the table, with no row touched.
    if (
      tr.startState.field(colGhostField, false)?.key !== tr.state.field(colGhostField, false)?.key
    ) {
      return layoutOf(tr.state);
    }
    const changed =
      tr.startState.field(tablesField, false) !== tables ||
      tr.startState.field(viewModeField, false) !== tr.state.field(viewModeField, false);
    if (!changed) return value;
    const mode = tr.startState.field(viewModeField, false) !== tr.state.field(viewModeField, false);
    // A change of view, or tables read again from a parse that went on, builds them all.
    if (mode || !tr.docChanged || tr.state.field(viewModeField, false) === 'raw') {
      return layoutOf(tr.state);
    }
    if (!tables?.length && !tr.startState.field(tablesField, false)?.length) return value;
    const dirty = dirtyOf(tr);
    return dirty ? patchLayout(value, tr, dirty) : layoutOf(tr.state);
  },
  // From a state field rather than a view plugin, because the delimiter row is hidden with the line
  // break in front of it.
  provide: (field) => [
    EditorView.decorations.from(field, (value) => value.decorations),
    EditorView.outerDecorations.from(field, (value) => value.cells),
    EditorView.blockWrappers.from(field, (value) => value.wrappers),
  ],
});

/** The layout a state has, as the field keeps it up to date. */
export const layoutOfState = (state: EditorState): Layout => state.field(layoutField);

/** Tables laid out as tables, in Clean and Redlines. */
export function tableLayout() {
  return [tablesField, colGhostField, layoutField, ghostColPress];
}
