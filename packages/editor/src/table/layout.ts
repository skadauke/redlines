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

import { type EditorState, type Range, RangeSet, StateField } from '@codemirror/state';
import {
  BlockWrapper,
  Decoration,
  type DecorationSet,
  EditorView,
  WidgetType,
} from '@codemirror/view';
import { tableMarkerEnd } from '@redlines/format';
import { viewModeField } from '../tracked/field.ts';
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

function rowDecorations(
  state: EditorState,
  table: Table,
  row: Row,
  out: Range<Decoration>[],
  cells: Range<Decoration>[],
): void {
  out.push(
    Decoration.line({
      class: row.header ? 'rl-trow rl-th' : 'rl-trow',
      attributes: { role: 'row', 'aria-rowindex': String(row.index + 1) },
    }).range(row.from),
  );
  const last = row.cells.length - 1;
  row.cells.forEach((cell, i) => {
    const shown = cell.col < table.columns;
    // The header's last cell holds the delimiter row too, hidden with the line break before it.
    const end = row.header && i === last ? table.delimiter.to : cell.to;
    if (end > cell.from) {
      cells.push(
        Decoration.mark({
          class: shown ? 'rl-tc' : 'rl-tc rl-tc-hidden',
          inclusive: true,
          attributes: {
            role: row.header ? 'columnheader' : 'cell',
            'aria-colindex': String(cell.col + 1),
            'data-col': String(cell.col),
            'data-align': alignOf(table, cell.col),
          },
        }).range(cell.from, end),
      );
    }
    if (!shown) return;
    // The pipe and the padding in front of the text, around a marker; the padding after it, and the
    // closing pipe.
    const marker = markerIn(state, cell);
    if (marker) {
      if (marker.from > cell.from) out.push(HIDDEN.range(cell.from, marker.from));
      if (cell.textFrom > marker.to) out.push(HIDDEN.range(marker.to, cell.textFrom));
    } else if (cell.textFrom > cell.from) out.push(HIDDEN.range(cell.from, cell.textFrom));
    if (cell.to > cell.textTo) out.push(HIDDEN.range(cell.textTo, cell.to));
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
  tables.forEach((table) => {
    const attributes = {
      role: 'table',
      'aria-rowcount': String(table.rows.length),
      'aria-colcount': String(table.columns),
      'data-table': String(table.id),
    };
    wrappers.push(
      BlockWrapper.create({
        tagName: 'div',
        attributes: { class: 'rl-tbl-scroll' },
        rank: 1,
      }).range(table.from, table.to),
      BlockWrapper.create({
        tagName: 'div',
        attributes: { class: 'rl-tbl', ...attributes },
        rank: 0,
      }).range(table.from, table.to),
    );
    for (const row of table.rows) rowDecorations(state, table, row, out, cells);
    // The delimiter row: its line break and the row, hidden in one piece.
    const header = table.rows[0];
    if (header) out.push(HIDDEN.range(header.to, table.delimiter.to));
  });
  return {
    wrappers: BlockWrapper.set(wrappers, true),
    decorations: Decoration.set(out, true),
    cells: Decoration.set(cells, true),
  };
}

const layoutField = StateField.define<Layout>({
  create: layoutOf,
  update(value, tr) {
    const changed =
      tr.startState.field(tablesField, false) !== tr.state.field(tablesField, false) ||
      tr.startState.field(viewModeField, false) !== tr.state.field(viewModeField, false);
    return changed ? layoutOf(tr.state) : value;
  },
  // From a state field rather than a view plugin, because the delimiter row is hidden with the line
  // break in front of it.
  provide: (field) => [
    EditorView.decorations.from(field, (value) => value.decorations),
    EditorView.outerDecorations.from(field, (value) => value.cells),
    EditorView.blockWrappers.from(field, (value) => value.wrappers),
  ],
});

/** Tables laid out as tables, in Clean and Redlines. */
export function tableLayout() {
  return [tablesField, layoutField];
}
