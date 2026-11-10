// The text size, changed: by the keys, by a pinch and by another window. Each change keeps the
// reading place (reading-place.ts): the keys and other windows' changes keep the caret's line, else
// the top line; a pinch keeps the line under the pointer. The place goes back as a scroll target
// in the same call that sets the size, so that CodeMirror's next measure, in the next frame, lays
// the text out at the newest size and scrolls the line back before that frame is drawn: no frame
// shows a size without its place, and the pinch draws no frame of its own.

import type { EditorView } from '@codemirror/view';
import { marginFor, placeAt, placeBack, readingPlace, type ReadingPlace } from './reading-place.ts';
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

/** "Text size 150%", the notice for a size. */
const said = (size: number) => `Text size ${Math.round(size * 100)}%`;

export function followTextZoom(win: Window, options: TextZoomOptions): TextZoom {
  const { view, scroller, root } = options;
  // The size the page is laid out at, and, while the fingers are down, the line they hold.
  let current = options.size();
  let place: ReadingPlace | null = null;
  let began = current;

  // The place the frame's correction holds (see `settle`).
  let settling: ReadingPlace | null = null;
  let frame = 0;
  // Debug only, with the checks: the order of events in a frame, in the console.
  const debug = import.meta.env.DEV && !!import.meta.env['VITE_ZOOM_CHECK'];
  const say = (what: string) =>
    debug &&
    console.warn(
      `ZOOM-DEBUG ${performance.now().toFixed(1)} ${what} scrollTop=${scroller.scrollTop}`,
    );

  /**
   * After CodeMirror has measured and scrolled, in the same frame and before it is drawn, puts
   * right what is left: the scroll target is worked out from CodeMirror's estimate of the new
   * layout, and the line it lands on can be a pixel or two off in WebKit. The line's real row is
   * read and the scroll moved by the difference. It cannot be a `requestMeasure`: CodeMirror
   * applies the scroll target last in a measure, after the requests have run, and a request queued
   * to follow it would keep it from running. So it runs when CodeMirror's measure ends (see below)
   * and again in the frame's own callback.
   */
  const settle = (source: string) => {
    const kept = settling;
    if (!kept) return say(`correct ${source} nothing pending`);
    const coords = view.coordsAtPos(Math.min(kept.pos, view.state.doc.length));
    if (!coords) return say(`correct ${source} no coordinates`);
    const want = marginFor(kept, 1, scroller.clientHeight - view.defaultLineHeight);
    const off = coords.top - scroller.getBoundingClientRect().top - want;
    const before = scroller.scrollTop;
    // WebKit keeps a scroll position in whole pixels and drops a smaller step, so the position
    // is rounded: each correction leaves the line within half a pixel of where it is wanted.
    if (Math.abs(off) > 0.25) scroller.scrollTop = Math.round(before + off);
    say(`correct ${source} residual=${off.toFixed(2)} scrollBefore=${before} top=${coords.top}`);
    // Where the run of changes has left the scroll: a change from here goes on with the same place.
    if (sticky && sticky.place === kept) sticky.scroll = scroller.scrollTop;
  };
  const frameEnd = () => {
    frame = 0;
    settle('frame');
    settling = null;
  };
  // CodeMirror's frame callback calls `view.measure()`, which ends with the scroll target applied.
  // Ours follows it at once, in the same call, so that nothing is drawn between the two. (An update
  // listener would run then too, but one in the state is lost with every `setState`.)
  // (`measure` is in CodeMirror's code but not in its types.)
  const measuring = view as unknown as { measure?: (flush?: boolean) => void };
  const own = Object.getPrototypeOf(view) as {
    measure: (this: EditorView, flush?: boolean) => void;
  };
  measuring.measure = function (this: EditorView, flush?: boolean) {
    own.measure.call(this, flush);
    if (settling) settle('measure');
  };

  /** Sets the size and hands CodeMirror the place, in the one call. */
  const apply = (size: number, kept: ReadingPlace) => {
    current = size;
    if (debug) {
      const here = view.coordsAtPos(Math.min(kept.pos, view.state.doc.length));
      say(`change size=${size} wanted=${kept.top} top=${here?.top}`);
    }
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
  let sticky: { place: ReadingPlace; head: number; doc: unknown; scroll: number } | null = null;
  const stickyPlace = (): ReadingPlace => {
    const { doc, selection } = view.state;
    const head = selection.main.head;
    if (
      sticky &&
      sticky.doc === doc &&
      sticky.head === head &&
      sticky.scroll === scroller.scrollTop
    ) {
      return sticky.place;
    }
    const place = readingPlace(view, scroller);
    sticky = { place, head, doc, scroll: NaN };
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
      // Our wrapper of `measure` goes: the view's own is its prototype's again.
      delete measuring.measure;
      win.cancelAnimationFrame(frame);
    },
  };
}
