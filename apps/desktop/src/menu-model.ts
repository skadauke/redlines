// What the menu bar holds, as a table: the design's list of menus and items, in plain data that
// knows nothing of how it's drawn. `native-menu.ts` turns it into the Mac's menu bar and, for a
// browser, into key handling. Add a row here for what the app does itself; a plugin's commands come
// from the registry (`EditorCommand.menu`), and take their place after a menu's own rows.

import type { CommandRegistry, EditorCommand, ViewMode } from '@redlines/editor';
import { THEMES, type Appearance, type ThemeName } from '@redlines/themes';
import { iconRotationLabel } from './dock-icon.ts';

export interface MenuCommands {
  create(): void;
  open(): void;
  save(): void;
  saveAs(): void;
  /** Quits after asking about unsaved edits. */
  quit(): void;
  setView(mode: ViewMode): void;
  toggleSidebar(): void;
  toggleTracking(): void;
  openReview(): void;
  /** Pastes the clipboard's plain text at the selection. */
  pastePlain(): void;
  /** Steps the text size up the ladder (text-size.ts), also the pinch's. */
  biggerText(): void;
  smallerText(): void;
  /** Takes the text size back to the theme's own. */
  actualTextSize(): void;
  nextChange(): void;
  previousChange(): void;
  setTheme(appearance: Appearance, theme: ThemeName): void;
  /** Turns on or off that the Dock icon shows a different mark at every launch. */
  toggleIconRotation(): void;
  /** Checks for an update now, and says what it found in a notification. */
  checkForUpdates(): void;
  /** Turns the automatic checks for updates on or off. */
  toggleUpdateChecks(): void;
}

/** What rows can follow: their check marks, whether they can be chosen, and their labels. */
export interface MenuState {
  view: ViewMode;
  tracking: boolean;
  hasRedlines: boolean;
  sidebarOpen: boolean;
  lightTheme: ThemeName;
  darkTheme: ThemeName;
  rotateIcon: boolean;
  checkForUpdates: boolean;
  /** The editor's `EditorUiState.activeCommands`. */
  activeCommands: readonly string[];
  /** The editor's `EditorUiState.enabledCommands`. */
  enabledCommands: readonly string[];
}

/** One of the Mac's standard items, which it draws and handles itself. */
export interface StandardRow {
  item:
    | 'Separator'
    | 'Undo'
    | 'Redo'
    | 'Cut'
    | 'Copy'
    | 'Paste'
    | 'SelectAll'
    | 'Fullscreen'
    | 'CloseWindow'
    | 'Minimize'
    | 'Maximize'
    | 'BringAllToFront'
    | 'Services'
    | 'Hide'
    | 'HideOthers'
    | 'ShowAll';
  text?: string;
}

/** About Redlines. What it shows is known when the menu bar is drawn. */
export interface AboutRow {
  about: true;
}

export interface ActionRow {
  text: string;
  /** In Tauri's notation, such as 'Shift+CmdOrCtrl+E'. */
  accelerator?: string;
  action: () => void;
  /** Makes it an item with a check mark, which shows what this says. */
  checked?: (state: MenuState) => boolean;
  /** Whether it can be chosen, when that can change. A disabled item takes its shortcut with it. */
  enabled?: (state: MenuState) => boolean;
  /** Its label, when that can change. `text` is the label until the state is known. */
  textFor?: (state: MenuState) => string;
  /**
   * The accelerator is for the menu bar alone, and no key handler stands in for it where there is
   * no menu bar: the editor's keymap has the key, or the browser keeps it.
   */
  keyInMenuOnly?: true;
}

export interface SubmenuRow {
  text: string;
  rows: readonly MenuRow[];
}

export type MenuRow = StandardRow | AboutRow | ActionRow | SubmenuRow;

export interface AppMenu {
  title: string;
  rows: readonly MenuRow[];
  /** The Mac's Window menu, to which it adds the open windows. */
  windowsMenu?: true;
}

export interface MenuModel {
  menus: readonly AppMenu[];
}

const MODIFIERS: Readonly<Record<string, string>> = {
  mod: 'CmdOrCtrl',
  cmd: 'Cmd',
  meta: 'Cmd',
  m: 'Cmd',
  ctrl: 'Ctrl',
  control: 'Ctrl',
  c: 'Ctrl',
  alt: 'Alt',
  a: 'Alt',
  shift: 'Shift',
  s: 'Shift',
};

