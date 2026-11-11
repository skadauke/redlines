// Deleted columns drawn where they were (design: tables, "How it shows"). A deleted column is kept
// below its table (format §3.7) and hidden there with the line before it; in Redlines it is drawn as a
// ghost cell in every row, at its position: struck text in the author's color on the author's tint, not
// editable, and taking the table's column widths as the real cells do. A moved column's old place is a
// ghost with a double strikethrough, and its card is the moved column's. Clean and Simple draw none.
// The layout (`layout.ts`) puts a ghost in the place of the pipe in front of the cell it comes back
// in front of; the caret never rests in one, since it has no text of the document.

import { type EditorState, StateField } from '@codemirror/state';
import { EditorView, WidgetType } from '@codemirror/view';
import type { MarkRange } from '@redlines/format';
import { colorClass, colorsOf } from '../tracked/colors.ts';
import { isColDeletion, isColInsertion, parsedField, viewModeField } from '../tracked/field.ts';
import { headerColumnAt } from './columns.ts';
import { cellShows } from './widths.ts';
import { type Table, tablesField } from './model.ts';

/** A deleted column of a table, as it is drawn. */
export interface ColGhost {
  /** The deletion's id. */
  id: string;
  /** The card that decides it: its own, or the moved column's, for the old place of a move. */
  change: string;
  tableId: number;
  /** The index the column takes in the table as written when it comes back. */
  position: number;
  /** Its cells, from the header down, as the payload keeps them (the delimiter row's left out). */
  cells: string[];
  /** The author's color, an index into the theme's. */
  color: number;
  moved: boolean;
  /** Where its deletion line starts in the document. */
  line: number;
}

const POSITION = /^col=(\d+) ?/;

/** The deleted columns of the tables of a state, in the order of their lines. */
export function colGhostsOf(state: EditorState): ColGhost[] {
  const parsed = state.field(parsedField);
  const marks = parsed.marks.filter(isColDeletion);
  if (marks.length === 0) return [];
  const tables = state.field(tablesField, false) ?? [];
  const colors = colorsOf(state);
  const byLine = new Map<number, MarkRange>();
  for (const mark of marks) {
    const open = mark.segments[0]?.open;
    if (open) byLine.set(open.from, mark);
  }
  const ghosts: ColGhost[] = [];
  const { doc } = state;
  for (const table of tables) {
    const last = doc.lineAt(table.to);
    if (last.number + 2 > doc.lines || doc.line(last.number + 1).text.trim() !== '') continue;
    for (let n = last.number + 2; n <= doc.lines; n++) {
      const line = doc.line(n);
      const mark = byLine.get(line.from);
      if (!mark) break;
      const payload = mark.payload ?? '';
      const found = POSITION.exec(payload);
      const all = payload.slice(found?.[0].length ?? 0).split('\n');
      ghosts.push({
        id: mark.id,
        change: mark.entry.move ?? mark.id,
        tableId: table.id,
        position: Math.max(0, Number(found?.[1] ?? 1) - 1),
        cells: all.filter((_, i) => i !== 1).map((cell) => cellShows(cell).trim()),
        color: colors.get(mark.entry.by) ?? 0,
        moved: mark.entry.move !== undefined,
        line: line.from,
      });
    }
  }
  return ghosts;
}

/** An inserted column of a table, as it is drawn: the cells of its column take the author's tint. */
export interface InsertedColumn {
  /** The insertion's id. */
  id: string;
  /** The column's index in its table. */
  col: number;
  color: number;
  moved: boolean;
}

/** The columns changed in each table, and the stretches of text they stand for. */
export interface ColGhosts {
  byTable: ReadonlyMap<number, readonly ColGhost[]>;
  inserted: ReadonlyMap<number, readonly InsertedColumn[]>;
  spans: readonly { from: number; to: number }[];
  /** What the layout draws of them: when it is the same, the layout is as it was. */
  key: string;
}

const NONE: ColGhosts = { byTable: new Map(), inserted: new Map(), spans: [], key: '' };

function build(state: EditorState): ColGhosts {
  if (state.field(viewModeField, false) !== 'redlines') return NONE;
  const tables = state.field(tablesField, false) ?? [];
  const ghosts = colGhostsOf(state);
  const parsed = state.field(parsedField);
  const insertions = parsed.marks.filter(isColInsertion);
  if (ghosts.length === 0 && insertions.length === 0) return NONE;
  const colors = colorsOf(state);
  const byTable = new Map<number, ColGhost[]>();
  const inserted = new Map<number, InsertedColumn[]>();
  const spans = new Map<number, { from: number; to: number }>();
  const span = (table: Table) => {
    const found = spans.get(table.id) ?? { from: table.from, to: table.to };
    spans.set(table.id, found);
    return found;
  };
  for (const ghost of ghosts) {
    byTable.set(ghost.tableId, [...(byTable.get(ghost.tableId) ?? []), ghost]);
    const table = tables.find((t) => t.id === ghost.tableId);
    if (table) span(table).to = Math.max(span(table).to, state.doc.lineAt(ghost.line).to);
  }
  for (const mark of insertions) {
    const open = mark.segments[0]?.open;
    const at = open ? headerColumnAt(state, open.from) : null;
    if (!at) continue;
    inserted.set(at.table.id, [
      ...(inserted.get(at.table.id) ?? []),
      {
        id: mark.id,
        col: at.col,
        color: colors.get(mark.entry.by) ?? 0,
        moved: mark.entry.move !== undefined,
      },
    ]);
    span(at.table);
  }
  // Ghosts at one place stand in the order of their lines, which are in the order of their positions.
  for (const list of byTable.values()) list.sort((a, b) => a.position - b.position);
  const key = JSON.stringify([
    [...byTable].map(([id, list]) => [
      id,
      list.map((g) => [g.id, g.change, g.position, g.cells, g.color, g.moved]),
    ]),
    [...inserted],
  ]);
  return { byTable, inserted, spans: [...spans.values()], key };
}

