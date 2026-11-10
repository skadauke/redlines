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

  // The place the next frame's correction holds (see `settle`).
  let settling: ReadingPlace | null = null;
  let frame = 0;

  /**
   * Once CodeMirror has measured and scrolled, in the same frame and before it is drawn, puts right
   * what is left: the scroll target is worked out from CodeMirror's own estimate of the new layout,
   * and the line it lands on can be a pixel or two off in WebKit. The line's real row is read and
   * the scroll moved by the difference.
   */
  const settle = () => {
    frame = 0;
    const kept = settling;
    settling = null;
    if (!kept) return;
    const coords = view.coordsAtPos(Math.min(kept.pos, view.state.doc.length));
    if (!coords) return;
    const want = marginFor(kept, 1, scroller.clientHeight - view.defaultLineHeight);
    const off = coords.top - scroller.getBoundingClientRect().top - want;
    if (Math.abs(off) > 0.25) scroller.scrollTop += off;
  };

  /** Sets the size and hands CodeMirror the place, in the one call. */
  const apply = (size: number, kept: ReadingPlace) => {
    current = size;
    applyTextSize(root, size);
    view.dispatch({ effects: placeBack(view, scroller, kept) });
    // After CodeMirror's own frame callback, which the dispatch has asked for by now (or an
    // earlier call did): callbacks of a frame run in the order they were asked for.
    settling = kept;
    if (!frame) frame = win.requestAnimationFrame(settle);
  };
  /** A change that is not a pinch: the place first, from the layout as it is. */
  const change = (size: number) => {
    const kept = readingPlace(view, scroller);
    apply(size, kept);
  };

  const stopPinch = watchPinch(win, {
    size: () => current,
    start: (point) => {
      began = current;
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
      win.cancelAnimationFrame(frame);
    },
  };
}
