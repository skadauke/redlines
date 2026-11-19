// What the menu bar offers the command palette (#1192): every row of the menu model that the app
// does itself (About Redlines, New, Open…, the exports, the views, Track Changes, zoom…) is a line of
// the palette, run as the row is, so that nothing in the menus is out of reach of the search. The
// commands the registry holds (`command:<id>` rows) are the palette's own already, and a few rows are
// left out for a reason (`LEFT_OUT`) or are the palette's hand-written lines (`HAND_WRITTEN`); a test
// holds the three lists to the menu model, so a new menu row is found or must be listed here.

import type { AppCommand } from '@redlines/toolbar';
import type { MenuModel, MenuRow, MenuState } from './menu-model.ts';

/** A row of a menu, by its path: `View/Simple Look`, `File/Open Recent/Clear Menu`. */
interface PlacedRow {
  key: string;
  row: Exclude<MenuRow, { item: unknown } | { rows: unknown }>;
  menu: string;
}

const isAction = (row: MenuRow): row is PlacedRow['row'] => 'action' in row;
const isSubmenu = (row: MenuRow): row is Extract<MenuRow, { rows: unknown }> => 'rows' in row;

/**
 * The action rows of the menu model, in order, with their paths. A submenu's rows follow its name
 * (`File/Open Recent/…`); a dynamic submenu's are drawn from `state`, as the menu bar draws them.
 */
export function placedRows(model: MenuModel, state: MenuState | null): PlacedRow[] {
  const found: PlacedRow[] = [];
  const walk = (rows: readonly MenuRow[], path: string, menu: string) => {
    for (const row of rows) {
      if (isAction(row)) found.push({ key: `${path}/${row.text}`, row, menu });
      else if (isSubmenu(row)) {
        const inside = row.dynamic && state ? row.dynamic.rows(state) : row.rows;
        walk(inside, `${path}/${row.text}`, menu);
      }
    }
  };
  for (const menu of model.menus) walk(menu.rows, menu.title, menu.title);
  return found;
}

/** Rows the palette's own, hand-written lines stand for (main.ts, `toolbarCommands`). */
export const HAND_WRITTEN: ReadonlySet<string> = new Set([
  'Redlines/Preferences…',
  'Redlines/Check for Updates…',
  'Review/Track Changes',
  'Review/Show Resolved Comments',
  'View/Clean',
  'View/Redlines',
  'View/Plain',
  'View/Simple Look',
]);

/**
 * Rows that aren't lines of the palette, each with its reason. The Mac's own items (Services, Hide,
 * Close, Select All…) are drawn and handled by the system and have no action here, so they are
 * not action rows at all; these are the action rows left out.
 */
export const LEFT_OUT: Readonly<Record<string, string>> = {
  // Undo and Redo read what they take back, and act on the text field that has the keys.
  'Edit/Undo': 'the palette is typed in: its Undo would be the search field’s',
  'Edit/Redo': 'the palette is typed in: its Redo would be the search field’s',
};

/** The lines the menu bar adds to the palette: what a row does, under its menu's word to search by. */
export function menuPaletteCommands(
  model: MenuModel,
  state: () => MenuState | null,
  keyFor: (row: PlacedRow) => string | undefined,
): AppCommand[] {
  const now = state();
  return placedRows(model, now)
    .filter(
      ({ key, row }) =>
        !HAND_WRITTEN.has(key) && !(key in LEFT_OUT) && !row.id?.startsWith('command:'),
    )
    .map((placed): AppCommand => {
      const { row, key, menu } = placed;
      const title =
        key.startsWith('File/Open Recent/') && row.text !== 'Clear Menu'
          ? `Open Recent: ${row.text}`
          : row.text.replace(/…$/, '');
      const keys = keyFor(placed);
      return {
        id: `menu.${key}`,
        title,
        synonyms: [menu],
        ...(keys ? { keys } : {}),
        run: row.action,
        // A row that can't be chosen now is left out, as the menu bar greys it.
        available: () => {
          const current = state();
          return !row.disabled && (current === null || (row.enabled?.(current) ?? true));
        },
      };
    });
}
