// Column widths (design: tables, "Column widths and wide tables"). Widths are computed, not left to
// the browser, and laid out fixed: each column's width is found from the newest text of every row,
// those off screen included, measured on a canvas with the fonts the cells use, as a browser's
// automatic table layout would: each column between its longest word and its longest line, the table
// filling the text column when its lines fit, and narrower columns sharing what is left when they
// don't. A view plugin measures (in a `requestMeasure` read) and, after the update, dispatches the
// widths as an effect; the field keeps them, and the plugin writes them as `--w0`, `--w1`… in a style
// rule for each table's `data-table` id.
//
// Widths hold while the caret is in the table, and are found again when it leaves, after a row or a
// column changes, a paste, a change of the text size or the window's size, and when fonts load: a
// column that widened with each keystroke would move every other column under the person's eyes.

import { syntaxTree } from '@codemirror/language';
import {
  type EditorState,
  Facet,
  StateEffect,
  StateField,
  type Transaction,
} from '@codemirror/state';
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { viewModeField } from '../tracked/field.ts';
import { type Cell, type Table, tablesOf } from './model.ts';

/** The widths of a text, in pixels: of its longest word, and of its longest line. */
export interface Measured {
  longestWord: number;
  longestLine: number;
}

/**
 * The widths of the columns of a table of cells' text. Each is between its longest word and its
 * longest line; the table fills `available` when the lines fit, and the columns share what is left
 * above their longest words when they don't. Where even the longest words don't fit the widths are
 * the longest words, and the table scrolls.
 */
export function columnWidths(
  cells: readonly (readonly string[])[],
  measure: (text: string, row: number) => Measured,
  available: number,
): number[] {
  const columns = Math.max(0, ...cells.map((row) => row.length));
  const min: number[] = new Array<number>(columns).fill(0);
  const max: number[] = new Array<number>(columns).fill(0);
  cells.forEach((row, r) => {
    row.forEach((text, c) => {
      const found = measure(text, r);
      min[c] = Math.max(min[c] ?? 0, found.longestWord);
      max[c] = Math.max(max[c] ?? 0, found.longestLine, found.longestWord);
    });
  });
  const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
  const smallest = sum(min);
  const widest = sum(max);
  let widths: number[];
  if (widest <= available) {
    // Everything fits on a line: the table fills the text column, in proportion to the lines.
    widths =
      widest > 0 ? max.map((w) => (w * available) / widest) : max.map(() => available / columns);
  } else if (smallest < available) {
    const share = (available - smallest) / (widest - smallest);
    widths = min.map((w, i) => w + ((max[i] ?? w) - w) * share);
  } else widths = min;
  // Whole pixels, never more than there is room for.
  return widths.map((w) => Math.floor(w * 100) / 100);
}

/** A measure that remembers what it measured, by the text and the kind of row. */
export function cachedMeasure(
  measure: (text: string, row: number) => Measured,
): (text: string, row: number) => Measured {
  const seen = new Map<string, Measured>();
  return (text, row) => {
    const key = `${row === 0 ? 'h' : 'b'}\0${text}`;
    let found = seen.get(key);
    if (!found) {
      found = measure(text, row);
      seen.set(key, found);
    }
    return found;
  };
}

/** What a cell shows: the newest text, with no marker, a pipe unescaped, a `<br>` a line break. */
export function cellShows(text: string): string {
  return text
    .replace(/<!--[^]*?-->/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/\\\|/g, '|');
}

interface Span {
  from: number;
  to: number;
}

/** The stretches of `from`..`to` that the preview hides when the caret is elsewhere: the marks of
 * emphasis, code and strikethrough, a link's brackets and destination (its text shows), an image's
 * syntax (its alt text stands in for the picture) and an autolink's angle brackets. */
function hiddenSyntax(state: EditorState, from: number, to: number): Span[] {
  const hidden: Span[] = [];
  const hide = (a: number, b: number) => {
    if (Math.min(b, to) > Math.max(a, from))
      hidden.push({ from: Math.max(a, from), to: Math.min(b, to) });
  };
  syntaxTree(state).iterate({
    from,
    to,
    enter: (node) => {
      switch (node.name) {
        case 'EmphasisMark':
        case 'CodeMark':
        case 'StrikethroughMark':
          hide(node.from, node.to);
          break;
        case 'Link':
        case 'Image': {
          const marks = node.node.getChildren('LinkMark');
          const open = marks[0];
          const close = marks[1];
          // A bracketed phrase with no destination or label stays text.
          if (!open || !close || !(node.node.getChild('URL') || node.node.getChild('LinkLabel'))) {
            break;
          }
          hide(node.from, open.to);
          hide(close.from, node.to);
          break;
        }
        case 'Autolink':
          for (const mark of node.node.getChildren('LinkMark')) hide(mark.from, mark.to);
          break;
      }
    },
  });
  return hidden.toSorted((a, b) => a.from - b.from || b.to - a.to);
}

