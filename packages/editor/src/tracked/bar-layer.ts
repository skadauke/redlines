// The change bars of the text (design §5.5), drawn in a layer beside the screen lines that hold a
// change, as CodeMirror draws the selection: measured from where the changed text is on the screen,
// and drawn again when it wraps differently. A line of the file that wraps over several screen
// lines gets a bar only on those that hold part of a change (#320), not down the whole paragraph.
//
// The bars of table rows and of struck blocks are the line's and the block's own (`rl-bar`, drawn
// by the table's first cell and by the block), and are not drawn here.

import { type Extension, Facet, StateEffect, StateField } from '@codemirror/state';
import { Direction, EditorView, layer, type LayerMarker, RectangleMarker } from '@codemirror/view';
import { colorClass } from './colors.ts';
import { type ChangeSpan, trackedChangeSpans } from './decorations.ts';
import { viewModeField } from './field.ts';

/** How far left of the text a bar stands, in CSS pixels (the theme draws it 2 px wide). */
export const BAR_LEFT = 24;

/** The most screen lines of one line of the file that are told apart; a longer one is cut short. */
const MAX_SCREEN_LINES = 2000;

/**
 * One screen line of a line of the file: the positions it holds, and the band of the page it
 * stands for, in the viewport's coordinates. Bands touch: the first reaches the top of the line of
 * the file, with the space above its text, and the last its bottom, so that the bars of the screen
 * lines of one paragraph make one bar.
 */
export interface ScreenLine {
  from: number;
  to: number;
  top: number;
  bottom: number;
}

/**
 * A change that the page draws apart from the text, such as the struck words of a deletion, which
 * are a widget that wraps over screen lines as the text does, and whose pieces the positions can't
 * tell: where each is on the screen, in the author's color.
 */
export interface DrawnPiece {
  top: number;
  bottom: number;
  color: number;
}

/** A piece of a change bar: one or more neighboring screen lines, and the authors on them. */
export interface BarSegment {
  /** Where its first screen line starts, which says which segment it is. */
  from: number;
  /** Where its last screen line ends. */
  to: number;
  top: number;
  bottom: number;
  /** The author colors of the changes on it, sorted; one color is that author's, more are gray. */
  colors: number[];
}

/**
 * The pieces of a line's change bar: the screen lines that hold part of a change in `spans`, with
 * neighboring ones of the same colors joined. A change is on a screen line when it has text there,
 * and a point (a deletion the view hides, an inserted line break) when it stands there; at the
 * point where one screen line ends and the next begins it is on the next, and at the end of the
 * line of the file, on the last. A change that the page draws apart from the text is on the screen
 * lines its pieces are on.
 */
export function segmentsOf(
  line: { from: number; to: number },
  screen: readonly ScreenLine[],
  spans: readonly ChangeSpan[],
  drawn: readonly DrawnPiece[] = [],
): BarSegment[] {
  const colors = screen.map(() => new Set<number>());
  const last = screen.length - 1;
  for (const { from, to, color } of spans) {
    if (to < line.from || from > line.to) continue;
    screen.forEach((s, i) => {
      const on =
        from === to
          ? s.from <= from && (from < s.to || (i === last && from <= s.to))
          : from < s.to && to > s.from;
      if (on) colors[i]?.add(color);
    });
  }
  for (const { top, bottom, color } of drawn) {
    const middle = (top + bottom) / 2;
    const at = screen.findIndex(
      (s, i) => s.top <= middle && (middle < s.bottom || (i === last && middle <= s.bottom)),
    );
    if (at >= 0) colors[at]?.add(color);
  }
  const segments: BarSegment[] = [];
  let previous = -2;
  screen.forEach((s, i) => {
    const here = [...(colors[i] ?? [])].sort((a, b) => a - b);
    if (!here.length) return;
    const joined = segments.at(-1);
    if (joined && previous === i - 1 && joined.colors.join() === here.join()) {
      joined.bottom = s.bottom;
      joined.to = s.to;
    } else segments.push({ from: s.from, to: s.to, top: s.top, bottom: s.bottom, colors: here });
    previous = i;
  });
  return segments;
}

