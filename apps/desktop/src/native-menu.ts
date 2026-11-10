// The menu bar on macOS, drawn from the table in menu-model.ts: the same commands as the title bar's
// icons, with their shortcuts, the plugins' commands, and the Mac's standard application, Edit and
// Window menus. The application menu also holds About Redlines, the only place that shows the build
// tag (about.ts), and the updates (updates.ts). In a plain browser there is no menu bar, so the same
// shortcuts are handled as key presses instead, except a plugin's, which the editor's keymap has.

import {
  CheckMenuItem,
  Menu,
  MenuItem,
  PredefinedMenuItem,
  Submenu,
  type SubmenuOptions,
} from '@tauri-apps/api/menu';
import { aboutMetadata, type About } from './about.ts';
import type { ActionRow, MenuModel, MenuRow, MenuState, SubmenuRow } from './menu-model.ts';

type DrawnRow = NonNullable<SubmenuOptions['items']>[number];

export interface NativeMenu {
  /** Brings its checks and labels up to date. */
  update(state: MenuState): void;
  /**
   * Makes it the app's menu bar, with its Window menu the Mac's. macOS has one of each, and each
   * window draws its own, so this happens each time the window comes to the front (`windows.ts`).
   */
  activate(): Promise<void>;
}

/**
 * Builds this window's menu bar. `about` is what About Redlines shows; without it, the item shows
 * what the app's bundle says.
 */
export async function createNativeMenu(model: MenuModel, about: About | null): Promise<NativeMenu> {
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

  /**
   * A submenu whose rows come and go (Open Recent): empty until the first state, then drawn again
   * whenever its key changes. Changes are applied one after the other, so that a second one never
   * meets the half-done first.
   */
  const drawDynamic = async (row: SubmenuRow & Required<Pick<SubmenuRow, 'dynamic'>>) => {
    const submenu = await Submenu.new({ text: row.text, items: [] });
    let drawn: string | undefined;
    let queue: Promise<void> = Promise.resolve();
    const redraw = async (next: MenuState) => {
      for (const old of await submenu.items()) {
        await submenu.remove(old);
        await old.close();
      }
      // Items made one by one: the options Tauri is given for a submenu's rows can't be appended
      // with their actions.
      for (const entry of row.dynamic.rows(next)) {
        if ('action' in entry) {
          const { text, action, disabled } = entry;
          await submenu.append(await MenuItem.new({ text, action, enabled: !disabled }));
        } else if ('item' in entry && entry.item === 'Separator') {
          await submenu.append(await PredefinedMenuItem.new({ item: 'Separator' }));
        }
      }
    };
    followers.push((next) => {
      const key = row.dynamic.key(next);
      if (key === drawn) return;
      drawn = key;
      queue = queue
        .then(() => redraw(next))
        .catch((error: unknown) => console.error(`Could not draw ${row.text}`, error));
    });
    return submenu;
  };

  const drawRows = (rows: readonly MenuRow[]) => Promise.all(rows.map(drawRow));

  const drawRow = async (row: MenuRow): Promise<DrawnRow> => {
    if ('about' in row) {
      return { item: { About: about ? aboutMetadata(about) : null }, text: 'About Redlines' };
    }
    if ('item' in row) return { ...row };
    if ('rows' in row && row.dynamic) return drawDynamic({ ...row, dynamic: row.dynamic });
    if ('rows' in row) return Submenu.new({ text: row.text, items: await drawRows(row.rows) });
    return drawAction(row);
  };

  const submenus = await Promise.all(
    model.menus.map(async ({ title, rows }) =>
      Submenu.new({ text: title, items: await drawRows(rows) }),
    ),
  );
  const windowsMenu = submenus[model.menus.findIndex((entry) => entry.windowsMenu)];
  const helpMenu = submenus[model.menus.findIndex((entry) => entry.helpMenu)];
  const menu = await Menu.new({ items: submenus });

  return {
    update: (next) => {
      state = next;
      for (const follower of followers) follower(next);
    },
    activate: async () => {
      const previous = await menu.setAsAppMenu();
      await windowsMenu?.setAsWindowsMenuForNSApp();
      await helpMenu?.setAsHelpMenuForNSApp();
      // What came back is one more handle on the menu that was the app's, for this page to close.
      await previous?.close();
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

/** The rows with a key of any kind, also those that leave it to the menu bar. */
function keyedRows(rows: readonly MenuRow[]): ActionRow[] {
  return rows.flatMap((row) => {
    if ('rows' in row) return keyedRows(row.rows);
    return 'action' in row && row.accelerator ? [row] : [];
  });
}

/**
 * ⌘+ typed as "+": the menu bar's rows hold the equals key (Tauri's menu has no plus key, and
 * drops an accelerator it can't parse), so ⇧⌘= on a US layout, and the + key of a layout that has
 * its own, would reach no row. A key press whose `key` is "+" with ⌘ runs the row whose key is = with
 * ⌘ (Zoom In), and with ⌃⌘ the row whose key is = with those (Larger Text), whatever Shift is
 * and whichever key it is, while the row is enabled. "=" goes on to the menu bar, and so does "+"
 * at a limit, where the Mac beeps as for ⌘=. A key taken here never reaches the menu bar, so
 * nothing runs twice. The page sees the key before the menu bar does, in a comment box or the
 * find bar too. Returns a function that stops it.
 */
export function installPlusKeys(model: MenuModel, state: () => MenuState | null): () => void {
  const rows = model.menus
    .flatMap(({ rows: menuRows }) => keyedRows(menuRows))
    .filter(({ accelerator }) => accelerator?.endsWith('+='));
  const withCtrl = (row: ActionRow) => (row.accelerator ?? '').split('+').includes('Ctrl');
  const onKey = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.key !== '+' || !event.metaKey || event.altKey) return;
    const row = rows.find((candidate) => withCtrl(candidate) === event.ctrlKey);
    if (!row) return;
    const current = state();
    if (current && row.enabled && !row.enabled(current)) return;
    event.preventDefault();
    row.action();
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}
