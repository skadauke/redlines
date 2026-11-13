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
  shownTheme,
  updateSettings,
  SETTINGS_KEY,
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
      theme: 'default',
      appearance: 'system',
      sidebarOpen: false,
      showResolved: false,
      markupView: 'redlines',
      rotateIcon: true,
      checkForUpdates: true,
      identity: null,
      onLaunch: 'new',
      lastDocument: null,
      recent: [],
      textSize: 1,
      zoom: 1,
      spellCheck: true,
      smartPunctuation: true,
      closePairs: true,
      trackNewDocuments: false,
      showLineBreakMarks: false,
      agentScope: 'folder',
      consent: {},
      people: [],
    });
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);

    const changed = {
      theme: 'book',
      appearance: 'dark',
      sidebarOpen: true,
      showResolved: true,
      markupView: 'simple',
      rotateIcon: false,
      checkForUpdates: false,
      identity: { name: 'Ada Lovelace', handle: 'ada' },
      onLaunch: 'reopen',
      lastDocument: '/notes/plan.md',
      recent: ['/notes/plan.md', '/notes/old.md'],
      textSize: 1.25,
      zoom: 1.5,
      spellCheck: false,
      smartPunctuation: false,
      closePairs: false,
      trackNewDocuments: true,
      showLineBreakMarks: true,
      agentScope: 'document',
      consent: { 'claude|/notes': 'folder', 'codex|/notes': 'no' },
      people: [
        { handle: 'bo', color: 2 },
        { handle: 'claude-bo', color: 3 },
      ],
    } as const;
    saveSettings(changed);
    // With the theme for each appearance, as earlier builds read it.
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '')).toEqual({
      ...changed,
      lightTheme: 'book',
      darkTheme: 'book',
    });
    expect(SETTINGS_KEY).toBe('redlines.settings');
    expect(loadSettings()).toEqual(changed);
  });

  it('keeps the markup view like the other settings, reaching the other windows but setting no view', () => {
    expect(DEFAULT_SETTINGS.markupView).toBe('redlines');
    updateSettings({ markupView: 'simple' });
    expect(loadSettings().markupView).toBe('simple');
    // A window that changes it tells the others, with the settings; nothing in them is a view.
    const seen: unknown[] = [];
    const stop = watchSettings((settings) => seen.push(settings));
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ ...loadSettings(), markupView: 'redlines' }),
    );
    window.dispatchEvent(new StorageEvent('storage', { key: SETTINGS_KEY }));
    stop();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ markupView: 'redlines' });
    expect(Object.keys(seen[0] as object)).not.toContain('view');
    // A value it doesn't know is Redlines.
    localStorage.setItem(SETTINGS_KEY, '{"markupView":"clean"}');
    expect(loadSettings().markupView).toBe('redlines');
  });

  it('ignores stored values it does not know', () => {
    localStorage.setItem(
      SETTINGS_KEY,
      '{"theme":"neon","sidebarOpen":"yes","appearance":"dark","rotateIcon":"no","showResolved":"yes","checkForUpdates":1}',
    );
    expect(loadSettings()).toEqual({ ...DEFAULT_SETTINGS, appearance: 'dark' });
    localStorage.setItem(SETTINGS_KEY, '{"theme":"book","appearance":"dim"}');
    expect(loadSettings()).toEqual({ ...DEFAULT_SETTINGS, theme: 'book' });
    localStorage.setItem(SETTINGS_KEY, 'not json');
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('reads settings saved before there was one theme as the theme chosen, matching the system', () => {
    // Earlier builds kept a theme for each appearance, and always followed the system's.
    localStorage.setItem(
      SETTINGS_KEY,
      '{"lightTheme":"book","darkTheme":"editorial","textSize":1.25,"spellCheck":false}',
    );
    expect(loadSettings()).toEqual({
      ...DEFAULT_SETTINGS,
      theme: 'book',
      appearance: 'system',
      textSize: 1.25,
      spellCheck: false,
    });
    // Saved again, the theme is kept as the one theme, and as both of an earlier build's.
    updateSettings({ showResolved: true });
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '') as Record<string, unknown>;
    expect(stored).toMatchObject({
      theme: 'book',
      appearance: 'system',
      textSize: 1.25,
      lightTheme: 'book',
      darkTheme: 'book',
    });
    expect(loadSettings()).toEqual({
      ...DEFAULT_SETTINGS,
      theme: 'book',
      textSize: 1.25,
      spellCheck: false,
      showResolved: true,
    });

    // The light theme is taken, unless it was left at Default and only the dark one was changed:
    // nothing the person chose is lost. One it does not know, or none, counts as Default.
    const theme = (stored: string) => {
      localStorage.setItem(SETTINGS_KEY, stored);
      return loadSettings().theme;
    };
    expect(theme('{"lightTheme":"default","darkTheme":"book"}')).toBe('book');
    expect(theme('{"lightTheme":"neon","darkTheme":"book"}')).toBe('book');
    expect(theme('{"darkTheme":"editorial"}')).toBe('editorial');
    expect(theme('{"lightTheme":"editorial","darkTheme":"book"}')).toBe('editorial');
    expect(theme('{"lightTheme":"book","darkTheme":"default"}')).toBe('book');
    expect(theme('{"lightTheme":"book"}')).toBe('book');
    for (const stored of [
      '{"lightTheme":"default","darkTheme":"default"}',
      '{"lightTheme":"default","darkTheme":"neon"}',
      '{"lightTheme":"neon","darkTheme":3}',
    ]) {
      localStorage.setItem(SETTINGS_KEY, stored);
      expect(loadSettings(), stored).toEqual(DEFAULT_SETTINGS);
    }
    // The one theme, once saved, is the theme; one it does not know is as if missing.
    localStorage.setItem(SETTINGS_KEY, '{"theme":"editorial","lightTheme":"book"}');
    expect(loadSettings().theme).toBe('editorial');
    localStorage.setItem(SETTINGS_KEY, '{"theme":"neon","lightTheme":"book"}');
    expect(loadSettings().theme).toBe('book');
  });

  it('saves the theme as the light and the dark one too, which an earlier build reads', () => {
    updateSettings({ theme: 'editorial', appearance: 'dark' });
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '') as Record<string, unknown>;
    // An earlier build reads a theme for each appearance, and only those.
    expect([stored['lightTheme'], stored['darkTheme']]).toEqual(['editorial', 'editorial']);
    // They are no settings of this build's.
    expect(Object.keys(loadSettings())).not.toContain('lightTheme');
    expect(Object.keys(loadSettings())).not.toContain('darkTheme');

    // The earlier build saves only what it knows; back here, the theme is still the one chosen.
    const earlier = { ...stored };
    delete earlier['theme'];
    delete earlier['appearance'];
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(earlier));
    expect(loadSettings()).toEqual({ ...DEFAULT_SETTINGS, theme: 'editorial' });
  });

  it('matches the system unless the appearance is Light or Dark', () => {
    for (const appearance of ['system', 'light', 'dark']) {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ appearance }));
      expect(loadSettings()).toEqual({ ...DEFAULT_SETTINGS, appearance });
    }
    for (const stored of ['"auto"', '"Dark"', '"match"', 'true', '0', 'null', '{}', '["dark"]']) {
      localStorage.setItem(SETTINGS_KEY, `{"appearance":${stored},"theme":"book"}`);
      expect(loadSettings()).toEqual({ ...DEFAULT_SETTINGS, theme: 'book' });
    }
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
      theme: 'book',
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

  it('hides line break marks unless the person shows them, also for settings saved before it', () => {
    localStorage.setItem(SETTINGS_KEY, '{"theme":"book","spellCheck":false,"closePairs":false}');
    expect(loadSettings()).toEqual({
      ...DEFAULT_SETTINGS,
      theme: 'book',
      spellCheck: false,
      closePairs: false,
    });
    expect(loadSettings().showLineBreakMarks).toBe(false);
    localStorage.setItem(SETTINGS_KEY, '{"showLineBreakMarks":true}');
    expect(loadSettings()).toEqual({ ...DEFAULT_SETTINGS, showLineBreakMarks: true });
  });

  it('keeps a text size of any whole percent from 80 to 400, and takes the default for any other', () => {
    for (const kept of [1.5, 1.37, 2.01, 2.5, 3, 4]) {
      localStorage.setItem(SETTINGS_KEY, `{"textSize":${kept}}`);
      expect(loadSettings().textSize).toBe(kept);
    }
    for (const stored of ['"1.5"', '4.01', '5', '0', 'null', '1.375', '0.79', '3.999']) {
      localStorage.setItem(SETTINGS_KEY, `{"textSize":${stored}}`);
      expect(loadSettings().textSize).toBe(1);
    }
  });

  it('keeps a zoom from the ladder, and 100% for anything else or nothing', () => {
    localStorage.setItem(SETTINGS_KEY, '{"zoom":1.25}');
    expect(loadSettings().zoom).toBe(1.25);
    for (const stored of ['"1.25"', '1.3', '2.5', '3', '4', '0', 'null']) {
      localStorage.setItem(SETTINGS_KEY, `{"zoom":${stored}}`);
      expect(loadSettings().zoom).toBe(1);
    }
    localStorage.setItem(SETTINGS_KEY, '{"textSize":1.5}');
    expect(loadSettings()).toEqual({ ...DEFAULT_SETTINGS, textSize: 1.5 });
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

  it('shows the one theme, light or dark as chosen, or as the system is under Match System', () => {
    for (const theme of ['default', 'book', 'editorial'] as const) {
      const chosen = (appearance: 'system' | 'light' | 'dark') => ({
        ...DEFAULT_SETTINGS,
        theme,
        appearance,
      });
      expect(shownTheme(chosen('system'), 'light')).toEqual({ theme, appearance: 'light' });
      expect(shownTheme(chosen('system'), 'dark')).toEqual({ theme, appearance: 'dark' });
      // Light and Dark hold whatever the system is.
      for (const system of ['light', 'dark'] as const) {
        expect(shownTheme(chosen('light'), system)).toEqual({ theme, appearance: 'light' });
        expect(shownTheme(chosen('dark'), system)).toEqual({ theme, appearance: 'dark' });
      }
    }
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
        showLineBreakMarks: 'yes',
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
    saveSettings({ ...DEFAULT_SETTINGS, theme: 'book' });
    const changed = updateSettings({ appearance: 'dark' });
    expect(changed).toEqual({ ...DEFAULT_SETTINGS, theme: 'book', appearance: 'dark' });
    expect(loadSettings()).toEqual(changed);
  });

  it('tells other windows of a change', () => {
    const seen: string[] = [];
    const stop = watchSettings((settings) => seen.push(settings.theme));
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ theme: 'book' }));
    window.dispatchEvent(new StorageEvent('storage', { key: SETTINGS_KEY }));
    expect(seen).toEqual(['book']);
    // Another key's change is not ours.
    window.dispatchEvent(new StorageEvent('storage', { key: 'something.else' }));
    expect(seen).toEqual(['book']);
    stop();
    window.dispatchEvent(new StorageEvent('storage', { key: SETTINGS_KEY }));
    expect(seen).toEqual(['book']);
  });

  it('tells the other windows when line break marks are shown or hidden', () => {
    const seen: boolean[] = [];
    const stop = watchSettings((settings) => seen.push(settings.showLineBreakMarks));
    // Preferences saves the change, and the browser tells every other window of the app.
    updateSettings({ showLineBreakMarks: true });
    window.dispatchEvent(new StorageEvent('storage', { key: SETTINGS_KEY }));
    updateSettings({ showLineBreakMarks: false });
    window.dispatchEvent(new StorageEvent('storage', { key: SETTINGS_KEY }));
    expect(seen).toEqual([true, false]);
    stop();
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

  it('skips a last document that Redlines doesn’t open, and starts as with none', async () => {
    // An earlier version could leave one: an .svg or a file with no extension, opened as text.
    const opened: string[] = [];
    const open = (path: string) => {
      opened.push(path);
      return Promise.resolve();
    };
    const reopen = (lastDocument: string) =>
      reopenLastDocument({ ...DEFAULT_SETTINGS, onLaunch: 'reopen', lastDocument }, open);
    for (const stale of ['/notes/logo.svg', '/notes/Makefile', '/notes/main.ts']) {
      expect(await reopen(stale), stale).toBe(false);
    }
    // Not even read: nothing would be said.
    expect(opened).toEqual([]);
    // A plain text file is a document like any other.
    expect(await reopen('/notes/todo.txt')).toBe(true);
    expect(opened).toEqual(['/notes/todo.txt']);
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
