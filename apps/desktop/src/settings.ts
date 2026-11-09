// Each person's own settings, kept in this app's local storage, which every window of the app
// shares: what the Preferences window holds (the name on changes, what happens on launch, the
// theme and whether it is light, dark or as the system is (design §6.6), the text size, how typing
// helps, what agents may read), and the file sidebar. A window that changes a setting tells the
// others through the `storage` event (`watchSettings`).

import { meetPeople, type Author, type MetPerson } from '@redlines/editor';
import { THEMES, type Appearance, type ThemeName } from '@redlines/themes';
import { toHandle } from './handle.ts';
import { MAX_RECENT } from './recent.ts';
import { TEXT_SIZES } from './text-size.ts';

/** How much of the surroundings an agent may read (design, Scope). */
export type AgentScope = 'folder' | 'document';

/** Light or dark: as the system is (Match System), or always the one chosen (design §6.6). */
export type AppearanceChoice = 'system' | Appearance;

export interface Settings {
  /** The theme of every window, in light and dark alike. */
  theme: ThemeName;
  /** Whether every window is light, dark, or as the system is (Match System, the default). */
  appearance: AppearanceChoice;
  sidebarOpen: boolean;
  /** Whether resolved comments show in the rail (Review › Show Resolved Comments). */
  showResolved: boolean;
  /**
   * Whether the running app's icon shows a different mark of the icon family at every launch (the
   * Dock icon, or the window's where there is no Dock). Off keeps the caret, the installed icon.
   */
  rotateIcon: boolean;
  /** Whether the app checks for updates by itself, soon after it starts and every few hours. */
  checkForUpdates: boolean;
  /** The name and handle on the person's changes; null uses git's until they are set. */
  identity: { name: string; handle: string } | null;
  /** What a launch shows: the document that was open last, or a new one. */
  onLaunch: 'reopen' | 'new';
  /** The file the app last had open, for `onLaunch: 'reopen'`. */
  lastDocument: string | null;
  /** The files File › Open Recent lists, newest first (recent.ts). */
  recent: readonly string[];
  /** The text size, as a multiple of the theme's own (see text-size.ts). */
  textSize: number;
  spellCheck: boolean;
  /** Curly quotes and real dashes as you type. */
  smartPunctuation: boolean;
  /** Closing brackets and Markdown pairs as you type. */
  closePairs: boolean;
  /** Whether a new document starts with Track Changes on. */
  trackNewDocuments: boolean;
  /** What agents may read when nothing says otherwise. */
  agentScope: AgentScope;
  /** What the person allowed each agent, keyed `agent|folder`. */
  consent: Record<string, AgentScope | 'no'>;
  /**
   * The people this machine has met, in the order of meeting, each with the author color they were
   * given (design §5.5). Never you, who always have the first color.
   */
  people: readonly MetPerson[];
}

export const SETTINGS_KEY = 'redlines.settings';

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  theme: 'default',
  appearance: 'system',
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
  const flag = (key: 'sidebarOpen' | 'showResolved' | 'rotateIcon' | 'checkForUpdates') =>
    typeof value[key] === 'boolean' ? value[key] : DEFAULT_SETTINGS[key];
  const typing = (key: 'spellCheck' | 'smartPunctuation' | 'closePairs' | 'trackNewDocuments') =>
    typeof value[key] === 'boolean' ? value[key] : DEFAULT_SETTINGS[key];
  return {
    theme: themeOf(value),
    appearance: isAppearanceChoice(value['appearance'])
      ? value['appearance']
      : DEFAULT_SETTINGS.appearance,
    sidebarOpen: flag('sidebarOpen'),
    showResolved: flag('showResolved'),
    rotateIcon: flag('rotateIcon'),
    checkForUpdates: flag('checkForUpdates'),
    identity: identityOf(value['identity']),
    onLaunch: value['onLaunch'] === 'reopen' ? 'reopen' : DEFAULT_SETTINGS.onLaunch,
    lastDocument:
      typeof value['lastDocument'] === 'string' && value['lastDocument']
        ? value['lastDocument']
        : null,
    recent: recentOf(value['recent']),
    textSize: isTextSize(value['textSize']) ? value['textSize'] : DEFAULT_SETTINGS.textSize,
    spellCheck: typing('spellCheck'),
    smartPunctuation: typing('smartPunctuation'),
    closePairs: typing('closePairs'),
    trackNewDocuments: typing('trackNewDocuments'),
    agentScope: value['agentScope'] === 'document' ? 'document' : DEFAULT_SETTINGS.agentScope,
    consent: consentOf(value['consent']),
    people: peopleOf(value['people']),
  };
}

/**
 * The theme. Settings saved before there was one theme, for light and dark alike, kept one for
 * each: the light one is taken, or the dark one when only it was changed from Default, so that
 * nothing the person chose is lost. They saved no appearance: they match the system, as before.
 */
function themeOf(value: Record<string, unknown>): ThemeName {
  if (isTheme(value['theme'])) return value['theme'];
  const light = isTheme(value['lightTheme']) ? value['lightTheme'] : DEFAULT_SETTINGS.theme;
  const dark = isTheme(value['darkTheme']) ? value['darkTheme'] : DEFAULT_SETTINGS.theme;
  return light === DEFAULT_SETTINGS.theme ? dark : light;
}

