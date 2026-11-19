// Crashes, in the page (#692). Everything that can go wrong here is written to the crash log by the
// app (src-tauri/src/crash.rs), and a gray notification offers to report it: Report… opens a
// filled-in GitHub issue for the person to review (crash-report.ts), Reveal Log shows the log.
//
// What the page catches itself: errors (`window.onerror`, unhandled rejections, CodeMirror's
// exception sink). What it tells the app so that the app can catch the rest: a heartbeat, with the
// shape of the document and what the page was last doing, so that a page that hangs or whose process
// ends is logged with something to go on; and the timers that ran late, which show stalls. The app
// tells it of what it logged (a panic, a crash of the last run, a hang that is over, the process
// that ended and the reload that followed) through `crash-pending`, and this takes those and offers
// them.

import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import type { Notification, Notifications } from './ui/notifications.ts';
import {
  documentShape,
  problemText,
  reportFor,
  type Environment,
  type Problem,
  type Shape,
} from './crash-report.ts';

/** The event the app tells the windows in that something is waiting. */
const CRASH_EVENT = 'crash-pending';

/** What the page needs of the app for crashes; `tauriCrashLink` has the app's. */
export interface CrashLink {
  /** Logs an error of the page and returns it as the app wrote it. */
  logPage(error: {
    message: string;
    trace: string;
    shape: Shape | null;
    doing: string | null;
  }): Promise<Problem>;
  heartbeat(shape: Shape | null, doing: string | null): Promise<unknown>;
  slow(millis: number, doing: string | null): Promise<unknown>;
  pending(): Promise<Problem[]>;
  environment(): Promise<Environment>;
  revealLog(): Promise<unknown>;
  /** Opens a web address in the browser. */
  openLink(url: string): Promise<unknown>;
  /** Debug builds: has the app make a failure of its own. */
  simulate(kind: string): Promise<unknown>;
  listen(handler: () => void): Promise<unknown>;
}

export function tauriCrashLink(): CrashLink {
  return {
    logPage: (error) => invoke<Problem>('crash_log_page', error),
    heartbeat: (shape, doing) => invoke('crash_heartbeat', { shape, doing }),
    slow: (millis, doing) => invoke('crash_slow', { millis, doing }),
    pending: () => invoke<Problem[]>('crash_pending'),
    environment: () => invoke<Environment>('crash_environment'),
    revealLog: () => invoke('crash_log_reveal'),
    openLink: (url) => invoke('open_link', { url }),
    simulate: (kind) => invoke('crash_simulate', { kind }),
    listen: (handler) => getCurrentWebviewWindow().listen(CRASH_EVENT, handler),
  };
}

/** How often the page tells the app it is alive. */
const BEAT_MS = 2000;
/** A timer this late is slow work, which is logged. */
const SLOW_MS = 200;
/** How often the document's shape is worked out again, when it changed. */
const SHAPE_EVERY_MS = 10_000;
/** The same message within this time is the same failure. */
const SAME_MS = 5000;
/** At most this many cards a minute. */
const CARDS_PER_MINUTE = 4;

/** At most this many errors a minute are logged. */
const LOGGED_PER_MINUTE = 10;

const KEY = 'problem';

interface CrashWatchOptions {
  link: CrashLink;
  notifications: Notifications;
  /** The document's text, for its shape only. */
  getText: () => string;
  /** Where the reader is, in a few words ("87% down"). */
  where?: () => string;
  /** The window's events, and where errors are caught. */
  target?: Window;
  now?: () => number;
  /** The timers, which a test drives. */
  timers?: {
    setInterval: (handler: () => void, ms: number) => unknown;
    clearInterval: (id: unknown) => void;
  };
}

