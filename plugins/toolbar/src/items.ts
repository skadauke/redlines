// What the toolbar holds (issues #313, #504): a row of menus, Ask | Insert · Review · [List] ·
// Format · Edit, whose items are commands of the registry, by id, so that the toolbar, the Format
// menu and the shortcuts never disagree about names, keys or whether an item is there. An item whose
// command isn't registered is left out, and appears when its command lands; a menu with none left
// is not drawn. The pure part: `shownBar` says what is in the bar for a state, and `index.ts` draws.
//
// Parts that come later are named here so that their place is kept: the Table and Image menus
// (#552, #553) go to the right of Review, after List, and Insert holds a slot for Collapsible
// Section, which appears when its command (`block.collapsible`) is registered.

import type { EditorState } from '@codemirror/state';
import type { EditorCommand } from '@redlines/editor';
import type { ToolbarIcon } from './icons.ts';
import { ariaShortcut, formatShortcut } from './shortcuts.ts';

export type MenuId = 'insert' | 'review' | 'list' | 'format' | 'edit';

/** What a toolbar item may ask of the registry, besides its own command. */
export interface Context {
  /** Whether the command `id` is registered and on where the selection is. */
  isOn(id: string): boolean;
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
}

export interface MenuSpec {
  id: MenuId;
  label: string;
  /** The items, in lines; the items of a line share it (Accept | Reject). */
  rows: readonly (readonly ItemSpec[])[];
  /** Whether the menu is in the bar for the selection; default: always. */
  shownWhen?: (context: Context) => boolean;
}

/** Ask has no menu: it is the bar's first button, and a rule follows it. */
export const ASK: ItemSpec = { command: 'ask.start', icon: 'ask', label: 'Ask' };

/** The commands that mean "the selection is in a paragraph or a list item". */
export const CONVERTIBLE = ['block.body', 'block.ul', 'block.ol', 'block.task'] as const;
export const LISTS = ['block.ul', 'block.ol', 'block.task'] as const;

const one = (spec: ItemSpec): readonly ItemSpec[] => [spec];

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
      one({ command: 'block.quote', icon: 'quote' }),
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
    shownWhen: (context) => CONVERTIBLE.some((id) => context.isOn(id)),
    rows: [
      one({ command: 'block.ul', icon: 'bullets', label: 'Bullets' }),
      one({ command: 'block.ol', icon: 'numbers', label: 'Numbers' }),
      one({ command: 'block.task', icon: 'checkboxes', label: 'Checkboxes' }),
      one({
        command: 'block.body',
        icon: 'no-list',
        label: 'No List',
        // Body is already what a paragraph is: removing a list from one has nothing to do.
        reason: (_state, context) =>
          LISTS.some((id) => context.isOn(id))
            ? undefined
            : 'This is not a list, so there is nothing to remove.',
      }),
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
}

export interface ShownMenu {
  id: MenuId;
  label: string;
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
  };
}

/** The toolbar as `commands` and `state` have it: the menus in the bar's order. */
export function shownBar(commands: readonly EditorCommand[], state: EditorState): ShownBar {
  const byId = new Map(commands.map((command) => [command.id, command]));
  const context: Context = {
    isOn: (id) => byId.get(id)?.isActive?.(state) ?? false,
  };
  const item = (spec: ItemSpec): ShownItem[] => {
    const command = byId.get(spec.command);
    return command ? [shown(spec, command, state, context)] : [];
  };
  const menus = MENUS.flatMap((menu) => {
    if (menu.shownWhen && !menu.shownWhen(context)) return [];
    const rows = menu.rows.map((row) => row.flatMap(item)).filter((row) => row.length > 0);
    return rows.length ? [{ id: menu.id, label: menu.label, rows }] : [];
  });
  return { ask: item(ASK)[0] ?? null, menus };
}
