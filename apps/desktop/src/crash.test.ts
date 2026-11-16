// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNotifications } from './ui/notifications.ts';
import { watchCrashes, type CrashLink, type CrashWatch } from './crash.ts';
import type { Problem } from './crash-report.ts';

const SECRET = 'The merger closes on Friday';

const stored = (over: Partial<Problem> = {}): Problem => ({
  id: '1',
  kind: 'page-error',
  at: '2026-11-16T12:00:00Z',
  window: 'main',
  message: 'TypeError: nope',
  trace: 'at f (a.js:1:1)',
  shape: null,
  doing: null,
  memoryKb: null,
  macos: 'macOS 15',
  build: '0.2.0 (abc)',
  ...over,
});

function setup(pending: Problem[] = []) {
  let now = 1_000_000;
  let tick: () => void = () => {};
  let wake: () => void = () => {};
  const link = {
    logPage: vi.fn((e: { message: string; trace: string }) =>
      Promise.resolve(stored({ message: e.message, trace: e.trace })),
    ),
    heartbeat: vi.fn<CrashLink['heartbeat']>(() => Promise.resolve()),
    slow: vi.fn<CrashLink['slow']>(() => Promise.resolve()),
    pending: vi.fn(() => Promise.resolve(pending.splice(0))),
    environment: vi.fn(() => Promise.resolve({ build: '0.2.0 (abc)', macos: 'macOS 15' })),
    revealLog: vi.fn(() => Promise.resolve()),
    openLink: vi.fn<CrashLink['openLink']>(() => Promise.resolve()),
    simulate: vi.fn<CrashLink['simulate']>(() => Promise.resolve()),
    listen: vi.fn((handler: () => void) => {
      wake = handler;
      return Promise.resolve();
    }),
  } satisfies CrashLink;
  const notifications = createNotifications(document.body);
  let text = `# ${SECRET}\nsecond line`;
  const watch = watchCrashes({
    link,
    notifications,
    getText: () => text,
    where: () => '40% down',
    now: () => now,
    timers: {
      setInterval: (handler) => {
        tick = handler;
        return 1;
      },
      clearInterval: () => {},
    },
  });
  const cards = () => [...document.querySelectorAll<HTMLElement>('.rl-notification')];
  const flush = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };
  return {
    link,
    watch,
    cards,
    flush,
    advance: (ms: number) => (now += ms),
    tick: () => tick(),
    wake: () => wake(),
    setText: (next: string) => (text = next),
  };
}

let current: CrashWatch | null = null;
beforeEach(() => {
  document.body.replaceChildren();
});
afterEach(() => {
  current?.destroy();
  current = null;
});

const press = (card: HTMLElement | undefined, label: string) =>
  [...(card?.querySelectorAll('button') ?? [])].find((b) => b.textContent === label)?.click();

describe('errors in the page', () => {
  it('logs a thrown error through the app and offers a report', async () => {
    const t = setup();
    current = t.watch;
    window.dispatchEvent(new ErrorEvent('error', { error: new RangeError('Invalid position') }));
    await t.flush();
    expect(t.link.logPage).toHaveBeenCalledOnce();
    const call = t.link.logPage.mock.calls[0]?.[0] as unknown as Record<string, unknown>;
    expect(call.message).toBe('RangeError: Invalid position');
    // The shape went with it, the text did not.
    expect(JSON.stringify(call)).not.toContain('merger');
    expect(call.shape).toMatchObject({ lines: 2 });
    expect(t.cards()[0]?.textContent).toContain('Redlines had a problem');
  });

  it('logs an unhandled rejection and one CodeMirror caught', async () => {
    const t = setup();
    current = t.watch;
    const rejection = new Event('unhandledrejection') as PromiseRejectionEvent;
    Object.defineProperty(rejection, 'reason', { value: new Error('late') });
    window.dispatchEvent(rejection);
    t.watch.caught(new Error('in an extension'));
    await t.flush();
    expect(t.link.logPage.mock.calls.map(([e]) => e.message)).toEqual([
      'Error: late',
      'Error: in an extension',
    ]);
  });

  it('counts the same error again and again as one', async () => {
    const t = setup();
    current = t.watch;
    for (let i = 0; i < 5; i++) t.watch.caught(new Error('again'));
    await t.flush();
    expect(t.link.logPage).toHaveBeenCalledOnce();
  });

  it('opens the filled-in issue from Report…, without the document', async () => {
    const t = setup();
    current = t.watch;
    t.watch.caught(new Error('boom'));
    await t.flush();
    press(t.cards()[0], 'Report…');
    await t.flush();
    const url = t.link.openLink.mock.calls[0]?.[0] as string;
    expect(url).toContain('github.com/skadauke/redlines/issues/new');
    expect(decodeURIComponent(url)).toContain('boom');
    expect(decodeURIComponent(url)).not.toContain('merger');
    expect(t.cards()).toHaveLength(0);
  });

  it('shows the log from Reveal Log', async () => {
    const t = setup();
    current = t.watch;
    t.watch.caught(new Error('boom'));
    await t.flush();
    press(t.cards()[0], 'Reveal Log');
    expect(t.link.revealLog).toHaveBeenCalledOnce();
  });
});

