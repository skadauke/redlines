// @vitest-environment happy-dom
import { setTheme } from '@tauri-apps/api/app';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  SETTINGS_KEY,
  type AppearanceChoice,
  type Settings,
} from './settings.ts';
import { followTheme, type WindowTheme } from './window-theme.ts';

// The app's appearance, which Tauri sets for all its windows: a test has no app, so the call is
// recorded instead.
vi.mock('@tauri-apps/api/app', () => ({ setTheme: vi.fn() }));

/** A stand-in for `matchMedia('(prefers-color-scheme: dark)')`: the system, which the test sets. */
function mockSystem(dark: boolean) {
  const listeners = new Set<(event: { matches: boolean }) => void>();
  const query = {
    matches: dark,
    addEventListener: (_: string, fn: (event: { matches: boolean }) => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: (event: { matches: boolean }) => void) =>
      listeners.delete(fn),
  };
  vi.stubGlobal(
    'matchMedia',
    vi.fn((media: string) => {
      expect(media).toBe('(prefers-color-scheme: dark)');
      return query;
    }),
  );
  return {
    listeners,
    set(next: boolean) {
      query.matches = next;
      for (const fn of listeners) fn({ matches: next });
    },
  };
}

/** The windows a test opens, which stop following once it is over. */
const opened: WindowTheme[] = [];

/**
 * A window of the app (or of a plain browser) opening on the settings stored, as every window
 * does, once `stored` is saved.
 */
function openWindow(stored: Partial<Settings> = {}, inApp = true) {
  saveSettings({ ...loadSettings(), ...stored });
  const root = document.createElement('div');
  const theme = followTheme(root, loadSettings(), { inApp });
  opened.push(theme);
  return {
    theme,
    /** The theme and appearance the page shows. */
    shown: () => [root.dataset['rlTheme'], root.dataset['rlAppearance']],
  };
}

/** Another window changes the settings: it saves them, and the browser tells every other one. */
function changeElsewhere(change: Partial<Settings>) {
  saveSettings({ ...loadSettings(), ...change });
  window.dispatchEvent(new StorageEvent('storage', { key: SETTINGS_KEY }));
}

/** What the windows asked the app for, in order. */
const asked = () => vi.mocked(setTheme).mock.calls.map(([theme]) => theme);

beforeEach(() => {
  vi.mocked(setTheme).mockResolvedValue(undefined);
});

afterEach(() => {
  for (const theme of opened.splice(0)) theme.stop();
  vi.mocked(setTheme).mockReset();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the theme of a window', () => {
  it('is the one theme, light or dark as chosen, or as the system is under Match System', () => {
    const cases: [AppearanceChoice, boolean, string][] = [
      ['system', false, 'light'],
      ['system', true, 'dark'],
      ['light', false, 'light'],
      ['light', true, 'light'],
      ['dark', false, 'dark'],
      ['dark', true, 'dark'],
    ];
    for (const [appearance, systemDark, shown] of cases) {
      mockSystem(systemDark);
      const page = openWindow({ theme: 'book', appearance });
      expect(page.shown(), `${appearance}, system ${systemDark ? 'dark' : 'light'}`).toEqual([
        'book',
        shown,
      ]);
    }
  });

  it('follows the system as it changes under Match System, and holds Light or Dark', () => {
    const system = mockSystem(false);
    const matching = openWindow({ appearance: 'system' });
    const light = openWindow({ appearance: 'light' });
    const dark = openWindow({ appearance: 'dark' });
    system.set(true);
    expect([matching.shown(), light.shown(), dark.shown()]).toEqual([
      ['default', 'dark'],
      ['default', 'light'],
      ['default', 'dark'],
    ]);
    system.set(false);
    expect([matching.shown(), light.shown(), dark.shown()]).toEqual([
      ['default', 'light'],
      ['default', 'light'],
      ['default', 'dark'],
    ]);
  });

  it('changes in every open window at once when one window changes it', () => {
    const system = mockSystem(false);
    // A document window, Preferences and the install question, all as the settings are now.
    const windows = [openWindow(), openWindow(), openWindow()];
    expect(windows.map((page) => page.shown())).toEqual([
      ['default', 'light'],
      ['default', 'light'],
      ['default', 'light'],
    ]);

    changeElsewhere({ theme: 'editorial', appearance: 'dark' });
    expect(windows.map((page) => page.shown())).toEqual([
      ['editorial', 'dark'],
      ['editorial', 'dark'],
      ['editorial', 'dark'],
    ]);
    changeElsewhere({ appearance: 'system' });
    expect(windows.map((page) => page.shown())).toEqual([
      ['editorial', 'light'],
      ['editorial', 'light'],
      ['editorial', 'light'],
    ]);
    system.set(true);
    expect(windows.map((page) => page.shown())).toEqual([
      ['editorial', 'dark'],
      ['editorial', 'dark'],
      ['editorial', 'dark'],
    ]);

    // A window opened after the change shows it too.
    expect(openWindow().shown()).toEqual(['editorial', 'dark']);
    // Another key's change is not the settings'.
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ theme: 'book' }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'something.else' }));
    expect(windows[0]?.shown()).toEqual(['editorial', 'dark']);
  });

  it('shows a change the window made itself, which no other window tells it of', () => {
    mockSystem(false);
    const preferences = openWindow();
    preferences.theme.show({ ...DEFAULT_SETTINGS, theme: 'book', appearance: 'dark' });
    expect(preferences.shown()).toEqual(['book', 'dark']);
  });

  it('stops following the settings and the system once stopped', () => {
    const system = mockSystem(false);
    const page = openWindow();
    page.theme.stop();
    changeElsewhere({ theme: 'book' });
    system.set(true);
    expect(page.shown()).toEqual(['default', 'light']);
    expect(system.listeners.size).toBe(0);
  });
});

