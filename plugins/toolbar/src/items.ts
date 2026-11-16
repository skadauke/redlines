// What the toolbar holds (issues #313, #504): a row of menus, Ask | Insert · Review · [List] ·
// [Table] · [Image] · Format · Edit, whose items are commands of the registry, by id, so that the
// toolbar, the Format menu and the shortcuts never disagree about names, keys or whether an item is
// there. An item whose command isn't registered is left out, and appears when its command lands; a
// menu with none left is not drawn. The pure part: `shownBar` says what is in the bar for a state,
// and `index.ts` draws.
//
// Table and Image (#552, #553) are in the bar only where the selection is in a table or holds an
// image. Parts that come later keep their place: Insert holds a slot for Collapsible Section
// (`block.collapsible`) and Image one for Alt Text… (`image.altText`), each shown when its command
// is registered.

import type { EditorState } from '@codemirror/state';
import { rectOf, touchedCols, touchedRows, wholeRect, type EditorCommand } from '@redlines/editor';
import { holds as selectionHolds, type Holds } from './convert.ts';
import type { ToolbarIcon } from './icons.ts';
import { ariaShortcut, formatShortcut } from './shortcuts.ts';

export type MenuId = 'insert' | 'review' | 'list' | 'table' | 'image' | 'format' | 'edit';

/** What a toolbar item may ask of the registry, besides its own command. */
export interface Context {
  /** Whether the command `id` is registered and on where the selection is. */
  isOn(id: string): boolean;
  /** Whether the command `id` is registered and has no reason against it where the selection is. */
  canRun(id: string): boolean;
  /** What the selection holds: paragraphs, list items. */
  holds: Holds;
}

/** An item the toolbar may hold: the command it runs, and how it is drawn. */
export interface ItemSpec {
  /** The command's id in the registry. */
  command: string;
  icon: ToolbarIcon;
  /** The name in the menu, where it differs from the command's title (the menu's word). */
  label?: string;
  /**
   * The keys to show when the registry binds none: the system's own, for Cut, Copy and Paste,
   * which the Edit menu's items carry.
   */
  keys?: string;
  /** Why the item makes no sense here, besides the command's own reason. */
  reason?: (state: EditorState, context: Context) => string | undefined;
  /** A line of words over the item's line (on the first item of it): "Align column". */
  caption?: string;
  /** What the item is for, which its accessible name adds where the line's other items share its word. */
  side?: string;
}

export interface MenuSpec {
  id: MenuId;
  label: string;
  /** The items, in lines; the items of a line share it (Accept | Reject). */
  rows: readonly (readonly ItemSpec[])[];
  /** Whether the menu is in the bar for the selection; default: always. */
  shownWhen?: (context: Context) => boolean;
  /** What the menu's header says for the selection; default: the menu's name. */
  heading?: (state: EditorState) => string;
  /** The names of the two sides of a menu whose lines are pairs (Table: Row | Column). */
  sides?: readonly [string, string];
}

/** Ask has no menu: it is the bar's first button, and a rule follows it. */
export const ASK: ItemSpec = { command: 'ask.start', icon: 'ask', label: 'Ask' };

const one = (spec: ItemSpec): readonly ItemSpec[] => [spec];

/** What the selection of a table covers as a whole, when it is a group of cells. */
const coverOf = (state: EditorState) => {
  const rect = rectOf(state);
  return rect ? wholeRect(rect) : null;
};
const PICKED_COLUMNS = 'Columns are selected, so there is no one row to change here.';
const PICKED_ROWS = 'Rows are selected, so there is no one column to change here.';
/** The Row side dims when columns are selected, as the Column side does when rows are. */
const rowSide = (state: EditorState): string | undefined =>
  coverOf(state) === 'column' ? PICKED_COLUMNS : undefined;
const columnSide = (state: EditorState): string | undefined =>
  coverOf(state) === 'row' ? PICKED_ROWS : undefined;

const plural = (n: number, word: string) => (n === 1 ? `1 ${word}` : `${n} ${word}s`);

/** The Table menu's header: where the caret is, or what is selected. */
export function tableHeading(state: EditorState): string {
  const rect = rectOf(state);
  if (rect) {
    const cover = wholeRect(rect);
    const rows = rect.rows[1] - rect.rows[0] + 1;
    const cols = rect.cols[1] - rect.cols[0] + 1;
    if (cover === 'table') return 'Whole table selected';
    if (cover === 'row') {
      return rows === 1 ? `Row ${rect.rows[0] + 1} selected` : `${rows} rows selected`;
    }
    if (cover === 'column') {
      return cols === 1 ? `Column ${rect.cols[0] + 1} selected` : `${cols} columns selected`;
    }
    return `Table · ${plural(rows * cols, 'cell')} selected`;
  }
  const row = touchedRows(state);
  const col = touchedCols(state);
  return row && col ? `Table · Row ${row.first + 1}, column ${col.first + 1}` : 'Table';
}

