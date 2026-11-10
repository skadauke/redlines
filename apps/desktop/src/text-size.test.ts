// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { pinchSteps, stepSize, LADDER, watchPinch } from './text-size.ts';

describe('pinchSteps', () => {
  it('moves one step for every factor of 1.1', () => {
    expect(pinchSteps(1.1, 0)).toBe(1);
    expect(pinchSteps(1.05, 0)).toBe(0);
    expect(pinchSteps(0.8, 0)).toBe(-2);
    expect(pinchSteps(1, 0)).toBe(0);
  });

  it('counts only the steps not yet taken', () => {
    expect(pinchSteps(1.21, 1)).toBe(1);
    expect(pinchSteps(1.21, 2)).toBe(0);
    // Reversing the pinch steps back.
    expect(pinchSteps(1.05, 2)).toBe(-2);
  });
});

describe('stepSize', () => {
  it('moves along the ladder', () => {
    expect(stepSize(1, 1)).toBe(1.1);
    expect(stepSize(1, -1)).toBe(0.9);
    expect(stepSize(1, 3)).toBe(1.5);
    expect(stepSize(1.1, -2)).toBe(0.9);
  });

  it('stays at the ends', () => {
    expect(stepSize(2, 1)).toBe(2);
    expect(stepSize(0.8, -1)).toBe(0.8);
    expect(stepSize(1, 99)).toBe(2);
    expect(stepSize(1, -99)).toBe(0.8);
  });

  it('steps from a size between two rungs to the next one above or below', () => {
    expect(stepSize(1.37, 1)).toBe(1.5);
    expect(stepSize(1.37, -1)).toBe(1.25);
    expect(stepSize(1.02, -1)).toBe(1);
    expect(stepSize(1.02, 1)).toBe(1.1);
    expect(stepSize(5, -1)).toBe(2);
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

function gesture(type: string, scale?: number): Event {
  const event = new Event(type, { cancelable: true });
  if (scale !== undefined) Object.defineProperty(event, 'scale', { value: scale });
  return event;
}

describe('watchPinch', () => {
  it('steps as a pinch grows and shrinks, and keeps the page from magnifying', () => {
    const onStep = vi.fn();
    const stop = watchPinch(window, onStep);
    const start = gesture('gesturestart');
    window.dispatchEvent(start);
    expect(start.defaultPrevented).toBe(true);

    const first = gesture('gesturechange', 1.25);
    window.dispatchEvent(first);
    expect(first.defaultPrevented).toBe(true);
    expect(onStep).toHaveBeenLastCalledWith(2);

    // Further along the same pinch, only the steps not yet taken.
    window.dispatchEvent(gesture('gesturechange', 1.3));
    expect(onStep).toHaveBeenCalledTimes(1);
    window.dispatchEvent(gesture('gesturechange', 1.0));
    expect(onStep).toHaveBeenLastCalledWith(-2);

    // A new pinch starts from nothing.
    window.dispatchEvent(gesture('gesturestart'));
    window.dispatchEvent(gesture('gesturechange', 0.8));
    expect(onStep).toHaveBeenLastCalledWith(-2);
    expect(window.dispatchEvent(gesture('gestureend'))).toBe(false);
    stop();
  });

  it('counts only the steps taken, so that reversing at an end of the ladder moves at once', () => {
    let size = 1.75;
    const stop = watchPinch(window, (by) => {
      const next = stepSize(size, by);
      const moved = LADDER.indexOf(next) - LADDER.indexOf(size);
      size = next;
      return moved;
    });
    window.dispatchEvent(gesture('gesturestart'));
    // Pinching out by five steps from 1.75 reaches 2 and no further.
    window.dispatchEvent(gesture('gesturechange', 1.7));
    expect(size).toBe(2);
    // Back in by one step from where the fingers were: one step down, not several to catch up.
    window.dispatchEvent(gesture('gesturechange', 1.55));
    expect(size).toBe(1.75);
    stop();
  });

  it('steps on Ctrl and wheel, which other webviews send for a pinch', () => {
    const onStep = vi.fn();
    const stop = watchPinch(window, onStep);
    const wheel = wheelEvent({ ctrlKey: true, deltaY: -20 });
    window.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(true);
    expect(onStep).toHaveBeenCalledWith(2);

    // A plain wheel scrolls.
    const scroll = wheelEvent({ deltaY: -200 });
    window.dispatchEvent(scroll);
    expect(scroll.defaultPrevented).toBe(false);
    expect(onStep).toHaveBeenCalledTimes(1);
    stop();
  });

  it('stops when told to', () => {
    const onStep = vi.fn();
    watchPinch(window, onStep)();
    window.dispatchEvent(gesture('gesturechange', 2));
    expect(onStep).not.toHaveBeenCalled();
  });
});
