// The commands that can have keys, written where every window of the app can read them: the
// Preferences window has no menu bar and no editor, and lists them from here (Shortcuts pane). Each
// window writes them as it starts, since plugins may add commands between versions.

import type { ShortcutEntry } from './shortcuts.ts';

export const SHORTCUT_ENTRIES_KEY = 'redlines.shortcut-entries';

export function publishShortcutEntries(entries: readonly ShortcutEntry[]): void {
  try {
    localStorage.setItem(SHORTCUT_ENTRIES_KEY, JSON.stringify(entries));
  } catch {
    // Storage can be full or switched off; the pane then has none to list.
  }
}

/** The published commands, or none when no window has run yet. Anything else is dropped. */
export function publishedShortcutEntries(): ShortcutEntry[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(SHORTCUT_ENTRIES_KEY) ?? 'null');
    if (!Array.isArray(stored)) return [];
    return (stored as unknown[]).flatMap((item) => {
      if (typeof item !== 'object' || item === null) return [];
      const { id, menu, title, default: key, locked } = item as Record<string, unknown>;
      if (typeof id !== 'string' || typeof menu !== 'string' || typeof title !== 'string')
        return [];
      const entry: ShortcutEntry = {
        id,
        menu,
        title,
        default: typeof key === 'string' ? key : null,
        ...(locked === true ? { locked: true as const } : {}),
      };
      return [entry];
    });
  } catch {
    return [];
  }
}
