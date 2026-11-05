// Each person's own settings, kept in this app's local storage: the theme for the light and the
// dark appearance (design §6.6), whether the file sidebar is shown, whether the Dock icon rotates,
// whether the app checks for updates by itself, and the text size. The appearance itself follows
// the system's.

import { THEMES, type Appearance, type ThemeName } from '@redlines/themes';
import { TEXT_SIZES } from './text-size.ts';

export interface Settings {
  lightTheme: ThemeName;
  darkTheme: ThemeName;
  sidebarOpen: boolean;
  /**
   * Whether the running app's icon shows a different mark of the icon family at every launch (the
   * Dock icon, or the window's where there is no Dock). Off keeps the caret, the installed icon.
   */
  rotateIcon: boolean;
  /** Whether the app checks for updates by itself, soon after it starts and every few hours. */
  checkForUpdates: boolean;
  /** The text size, as a multiple of the theme's own (see text-size.ts). */
  textSize: number;
}

export const SETTINGS_KEY = 'redlines.settings';

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  lightTheme: 'default',
  darkTheme: 'default',
  sidebarOpen: false,
  rotateIcon: true,
  checkForUpdates: true,
  textSize: 1,
};

const DARK_QUERY = '(prefers-color-scheme: dark)';

/** The stored settings; any value missing or not understood takes its default. */
export function loadSettings(): Settings {
  let stored: unknown;
  try {
    stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null');
  } catch {
    stored = null;
  }
  const value = (stored ?? {}) as Record<string, unknown>;
  return {
    lightTheme: isTheme(value['lightTheme']) ? value['lightTheme'] : DEFAULT_SETTINGS.lightTheme,
    darkTheme: isTheme(value['darkTheme']) ? value['darkTheme'] : DEFAULT_SETTINGS.darkTheme,
    sidebarOpen:
      typeof value['sidebarOpen'] === 'boolean'
        ? value['sidebarOpen']
        : DEFAULT_SETTINGS.sidebarOpen,
    rotateIcon:
      typeof value['rotateIcon'] === 'boolean' ? value['rotateIcon'] : DEFAULT_SETTINGS.rotateIcon,
    checkForUpdates:
      typeof value['checkForUpdates'] === 'boolean'
        ? value['checkForUpdates']
        : DEFAULT_SETTINGS.checkForUpdates,
    textSize: isTextSize(value['textSize']) ? value['textSize'] : DEFAULT_SETTINGS.textSize,
  };
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Storage can be full or switched off; the settings then last until the window closes.
  }
}

export function themeFor(settings: Settings, appearance: Appearance): ThemeName {
  return appearance === 'dark' ? settings.darkTheme : settings.lightTheme;
}

/** The system's appearance now. */
export function currentAppearance(): Appearance {
  return matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
}

/** Calls `onChange` when the system's appearance changes; returns a function that stops it. */
export function watchAppearance(onChange: (appearance: Appearance) => void): () => void {
  const query = matchMedia(DARK_QUERY);
  const listener = (event: { matches: boolean }) => onChange(event.matches ? 'dark' : 'light');
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}

function isTheme(value: unknown): value is ThemeName {
  return THEMES.some((theme) => theme.name === value);
}

function isTextSize(value: unknown): value is number {
  return typeof value === 'number' && TEXT_SIZES.includes(value);
}
