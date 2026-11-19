// The dev log (#1205), page side. In a build that isn't a release the app keeps `dev.log`
// (src-tauri/src/dev_log.rs): refusals, alerts, errors, agent runs and slow keystrokes, one line
// each, and Help › Write to Log… adds a note with a snapshot of the state. A release build has no
// log: the app says so, and this does nothing and draws no command.
//
// Nothing here sends a document's text. Lines are messages the app wrote itself; a key is logged by
// its name (`Return`, `⌘Z`), a typed character as `char`; the snapshot has the document's hash
// (12 hexadecimal digits of its SHA-256), its length and the selection's offsets.

import { invoke } from '@tauri-apps/api/core';

export type DevLogKind = 'refusal' | 'alert' | 'error' | 'agent' | 'slow' | 'note' | 'snapshot';

/** What the page needs of the app for the log. */
export interface DevLogLink {
  enabled(): Promise<boolean>;
  write(kind: DevLogKind, detail: string): Promise<unknown>;
  reveal(): Promise<unknown>;
}

export function tauriDevLogLink(): DevLogLink {
  return {
    enabled: () => invoke<boolean>('dev_log_enabled'),
    write: (kind, detail) => invoke('dev_log_write', { kind, detail }),
    reveal: () => invoke('dev_log_reveal'),
  };
}

/** A keystroke that takes longer than this to reach the screen is logged. */
export const SLOW_KEY_MS = 100;
/** How many of the last keys a snapshot holds. */
export const KEYS_KEPT = 12;

/** What the snapshot says of the state, besides the keys. */
export interface SnapshotState {
  text: string;
  selection: { from: number; to: number };
  view: string;
  tracking: boolean;
}

export interface DevLog {
  /** Whether this build keeps the log. A release build never does. */
  readonly enabled: boolean;
  log(kind: DevLogKind, detail: string): void;
  /** Adds the person's note, and a snapshot of the state, so that a report can point at the moment. */
  writeNote(note: string, state: SnapshotState): Promise<void>;
  reveal(): void;
  /** Starts noting the keys, and the keystrokes that were slow, of a window. */
  watchKeys(target: EventTarget): () => void;
}

/** A key as the log names it: never the character typed (see the body). */
export function keyName(event: {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}): string {
  // A run of names must never spell what was typed: a printable key (a letter, digit, punctuation,
  // space, or what Option types) is `char`, whatever `key` or `code` says. Named are the keys that
  // print nothing, and a chord with ⌘ or ⌃, which is a command and not text.
  const printable = event.key.length === 1 || event.key === 'Dead' || event.key === 'Unidentified';
  const command = event.metaKey || event.ctrlKey;
  if (printable && !command) return 'char';
  const name = printable
    ? event.key === ' '
      ? 'Space'
      : event.key.toUpperCase()
    : event.key === 'Enter'
      ? 'Return'
      : event.key;
  return `${event.metaKey ? '⌘' : ''}${event.ctrlKey ? '⌃' : ''}${event.altKey ? '⌥' : ''}${event.shiftKey ? '⇧' : ''}${name}`;
}

/** The first 12 hexadecimal digits of the SHA-256 of `text`. */
export async function documentHash(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .slice(0, 6)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

const OFF: DevLog = {
  enabled: false,
  log: () => {},
  writeNote: () => Promise.resolve(),
  reveal: () => {},
  watchKeys: () => () => {},
};

/** The log of this build: with no link (a browser tab) or in a release build, one that does nothing. */
export async function createDevLog(link: DevLogLink | null): Promise<DevLog> {
  if (!link || !(await link.enabled().catch(() => false))) return OFF;
  const keys: string[] = [];
  const log = (kind: DevLogKind, detail: string) => void link.write(kind, detail).catch(() => {});
  return {
    enabled: true,
    log,
    async writeNote(note, state) {
      log('note', note.trim() || '(no text)');
      const hash = await documentHash(state.text);
      log(
        'snapshot',
        `document ${hash}, ${state.text.length} characters, selection ${state.selection.from}-${state.selection.to}, view ${state.view}, tracking ${state.tracking ? 'on' : 'off'}, last keys ${keys.join(' ') || 'none'}`,
      );
    },
    reveal: () => void link.reveal().catch(() => {}),
    watchKeys(target) {
      const onKey = (raw: Event) => {
        const event = raw as KeyboardEvent;
        keys.push(keyName(event));
        if (keys.length > KEYS_KEPT) keys.shift();
        const at = performance.now();
        // The next frame is when the key's work has reached the screen.
        requestAnimationFrame(() => {
          const took = Math.round(performance.now() - at);
          if (took > SLOW_KEY_MS) log('slow', `keystroke took ${took} ms`);
        });
      };
      target.addEventListener('keydown', onKey, true);
      return () => target.removeEventListener('keydown', onKey, true);
    },
  };
}
