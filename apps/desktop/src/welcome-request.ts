// The first-launch onboarding spans two windows (#1206, design §5.11a): the Preferences window, which
// holds the app's install commands, runs its first three screens (its Welcome mode), and the
// document window runs the tour. They speak through the page's storage, as the panes of Preferences
// are asked for (preferences/pane-request.ts): a request that the document window makes and the
// Preferences window takes, and the result the Preferences window leaves for the document window.
// It needs nothing of the app's Rust side and no capability.

export const WELCOME_REQUEST_KEY = 'redlines.welcome-request';
export const WELCOME_RESULT_KEY = 'redlines.welcome-result';

/** How long a request waits for the Preferences window to open before it is no request. */
export const WELCOME_REQUEST_MS = 10_000;

/** How the Welcome mode ended: through all three screens, or skipped from one. */
export type WelcomeResult = 'finished' | 'skipped';

function fresh(stored: string | null, now: number): boolean {
  if (stored === null) return false;
  try {
    const at = (JSON.parse(stored) as { at?: unknown }).at;
    return typeof at === 'number' && Math.abs(now - at) <= WELCOME_REQUEST_MS;
  } catch {
    return false;
  }
}

/** Asks the Preferences window for its Welcome mode, as it opens or at once if it is open. */
export function requestWelcome(now: number = Date.now()): void {
  try {
    localStorage.setItem(WELCOME_REQUEST_KEY, JSON.stringify({ at: now }));
  } catch {
    // Storage can be switched off: the Preferences window then opens as it would have.
  }
}

/** Takes the request waiting, for a window that has just opened: whether there was one. */
export function takeWelcomeRequest(now: number = Date.now()): boolean {
  try {
    const stored = localStorage.getItem(WELCOME_REQUEST_KEY);
    localStorage.removeItem(WELCOME_REQUEST_KEY);
    return fresh(stored, now);
  } catch {
    return false;
  }
}

/** Calls `onRequest` when a request comes while the window is open, and takes it away. */
export function watchWelcomeRequests(onRequest: () => void): () => void {
  const listener = (event: StorageEvent) => {
    if (event.key !== WELCOME_REQUEST_KEY || !fresh(event.newValue, Date.now())) return;
    try {
      localStorage.removeItem(WELCOME_REQUEST_KEY);
    } catch {
      // Left, it is too old to count soon enough.
    }
    onRequest();
  };
  window.addEventListener('storage', listener);
  return () => window.removeEventListener('storage', listener);
}

/** Leaves how the Welcome mode ended, for the window that asked for it. */
export function reportWelcome(result: WelcomeResult, now: number = Date.now()): void {
  try {
    localStorage.setItem(WELCOME_RESULT_KEY, JSON.stringify({ result, at: now }));
  } catch {
    // The window that asked then waits for nothing: no tour, which is harmless.
  }
}

/** Calls `onResult` with how the Welcome mode ended, once. Returns a function that stops it. */
export function watchWelcomeResult(onResult: (result: WelcomeResult) => void): () => void {
  const stop = () => window.removeEventListener('storage', listener);
  const listener = (event: StorageEvent) => {
    if (event.key !== WELCOME_RESULT_KEY || event.newValue === null) return;
    try {
      const { result } = JSON.parse(event.newValue) as { result?: unknown };
      if (result !== 'finished' && result !== 'skipped') return;
      stop();
      localStorage.removeItem(WELCOME_RESULT_KEY);
      onResult(result);
    } catch {
      // Not ours.
    }
  };
  window.addEventListener('storage', listener);
  return stop;
}
