// What the menu bar holds, as a table: the design's list of menus and items, in plain data that
// knows nothing of how it's drawn. `native-menu.ts` turns it into the Mac's menu bar and, for a
// browser, into key handling. Add a row here for what the app does itself; a plugin's commands come
// from the registry (`EditorCommand.menu`), and take their place after a menu's own rows.

import { baseTitle } from '@redlines/editor';
import type { CommandRegistry, EditorCommand, ViewMode } from '@redlines/editor';

export interface MenuCommands {
  /** Opens a new window, with an empty document. */
  create(): void;
  /** Asks for a file; it opens here if this window is untouched, else in a new one. */
  open(): void;
  /** Opens a file from Open Recent, as Open does: here if this window is untouched, else anew. */
  openRecent(path: string): void;
  /** Empties Open Recent. */
  clearRecent(): void;
  save(): void;
  saveAs(): void;
  /** Turns the title bar's file name into a field for the new name (Save As without a file). */
  rename(): void;
  revealInFinder(): void;
  print(): void;
  /** Quits after asking each window about its unsaved edits. */
  quit(): void;
  /** Opens the About Redlines window, or brings it forward. */
  openAbout(): void;
  setView(mode: ViewMode): void;
  toggleSidebar(): void;
  toggleTracking(): void;
  openReview(): void;
  /** Shows resolved comments in the rail, or hides them. */
  toggleResolved(): void;
  /** Pastes the clipboard's plain text at the selection. */
  pastePlain(): void;
  /**
   * Undo, which goes to the document's history, or to the text field that has the keys: a comment
   * box, the find bar, a Preferences field (`MenuState.inDocument`).
   */
  undo(): void;
  redo(): void;
  /** Zooms every window one step up the ladder (text-size.ts), also from ⌘+ typed as "+". */
  zoomIn(): void;
  zoomOut(): void;
  /** Takes the zoom back to 100%. */
  actualSize(): void;
  /** Steps the text size up the ladder (text-size.ts), also the pinch's. */
  biggerText(): void;
  smallerText(): void;
  /** Takes the text size back to the theme's own. */
  actualTextSize(): void;
  nextChange(): void;
  previousChange(): void;
  /** Checks for an update now, and says what it found in a notification. */
  checkForUpdates(): void;
  /** Opens the Preferences window, or brings it forward. */
  openPreferences(): void;
  /** Opens the folder of agent logs in Finder. */
  showAgentLogs(): void;
}

