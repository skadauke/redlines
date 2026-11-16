// Your own shortcuts: every command's key in one place. A key is written in CodeMirror's notation,
// in one order of modifiers (`Ctrl-Alt-Shift-Mod-k`), so that ⌘⇧P and ⇧⌘P are one key. A command's
// default comes from the menu model or the registry; what the person changed is a map from the
// command's id to a key, or to "" for none (`Settings.shortcuts`). The menu bar, the editor's keys
// and the Shortcuts pane in Preferences all read the same map, so a change works at once (#551).

/** A command that has, or can be given, a key. */
export interface ShortcutEntry {
  /** `command:<id>` for a registered command, else the menu and the row's text: `File/Save`. */
  id: string;
  /** The menu that holds it, as the pane groups it: `File`, `Format`. */
  menu: string;
  title: string;
  /** Its key until the person changes it, or null for none. */
  default: string | null;
  /** Its key can't be changed: the app's Quit, which no other command may take either. */
  locked?: true;
}

/** What the person changed: a command's id to its key, "" for none. */
export type ShortcutOverrides = Readonly<Record<string, string>>;

const MODIFIER_NAMES: Readonly<Record<string, 'Ctrl' | 'Alt' | 'Shift' | 'Mod'>> = {
  mod: 'Mod',
  cmd: 'Mod',
  cmdorctrl: 'Mod',
  commandorcontrol: 'Mod',
  meta: 'Mod',
  m: 'Mod',
  ctrl: 'Ctrl',
  control: 'Ctrl',
  c: 'Ctrl',
  alt: 'Alt',
  option: 'Alt',
  a: 'Alt',
  shift: 'Shift',
  s: 'Shift',
};

const ORDER = ['Ctrl', 'Alt', 'Shift', 'Mod'] as const;

/** The keys of a Tauri accelerator that CodeMirror names otherwise. */
const NAMED: Readonly<Record<string, string>> = {
  return: 'Enter',
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  space: 'Space',
  esc: 'Escape',
};

/**
 * A key in either notation (CodeMirror's `Mod-Shift-s`, Tauri's `Shift+CmdOrCtrl+S`) as the one
 * form the map uses: `Shift-Mod-s` is `Shift-Mod-s` and `Mod+Shift+S` is that too.
 */
export function normalizeKey(key: string): string {
  const pieces = key.includes('+') && !key.endsWith('+') ? key.split('+') : key.split(/-(?!$)/);
  const last = pieces.pop() ?? '';
  const modifiers = new Set<string>();
  for (const piece of pieces) {
    const modifier = MODIFIER_NAMES[piece.toLowerCase()];
    if (modifier) modifiers.add(modifier);
  }
  const named = NAMED[last.toLowerCase()];
  const name = named ?? (last.length === 1 ? last.toLowerCase() : last);
  return [...ORDER.filter((modifier) => modifiers.has(modifier)), name].join('-');
}

/** A key as the menu bar writes it: `Mod-Shift-s` is `Shift+CmdOrCtrl+S`, in Tauri's notation. */
export function menuKey(key: string): string {
  const pieces = normalizeKey(key).split(/-(?!$)/);
  const name = pieces.pop() ?? '';
  const tauri: Record<string, string> = { Mod: 'CmdOrCtrl' };
  return [
    ...pieces.map((piece) => tauri[piece] ?? piece),
    name.length === 1 ? name.toUpperCase() : name,
  ].join('+');
}

/** Whether a key has ⌘, ⌃ or ⌥: a key with only ⇧, or none, would be typing. */
export function hasCommandModifier(key: string): boolean {
  return /^(?:(?:Ctrl|Alt|Shift|Mod)-)*(?:Ctrl|Alt|Mod)-/.test(key);
}

/** The keys macOS keeps for itself, which no command may take. */
const RESERVED: Readonly<Record<string, string>> = {
  'Mod-q': 'Quit',
  'Mod-h': 'Hide',
  'Mod-m': 'Minimize',
  'Mod-Space': 'Spotlight',
  'Ctrl-ArrowUp': 'Mission Control',
  'Ctrl-ArrowDown': 'Application windows',
};

/** The standard items the system draws and handles, so that their keys are theirs. */
const SYSTEM: Readonly<Record<string, string>> = {
  'Mod-x': 'Cut',
  'Mod-c': 'Copy',
  'Mod-v': 'Paste',
  'Mod-a': 'Select All',
};

/** What an attempt to give a command a key comes to. */
export type Assessment =
  | { kind: 'free' }
  /** The key is the command's own already. */
  | { kind: 'same' }
  | { kind: 'needs-modifier' }
  | { kind: 'reserved'; owner: string }
  /** The key is another command's: Replace takes it from it, and leaves that one with no key. */
  | { kind: 'conflict'; with: ShortcutEntry };

/** The key a command has: what the person set, else its default, or null for none. */
export function keyOf(
  entries: readonly ShortcutEntry[],
  overrides: ShortcutOverrides,
  id: string,
): string | null {
  if (id in overrides) return overrides[id] ? normalizeKey(overrides[id]) : null;
  return entries.find((entry) => entry.id === id)?.default ?? null;
}

/** Every command's key by id, those with none left out. */
export function keysOf(
  entries: readonly ShortcutEntry[],
  overrides: ShortcutOverrides,
): Map<string, string> {
  const keys = new Map<string, string>();
  for (const { id } of entries) {
    const key = keyOf(entries, overrides, id);
    if (key) keys.set(id, key);
  }
  return keys;
}

