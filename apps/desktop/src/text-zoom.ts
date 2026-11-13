// The text size, changed: by the keys, by a pinch and by another window. Each change keeps the
// reading place (reading-place.ts): the keys and other windows' changes keep the caret's line, else
// the top line; a pinch keeps the line under the pointer. The place goes back as a scroll target
// in the same call that sets the size, so that CodeMirror's next measure, in the next frame, lays
// the text out at the newest size and scrolls the line back before that frame is drawn: no frame
// shows a size without its place, and the pinch draws no frame of its own.

import type { EditorView } from '@codemirror/view';
import {
  marginFor,
  placeAt,
  placeBack,
  readingPlace,
  roomBelow,
  visibleTop,
  type ReadingPlace,
} from './reading-place.ts';
import { applyTextSize, stepSize, watchPinch } from './text-size.ts';

export interface TextZoomOptions {
  view: EditorView;
  scroller: HTMLElement;
  root: HTMLElement;
  /** The size in the settings now. */
  size(): number;
  save(size: number): void;
  /** Holds the rail in the state it has while the fingers are down (`ReviewController.holdRail`). */
  holdRail(held: boolean): void;
  /** The notice. */
  say(text: string): void;
}

export interface TextZoom {
  /** Larger and Smaller Text. */
  step(by: 1 | -1): void;
  /** Actual Text Size. */
  reset(): void;
  /** A size another window saved. */
  follow(size: number): void;
  stop(): void;
}

/** How long after the person's wheel or touch the correction leaves the scroll alone. */
const SCROLLING_MS = 150;

/** "Text size 150%", the notice for a size. */
const said = (size: number) => `Text size ${Math.round(size * 100)}%`;

