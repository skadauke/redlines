// The app's side of a window's updates (updates.ts): the commands a window asks through and the
// event it hears in (src-tauri/src/updates.rs), and starting the new version. The app checks,
// downloads and installs; the window can't do any of that itself, for the updater plugin's
// permissions aren't the window's (src-tauri/capabilities/default.json).

import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import type { CheckResult, UpdateLink, UpdateMessage, UpdateSnapshot } from './updates.ts';

/** The event the app tells every window of the updates in. */
export const UPDATES_EVENT = 'updates';

export function tauriUpdateLink(): UpdateLink {
  return {
    listen: (handler) =>
      getCurrentWebviewWindow().listen<UpdateMessage>(UPDATES_EVENT, ({ payload }) =>
        handler(payload),
      ),
    read: () => invoke<UpdateSnapshot>('update_state'),
    check: () => invoke<CheckResult>('update_check'),
    install: () => invoke('update_install'),
    dismiss: (version) => invoke('update_dismiss', { version }),
    setAutomatic: (on) => invoke('update_set_automatic', { on }),
  };
}

/**
 * Quits and starts the app again, which after an update is the new version, opening `paths`, the
 * documents that were open. The app quits before this resolves.
 */
export function relaunch(paths: readonly string[]): Promise<void> {
  return invoke('relaunch', { files: paths });
}
