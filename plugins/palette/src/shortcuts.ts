// A command's shortcut, written for a hint: as the Mac writes keys, and for assistive technology.

/** The modifiers CodeMirror reads, by their canonical name. */
const MODIFIERS: Readonly<Record<string, 'Ctrl' | 'Alt' | 'Shift' | 'Mod'>> = {
  mod: 'Mod',
  cmd: 'Mod',
  meta: 'Mod',
  m: 'Mod',
  ctrl: 'Ctrl',
  control: 'Ctrl',
  c: 'Ctrl',
  alt: 'Alt',
  a: 'Alt',
  shift: 'Shift',
  s: 'Shift',
};

/** The Mac's order of modifiers, and how it draws each. */
const GLYPHS: readonly (readonly ['Ctrl' | 'Alt' | 'Shift' | 'Mod', string])[] = [
  ['Ctrl', '⌃'],
  ['Alt', '⌥'],
  ['Shift', '⇧'],
  ['Mod', '⌘'],
];

/** The keys the Mac draws as a symbol. */
const KEY_GLYPHS: Readonly<Record<string, string>> = {
  Enter: '↩',
  Backspace: '⌫',
  Delete: '⌦',
  Escape: '⎋',
  Tab: '⇥',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Space: 'Space',
};

/** `shortcut` as CodeMirror splits it: the modifiers, and the key, which may itself be a `-`. */
function parts(shortcut: string): {
  modifiers: Set<'Ctrl' | 'Alt' | 'Shift' | 'Mod'>;
  key: string;
} {
  const pieces = shortcut.split(/-(?!$)/);
  const key = pieces.pop() ?? '';
  const modifiers = new Set<'Ctrl' | 'Alt' | 'Shift' | 'Mod'>();
  for (const piece of pieces) {
    const modifier = MODIFIERS[piece.toLowerCase()];
    if (modifier) modifiers.add(modifier);
  }
  return { modifiers, key };
}

/** A shortcut in CodeMirror's notation as the Mac writes it: `Mod-Alt-t` is `⌥⌘T`. */
export function formatShortcut(shortcut: string): string {
  const { modifiers, key } = parts(shortcut);
  const drawn = KEY_GLYPHS[key] ?? (key.length === 1 ? key.toUpperCase() : key);
  return GLYPHS.filter(([modifier]) => modifiers.has(modifier))
    .map(([, glyph]) => glyph)
    .join('')
    .concat(drawn);
}

/** A shortcut as `aria-keyshortcuts` names it: `Mod-Alt-t` is `Alt+Meta+T`. */
export function ariaShortcut(shortcut: string): string {
  const { modifiers, key } = parts(shortcut);
  const names = [
    ['Alt', 'Alt'],
    ['Mod', 'Meta'],
    ['Ctrl', 'Control'],
    ['Shift', 'Shift'],
  ] as const;
  const drawn = key.length === 1 ? key.toUpperCase() : key;
  return [...names.filter(([modifier]) => modifiers.has(modifier)).map(([, name]) => name), drawn]
    .sort((a, b) => order(a) - order(b))
    .join('+');
}

/** The order `aria-keyshortcuts` examples give: Alt, Control, Meta, Shift, then the key. */
function order(name: string): number {
  const index = ['Alt', 'Control', 'Meta', 'Shift'].indexOf(name);
  return index < 0 ? 4 : index;
}
