// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import {
  ignorePinch,
  LADDER,
  stepSize,
  TEXT_LEAST,
  TEXT_MOST,
  watchPinch,
  WHEEL_QUIET_MS,
  ZOOM_LADDER,
  type PinchHandlers,
} from './text-size.ts';

describe('the ladders', () => {
  it('give the text twice the window zoom’s reach, from 80% to 400%', () => {
    expect(LADDER).toEqual([0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4]);
    expect([TEXT_LEAST, TEXT_MOST]).toEqual([0.8, 4]);
    expect(LADDER.at(0)).toBe(TEXT_LEAST);
    expect(LADDER.at(-1)).toBe(TEXT_MOST);
  });

  it('leave the window zoom where it was, from 80% to 200%, as the app’s own ladder has it', () => {
    expect(ZOOM_LADDER).toEqual([0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]);
    for (const rung of ZOOM_LADDER) expect(LADDER).toContain(rung);
  });
});

describe('stepSize', () => {
  it('moves along the ladder', () => {
    expect(stepSize(1, 1)).toBe(1.1);
    expect(stepSize(1, -1)).toBe(0.9);
    expect(stepSize(1, 3)).toBe(1.5);
    expect(stepSize(1.1, -2)).toBe(0.9);
  });

  it('goes on past 200% to 250%, 300% and 400%, and back', () => {
    expect(stepSize(2, 1)).toBe(2.5);
    expect(stepSize(2.5, 1)).toBe(3);
    expect(stepSize(3, 1)).toBe(4);
    expect(stepSize(1, 7)).toBe(3);
    expect(stepSize(4, -1)).toBe(3);
    expect(stepSize(3, -1)).toBe(2.5);
    expect(stepSize(2.5, -1)).toBe(2);
    expect(stepSize(2.2, 1)).toBe(2.5);
    expect(stepSize(2.2, -1)).toBe(2);
    expect(stepSize(3.5, 1)).toBe(4);
    expect(stepSize(3.5, -1)).toBe(3);
  });

  it('steps along the window zoom’s own ladder when it is given, which stops at 200%', () => {
    expect(stepSize(1, 1, ZOOM_LADDER)).toBe(1.1);
    expect(stepSize(2, 1, ZOOM_LADDER)).toBe(2);
    expect(stepSize(1, 99, ZOOM_LADDER)).toBe(2);
    expect(stepSize(2, -1, ZOOM_LADDER)).toBe(1.75);
    expect(stepSize(0.8, -1, ZOOM_LADDER)).toBe(0.8);
    expect(stepSize(2.5, -1, ZOOM_LADDER)).toBe(2);
    expect(stepSize(1.37, 1, ZOOM_LADDER)).toBe(1.5);
  });

  it('stays at the ends', () => {
    expect(stepSize(4, 1)).toBe(4);
    expect(stepSize(0.8, -1)).toBe(0.8);
    expect(stepSize(1, 99)).toBe(4);
    expect(stepSize(1, -99)).toBe(0.8);
  });

  it('steps from a size between two rungs to the next one above or below', () => {
    expect(stepSize(1.37, 1)).toBe(1.5);
    expect(stepSize(1.37, -1)).toBe(1.25);
    expect(stepSize(1.02, -1)).toBe(1);
    expect(stepSize(1.02, 1)).toBe(1.1);
    expect(stepSize(5, -1)).toBe(4);
    expect(LADDER).toContain(stepSize(0.1, 1));
  });

  it('leaves a size where it is for no steps, and counts a rung as itself', () => {
    expect(stepSize(1.37, 0)).toBe(1.37);
    expect(stepSize(1.1, 1)).toBe(1.25);
    expect(stepSize(1.1, -1)).toBe(1);
  });
});

function wheelEvent(init: { ctrlKey?: boolean; deltaY: number }): Event {
  const event = new Event('wheel', { cancelable: true });
  return Object.assign(event, { ctrlKey: false, ...init });
}

function gesture(type: string, scale?: number, at?: { clientX: number; clientY: number }): Event {
  const event = new Event(type, { cancelable: true });
  if (scale !== undefined) Object.defineProperty(event, 'scale', { value: scale });
  if (at)
    Object.defineProperties(event, {
      clientX: { value: at.clientX },
      clientY: { value: at.clientY },
    });
  return event;
}

/** A pinch's handlers, over a size the test sets. */
function handlers(size = 1) {
  const made = {
    size: vi.fn(() => size),
    start: vi.fn(),
    change: vi.fn(),
    end: vi.fn(),
  } satisfies PinchHandlers;
  return made;
}

const pinch = (made: PinchHandlers) => {
  const stop = watchPinch(window, made);
  return { stop, send: (event: Event) => window.dispatchEvent(event) };
};

