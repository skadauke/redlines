// The app's update source (updates.ts): whether this copy can update itself, from the Rust side
// (src-tauri/src/updates.rs), and the updater plugin, which checks the latest release's manifest,
// downloads the update, verifies its signature and installs it. And starting the new version.

import { invoke } from '@tauri-apps/api/core';
import { check } from '@tauri-apps/plugin-updater';
import type { Availability, UpdateSource } from './updates.ts';

/** How long a check, and a download, may take before it fails, to be tried again later. */
const CHECK_TIMEOUT_MS = 60 * 1000;
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

/**
 * Quits and starts the app again, which after an update is the new version, opening `paths`, the
 * documents that were open. The app quits before this resolves.
 */
export function relaunch(paths: readonly string[]): Promise<void> {
  return invoke('relaunch', { files: paths });
}
