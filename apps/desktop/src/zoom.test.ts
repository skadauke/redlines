// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stepSize } from './text-size.ts';
import {
  applyZoom,
  followZoom,
  initialZoom,
  REPORT_WAIT_MS,
  RESIZE_WAIT_MS,
  ZOOM_EVENT,
  type ZoomLink,
  type ZoomOptions,
} from './zoom.ts';

const script = window as unknown as { __REDLINES_ZOOM__?: unknown };

function fakeLink(answer: number) {
  let handler: (level: number) => void = () => {};
  const link = {
    set: vi.fn<ZoomLink['set']>(() => Promise.resolve()),
    report: vi.fn<ZoomLink['report']>(() => Promise.resolve(answer)),
    listen: vi.fn<ZoomLink['listen']>((next) => {
      handler = next;
      return Promise.resolve();
    }),
  };
  return { link, event: (level: number) => handler(level) };
}

function setup(options: { level?: number; settings?: number; answer?: number } = {}) {
  const level = options.level ?? 1;
  const { link, event } = fakeLink(options.answer ?? level);
  const root = document.documentElement;
  root.style.removeProperty('--rl-zoom');
  applyZoom(root, level);
  const calls: ZoomOptions = {
    root,
    win: window,
    level,
    settings: vi.fn(() => options.settings ?? level),
    save: vi.fn(),
    before: vi.fn(),
    after: vi.fn(),
  };
  const zoomOf = () => root.style.getPropertyValue('--rl-zoom');
  return { link, event, calls, zoomOf, start: () => followZoom(link, calls) };
}

afterEach(() => {
  vi.useRealTimers();
  delete script.__REDLINES_ZOOM__;
});

describe('initialZoom', () => {
  it('takes the level the initialization script handed the page, if it is a rung', () => {
    script.__REDLINES_ZOOM__ = 1.5;
    expect(initialZoom()).toBe(1.5);
    for (const level of [1.3, '1.5', null, undefined]) {
      script.__REDLINES_ZOOM__ = level;
      expect(initialZoom()).toBeNull();
    }
    delete script.__REDLINES_ZOOM__;
    expect(initialZoom()).toBeNull();
  });
});

describe('followZoom', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('listens to the event the app sends, before it reports', async () => {
    expect(ZOOM_EVENT).toBe('zoom');
    const { link, start } = setup();
    await start();
    expect(link.listen.mock.invocationCallOrder[0]).toBeLessThan(
      link.report.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("reports the settings' level, and saves and shows the app's when it differs", async () => {
    const { link, calls, zoomOf, start } = setup({ level: 1, settings: 1.25, answer: 1.5 });
    await start();
    expect(link.report).toHaveBeenCalledWith(1.25);
    expect(calls.save).toHaveBeenCalledExactlyOnceWith(1.5);
    expect(zoomOf()).toBe('1.5');
    expect(calls.after).toHaveBeenCalledExactlyOnceWith(1.5, 1);
  });

  it('saves nothing when the settings and the app agree', async () => {
    const { calls, zoomOf, start } = setup({ level: 1.25, settings: 1.25 });
    const zoom = await start();
    expect(calls.save).not.toHaveBeenCalled();
    expect(calls.after).not.toHaveBeenCalled();
    expect(zoomOf()).toBe('1.25');
    expect(zoom.level()).toBe(1.25);
  });

  it('takes the place on the event, and sets --rl-zoom on the resize that follows', async () => {
    const { event, calls, zoomOf, start } = setup();
    await start();
    event(2);
    expect(calls.before).toHaveBeenCalledExactlyOnceWith(2, 1);
    expect(zoomOf()).toBe('1');
    expect(calls.after).not.toHaveBeenCalled();
    window.dispatchEvent(new Event('resize'));
    expect(zoomOf()).toBe('2');
    expect(calls.after).toHaveBeenCalledExactlyOnceWith(2, 1);
    // A resize with no change pending does nothing.
    window.dispatchEvent(new Event('resize'));
    expect(calls.after).toHaveBeenCalledTimes(1);
  });

  it('sets --rl-zoom half a second after the event when no resize comes', async () => {
    const { event, calls, zoomOf, start } = setup();
    await start();
    event(1.5);
    vi.advanceTimersByTime(RESIZE_WAIT_MS - 1);
    expect(zoomOf()).toBe('1');
    vi.advanceTimersByTime(1);
    expect(zoomOf()).toBe('1.5');
    expect(calls.after).toHaveBeenCalledExactlyOnceWith(1.5, 1);
    // The resize that comes late finds nothing to do.
    window.dispatchEvent(new Event('resize'));
    expect(calls.after).toHaveBeenCalledTimes(1);
  });

  it('ends at the last of the levels asked for before the first lands, taking the place once', async () => {
    const { link, event, calls, zoomOf, start } = setup();
    const zoom = await start();
    await zoom.ask(1.1);
    await zoom.ask(stepSize(zoom.level(), 1));
    expect(link.set.mock.calls).toEqual([[1.1], [1.25]]);
    event(1.1);
    event(1.25);
    window.dispatchEvent(new Event('resize'));
    expect(zoomOf()).toBe('1.25');
    expect(calls.before).toHaveBeenCalledExactlyOnceWith(1.1, 1);
    expect(calls.after).toHaveBeenCalledExactlyOnceWith(1.25, 1);
  });

  it('asks the app once for a new level, after saving it, and not for the level it has', async () => {
    const { link, calls, start } = setup();
    const zoom = await start();
    await zoom.ask(1);
    expect(link.set).not.toHaveBeenCalled();
    await zoom.ask(1.5);
    await zoom.ask(1.5);
    expect(link.set).toHaveBeenCalledExactlyOnceWith(1.5);
    expect(calls.save).toHaveBeenCalledExactlyOnceWith(1.5);
    expect(vi.mocked(calls.save).mock.invocationCallOrder[0]).toBeLessThan(
      link.set.mock.invocationCallOrder[0] ?? 0,
    );
    expect(zoom.level()).toBe(1.5);
  });

  it('keeps the level it had when the app refuses the one asked for', async () => {
    const { link, calls, start } = setup();
    const zoom = await start();
    link.set.mockRejectedValueOnce(new Error('refused'));
    await expect(zoom.ask(1.5)).rejects.toThrow('refused');
    expect(zoom.level()).toBe(1);
    // The next ask for the same level is made again, not taken for done.
    await zoom.ask(1.5);
    expect(link.set).toHaveBeenCalledTimes(2);
    expect(calls.save).toHaveBeenCalledTimes(2);
    expect(zoom.level()).toBe(1.5);
  });

  it('starts without the app’s answer when it takes too long, and takes it when it comes', async () => {
    const { link, calls, zoomOf, start } = setup({ settings: 1.25, answer: 1.5 });
    let answer: (level: number) => void = () => {};
    link.report.mockImplementation(() => new Promise<number>((resolve) => (answer = resolve)));
    const started = start();
    await vi.advanceTimersByTimeAsync(REPORT_WAIT_MS);
    const zoom = await started;
    expect(zoom.level()).toBe(1);
    expect(zoomOf()).toBe('1');
    answer(1.5);
    await vi.advanceTimersByTimeAsync(0);
    expect(zoomOf()).toBe('1.5');
    expect(calls.save).toHaveBeenCalledExactlyOnceWith(1.5);
    expect(zoom.level()).toBe(1.5);
  });

  it("follows another window's change as the level to step from", async () => {
    const { event, start } = setup();
    const zoom = await start();
    event(1.75);
    expect(zoom.level()).toBe(1.75);
  });
});
