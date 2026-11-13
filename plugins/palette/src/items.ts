// What the palette holds (issue #313): its items are commands of the registry, by id, so that the
// palette, the Format menu and the shortcuts never disagree about names, keys or whether an item is
// there. An item whose command isn't registered is left out, and appears when its command lands.

import type { EditorState } from '@codemirror/state';
import type { EditorCommand } from '@redlines/editor';
import type { PaletteIcon } from './icons.ts';
import { ariaShortcut, formatShortcut } from './shortcuts.ts';

export type GroupId = 'review' | 'insert' | 'format' | 'edit';

/** The groups, in the order the palette shows them, each with the name a screen reader says. */
export const GROUPS: readonly { id: GroupId; label: string }[] = [
  { id: 'review', label: 'Comment' },
  { id: 'insert', label: 'Insert' },
  { id: 'format', label: 'Format' },
  { id: 'edit', label: 'Edit' },
];

/** An item the palette may hold: the command it runs, and how it is drawn. */
export interface ItemSpec {
  /** The command's id in the registry. */
  command: string;
  group: GroupId;
  icon: PaletteIcon;
  /**
   * The keys to show when the registry binds none: the system's own, for Cut, Copy and Paste,
   * which the Edit menu's items carry.
   */
  keys?: string;
}

/**
 * Every item, in order. Add Comment, Highlight and Ask come first: the most common workflow is to
 * select text and right-click. The commands of other plugins are known by the ids they were given:
 * `format.sub` and `format.sup` (Subscript, Superscript) and `block.alert` by the Markdown
 * rendering, `image.insert` by the images, `highlight.toggle` by the review interface, `ask.start`
 * by the agents. Cut, Copy and Paste are the palette's own (`edit.ts`).
 */
export const ITEMS: readonly ItemSpec[] = [
  { command: 'comment.add', group: 'review', icon: 'comment' },
  { command: 'highlight.toggle', group: 'review', icon: 'highlight' },
  { command: 'ask.start', group: 'review', icon: 'ask' },
  { command: 'block.table', group: 'insert', icon: 'table' },
  { command: 'block.code', group: 'insert', icon: 'code-block' },
  { command: 'block.alert', group: 'insert', icon: 'alert' },
  { command: 'image.insert', group: 'insert', icon: 'image' },
  { command: 'block.quote', group: 'insert', icon: 'quote' },
  { command: 'format.link', group: 'insert', icon: 'link' },
  { command: 'format.bold', group: 'format', icon: 'bold' },
  { command: 'format.italic', group: 'format', icon: 'italic' },
  { command: 'format.sub', group: 'format', icon: 'subscript' },
  { command: 'format.sup', group: 'format', icon: 'superscript' },
  { command: 'format.clear', group: 'format', icon: 'clear' },
  { command: 'edit.cut', group: 'edit', icon: 'cut', keys: '⌘X' },
  { command: 'edit.copy', group: 'edit', icon: 'copy', keys: '⌘C' },
  { command: 'edit.paste', group: 'edit', icon: 'paste', keys: '⌘V' },
];

/** An item as it is shown now. */
export interface ShownItem {
  /** The command's id: what the item runs, and what names it in the page. */
  id: string;
  icon: PaletteIcon;
  /** The command's name as a hint says it: "Link", for a title that opens a box, "Link…". */
  name: string;
  /** The shortcut as the Mac writes it, or null for a command with none. */
  keys: string | null;
  /** The shortcut for `aria-keyshortcuts`, when the registry binds one. */
  aria: string | null;
  enabled: boolean;
  /** Whether the command can be on or off, as Bold is: it says whether it is active. */
  toggle: boolean;
  /** Whether the command is on where the selection is, as Bold is inside bold text. */
  active: boolean;
}

export interface ShownGroup {
  id: GroupId;
  label: string;
  items: ShownItem[];
}

function shown(spec: ItemSpec, command: EditorCommand, state: EditorState): ShownItem {
  const title = typeof command.title === 'function' ? command.title(state) : command.title;
  return {
    id: command.id,
    icon: spec.icon,
    name: title.replace(/…$/, ''),
    keys: command.shortcut ? formatShortcut(command.shortcut) : (spec.keys ?? null),
    aria: command.shortcut ? ariaShortcut(command.shortcut) : null,
    enabled: command.isEnabled?.(state) ?? true,
    toggle: command.isActive !== undefined,
    active: command.isActive?.(state) ?? false,
  };
}

/**
 * The palette's items as `commands` and `state` have them: the groups in the palette's order, with
 * the items whose commands are registered, and no group that is left with none.
 */
export function shownGroups(commands: readonly EditorCommand[], state: EditorState): ShownGroup[] {
  const byId = new Map(commands.map((command) => [command.id, command]));
  return GROUPS.flatMap(({ id, label }) => {
    const items = ITEMS.filter((spec) => spec.group === id).flatMap((spec) => {
      const command = byId.get(spec.command);
      return command ? [shown(spec, command, state)] : [];
    });
    return items.length ? [{ id, label, items }] : [];
  });
}
