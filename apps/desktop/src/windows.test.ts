import { describe, expect, it, vi } from 'vitest';
import {
  askEachDirtyWindow,
  connectWindow,
  followFocus,
  type DocumentWindow,
  type WindowLink,
} from './windows.ts';

const clean = (label: string, path: string | null = null): DocumentWindow => ({
  label,
  path,
  dirty: false,
});
const dirty = (label: string, path: string | null = null): DocumentWindow => ({
  label,
  path,
  dirty: true,
});

describe('asking before the app quits', () => {
  it('asks each dirty window in turn and stops at Cancel', async () => {
    const windows = [dirty('main'), clean('doc-1'), dirty('doc-2'), dirty('doc-3')];
    const asked: string[] = [];
    const goesOn = await askEachDirtyWindow(
      () => Promise.resolve(windows),
      (label) => {
        asked.push(label);
        return Promise.resolve(label !== 'doc-2');
      },
    );
    expect(asked).toEqual(['main', 'doc-2']);
    expect(goesOn).toBe(false);
  });

  it('goes on once every dirty window has said so', async () => {
    const windows = [dirty('main'), clean('doc-1'), dirty('doc-2')];
    const asked: string[] = [];
    const goesOn = await askEachDirtyWindow(
      () => Promise.resolve(windows),
      (label) => {
        asked.push(label);
        return Promise.resolve(true);
      },
    );
    expect(asked).toEqual(['main', 'doc-2']);
    expect(goesOn).toBe(true);
  });

  it('asks nothing when no window has unsaved edits', async () => {
    const ask = vi.fn(() => Promise.resolve(true));
    expect(await askEachDirtyWindow(() => Promise.resolve([clean('main')]), ask)).toBe(true);
    expect(ask).not.toHaveBeenCalled();
  });

  it('leaves out a window closed or saved while another was asked, and asks none twice', async () => {
    // Don’t Save leaves a window dirty; the person answered, so it isn't asked again.
    let windows = [dirty('main'), dirty('doc-1'), dirty('doc-2')];
    const asked: string[] = [];
    const goesOn = await askEachDirtyWindow(
      () => Promise.resolve(windows),
      (label) => {
        asked.push(label);
        windows = [dirty('main'), dirty('doc-2')];
        return Promise.resolve(true);
      },
    );
    expect(asked).toEqual(['main', 'doc-2']);
    expect(goesOn).toBe(true);
  });
});

describe('the app menu', () => {
  /** A window that the test gives and takes the focus from. */
  function focusable(focused = false) {
    const handlers: Record<string, () => void> = {};
    let onFocus: (event: { payload: boolean }) => void = () => {};
    return {
      isFocused: () => Promise.resolve(focused),
      onFocusChanged(handler: (event: { payload: boolean }) => void) {
        onFocus = handler;
        return Promise.resolve(() => {});
      },
      listen(event: string, handler: () => void) {
        handlers[event] = handler;
        return Promise.resolve(() => {});
      },
      focus: (next: boolean) => onFocus({ payload: next }),
      handlers,
    };
  }
  const menuOf = () => ({ activate: vi.fn(() => Promise.resolve()) });

  it("sets this window's menu as the app's when it gets focus", async () => {
    const window = focusable();
    const menu = menuOf();
    await followFocus(window, menu);
    // Not while another window has the focus: the menu bar is that window's.
    expect(menu.activate).not.toHaveBeenCalled();

    window.focus(true);
    expect(menu.activate).toHaveBeenCalledOnce();
    window.focus(false);
    expect(menu.activate).toHaveBeenCalledOnce();
    window.focus(true);
    expect(menu.activate).toHaveBeenCalledTimes(2);
  });

  it('sets it at once when the window has the focus already', async () => {
    const menu = menuOf();
    await followFocus(focusable(true), menu);
    expect(menu.activate).toHaveBeenCalledOnce();
  });

  it('takes the menu bar over when the window whose menu it was closes', async () => {
    const window = focusable();
    const menu = menuOf();
    await followFocus(window, menu);
    window.handlers['frontmost']?.();
    expect(menu.activate).toHaveBeenCalledOnce();
  });
});

