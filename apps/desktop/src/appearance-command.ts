// The app's `set_appearance` command, which Preferences and the document windows may call
// (src-tauri/capabilities). Its own file, so that the install question's window, which follows the
// theme too (window-theme.ts), doesn't reach it.

import { invoke } from '@tauri-apps/api/core';
import type { AppearanceChoice } from './settings.ts';

/** Sets the appearance of the app's windows; a refusal is told in the console. */
export function setAppearance(appearance: AppearanceChoice): void {
  invoke('set_appearance', { appearance }).catch((error: unknown) => {
    console.error('Could not set the appearance of the windows', error);
  });
}
