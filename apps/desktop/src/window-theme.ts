// The theme a window shows, and the appearance of the window itself (design §6.6). The page shows
// the one theme, light or dark as Preferences say, or as the system is under Match System. The
// window takes the appearance too: its title bar, its scroll bars, and the system's menus and
// dialogs in it. That is the app's appearance, which Tauri sets for all its windows at once, About
// Redlines (the system's panel) and the windows opened later among them; each window asks for it
// when it opens and whenever the choice changes, so that none depends on another having asked.

import { applyTheme } from '@redlines/themes';
import { setTheme } from '@tauri-apps/api/app';
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
 * Shows the theme `settings` choose on `root` and, in the app, asks it for that appearance; then
 * follows the settings as another window changes them, and the system's appearance as it changes.
 */
export function followTheme(
  root: HTMLElement,
  settings: Settings,
  { inApp }: { inApp: boolean },
): WindowTheme {
  let current = settings;
  let system = currentAppearance();
  /** What this window asked the app for last, so that a change to another setting asks nothing. */
  let asked: AppearanceChoice | null = null;
  const draw = () => {
    const shown = shownTheme(current, system);
    applyTheme(root, shown.theme, shown.appearance);
  };
  const show = (next: Settings) => {
    current = next;
    draw();
    if (!inApp || next.appearance === asked) return;
    asked = next.appearance;
    // Null is the system's appearance, for Match System.
    setTheme(next.appearance === 'system' ? null : next.appearance).catch((error: unknown) => {
      console.error('Could not set the appearance of the windows', error);
    });
  };
  const stopSystem = watchAppearance((next) => {
    system = next;
    draw();
  });
  const stopSettings = watchSettings(show);
  show(settings);
  return {
    show,
    stop: () => {
      stopSystem();
      stopSettings();
    },
  };
}