/** What a cell shows with the caret elsewhere: its text without the syntax the preview hides, with
 * what `cellShows` reads of the rest. */
export function shownText(state: EditorState, cell: Cell): string {
  let text = '';
  let at = cell.textFrom;
  for (const range of hiddenSyntax(state, cell.textFrom, cell.textTo)) {
    if (range.to <= at) continue;
    if (range.from > at) text += state.sliceDoc(at, range.from);
    at = Math.max(at, range.to);
  }
  text += state.sliceDoc(at, cell.textTo);
  return cellShows(text);
}

/** The text of every row of a table, as it reads. */
function cellsOf(state: EditorState, table: Table): string[][] {
  return table.rows.map((row) =>
    row.cells.filter((cell) => cell.col < table.columns).map((cell) => shownText(state, cell)),
  );
}

/** What the plugin asks of the page: how wide a text is, and the room there is. Replaced by tests,
 * which have no layout. */
export interface WidthEnvironment {
  /** A measure for this view, with the cells' fonts: of a header cell or of a body cell. */
  measure(view: EditorView): (text: string, row: number) => Measured;
  /** The width of the text column a table of this view fills, or 0 where nothing is laid out. */
  available(view: EditorView): number;
  /** A signature of what makes widths stale when it changes: the font and the room. */
  signature(view: EditorView): string;
}

/** Longest word and line of a text in a canvas, with the font of the cell it is for. */
function canvasMeasure(view: EditorView): (text: string, row: number) => Measured {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  const body = fontOf(view, false);
  const header = fontOf(view, true);
  const width = (text: string, font: CellFont) => {
    if (!context) return text.length * 8;
    context.font = font.font;
    const shown = font.upper ? text.toUpperCase() : text;
    return context.measureText(shown).width + shown.length * font.spacing;
  };
  return cachedMeasure((text, row) => {
    const font = row === 0 ? header : body;
    let longestWord = 0;
    let longestLine = 0;
    for (const line of text.split('\n')) {
      longestLine = Math.max(longestLine, width(line, font));
      for (const word of line.split(/\s+/)) longestWord = Math.max(longestWord, width(word, font));
    }
    return {
      longestWord: longestWord + font.padding,
      longestLine: longestLine + font.padding,
    };
  });
}

interface CellFont {
  font: string;
  upper: boolean;
  spacing: number;
  /** A cell's horizontal padding, which the column's width includes. */
  padding: number;
}

/** The font of a cell of the table: found from a cell on the page, or worked out from the editor's. */
function fontOf(view: EditorView, header: boolean): CellFont {
  const cell = view.contentDOM.querySelector<HTMLElement>(
    header ? '.rl-th .rl-tc' : '.rl-trow:not(.rl-th) .rl-tc',
  );
  const style = getComputedStyle(cell ?? view.contentDOM);
  const size = Number.parseFloat(style.fontSize) || 16;
  const scaled = cell ? size : size * 0.94;
  return {
    font: `${style.fontStyle === 'italic' ? 'italic ' : ''}${header && !cell ? '700' : style.fontWeight || '400'} ${scaled}px ${style.fontFamily || 'sans-serif'}`,
    upper: style.textTransform === 'uppercase',
    spacing: Number.parseFloat(style.letterSpacing) || 0,
    padding: cell
      ? (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0)
      : 16,
  };
}

/** The width of the text column: the first table's scrolling box without its padding. */
function roomOf(view: EditorView): number {
  const box = view.contentDOM.querySelector<HTMLElement>('.rl-tbl-scroll');
  const content = view.contentDOM;
  const style = getComputedStyle(box ?? content);
  const room = box
    ? box.clientWidth -
      (Number.parseFloat(style.paddingLeft) || 0) -
      (Number.parseFloat(style.paddingRight) || 0)
    : content.clientWidth -
      (Number.parseFloat(style.paddingLeft) || 0) -
      (Number.parseFloat(style.paddingRight) || 0);
  return Math.max(0, Math.floor(room));
}

const pageEnvironment: WidthEnvironment = {
  measure: canvasMeasure,
  available: roomOf,
  signature(view) {
    const style = getComputedStyle(view.contentDOM);
    return `${roomOf(view)} ${style.fontSize} ${style.fontFamily}`;
  },
};

/** A table's widths, and whether its columns are wider than the room, so that it scrolls. They are
 * for the table with this identity, whatever place it has by the time they arrive. */
export interface TableWidths {
  id: number;
  columns: readonly number[];
  scrolls: boolean;
}

/** The environment widths are measured in: the page's, unless a test gives another. */
export const widthEnvironment = Facet.define<WidthEnvironment, WidthEnvironment>({
  combine: (found) => found[0] ?? pageEnvironment,
});

/** The widths of each table, as last measured. */
const setWidths = StateEffect.define<readonly TableWidths[]>();

