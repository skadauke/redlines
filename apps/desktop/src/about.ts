// About Redlines: the app's name and its build tag, which says which build this is, for telling
// testers' copies apart (src-tauri/src/build_tag.rs). The About item shows it, and nothing else in
// the window does. On a Mac the item opens the standard About panel.

import { invoke } from '@tauri-apps/api/core';
import type { AboutMetadata } from '@tauri-apps/api/menu';

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

/**
 * The About item's contents. The Mac's panel shows the version and, in parentheses, the build:
 * "Version 0.1.0 (1a2b3c4)"; Windows and Linux show "0.1.0 (1a2b3c4)".
 */
export function aboutMetadata(about: About): AboutMetadata {
  return { name: about.name, version: about.version, shortVersion: about.build };
}
