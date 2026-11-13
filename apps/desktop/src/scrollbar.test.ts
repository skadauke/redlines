// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { followScrollbar } from './scrollbar.ts';

/** A scroller whose scrollbar is `width` wide (a classic one; an overlay one takes no room). */
function scrollerWith(width: number) {
  const scroller = document.createElement('div');
  let bar = width;
  Object.defineProperty(scroller, 'offsetWidth', { get: () => 800 });
  Object.defineProperty(scroller, 'clientWidth', { get: () => 800 - bar });
  return { scroller, setBar: (next: number) => (bar = next) };
}

/** A ResizeObserver that tells when it is asked to, and keeps the last callback. */
function fakeObservers() {
  const made: { callback: () => void; observed: Element[]; disconnect: () => void }[] = [];
  class Fake {
    observed: Element[] = [];
    disconnect = vi.fn();
    callback: () => void;
    constructor(callback: () => void) {
      this.callback = callback;
      made.push(this);
    }
    observe(element: Element) {
      this.observed.push(element);
    }
  }
  return { made, ResizeObserver: Fake as unknown as typeof ResizeObserver };
}

afterEach(() => document.body.replaceChildren());

describe('followScrollbar', () => {
  it('tells the page how wide the scrollbar is, which its floating title bar stops short of', () => {
    const { scroller } = scrollerWith(15);
    const page = document.createElement('div');
    followScrollbar(scroller, page, {});
    expect(page.style.getPropertyValue('--rl-scrollbar')).toBe('15px');
  });

  it('takes no room for an overlay scrollbar', () => {
    const { scroller } = scrollerWith(0);
    const page = document.createElement('div');
    followScrollbar(scroller, page, {});
    expect(page.style.getPropertyValue('--rl-scrollbar')).toBe('0px');
  });

  it('follows the scroller as it is resized, and stops when told', () => {
    const { scroller, setBar } = scrollerWith(0);
    const page = document.createElement('div');
    const { made, ResizeObserver } = fakeObservers();
    const stop = followScrollbar(scroller, page, { ResizeObserver });
    expect(made).toHaveLength(1);
    expect(made[0]?.observed).toEqual([scroller]);
    // A mouse is plugged in, and the system goes from overlay scrollbars to classic ones.
    setBar(15);
    made[0]?.callback();
    expect(page.style.getPropertyValue('--rl-scrollbar')).toBe('15px');
    stop();
    expect(made[0]?.disconnect).toHaveBeenCalledOnce();
  });
});
