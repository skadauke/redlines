// One text size, for the document and its margin notes (not the title bar): the ladder ⌘+ and ⌘−
// walk, the pinch that walks it too, and the CSS token that carries the size.

/** The sizes, as multiples of the theme's own. 1 is the theme's size. */
export const LADDER: readonly number[] = [0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

/** How much a wheel tick that stands for a pinch counts: the scale is e to this times -deltaY. */
export const WHEEL_SENSITIVITY = 0.01;

/** A wheel pinch ends when the wheel has been quiet this long. */
export const WHEEL_QUIET_MS = 250;

/** The least and the most a pinch makes the text, as multiples of the theme's size. */
const LEAST = 0.8;
const MOST = 2;

/** How close two sizes are to be the same: a size is a whole percent, so far inside it. */
const SAME = 1e-9;

/**
 * `size` moved `by` rungs of the ladder: up from the first rung above it, or down from the last
 * below it, so that a size between two (137%) steps to the next one (150% or 125%), and a rung to
 * its neighbor. Held at the ends of the ladder; no steps leaves the size as it is.
 */
export function stepSize(size: number, by: number): number {
  if (by === 0) return size;
  const last = LADDER.length - 1;
  if (by > 0) {
    const above = LADDER.findIndex((rung) => rung > size + SAME);
    if (above === -1) return LADDER[last] ?? 1;
    return LADDER[Math.min(last, above + by - 1)] ?? 1;
  }
  const below = LADDER.findLastIndex((rung) => rung < size - SAME);
  if (below === -1) return LADDER[0] ?? 1;
  return LADDER[Math.max(0, below + by + 1)] ?? 1;
}

/** Puts the size on the page, where the theme's text sizes read it. */
export function applyTextSize(root: HTMLElement, size: number): void {
  root.style.setProperty('--rl-text-scale', String(size));
}

/** What WebKit sends for a pinch: a scale, 1 where the fingers started. */
interface GestureEvent extends Event {
  scale: number;
}

export interface PinchHandlers {
  /** The size when a pinch begins. */
  size(): number;
  /** The pinch began, over this place in the window (null when none is known). */
  start(point: { x: number; y: number } | null): void;
  /** Each new whole-percent size. */
  change(size: number): void;
  /** Once, when the fingers lift. */
  end(size: number): void;
}

const point = (event: Event): { x: number; y: number } | null => {
  const { clientX: x, clientY: y } = event as Partial<MouseEvent>;
  return Number.isFinite(x) && Number.isFinite(y) ? { x: x as number, y: y as number } : null;
};

/**
 * Follows a pinch on the trackpad, and keeps the page from magnifying itself. The size is the one
 * when the pinch began times the gesture's scale, held between 80% and 200% and rounded to a whole
 * percent; at a limit it is held and the start is re-based, so that reversing the fingers moves it
 * at once. `change` hears each new size, `end` the last, once: at `gestureend`, when the window
 * loses the focus, or when the wheel has been quiet. WKWebView sends `gesturestart`,
 * `gesturechange` and `gestureend`; other webviews send a wheel with Ctrl held. Returns a function
 * that stops it.
 */
export function watchPinch(target: Window, handlers: PinchHandlers): () => void {
  let active = false;
  let base = 1;
  let size = 1;
  // The pointer's last place, for a gesture event that doesn't carry its own.
  let pointer: { x: number; y: number } | null = null;

  const begin = (at: { x: number; y: number } | null) => {
    active = true;
    base = size = handlers.size();
    handlers.start(at ?? pointer);
  };
  const follow = (scale: number) => {
    if (!active) return;
    let raw = base * scale;
    if (raw > MOST) base = MOST / scale;
    else if (raw < LEAST) base = LEAST / scale;
    raw = Math.min(MOST, Math.max(LEAST, raw));
    const next = Math.round(raw * 100) / 100;
    if (next === size) return;
    size = next;
    handlers.change(next);
  };

  let wheelScale = 1;
  let quiet: ReturnType<typeof setTimeout> | undefined;
  const finish = () => {
    if (!active) return;
    active = false;
    clearTimeout(quiet);
    quiet = undefined;
    wheelScale = 1;
    handlers.end(size);
  };

  const onStart = (event: Event) => {
    event.preventDefault();
    begin(point(event));
  };
  const onChange = (event: Event) => {
    event.preventDefault();
    follow((event as GestureEvent).scale);
  };
  const onEnd = (event: Event) => {
    event.preventDefault();
    finish();
  };
  const onWheel = (event: WheelEvent) => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    if (quiet === undefined) {
      wheelScale = 1;
      begin(point(event));
    }
    clearTimeout(quiet);
    quiet = setTimeout(finish, WHEEL_QUIET_MS);
    wheelScale *= Math.exp(-event.deltaY * WHEEL_SENSITIVITY);
    follow(wheelScale);
  };
  const onPointer = (event: Event) => {
    pointer = point(event);
  };

  target.addEventListener('gesturestart', onStart);
  target.addEventListener('gesturechange', onChange);
  target.addEventListener('gestureend', onEnd);
  target.addEventListener('wheel', onWheel, { passive: false });
  target.addEventListener('blur', finish);
  target.addEventListener('pointermove', onPointer, { passive: true });
  return () => {
    clearTimeout(quiet);
    target.removeEventListener('gesturestart', onStart);
    target.removeEventListener('gesturechange', onChange);
    target.removeEventListener('gestureend', onEnd);
    target.removeEventListener('wheel', onWheel);
    target.removeEventListener('blur', finish);
    target.removeEventListener('pointermove', onPointer);
  };
}

/** Keeps a page that has no text to zoom, as Preferences, from magnifying itself. */
export function ignorePinch(target: Window): () => void {
  const stop = (event: Event) => event.preventDefault();
  const wheel = (event: WheelEvent) => {
    if (event.ctrlKey) event.preventDefault();
  };
  target.addEventListener('gesturestart', stop);
  target.addEventListener('gesturechange', stop);
  target.addEventListener('gestureend', stop);
  target.addEventListener('wheel', wheel, { passive: false });
  return () => {
    target.removeEventListener('gesturestart', stop);
    target.removeEventListener('gesturechange', stop);
    target.removeEventListener('gestureend', stop);
    target.removeEventListener('wheel', wheel);
  };
}