function identityOf(value: unknown): Settings['identity'] {
  if (typeof value !== 'object' || value === null) return null;
  const { name, handle } = value as Record<string, unknown>;
  if (typeof name !== 'string' || typeof handle !== 'string') return null;
  // A handle that isn't one (format §2.4), such as `No` or `Bo!`, would reach the file as it is.
  return name.trim() && handle && toHandle(handle) === handle
    ? { name: name.trim(), handle }
    : null;
}

function recentOf(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  const paths = value.filter((path): path is string => typeof path === 'string' && path !== '');
  return [...new Set(paths)].slice(0, MAX_RECENT);
}

function peopleOf(value: unknown): readonly MetPerson[] {
  if (!Array.isArray(value)) return [];
  const people: MetPerson[] = [];
  const seen = new Set<string>();
  for (const item of value as unknown[]) {
    if (typeof item !== 'object' || item === null) continue;
    const { handle, color } = item as Record<string, unknown>;
    if (typeof handle !== 'string' || handle === 'unknown' || toHandle(handle) !== handle) continue;
    if (!Number.isInteger(color) || (color as number) < 2 || (color as number) > 8) continue;
    if (seen.has(handle)) continue;
    seen.add(handle);
    people.push({ handle, color: color as number });
  }
  return people;
}

function consentOf(value: unknown): Settings['consent'] {
  const consent: Settings['consent'] = {};
  if (typeof value !== 'object' || value === null) return consent;
  for (const [key, answer] of Object.entries(value as Record<string, unknown>)) {
    if (answer === 'folder' || answer === 'document' || answer === 'no') consent[key] = answer;
  }
  return consent;
}

export function saveSettings(settings: Settings): void {
  // For earlier builds, which read a theme for each appearance and nothing of `theme`: they show
  // the one theme in both. These two can go after 0.3.
  const forEarlierBuilds = { lightTheme: settings.theme, darkTheme: settings.theme };
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...settings, ...forEarlierBuilds }));
  } catch {
    // Storage can be full or switched off; the settings then last until the window closes.
  }
}

/**
 * Changes some settings and saves them, on top of what is stored now rather than what this window
 * last read, so that another window's change isn't lost. Returns the settings as saved.
 */
export function updateSettings(change: Partial<Settings>): Settings {
  const settings = { ...loadSettings(), ...change };
  saveSettings(settings);
  return settings;
}

/**
 * Adds people met to the record of the people this machine has met, on top of what is stored now
 * (another window may have met others), each with the next color in order. Saves only when someone
 * is new. `current` is the record this window holds, which fills in what storage lost. Returns
 * the record.
 */
export function meetPeopleInSettings(
  handles: readonly string[],
  current: readonly MetPerson[] = [],
): readonly MetPerson[] {
  const { people } = loadSettings();
  // What this window knows and storage lost (it can't be written) is not forgotten.
  const known = new Set(people.map(({ handle }) => handle));
  const merged = [...people, ...current.filter(({ handle }) => !known.has(handle))];
  const next = meetPeople(merged, handles);
  if (next.length === people.length) return people;
  return updateSettings({ people: next }).people;
}

/**
 * Calls `onChange` with the settings when another window of the app changes them (the browser
 * tells a window of every change but its own); returns a function that stops it.
 */
export function watchSettings(onChange: (settings: Settings) => void): () => void {
  const listener = (event: StorageEvent) => {
    if (event.key === SETTINGS_KEY || event.key === null) onChange(loadSettings());
  };
  window.addEventListener('storage', listener);
  return () => window.removeEventListener('storage', listener);
}

/** Who is making changes: the name and handle from Preferences, or else the one given (git's). */
export function authorFrom(settings: Settings, fallback: Author): Author {
  return settings.identity ? { ...settings.identity } : fallback;
}

/**
 * Opens the document that was open last, when the person asked for that on launch. Resolves to
 * whether it did: a document that is gone, or can't be read, leaves the launch to start empty.
 * `open` rejects when it can't open the file.
 */
export async function reopenLastDocument(
  settings: Settings,
  open: (path: string) => Promise<void>,
): Promise<boolean> {
  if (settings.onLaunch !== 'reopen' || !settings.lastDocument) return false;
  try {
    await open(settings.lastDocument);
    return true;
  } catch {
    return false;
  }
}

/**
 * What a window shows: the theme, light or dark as the settings say, or under Match System as the
 * page is told (`told`, `currentAppearance`), which is then the system's appearance.
 */
export function shownTheme(
  settings: Settings,
  told: Appearance,
): { theme: ThemeName; appearance: Appearance } {
  const appearance = settings.appearance === 'system' ? told : settings.appearance;
  return { theme: settings.theme, appearance };
}

/**
 * The system's appearance now, as the page is told it. Once the app has taken Light or Dark
 * (window-theme.ts), the page is told that one instead, and `shownTheme` doesn't use it then.
 */
export function currentAppearance(): Appearance {
  return matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
}

/**
 * Calls `onChange` when the appearance the page is told changes (`currentAppearance`); returns a
 * function that stops it.
 */
export function watchAppearance(onChange: (appearance: Appearance) => void): () => void {
  const query = matchMedia(DARK_QUERY);
  const listener = (event: { matches: boolean }) => onChange(event.matches ? 'dark' : 'light');
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}

function isTheme(value: unknown): value is ThemeName {
  return THEMES.some((theme) => theme.name === value);
}

function isAppearanceChoice(value: unknown): value is AppearanceChoice {
  return value === 'system' || value === 'light' || value === 'dark';
}

function isTextSize(value: unknown): value is number {
  return typeof value === 'number' && TEXT_SIZES.includes(value);
}