/** A line of the Table menu: the same action on a row and on a column. */
const pair = (
  rowCommand: string,
  rowIcon: ToolbarIcon,
  rowLabel: string,
  columnCommand: string,
  columnIcon: ToolbarIcon,
  columnLabel: string,
): readonly ItemSpec[] => [
  { command: rowCommand, icon: rowIcon, label: rowLabel, reason: rowSide, side: 'row' },
  {
    command: columnCommand,
    icon: columnIcon,
    label: columnLabel,
    reason: columnSide,
    side: 'column',
  },
];

/**
 * The menus, in the order the bar shows them. Table and Image (#552, #553) join after List.
 * Cut, Copy and Paste are the toolbar's own commands (`edit.ts`); Accept, Reject and Review Changes
 * are the review interface's (`change.accept`, `change.reject`, `review.start`); the others are the
 * formatting plugin's, the images' and the agents'.
 */
export const MENUS: readonly MenuSpec[] = [
  {
    id: 'insert',
    label: 'Insert',
    rows: [
      one({ command: 'format.link', icon: 'link' }),
      one({ command: 'image.insert', icon: 'image' }),
      one({ command: 'block.table', icon: 'table' }),
      one({ command: 'block.code', icon: 'code-block' }),
      one({ command: 'insert.quote', icon: 'quote', label: 'Quote' }),
      one({ command: 'block.alert', icon: 'alert', label: 'Callout' }),
      // A later lane's: the item appears when its command is registered.
      one({ command: 'block.collapsible', icon: 'collapsible' }),
    ],
  },
  {
    id: 'review',
    label: 'Review',
    rows: [
      one({ command: 'comment.add', icon: 'comment', label: 'Comment' }),
      one({ command: 'highlight.toggle', icon: 'highlight' }),
      [
        { command: 'change.accept', icon: 'accept', label: 'Accept' },
        { command: 'change.reject', icon: 'reject', label: 'Reject' },
      ],
      one({ command: 'review.start', icon: 'review' }),
    ],
  },
  {
    id: 'list',
    label: 'List',
    // Only where the selection holds a paragraph or a list item, which a list can be made of.
    shownWhen: ({ holds }) => holds.paragraph || holds.item,
    rows: [
      one({ command: 'block.ul', icon: 'bullets', label: 'Bullets' }),
      one({ command: 'block.ol', icon: 'numbers', label: 'Numbers' }),
      one({ command: 'block.task', icon: 'checkboxes', label: 'Checkboxes' }),
      one({
        command: 'block.body',
        icon: 'no-list',
        label: 'No List',
        // Body is already what a paragraph is: removing a list from one has nothing to do.
        reason: (_state, { holds }) =>
          holds.item ? undefined : 'This is not a list, so there is nothing to remove.',
      }),
    ],
  },
  {
    id: 'table',
    label: 'Table',
    // Only in a table; the commands say so themselves (`NOT_IN_TABLE`).
    shownWhen: (context) => context.canRun('table.deleteTable'),
    heading: tableHeading,
    sides: ['Row', 'Column'],
    rows: [
      pair(
        'table.insertRowAbove',
        'row-above',
        'Insert Above',
        'table.insertColumnLeft',
        'col-left',
        'Insert Left',
      ),
      pair(
        'table.insertRowBelow',
        'row-below',
        'Insert Below',
        'table.insertColumnRight',
        'col-right',
        'Insert Right',
      ),
      pair(
        'table.moveRowUp',
        'move-up',
        'Move Up',
        'table.moveColumnLeft',
        'move-left',
        'Move Left',
      ),
      pair(
        'table.moveRowDown',
        'move-down',
        'Move Down',
        'table.moveColumnRight',
        'move-right',
        'Move Right',
      ),
      pair('table.selectRow', 'select', 'Select', 'table.selectColumn', 'select', 'Select'),
      pair('table.deleteRow', 'delete', 'Delete', 'table.deleteColumn', 'delete', 'Delete'),
      [
        {
          command: 'table.alignLeft',
          icon: 'align-left',
          label: 'Left',
          caption: 'Align column',
          side: 'align column',
          reason: columnSide,
        },
        {
          command: 'table.alignCenter',
          icon: 'align-center',
          label: 'Center',
          side: 'align column',
          reason: columnSide,
        },
        {
          command: 'table.alignRight',
          icon: 'align-right',
          label: 'Right',
          side: 'align column',
          reason: columnSide,
        },
      ],
      one({ command: 'table.deleteTable', icon: 'delete' }),
    ],
  },
  {
    id: 'image',
    label: 'Image',
    // Only where an image is under the caret or in the selection; its commands say so themselves.
    shownWhen: (context) => context.canRun('image.align.left'),
    rows: [
      [
        {
          command: 'image.align.left',
          icon: 'align-left',
          label: 'Left',
          caption: 'Align',
          side: 'align image',
        },
        {
          command: 'image.align.center',
          icon: 'align-center',
          label: 'Center',
          side: 'align image',
        },
        { command: 'image.align.right', icon: 'align-right', label: 'Right', side: 'align image' },
      ],
      [
        {
          command: 'image.size.small',
          icon: 'size-small',
          label: 'Small',
          caption: 'Size',
          side: 'image size',
        },
        { command: 'image.size.medium', icon: 'size-medium', label: 'Medium', side: 'image size' },
        { command: 'image.size.large', icon: 'size-large', label: 'Large', side: 'image size' },
      ],
      one({ command: 'image.size.original', icon: 'original-size', label: 'Original Size' }),
      // Edit in Preview is the editor's own (#525), where the host can open files. Alt Text… needs
      // an agent to write the description (the agents' lane) and keeps its place: the item appears
      // when its command, `image.altText`, is registered.
      one({ command: 'image.edit', icon: 'preview', label: 'Edit in Preview' }),
      one({ command: 'image.altText', icon: 'alt-text', label: 'Alt Text…' }),
    ],
  },
  {
    id: 'format',
    label: 'Format',
    rows: [
      one({ command: 'format.bold', icon: 'bold' }),
      one({ command: 'format.italic', icon: 'italic' }),
      one({ command: 'format.strike', icon: 'strike' }),
      one({ command: 'format.code', icon: 'code' }),
      one({ command: 'format.sub', icon: 'subscript' }),
      one({ command: 'format.sup', icon: 'superscript' }),
      one({ command: 'format.clear', icon: 'clear' }),
    ],
  },
  {
    id: 'edit',
    label: 'Edit',
    rows: [
      one({ command: 'edit.cut', icon: 'cut', keys: '⌘X' }),
      one({ command: 'edit.copy', icon: 'copy', keys: '⌘C' }),
      one({ command: 'edit.paste', icon: 'paste', keys: '⌘V' }),
    ],
  },
];

