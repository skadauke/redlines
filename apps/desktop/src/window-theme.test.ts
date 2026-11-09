// @vitest-environment happy-dom
import { invoke } from '@tauri-apps/api/core';
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

// The app's command that sets the appearance of every window (src-tauri/src/appearance.rs): a
// test has no app, so the calls are recorded instead.
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

/**
 * A stand-in for `matchMedia('(prefers-color-scheme: dark)')`: the appearance the page is told,
 * which the test sets. As a real query, it tells of a change only when there is one.
 */
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
      if (query.matches === next) return;
      query.matches = next;
      for (const fn of listeners) fn({ matches: next });
    },
  };
}

/** The windows a test opens, which stop following once it is over. */
const opened: WindowTheme[] = [];

/**
 * A window of the app (or of a plain browser) opening on the settings stored, as every window
 * does, once `stored` is saved. Only Preferences and the document windows set the appearance of
 * the app; the install question has nothing to set, nor has a plain browser.
 */
function openWindow(stored: Partial<Settings> = {}, setsAppearance = true) {
  saveSettings({ ...loadSettings(), ...stored });
  const root = document.createElement('div');
  const theme = followTheme(root, loadSettings(), { setsAppearance });
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

/** The appearances the windows set the app's to, in order. */
const sent = () =>
  vi.mocked(invoke).mock.calls.map(([command, args]) => {
    expect(command).toBe('set_appearance');
    return (args as { appearance: AppearanceChoice }).appearance;
  });

beforeEach(() => {
  vi.mocked(invoke).mockResolvedValue(undefined);
});

afterEach(() => {
  for (const theme of opened.splice(0)) theme.stop();
  vi.mocked(invoke).mockReset();
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
    const windows = [openWindow(), openWindow(), openWindow({}, false)];
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

  it('ends as the system is after Dark and Match System, though told Dark meanwhile, with no loop', async () => {
    // As in WKWebView: while the app is Light or Dark, the page is told that appearance, and once
    // the app is back to Match System, the system's again, a moment after the app takes it.
    let systemDark = false;
    const told = mockSystem(systemDark);
    vi.mocked(invoke).mockImplementation((_command, args) => {
      const { appearance } = args as { appearance: AppearanceChoice };
      const taken = appearance === 'system' ? systemDark : appearance === 'dark';
      return Promise.resolve().then(() => told.set(taken));
    });
    const settled = () => new Promise((resolve) => setTimeout(resolve, 0));
    const windows = [openWindow({ theme: 'book' }), openWindow()];
    const shown = () => windows.map((page) => page.shown());
    await settled();

    changeElsewhere({ appearance: 'dark' });
    await settled();
    expect(shown()).toEqual([
      ['book', 'dark'],
      ['book', 'dark'],
    ]);

    // Back to Match System: the page is told Dark until the app is the system's again.
    changeElsewhere({ appearance: 'system' });
    expect(shown()).toEqual([
      ['book', 'dark'],
      ['book', 'dark'],
    ]);
    await settled();
    expect(shown()).toEqual([
      ['book', 'light'],
      ['book', 'light'],
    ]);

    // The system turns dark, and the windows follow it.
    systemDark = true;
    told.set(true);
    await settled();
    expect(shown()).toEqual([
      ['book', 'dark'],
      ['book', 'dark'],
    ]);

    // Each window set the appearance once for each choice; being told it set nothing more.
    await settled();
    expect(sent()).toEqual(['system', 'system', 'dark', 'dark', 'system', 'system']);
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

describe('the appearance of the app', () => {
  it('is set by each window as it opens, in the words of the settings', () => {
    mockSystem(false);
    openWindow({ appearance: 'dark' });
    expect(invoke).toHaveBeenLastCalledWith('set_appearance', { appearance: 'dark' });
    openWindow({ appearance: 'light' });
    expect(invoke).toHaveBeenLastCalledWith('set_appearance', { appearance: 'light' });
    openWindow({ appearance: 'system' });
    expect(invoke).toHaveBeenLastCalledWith('set_appearance', { appearance: 'system' });
    expect(sent()).toEqual(['dark', 'light', 'system']);
  });

  it('is set again by each window that sets it when one window changes it, and by a later one', () => {
    mockSystem(false);
    // A document window and Preferences set it; the install question does not.
    openWindow();
    openWindow();
    openWindow({}, false);
    expect(sent()).toEqual(['system', 'system']);

    changeElsewhere({ appearance: 'dark' });
    expect(sent()).toEqual(['system', 'system', 'dark', 'dark']);
    changeElsewhere({ appearance: 'light' });
    changeElsewhere({ appearance: 'system' });
    expect(sent().slice(4)).toEqual(['light', 'light', 'system', 'system']);

    // Another setting, or the theme alone, sets nothing.
    changeElsewhere({ theme: 'book', textSize: 1.25, recent: ['/notes/plan.md'] });
    expect(sent()).toHaveLength(8);

    // A window opened later sets the choice as it stands.
    changeElsewhere({ appearance: 'dark' });
    vi.mocked(invoke).mockClear();
    openWindow();
    expect(sent()).toEqual(['dark']);
  });

  it('is set by the window that changes it, as it changes it', () => {
    mockSystem(false);
    const preferences = openWindow();
    vi.mocked(invoke).mockClear();
    preferences.theme.show({ ...DEFAULT_SETTINGS, appearance: 'light' });
    preferences.theme.show({ ...DEFAULT_SETTINGS, appearance: 'light', theme: 'editorial' });
    preferences.theme.show({ ...DEFAULT_SETTINGS, appearance: 'system' });
    expect(sent()).toEqual(['light', 'system']);
  });

  it('is not set by a window with nothing to set: the install question, or a plain browser', () => {
    mockSystem(true);
    const page = openWindow({ appearance: 'light' }, false);
    changeElsewhere({ appearance: 'dark' });
    page.theme.show({ ...DEFAULT_SETTINGS, appearance: 'system' });
    expect(page.shown()).toEqual(['default', 'dark']);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('says in the console, and the page goes on, when the app refuses it', async () => {
    mockSystem(false);
    const error = new Error('The install window doesn’t set the appearance');
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(invoke).mockRejectedValue(error);
    const page = openWindow({ theme: 'book', appearance: 'dark' });
    expect(page.shown()).toEqual(['book', 'dark']);
    await vi.waitFor(() => expect(logged).toHaveBeenCalledOnce());
    expect(logged.mock.calls[0]?.[1]).toBe(error);
    changeElsewhere({ appearance: 'light' });
    expect(page.shown()).toEqual(['book', 'light']);
    await vi.waitFor(() => expect(logged).toHaveBeenCalledTimes(2));
  });
});