/** What the layer asks the page; the tests stand in for it, as happy-dom lays out nothing. */
export interface BarMeasure {
  /**
   * For the line of the file from `line.from` to `line.to`: where its left edge is on the screen
   * (the viewport's x), and its screen lines from the top. Null when the page doesn't draw it as a
   * line of text: a hidden line, a table's row, a page with no layout.
   */
  screenLines(
    view: EditorView,
    line: { from: number; to: number },
  ): { left: number; lines: ScreenLine[]; drawn?: DrawnPiece[] } | null;
}

/** The line of the editor that starts at `pos`, when the page draws it as a line of text. */
function lineElement(view: EditorView, pos: number): Element | null {
  const node = view.domAtPos(pos).node;
  const el = (node instanceof Element ? node : node.parentElement)?.closest('.cm-line');
  if (!el || !view.contentDOM.contains(el) || view.posAtDOM(el) !== pos) return null;
  // A table's row draws its own bar, through its first cell.
  return el.classList.contains('rl-trow') ? null : el;
}

/**
 * The struck words that the page draws in the line, in each piece they are in: a widget wraps over
 * screen lines as text does, which no position can say.
 */
function struckPieces(el: Element): DrawnPiece[] {
  const pieces: DrawnPiece[] = [];
  for (const struck of el.querySelectorAll('.rl-del')) {
    const color = /\brl-author-(\d+)\b/.exec(struck.className)?.[1];
    if (color === undefined) continue;
    for (const { top, bottom } of struck.getClientRects()) {
      if (bottom > top) pieces.push({ top, bottom, color: Number(color) });
    }
  }
  return pieces;
}

/**
 * The screen lines of a line of the file from where each stretch of its text starts and how tall
 * the text is there (`stops`, in the viewport's coordinates), and the line's own `box`. A stop on
 * the row of the one before it is no new screen line: CodeMirror gives the position before a marker
 * the view hides as the end of a row, and what follows it is on the same row. The bands of the
 * screen lines meet halfway between their text, and the first and last reach the box's top and
 * bottom, with its spacing: a bar as tall as the line where every screen line holds a change.
 */
export function bandsOf(
  stops: readonly ScreenLine[],
  box: { top: number; bottom: number },
  line: { from: number; to: number },
): ScreenLine[] {
  const rows: ScreenLine[] = [];
  for (const stop of stops) {
    const row = rows.at(-1);
    // A new row starts below the middle of the text of the one before, not below its bottom: the
    // text boxes of lines set tight overlap.
    if (row && stop.top < (row.top + row.bottom) / 2) row.to = stop.to;
    else rows.push({ ...stop });
  }
  const last = rows.at(-1);
  // The walk can stop short, where the page gives no position (a hidden range): the rest of the line
  // is the last row's.
  if (last) last.to = line.to;
  if (!rows.length) return [{ from: line.from, to: line.to, top: box.top, bottom: box.bottom }];
  return rows.map((row, i) => ({
    from: row.from,
    to: row.to,
    top: i === 0 ? box.top : ((rows[i - 1]?.bottom ?? row.top) + row.top) / 2,
    bottom:
      i === rows.length - 1 ? box.bottom : (row.bottom + (rows[i + 1]?.top ?? row.bottom)) / 2,
  }));
}

/** The vertical extent of a box on the page, in the viewport's coordinates. */
export interface Extent {
  top: number;
  bottom: number;
}

/**
 * The rows of a line of text from the rectangles of what it draws (`rects`, in any order): the
 * fragments of its text, a hidden marker's empty span, a widget, an image. Those that lie on the
 * same part of the page are one row, those that overlap by more than half of the smaller are, so
 * that an inline image that makes a row taller leaves the row below it its own. A rectangle with
 * no height, such as a line break's, is no part of a row.
 */
