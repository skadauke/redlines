import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ASK_CHECK_MS,
  askEachDirtyWindow,
  connectWindow,
  followFocus,
  restartAfterAsking,
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

describe('asking again', () => {
  it('asks again a window that saved and then has new edits, for the Save was about the old ones', async () => {
    let windows = [dirty('main'), dirty('doc-1')];
    const asked: string[] = [];
    const goesOn = await askEachDirtyWindow(
      () => Promise.resolve(windows),
      (label) => {
        asked.push(label);
        // Save in main, whose list then shows it clean, until the person goes back and types while
        // doc-1's question is up.
        if (label === 'main' && asked.length === 1) windows = [clean('main'), dirty('doc-1')];
        else if (label === 'doc-1') windows = [dirty('main'), dirty('doc-1')];
        return Promise.resolve(true);
      },
    );
    expect(asked).toEqual(['main', 'doc-1', 'main']);
    expect(goesOn).toBe(true);
  });

  it('still asks only once a window that said Don’t Save, which stays dirty', async () => {
    const windows = [dirty('main'), dirty('doc-1')];
    const asked: string[] = [];
    await askEachDirtyWindow(
      () => Promise.resolve(windows),
      (label) => {
        asked.push(label);
        return Promise.resolve(true);
      },
    );
    expect(asked).toEqual(['main', 'doc-1']);
  });

  it('remembers across two rounds, given the same set of those asked', async () => {
    const windows = [dirty('main')];
    const ask = vi.fn(() => Promise.resolve(true));
    const asked = new Set<string>();
    await askEachDirtyWindow(() => Promise.resolve(windows), ask, asked);
    await askEachDirtyWindow(() => Promise.resolve(windows), ask, asked);
    expect(ask).toHaveBeenCalledOnce();
  });
});

describe('restarting for an update', () => {
  function steps(answers: boolean[]) {
    const calls: string[] = [];
    const askSets: unknown[] = [];
    return {
      calls,
      askSets,
      askEach: (asked?: Set<string>) => {
        calls.push('ask');
        askSets.push(asked);
        return Promise.resolve(answers.shift() ?? true);
      },
      openPaths: () => {
        calls.push('paths');
        return Promise.resolve(['/docs/a.md']);
      },
      install: () => {
        calls.push('install');
        return Promise.resolve();
      },
      relaunch: (paths: readonly string[]) => {
        calls.push(`relaunch ${paths.join()}`);
        return Promise.resolve();
      },
    };
  }

  it('asks before installing, and again right before it restarts', async () => {
    const s = steps([]);
    expect(await restartAfterAsking(s, s.install, s.relaunch)).toBe(true);
    // What was typed while it installed is asked about too.
    expect(s.calls).toEqual(['ask', 'install', 'ask', 'paths', 'relaunch /docs/a.md']);
    // A window that said Don't Save isn't asked the same question twice.
    expect(s.askSets[0]).toBeInstanceOf(Set);
    expect(s.askSets[1]).toBe(s.askSets[0]);
  });

  it('installs nothing after a Cancel', async () => {
    const s = steps([false]);
    expect(await restartAfterAsking(s, s.install, s.relaunch)).toBe(false);
    expect(s.calls).toEqual(['ask']);
  });

  it('doesn’t restart after a Cancel on edits made while it installed', async () => {
    const s = steps([true, false]);
    expect(await restartAfterAsking(s, s.install, s.relaunch)).toBe(false);
    expect(s.calls).toEqual(['ask', 'install', 'ask']);
  });
});

