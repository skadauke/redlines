// The menu bar on macOS: the same commands as the title bar's icons, with their shortcuts, plus
// the Mac's standard application, Edit and Window menus. The application menu also holds About
// Redlines, the only place that shows the build tag (about.ts), and the updates (updates.ts). In a
// plain browser there is no menu bar, so the same shortcuts are handled as key presses instead.

import type { ViewMode } from '@redlines/editor';
import { THEMES, type Appearance, type ThemeName } from '@redlines/themes';
import { CheckMenuItem, Menu, MenuItem, Submenu } from '@tauri-apps/api/menu';
import { aboutMetadata, type About } from './about.ts';
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

export interface MenuState {
  view: ViewMode;
  tracking: boolean;
  hasRedlines: boolean;
  sidebarOpen: boolean;
  lightTheme: ThemeName;
  darkTheme: ThemeName;
  rotateIcon: boolean;
  checkForUpdates: boolean;
}

// ⌥⌘1 to ⌥⌘3 are provisional: Word for Mac uses them for headings (design §14, open question 6).
const VIEWS: { mode: ViewMode; text: string; key: string }[] = [
  { mode: 'clean', text: 'Clean', key: '1' },
  { mode: 'redlines', text: 'Redlines', key: '2' },
  { mode: 'raw', text: 'Raw', key: '3' },
];

/**
 * Builds the menu bar and makes it the app's. `update` brings its checks and labels up to date.
 * `about` is what About Redlines shows; without it, the item shows what the app's bundle says.
 */
