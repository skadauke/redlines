// The menu bar on macOS, drawn from the table in menu-model.ts: the same commands as the title bar's
// icons, with their shortcuts, the plugins' commands, and the Mac's standard application, Edit and
// Window menus. The application menu also holds About Redlines, the only place that shows the build
// tag (about.ts), and the updates (updates.ts). In a plain browser there is no menu bar, so the same
// shortcuts are handled as key presses instead, except a plugin's, which the editor's keymap has.

import { CheckMenuItem, Menu, MenuItem, Submenu, type SubmenuOptions } from '@tauri-apps/api/menu';
import { aboutMetadata, type About } from './about.ts';
import type { ActionRow, MenuModel, MenuRow, MenuState } from './menu-model.ts';

type DrawnRow = NonNullable<SubmenuOptions['items']>[number];

/**
 * Builds the menu bar and makes it the app's. `update` brings its checks and labels up to date.
 * `about` is what About Redlines shows; without it, the item shows what the app's bundle says.
 */
export async function createNativeMenu(
  model: MenuModel,
  about: About | null,
): Promise<{ update(state: MenuState): void }> {
  let state: MenuState | null = null;
  /** One for each thing on the menu that follows the state. */
  const followers: ((next: MenuState) => void)[] = [];

  /** Sends to the menu what `value` says, whenever that differs from what was sent last. */
  const follow = <T>(value: ((state: MenuState) => T) | undefined, send: (value: T) => void) => {
    if (!value) return;
    let sent: T | undefined;
    followers.push((next) => {
      const current = value(next);
      if (current === sent) return;
      sent = current;
      send(current);
    });
  };

  // Tauri takes the actions out of the options it is given, so a row is never handed over itself:
  // the table goes on to serve the key handling.
  const drawAction = async (row: ActionRow): Promise<DrawnRow> => {
    const { text, accelerator, action, checked, enabled, textFor } = row;
    if (!checked && !enabled && !textFor) return { text, accelerator, action };
    const drawCheck = async (isChecked: (state: MenuState) => boolean) => {
      const check: CheckMenuItem = await CheckMenuItem.new({
        text,
        accelerator,
        action: () => {
          action();
          // Clicking a check item flips its check before the command runs; put back what the state
          // says.
          if (state) void check.setChecked(isChecked(state));
        },
      });
      follow(isChecked, (value) => void check.setChecked(value));
      return check;
    };
    const item = checked
      ? await drawCheck(checked)
      : await MenuItem.new({ text, accelerator, action });
    follow(enabled, (value) => void item.setEnabled(value));
    follow(textFor, (value) => void item.setText(value));
    return item;
  };

  const drawRows = (rows: readonly MenuRow[]) => Promise.all(rows.map(drawRow));

  const drawRow = async (row: MenuRow): Promise<DrawnRow> => {
    if ('about' in row) {
      return { item: { About: about ? aboutMetadata(about) : null }, text: 'About Redlines' };
    }
    if ('item' in row) return { ...row };
    if ('rows' in row) return Submenu.new({ text: row.text, items: await drawRows(row.rows) });
    return drawAction(row);
  };

  const submenus = await Promise.all(
    model.menus.map(async ({ title, rows }) =>
      Submenu.new({ text: title, items: await drawRows(rows) }),
    ),
  );
  const windowsMenu = submenus[model.menus.findIndex((entry) => entry.windowsMenu)];
  const menu = await Menu.new({ items: submenus });
  await menu.setAsAppMenu();
  await windowsMenu?.setAsWindowsMenuForNSApp();

  return {
    update: (next) => {
      state = next;
      for (const follower of followers) follower(next);
    },
  };
}

/** The `event.code` of each key that isn't a letter or a digit. */
const KEY_CODES: Readonly<Record<string, string>> = {
  '[': 'BracketLeft',
  ']': 'BracketRight',
  '`': 'Backquote',
  '\\': 'Backslash',
  '-': 'Minus',
  '=': 'Equal',
  ',': 'Comma',
  '.': 'Period',
  '/': 'Slash',
  ';': 'Semicolon',
  "'": 'Quote',
};

function keyCode(key: string): string {
  if (/^[A-Z]$/.test(key)) return `Key${key}`;
  if (/^\d$/.test(key)) return `Digit${key}`;
  return KEY_CODES[key] ?? key;
}

/** Whether a key press is the one an accelerator asks for. */
function matcher(accelerator: string): (event: KeyboardEvent) => boolean {
  const modifiers = accelerator.split('+');
  const code = keyCode(modifiers.pop() ?? '');
  const has = (...names: string[]) => names.some((name) => modifiers.includes(name));
  const meta = has('CmdOrCtrl', 'Cmd');
  const ctrl = has('Ctrl');
  const alt = has('Alt');
  const shift = has('Shift');
  // ⌘+ is also ⌘= where the plus sign is Shift's, so Shift doesn't matter for it.
  const plus = accelerator.endsWith('+=');
  // Option changes the character a key types, so keys are matched by their position.
  return (event) =>
    event.code === code &&
    event.metaKey === meta &&
    event.ctrlKey === ctrl &&
    event.altKey === alt &&
    (plus || event.shiftKey === shift);
}

/** The rows that a key press stands in for, also those in submenus. */
function rowsWithKeys(rows: readonly MenuRow[]): ActionRow[] {
  return rows.flatMap((row) => {
    if ('rows' in row) return rowsWithKeys(row.rows);
    return 'action' in row && row.accelerator && !row.keyInMenuOnly ? [row] : [];
  });
}

/**
 * Handles the menu bar's shortcuts as key presses, for the browser, where there is no menu bar.
 * Returns a function that stops it.
 */
export function installShortcuts(model: MenuModel): () => void {
  const keys = model.menus
    .flatMap(({ rows }) => rowsWithKeys(rows))
    .map(({ accelerator, action }) => ({ matches: matcher(accelerator ?? ''), action }));
  const onKey = (event: KeyboardEvent) => {
    // Something nearer the key has it already, such as the editor's keymap.
    if (event.defaultPrevented) return;
    const key = keys.find(({ matches }) => matches(event));
    if (!key) return;
    event.preventDefault();
    key.action();
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}
