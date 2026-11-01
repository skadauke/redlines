// Tables (design §5.8). Away from the caret, a table is drawn as a table: a header row,
// horizontal rules only, and cells with their inline Markdown rendered, tracked changes included.
// Clicking it puts the caret in the table, which then shows its source lines.

import type { syntaxTree } from '@codemirror/language';
import type { EditorState, Range } from '@codemirror/state';
import { Decoration, type EditorView, WidgetType } from '@codemirror/view';
import { type TrackedText, trackedText } from '../tracked/decorations.ts';

type SyntaxNode = ReturnType<typeof syntaxTree>['topNode'];

type Align = '' | 'left' | 'center' | 'right';

/** A stretch of cell text with the classes of the inline elements around it. */
interface Run {
  text: string;
  className: string;
  /** Where the text starts, as an offset from the start of the table; deleted text is drawn there. */
  from: number;
  /** Deleted text, which isn't in the source. */
  deleted?: boolean;
  /** The classes of the tracked marks around the text, outermost first. */
  layers?: string[];
}

interface Cell {
  runs: Run[];
  /** Where the cell's text ends, as an offset from the start of the table: the caret's target. */
  end: number;
}

interface Row {
  cells: Cell[];
  /** The classes of the row's change bar, or ''. */
  bar: string;
}

interface TableData {
  aligns: Align[];
  header: Row;
  rows: Row[];
}

const INLINE_CLASS: Record<string, string> = {
  Emphasis: 'rl-em',
  StrongEmphasis: 'rl-strong',
  InlineCode: 'rl-code',
  Strikethrough: 'rl-strike',
  URL: 'rl-link',
};

const MARKS = new Set(['EmphasisMark', 'CodeMark', 'StrikethroughMark', 'LinkMark']);

/**
 * Appends the visible text of `node` between `from` and `to` to `runs`, without its syntax, and
 * with its tracked changes as the tracked layer draws them.
 */
function collectRuns(
  state: EditorState,
  node: SyntaxNode,
  from: number,
  to: number,
  className: string,
  base: number,
  runs: Run[],
  tracked: TrackedText | null,
): void {
  const text = (start: number, end: number, cls = className) => {
    if (start >= end) return;
    if (!tracked) {
      runs.push({ text: state.sliceDoc(start, end), className: cls, from: start - base });
      return;
    }
    for (const piece of tracked.pieces(start, end)) {
      // Deleted text takes the classes around its marker, not the marker's own.
      const run: Run = {
        text: piece.text,
        className: piece.deleted ? className : cls,
        from: piece.from - base,
      };
      if (piece.deleted) run.deleted = true;
      if (piece.layers.length) run.layers = piece.layers;
      runs.push(run);
    }
  };
  const within = (cls: string) => (className ? `${className} ${cls}` : cls);
  let pos = from;
  for (let child = node.firstChild; child && child.from < to; child = child.nextSibling) {
    text(pos, child.from);
    pos = child.to;
    if (MARKS.has(child.name)) continue;
    if (child.name === 'Escape') {
      text(child.from + 1, child.to);
    } else if (child.name === 'Comment') {
      // A marker is hidden, or draws deleted text; an ordinary comment is a dimmed note.
      text(child.from, child.to, within('rl-comment'));
    } else if (child.name === 'Link') {
      const close = child.getChildren('LinkMark')[1];
      if (close && (child.getChild('URL') || child.getChild('LinkLabel'))) {
        collectRuns(state, child, child.from, close.from, within('rl-link'), base, runs, tracked);
      } else {
        text(child.from, child.to);
      }
    } else {
      const cls = INLINE_CLASS[child.name];
      const inner = cls ? within(cls) : className;
      collectRuns(state, child, child.from, child.to, inner, base, runs, tracked);
    }
  }
  text(pos, to);
}

/** A row's cells, split at its pipes; an empty cell has no node of its own. */
function readCells(
  state: EditorState,
  row: SyntaxNode,
  base: number,
  tracked: TrackedText | null,
): Cell[] {
  const pipes = row.getChildren('TableDelimiter');
  const nodes = row.getChildren('TableCell');
  const bounds: [number, number][] = [];
  let start = row.from;
  for (const pipe of pipes) {
    bounds.push([start, pipe.from]);
    start = pipe.to;
  }
  bounds.push([start, row.to]);
  if (pipes[0]?.from === row.from) bounds.shift();
  if (pipes.at(-1)?.to === row.to) bounds.pop();
  return bounds.map(([from, to]) => {
    const node = nodes.find((cell) => cell.from >= from && cell.to <= to);
    if (!node) return { runs: [], end: Math.min(from + 1, to) - base };
    const runs: Run[] = [];
    collectRuns(state, node, node.from, node.to, '', base, runs, tracked);
    return { runs, end: node.to - base };
  });
}

