// Telling the document windows that an agent may have changed under them: Preferences updated one,
// signed one in, or looked again and found it otherwise. A window keeps what detection found for
// a minute (`createMacAgents`), so a person who has just signed in would be told by the next
// comment that the agent is signed out. The news travels as a value in the page's storage, which
// every window of the app shares and which tells the others of a change (as settings.ts does), so
// it needs nothing of the app's Rust side.

export const AGENTS_CHANGED_KEY = 'redlines.agents-changed';

/** Says that an agent may have changed: the other windows look again at their next comment. */
export function announceAgentsChanged(now: number = Date.now()): void {
  try {
    // The time makes every announcement a change, which a window is told of.
    localStorage.setItem(AGENTS_CHANGED_KEY, String(now));
  } catch {
    // Storage can be switched off: a window then looks again when its minute is up.
  }
}

/**
 * Calls `onChange` when another window announces a change (the browser tells a window of every
 * change but its own). Returns a function that stops it.
 */
export function watchAgentsChanged(onChange: () => void): () => void {
  const listener = (event: StorageEvent) => {
    if (event.key === AGENTS_CHANGED_KEY && event.newValue !== null) onChange();
  };
  window.addEventListener('storage', listener);
  return () => window.removeEventListener('storage', listener);
}
