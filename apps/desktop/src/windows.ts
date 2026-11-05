// One document per window (design §5.1). Each window has a page of its own, and these are the things
// the pages do together: keeping the Mac's one menu bar on the window in front, and asking about
// unsaved edits before the app quits, one window at a time. The app keeps the list of windows
// (src-tauri/src/windows.rs), and `tauriWindowLink` holds every call to it.

import { invoke } from '@tauri-apps/api/core';
import { emitTo } from '@tauri-apps/api/event';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';

/** A window of the app, as `document_windows` says. */
export interface DocumentWindow {
  label: string;
  /** Its document's file, or null for one that was never saved. */
  path: string | null;
  /** Whether its document has unsaved edits. */
  dirty: boolean;
}

/**
 * Asks each window with unsaved edits in turn, and resolves to whether to go on: false at the first
 * that says no, which leaves the windows after it unasked. The list is read again before each
 * question, for a window closed or saved while another was asked. A window that said Don't Save
 * stays dirty, and isn't asked again. One that the list shows clean has nothing left of what it was
 * asked about, so what it shows dirty afterwards is new edits, typed while another window asked, and
 * it is asked again.
 *
 * `asked` holds the windows asked so far. To ask again after a wait, give the same set.
 */
export async function askEachDirtyWindow(
  list: () => Promise<readonly DocumentWindow[]>,
  ask: (label: string) => Promise<boolean>,
  asked: Set<string> = new Set(),
): Promise<boolean> {
  for (;;) {
    const windows = await list();
    for (const { label, dirty } of windows) if (!dirty) asked.delete(label);
    const next = windows.find(({ label, dirty }) => dirty && !asked.has(label));
    if (!next) return true;
    asked.add(next.label);
    if (!(await ask(next.label))) return false;
  }
}

/**
 * Restarts into an update: asks each window, installs, and asks again right before the restart, for
 * edits typed while it installed would otherwise go without a question. Resolves to whether it went
 * on, false after a Cancel; the app quits before it resolves otherwise.
 */
export async function restartAfterAsking(
  window: Pick<ConnectedWindow, 'askEach' | 'openPaths'>,
  install: () => Promise<void>,
  relaunch: (paths: readonly string[]) => Promise<void>,
): Promise<boolean> {
  const asked = new Set<string>();
  if (!(await window.askEach(asked))) return false;
  await install();
  if (!(await window.askEach(asked))) return false;
  await relaunch(await window.openPaths());
  return true;
}

/** What `followFocus` needs of the window: Tauri's own object has it all. */
export interface FocusableWindow {
  isFocused(): Promise<boolean>;
  onFocusChanged(handler: (event: { payload: boolean }) => void): Promise<unknown>;
  listen(event: string, handler: () => void): Promise<unknown>;
}

/**
 * Keeps `menu` the app's while this window is in front. macOS has one menu bar, and each window
 * draws its own, whose items act on that window. So each takes the menu bar over when it gets the
 * focus, and when the app says it is in front because the window before it closed: no window may
 * get the focus then, if the others are minimized, and that window's menu can do nothing any more.
 *
 * A new window has no menu until its page has drawn it, a moment after the window opens. Until then
 * the menu bar is still the last window's, and what is chosen from it acts on that window.
 */
export async function followFocus(
  window: FocusableWindow,
  menu: { activate(): Promise<void> },
): Promise<void> {
  const failed = (error: unknown) => {
    console.error('Could not put this window’s menu in the menu bar', error);
  };
  // A busy page gets to a focus event late, when another window may have taken the menu bar since.
  const activateIfFocused = () => {
    window
      .isFocused()
      .then((focused) => (focused ? menu.activate() : undefined))
      .catch(failed);
  };
  await window.onFocusChanged(({ payload: focused }) => {
    if (focused) activateIfFocused();
  });
  await window.listen('frontmost', () => void menu.activate().catch(failed));
  // It may have got the focus before anything was listening.
  activateIfFocused();
}

/** What a window needs of the app and of the other windows. */
export interface WindowLink {
  /** This window's label. */
  readonly label: string;
  /** The windows, the frontmost first. */
  list(): Promise<DocumentWindow[]>;
  /** Tells the app what this window holds. */
  report(path: string | null, dirty: boolean): Promise<void>;
  /** Calls `handler` with what is sent to this window alone. */
  listen<T>(event: string, handler: (payload: T) => void): Promise<unknown>;
  /** Sends to one window. */
  emitTo(label: string, event: string, payload: unknown): Promise<void>;
  /** Every window has answered: the app quits. */
  quitAll(): Promise<void>;
  /** The question ended in Cancel: the app keeps running. */
  keepRunning(): Promise<void>;
}

