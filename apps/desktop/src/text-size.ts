// One text size, for the document and its margin notes (not the title bar): the ladder ⌘+ and ⌘−
// walk, the pinch that walks it too, and the CSS token that carries the size.

/** The sizes, as multiples of the theme's own. 1 is the theme's size. */
export const TEXT_SIZES: readonly number[] = [0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

/** A pinch moves one step for every factor of this. Smaller steps more eagerly. */
export const PINCH_FACTOR = 1.1;

/** How much a wheel tick that stands for a pinch counts: the scale is e to this times -deltaY. */
export const WHEEL_SENSITIVITY = 0.01;

/** A wheel pinch ends when the wheel has been quiet this long. */
const WHEEL_QUIET_MS = 250;

/**
 * The steps still to move, `scale` into a pinch that has moved `stepsTaken` already: one step for
 * each whole factor of 1.1 (or 1/1.1) the fingers have gone from where they started.
 */
export function pinchSteps(scale: number, stepsTaken: number): number {
  const exact = Math.log(scale) / Math.log(PINCH_FACTOR);
  // Whole steps toward zero; the nudge keeps 1.1 × 1.1 from landing just under two.
  const whole = Math.trunc(exact + Math.sign(exact) * 1e-9);
  return whole - stepsTaken;
}

/** The place on the ladder of the size nearest `size`. */
export function sizeIndex(size: number): number {
  let nearest = 0;
  TEXT_SIZES.forEach((candidate, i) => {
    if (Math.abs(candidate - size) < Math.abs((TEXT_SIZES[nearest] ?? 1) - size)) nearest = i;
  });
  return nearest;
}

/** `size` moved `by` steps along the ladder, from the nearest size on it, and held to its ends. */
export function stepSize(size: number, by: number): number {
  const index = Math.min(TEXT_SIZES.length - 1, Math.max(0, sizeIndex(size) + by));
  return TEXT_SIZES[index] ?? 1;
}

/** Puts the size on the page, where the theme's text sizes read it. */
export function applyTextSize(root: HTMLElement, size: number): void {
  root.style.setProperty('--rl-text-scale', String(size));
}

/** What WebKit sends for a pinch: a scale, 1 where the fingers started. */
interface GestureEvent extends Event {
  scale: number;
}

/**
 * Calls `onStep` with the steps to move as a pinch on the trackpad goes on, and keeps the page
 * from magnifying itself. `onStep` returns the steps it took, which at an end of the ladder are
 * fewer than asked (or none): the pinch counts only those, so reversing it moves at once. WKWebView sends `gesturestart`, `gesturechange` and `gestureend`; other
 * webviews send a wheel with Ctrl held. Returns a function that stops it.
 */
export function watchPinch(target: Window, onStep: (by: number) => number | void): () => void {
  // Steps taken, and steps the fingers went that the ladder could not follow (past an end): the
  // pinch is counted from where the size stopped, so reversing it moves the size at once.
  let taken = 0;
  let lost = 0;
  const step = (scale: number) => {
    const by = pinchSteps(scale, taken + lost);
    if (by === 0) return;
    const done = onStep(by) ?? by;
    taken += done;
    lost += by - done;
  };

  const start = (event: Event) => {
    event.preventDefault();
    taken = 0;
    lost = 0;
  };
  const change = (event: Event) => {
    event.preventDefault();
    step((event as GestureEvent).scale);
  };
  const end = (event: Event) => event.preventDefault();

  let wheelScale = 1;
  let quiet: ReturnType<typeof setTimeout> | undefined;
  const wheel = (event: WheelEvent) => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    if (quiet === undefined) {
      taken = 0;
      lost = 0;
    }
    clearTimeout(quiet);
    quiet = setTimeout(() => {
      quiet = undefined;
      wheelScale = 1;
    }, WHEEL_QUIET_MS);
    wheelScale *= Math.exp(-event.deltaY * WHEEL_SENSITIVITY);
    step(wheelScale);
  };

  target.addEventListener('gesturestart', start);
  target.addEventListener('gesturechange', change);
  target.addEventListener('gestureend', end);
  target.addEventListener('wheel', wheel, { passive: false });
  return () => {
    clearTimeout(quiet);
    target.removeEventListener('gesturestart', start);
    target.removeEventListener('gesturechange', change);
    target.removeEventListener('gestureend', end);
    target.removeEventListener('wheel', wheel);
  };
}