describe('the appearance of the window itself', () => {
  it('is asked of the app by each window: light, dark, or the system’s for Match System', () => {
    mockSystem(false);
    openWindow({ appearance: 'dark' });
    expect(setTheme).toHaveBeenLastCalledWith('dark');
    openWindow({ appearance: 'light' });
    expect(setTheme).toHaveBeenLastCalledWith('light');
    // Null is the system's.
    openWindow({ appearance: 'system' });
    expect(setTheme).toHaveBeenLastCalledWith(null);
    expect(asked()).toEqual(['dark', 'light', null]);
  });

  it('is asked again by every open window when one window changes it, and by a later window', () => {
    mockSystem(false);
    openWindow();
    openWindow();
    openWindow();
    expect(asked()).toEqual([null, null, null]);

    changeElsewhere({ appearance: 'dark' });
    expect(asked()).toEqual([null, null, null, 'dark', 'dark', 'dark']);
    changeElsewhere({ appearance: 'light' });
    changeElsewhere({ appearance: 'system' });
    expect(asked().slice(6)).toEqual(['light', 'light', 'light', null, null, null]);

    // Another setting, or the theme alone, changes nothing of the window's own appearance.
    changeElsewhere({ theme: 'book', textSize: 1.25, recent: ['/notes/plan.md'] });
    expect(asked()).toHaveLength(12);

    // A window opened later asks for the choice as it stands.
    changeElsewhere({ appearance: 'dark' });
    vi.mocked(setTheme).mockClear();
    openWindow();
    expect(asked()).toEqual(['dark']);
  });

  it('is asked for by the window that changes it, as it changes it', () => {
    mockSystem(false);
    const preferences = openWindow();
    vi.mocked(setTheme).mockClear();
    preferences.theme.show({ ...DEFAULT_SETTINGS, appearance: 'light' });
    preferences.theme.show({ ...DEFAULT_SETTINGS, appearance: 'light', theme: 'editorial' });
    preferences.theme.show({ ...DEFAULT_SETTINGS, appearance: 'system' });
    expect(asked()).toEqual(['light', null]);
  });

  it('is not asked for in a plain browser, which has no app', () => {
    mockSystem(true);
    const page = openWindow({ appearance: 'light' }, false);
    changeElsewhere({ appearance: 'dark' });
    expect(page.shown()).toEqual(['default', 'dark']);
    expect(setTheme).not.toHaveBeenCalled();
  });

  it('says in the console, and the page goes on, when the app cannot be asked', async () => {
    mockSystem(false);
    const error = new Error('not allowed');
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(setTheme).mockRejectedValue(error);
    const page = openWindow({ theme: 'book', appearance: 'dark' });
    expect(page.shown()).toEqual(['book', 'dark']);
    await vi.waitFor(() => expect(logged).toHaveBeenCalledOnce());
    expect(logged.mock.calls[0]?.[1]).toBe(error);
    changeElsewhere({ appearance: 'light' });
    expect(page.shown()).toEqual(['book', 'light']);
    await vi.waitFor(() => expect(logged).toHaveBeenCalledTimes(2));
  });
});