export async function createNativeMenu(
  commands: MenuCommands,
  about: About | null,
): Promise<{ update(state: MenuState): void }> {
  let state: MenuState | null = null;
  // Clicking a check item flips its check before the command runs; put back what the state says.
  const after = (run: () => void) => () => {
    run();
    if (state) apply(state, true);
  };

  const views = await Promise.all(
    VIEWS.map(({ mode, text, key }) =>
      CheckMenuItem.new({
        text,
        accelerator: `Alt+CmdOrCtrl+${key}`,
        action: after(() => commands.setView(mode)),
      }),
    ),
  );
  const redlinesView = views[VIEWS.findIndex(({ mode }) => mode === 'redlines')];
  const showFiles = await MenuItem.new({
    text: 'Show Files',
    accelerator: 'Ctrl+Cmd+S',
    action: () => commands.toggleSidebar(),
  });
  const tracking = await CheckMenuItem.new({
    text: 'Track Changes',
    accelerator: 'Shift+CmdOrCtrl+E',
    action: after(() => commands.toggleTracking()),
  });
  const reviewItems = await Promise.all([
    MenuItem.new({ text: 'Review Changes', action: () => commands.openReview() }),
    MenuItem.new({
      text: 'Next Change',
      accelerator: 'Alt+CmdOrCtrl+]',
      action: () => commands.nextChange(),
    }),
    MenuItem.new({
      text: 'Previous Change',
      accelerator: 'Alt+CmdOrCtrl+[',
      action: () => commands.previousChange(),
    }),
  ]);
  const themeItems = async (appearance: Appearance) =>
    Promise.all(
      THEMES.map(({ name, label }) =>
        CheckMenuItem.new({
          text: label,
          action: after(() => commands.setTheme(appearance, name)),
        }),
      ),
    );
  const lightThemes = await themeItems('light');
  const darkThemes = await themeItems('dark');
  const rotateIcon = await CheckMenuItem.new({
    text: iconRotationLabel(),
    action: after(() => commands.toggleIconRotation()),
  });
  const updateChecks = await CheckMenuItem.new({
    text: 'Check for Updates Automatically',
    action: after(() => commands.toggleUpdateChecks()),
  });

  const separator = { item: 'Separator' } as const;
  const windowMenu = await Submenu.new({
    text: 'Window',
    items: [
      { item: 'Minimize' },
      { item: 'Maximize', text: 'Zoom' },
      separator,
      { item: 'BringAllToFront' },
    ],
  });
  const menu = await Menu.new({
    items: [
      await Submenu.new({
        text: 'Redlines',
        items: [
          { item: { About: about ? aboutMetadata(about) : null }, text: 'About Redlines' },
          { text: 'Check for Updates…', action: () => commands.checkForUpdates() },
          separator,
          await Submenu.new({
            text: 'Settings',
            items: [
              await Submenu.new({ text: 'Light Theme', items: lightThemes }),
              await Submenu.new({ text: 'Dark Theme', items: darkThemes }),
              separator,
              rotateIcon,
              updateChecks,
            ],
          }),
          separator,
          { item: 'Services' },
          separator,
          { item: 'Hide', text: 'Hide Redlines' },
          { item: 'HideOthers' },
          { item: 'ShowAll' },
          separator,
          // Not the predefined Quit, which would end the app without asking about unsaved edits.
          { text: 'Quit Redlines', accelerator: 'CmdOrCtrl+Q', action: () => commands.quit() },
        ],
      }),
      await Submenu.new({
        text: 'File',
        items: [
          { text: 'New', accelerator: 'CmdOrCtrl+N', action: () => commands.create() },
          { text: 'Open…', accelerator: 'CmdOrCtrl+O', action: () => commands.open() },
          separator,
          // Closing asks about unsaved edits through the window's close request.
          { item: 'CloseWindow', text: 'Close' },
          { text: 'Save', accelerator: 'CmdOrCtrl+S', action: () => commands.save() },
          { text: 'Save As…', accelerator: 'Shift+CmdOrCtrl+S', action: () => commands.saveAs() },
        ],
      }),
      await Submenu.new({
        text: 'Edit',
        items: [
          { item: 'Undo' },
          { item: 'Redo' },
          separator,
          { item: 'Cut' },
          { item: 'Copy' },
          { item: 'Paste' },
          { item: 'SelectAll' },
        ],
      }),
      await Submenu.new({ text: 'View', items: [...views, separator, showFiles] }),
      await Submenu.new({ text: 'Review', items: [tracking, separator, ...reviewItems] }),
      windowMenu,
    ],
  });
  await menu.setAsAppMenu();
  await windowMenu.setAsWindowsMenuForNSApp();

  /** Sends to the menu only what changed since the last call, unless `force` is set. */
  function apply(next: MenuState, force = false) {
    const prev = force ? null : state;
    state = next;
    const changed = <K extends keyof MenuState>(key: K) => prev?.[key] !== next[key];
    if (changed('view'))
      views.forEach((item, i) => void item.setChecked(VIEWS[i]?.mode === next.view));
    if (changed('hasRedlines')) {
      // The Redlines view and reviewing need a document with redlines (design §5.3).
      for (const item of [redlinesView, ...reviewItems]) void item?.setEnabled(next.hasRedlines);
    }
    if (changed('tracking')) void tracking.setChecked(next.tracking);
    if (changed('sidebarOpen'))
      void showFiles.setText(next.sidebarOpen ? 'Hide Files' : 'Show Files');
    if (changed('lightTheme'))
      lightThemes.forEach((item, i) => void item.setChecked(THEMES[i]?.name === next.lightTheme));
    if (changed('darkTheme'))
      darkThemes.forEach((item, i) => void item.setChecked(THEMES[i]?.name === next.darkTheme));
    if (changed('rotateIcon')) void rotateIcon.setChecked(next.rotateIcon);
    if (changed('checkForUpdates')) void updateChecks.setChecked(next.checkForUpdates);
  }

  return { update: (next) => apply(next) };
}

/**
 * Handles the menu bar's shortcuts as key presses, for the browser, where there is no menu bar.
 * Returns a function that stops it.
 */
export function installShortcuts(commands: MenuCommands): () => void {
  const onKey = (event: KeyboardEvent) => {
    const command = shortcutCommand(event, commands);
    if (!command) return;
    event.preventDefault();
    command();
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}

function shortcutCommand(event: KeyboardEvent, commands: MenuCommands): (() => void) | null {
  if (!event.metaKey) return null;
  const { altKey: alt, ctrlKey: ctrl, shiftKey: shift } = event;
  // Option changes the character a key types, so keys are matched by their position.
  switch (event.code) {
    case 'KeyS':
      if (ctrl && !alt && !shift) return () => commands.toggleSidebar();
      if (!ctrl && !alt) return shift ? () => commands.saveAs() : () => commands.save();
      return null;
    case 'KeyO':
      return !ctrl && !alt && !shift ? () => commands.open() : null;
    case 'KeyE':
      return shift && !ctrl && !alt ? () => commands.toggleTracking() : null;
    case 'BracketRight':
      return alt && !ctrl && !shift ? () => commands.nextChange() : null;
    case 'BracketLeft':
      return alt && !ctrl && !shift ? () => commands.previousChange() : null;
    default: {
      const view = VIEWS.find(({ key }) => event.code === `Digit${key}`);
      return view && alt && !ctrl && !shift ? () => commands.setView(view.mode) : null;
    }
  }
}