/** What giving `id` the key `key` would come to. */
export function assess(
  entries: readonly ShortcutEntry[],
  overrides: ShortcutOverrides,
  id: string,
  key: string,
): Assessment {
  const wanted = normalizeKey(key);
  if (!hasCommandModifier(wanted)) return { kind: 'needs-modifier' };
  const reserved = RESERVED[wanted] ?? SYSTEM[wanted];
  const own = entries.find((entry) => entry.id === id);
  // Quit keeps the key it comes with; every other command is refused the keys macOS holds.
  if (reserved && !(own?.locked && own.default === wanted))
    return { kind: 'reserved', owner: reserved };
  if (keyOf(entries, overrides, id) === wanted) return { kind: 'same' };
  for (const entry of entries) {
    if (entry.id !== id && keyOf(entries, overrides, entry.id) === wanted) {
      return entry.locked
        ? { kind: 'reserved', owner: entry.title }
        : { kind: 'conflict', with: entry };
    }
  }
  return { kind: 'free' };
}

/** The sentence that says why a key is refused, or what it would take from another command. */
export function explain(assessment: Assessment, key: string): string | null {
  const drawn = displayKey(key);
  switch (assessment.kind) {
    case 'needs-modifier':
      return 'A shortcut needs ⌘, ⌃ or ⌥.';
    case 'reserved':
      return `${drawn} is kept by macOS for ${assessment.owner}.`;
    case 'conflict':
      return `${drawn} is ${assessment.with.title}’s.`;
    default:
      return null;
  }
}

/**
 * The overrides after giving `id` the key `key` (null or "" for none). A key another command has
 * is taken from it, which is left with none: ask first (`assess`). Returns the same overrides when
 * the key is refused. A key that is the command's default is no override.
 */
export function assign(
  entries: readonly ShortcutEntry[],
  overrides: ShortcutOverrides,
  id: string,
  key: string | null,
): ShortcutOverrides {
  const entry = entries.find((candidate) => candidate.id === id);
  if (!entry || entry.locked) return overrides;
  const next: Record<string, string> = { ...overrides };
  const wanted = key ? normalizeKey(key) : '';
  if (wanted) {
    if (assess(entries, overrides, id, wanted).kind === 'reserved') return overrides;
    for (const other of entries) {
      if (other.id !== id && !other.locked && keyOf(entries, overrides, other.id) === wanted) {
        next[other.id] = '';
        if (other.default === null) delete next[other.id];
      }
    }
  }
  if ((entry.default ?? '') === wanted) delete next[id];
  else next[id] = wanted;
  return next;
}

/** The glyphs of the Mac's order: ⌃⌥⇧⌘ then the key. */
export function displayKey(key: string): string {
  const pieces = normalizeKey(key).split(/-(?!$)/);
  const name = pieces.pop() ?? '';
  const glyphs: Record<string, string> = { Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Mod: '⌘' };
  const keys: Record<string, string> = {
    Enter: '↩',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    Tab: '⇥',
    Backspace: '⌫',
    Delete: '⌦',
    Space: 'Space',
  };
  const drawn = keys[name] ?? (name.length === 1 ? name.toUpperCase() : name);
  return pieces.map((piece) => glyphs[piece] ?? piece).join('') + drawn;
}

/** The `event.code` of the keys that aren't a letter or a digit, as a key's name. */
const CODE_KEYS: Readonly<Record<string, string>> = {
  BracketLeft: '[',
  BracketRight: ']',
  Backquote: '`',
  Backslash: '\\',
  Minus: '-',
  Equal: '=',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Semicolon: ';',
  Quote: "'",
  Enter: 'Enter',
  Space: 'Space',
  Tab: 'Tab',
  ArrowUp: 'ArrowUp',
  ArrowDown: 'ArrowDown',
  ArrowLeft: 'ArrowLeft',
  ArrowRight: 'ArrowRight',
};

/** What a key press says to a recorder. */
export type Recorded =
  | { kind: 'key'; key: string }
  | { kind: 'cancel' }
  | { kind: 'clear' }
  /** Only modifiers so far, or a key that can't be a shortcut: wait. */
  | { kind: 'wait' };

/**
 * Reads a key press for a recorder: Esc cancels and ⌫ with no modifier clears, a modifier alone
 * waits, and anything else is the key, by its position (Option changes the character a key types).
 */
export function recordKey(event: {
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}): Recorded {
  const { code } = event;
  const bare = !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
  if (code === 'Escape' && bare) return { kind: 'cancel' };
  if ((code === 'Backspace' || code === 'Delete') && bare) return { kind: 'clear' };
  let name: string | undefined = CODE_KEYS[code];
  if (/^Key[A-Z]$/.test(code)) name = code.slice(3).toLowerCase();
  else if (/^Digit\d$/.test(code)) name = code.slice(5);
  else if (/^F\d{1,2}$/.test(code)) name = code;
  if (!name) return { kind: 'wait' };
  const modifiers = [
    event.ctrlKey ? 'Ctrl' : '',
    event.altKey ? 'Alt' : '',
    event.shiftKey ? 'Shift' : '',
    event.metaKey ? 'Mod' : '',
  ].filter(Boolean);
  return { kind: 'key', key: [...modifiers, name].join('-') };
}

/** The entry of a registered command. */
export const commandEntryId = (id: string) => `command:${id}`;