function readRow(
  state: EditorState,
  row: SyntaxNode,
  base: number,
  tracked: TrackedText | null,
): Row {
  return { cells: readCells(state, row, base, tracked), bar: tracked?.bar(row.from, row.to) ?? '' };
}

function readAligns(delimiterRow: string): Align[] {
  const cells = delimiterRow.trim().replace(/^\|/, '').replace(/\|$/, '').split('|');
  return cells.map((cell) => {
    const spec = cell.trim();
    const left = spec.startsWith(':');
    const right = spec.endsWith(':');
    return left && right ? 'center' : right ? 'right' : left ? 'left' : '';
  });
}

function readTable(state: EditorState, table: SyntaxNode, base: number): TableData {
  const tracked = trackedText(state, table.from, table.to);
  const headerRow = table.getChild('TableHeader');
  const header = headerRow ? readRow(state, headerRow, base, tracked) : { cells: [], bar: '' };
  const delimiter = table.getChild('TableDelimiter');
  const aligns = delimiter ? readAligns(state.sliceDoc(delimiter.from, delimiter.to)) : [];
  const rows = table.getChildren('TableRow').map((node) => {
    const row = readRow(state, node, base, tracked);
    const cells = row.cells.slice(0, header.cells.length);
    while (cells.length < header.cells.length) cells.push({ runs: [], end: node.to - base });
    return { cells, bar: row.bar };
  });
  return { aligns, header, rows };
}

class TableWidget extends WidgetType {
  readonly table: TableData;
  /** Everything drawn: the source, and how the view draws its tracked changes. */
  readonly drawn: string;

  constructor(table: TableData) {
    super();
    this.table = table;
    this.drawn = JSON.stringify(table);
  }

  override eq(other: TableWidget): boolean {
    return other.drawn === this.drawn;
  }

  override get estimatedHeight(): number {
    return (this.table.rows.length + 1) * 36;
  }

  override toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'rl-table';
    const table = document.createElement('table');
    const fill = (cell: HTMLTableCellElement, data: Cell, column: number) => {
      const align = this.table.aligns[column];
      if (align) cell.style.textAlign = align;
      cell.dataset['end'] = String(data.end);
      for (const run of data.runs) {
        const span = document.createElement('span');
        if (run.className) span.className = run.className;
        span.dataset['from'] = String(run.from);
        if (run.deleted) span.dataset['deleted'] = '';
        span.textContent = run.text;
        let outer = span;
        for (const layer of (run.layers ?? []).toReversed()) {
          const around = document.createElement('span');
          around.className = layer;
          around.append(outer);
          outer = around;
        }
        cell.append(outer);
      }
    };
    const row = (data: Row, tag: 'th' | 'td') => {
      const tr = document.createElement('tr');
      data.cells.forEach((cell, column) => {
        const element = document.createElement(tag);
        fill(element, cell, column);
        tr.append(element);
      });
      // The row's change bar is drawn by its first cell.
      if (data.bar && tr.firstElementChild) tr.firstElementChild.className = data.bar;
      return tr;
    };
    const thead = document.createElement('thead');
    thead.append(row(this.table.header, 'th'));
    const tbody = document.createElement('tbody');
    for (const data of this.table.rows) tbody.append(row(data, 'td'));
    table.append(thead, tbody);
    wrap.append(table);
    wrap.addEventListener('mousedown', (event) => {
      // Only a plain click enters the table. A right-click or a modified click keeps the selection;
      // the browser would otherwise move it to the table's edge, which also shows the source.
      event.preventDefault();
      const modified = event.shiftKey || event.metaKey || event.ctrlKey || event.altKey;
      if (event.button !== 0 || modified) return;
      const anchor = view.posAtDOM(wrap) + offsetAt(wrap, event);
      view.dispatch({ selection: { anchor } });
      view.focus();
    });
    return wrap;
  }
}

/** The source offset, from the start of the table, of the text under a click. */
function offsetAt(wrap: HTMLElement, event: MouseEvent): number {
  const target = event.target instanceof Element ? event.target : null;
  const point = wrap.ownerDocument.caretRangeFromPoint?.(event.clientX, event.clientY);
  const run = point?.startContainer.parentElement?.closest<HTMLElement>('[data-from]');
  if (point && run && wrap.contains(run) && target?.closest('th, td')?.contains(run)) {
    const from = Number(run.dataset['from']);
    // Deleted text isn't in the source: a click on it goes beside it.
    return run.dataset['deleted'] === undefined ? from + point.startOffset : from;
  }
  const cell = target?.closest<HTMLElement>('[data-end]');
  return cell ? Number(cell.dataset['end']) : 0;
}

/** A block decoration that draws the table `node`, which spans the lines `from`–`to`. */
export function tableDecoration(
  state: EditorState,
  node: SyntaxNode,
  from: number,
  to: number,
): Range<Decoration> {
  const widget = new TableWidget(readTable(state, node, from));
  return Decoration.replace({ widget, block: true }).range(from, to);
}