/** An item as it is shown now. */
export interface ShownItem {
  /** The command's id: what the item runs, and what names it in the page. */
  id: string;
  icon: ToolbarIcon;
  /** What the menu says: the menu's word, or the command's title. */
  label: string;
  /** The command's name as a hint says it: "Link", for a title that opens a box, "Link…". */
  name: string;
  /** The shortcut as the Mac writes it, or null for a command with none. */
  keys: string | null;
  /** The shortcut for `aria-keyshortcuts`, when the registry binds one. */
  aria: string | null;
  enabled: boolean;
  /** Why the item can't be used here, which its hint says; null when it can. */
  reason: string | null;
  /** Whether the command can be on or off, as Bold is: it says whether it is active. */
  toggle: boolean;
  /** Whether the command is on where the selection is, as Bold is inside bold text. */
  active: boolean;
  /** Words over the item's line, when it is the first of one that has them. */
  caption: string | null;
  /** What the item is for (row, column), which its accessible name adds; null for most. */
  side: string | null;
}

export interface ShownMenu {
  id: MenuId;
  label: string;
  /** The header: the menu's name, or what its selection is. */
  heading: string;
  /** The names of the two sides of a menu of pairs, or null. */
  sides: readonly [string, string] | null;
  rows: ShownItem[][];
}

/** The bar as it is shown: Ask, if the agents are there, and the menus that have items. */
export interface ShownBar {
  ask: ShownItem | null;
  menus: ShownMenu[];
}

function shown(
  spec: ItemSpec,
  command: EditorCommand,
  state: EditorState,
  context: Context,
): ShownItem {
  const title = typeof command.title === 'function' ? command.title(state) : command.title;
  const name = title.replace(/…$/, '');
  const reason = command.disabledReason?.(state) ?? spec.reason?.(state, context) ?? null;
  return {
    id: command.id,
    icon: spec.icon,
    label: spec.label ?? title,
    name,
    keys: command.shortcut ? formatShortcut(command.shortcut) : (spec.keys ?? null),
    aria: command.shortcut ? ariaShortcut(command.shortcut) : null,
    enabled: reason === null,
    reason,
    toggle: command.isActive !== undefined,
    active: command.isActive?.(state) ?? false,
    caption: spec.caption ?? null,
    side: spec.side ?? null,
  };
}

/** The toolbar as `commands` and `state` have it: the menus in the bar's order. */
export function shownBar(
  commands: readonly EditorCommand[],
  state: EditorState,
  /** What the selection holds; the Markdown parse's reading of `state` by default. */
  holds: Holds = selectionHolds(state),
): ShownBar {
  const byId = new Map(commands.map((command) => [command.id, command]));
  const context: Context = {
    isOn: (id) => byId.get(id)?.isActive?.(state) ?? false,
    canRun: (id) => {
      const found = byId.get(id);
      return found !== undefined && found.disabledReason?.(state) === undefined;
    },
    holds,
  };
  const item = (spec: ItemSpec): ShownItem[] => {
    const command = byId.get(spec.command);
    return command ? [shown(spec, command, state, context)] : [];
  };
  const menus = MENUS.flatMap((menu) => {
    if (menu.shownWhen && !menu.shownWhen(context)) return [];
    const rows = menu.rows.map((row) => row.flatMap(item)).filter((row) => row.length > 0);
    return rows.length
      ? [
          {
            id: menu.id,
            label: menu.label,
            heading: menu.heading?.(state) ?? menu.label,
            sides: menu.sides ?? null,
            rows,
          },
        ]
      : [];
  });
  return { ask: item(ASK)[0] ?? null, menus };
}