export interface CrashWatch {
  /** The document changed: its shape is worked out again before the next beat. */
  documentChanged(): void;
  /** What the page is doing, for the log of whatever fails next. */
  doing(label: string): void;
  /** An error CodeMirror caught. */
  caught(error: unknown): void;
  /** Help › Report a Problem…: the report for the latest failure, or for none. */
  reportProblem(): Promise<void>;
  /** Help › Reveal Log. */
  revealLog(): Promise<void>;
  /**
   * The window put back the edits it had when it failed (recovery.ts): says so, in the card of the
   * failure when there is one, and offers the saved version instead.
   */
  recovered(showSaved: () => void): Promise<void>;
  destroy(): void;
}

/** What an error says and where, from whatever was thrown. */
function describeError(error: unknown): { message: string; trace: string } {
  if (error instanceof Error) {
    return { message: `${error.name}: ${error.message}`, trace: error.stack ?? '' };
  }
  if (typeof error === 'string') return { message: error, trace: '' };
  // Whatever else was thrown may hold the document's words: say only that it was.
  return { message: 'Something that is not an error was thrown.', trace: '' };
}

export function watchCrashes(options: CrashWatchOptions): CrashWatch {
  const { link, notifications, getText } = options;
  const target = options.target ?? window;
  const now = options.now ?? (() => Date.now());
  const timers = options.timers ?? {
    setInterval: (handler, ms) => setInterval(handler, ms),
    clearInterval: (id) => clearInterval(id as ReturnType<typeof setInterval>),
  };

  let doingLabel: string | null = null;
  let doingAt = 0;
  let shape: Shape | null = null;
  let shapeAt = -SHAPE_EVERY_MS;
  let changed = true;
  let latest: Problem | null = null;
  let lastMessage = '';
  let lastMessageAt = 0;
  let cards: number[] = [];
  let logged: number[] = [];
  let destroyed = false;

  const doing = (label: string) => {
    doingLabel = label;
    doingAt = now();
  };
  const doingText = (): string | null => {
    if (doingLabel === null) return null;
    const where = options.where?.();
    const ago = Math.round((now() - doingAt) / 1000);
    return `${doingLabel}${where ? `, ${where}` : ''} (${ago} s ago)`;
  };

  /** The shape of the document, worked out again at most once in a while, and only if it changed. */
  const currentShape = (): Shape | null => {
    if (changed && now() - shapeAt >= SHAPE_EVERY_MS) {
      try {
        shape = documentShape(getText());
      } catch {
        // The shape is a nicety; the beat must go on.
      }
      changed = false;
      shapeAt = now();
    }
    return shape;
  };

  const revealLog = async () => {
    try {
      await link.revealLog();
    } catch (error) {
      console.error('Could not show the log', error);
    }
  };

  const openReport = async (problem: Problem | null) => {
    try {
      const environment = await link.environment();
      const report = reportFor(problem, environment, problem?.shape ?? currentShape());
      await link.openLink(report.url);
    } catch (error) {
      console.error('Could not open the report', error);
    }
  };

  /** The card of the failure on show, while it shows. */
  let current: { problem: Problem; card: Notification } | null = null;
  let taking: Promise<void> = Promise.resolve();

  const reportAction = (problem: Problem) => ({
    label: 'Report…',
    run: (card: Notification) => {
      void openReport(problem);
      card.close();
    },
  });

  const offer = (problem: Problem) => {
    latest = problem;
    cards = cards.filter((at) => now() - at < 60_000);
    if (cards.length >= CARDS_PER_MINUTE) return;
    cards.push(now());
    const card = notifications.show({
      key: KEY,
      text: problemText(problem),
      dismissLabel: 'Dismiss',
      secondaryAction: { label: 'Reveal Log', run: () => void revealLog() },
      action: reportAction(problem),
    });
    current = { problem, card };
  };

  const take = () => {
    taking = (async () => {
      try {
        const problems = await link.pending();
        const last = problems[problems.length - 1];
        if (last) offer(last);
      } catch (error) {
        console.error('Could not read the crash log', error);
      }
    })();
    return taking;
  };

  const recovered = async (showSaved: () => void) => {
    await taking;
    const problem = current?.card.element.isConnected ? current.problem : null;
    const showSavedAction = {
      label: 'Show the Saved Version',
      run: (card: Notification) => {
        showSaved();
        card.close();
      },
    };
    notifications.show({
      key: KEY,
      text: problem
        ? 'Redlines had a problem and recovered your document.'
        : 'Redlines recovered your unsaved edits.',
      dismissLabel: 'Dismiss',
      // The saved version is what the card is about, unless there is a failure to report.
      secondaryAction: problem ? showSavedAction : undefined,
      action: problem ? reportAction(problem) : showSavedAction,
    });
  };

  const failed = async (error: unknown) => {
    const { message, trace } = describeError(error);
    // A storm of failures is logged a little: the same one again is one, and only so many a minute.
    logged = logged.filter((at) => now() - at < 60_000);
    if (logged.length >= LOGGED_PER_MINUTE) return;
    if (message === lastMessage && now() - lastMessageAt < SAME_MS) return;
    lastMessage = message;
    lastMessageAt = now();
    logged.push(now());
    try {
      offer(await link.logPage({ message, trace, shape: currentShape(), doing: doingText() }));
    } catch (loggingFailed) {
      console.error('Could not log an error', loggingFailed, error);
    }
  };

  const onError = (event: ErrorEvent) => void failed(event.error ?? event.message);
  const onRejection = (event: PromiseRejectionEvent) => void failed(event.reason);
  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onRejection);

  // What the page was last doing, which is all a hang or a dead process leaves to go on.
  const noted: [string, string][] = [
    ['keydown', 'typing'],
    ['paste', 'pasting'],
    ['wheel', 'scrolling'],
    ['scroll', 'scrolling'],
    ['pointerdown', 'clicking'],
  ];
  const listeners = noted.map(([type, label]) => {
    const listener = () => doing(label);
    target.addEventListener(type, listener, { capture: true, passive: true });
    return [type, listener] as const;
  });

  const beat = () => void link.heartbeat(currentShape(), doingText()).catch(() => {});

  // The beat, and the timers that ran late.
  let expected = now() + 1000;
  let ticks = 0;
  const timer = timers.setInterval(() => {
    const late = now() - expected;
    expected = now() + 1000;
    if (late > SLOW_MS) void link.slow(late, doingText()).catch(() => {});
    if (++ticks % (BEAT_MS / 1000) === 0) beat();
  }, 1000);
  // The page is awake again: the app counts its silence from now.
  target.addEventListener('focus', beat);

  void link.listen(() => void take()).catch(() => {});
  void link.heartbeat(null, null).catch(() => {});
  void take();

  return {
    documentChanged: () => {
      changed = true;
    },
    doing,
    caught: (error) => void failed(error),
    reportProblem: () => openReport(latest),
    revealLog,
    recovered,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      target.removeEventListener('error', onError);
      target.removeEventListener('unhandledrejection', onRejection);
      target.removeEventListener('focus', beat);
      for (const [type, listener] of listeners) {
        target.removeEventListener(type, listener, { capture: true });
      }
      timers.clearInterval(timer);
    },
  };
}

/**
 * Makes a failure happen, in a debug build, to see what it leaves: an error thrown, a promise
 * rejected, the page held for twelve seconds, and, in the app, a panic and the page's process ending.
 */
export function simulateFailure(kind: string, link: CrashLink): void {
  switch (kind) {
    case 'throw':
      setTimeout(() => {
        throw new Error('Simulated error');
      });
      break;
    case 'reject':
      void Promise.reject(new Error('Simulated rejection'));
      break;
    case 'hang': {
      const until = Date.now() + 12_000;
      while (Date.now() < until);
      break;
    }
    default:
      void link.simulate(kind).catch((error: unknown) => console.error(error));
  }
}