/** Writes a shortcut in CodeMirror's notation in Tauri's: `Mod-b` is `CmdOrCtrl+B`. */
export function acceleratorFor(shortcut: string): string {
  // As CodeMirror splits it: a "-" at the end is the key itself, as in `Mod--`.
  const parts = shortcut.split(/-(?!$)/);
  const key = parts.pop() ?? '';
  const modifiers = parts.map((part) => MODIFIERS[part.toLowerCase()] ?? part);
  return [...modifiers, key.length === 1 ? key.toUpperCase() : key].join('+');
}

const SEPARATOR: StandardRow = { item: 'Separator' };

function commandRow(command: EditorCommand, registry: CommandRegistry): ActionRow {
  const { id } = command;
  return {
    text: command.title,
    accelerator: command.shortcut ? acceleratorFor(command.shortcut) : undefined,
    action: () => void registry.run(id),
    checked: command.isActive ? (state) => state.activeCommands.includes(id) : undefined,
    enabled: command.isEnabled ? (state) => state.enabledCommands.includes(id) : undefined,
    keyInMenuOnly: true,
  };
}

/**
 * Makes a check for commands registered or taken out after the menu bar was drawn: their keys
 * follow, and the menu bar doesn't. A plugin must register before it. The check says so in the
 * console, once for each change.
 */
export function drawnCommandsCheck(registry: CommandRegistry): () => void {
  let drawn = registry.list();
  return () => {
    const current = registry.list();
    const changed = [
      ...current.filter((command) => !drawn.includes(command)),
      ...drawn.filter((command) => !current.includes(command)),
    ];
    if (!changed.length) return;
    drawn = current;
    const ids = changed.map(({ id }) => id).join(', ');
    console.error(`The menu bar was drawn without these changes to the commands: ${ids}`);
  };
}

