// A table deleted whole, drawn where it was as a ghost table (design: tables, "How it shows"; format
// §3.4, §3.7 rule 6). A table that goes whole is a deletion of a block: its marker stands alone in
// front of the block after it, or behind the block above at the end of the text (alone in the file,
// when it is all the text), and its payload is the table. Whoever wrote it, the tracked layer
// (`tracked/decorations.ts`) reads the payload as the blocks it holds (`deletedBlocks`) and draws
// each as a struck block where it was; a table it hands to this file, which draws it as a table: a
// header row and rows of cells, as the delimiter row aligned them, struck text in the author's color
// on the author's tint. Past eight rows the rest are one line, "and 12 more rows".
//
// The widget is no real table of the document and has none of its parts: no wrapper, no widths
// measured, no grips, no cell to select. The browser lays its columns out by the widths of its own
// cells, as an automatic layout does (the widths of a real table are measured to be what it would
// give), and they depend on nothing outside it, so they hold as the person types and scrolls. A
// ghost is a look: Clean and Simple draw none, and Simple keeps the bar. It has no text of the
// document, so the caret never rests in it, and a press opens its card and puts no caret, as a
// ghost row's does (`ghosts.ts`).

import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { DeletedBlockKind, DeletedCell } from '@redlines/format';
import { textPx } from '../preview/theme.ts';
import { colorClass } from '../tracked/colors.ts';

/** How many rows of a table a ghost draws, the header's and the body's: the rest are one line. */
export const GHOST_ROWS = 8;

/** A stretch of a cell's text, and the color of whoever deleted it. */
export interface GhostRun {
  text: string;
  color: number;
}

/** A deleted table, as the ghost draws it. Plain data, so that two of them can be compared. */
export interface GhostTable {
  /** The columns the header has, which GFM shows: every row is drawn with that many cells. */
  columns: number;
  /** The rows of the table, the header's and the body's, drawn or not. */
  rows: number;
  /** The alignment of each column, as the delimiter row said it: `left`, `center`, `right` or none. */
  aligns: string[];
  /** The rows that are drawn, the header first, a cell for each column, each as its runs of text. */
  cells: GhostRun[][][];
  /** The color of whoever deleted the table, which the tint is. */
  color: number;
  /** Whether line break marks are shown, so that a line break in a cell has its pilcrow. */
  pilcrows: boolean;
}

/** Where each stretch of the payloads put together ends, and the color of whoever deleted it. */
interface Owner {
  to: number;
  color: number;
}

/** The cell's text as runs, in the color of the person whose deletion each stretch is. */
function runsOf(cell: DeletedCell, owners: readonly Owner[], fallback: number): GhostRun[] {
  const runs: GhostRun[] = [];
  const end = cell.at + cell.text.length;
  for (let at = cell.at; at < end;) {
    const owner = owners.find((candidate) => at < candidate.to);
    const to = Math.min(end, owner?.to ?? end);
    const color = owner?.color ?? fallback;
    const text = cell.text.slice(at - cell.at, to - cell.at);
    const last = runs.at(-1);
    if (last?.color === color) last.text += text;
    else runs.push({ text, color });
    at = to;
  }
  return runs;
}

/**
 * The ghost of a deleted table: its first rows as the reader (`deletedBlocks`) gave them, each with a
 * cell for every column the header has (a short row has empty cells, and cells past the header's are
 * left out, as GFM shows it). `owners` says whose deletion each stretch of the payloads is, and
 * `color` is the table's own.
 */
export function ghostTableOf(
  kind: Extract<DeletedBlockKind, { kind: 'table' }>,
  owners: readonly Owner[],
  color: number,
  pilcrows: boolean,
): GhostTable {
  return {
    columns: kind.columns,
    rows: kind.rowCount,
    aligns: kind.aligns,
    cells: kind.rows.slice(0, GHOST_ROWS).map((row) =>
      Array.from({ length: kind.columns }, (_, col) => {
        const cell = row[col];
        return cell ? runsOf(cell, owners, color) : [];
      }),
    ),
    color,
    pilcrows,
  };
}

/** The colors of the text of a ghost table, and its own. */
export function ghostColors(table: GhostTable): Set<number> {
  const colors = new Set([table.color]);
  for (const row of table.cells) {
    for (const cell of row) for (const run of cell) colors.add(run.color);
  }
  return colors;
}

/** How tall the widget is before it is measured: its rows, and the line that folds the rest. */
export function ghostTableHeight(table: GhostTable): number {
  return (table.cells.length + (table.rows > table.cells.length ? 1 : 0)) * 36 + 40;
}

/** A `<br>` written in a cell, as the layout of a real table draws it (`layout.ts`). */
const BREAK = /<br\s*\/?>/gi;

function element<K extends 'div' | 'span'>(
  tag: K,
  className: string,
  attributes: Record<string, string> = {},
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  el.className = className;
  for (const [name, value] of Object.entries(attributes)) el.setAttribute(name, value);
  return el;
}

