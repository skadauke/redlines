// The app's update source (updates.ts): whether this copy can update itself, from the Rust side
// (src-tauri/src/updates.rs), and the updater plugin, which checks the latest release's manifest,
// downloads the update, verifies its signature and installs it. The link to the window that checks
// for the whole app (update-owner.ts, src-tauri/src/update_owner.rs). And starting the new version.

import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { check } from '@tauri-apps/plugin-updater';
import type { Joined, UpdateLink, UpdateMessage } from './update-owner.ts';
import { CHECK_TIMEOUT_MS, type Availability, type UpdateSource } from './updates.ts';

/** How long a download may take before it fails, to be tried again later. */
const DOWNLOAD_TIMEOUT_MS = 15 * 60 * 1000;

export function tauriUpdateSource(): UpdateSource {
  return {
    availability: () => invoke<Availability>('update_availability'),
    async check() {
      const update = await check({ timeout: CHECK_TIMEOUT_MS });
      if (!update) return null;
      return {
        version: update.version,
        download: () => update.download(undefined, { timeout: DOWNLOAD_TIMEOUT_MS }),
        install: () => update.install(),
        close: () => update.close(),
      };
    },
  };
}

/** This window's link to the app's one owner of the updates (src-tauri/src/update_owner.rs). */
export function tauriUpdateLink(): UpdateLink {
  return {
    // Not the `listen` that hears every window's events: the app sends each its own.
    listen: (handler) =>
      getCurrentWebviewWindow().listen<UpdateMessage>('updates', ({ payload }) => handler(payload)),
    join: () => invoke<Joined>('update_join'),
    report: (state) => invoke('update_report', { state }),
    ask: (id, what) => invoke('update_ask', { id, what }),
    answer: (id, answer) => invoke('update_answer', { id, answer }),
    dismiss: (version) => invoke('update_dismiss', { version }),
  };
}

/**
 * Quits and starts the app again, which after an update is the new version, opening `paths`, the
 * documents that were open. The app quits before this resolves.
 */
export function relaunch(paths: readonly string[]): Promise<void> {
  return invoke('relaunch', { files: paths });
}
