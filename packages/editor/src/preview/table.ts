// Tables (design §5.8). Away from the caret, a table is drawn as a table: a header row,
// horizontal rules only, and cells with their inline Markdown rendered. Clicking it puts the
// caret in the table, which then shows its source lines.

import type { syntaxTree } from '@codemirror/language';
import type { EditorState, Range } from '@codemirror/state';
import { Decoration, type EditorView, WidgetType } from '@codemirror/view';

type SyntaxNode = ReturnType<typeof syntaxTree>['topNode'];

type Align = '' | 'left' | 'center' | 'right';

/** A stretch of cell text with the classes of the inline elements around it. */
interface Run {
  text: string;
  className: string;
  /** Where the text starts, as an offset from the start of the table. */
  from: number;
}

interface Cell {
  runs: Run[];
  /** Where the cell's text ends, as an offset from the start of the table: the caret's target. */
  end: number;
}

interface TableData {
  aligns: Align[];
  header: Cell[];
  rows: Cell[][];
}

const INLINE_CLASS: Record<string, string> = {
  Emphasis: 'rl-em',
  StrongEmphasis: 'rl-strong',
  InlineCode: 'rl-code',
  Strikethrough: 'rl-strike',
  URL: 'rl-link',
};

const MARKS = new Set(['EmphasisMark', 'CodeMark', 'StrikethroughMark', 'LinkMark']);

/** Appends the visible text of `node` between `from` and `to` to `runs`, without its syntax. */
function collectRuns(
  state: EditorState,
  node: SyntaxNode,
  from: number,
  to: number,
  className: string,
  base: number,
  runs: Run[],
): void {
  const text = (start: number, end: number) => {
    if (start < end) runs.push({ text: state.sliceDoc(start, end), className, from: start - base });
  };
  const within = (cls: string) => (className ? `${className} ${cls}` : cls);
  let pos = from;
  for (let child = node.firstChild; child && child.from < to; child = child.nextSibling) {
    text(pos, child.from);
    pos = child.to;
    if (MARKS.has(child.name)) continue;
    if (child.name === 'Escape') {
      text(child.from + 1, child.to);
    } else if (child.name === 'Link') {
      const close = child.getChildren('LinkMark')[1];
      if (close && (child.getChild('URL') || child.getChild('LinkLabel'))) {
        collectRuns(state, child, child.from, close.from, within('rl-link'), base, runs);
      } else {
        text(child.from, child.to);
      }
    } else {
      const cls = INLINE_CLASS[child.name];
      collectRuns(state, child, child.from, child.to, cls ? within(cls) : className, base, runs);
    }
  }
  text(pos, to);
}

/** A row's cells, split at its pipes; an empty cell has no node of its own. */
function readRow(state: EditorState, row: SyntaxNode, base: number): Cell[] {
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
    collectRuns(state, node, node.from, node.to, '', base, runs);
    return { runs, end: node.to - base };
  });
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
  const headerRow = table.getChild('TableHeader');
  const header = headerRow ? readRow(state, headerRow, base) : [];
  const delimiter = table.getChild('TableDelimiter');
  const aligns = delimiter ? readAligns(state.sliceDoc(delimiter.from, delimiter.to)) : [];
  const rows = table.getChildren('TableRow').map((row) => {
    const cells = readRow(state, row, base).slice(0, header.length);
    while (cells.length < header.length) cells.push({ runs: [], end: row.to - base });
    return cells;
  });
  return { aligns, header, rows };
}

class TableWidget extends WidgetType {
  /** The table's source, which decides everything drawn. */
  readonly source: string;
  readonly table: TableData;

  constructor(source: string, table: TableData) {
    super();
    this.source = source;
    this.table = table;
  }

  override eq(other: TableWidget): boolean {
    return other.source === this.source;
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
        span.textContent = run.text;
        cell.append(span);
      }
    };
    const head = document.createElement('tr');
    this.table.header.forEach((data, column) => {
      const th = document.createElement('th');
      fill(th, data, column);
      head.append(th);
    });
    const thead = document.createElement('thead');
    thead.append(head);
    const tbody = document.createElement('tbody');
    for (const row of this.table.rows) {
      const tr = document.createElement('tr');
      row.forEach((data, column) => {
        const td = document.createElement('td');
        fill(td, data, column);
        tr.append(td);
      });
      tbody.append(tr);
    }
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
    return Number(run.dataset['from']) + point.startOffset;
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
  const widget = new TableWidget(state.sliceDoc(from, to), readTable(state, node, from));
  return Decoration.replace({ widget, block: true }).range(from, to);
}