export const widthsField = StateField.define<readonly TableWidths[]>({
  create: () => [],
  update(widths, tr) {
    for (const effect of tr.effects) if (effect.is(setWidths)) return effect.value;
    return widths;
  },
});

/** The widths last measured, by table. */
export function widthsOf(state: EditorState): readonly TableWidths[] {
  return state.field(widthsField);
}

/** The index of the table that holds the caret, or -1. */
function tableOfCaret(state: EditorState): number {
  const head = state.selection.main.head;
  return tablesOf(state).findIndex((table) => table.from <= head && head <= table.to);
}

/** Whether a transaction is what changes widths: a paste, or a drop. */
const isPaste = (tr: Transaction) => tr.isUserEvent('input.paste') || tr.isUserEvent('input.drop');

/** The rule that gives each table its widths. */
function rulesFor(widths: readonly TableWidths[]): string {
  return widths
    .map(({ id, columns, scrolls }) => {
      const sum = columns.reduce((a, b) => a + b, 0);
      const vars = columns.map((w, i) => `--w${i}:${w}px;`).join('');
      // Fills the text column; when the columns can't fit it, as wide as they are, and scrolls.
      const size = scrolls ? `width:${sum}px;` : '';
      const cells = columns
        .map((_w, i) => `.rl-tbl[data-table="${id}"] .rl-tc[data-col="${i}"]{width:var(--w${i})}`)
        .join('');
      return `.rl-tbl[data-table="${id}"]{${vars}${size}}${cells}`;
    })
    .join('\n');
}

class WidthPlugin {
  private measured = false;
  private destroyed = false;
  private signature = '';
  private readonly view: EditorView;
  private readonly style: HTMLStyleElement;
  private readonly onResize = () => this.measure();
  private readonly onFonts = () => this.measure();

  private get environment(): WidthEnvironment {
    return this.view.state.facet(widthEnvironment);
  }

  constructor(view: EditorView) {
    this.view = view;
    this.style = document.createElement('style');
    this.style.dataset['rlWidths'] = '';
    view.dom.append(this.style);
    window.addEventListener('resize', this.onResize);
    document.fonts?.addEventListener?.('loadingdone', this.onFonts);
    this.measure();
  }

  update(update: ViewUpdate): void {
    if (update.state.field(widthsField) !== update.startState.field(widthsField)) {
      this.style.textContent = rulesFor(update.state.field(widthsField));
    }
    if (update.state === update.startState) return;
    const was = tablesOf(update.startState);
    const now = tablesOf(update.state);
    const structure =
      now.length !== was.length ||
      now.some((t) => {
        const old = was.find((w) => w.id === t.id);
        return !old || t.rows.length !== old.rows.length || t.columns !== old.columns;
      });
    const left = tableOfCaret(update.startState);
    const leaves = left >= 0 && tableOfCaret(update.state) !== left;
    const mode =
      update.startState.field(viewModeField, false) !== update.state.field(viewModeField, false);
    const pasted = update.transactions.some(isPaste);
    if (!this.measured || structure || leaves || mode || pasted) this.measure();
    else if (update.geometryChanged) this.checkEnvironment();
  }

  /** A change of the text size or of the room, which geometry changes show. */
  private checkEnvironment(): void {
    this.view.requestMeasure({
      key: this,
      read: (view) => this.environment.signature(view),
      write: (signature) => {
        if (signature !== this.signature) this.measure();
      },
    });
  }

  /** Measures every table, after this update, and keeps what it finds. */
  measure(): void {
    if (this.destroyed) return;
    this.view.requestMeasure({
      key: this,
      read: (view) => {
        const tables = tablesOf(view.state);
        const room = this.environment.available(view);
        const signature = this.environment.signature(view);
        if (tables.length === 0 || room <= 0) return { signature, widths: null };
        const measure = this.environment.measure(view);
        return {
          signature,
          widths: tables.map((table): TableWidths => {
            const columns = columnWidths(cellsOf(view.state, table), measure, room);
            return { id: table.id, columns, scrolls: columns.reduce((a, b) => a + b, 0) > room };
          }),
        };
      },
      write: ({ signature, widths }) => {
        this.signature = signature;
        if (!widths) return;
        this.measured = true;
        // After this update: a dispatch can't be made while one is being written.
        queueMicrotask(() => {
          if (!this.destroyed) this.view.dispatch({ effects: setWidths.of(widths) });
        });
      },
    });
  }

  destroy(): void {
    this.destroyed = true;
    window.removeEventListener('resize', this.onResize);
    document.fonts?.removeEventListener?.('loadingdone', this.onFonts);
    this.style.remove();
  }
}

/** Column widths, computed from every row and held while the caret is in the table. */
export function tableWidths() {
  return [widthsField, ViewPlugin.define((view) => new WidthPlugin(view))];
}
