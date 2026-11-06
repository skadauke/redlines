// Each person's own settings, kept in this app's local storage, which every window of the app
// shares: what the Preferences window holds (the name on changes, what happens on launch, the
// theme for the light and the dark appearance (design §6.6), the text size, how typing helps, what
// agents may read), and the file sidebar. The appearance itself follows the system's. A window that
// changes a setting tells the others through the `storage` event (`watchSettings`).

import { meetPeople, type Author, type MetPerson } from '@redlines/editor';
import { THEMES, type Appearance, type ThemeName } from '@redlines/themes';
import { toHandle } from './handle.ts';
import { MAX_RECENT } from './recent.ts';
import { TEXT_SIZES } from './text-size.ts';

/** How much of the surroundings an agent may read (design, Scope). */
export type AgentScope = 'folder' | 'document';

export interface Settings {
  lightTheme: ThemeName;
  darkTheme: ThemeName;
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
    lightTheme: isTheme(value['lightTheme']) ? value['lightTheme'] : DEFAULT_SETTINGS.lightTheme,
    darkTheme: isTheme(value['darkTheme']) ? value['darkTheme'] : DEFAULT_SETTINGS.darkTheme,
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
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
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