describe('what the app logged', () => {
  it('offers the failure waiting at the start, such as a process that ended', async () => {
    const t = setup([stored({ kind: 'web-process' })]);
    current = t.watch;
    await t.flush();
    expect(t.cards()[0]?.textContent).toContain('reloaded this window');
  });

  it('offers a failure it is told of, such as a hang that ended or a panic', async () => {
    const pending: Problem[] = [];
    const t = setup(pending);
    current = t.watch;
    await t.flush();
    expect(t.cards()).toHaveLength(0);
    pending.push(stored({ kind: 'hang' }));
    t.wake();
    await t.flush();
    expect(t.cards()[0]?.textContent).toContain('stopped responding');
  });

  it('reports a problem asked for from the menu with no failure, from the open document', async () => {
    const t = setup();
    current = t.watch;
    await t.watch.reportProblem();
    const url = decodeURIComponent(t.link.openLink.mock.calls[0]?.[0] as string);
    expect(url).toContain('macOS 15');
    expect(url).toContain('2 lines');
    expect(url).not.toContain('merger');
  });
});

describe('the heartbeat', () => {
  it('beats every two seconds with the shape and what the page was doing', () => {
    const t = setup();
    current = t.watch;
    t.link.heartbeat.mockClear();
    window.dispatchEvent(new Event('wheel'));
    t.advance(1000);
    t.tick();
    expect(t.link.heartbeat).not.toHaveBeenCalled();
    t.advance(1000);
    t.tick();
    const [shape, doing] = t.link.heartbeat.mock.calls[0] as unknown as [unknown, string];
    expect(shape).toMatchObject({ lines: 2 });
    expect(doing).toContain('scrolling, 40% down');
    expect(JSON.stringify([shape, doing])).not.toContain('merger');
  });

  it('works the shape out again only after a change, and not often', () => {
    const t = setup();
    current = t.watch;
    // The first beat works the shape out.
    t.advance(2000);
    t.tick();
    t.tick();
    t.link.heartbeat.mockClear();
    t.setText('one');
    t.watch.documentChanged();
    for (let i = 0; i < 2; i++) {
      t.advance(1000);
      t.tick();
    }
    // The shape was made a moment ago, so this change waits.
    expect(t.link.heartbeat.mock.calls[0]?.[0]).toMatchObject({ lines: 2 });
    t.advance(10_000);
    t.tick();
    t.advance(1000);
    t.tick();
    expect(t.link.heartbeat.mock.calls.at(-1)?.[0]).toMatchObject({ lines: 1, bytes: 3 });
  });

  it('logs a timer that ran late as slow work, with what was running', () => {
    const t = setup();
    current = t.watch;
    window.dispatchEvent(new Event('keydown'));
    t.advance(1900);
    t.tick();
    const [millis, doing] = t.link.slow.mock.calls[0] as unknown as [number, string];
    expect(millis).toBe(900);
    expect(doing).toContain('typing');
    t.link.slow.mockClear();
    t.advance(1000);
    t.tick();
    expect(t.link.slow).not.toHaveBeenCalled();
  });
});

describe('recovered edits', () => {
  it('says so alone, with the saved version as its action, when nothing failed', async () => {
    const t = setup();
    current = t.watch;
    const showSaved = vi.fn();
    await t.watch.recovered(showSaved);
    expect(t.cards()[0]?.textContent).toContain('recovered your unsaved edits');
    expect(t.cards()[0]?.textContent).not.toContain('Report…');
    press(t.cards()[0], 'Show the Saved Version');
    expect(showSaved).toHaveBeenCalledOnce();
    expect(t.cards()).toHaveLength(0);
  });

  it('joins the card of the failure that came before it, with Report… and the saved version', async () => {
    const t = setup([stored({ kind: 'web-process' })]);
    current = t.watch;
    await t.flush();
    expect(t.cards()[0]?.textContent).toContain('reloaded this window');
    await t.watch.recovered(vi.fn());
    expect(t.cards()).toHaveLength(1);
    expect(t.cards()[0]?.textContent).toContain('recovered your document');
    const labels = [...(t.cards()[0]?.querySelectorAll('button') ?? [])].map((b) => b.textContent);
    expect(labels).toEqual(['Dismiss', 'Show the Saved Version', 'Report…']);
  });
});
