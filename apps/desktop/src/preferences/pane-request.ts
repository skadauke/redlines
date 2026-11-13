// Asking the Preferences window to show a pane, from another window: a failed run's line in a
// document offers to open Preferences › Agents. The request is a value in the page's storage, which
// every window of the app shares and which tells the other windows of a change (as settings.ts
// does), so it needs nothing of the app's Rust side and no capability. The window that takes it
// takes it away, and a request that waited too long was for a window that never opened.

/** The panes of the Preferences window (`PANES` in panes.ts, which a test holds this to). */
export type RequestedPane = 'general' | 'appearance' | 'editor' | 'agents';

export const PANE_REQUEST_KEY = 'redlines.preferences-pane';

/** How long a request waits for a window to open before it is no request. */
export const REQUEST_MS = 10_000;

/** Asks for `pane`, which a Preferences window shows as it opens, or at once if it is open. */
export function requestPane(pane: RequestedPane, now: number = Date.now()): void {
  try {
    // The time makes every request a change, which a window that is open is told of.
    localStorage.setItem(PANE_REQUEST_KEY, JSON.stringify({ pane, at: now }));
  } catch {
    // Storage can be switched off: Preferences then opens as it would have.
  }
}

const PANES: readonly string[] = ['general', 'appearance', 'editor', 'agents'];

/** The pane a stored request asks for, if it is one and is not too old. */
function paneOf(stored: string | null, now: number): RequestedPane | null {
  if (stored === null) return null;
  let request: unknown;
  try {
    request = JSON.parse(stored);
  } catch {
    return null;
  }
  if (typeof request !== 'object' || request === null) return null;
  const { pane, at } = request as Record<string, unknown>;
  if (typeof pane !== 'string' || !PANES.includes(pane)) return null;
  if (typeof at !== 'number' || now - at > REQUEST_MS || at - now > REQUEST_MS) return null;
  return pane as RequestedPane;
}

/** Takes the request waiting, for a window that has just opened: its pane, or none. */
export function takePaneRequest(now: number = Date.now()): RequestedPane | null {
  try {
    const stored = localStorage.getItem(PANE_REQUEST_KEY);
    localStorage.removeItem(PANE_REQUEST_KEY);
    return paneOf(stored, now);
  } catch {
    return null;
  }
}

/**
 * Calls `onRequest` with the pane when a request comes while the window is open (the browser tells
 * a window of every change but its own), and takes the request away. Returns a function that
 * stops it.
 */
export function watchPaneRequests(onRequest: (pane: RequestedPane) => void): () => void {
  const listener = (event: StorageEvent) => {
    if (event.key !== PANE_REQUEST_KEY) return;
    const pane = paneOf(event.newValue, Date.now());
    if (pane === null) return;
    try {
      localStorage.removeItem(PANE_REQUEST_KEY);
    } catch {
      // Left, it is too old to count soon enough.
    }
    onRequest(pane);
  };
  window.addEventListener('storage', listener);
  return () => window.removeEventListener('storage', listener);
}