export function rowsOfRects(rects: readonly Extent[]): Extent[] {
  const rows: Extent[] = [];
  const sorted = rects
    .filter(({ top, bottom }) => bottom - top > 1)
    .sort((a, b) => a.top - b.top || a.bottom - b.bottom);
  for (const { top, bottom } of sorted) {
    const row = rows.at(-1);
    const overlap = row ? Math.min(row.bottom, bottom) - Math.max(row.top, top) : -1;
    if (row && overlap > 0.5 * Math.min(row.bottom - row.top, bottom - top)) {
      row.top = Math.min(row.top, top);
      row.bottom = Math.max(row.bottom, bottom);
    } else rows.push({ top, bottom });
  }
  return rows;
}

/**
 * The screen lines of a line of the file from its `rows`, with `startOf` saying where in the file
 * a row starts (the page knows: the position at the row's edge). The first starts the line, and
 * each of the others where the page says, never before the one above it or past the line's end; a
 * struck widget that wraps has one position for all its rows. Rows past a limit are one screen
 * line, the last, as tall as they are together.
 */
export function stopsOf(
  rows: readonly Extent[],
  line: { from: number; to: number },
  startOf: (row: Extent) => number,
): ScreenLine[] {
  const stops: ScreenLine[] = [];
  for (const [i, row] of rows.slice(0, MAX_SCREEN_LINES).entries()) {
    const previous = stops.at(-1);
    const from =
      i === 0 || !previous ? line.from : Math.min(Math.max(startOf(row), previous.from), line.to);
    stops.push({ from, to: line.to, top: row.top, bottom: row.bottom });
    if (previous) previous.to = from;
  }
  const last = stops.at(-1);
  const end = rows.at(-1);
  if (last && end && rows.length > MAX_SCREEN_LINES) last.bottom = end.bottom;
  return stops;
}

/** Letters of the scripts that run right to left: Hebrew, Arabic, Syriac, Thaana and their forms. */
const RIGHT_TO_LEFT = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;

/**
 * Whether `text` has letters that run right to left. Where a row mixes the two directions, its
 * edges are not where its text starts and ends, and the positions at its edges say nothing of
 * which row a change is on: such a line is one screen line, a bar down its paragraph.
 */
export const hasRightToLeft = (text: string): boolean => RIGHT_TO_LEFT.test(text);

/**
 * The real page: the screen lines found from the page's own boxes. The rows are where the
 * rectangles of the line's content lie, and each row starts at the position at its left edge.
 * Stepping through positions with `coordsAtPos` and `moveToLineBoundary` can't tell a row's end
 * from the start of the next where a hidden marker or a widget is at the wrap: the zero-width
 * nodes CodeMirror puts around it stay at the end of the row above, and the walk lost the rest of
 * the paragraph (a bar down to its end).
 */
const pageMeasure: BarMeasure = {
  screenLines(view, line) {
    const el = lineElement(view, line.from);
    if (!el) return null;
    const box = el.getBoundingClientRect();
    if (!box.height) return null;
    let stops: ScreenLine[] = [];
    if (!hasRightToLeft(view.state.sliceDoc(line.from, line.to))) {
      const range = el.ownerDocument.createRange();
      range.selectNodeContents(el);
      const rows = rowsOfRects([...range.getClientRects()]);
      stops = stopsOf(rows, line, (row) =>
        view.posAtCoords({ x: box.left + 1, y: (row.top + row.bottom) / 2 }, false),
      );
    }
    return { left: box.left, lines: bandsOf(stops, box, line), drawn: struckPieces(el) };
  },
};

/** What measures the page: the real layout, or a stand-in in a test. */
export const barMeasure = Facet.define<BarMeasure, BarMeasure>({
  combine: (values) => values[0] ?? pageMeasure,
});

/** The bar under the pointer, drawn wider: the one whose first screen line starts at `from`. */
export interface HotBar {
  from: number;
}

export const setHotBar = StateEffect.define<HotBar | null>();

export const hotBar = StateField.define<HotBar | null>({
  create: () => null,
  update(value, tr) {
    const set = tr.effects.findLast((effect) => effect.is(setHotBar));
    if (set) return set.value;
    // The text moved, or the view changed: the bar under the pointer is another.
    return tr.docChanged || tr.startState.field(viewModeField) !== tr.state.field(viewModeField)
      ? null
      : value;
  },
});