describe('watchPinch', () => {
  it('follows the fingers from the size it began at, to the nearest whole percent', () => {
    const made = handlers(1);
    const { stop, send } = pinch(made);
    send(gesture('gesturestart'));
    send(gesture('gesturechange', 1.37));
    send(gesture('gesturechange', 1.374));
    expect(made.change).toHaveBeenCalledTimes(1);
    expect(made.change).toHaveBeenLastCalledWith(1.37);
    send(gesture('gesturechange', 1.5));
    expect(made.change).toHaveBeenLastCalledWith(1.5);
    send(gesture('gestureend'));
    stop();
  });

  it('holds at 80% and 400%, and moves back at once when the fingers turn', () => {
    const made = handlers(3.5);
    const { stop, send } = pinch(made);
    send(gesture('gesturestart'));
    send(gesture('gesturechange', 1.2));
    expect(made.change).toHaveBeenLastCalledWith(4);
    send(gesture('gesturechange', 1.1));
    expect(made.change).toHaveBeenLastCalledWith(Math.round((4 / 1.2) * 1.1 * 100) / 100);
    // The other end.
    send(gesture('gestureend'));
    const low = handlers(0.9);
    stop();
    const second = pinch(low);
    second.send(gesture('gesturestart'));
    second.send(gesture('gesturechange', 0.5));
    expect(low.change).toHaveBeenLastCalledWith(0.8);
    second.send(gesture('gesturechange', 0.6));
    expect(low.change).toHaveBeenLastCalledWith(Math.round((0.8 / 0.5) * 0.6 * 100) / 100);
    second.stop();
  });

  it('keeps the page from magnifying itself', () => {
    const { stop, send } = pinch(handlers());
    for (const event of [
      gesture('gesturestart'),
      gesture('gesturechange', 1.2),
      gesture('gestureend'),
    ]) {
      send(event);
      expect(event.defaultPrevented).toBe(true);
    }
    stop();
  });

  it("takes the gesture's point, else the pointer's last place", () => {
    const made = handlers();
    const { stop, send } = pinch(made);
    send(gesture('gesturestart', 1, { clientX: 120, clientY: 340 }));
    expect(made.start).toHaveBeenLastCalledWith({ x: 120, y: 340 });
    send(gesture('gestureend'));
    send(gesture('gesturestart'));
    expect(made.start).toHaveBeenLastCalledWith(null);
    send(gesture('gestureend'));
    window.dispatchEvent(Object.assign(new Event('pointermove'), { clientX: 30, clientY: 40 }));
    send(gesture('gesturestart'));
    expect(made.start).toHaveBeenLastCalledWith({ x: 30, y: 40 });
    stop();
  });

  it('ends once when the fingers lift', () => {
    const made = handlers();
    const { stop, send } = pinch(made);
    send(gesture('gesturestart'));
    send(gesture('gesturechange', 1.37));
    send(gesture('gestureend'));
    send(gesture('gestureend'));
    expect(made.end).toHaveBeenCalledTimes(1);
    expect(made.end).toHaveBeenCalledWith(1.37);
    stop();
  });

  it('ends a pinch the window loses the focus in', () => {
    const made = handlers();
    const { stop, send } = pinch(made);
    send(gesture('gesturestart'));
    send(gesture('gesturechange', 1.2));
    window.dispatchEvent(new Event('blur'));
    expect(made.end).toHaveBeenCalledTimes(1);
    expect(made.end).toHaveBeenCalledWith(1.2);
    send(gesture('gestureend'));
    expect(made.end).toHaveBeenCalledTimes(1);
    // Nothing more from a gesture whose start was lost with the focus.
    send(gesture('gesturechange', 1.5));
    expect(made.change).toHaveBeenCalledTimes(1);
    stop();
  });

  it('pinches with Ctrl and the wheel, and ends when the wheel has been quiet', () => {
    vi.useFakeTimers();
    try {
      const made = handlers();
      const { stop, send } = pinch(made);
      const wheel = wheelEvent({ ctrlKey: true, deltaY: -20 });
      send(wheel);
      expect(wheel.defaultPrevented).toBe(true);
      expect(made.change).toHaveBeenCalledWith(1.22);
      expect(made.end).not.toHaveBeenCalled();
      vi.advanceTimersByTime(WHEEL_QUIET_MS);
      expect(made.end).toHaveBeenCalledWith(1.22);
      // A plain wheel scrolls.
      const scroll = wheelEvent({ deltaY: -200 });
      send(scroll);
      expect(scroll.defaultPrevented).toBe(false);
      expect(made.change).toHaveBeenCalledTimes(1);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops when told to', () => {
    const made = handlers();
    watchPinch(window, made)();
    window.dispatchEvent(gesture('gesturestart'));
    window.dispatchEvent(gesture('gesturechange', 2));
    expect(made.change).not.toHaveBeenCalled();
  });
});

describe('ignorePinch', () => {
  it('keeps Preferences from magnifying under a pinch', () => {
    const stop = ignorePinch(window);
    for (const event of [
      gesture('gesturestart'),
      gesture('gesturechange', 1.2),
      gesture('gestureend'),
      wheelEvent({ ctrlKey: true, deltaY: -20 }),
    ]) {
      window.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    }
    const scroll = wheelEvent({ deltaY: -20 });
    window.dispatchEvent(scroll);
    expect(scroll.defaultPrevented).toBe(false);
    stop();
    const after = gesture('gesturechange', 1.2);
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });
});
