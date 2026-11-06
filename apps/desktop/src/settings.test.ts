// @vitest-environment happy-dom
import { meetPeople } from '@redlines/editor';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  currentAppearance,
  DEFAULT_SETTINGS,
  authorFrom,
  loadSettings,
  meetPeopleInSettings,
  reopenLastDocument,
  saveSettings,
  updateSettings,
  SETTINGS_KEY,
  themeFor,
  watchAppearance,
  watchSettings,
} from './settings.ts';

afterEach(() => {
  vi.restoreAllMocks();
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
      showResolved: false,
      rotateIcon: true,
      checkForUpdates: true,
      identity: null,
      onLaunch: 'new',
      lastDocument: null,
      recent: [],
      textSize: 1,
      spellCheck: true,
      smartPunctuation: true,
      closePairs: true,
      trackNewDocuments: false,
      agentScope: 'folder',
      consent: {},
      people: [],
    });
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);

    const changed = {
      lightTheme: 'book',
      darkTheme: 'editorial',
      sidebarOpen: true,
      showResolved: true,
      rotateIcon: false,
      checkForUpdates: false,
      identity: { name: 'Ada Lovelace', handle: 'ada' },
      onLaunch: 'reopen',
      lastDocument: '/notes/plan.md',
      recent: ['/notes/plan.md', '/notes/old.md'],
      textSize: 1.25,
      spellCheck: false,
      smartPunctuation: false,
      closePairs: false,
      trackNewDocuments: true,
      agentScope: 'document',
      consent: { 'claude|/notes': 'folder', 'codex|/notes': 'no' },
      people: [
        { handle: 'bo', color: 2 },
        { handle: 'claude-bo', color: 3 },
      ],
    } as const;
    saveSettings(changed);
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '')).toEqual(changed);
    expect(SETTINGS_KEY).toBe('redlines.settings');
    expect(loadSettings()).toEqual(changed);
  });

  it('ignores stored values it does not know', () => {
    localStorage.setItem(
      SETTINGS_KEY,
      '{"lightTheme":"neon","sidebarOpen":"yes","darkTheme":"book","rotateIcon":"no","showResolved":"yes","checkForUpdates":1}',
    );
    expect(loadSettings()).toEqual({ ...DEFAULT_SETTINGS, darkTheme: 'book' });
    localStorage.setItem(SETTINGS_KEY, 'not json');
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps the recent files that are paths, once each, at most ten', () => {
    const many = Array.from({ length: 14 }, (_, i) => `/${i}.md`);
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ recent: ['/a.md', 4, '', '/a.md', null, '/b.md', ...many] }),
    );
    expect(loadSettings().recent).toEqual(['/a.md', '/b.md', ...many.slice(0, 8)]);
  });

  it('rotates the icon unless the person turned it off, also for settings saved before it', () => {
    localStorage.setItem(
      SETTINGS_KEY,
      '{"lightTheme":"book","darkTheme":"editorial","sidebarOpen":true}',
    );
    expect(loadSettings()).toEqual({
      ...DEFAULT_SETTINGS,
      lightTheme: 'book',
      darkTheme: 'editorial',
      sidebarOpen: true,
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
    const settings = { ...DEFAULT_SETTINGS, lightTheme: 'book', darkTheme: 'editorial' } as const;
    expect(themeFor(settings, 'light')).toBe('book');
    expect(themeFor(settings, 'dark')).toBe('editorial');
  });

  it('falls back to the default for every new setting that holds a bad value', () => {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        identity: { name: 'Ada' },
        onLaunch: 'ask',
        lastDocument: 4,
        recent: 'plan.md',
        textSize: 'big',
        spellCheck: 'yes',
        smartPunctuation: 0,
        closePairs: null,
        trackNewDocuments: 'no',
        agentScope: 'everything',
        consent: { 'claude|/notes': 'folder', 'codex|/notes': 'maybe', 'x|y': 3 },
      }),
    );
    expect(loadSettings()).toEqual({
      ...DEFAULT_SETTINGS,
      consent: { 'claude|/notes': 'folder' },
    });
    localStorage.setItem(SETTINGS_KEY, '{"textSize":0}');
    expect(loadSettings().textSize).toBe(1);
    localStorage.setItem(SETTINGS_KEY, '{"identity":{"name":" ","handle":"ada"}}');
    expect(loadSettings().identity).toBeNull();
    // A handle the format doesn't allow (§2.4) is not kept.
    for (const handle of ['No', 'Bo!', 'no', '123', 'ada lovelace']) {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ identity: { name: 'Ada', handle } }));
      expect(loadSettings().identity).toBeNull();
    }
  });

  it('keeps what other windows saved when one setting changes', () => {
    saveSettings({ ...DEFAULT_SETTINGS, lightTheme: 'book' });
    const changed = updateSettings({ darkTheme: 'editorial' });
    expect(changed).toEqual({ ...DEFAULT_SETTINGS, lightTheme: 'book', darkTheme: 'editorial' });
    expect(loadSettings()).toEqual(changed);
  });

  it('tells other windows of a change', () => {
    const seen: string[] = [];
    const stop = watchSettings((settings) => seen.push(settings.lightTheme));
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ lightTheme: 'book' }));
    window.dispatchEvent(new StorageEvent('storage', { key: SETTINGS_KEY }));
    expect(seen).toEqual(['book']);
    // Another key's change is not ours.
    window.dispatchEvent(new StorageEvent('storage', { key: 'something.else' }));
    expect(seen).toEqual(['book']);
    stop();
    window.dispatchEvent(new StorageEvent('storage', { key: SETTINGS_KEY }));
    expect(seen).toEqual(['book']);
  });

  it("uses the identity from Preferences for new changes, and git's until then", () => {
    const git = { handle: 'stephan', name: 'Stephan Kadauke', email: 's@example.org' };
    expect(authorFrom(DEFAULT_SETTINGS, git)).toEqual(git);
    const set = { ...DEFAULT_SETTINGS, identity: { name: 'Ada Lovelace', handle: 'ada' } };
    expect(authorFrom(set, git)).toEqual({ handle: 'ada', name: 'Ada Lovelace' });
  });

  it('reopens the last document on launch when asked, and starts empty when it is gone', async () => {
    const opened: string[] = [];
    const exists = (present: boolean) => (path: string) => {
      if (!present) return Promise.reject(new Error('gone'));
      opened.push(path);
      return Promise.resolve();
    };
    const asked = {
      ...DEFAULT_SETTINGS,
      onLaunch: 'reopen',
      lastDocument: '/notes/plan.md',
    } as const;
    expect(await reopenLastDocument(asked, exists(true))).toBe(true);
    expect(opened).toEqual(['/notes/plan.md']);
    expect(await reopenLastDocument(asked, exists(false))).toBe(false);
    // Not asked for, or nothing to reopen: nothing is opened.
    expect(await reopenLastDocument({ ...asked, onLaunch: 'new' }, exists(true))).toBe(false);
    expect(await reopenLastDocument({ ...asked, lastDocument: null }, exists(true))).toBe(false);
    expect(opened).toEqual(['/notes/plan.md']);
  });

  it('keeps the people met, in order, with the colors they were given', () => {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        people: [
          { handle: 'bo', color: 2 },
          { handle: 'Not A Handle', color: 3 },
          { handle: 'cy', color: 1 },
          { handle: 'cy', color: 9 },
          { handle: 'di', color: 4.5 },
          { handle: 'unknown', color: 3 },
          { handle: 'bo', color: 5 },
          { handle: 'ed', color: 8 },
          'ann',
          null,
        ],
      }),
    );
    expect(loadSettings().people).toEqual([
      { handle: 'bo', color: 2 },
      { handle: 'ed', color: 8 },
    ]);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ people: 'bo' }));
    expect(loadSettings().people).toEqual([]);
  });

  it('adds a person met to what another window saved, not to what this one last read', () => {
    saveSettings({ ...DEFAULT_SETTINGS, people: [{ handle: 'bo', color: 2 }] });
    const stale = loadSettings();
    // Another window meets Cy.
    updateSettings({ people: meetPeople(loadSettings().people, ['cy']) });
    // This one, which has not heard of Cy yet, meets Di.
    expect(stale.people).toEqual([{ handle: 'bo', color: 2 }]);
    const saved = meetPeopleInSettings(['di']);
    expect(saved).toEqual([
      { handle: 'bo', color: 2 },
      { handle: 'cy', color: 3 },
      { handle: 'di', color: 4 },
    ]);
    expect(loadSettings().people).toEqual(saved);
    // Nothing new: nothing is written.
    const before = localStorage.getItem(SETTINGS_KEY);
    meetPeopleInSettings(['bo', 'cy']);
    expect(localStorage.getItem(SETTINGS_KEY)).toBe(before);
  });

  it('does not forget the people a window holds when storage cannot keep them', () => {
    const held = [{ handle: 'bo', color: 2 }];
    // Nothing stored: a window's own record stands.
    const first = meetPeopleInSettings(['cy'], held);
    expect(first).toEqual([
      { handle: 'bo', color: 2 },
      { handle: 'cy', color: 3 },
    ]);
    localStorage.clear();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    const second = meetPeopleInSettings(['di'], first);
    expect(second.map((p) => p.handle)).toEqual(['bo', 'cy', 'di']);
  });
});
