// A click on a change bar switches Redlines' two looks, the simple look and the full markup, and is
// the only thing that does (design: A click in the margin). The core owns the click, and it never
// moves the text under the pointer, the caret, the selection or the focus: the press is taken
// whole, the release switches, and the line that was under the pointer is put back where it was.

import { type Extension, Facet, StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { barsOnLine, hotBar, setHotBar } from './bar-layer.ts';
import { chooseViewEffects, viewModeField } from './field.ts';

/**
 * Handlers asked, in order, when a bar is clicked, with the position where its line starts; the
 * first to return true has handled the click and nothing switches. A plugin that knows a mode of
 * its own, such as the review bar's, adds one.
 */
export const barClickHandlers =
  Facet.define<(view: EditorView, pos: number, mark?: string) => boolean>();

/**
 * The bar a pointer is over: its line (or a table row's first cell), and where the line starts. The
 * bar of a line of text is the piece of it beside one run of screen lines (`bar-layer.ts`).
 */
export interface LocatedBar {
  element: Element;
  /** The start of the bar's line. */
  pos: number;
  /**
   * For a bar of a line of text, where its first screen line starts: which piece of the line's bar
   * it is. Absent for a table row's bar and for a struck block's, which are the element's own.
   */
  from?: number;
  /** The id of the change a struck block is of, when the bar is its own (Part 3). */
  mark?: string;
  /** Where the bar is on the screen, in the viewport's coordinates. */
  rect: { left: number; top: number; bottom: number };
}

/** What the extension asks the layout; the tests stand in for it, as happy-dom lays out nothing. */
export interface BarGeometry {
  /** The bar whose line the pointer is level with, wherever it is across, or null. */
  locate(view: EditorView, x: number, y: number): LocatedBar | null;
  /** Where the line that starts at `pos` begins on the screen (the viewport's top). */
  lineTop(view: EditorView, pos: number): number;
}

export interface BarSwitchOptions {
  geometry?: BarGeometry;
}

/** How far the bar's center is from its line's left edge: 24 px left, 2 px wide (see the theme). */
const BAR_OFFSET = -23;
/** How far in from the content's edge a bar's target can reach: the margin the column keeps. */
const MARGIN_REACH = 80;
/** A quote's own border moves its bar 2 px further. */
const QUOTE_OFFSET = -25;
/** The target's reach on each side of the bar's center: 24 px wide. */
const REACH = 12;
/** The farthest the pointer may move between pressing and releasing for the press to be a click. */
const CLICK_SLOP = 4;

const barLine = (element: Element) => element.closest('.cm-line');

/**
 * What scrolls the page: the editor's own scroller when it does, else the nearest ancestor that
 * does, as in the desktop app, where the page scrolls in an element around the editor. The
 * editor's scroller when nothing scrolls (a layout that has none).
 */
function scrollerOf(view: EditorView): HTMLElement {
  const win = view.dom.ownerDocument.defaultView ?? window;
  for (let el: HTMLElement | null = view.scrollDOM; el; el = el.parentElement) {
    if (
      el.scrollHeight > el.clientHeight &&
      /auto|scroll/.test(win.getComputedStyle(el).overflowY)
    ) {
      return el;
    }
  }
  return view.scrollDOM;
}

/**
 * A struck block (a block deleted whole, drawn as a block of its own) level with `y`: its bar is
 * its own, and its element is a widget, not a line. Its position is where it stands, or for a
 * block after the last line of the text, the position after that line.
 */
function struckAt(view: EditorView, y: number): LocatedBar | null {
  for (const block of view.contentDOM.querySelectorAll<HTMLElement>('.rl-struck')) {
    const rect = block.getBoundingClientRect();
    if (y < rect.top || y > rect.bottom) continue;
    const after = block.parentElement?.dataset['after'] === 'true';
    const pos = Math.min(view.posAtDOM(block) + (after ? 1 : 0), view.state.doc.length);
    const mark = block.dataset['mark'];
    return { element: block, pos, ...(mark ? { mark } : {}), rect };
  }
  return null;
}

/** The real layout: found by the line at the pointer's height, or a table row's first cell. */
const pageGeometry: BarGeometry = {
  locate(view, x, y) {
    const content = view.contentDOM.getBoundingClientRect();
    if (y < content.top || y > content.bottom) return null;
    // The cheap test first: a bar stands in the margin, a little left of the text's column.
    if (x > content.left + MARGIN_REACH) return null;
    const struck = struckAt(view, y);
    if (struck) return struck;
    const pos = view.posAtCoords({ x: Math.max(x, content.left + 1), y }, false);
    const line = view.domAtPos(pos);
    const node = line.node instanceof Element ? line.node : line.node.parentElement;
    let element: Element | null | undefined = node ? barLine(node) : null;
    if (!element) {
      // A table row's line (`.rl-trow`; its first cell draws the bar). A point inside the table is
      // found a little in from the content's edge.
      const hit = view.root.elementFromPoint(content.left + 8, y);
      element = hit?.closest('.rl-trow');
    }
    if (!element || !view.contentDOM.contains(element)) return null;
    const isLine = element.classList.contains('cm-line');
    if (isLine && !element.classList.contains('rl-trow')) {
      // A line of text: its bar is the pieces of it beside the screen lines that hold a change, and
      // the pointer is on one only at the height of one of them, not anywhere down the paragraph.
      const from = view.lineBlockAt(pos).from;
      const found = barsOnLine(view, from);
      const piece = found?.segments.find(({ top, bottom }) => y >= top && y < bottom);
      if (!found || !piece) return null;
      return {
        element,
        pos: from,
        from: piece.from,
        rect: { left: found.left, top: piece.top, bottom: piece.bottom },
      };
    }
    const rect = element.getBoundingClientRect();
    if (y < rect.top || y > rect.bottom) return null;
    return { element, pos: isLine ? view.lineBlockAt(pos).from : pos, rect };
  },
  lineTop(view, pos) {
    // From the page itself and not from CodeMirror's heights, which a change of view does not
    // refresh for lines it can't predict, such as text that wraps once it is struck. The line the
    // view doesn't draw (a deletion alone on its line, in Simple) gives its place to the next that
    // is drawn.
    const { doc } = view.state;
    for (let n = doc.lineAt(pos).number, tries = 0; n <= doc.lines && tries < 200; n++, tries++) {
      const node = view.domAtPos(n === doc.lineAt(pos).number ? pos : doc.line(n).from).node;
      const line = (node instanceof Element ? node : node.parentElement)?.closest('.cm-line');
      if (line && view.contentDOM.contains(line)) return line.getBoundingClientRect().top;
    }
    return view.documentTop + view.lineBlockAt(pos).top;
  },
};

/** The bar the pointer is on the target of, or null. */
function targetAt(
  view: EditorView,
  geometry: BarGeometry,
  x: number,
  y: number,
): LocatedBar | null {
  const mode = view.state.field(viewModeField);
  if (mode !== 'simple' && mode !== 'redlines') return null;
  const found = geometry.locate(view, x, y);
  if (!found || !found.element.classList.contains('rl-bar')) return null;
  // A struck quote's own border moves its bar; the layer draws a line of text's bar in one place.
  const quote = found.from === undefined && found.element.classList.contains('rl-quote');
  const center = found.rect.left + (quote ? QUOTE_OFFSET : BAR_OFFSET);
  return Math.abs(x - center) <= REACH ? found : null;
}

const setHover = StateEffect.define<number | null>();

const hotLine = Decoration.line({ class: 'rl-bar-hot' });

/**
 * The line of a table's row whose bar is under the pointer, which is drawn hot (`rl-bar-hot`): the
 * row's first cell draws its bar. The bar of a line of text is drawn hot by the layer
 * (`bar-layer.ts`), and a struck block's by its own element.
 */
const hoverField = StateField.define<number | null>({
  create: () => null,
  update(value, tr) {
    const set = tr.effects.findLast((effect) => effect.is(setHover));
    if (set) return set.value;
    // The text moved, or a switch made it wrong.
    return tr.docChanged || tr.startState.field(viewModeField) !== tr.state.field(viewModeField)
      ? null
      : value;
  },
  provide: (field) =>
    EditorView.decorations.from(field, (pos) =>
      pos === null ? Decoration.none : Decoration.set([hotLine.range(pos)]),
    ),
});

/**
 * The click on a change bar: Redlines' simple look to its full markup and back, with the line
 * under the pointer where it was. The bar under the pointer draws wider, and the pointer is a hand
 * over it. Nothing in Clean or Raw.
 */
export function barSwitch(options: BarSwitchOptions = {}): Extension {
  const geometry = options.geometry ?? pageGeometry;
  const plugin = ViewPlugin.fromClass(
    class {
      /** The press that landed on a bar's target and may become a click. */
      private press: { x: number; y: number; target: LocatedBar } | null = null;
      private hot: LocatedBar | null = null;
      private cell: Element | null = null;
      private readonly view: EditorView;

      constructor(view: EditorView) {
        this.view = view;
        const { scrollDOM } = view;
        // The press is taken before the editor's own handler sees it, so that it starts no selection.
        scrollDOM.addEventListener('mousedown', this.down, true);
        scrollDOM.addEventListener('mousemove', this.move);
        scrollDOM.addEventListener('mouseleave', this.leave);
        view.dom.ownerDocument.addEventListener('mouseup', this.up, true);
      }

      update(update: ViewUpdate): void {
        // A switch or an edit leaves the hover wrong; the field has let go of it already.
        const switched =
          update.startState.field(viewModeField) !== update.state.field(viewModeField);
        if ((switched || update.docChanged) && this.hot) this.release();
      }

      destroy(): void {
        const { scrollDOM } = this.view;
        scrollDOM.removeEventListener('mousedown', this.down, true);
        scrollDOM.removeEventListener('mousemove', this.move);
        scrollDOM.removeEventListener('mouseleave', this.leave);
        this.view.dom.ownerDocument.removeEventListener('mouseup', this.up, true);
      }

      private readonly down = (event: MouseEvent) => {
        this.press = null;
        if (event.button !== 0) return;
        const target = targetAt(this.view, geometry, event.clientX, event.clientY);
        // A press with a modifier isn't the bar's, and does what a press in the margin does.
        if (!target || event.metaKey || event.altKey || event.shiftKey || event.ctrlKey) return;
        // Taken whole: no selection, no focus. The second click of a double-click does nothing.
        event.preventDefault();
        event.stopPropagation();
        this.unhover();
        if (event.detail > 1) return;
        this.press = { x: event.clientX, y: event.clientY, target };
      };

      private readonly up = (event: MouseEvent) => {
        const { press } = this;
        this.press = null;
        if (!press) return;
        event.preventDefault();
        event.stopPropagation();
        if (Math.hypot(event.clientX - press.x, event.clientY - press.y) >= CLICK_SLOP) return;
        this.click(press.target);
      };

      private readonly move = (event: MouseEvent) => {
        if (this.press) return;
        const target = targetAt(this.view, geometry, event.clientX, event.clientY);
        if (!target) return this.unhover();
        if (this.hot?.element === target.element && this.hot.from === target.from) return;
        this.unhover();
        this.hover(target);
      };

      private readonly leave = () => this.unhover();

      private hover(target: LocatedBar): void {
        const { view } = this;
        this.hot = target;
        view.scrollDOM.style.cursor = 'pointer';
        if (target.from !== undefined) {
          // The bar of a line of text, which the layer draws wider.
          view.dispatch({ effects: setHotBar.of({ from: target.from }) });
        } else if (target.element.classList.contains('cm-line')) {
          // A table's row, whose first cell draws its bar: its line is the hot one.
          view.dispatch({ effects: setHover.of(target.pos) });
        } else {
          // A struck block or a ghost row, which draw their own.
          this.cell = target.element;
          this.cell.classList.add('rl-bar-hot');
        }
      }

      /** Lets go of the hover without a transaction: the state has dropped it. */
      private release(): void {
        this.cell?.classList.remove('rl-bar-hot');
        this.cell = null;
        this.hot = null;
        this.view.scrollDOM.style.cursor = '';
      }

      private unhover(): void {
        if (!this.hot) return;
        this.release();
        const { state } = this.view;
        const effects = [
          ...(state.field(hotBar) ? [setHotBar.of(null)] : []),
          ...(state.field(hoverField) !== null ? [setHover.of(null)] : []),
        ];
        if (effects.length) this.view.dispatch({ effects });
      }

      private click(target: LocatedBar): void {
        const { view } = this;
        const mode = view.state.field(viewModeField);
        if (mode !== 'simple' && mode !== 'redlines') return;
        this.unhover();
        for (const handler of view.state.facet(barClickHandlers)) {
          if (handler(view, target.pos, target.mark)) return;
        }
        // The line under the pointer keeps its place: its distance from the top of the screen is
        // noted now and put back once the new view is measured. A line the new view doesn't draw
        // has the top of the one after it, which `lineTop` gives for its position.
        // A struck block is no line: it is its own top, and Simple, which doesn't draw it, gives its
        // place to the block after it (`target.pos` is where that begins).
        const struck = target.element.classList.contains('rl-struck') && target.element.isConnected;
        const before = struck
          ? target.element.getBoundingClientRect().top
          : geometry.lineTop(view, target.pos);
        const top = () => geometry.lineTop(view, Math.min(target.pos, view.state.doc.length));
        const keep = (after: number) => {
          // Chosen now, after the switch: a document that fits the window in Simple has no
          // scrolling ancestor until Redlines makes the page taller.
          if (Math.abs(after - before) >= 0.5) scrollerOf(view).scrollTop += after - before;
        };
        view.dispatch({ effects: chooseViewEffects(mode === 'simple' ? 'redlines' : 'simple') });
        // At once, from the page as it is drawn, and again once CodeMirror has measured it, which
        // can move lines (an image that loads, a height it learns).
        keep(top());
        view.requestMeasure({ read: top, write: keep });
      }
    },
  );
  return [plugin, hoverField];
}
