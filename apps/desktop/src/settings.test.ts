// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  currentAppearance,
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  SETTINGS_KEY,
  themeFor,
  watchAppearance,
} from './settings.ts';

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

/** A stand-in for `matchMedia('(prefers-color-scheme: dark)')` whose answer the test changes. */
function mockColorScheme(dark: boolean) {
  const listeners = new Set<(event: { matches: boolean }) => void>();
  const query = {
    matches: dark,
    addEventListener: (_: string, fn: (event: { matches: boolean }) => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: (event: { matches: boolean }) => void) =>
      listeners.delete(fn),
  };
  const matchMedia = vi.fn((media: string) => {
    expect(media).toBe('(prefers-color-scheme: dark)');
    return query;
  });
  vi.stubGlobal('matchMedia', matchMedia);
  return {
    listeners,
    set(next: boolean) {
      query.matches = next;
      for (const fn of listeners) fn({ matches: next });
    },
  };
}

describe('settings', () => {
  it('settings default and persist', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      lightTheme: 'default',
      darkTheme: 'default',
      sidebarOpen: false,
      rotateIcon: true,
      checkForUpdates: true,
      textSize: 1,
    });
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);

    const changed = {
      lightTheme: 'book',
      darkTheme: 'editorial',
      sidebarOpen: true,
      rotateIcon: false,
      checkForUpdates: false,
      textSize: 1.25,
    } as const;
    saveSettings(changed);
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '')).toEqual(changed);
    expect(SETTINGS_KEY).toBe('redlines.settings');
    expect(loadSettings()).toEqual(changed);
  });

  it('ignores stored values it does not know', () => {
    localStorage.setItem(
      SETTINGS_KEY,
      '{"lightTheme":"neon","sidebarOpen":"yes","darkTheme":"book","rotateIcon":"no","checkForUpdates":1}',
    );
    expect(loadSettings()).toEqual({ ...DEFAULT_SETTINGS, darkTheme: 'book' });
    localStorage.setItem(SETTINGS_KEY, 'not json');
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('rotates the icon unless the person turned it off, also for settings saved before it', () => {
    localStorage.setItem(
      SETTINGS_KEY,
      '{"lightTheme":"book","darkTheme":"editorial","sidebarOpen":true}',
    );
    expect(loadSettings()).toEqual({
      lightTheme: 'book',
      darkTheme: 'editorial',
      sidebarOpen: true,
      rotateIcon: true,
      checkForUpdates: true,
      textSize: 1,
    });
    localStorage.setItem(SETTINGS_KEY, '{"rotateIcon":false}');
    expect(loadSettings()).toEqual({ ...DEFAULT_SETTINGS, rotateIcon: false });
  });

  it('checks for updates unless the person turned it off, also for settings saved before it', () => {
    localStorage.setItem(SETTINGS_KEY, '{"lightTheme":"book","rotateIcon":false}');
    expect(loadSettings().checkForUpdates).toBe(true);
    localStorage.setItem(SETTINGS_KEY, '{"checkForUpdates":false}');
    expect(loadSettings()).toEqual({ ...DEFAULT_SETTINGS, checkForUpdates: false });
  });

  it('keeps a text size from the ladder and takes the default for any other', () => {
    localStorage.setItem(SETTINGS_KEY, '{"textSize":1.5}');
    expect(loadSettings().textSize).toBe(1.5);
    for (const stored of ['"1.5"', '3', '0', 'null']) {
      localStorage.setItem(SETTINGS_KEY, `{"textSize":${stored}}`);
      expect(loadSettings().textSize).toBe(1);
    }
  });

  it('appearance follows the media query', () => {
    const scheme = mockColorScheme(true);
    expect(currentAppearance()).toBe('dark');

    const seen: string[] = [];
    const stop = watchAppearance((appearance) => seen.push(appearance));
    scheme.set(false);
    expect(seen).toEqual(['light']);
    expect(currentAppearance()).toBe('light');

    stop();
    expect(scheme.listeners.size).toBe(0);
  });

  it('picks the light or dark theme for the appearance', () => {
    const settings = {
      lightTheme: 'book',
      darkTheme: 'editorial',
      sidebarOpen: false,
      rotateIcon: true,
      checkForUpdates: true,
      textSize: 1,
    } as const;
    expect(themeFor(settings, 'light')).toBe('book');
    expect(themeFor(settings, 'dark')).toBe('editorial');
  });
});
