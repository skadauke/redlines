// The change bars of the text (design §5.5), drawn in a layer beside the screen lines that hold a
// change, as CodeMirror draws the selection: measured from where the changed text is on the screen,
// and drawn again when it wraps differently. A line of the file that wraps over several screen
// lines gets a bar only on those that hold part of a change (#320), not down the whole paragraph.
//
// The bars of table rows and of struck blocks are the line's and the block's own (`rl-bar`, drawn
// by the table's first cell and by the block), and are not drawn here.

import { EditorSelection, type Extension, Facet, StateEffect, StateField } from '@codemirror/state';
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
    } else segments.push({ from: s.from, top: s.top, bottom: s.bottom, colors: here });
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

/** The real page: the screen lines found by where CodeMirror says each one starts and ends. */
const pageMeasure: BarMeasure = {
  screenLines(view, line) {
    const el = lineElement(view, line.from);
    if (!el) return null;
    const box = el.getBoundingClientRect();
    if (!box.height) return null;
    // Where each screen line starts, its end and the text's own height there.
    const found: ScreenLine[] = [];
    for (let pos = line.from; found.length < MAX_SCREEN_LINES;) {
      const coords = view.coordsAtPos(pos, 1);
      if (!coords) break;
      let end = Math.min(
        line.to,
        view.moveToLineBoundary(EditorSelection.cursor(pos, 1), true).head,
      );
      // A boundary that doesn't go on leaves the rest of the line as one screen line.
      if (end <= pos || found.length === MAX_SCREEN_LINES - 1) end = line.to;
      found.push({ from: pos, to: end, top: coords.top, bottom: coords.bottom });
      if (end >= line.to) break;
      pos = end;
    }
    const drawn = struckPieces(el);
    if (!found.length) {
      return {
        left: box.left,
        lines: [{ from: line.from, to: line.to, top: box.top, bottom: box.bottom }],
        drawn,
      };
    }
    // The bands meet halfway between the text of neighboring screen lines, and the first and last
    // reach the line's own top and bottom, with its spacing: a bar as tall as the line, as before.
    return {
      left: box.left,
      drawn,
      lines: found.map((s, i) => ({
        from: s.from,
        to: s.to,
        top: i === 0 ? box.top : ((found[i - 1]?.bottom ?? s.top) + s.top) / 2,
        bottom:
          i === found.length - 1 ? box.bottom : (s.bottom + (found[i + 1]?.top ?? s.bottom)) / 2,
      })),
    };
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
