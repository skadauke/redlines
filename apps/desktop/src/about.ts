// About Redlines: the app's name and its build tag, which says which build this is, for telling
// testers' copies apart (src-tauri/src/build_tag.rs). The About item opens a small window of the
// app's own (`open_about`, src/about/main.ts), on every system, and it is the only place that shows
// the build tag.

import { invoke } from '@tauri-apps/api/core';

export interface About {
  name: string;
  /** `0.1.0` for a release, `0.1.0-dev` for any other build. */
  version: string;
  /** The commit, `1a2b3c4`, and for any build but a release the time it was built. */
  build: string;
}

export function loadAbout(): Promise<About> {
  return invoke<About>('about');
}

/** The version line: "Version 0.1.0 (1a2b3c4)", as the system's About panel showed the build tag. */
export function versionLine(about: About): string {
  return `Version ${about.version} (${about.build})`;
}

/** The copyright line, which is the license's own (LICENSE). */
export const COPYRIGHT = 'Copyright © 2026 skadauke';
