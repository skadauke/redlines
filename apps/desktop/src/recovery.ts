// Recovery copies (#693), as a window keeps them. While the document has unsaved edits, its text is
// handed to the app every few seconds and at each pause in typing, to be kept in the app's support
// folder (src-tauri/src/recovery.rs); saving the document, or giving up its edits, deletes the copy.
// A window that opens a document after its page's process ended, or the app crashed, finds the copy
// and puts the edits back, and says so in a notification (crash.ts).

import { invoke } from '@tauri-apps/api/core';

/** What the app kept of a document. */
export interface Kept {
  key: string;
  /** The document's file, or null for one that was never saved. */
  path: string | null;
  text: string;
}

/** What a window needs of the app to keep copies; `tauriRecoveryLink` has the app's. */
export interface RecoveryLink {
  write(key: string, path: string | null, text: string): Promise<unknown>;
  read(key: string): Promise<Kept | null>;
  remove(key: string): Promise<unknown>;
}

export function tauriRecoveryLink(): RecoveryLink {
  return {
    write: (key, path, text) => invoke('recovery_write', { key, path, text }),
    read: (key) => invoke<Kept | null>('recovery_read', { key }),
    remove: (key) => invoke('recovery_delete', { key }),
  };
}

/** After this long without a keystroke, the text is kept. */
export const PAUSE_MS = 1500;
/** While typing goes on, the text is kept at least this often. */
export const AT_LEAST_EVERY_MS = 5000;

/** What the window shows of its document, as recovery needs it. */
interface RecoveryDocument {
  path: string | null;
  dirty: boolean;
}

interface RecoveryOptions {
  link: RecoveryLink;
  /** The window's label, which names a document that was never saved. */
  label: string;
  getText: () => string;
  timers?: {
    setTimeout: (handler: () => void, ms: number) => unknown;
    clearTimeout: (id: unknown) => void;
  };
}

export interface Recovery {
  /** The document's state changed: it was saved, edited for the first time, or replaced. */
  follow(state: RecoveryDocument): void;
  /** The text changed. */
  changed(): void;
  /** What was kept of this window's document before the page ended, or null. */
  find(): Promise<Kept | null>;
  /** The window's document is given up (its window closes without saving): nothing is kept. */
  discard(): void;
  destroy(): void;
}

/** The key of a document: its file, or the window that holds it for one never saved. */
export const keyOf = (path: string | null, label: string): string => path ?? `untitled:${label}`;

export function createRecovery(options: RecoveryOptions): Recovery {
  const { link, label, getText } = options;
  const timers = options.timers ?? {
    setTimeout: (handler, ms) => setTimeout(handler, ms),
    clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  };
  let state: RecoveryDocument = { path: null, dirty: false };
  /** The key whose copy the app holds, if it holds one. */
  let kept: string | null = null;
  let lastText: string | null = null;
  let pause: unknown = null;
  let deadline: unknown = null;

  const fail = (what: string) => (error: unknown) => console.error(what, error);

  const cancel = () => {
    if (pause !== null) timers.clearTimeout(pause);
    if (deadline !== null) timers.clearTimeout(deadline);
    pause = deadline = null;
  };

  const forget = (key: string | null) => {
    if (key === null) return;
    void link.remove(key).catch(fail('Could not delete the recovery copy'));
    if (key === kept) {
      kept = null;
      lastText = null;
    }
  };

  const keep = () => {
    cancel();
    if (!state.dirty) return;
    const text = getText();
    if (text === lastText) return;
    const key = keyOf(state.path, label);
    kept = key;
    lastText = text;
    void link.write(key, state.path, text).catch(fail('Could not keep a recovery copy'));
  };

  const schedule = () => {
    if (!state.dirty) return;
    if (pause !== null) timers.clearTimeout(pause);
    pause = timers.setTimeout(keep, PAUSE_MS);
    // Typing that never pauses is kept all the same.
    deadline ??= timers.setTimeout(keep, AT_LEAST_EVERY_MS);
  };

  return {
    follow(next) {
      const before = keyOf(state.path, label);
      const after = keyOf(next.path, label);
      const wasDirty = state.dirty;
      state = next;
      // Another document, or the same one saved under a new name: the old copy has no document.
      if (kept !== null && before !== after) forget(kept);
      if (!next.dirty) {
        cancel();
        // Saved, or taken back to what was saved: nothing is unsaved, and a copy kept before is
        // not the document's any more, whether this window made it or found it.
        if (kept !== null) forget(kept);
        else if (wasDirty && before === after) forget(after);
      } else if (!wasDirty) {
        schedule();
      }
    },
    changed: schedule,
    async find() {
      try {
        return await link.read(keyOf(state.path, label));
      } catch (error) {
        console.error('Could not read a recovery copy', error);
        return null;
      }
    },
    discard() {
      cancel();
      forget(keyOf(state.path, label));
    },
    destroy: cancel,
  };
}