export function followTextZoom(win: Window, options: TextZoomOptions): TextZoom {
  const { view, scroller, root } = options;
  // The size the page is laid out at, and, while the fingers are down, the line they hold.
  let current = options.size();
  let place: ReadingPlace | null = null;
  let began = current;

  // When the person last scrolled with the wheel or a touch, which `settle` leaves alone.
  let lastScrollInput = -Infinity;
  const onScrollInput = (event: Event) => {
    if (!(event instanceof WheelEvent && event.ctrlKey)) lastScrollInput = performance.now();
  };
  win.addEventListener('wheel', onScrollInput, { capture: true, passive: true });
  win.addEventListener('touchmove', onScrollInput, { capture: true, passive: true });

  // The place the frame's correction holds (see `settle`).
  let settling: ReadingPlace | null = null;
  let frame = 0;
  /**
   * After CodeMirror has measured and scrolled, in the same frame and before it is drawn, puts
   * right what is left: the scroll target is worked out from CodeMirror's estimate of the new
   * layout, and the line it lands on can be a pixel or two off in WebKit. The line's real row is
   * read and the scroll moved by the difference. It cannot be a `requestMeasure`: CodeMirror
   * applies the scroll target last in a measure, after the requests have run, and a request queued
   * to follow it would keep it from running. So it runs when CodeMirror's measure ends (see below)
   * and again in the frame's own callback.
   */
  const settle = () => {
    const kept = settling;
    if (!kept) return;
    // The person is scrolling (the wheel or a touch, not a pinch's): the scroll is theirs.
    if (performance.now() - lastScrollInput < SCROLLING_MS) return;
    const coords = view.coordsAtPos(Math.min(kept.pos, view.state.doc.length));
    if (!coords) return;
    const want = marginFor(kept, 1, roomBelow(view, scroller));
    const off = coords.top - visibleTop(view, scroller) - want;
    const before = scroller.scrollTop;
    // WebKit keeps a scroll position in whole pixels and drops a smaller step, so the position
    // is rounded: each correction leaves the line within half a pixel of where it is wanted.
    if (Math.abs(off) > 0.25) scroller.scrollTop = Math.round(before + off);
    // Where the run of changes has left the scroll: a change from here goes on with the same place.
    if (sticky && sticky.place === kept) sticky.scroll = scroller.scrollTop;
  };
  const frameEnd = () => {
    frame = 0;
    settle();
    settling = null;
  };
  // CodeMirror's frame callback calls `view.measure()`, which ends with the scroll target applied.
  // Ours follows it at once, in the same call, so that nothing is drawn between the two. (An update
  // listener would run then too, but one in the state is lost with every `setState`.)
  // (`measure` is in CodeMirror's code but not in its types.) Guarded, and chained to whatever
  // measure the view has, so that a second follower, or a CodeMirror without it, does no harm.
  type Measure = (this: EditorView, flush?: boolean) => void;
  const measuring = view as unknown as { measure?: Measure };
  const before =
    measuring.measure ?? (Object.getPrototypeOf(view) as { measure?: Measure }).measure;
  const hadOwn = Object.prototype.hasOwnProperty.call(view, 'measure');
  let stopped = false;
  const wrapper: Measure = function (this: EditorView, flush?: boolean) {
    before?.call(this, flush);
    if (!stopped && settling) settle();
  };
  if (typeof before === 'function') measuring.measure = wrapper;

  /** Sets the size and hands CodeMirror the place, in the one call. */
  const apply = (size: number, kept: ReadingPlace) => {
    current = size;
    applyTextSize(root, size);
    view.dispatch({ effects: placeBack(view, scroller, kept) });
    // After CodeMirror's own frame callback, which the dispatch has asked for by now (or an
    // earlier call did): callbacks of a frame run in the order they were asked for.
    settling = kept;
    if (!frame) frame = win.requestAnimationFrame(frameEnd);
  };
  /**
   * The place a run of keys or other windows' changes holds. Each change aims at the place the
   * first of the run took, not at the line's top as the last one left it, or the errors of single
   * steps pile up. A new place is taken when the caret, the document or the person's own scroll
   * is not where the last change left it.
   */
  let sticky: {
    place: ReadingPlace;
    head: number;
    doc: unknown;
    layout: string;
    /** Where the first correction left the scroll; NaN before it has run. */
    scroll: number;
  } | null = null;
  /** What the place was taken in: a window zoom, a resize or a switch of view makes it another. */
  const layoutKey = () =>
    [
      root.style.getPropertyValue('--rl-zoom'),
      scroller.clientWidth,
      scroller.clientHeight,
      /\brl-view-\w+/.exec(view.dom.className)?.[0],
    ].join('|');
  const stickyPlace = (): ReadingPlace => {
    const { doc, selection } = view.state;
    const head = selection.main.head;
    const layout = layoutKey();
    if (
      sticky &&
      sticky.doc === doc &&
      sticky.head === head &&
      sticky.layout === layout &&
      // Before the first correction the scroll is where the place was taken.
      (Number.isNaN(sticky.scroll) || sticky.scroll === scroller.scrollTop)
    ) {
      return sticky.place;
    }
    const place = readingPlace(view, scroller);
    sticky = { place, head, doc, layout, scroll: NaN };
    return place;
  };
  /** A change that is not a pinch. */
  const change = (size: number) => apply(size, stickyPlace());

  const stopPinch = watchPinch(win, {
    size: () => current,
    start: (point) => {
      began = current;
      sticky = null;
      place = placeAt(view, scroller, point);
      options.holdRail(true);
    },
    change: (size) => {
      if (place) apply(size, place);
    },
    end: (size) => {
      place = null;
      // Where the fingers stopped is the size; nothing snaps to the ladder.
      if (size !== began) {
        options.save(size);
        options.say(said(size));
      }
      options.holdRail(false);
    },
  });

  return {
    step(by) {
      const size = stepSize(current, by);
      if (size === current) return;
      change(size);
      options.save(size);
      options.say(said(size));
    },
    reset() {
      if (current === 1) return;
      change(1);
      options.save(1);
      options.say(said(1));
    },
    follow(size) {
      // The fingers are down: the pinch's size is the size, and is saved when they lift.
      if (place || size === current) return;
      change(size);
    },
    stop() {
      stopPinch();
      stopped = true;
      win.removeEventListener('wheel', onScrollInput, { capture: true });
      win.removeEventListener('touchmove', onScrollInput, { capture: true });
      // Our wrapper of `measure` goes if it is the view's own; if another has wrapped it since, it
      // stays in that chain, and does nothing.
      if (measuring.measure === wrapper) {
        if (hadOwn) measuring.measure = before;
        else delete measuring.measure;
      }
      win.cancelAnimationFrame(frame);
    },
  };
}