describe('a connected window', () => {
  /** Windows of the app in a test: their events go between them, and `all` is the app's list. */
  function app(all: DocumentWindow[]) {
    const handlers = new Map<string, (payload: unknown) => void>();
    const reports: [string, string | null, boolean][] = [];
    const finished: string[] = [];
    const link = (label: string): WindowLink => ({
      label,
      list: () => Promise.resolve(all),
      report: (path, isDirty) => {
        reports.push([label, path, isDirty]);
        return Promise.resolve();
      },
      listen: <T>(event: string, handler: (payload: T) => void) => {
        handlers.set(`${label} ${event}`, handler as (payload: unknown) => void);
        return Promise.resolve();
      },
      emitTo: (target, event, payload) => {
        handlers.get(`${target} ${event}`)?.(payload);
        return Promise.resolve();
      },
      quitAll: () => {
        finished.push('quit');
        return Promise.resolve();
      },
      keepRunning: () => {
        finished.push('keep running');
        return Promise.resolve();
      },
    });
    return {
      link,
      reports,
      finished,
      fromApp: (label: string, event: string) => handlers.get(`${label} ${event}`)?.(undefined),
    };
  }

  it('asks another window by its label, and waits for it to answer', async () => {
    const { link, finished } = app([dirty('doc-1'), dirty('main')]);
    let answerMain: (goOn: boolean) => void = () => {};
    const askMain = vi.fn(() => new Promise<boolean>((resolve) => (answerMain = resolve)));
    const askDoc = vi.fn(() => Promise.resolve(true));
    const doc = await connectWindow(link('doc-1'), askDoc);
    await connectWindow(link('main'), askMain);

    const quitting = doc.quit();
    await vi.waitFor(() => expect(askMain).toHaveBeenCalledOnce());
    expect(askDoc).toHaveBeenCalledOnce();
    expect(finished).toEqual([]);

    answerMain(true);
    await quitting;
    expect(finished).toEqual(['quit']);
  });

  it('keeps running when a window says Cancel, and asks no window after it', async () => {
    const { link, finished } = app([dirty('main'), dirty('doc-1'), dirty('doc-2')]);
    const askLast = vi.fn(() => Promise.resolve(true));
    const main = await connectWindow(link('main'), () => Promise.resolve(true));
    await connectWindow(link('doc-1'), () => Promise.resolve(false));
    await connectWindow(link('doc-2'), askLast);

    await main.quit();
    expect(askLast).not.toHaveBeenCalled();
    expect(finished).toEqual(['keep running']);
  });

  it('keeps running when a window can’t be asked: losing edits is worse', async () => {
    const { link, finished } = app([dirty('main')]);
    const main = await connectWindow(link('main'), () => Promise.reject(new Error('no dialog')));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await main.quit();
    expect(finished).toEqual(['keep running']);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('starts asking when the app is asked to quit from outside, as the Dock asks', async () => {
    const { link, finished, fromApp } = app([dirty('main')]);
    await connectWindow(link('main'), () => Promise.resolve(true));
    fromApp('main', 'quit-requested');
    await vi.waitFor(() => expect(finished).toEqual(['quit']));
  });

  it('asks one question at a time, however many ask', async () => {
    const { link, finished, fromApp } = app([dirty('main')]);
    let answer: (goOn: boolean) => void = () => {};
    const ask = vi.fn(() => new Promise<boolean>((resolve) => (answer = resolve)));
    const main = await connectWindow(link('main'), ask);
    const quitting = main.quit();
    fromApp('main', 'quit-requested');
    await vi.waitFor(() => expect(ask).toHaveBeenCalledOnce());
    answer(true);
    await quitting;
    expect(ask).toHaveBeenCalledOnce();
    expect(finished).toEqual(['quit']);
  });

  it('says what it holds only once it is ready, so that it isn’t given a file as it starts', async () => {
    const { link, reports } = app([clean('main')]);
    const main = await connectWindow(link('main'), () => Promise.resolve(true));
    main.reportDocument(null, false);
    main.reportDocument(null, true);
    expect(reports).toEqual([]);
    main.ready();
    expect(reports).toEqual([['main', null, true]]);
    main.reportDocument('/docs/plan.md', false);
    expect(reports[1]).toEqual(['main', '/docs/plan.md', false]);
  });

  it('lists the files open in all the windows, for the restart after an update', async () => {
    const { link } = app([clean('main', '/docs/a.md'), clean('doc-1'), dirty('doc-2', '/b.md')]);
    const main = await connectWindow(link('main'), () => Promise.resolve(true));
    expect(await main.openPaths()).toEqual(['/docs/a.md', '/b.md']);
  });
});