/** What rows can follow: their check marks, whether they can be chosen, and their labels. */
export interface MenuState {
  view: ViewMode;
  tracking: boolean;
  hasRedlines: boolean;
  sidebarOpen: boolean;
  /** Whether the rail shows resolved comments. */
  showResolved: boolean;
  /** The window zoom (zoom.ts), a rung of the ladder; none until the page follows the app's. */
  zoom: number | null;
  /** The text size, any whole percent from 80 to 200 as a multiple of the theme's own. */
  textSize: number;
  /** Whether the document is a file, which can be shown in Finder. */
  hasFile: boolean;
  /** The files Open Recent lists, newest first: those that are still there. */
  recent: readonly string[];
  /** The editor's `EditorUiState.activeCommands`. */
  activeCommands: readonly string[];
  /** The editor's `EditorUiState.enabledCommands`. */
  enabledCommands: readonly string[];
  /** The editor's `EditorUiState.commandTitles`: the titles that count the selection. */
  commandTitles: Readonly<Record<string, string>>;
  /** The editor's `EditorUiState.undo`: what Undo would take back, or null for nothing or no name. */
  undo: string | null;
  /** The editor's `EditorUiState.redo`. */
  redo: string | null;
  /** The editor's `EditorUiState.canUndo`. */
  canUndo: boolean;
  /** The editor's `EditorUiState.canRedo`. */
  canRedo: boolean;
  /**
   * Whether Undo and Redo are the document's: its window has the keys, and no text field of the
   * page or of another window (Preferences) has them. A field keeps its own history, which the
   * app can't see, so its items read plain and are always enabled.
   */
  inDocument: boolean;
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

export interface ActionRow {
  text: string;
  /** In Tauri's notation, such as 'Shift+CmdOrCtrl+E'. */
  accelerator?: string;
  action: () => void;
  /** Makes it an item with a check mark, which shows what this says. */
  checked?: (state: MenuState) => boolean;
  /** Always greyed out, as an empty Open Recent's Clear Menu is. */
  disabled?: true;
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
  /**
   * For a submenu whose rows come and go, such as Open Recent: `rows` are drawn from the state
   * whenever `key` says something new. Only action rows and separators.
   */
  dynamic?: {
    key: (state: MenuState) => string;
    rows: (state: MenuState) => readonly MenuRow[];
  };
}

export type MenuRow = StandardRow | ActionRow | SubmenuRow;

export interface AppMenu {
  title: string;
  rows: readonly MenuRow[];
  /** The Mac's Window menu, to which it adds the open windows. */
  windowsMenu?: true;
  /** The Mac's Help menu, which adds its search field. */
  helpMenu?: true;
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

/** "Undo Typing": the item's name and what it does, or just the name for no step or no name. */
const stepTitle = (verb: string, step: string | null) => (step ? `${verb} ${step}` : verb);

const SEPARATOR: StandardRow = { item: 'Separator' };

function commandRow(command: EditorCommand, registry: CommandRegistry): ActionRow {
  const { id } = command;
  return {
    text: baseTitle(command),
    ...(typeof command.title === 'function'
      ? { textFor: (state: MenuState) => state.commandTitles[id] ?? baseTitle(command) }
      : {}),
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
export function appMenuModel(
  commands: MenuCommands,
  registry: CommandRegistry,
  options: { browser?: boolean } = {},
): MenuModel {
  // In a browser the zoom is the browser's own: its three keys stay with it (design §5.1).
  const zoomKey = options.browser ? { keyInMenuOnly: true as const } : {};
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
        { text: 'About Redlines', action: () => commands.openAbout() },
        { text: 'Check for Updates…', action: () => commands.checkForUpdates() },
        SEPARATOR,
        {
          text: 'Preferences…',
          accelerator: 'CmdOrCtrl+,',
          action: () => commands.openPreferences(),
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
        {
          text: 'Open Recent',
          rows: [],
          dynamic: {
            key: (state) => state.recent.join('\n'),
            rows: (state) => [
              ...state.recent.map((path) => ({
                text: path.split(/[\\/]/).pop() || path,
                action: () => commands.openRecent(path),
              })),
              ...(state.recent.length ? [SEPARATOR] : []),
              {
                text: 'Clear Menu',
                action: () => commands.clearRecent(),
                ...(state.recent.length ? {} : { disabled: true as const }),
              },
            ],
          },
        },
        SEPARATOR,
        { text: 'Save', accelerator: 'CmdOrCtrl+S', action: () => commands.save() },
        { text: 'Save As…', accelerator: 'Shift+CmdOrCtrl+S', action: () => commands.saveAs() },
        { text: 'Rename…', action: () => commands.rename() },
        {
          text: 'Reveal in Finder',
          action: () => commands.revealInFinder(),
          enabled: (state) => state.hasFile,
        },
        SEPARATOR,
        // Closing asks about unsaved edits through the window's close request.
        { item: 'CloseWindow', text: 'Close' },
        SEPARATOR,
        { text: 'Print…', accelerator: 'CmdOrCtrl+P', action: () => commands.print() },
      ]),
    },
    {
      title: 'Edit',
      rows: withCommands('edit', [
        // The app's own items, not the Mac's: the window retitles a standard Undo from its own undo
        // manager each time the menu opens, which holds WebKit's typing and not the history.
        {
          text: 'Undo',
          accelerator: 'CmdOrCtrl+Z',
          action: () => commands.undo(),
          textFor: (state) => stepTitle('Undo', state.inDocument ? state.undo : null),
          enabled: (state) => !state.inDocument || state.canUndo,
          keyInMenuOnly: true,
        },
        {
          text: 'Redo',
          accelerator: 'Shift+CmdOrCtrl+Z',
          action: () => commands.redo(),
          textFor: (state) => stepTitle('Redo', state.inDocument ? state.redo : null),
          enabled: (state) => !state.inDocument || state.canRedo,
          keyInMenuOnly: true,
        },
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
    { title: 'Table', rows: withCommands('table', []) },
    {
      title: 'View',
      rows: withCommands('view', [
        // ⌥⌘1 to ⌥⌘4, in the menu's order: Word for Mac uses ⌥⌘1 to ⌥⌘3 for headings, kept unless
        // the clash proves real (design §14, open question 6).
        viewRow('clean', 'Clean', '1'),
        viewRow('simple', 'Simple', '2'),
        viewRow('redlines', 'Redlines', '3'),
        viewRow('raw', 'Raw', '4'),
        SEPARATOR,
        // ⌘+ is written as the equals key it shares: the menu bar's parser has no plus key, and
        // "+" typed reaches the same row through the page (native-menu.ts, installPlusKeys).
        {
          text: 'Actual Size',
          accelerator: 'CmdOrCtrl+0',
          action: () => commands.actualSize(),
          enabled: (state) => state.zoom !== null && state.zoom !== 1,
          ...zoomKey,
        },
        {
          text: 'Zoom In',
          accelerator: 'CmdOrCtrl+=',
          action: () => commands.zoomIn(),
          enabled: (state) => state.zoom !== null && state.zoom < 2,
          ...zoomKey,
        },
        {
          text: 'Zoom Out',
          accelerator: 'CmdOrCtrl+-',
          action: () => commands.zoomOut(),
          enabled: (state) => state.zoom !== null && state.zoom > 0.8,
          ...zoomKey,
        },
        SEPARATOR,
        // Text Zoom's keys keep the Mac's Ctrl and Cmd off the Mac too, as Show Files' do: a row
        // has one accelerator for every platform, and Windows and Linux get keys of their own
        // when they are supported.
        {
          text: 'Actual Text Size',
          accelerator: 'Ctrl+Cmd+0',
          action: () => commands.actualTextSize(),
          enabled: (state) => state.textSize !== 1,
        },
        {
          text: 'Larger Text',
          accelerator: 'Ctrl+Cmd+=',
          action: () => commands.biggerText(),
          enabled: (state) => state.textSize < 2,
        },
        {
          text: 'Smaller Text',
          accelerator: 'Ctrl+Cmd+-',
          action: () => commands.smallerText(),
          enabled: (state) => state.textSize > 0.8,
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
        SEPARATOR,
        // A rail option, with the other things the Review menu does to the rail. Any document can
        // show them.
        {
          text: 'Show Resolved Comments',
          action: () => commands.toggleResolved(),
          checked: (state) => state.showResolved,
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
    {
      title: 'Help',
      helpMenu: true,
      rows: [{ text: 'Show Agent Logs', action: () => commands.showAgentLogs() }],
    },
  ];
  // Format, Paragraph and Table hold only commands, and a menu with nothing in it isn't shown.
  return { menus: menus.filter((menu) => menu.rows.length) };
}
