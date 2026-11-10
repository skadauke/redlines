// A click on a change bar switches Simple and Redlines (design: A click in the margin). The core
// owns the click, and it never moves the text under the pointer, the caret, the selection or the
// focus: the press is taken whole, the release switches, and the line that was under the pointer
// is put back where it was.

import { type Extension, Facet, StateEffect, StateField } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  showTooltip,
  type Tooltip,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';
import { chooseViewEffects, viewModeField } from './field.ts';

/**
 * Handlers asked, in order, when a bar is clicked, with the position where its line starts; the
 * first to return true has handled the click and nothing switches. A plugin that knows a mode of
 * its own, such as the review bar's, adds one.
 */
export const barClickHandlers = Facet.define<(view: EditorView, pos: number) => boolean>();

/** The bar a pointer is over: its line (or a table row's first cell), and where the line starts. */
export interface LocatedBar {
  element: Element;
  /** The start of the bar's line. */
  pos: number;
  /** Where the element is on the screen, in the viewport's coordinates. */
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
  /** How long the pointer rests on a bar before its hint shows, in ms. Default: 400 (the title bar's). */
  hintDelay?: number;
  geometry?: BarGeometry;
}

/** How far the bar's center is from its line's left edge: 24 px left, 2 px wide (see the theme). */
const BAR_OFFSET = -23;
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

