// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HOLD_CHECK_MS, HOLD_LIMIT_MS, holdWholeDocument, printPage } from './print.ts';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** A view whose private flag CodeMirror clears after 500 ms of printing, as its own handler does. */
function fakeView() {
  const viewState = { printing: false };
  return {
    viewState,
    requestMeasure: vi.fn(),
    /** What CodeMirror does when the page gets `beforeprint`. */
    codeMirrorPrints() {
      viewState.printing = true;
      setTimeout(() => (viewState.printing = false), 500);
    },
  };
}

const immediately = (callback: () => void) => callback();

describe('holdWholeDocument', () => {
  it('lays out the whole document at once, and keeps doing so after CodeMirror lets go', () => {
    const view = fakeView();
    const release = holdWholeDocument(view);
    expect(view.viewState.printing).toBe(true);
    expect(view.requestMeasure).toHaveBeenCalledOnce();

    // CodeMirror clears its flag at 500 ms: the hold has put it back by the next look.
    view.codeMirrorPrints();
    vi.advanceTimersByTime(500 + HOLD_CHECK_MS);
    expect(view.viewState.printing).toBe(true);
    // It was cleared and put back, with a new measure, whichever came first.
    expect(view.requestMeasure).toHaveBeenCalled();
    // Still there long after.
    vi.advanceTimersByTime(30_000);
    expect(view.viewState.printing).toBe(true);

    release();
    expect(view.viewState.printing).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(view.viewState.printing).toBe(false);
  });
});

describe('printPage', () => {
  const setup = () => {
    const view = fakeView();
    const events: string[] = [];
    const hold = vi.fn(() => {
      events.push('hold');
      const release = holdWholeDocument(view);
      return () => {
        events.push('release');
        release();
      };
    });
    const print = vi.fn(() => {
      events.push('print');
      return Promise.resolve();
    });
    return { view, events, hold, print };
  };

  it('holds the document before it asks for the dialog, a frame earlier', async () => {
    const { events, hold, print } = setup();
    let frameComes: () => void = () => {};
    const printing = printPage({ print, hold, frame: (callback) => (frameComes = callback) });
    await Promise.resolve();
    expect(events).toEqual(['hold']);
    frameComes();
    await printing;
    expect(events).toEqual(['hold', 'print']);
    window.dispatchEvent(new Event('afterprint'));
  });

  it('keeps holding while the dialog is open, however long, and lets go when it says it is done', async () => {
    const { view, events, hold, print } = setup();
    await printPage({ print, hold, frame: immediately });
    vi.advanceTimersByTime(60_000);
    expect(view.viewState.printing).toBe(true);
    window.dispatchEvent(new Event('afterprint'));
    expect(events).toEqual(['hold', 'print', 'release']);
    expect(view.viewState.printing).toBe(false);
  });

  it('lets go when the window gets its focus back from the dialog, and not before', async () => {
    const { events, hold, print } = setup();
    await printPage({ print, hold, frame: immediately });
    // A focus event without having been away, such as the page's own, is not the dialog closing.
    window.dispatchEvent(new Event('focus'));
    expect(events).not.toContain('release');
    window.dispatchEvent(new Event('blur'));
    window.dispatchEvent(new Event('focus'));
    expect(events).toEqual(['hold', 'print', 'release']);
    // Once only.
    window.dispatchEvent(new Event('afterprint'));
    expect(events.filter((event) => event === 'release')).toHaveLength(1);
  });

  it('gives up on a dialog that never says, after the limit', async () => {
    const { events, hold, print } = setup();
    await printPage({ print, hold, frame: immediately });
    vi.advanceTimersByTime(HOLD_LIMIT_MS);
    expect(events).toEqual(['hold', 'print', 'release']);
  });

  it('lets go at once when printing fails', async () => {
    const { events, hold } = setup();
    await expect(
      printPage({
        print: () => Promise.reject(new Error('no printer')),
        hold,
        frame: immediately,
      }),
    ).rejects.toThrow('no printer');
    expect(events).toEqual(['hold', 'release']);
  });
});