/** The pieces of the change bar of the line that holds `pos`, in the viewport's coordinates. */
export function barsOnLine(
  view: EditorView,
  pos: number,
): { left: number; segments: BarSegment[] } | null {
  const line = view.state.doc.lineAt(pos);
  const found = view.state.facet(barMeasure).screenLines(view, line);
  if (!found) return null;
  const spans = trackedChangeSpans(view.state).filter(
    ({ from, to }) => to >= line.from && from <= line.to,
  );
  return { left: found.left, segments: segmentsOf(line, found.lines, spans, found.drawn) };
}

/** The layer's own coordinates: those of the scroller's content, as CodeMirror's layers have them. */
function layerBase(view: EditorView): { left: number; top: number } {
  const rect = view.scrollDOM.getBoundingClientRect();
  const left =
    view.textDirection === Direction.LTR
      ? rect.left
      : rect.right - view.scrollDOM.clientWidth * view.scaleX;
  return {
    left: left - view.scrollDOM.scrollLeft * view.scaleX,
    top: rect.top - view.scrollDOM.scrollTop * view.scaleY,
  };
}

function markersOf(view: EditorView): readonly LayerMarker[] {
  const mode = view.state.field(viewModeField);
  if (mode !== 'redlines' && mode !== 'simple') return [];
  const { doc } = view.state;
  const { from: lo, to: hi } = view.viewport;
  // The changes in view, by the lines of the file they are on.
  const byLine = new Map<number, ChangeSpan[]>();
  for (const span of trackedChangeSpans(view.state)) {
    if (span.to < lo || span.from > hi) continue;
    const first = doc.lineAt(Math.max(span.from, lo)).number;
    const last = doc.lineAt(Math.min(span.to, hi)).number;
    for (let n = first; n <= last; n++) {
      const here = byLine.get(n);
      if (here) here.push(span);
      else byLine.set(n, [span]);
    }
  }
  if (!byLine.size) return [];
  const measure = view.state.facet(barMeasure);
  const hot = view.state.field(hotBar);
  const base = layerBase(view);
  const markers: LayerMarker[] = [];
  for (const [n, spans] of [...byLine].sort((a, b) => a[0] - b[0])) {
    const line = doc.line(n);
    const found = measure.screenLines(view, line);
    if (!found) continue;
    for (const segment of segmentsOf(line, found.lines, spans, found.drawn)) {
      const [only] = segment.colors;
      const author = segment.colors.length === 1 && only ? colorClass(only) : 'rl-bar-mixed';
      const hotClass = hot?.from === segment.from ? ' rl-bar-hot' : '';
      markers.push(
        new RectangleMarker(
          `rl-bar-seg ${author}${hotClass}`,
          found.left - BAR_LEFT * view.scaleX - base.left,
          segment.top - base.top,
          null,
          segment.bottom - segment.top,
        ),
      );
    }
  }
  return markers;
}

export const barLayerThemeSpec = {
  // A change bar: 2 px, 24 px left of the text (the layer puts the marker there), as tall as the
  // screen lines it marks.
  '.rl-bar-seg': { width: '2px', backgroundColor: 'var(--rl-color)' },
  '.rl-bar-seg.rl-bar-mixed': { backgroundColor: 'var(--rl-mixed)' },
  // Under the pointer, a bar is wider (3 px instead of 2): a click on it switches the looks.
  '.rl-bar-seg.rl-bar-hot': { width: '3px' },
};

const barLayerTheme = EditorView.baseTheme(barLayerThemeSpec);

/** The layer that draws the bars of the text, and the state of the bar under the pointer. */
export function barLayer(): Extension {
  return [
    hotBar,
    barLayerTheme,
    layer({
      above: false,
      class: 'rl-bar-layer',
      markers: markersOf,
      update: (update) =>
        update.viewportChanged ||
        trackedChangeSpans(update.state) !== trackedChangeSpans(update.startState) ||
        update.startState.field(hotBar) !== update.state.field(hotBar),
    }),
  ];
}
