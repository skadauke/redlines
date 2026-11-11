// Deleted rows drawn where they were (design: tables, "How it shows"). A deleted row is kept below
// its table (format §3.7) and hidden there with the line before it; in Redlines it is drawn as a ghost
// row at its position, a block widget inside the table's wrapper laid out as a row of cells: struck
// text in the author's color on the author's tint, not editable, and taking the table's column
// widths as the real rows do. A moved row's old place is a ghost with a double strikethrough, and its
// card is the moved row's. Clean and Simple draw no ghost: a ghost is a look. The caret never rests
// in one (a ghost has no text of the document) and a press on one opens its card and puts no caret.

import { type EditorState, type Extension, StateField, type Range } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import { readRowCells } from '@redlines/format';
import type { MarkRange, Parsed } from '@redlines/format';
import { colorClass, colorsOf } from '../tracked/colors.ts';
import { isRowDeletion, parsedField, viewModeField } from '../tracked/field.ts';
import { type Table, tablesField } from './model.ts';

/** A deleted row of a table, as it is drawn. */
export interface Ghost {
  /** The deletion's id. */
  id: string;
  /** The card that decides it: its own, or the moved row's, for the old place of a move. */
  change: string;
  table: Table;
  /** The position the row comes back to: the index it takes in the table as written. */
  position: number;
  /** The text of its cells, as many as the table has columns. */
  cells: string[];
  /** The author's color, an index into the theme's. */
  color: number;
  moved: boolean;
  /** Where its deletion line starts in the document. */
  line: number;
}

const POSITION = /^row=(\d+) ?/;

/** The deleted rows of the tables of a state, in the order of their lines, with nothing for a
 * document that has none (the common case costs one pass over the marks). */
export function ghostsOf(state: EditorState): Ghost[] {
  const parsed = state.field(parsedField);
  const marks = parsed.marks.filter(isRowDeletion);
  if (marks.length === 0) return [];
  const tables = state.field(tablesField, false) ?? [];
  const colors = colorsOf(state);
  const byLine = new Map<number, MarkRange>();
  for (const mark of marks) {
    const open = mark.segments[0]?.open;
    if (open) byLine.set(open.from, mark);
  }
  const ghosts: Ghost[] = [];
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
      const text = payload.slice(found?.[0].length ?? 0);
      const read = readRowCells(text, 0, text.length).cells;
      ghosts.push({
        id: mark.id,
        change: mark.entry.move ?? mark.id,
        table,
        position: Number(found?.[1] ?? 0),
        cells: Array.from({ length: table.columns }, (_, i) => {
          const cell = read[i];
          return cell ? text.slice(cell.textFrom, cell.textTo).trim() : '';
        }),
        color: colors.get(mark.entry.by) ?? 0,
        moved: mark.entry.move !== undefined,
        line: line.from,
      });
    }
  }
  return ghosts;
}

class GhostWidget extends WidgetType {
  readonly ghost: Ghost;

  constructor(ghost: Ghost) {
    super();
    this.ghost = ghost;
  }

  override eq(other: WidgetType): boolean {
    const a = this.ghost;
    const b = other instanceof GhostWidget ? other.ghost : null;
    return (
      b !== null &&
      a.id === b.id &&
      a.change === b.change &&
      a.color === b.color &&
      a.moved === b.moved &&
      a.table.id === b.table.id &&
      a.cells.join('\u0001') === b.cells.join('\u0001') &&
      a.table.aligns.join() === b.table.aligns.join()
    );
  }

  override toDOM(): HTMLElement {
    const { ghost } = this;
    const row = document.createElement('div');
    row.className = `rl-trow rl-ghost${ghost.moved ? ' rl-ghost-moved' : ''} rl-bar ${colorClass(ghost.color)}`;
    row.setAttribute('role', 'row');
    row.setAttribute('aria-label', ghost.moved ? 'Moved row' : 'Deleted row');
    row.dataset['mark'] = ghost.change;
    row.dataset['ghost'] = ghost.id;
    ghost.cells.forEach((text, col) => {
      const cell = document.createElement('span');
      cell.className = 'rl-tc';
      cell.setAttribute('role', 'cell');
      cell.dataset['col'] = String(col);
      cell.dataset['align'] = ghost.table.aligns[col] || 'default';
      // The text is struck as a deleted block's is (`rl-del`), on the author's tint.
      const struck = document.createElement('span');
      struck.className = 'rl-del';
      struck.textContent = text === '' ? '​' : text;
      cell.append(struck);
      row.append(cell);
    });
    return row;
  }

  /** The editor sees a press (the card is opened by it), and `ghostPress` puts no caret there. */
  override ignoreEvent(): boolean {
    return false;
  }
}

/** The widgets of every ghost of a state: nothing outside Redlines. */
function ghostWidgets(state: EditorState): DecorationSet {
  if (state.field(viewModeField, false) !== 'redlines') return Decoration.none;
  const ghosts = ghostsOf(state);
  if (ghosts.length === 0) return Decoration.none;
  const out: Range<Decoration>[] = [];
  const count = new Map<string, number>();
  for (const ghost of ghosts) {
    const { table } = ghost;
    const row = table.rows[ghost.position];
    // Above the row it comes back in front of, or below the last row.
    const at = row ? row.from : table.to;
    const key = `${at} ${row ? 'before' : 'after'}`;
    const k = count.get(key) ?? 0;
    count.set(key, k + 1);
    out.push(
      Decoration.widget({
        widget: new GhostWidget(ghost),
        block: true,
        // Several at one place stand in the order of their lines.
        side: row ? -1000 + k : 1 + k,
      }).range(at),
    );
  }
  return Decoration.set(out, true);
}

const ghostField = StateField.define<DecorationSet>({
  create: ghostWidgets,
  update(value, tr) {
    const modeChanged =
      tr.startState.field(viewModeField, false) !== tr.state.field(viewModeField, false);
    const parsed = (state: EditorState): Parsed => state.field(parsedField);
    if (!tr.docChanged && !modeChanged && parsed(tr.startState) === parsed(tr.state)) return value;
    if (value === Decoration.none && !modeChanged) {
      // Nothing was drawn: look again only when a deleted row has come.
      if (!parsed(tr.state).marks.some(isRowDeletion)) return value;
    }
    return ghostWidgets(tr.state);
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** A press on a ghost puts no caret there: the card the press opens is its only effect. */
const ghostPress = EditorView.domEventHandlers({
  mousedown(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest('.rl-ghost')) return false;
    event.preventDefault();
    return true;
  },
});

/** Deleted rows drawn as ghost rows. */
export function tableGhosts(): Extension {
  return [ghostField, ghostPress];
}
