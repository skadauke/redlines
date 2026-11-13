// The theme a window shows, and the appearance of the window itself (design §6.6). The page shows
// the one theme, light or dark as Preferences say, or as the system is under Match System. The
// window takes the appearance too: its title bar, its scroll bars, and the system's menus and
// dialogs in it. That is the app's appearance, the same for all its windows at once, About
// Redlines and the windows opened later among them. The app keeps a copy of
// it and takes it before it opens a window (src-tauri/src/appearance.rs), so that no window shows
// another one first. Preferences sets it as the person chooses it, and each document window as it
// opens and as the choice changes, which keeps that copy the same as the settings.

import { applyTheme } from '@redlines/themes';
import {
  currentAppearance,
  shownTheme,
  watchAppearance,
  watchSettings,
  type AppearanceChoice,
  type Settings,
} from './settings.ts';

export interface WindowTheme {
  /**
   * Shows the theme of `settings`, which this window has just changed: a window hears of the other
   * windows' changes by itself, but not of its own.
   */
  show(settings: Settings): void;
  /** Stops following the settings and the system. */
  stop(): void;
}

/**
 * Shows the theme `settings` choose on `root` and, in a window that sets it, sets the app's
 * appearance to theirs through `setAppearance` (appearance-command.ts, which only those windows
 * import: the install question's may not call it); then follows the settings as another window
 * changes them, and the appearance the page is told as it changes.
 */
export function followTheme(
  root: HTMLElement,
  settings: Settings,
  { setAppearance }: { setAppearance?: (appearance: AppearanceChoice) => void },
): WindowTheme {
  let current = settings;
  /** The appearance the page is told: the system's under Match System, else the app's. */
  let told = currentAppearance();
  /** The appearance this window set last, so that a change to another setting sets nothing. */
  let sent: AppearanceChoice | null = null;
  const draw = () => {
    const shown = shownTheme(current, told);
    applyTheme(root, shown.theme, shown.appearance);
  };
  const show = (next: Settings) => {
    current = next;
    draw();
    if (!setAppearance || next.appearance === sent) return;
    sent = next.appearance;
    setAppearance(next.appearance);
  };
  const stopTold = watchAppearance((next) => {
    told = next;
    draw();
  });
  const stopSettings = watchSettings(show);
  show(settings);
  return {
    show,
    stop: () => {
      stopTold();
      stopSettings();
    },
  };
}
