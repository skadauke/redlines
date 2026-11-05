// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HOLD_CHECK_MS, holdWholeDocument, printPage } from './print.ts';

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
    const editorDom = document.createElement('div');
    const titleBar = document.createElement('div');
    const elsewhere = document.createElement('div');
    document.body.append(editorDom, titleBar, elsewhere);
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
    const parts = { print, hold, back: [editorDom, titleBar], frame: immediately };
    return { view, events, editorDom, titleBar, elsewhere, parts };
  };
  const key = (target: Element) =>
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
  const click = (target: Element) =>
    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

  afterEach(() => document.body.replaceChildren());

  it('holds the document before it asks for the dialog, a frame earlier', async () => {
    const { events, parts } = setup();
    let frameComes: () => void = () => {};
    const printing = printPage({ ...parts, frame: (callback) => (frameComes = callback) });
    await Promise.resolve();
    expect(events).toEqual(['hold']);
    frameComes();
    await printing;
    expect(events).toEqual(['hold', 'print']);
  });

  it('keeps holding while the dialog is open, however long, losing and regaining focus', async () => {
    const { view, events, parts } = setup();
    await printPage(parts);
    vi.advanceTimersByTime(60 * 60_000);
    window.dispatchEvent(new Event('blur'));
    window.dispatchEvent(new Event('focus'));
    vi.advanceTimersByTime(1000);
    expect(events).toEqual(['hold', 'print']);
    expect(view.viewState.printing).toBe(true);
  });

  it('lets go on the system’s afterprint', async () => {
    const { view, events, parts } = setup();
    await printPage(parts);
    window.dispatchEvent(new Event('afterprint'));
    expect(events).toEqual(['hold', 'print', 'release']);
    expect(view.viewState.printing).toBe(false);
  });

  it('lets go at the person’s next key in the editor, and not at one elsewhere', async () => {
    const { events, parts, editorDom, elsewhere } = setup();
    await printPage(parts);
    key(elsewhere);
    click(elsewhere);
    expect(events).not.toContain('release');
    key(editorDom);
    expect(events).toEqual(['hold', 'print', 'release']);
  });

  it('lets go at a click in the editor or the title bar, once', async () => {
    for (const part of ['editorDom', 'titleBar'] as const) {
      const setups = setup();
      await printPage(setups.parts);
      click(setups[part]);
      click(setups[part]);
      window.dispatchEvent(new Event('afterprint'));
      expect(setups.events.filter((event) => event === 'release')).toHaveLength(1);
    }
  });

  it('lets go at once when printing fails', async () => {
    const { events, parts, editorDom } = setup();
    await expect(
      printPage({ ...parts, print: () => Promise.reject(new Error('no printer')) }),
    ).rejects.toThrow('no printer');
    expect(events).toEqual(['hold', 'release']);
    key(editorDom);
    expect(events).toEqual(['hold', 'release']);
  });
});