/** A cell's text, as a cell of a table draws it: a line break as a line break, a pipe as a pipe. */
function fill(cell: HTMLElement, runs: readonly GhostRun[], table: GhostTable): void {
  const struck = (text: string, color: number) => {
    const span = element('span', `rl-del ${colorClass(color)}`);
    span.textContent = text.replace(/\\\|/g, '|');
    cell.append(span);
  };
  for (const run of runs) {
    let from = 0;
    for (const found of run.text.matchAll(BREAK)) {
      if (found.index > from) struck(run.text.slice(from, found.index), run.color);
      // A deleted line break, with line break marks shown, is a struck ¶ in front of the break.
      if (table.pilcrows) struck('¶', run.color);
      const line = element('span', 'rl-tbr');
      line.append(document.createElement('br'));
      cell.append(line);
      from = found.index + found[0].length;
    }
    if (from < run.text.length) struck(run.text.slice(from), run.color);
  }
  // An empty cell holds a zero-width space, so that a row of empty cells is a line high.
  if (!cell.hasChildNodes()) struck('\u200b', table.color);
}

/**
 * The widget's element: a struck block of the tracked layer's (`rl-struck`, with the deletion's id for
 * its card and its change bar, `bar`), laid out as a table. Its layout can be found in the DOM by its
 * classes: `rl-ghost-row` for each row drawn (`rl-th` the header), `rl-tc` for each cell and
 * `rl-ghost-fold` for the line that holds the rows that are not drawn.
 */
export function ghostTableDOM(table: GhostTable, mark: string, bar: string): HTMLElement {
  const more = table.rows - table.cells.length;
  const root = element('div', `rl-struck rl-ghost-table ${bar} rl-space-block`, {
    role: 'table',
    'aria-label': 'Deleted table',
    'aria-rowcount': String(table.rows),
    'aria-colcount': String(table.columns),
  });
  root.dataset['mark'] = mark;
  root.dataset['columns'] = String(table.columns);
  root.dataset['rows'] = String(table.rows);
  root.dataset['more'] = String(more);
  // The tint is the deleter's, whoever's text a cell holds.
  const scroll = element('div', `rl-ghost-scroll ${colorClass(table.color)}`);
  const grid = element('div', 'rl-ghost-grid');
  table.cells.forEach((cells, r) => {
    const row = element('div', r === 0 ? 'rl-trow rl-th rl-ghost-row' : 'rl-trow rl-ghost-row', {
      role: 'row',
      'aria-rowindex': String(r + 1),
    });
    cells.forEach((runs, c) => {
      const cell = element('span', 'rl-tc', {
        role: r === 0 ? 'columnheader' : 'cell',
        'aria-colindex': String(c + 1),
      });
      cell.dataset['col'] = String(c);
      cell.dataset['align'] = table.aligns[c] || 'default';
      fill(cell, runs, table);
      row.append(cell);
    });
    grid.append(row);
  });
  scroll.append(grid);
  if (more > 0) {
    // After the rows, as a row of one cell as wide as the table (a reader finds it as the next row).
    const fold = element('div', 'rl-ghost-fold', {
      role: 'row',
      'aria-rowindex': String(table.cells.length + 1),
    });
    const text = element('span', 'rl-ghost-fold-text', {
      role: 'cell',
      'aria-colspan': String(table.columns),
    });
    text.textContent = `and ${more} more ${more === 1 ? 'row' : 'rows'}`;
    fold.append(text);
    scroll.append(fold);
  }
  root.append(scroll);
  return root;
}

/** A press on a ghost table puts no caret there: the card the press opens is its only effect. */
const ghostTablePress = EditorView.domEventHandlers({
  mousedown(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest('.rl-ghost-table')) return false;
    event.preventDefault();
    return true;
  },
});

/**
 * The look of a ghost table, in the cells of the table's own look (`.rl-tc`, `.rl-th`: the header is
 * the header, the rule under each row, the alignments), but laid out by the browser, not by the
 * measured widths of a real table. A struck block's own bar is drawn by its box (`.rl-bar`), so the
 * box that scrolls needs no room in the margin for it.
 */
const ghostTableTheme = EditorView.baseTheme({
  // Not editable, and no text to select: the pointer is the default arrow, as over a ghost row.
  '.rl-ghost-table': { cursor: 'default', userSelect: 'none', WebkitUserSelect: 'none' },
  // A table wider than the text scrolls sideways in its own box; cells break between words, and
  // inside a word only when it can't fit (the editor's line wrapping would let them break anywhere,
  // and squeeze a column below its longest word).
  '.rl-ghost-scroll': {
    overflowX: 'auto',
    padding: `${textPx(6)} 0`,
    wordBreak: 'normal',
    overflowWrap: 'break-word',
  },
  '.rl-ghost-grid': {
    display: 'table',
    tableLayout: 'auto',
    borderCollapse: 'collapse',
    width: '100%',
    fontSize: '0.94em',
    lineHeight: '1.45',
  },
  '.rl-ghost-grid > .rl-ghost-row': { display: 'table-row' },
  '.rl-ghost-grid .rl-tc': { backgroundColor: 'var(--rl-color-tint)' },
  // The line that folds the rows not drawn: a caption under the table, on the same tint.
  '.rl-ghost-fold': {
    padding: `${textPx(8)} 0`,
    backgroundColor: 'var(--rl-color-tint)',
    borderBottom: '1px solid var(--rl-rule)',
    color: 'var(--rl-ink-2)',
    fontSize: 'var(--rl-size-ui-small-scaled)',
    lineHeight: '1.45',
  },
});

/** What a ghost table needs of the editor besides its element: its look, and its press. */
export function ghostTableLook(): Extension {
  return [ghostTableTheme, ghostTablePress];
}