describe('the app menu', () => {
  /** A window that the test gives and takes the focus from. */
  function focusable(initially = false) {
    let focused = initially;
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
      focus: (next: boolean) => {
        focused = next;
        onFocus({ payload: next });
      },
      /** The focus has gone on by the time the page gets to a focus event it was sent. */
      lateFocusEvent: () => onFocus({ payload: true }),
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
    await vi.waitFor(() => expect(menu.activate).toHaveBeenCalledOnce());
    window.focus(false);
    window.focus(true);
    await vi.waitFor(() => expect(menu.activate).toHaveBeenCalledTimes(2));
  });

  it('leaves the menu bar alone when the focus has gone on by the time the page gets to it', async () => {
    // A busy page: its late menu would put another window's commands under the one in front.
    const window = focusable();
    const menu = menuOf();
    await followFocus(window, menu);
    window.lateFocusEvent();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(menu.activate).not.toHaveBeenCalled();
  });

  it('sets it at once when the window has the focus already', async () => {
    const menu = menuOf();
    await followFocus(focusable(true), menu);
    await vi.waitFor(() => expect(menu.activate).toHaveBeenCalledOnce());
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

  describe('with a window that never answers', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    /** Main quits, and doc-1, which has no page to answer, is asked. */
    async function asking() {
      vi.useFakeTimers();
      const all = [dirty('main'), dirty('doc-1'), dirty('doc-2')];
      const world = app(all);
      const askLast = vi.fn(() => Promise.resolve(true));
      const main = await connectWindow(world.link('main'), () => Promise.resolve(true));
      await connectWindow(world.link('doc-2'), askLast);
      const quitting = main.quit();
      await vi.advanceTimersByTimeAsync(0);
      return { all, world, askLast, main, quitting };
    }

    it('goes on once that window has gone: its own question closed it', async () => {
      const { all, world, askLast, quitting } = await asking();
      await vi.advanceTimersByTimeAsync(ASK_CHECK_MS * 3);
      // It is still there, and could still answer.
      expect(world.finished).toEqual([]);
      expect(askLast).not.toHaveBeenCalled();

      all.splice(1, 1);
      await vi.advanceTimersByTimeAsync(ASK_CHECK_MS);
      await quitting;
      expect(askLast).toHaveBeenCalledOnce();
      expect(world.finished).toEqual(['quit']);
    });

    it('goes on once that window is clean: its page was reloaded, or it saved', async () => {
      const { all, world, quitting } = await asking();
      all[1] = clean('doc-1');
      await vi.advanceTimersByTimeAsync(ASK_CHECK_MS);
      await quitting;
      expect(world.finished).toEqual(['quit']);
    });

    it('can quit again afterwards: nothing is left running', async () => {
      const { all, world, main, quitting } = await asking();
      all.splice(1, 1);
      await vi.advanceTimersByTimeAsync(ASK_CHECK_MS);
      await quitting;
      await main.quit();
      expect(world.finished).toEqual(['quit', 'quit']);
    });

    it('stops looking once the window has answered', async () => {
      vi.useFakeTimers();
      const all = [dirty('main'), dirty('doc-1')];
      const world = app(all);
      const list = vi.fn(() => Promise.resolve(all));
      const main = await connectWindow({ ...world.link('main'), list }, () =>
        Promise.resolve(true),
      );
      await connectWindow(world.link('doc-1'), () => Promise.resolve(true));
      await main.quit();
      const readsWhenDone = list.mock.calls.length;
      await vi.advanceTimersByTimeAsync(ASK_CHECK_MS * 5);
      expect(list.mock.calls.length).toBe(readsWhenDone);
    });
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

  it('keeps running when the question can’t be sent, and doesn’t go on looking', async () => {
    const { link, finished } = app([dirty('main'), dirty('doc-1')]);
    const list = vi.fn(() => Promise.resolve([dirty('main'), dirty('doc-1')]));
    const main = await connectWindow(
      {
        ...link('main'),
        list,
        emitTo: () => Promise.reject(new Error('no such window')),
      },
      () => Promise.resolve(true),
    );
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.useFakeTimers();
    await main.quit();
    const reads = list.mock.calls.length;
    await vi.advanceTimersByTimeAsync(ASK_CHECK_MS * 3);
    vi.useRealTimers();
    expect(list.mock.calls.length).toBe(reads);
    expect(finished).toEqual(['keep running']);
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

  describe('with a window opened for text that is still starting', () => {
    /** An Untitled window holding text, whose page hasn't said what it holds. */
    const starting = (label: string): DocumentWindow => ({
      label,
      path: null,
      dirty: false,
      starting: true,
    });

    it('holds a quit, asks nobody, and says so', async () => {
      const { link, finished } = app([clean('main'), starting('doc-1')]);
      const held = vi.fn();
      const askMain = vi.fn(() => Promise.resolve(true));
      const main = await connectWindow(link('main'), askMain, { held });
      await main.quit();
      expect(finished).toEqual(['keep running']);
      expect(askMain).not.toHaveBeenCalled();
      expect(held).toHaveBeenCalledExactlyOnceWith('quit');
    });

    it('holds it though other windows have unsaved edits, which are asked once it has reported', async () => {
      const { link, finished } = app([dirty('main'), starting('doc-1')]);
      const askMain = vi.fn(() => Promise.resolve(true));
      const main = await connectWindow(link('main'), askMain, { held: vi.fn() });
      await main.quit();
      expect(finished).toEqual(['keep running']);
      expect(askMain).not.toHaveBeenCalled();
    });

    it('asks as before once the window has reported', async () => {
      const { link, finished } = app([dirty('main'), { ...dirty('doc-1'), starting: false }]);
      const held = vi.fn();
      const main = await connectWindow(link('main'), () => Promise.resolve(true), { held });
      const doc = await connectWindow(link('doc-1'), () => Promise.resolve(true), { held });
      expect(doc).toBeDefined();
      await main.quit();
      expect(finished).toEqual(['quit']);
      expect(held).not.toHaveBeenCalled();
    });

    it('holds the restart for an update too, before anything is installed', async () => {
      const { link } = app([clean('main'), starting('doc-1')]);
      const held = vi.fn();
      const main = await connectWindow(link('main'), () => Promise.resolve(true), { held });
      const install = vi.fn(() => Promise.resolve());
      const relaunch = vi.fn(() => Promise.resolve());
      expect(await restartAfterAsking(main, install, relaunch)).toBe(false);
      expect(install).not.toHaveBeenCalled();
      expect(relaunch).not.toHaveBeenCalled();
      expect(held).toHaveBeenCalledWith('quit');
    });

    it('says so when the app holds a quit it was asked for, or this window’s close', async () => {
      const { link, fromApp } = app([clean('main')]);
      const held = vi.fn();
      await connectWindow(link('main'), () => Promise.resolve(true), { held });
      fromApp('main', 'quit-held');
      expect(held).toHaveBeenLastCalledWith('quit');
      fromApp('main', 'close-held');
      expect(held).toHaveBeenLastCalledWith('close');
      expect(held).toHaveBeenCalledTimes(2);
    });

    it('needs no one to hear of it: a window with no one to tell holds the quit all the same', async () => {
      const { link, finished } = app([clean('main'), starting('doc-1')]);
      const main = await connectWindow(link('main'), () => Promise.resolve(true));
      await main.quit();
      expect(finished).toEqual(['keep running']);
    });
  });

  it('lists the files open in all the windows, for the restart after an update', async () => {
    const { link } = app([clean('main', '/docs/a.md'), clean('doc-1'), dirty('doc-2', '/b.md')]);
    const main = await connectWindow(link('main'), () => Promise.resolve(true));
    expect(await main.openPaths()).toEqual(['/docs/a.md', '/b.md']);
  });
});