export function tauriWindowLink(): WindowLink {
  const window = getCurrentWebviewWindow();
  return {
    label: window.label,
    list: () => invoke<DocumentWindow[]>('document_windows'),
    report: (path, dirty) => invoke('window_document', { path, dirty }),
    // Not the `listen` that hears every window's events.
    listen: <T>(event: string, handler: (payload: T) => void) =>
      window.listen<T>(event, ({ payload }) => handler(payload)),
    emitTo: (label, event, payload) => emitTo(label, event, payload),
    quitAll: () => invoke('quit_all'),
    keepRunning: () => invoke('keep_running'),
  };
}

/** This window, connected to the others. */
export interface ConnectedWindow {
  /** Asks each window with unsaved edits in turn (`askEachDirtyWindow`). */
  askEach(asked?: Set<string>): Promise<boolean>;
  /** Quits, once each window with unsaved edits has been asked, or keeps running after a Cancel. */
  quit(): Promise<void>;
  /** The files open in all the windows. */
  openPaths(): Promise<string[]>;
  /** Tells the app what this window holds: in time, not before it is `ready`. */
  reportDocument(path: string | null, dirty: boolean): void;
  /**
   * The window has opened what it was opened for and taken the files it was given. Until now the
   * app goes by what it gave the window, for what the page has to say about itself as it starts is
   * out of date.
   */
  ready(): void;
}

const ASK = 'ask-before-quit';
const ANSWER = 'answer-before-quit';

/** How often a window that is waiting for another's answer looks whether that one is still there. */
export const ASK_CHECK_MS = 1000;

/** Makes `run` share one run among those who call it while it is running. */
function shared<A extends unknown[], T>(
  run: (...args: A) => Promise<T>,
): (...args: A) => Promise<T> {
  let running: Promise<T> | null = null;
  return (...args) =>
    (running ??= run(...args).finally(() => {
      running = null;
    }));
}

/**
 * Connects this window to the others. `askHere` asks about this window's own unsaved edits, and
 * resolves to whether to go on. The window the app told to, or whose menu was used, does the asking,
 * and a window that can't get an answer counts as Cancel: edits are worth more than a quit.
 */
export async function connectWindow(
  link: WindowLink,
  askHere: () => Promise<boolean>,
): Promise<ConnectedWindow> {
  const waiting = new Map<string, (goOn: boolean) => void>();
  const askMe = shared(askHere);

  /**
   * Asks a window. It may never answer: its own close question can end it first, and a crashed page
   * comes back knowing nothing of the question. So the wait also ends when the window is gone, or
   * clean, which leaves nothing to ask it about.
   */
  const ask = (label: string) => {
    if (label === link.label) return askMe();
    return new Promise<boolean>((resolve, reject) => {
      const stop = () => {
        clearInterval(check);
        waiting.delete(label);
      };
      const check = setInterval(() => {
        link.list().then(
          (windows) => {
            if (windows.some((window) => window.label === label && window.dirty)) return;
            stop();
            resolve(true);
          },
          // The next look may do better.
          (error: unknown) => console.warn('Could not list the windows', error),
        );
      }, ASK_CHECK_MS);
      waiting.set(label, (goOn) => {
        stop();
        resolve(goOn);
      });
      const sent = link.emitTo(label, ASK, { from: link.label });
      sent.catch(stop);
      sent.catch(reject);
    });
  };

  const askEach = shared((asked?: Set<string>) =>
    askEachDirtyWindow(() => link.list(), ask, asked),
  );

  const quit = shared(async () => {
    const goOn = await askEach().catch((error: unknown) => {
      console.error('Could not ask about unsaved edits, so Redlines keeps running', error);
      return false;
    });
    await (goOn ? link.quitAll() : link.keepRunning());
  });

  await link.listen<{ from: string }>(ASK, ({ from }) => {
    askMe()
      .catch((error: unknown) => {
        console.error('Could not ask about unsaved edits', error);
        return false;
      })
      .then((goOn) => link.emitTo(from, ANSWER, { label: link.label, goOn }))
      .catch((error: unknown) => {
        console.error('Could not answer about unsaved edits', error);
      });
  });
  await link.listen<{ label: string; goOn: boolean }>(ANSWER, ({ label, goOn }) => {
    waiting.get(label)?.(goOn);
  });
  await link.listen('quit-requested', () => void quit());

  let reporting = false;
  let latest: [string | null, boolean] = [null, false];
  const send = () => {
    link.report(...latest).catch((error: unknown) => {
      console.error('Could not tell the app what this window holds', error);
    });
  };

  return {
    askEach,
    quit,
    openPaths: async () => (await link.list()).flatMap(({ path }) => (path === null ? [] : [path])),
    reportDocument(path, dirty) {
      latest = [path, dirty];
      if (reporting) send();
    },
    ready() {
      reporting = true;
      send();
    },
  };
}
