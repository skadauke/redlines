// The text size, changed: by the keys, by a pinch and by another window. Each change keeps the
// reading place (reading-place.ts): the keys and other windows' changes keep the caret's line, else
// the top line; a pinch keeps the line under the pointer. The place goes back as a scroll target
// in the same call that sets the size, so that CodeMirror's next measure, in the next frame, lays
// the text out at the newest size and scrolls the line back before that frame is drawn: no frame
// shows a size without its place, and the pinch draws no frame of its own.

import type { EditorView } from '@codemirror/view';
import { placeAt, placeBack, readingPlace, type ReadingPlace } from './reading-place.ts';
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

  /** Sets the size and hands CodeMirror the place, in the one call. */
  const apply = (size: number, kept: ReadingPlace) => {
    current = size;
    applyTextSize(root, size);
    view.dispatch({ effects: placeBack(view, scroller, kept) });
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
    stop: stopPinch,
  };
}