/** The menu bar. It holds the commands registered by now, so plugins register theirs first. */
export function appMenuModel(commands: MenuCommands, registry: CommandRegistry): MenuModel {
  /**
   * A menu's own rows, then its registered commands in order, set apart from them, with a separator
   * wherever the group changes.
   */
  const withCommands = (
    menu: NonNullable<EditorCommand['menu']>,
    rows: readonly MenuRow[],
  ): MenuRow[] => {
    const registered = registry.list().filter((command) => command.menu === menu);
    const commandRows = registered.flatMap((command, i) => {
      const row = commandRow(command, registry);
      return i > 0 && registered[i - 1]?.group !== command.group ? [SEPARATOR, row] : [row];
    });
    return rows.length && commandRows.length
      ? [...rows, SEPARATOR, ...commandRows]
      : [...rows, ...commandRows];
  };
  const themeRows = (appearance: Appearance, setting: 'lightTheme' | 'darkTheme'): ActionRow[] =>
    THEMES.map(({ name, label }) => ({
      text: label,
      action: () => commands.setTheme(appearance, name),
      checked: (state) => state[setting] === name,
    }));
  const viewRow = (mode: ViewMode, text: string, key: string): ActionRow => ({
    text,
    accelerator: `Alt+CmdOrCtrl+${key}`,
    action: () => commands.setView(mode),
    checked: (state) => state.view === mode,
  });
  // Reviewing needs a document with redlines. The Redlines view is there for any document
  // (design §5.3), and a disabled item would take its shortcut away.
  const hasRedlines = (state: MenuState) => state.hasRedlines;

  const menus: AppMenu[] = [
    {
      title: 'Redlines',
      rows: [
        { about: true },
        { text: 'Check for Updates…', action: () => commands.checkForUpdates() },
        SEPARATOR,
        {
          text: 'Settings',
          rows: [
            { text: 'Light Theme', rows: themeRows('light', 'lightTheme') },
            { text: 'Dark Theme', rows: themeRows('dark', 'darkTheme') },
            SEPARATOR,
            {
              text: iconRotationLabel(),
              action: () => commands.toggleIconRotation(),
              checked: (state) => state.rotateIcon,
            },
            {
              text: 'Check for Updates Automatically',
              action: () => commands.toggleUpdateChecks(),
              checked: (state) => state.checkForUpdates,
            },
          ],
        },
        SEPARATOR,
        { item: 'Services' },
        SEPARATOR,
        { item: 'Hide', text: 'Hide Redlines' },
        { item: 'HideOthers' },
        { item: 'ShowAll' },
        SEPARATOR,
        // Not the predefined Quit, which would end the app without asking about unsaved edits.
        {
          text: 'Quit Redlines',
          accelerator: 'CmdOrCtrl+Q',
          action: () => commands.quit(),
          keyInMenuOnly: true,
        },
      ],
    },
    {
      title: 'File',
      rows: withCommands('file', [
        {
          text: 'New',
          accelerator: 'CmdOrCtrl+N',
          action: () => commands.create(),
          keyInMenuOnly: true,
        },
        { text: 'Open…', accelerator: 'CmdOrCtrl+O', action: () => commands.open() },
        SEPARATOR,
        // Closing asks about unsaved edits through the window's close request.
        { item: 'CloseWindow', text: 'Close' },
        { text: 'Save', accelerator: 'CmdOrCtrl+S', action: () => commands.save() },
        { text: 'Save As…', accelerator: 'Shift+CmdOrCtrl+S', action: () => commands.saveAs() },
      ]),
    },
    {
      title: 'Edit',
      rows: withCommands('edit', [
        { item: 'Undo' },
        { item: 'Redo' },
        SEPARATOR,
        { item: 'Cut' },
        { item: 'Copy' },
        { item: 'Paste' },
        {
          text: 'Paste as Plain Text',
          accelerator: 'Shift+CmdOrCtrl+V',
          action: () => commands.pastePlain(),
        },
        { item: 'SelectAll' },
      ]),
    },
    { title: 'Format', rows: withCommands('format', []) },
    { title: 'Paragraph', rows: withCommands('paragraph', []) },
    {
      title: 'View',
      rows: withCommands('view', [
        // ⌥⌘1 to ⌥⌘3 are provisional: Word for Mac uses them for headings (design §14, open
        // question 6).
        viewRow('clean', 'Clean', '1'),
        viewRow('redlines', 'Redlines', '2'),
        viewRow('raw', 'Raw', '3'),
        SEPARATOR,
        // ⌘+ is written as the equals key it shares: the menu bar's parser has no plus key, and the
        // key matches with or without Shift (native-menu.ts).
        { text: 'Larger Text', accelerator: 'CmdOrCtrl+=', action: () => commands.biggerText() },
        { text: 'Smaller Text', accelerator: 'CmdOrCtrl+-', action: () => commands.smallerText() },
        {
          text: 'Actual Size',
          accelerator: 'Shift+CmdOrCtrl+0',
          action: () => commands.actualTextSize(),
        },
        SEPARATOR,
        {
          text: 'Show Files',
          accelerator: 'Ctrl+Cmd+S',
          action: () => commands.toggleSidebar(),
          textFor: (state) => (state.sidebarOpen ? 'Hide Files' : 'Show Files'),
        },
        // The Mac's own, which says Exit Full Screen while the window is.
        { item: 'Fullscreen', text: 'Enter Full Screen' },
      ]),
    },
    {
      title: 'Review',
      rows: [
        {
          text: 'Track Changes',
          accelerator: 'Shift+CmdOrCtrl+E',
          action: () => commands.toggleTracking(),
          checked: (state) => state.tracking,
        },
        SEPARATOR,
        { text: 'Review Changes', action: () => commands.openReview(), enabled: hasRedlines },
        {
          text: 'Next Change',
          accelerator: 'Alt+CmdOrCtrl+]',
          action: () => commands.nextChange(),
          enabled: hasRedlines,
        },
        {
          text: 'Previous Change',
          accelerator: 'Alt+CmdOrCtrl+[',
          action: () => commands.previousChange(),
          enabled: hasRedlines,
        },
      ],
    },
    {
      title: 'Window',
      windowsMenu: true,
      rows: [
        { item: 'Minimize' },
        { item: 'Maximize', text: 'Zoom' },
        SEPARATOR,
        { item: 'BringAllToFront' },
      ],
    },
  ];
  // Format and Paragraph hold only commands, and a menu with nothing in it isn't shown.
  return { menus: menus.filter((menu) => menu.rows.length) };
}
