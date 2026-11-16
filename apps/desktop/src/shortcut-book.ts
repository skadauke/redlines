// The shortcuts of this window, as one object: the person's own keys over each command's own, which
// the editor's keys, the menu bar and the browser's key handling all ask (shortcuts.ts has the
// rules). A change is kept in the settings, which every window shares, so that it works at once in
// all of them.

import type { CommandKeys } from '@redlines/editor';
import type { ActionRow, MenuModel, MenuRow } from './menu-model.ts';
import {
  assess as assessKey,
  assign,
  commandEntryId,
  keyOf as keyIn,
  menuKey,
  normalizeKey,
  type Assessment,
  type ShortcutEntry,
  type ShortcutOverrides,
} from './shortcuts.ts';

/** The app's own keys that stay as they are: Quit is the Mac's, and Undo and Redo the editor's own too. */
const LOCKED = new Set(['Redlines/Quit Redlines', 'Edit/Undo', 'Edit/Redo']);

/** Every action row of a menu, also those in submenus (not the rows that come and go). */
function actionRows(rows: readonly MenuRow[]): ActionRow[] {
  return rows.flatMap((row) => {
    if ('rows' in row) return row.dynamic ? [] : actionRows(row.rows);
    return 'action' in row && !row.disabled ? [row] : [];
  });
}

/** The commands that can have a key, from the menu bar's table, in its order. */
export function shortcutEntries(model: MenuModel): ShortcutEntry[] {
  return model.menus.flatMap((menu) =>
    actionRows(menu.rows).flatMap((row) => {
      if (!row.id) return [];
      const entry: ShortcutEntry = {
        id: row.id,
        menu: menu.title,
        title: row.text,
        default: row.accelerator ? normalizeKey(row.accelerator) : null,
        ...(LOCKED.has(row.id) ? { locked: true as const } : {}),
      };
      return [entry];
    }),
  );
}

export interface ShortcutBook {
  /** What the person changed. */
  overrides(): ShortcutOverrides;
  entries(): readonly ShortcutEntry[];
  /** The commands that can have keys, from the menu bar's table; the first thing to call. */
  setEntries(entries: readonly ShortcutEntry[]): void;
  /** The key a command has now, or null. */
  keyOf(id: string): string | null;
  /** The key of a row of the menu bar in Tauri's notation: the person's, else the row's own. */
  acceleratorOf(row: ActionRow): string | undefined;
  /** What giving a command a key would come to. */
  assess(id: string, key: string): Assessment;
  /** Gives a command a key (null for none), taking it from any command that has it, and keeps it. */
  assign(id: string, key: string | null): void;
  /** Gives every command its own key again. */
  resetAll(): void;
  /** Takes the overrides another window kept. */
  load(overrides: ShortcutOverrides): void;
  /** For the registry's commands. */
  commandKeys: CommandKeys;
  /** Calls the listener when a key changes; returns a function that stops it. */
  subscribe(listener: () => void): () => void;
}

/** Makes the shortcuts: `save` keeps the overrides when this window changes them. */
export function createShortcutBook(
  initial: ShortcutOverrides,
  save: (overrides: ShortcutOverrides) => void,
): ShortcutBook {
  let overrides = initial;
  let entries: readonly ShortcutEntry[] = [];
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  };
  const changed = () => {
    for (const listener of [...listeners]) listener();
  };
  const set = (next: ShortcutOverrides) => {
    if (JSON.stringify(next) === JSON.stringify(overrides)) return false;
    overrides = next;
    return true;
  };
  return {
    overrides: () => overrides,
    entries: () => entries,
    setEntries(next) {
      entries = next;
    },
    keyOf: (id) => keyIn(entries, overrides, id),
    acceleratorOf(row) {
      const { id } = row;
      if (id && id in overrides) return overrides[id] ? menuKey(overrides[id]) : undefined;
      return row.accelerator;
    },
    assess: (id, key) => assessKey(entries, overrides, id, key),
    assign(id, key) {
      if (set(assign(entries, overrides, id, key))) {
        save(overrides);
        changed();
      }
    },
    resetAll() {
      if (set({})) {
        save(overrides);
        changed();
      }
    },
    load(next) {
      if (set(next)) changed();
    },
    commandKeys: {
      keyOf(id, fallback) {
        const entry = commandEntryId(id);
        if (!(entry in overrides)) return fallback;
        return overrides[entry] ? normalizeKey(overrides[entry]) : undefined;
      },
      subscribe,
    },
    subscribe,
  };
}