export const colGhostField = StateField.define<ColGhosts>({
  create: build,
  update(value, tr) {
    const modeChanged =
      tr.startState.field(viewModeField, false) !== tr.state.field(viewModeField, false);
    const tablesChanged =
      tr.startState.field(tablesField, false) !== tr.state.field(tablesField, false);
    // What was found is kept while it is the same: its spans move with the text.
    const again = (): ColGhosts => {
      const next = build(tr.state);
      return next.key === value.key ? value : next;
    };
    if (!tr.docChanged) {
      return modeChanged || (tablesChanged && value.spans.length > 0) ? again() : value;
    }
    if (modeChanged) return again();
    // Only a change that touches a table with a column changed, or writes one, looks at them again;
    // every other keystroke only moves them.
    let touched = false;
    tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
      if (touched) return;
      const text = inserted.length > 0 ? inserted.toString() : '';
      if (text.includes('col=') || text.includes('col-->')) touched = true;
      else if (value.spans.some((span) => fromA <= span.to + 1 && toA >= span.from - 1))
        touched = true;
    });
    if (touched) return again();
    if (value.spans.length === 0) return value;
    return {
      ...value,
      spans: value.spans.map((span) => ({
        from: tr.changes.mapPos(span.from, -1),
        to: tr.changes.mapPos(span.to, 1),
      })),
    };
  },
});

/** The deleted columns of a table, drawn in this state: none outside Redlines. */
export function ghostColumnsOf(state: EditorState, tableId: number): readonly ColGhost[] {
  return state.field(colGhostField, false)?.byTable.get(tableId) ?? [];
}

/** The inserted columns of a table, drawn in this state: none outside Redlines. */
export function insertedColumnsOf(state: EditorState, tableId: number): readonly InsertedColumn[] {
  return state.field(colGhostField, false)?.inserted.get(tableId) ?? [];
}

/** A deleted column's cell in one row. */
function ghostCell(ghost: ColGhost, row: number): HTMLElement {
  const cell = document.createElement('span');
  cell.className = `rl-tc rl-ghost rl-ghost-col${ghost.moved ? ' rl-ghost-moved' : ''} ${colorClass(ghost.color)}`;
  cell.setAttribute('role', row === 0 ? 'columnheader' : 'cell');
  cell.setAttribute('aria-label', ghost.moved ? 'Moved column' : 'Deleted column');
  cell.dataset['mark'] = ghost.change;
  cell.dataset['ghost'] = ghost.id;
  const struck = document.createElement('span');
  struck.className = 'rl-del';
  const text = ghost.cells[row] ?? '';
  struck.textContent = text === '' ? '​' : text;
  cell.append(struck);
  return cell;
}

/** The ghost cells in front of one real cell, in a row: widgets standing for a pipe. */
export class GhostColsWidget extends WidgetType {
  readonly ghosts: readonly ColGhost[];
  readonly row: number;
  /** The index of the first of them among the columns drawn. */
  readonly visual: number;
  readonly aligns: readonly string[];

  constructor(ghosts: readonly ColGhost[], row: number, visual: number, aligns: readonly string[]) {
    super();
    this.ghosts = ghosts;
    this.row = row;
    this.visual = visual;
    this.aligns = aligns;
  }

  override eq(other: WidgetType): boolean {
    if (!(other instanceof GhostColsWidget)) return false;
    return (
      other.row === this.row &&
      other.visual === this.visual &&
      other.ghosts.length === this.ghosts.length &&
      other.ghosts.every((g, i) => {
        const mine = this.ghosts[i];
        return (
          mine !== undefined &&
          g.id === mine.id &&
          g.change === mine.change &&
          g.color === mine.color &&
          g.moved === mine.moved &&
          g.cells[this.row] === mine.cells[this.row]
        );
      })
    );
  }

  override toDOM(): HTMLElement {
    const cells = this.ghosts.map((ghost, i) => {
      const cell = ghostCell(ghost, this.row);
      cell.dataset['vcol'] = String(this.visual + i);
      cell.dataset['align'] = 'default';
      cell.setAttribute('aria-colindex', String(this.visual + i + 1));
      return cell;
    });
    if (cells.length === 1 && cells[0]) return cells[0];
    // Several at one place: a wrapper that is no box, so that the cells are cells of the row.
    const wrapper = document.createElement('span');
    wrapper.style.display = 'contents';
    wrapper.append(...cells);
    return wrapper;
  }

  /** The editor sees a press (the card is opened by it), and `ghostColPress` puts no caret there. */
  override ignoreEvent(): boolean {
    return false;
  }
}

/** A press on a ghost puts no caret there: the card the press opens is its only effect. */
export const ghostColPress = EditorView.domEventHandlers({
  mousedown(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest('.rl-ghost-col')) return false;
    event.preventDefault();
    return true;
  },
});