/** The real layout: found by the line at the pointer's height, or a table row's first cell. */
const pageGeometry: BarGeometry = {
  locate(view, x, y) {
    const content = view.contentDOM.getBoundingClientRect();
    if (y < content.top || y > content.bottom) return null;
    const pos = view.posAtCoords({ x: Math.max(x, content.left + 1), y }, false);
    const line = view.domAtPos(pos);
    const node = line.node instanceof Element ? line.node : line.node.parentElement;
    let element: Element | null | undefined = node ? barLine(node) : null;
    if (!element) {
      // A table row: its first cell draws the row's bar. A point inside the table is found a little
      // in from the content's edge.
      const hit = view.root.elementFromPoint(content.left + 8, y);
      element = hit?.closest('tr')?.firstElementChild;
    }
    if (!element || !view.contentDOM.contains(element)) return null;
    const rect = element.getBoundingClientRect();
    if (y < rect.top || y > rect.bottom) return null;
    return {
      element,
      pos: element.classList.contains('cm-line') ? view.lineBlockAt(pos).from : pos,
      rect,
    };
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
  const quote = found.element.classList.contains('rl-quote');
  const center = found.rect.left + (quote ? QUOTE_OFFSET : BAR_OFFSET);
  return Math.abs(x - center) <= REACH ? found : null;
}

/** The bar under the pointer, and the view that a click on it would show. */
interface Hover {
  /** The start of its line. */
  pos: number;
  /** Whether its line is a line of the editor, which is marked; a table row's cell is marked apart. */
  line: boolean;
  /** The view a click shows. */
  shows: 'simple' | 'redlines';
  /** Whether the hint shows, after the pause. */
  hint: boolean;
}

const setHover = StateEffect.define<Hover | null>();

const HINTS = {
  simple: { label: 'Show Simple', keys: '⌥⌘2' },
  redlines: { label: 'Show Redlines', keys: '⌥⌘3' },
} as const;

function hintTooltip(hover: Hover): Tooltip {
  return {
    pos: hover.pos,
    above: true,
    create() {
      const dom = document.createElement('div');
      dom.className = 'rl-bar-hint';
      dom.setAttribute('aria-hidden', 'true');
      const { label, keys } = HINTS[hover.shows];
      const keyed = document.createElement('span');
      keyed.className = 'rl-bar-hint-keys';
      keyed.textContent = keys;
      dom.append(label, keyed);
      return { dom };
    },
  };
}

const hotLine = Decoration.line({ class: 'rl-bar-hot' });

/**
 * The hovered bar: its line is drawn hot (`rl-bar-hot`) and, after the pause, a hint stands at it,
 * a tooltip in the interface's hint style.
 */
const hoverField = StateField.define<Hover | null>({
  create: () => null,
  update(value, tr) {
    const set = tr.effects.findLast((effect) => effect.is(setHover));
    if (set) return set.value;
    // The text moved, or a switch made the hint wrong.
    return tr.docChanged || tr.startState.field(viewModeField) !== tr.state.field(viewModeField)
      ? null
      : value;
  },
  provide: (field) => [
    EditorView.decorations.from(field, (hover) =>
      hover?.line ? Decoration.set([hotLine.range(hover.pos)]) : Decoration.none,
    ),
    showTooltip.from(field, (hover) => (hover?.hint ? hintTooltip(hover) : null)),
  ],
});

/**
 * The click on a change bar: Simple to Redlines and back, with the line under the pointer where it
 * was, and the hover that says so. Nothing in Clean or Raw.
 */
export function barSwitch(options: BarSwitchOptions = {}): Extension {
  const geometry = options.geometry ?? pageGeometry;
  const delay = options.hintDelay ?? 400;
  const plugin = ViewPlugin.fromClass(
    class {
      /** The press that landed on a bar's target and may become a click. */
      private press: { x: number; y: number; target: LocatedBar } | null = null;
      private hot: LocatedBar | null = null;
      private cell: Element | null = null;
      private timer: ReturnType<typeof setTimeout> | undefined;
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
        clearTimeout(this.timer);
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
        if (this.hot?.element === target.element) return;
        this.unhover();
        this.hover(target);
      };

      private readonly leave = () => this.unhover();

      private hover(target: LocatedBar): void {
        const { view } = this;
        this.hot = target;
        view.scrollDOM.style.cursor = 'pointer';
        const line = target.element.classList.contains('cm-line');
        if (!line) {
          this.cell = target.element;
          this.cell.classList.add('rl-bar-hot');
        }
        const shows = view.state.field(viewModeField) === 'simple' ? 'redlines' : 'simple';
        const hover = { pos: target.pos, line, shows, hint: false } as const;
        view.dispatch({ effects: setHover.of(hover) });
        // The hint comes after the usual pause.
        clearTimeout(this.timer);
        this.timer = setTimeout(() => {
          if (this.hot === target)
            view.dispatch({ effects: setHover.of({ ...hover, hint: true }) });
        }, delay);
      }

      /** Lets go of the hover without a transaction: the state has dropped it. */
      private release(): void {
        clearTimeout(this.timer);
        this.cell?.classList.remove('rl-bar-hot');
        this.cell = null;
        this.hot = null;
        this.view.scrollDOM.style.cursor = '';
      }

      private unhover(): void {
        if (!this.hot) return;
        this.release();
        if (this.view.state.field(hoverField)) this.view.dispatch({ effects: setHover.of(null) });
      }

      private click(target: LocatedBar): void {
        const { view } = this;
        const mode = view.state.field(viewModeField);
        if (mode !== 'simple' && mode !== 'redlines') return;
        this.unhover();
        for (const handler of view.state.facet(barClickHandlers)) {
          if (handler(view, target.pos)) return;
        }
        // The line under the pointer keeps its place: its distance from the top of the screen is
        // noted now and put back once the new view is measured. A line the new view doesn't draw
        // has the top of the one after it, which `lineTop` gives for its position.
        const before = geometry.lineTop(view, target.pos);
        const scroller = scrollerOf(view);
        const top = () => geometry.lineTop(view, Math.min(target.pos, view.state.doc.length));
        const keep = (after: number) => {
          if (Math.abs(after - before) >= 0.5) scroller.scrollTop += after - before;
        };
        view.dispatch({ effects: chooseViewEffects(mode === 'simple' ? 'redlines' : 'simple') });
        // At once, from the page as it is drawn, and again once CodeMirror has measured it, which
        // can move lines (an image that loads, a height it learns).
        keep(top());
        view.requestMeasure({ read: top, write: keep });
      }
    },
  );
  return [plugin, hoverField, barTheme];
}

const barTheme = EditorView.baseTheme({
  '.rl-bar-hint': {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '7px 10px',
    borderRadius: '8px',
    backgroundColor: 'var(--rl-tip)',
    color: '#ffffff',
    fontSize: 'var(--rl-size-ui-small)',
    lineHeight: '1',
    whiteSpace: 'nowrap',
    pointerEvents: 'none',
  },
  '.rl-bar-hint-keys': { color: 'rgb(255 255 255 / 0.62)', letterSpacing: '0.04em' },
  // A tooltip of CodeMirror's draws no frame of its own here.
  '.cm-tooltip:has(> .rl-bar-hint)': { border: 'none', backgroundColor: 'transparent' },
});
