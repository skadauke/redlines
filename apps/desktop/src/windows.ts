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
 * question, for a window closed or saved while another was asked; none is asked twice, for the edits
 * of a window that said Don't Save are still there.
 */
export async function askEachDirtyWindow(
  list: () => Promise<readonly DocumentWindow[]>,
  ask: (label: string) => Promise<boolean>,
): Promise<boolean> {
  const asked = new Set<string>();
  for (;;) {
    const next = (await list()).find(({ label, dirty }) => dirty && !asked.has(label));
    if (!next) return true;
    asked.add(next.label);
    if (!(await ask(next.label))) return false;
  }
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
 */
export async function followFocus(
  window: FocusableWindow,
  menu: { activate(): Promise<void> },
): Promise<void> {
  const activate = () => {
    menu.activate().catch((error: unknown) => {
      console.error('Could not put this window’s menu in the menu bar', error);
    });
  };
  await window.onFocusChanged(({ payload: focused }) => {
    if (focused) activate();
  });
  await window.listen('frontmost', activate);
  // It may have got the focus before anything was listening.
  if (await window.isFocused()) activate();
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
  /** Asks each window with unsaved edits in turn. Resolves to whether to go on. */
  askEach(): Promise<boolean>;
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

/** Makes `run` share one run among those who call it while it is running. */
function shared<T>(run: () => Promise<T>): () => Promise<T> {
  let running: Promise<T> | null = null;
  return () =>
    (running ??= run().finally(() => {
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

  const ask = (label: string) => {
    if (label === link.label) return askMe();
    return new Promise<boolean>((resolve, reject) => {
      waiting.set(label, resolve);
      link.emitTo(label, ASK, { from: link.label }).catch(reject);
    });
  };

  const askEach = shared(() => askEachDirtyWindow(() => link.list(), ask));

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
    waiting.delete(label);
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
