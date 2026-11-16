// The command palette the toolbar holds (issue #550): with the bar open, typing searches every
// command that works at the caret and every app command and setting the host offers. The pure part,
// tested without a page: what is in the index, how a name matches, and in what order.
//
// A line has a name (a verb phrase, which may differ from the menu's: Link… is Insert Link), the
// menu's word and synonyms for search only, and what it shows (a switch, a choice, a slider or a
// button, for a setting), and its key. A command that doesn't work at the caret is left out.

import type { EditorState } from '@codemirror/state';
import { disabledReasonOf, type EditorCommand } from '@redlines/editor';
import type { ToolbarIcon } from './icons.ts';
import { ASK, MENUS } from './items.ts';
import { formatShortcut } from './shortcuts.ts';

/** A setting's control, drawn in its line, which stays open as it is used. */
export type Control =
  | { kind: 'switch'; get(): boolean; set(on: boolean): void }
  | {
      kind: 'choice';
      options: readonly { value: string; label: string }[];
      get(): string;
      set(value: string): void;
    }
  | {
      kind: 'slider';
      min: number;
      max: number;
      step: number;
      get(): number;
      set(value: number): void;
      /** How the value reads beside the slider; default: the number. */
      format?(value: number): string;
    };

/** A command or setting of the app, which the host offers to the palette. */
export interface AppCommand {
  id: string;
  /** What it does, as a verb phrase, or a setting's name. */
  title: string;
  /** Words that find it besides its title ("dark mode" finds Appearance). */
  synonyms?: readonly string[];
  /** The shortcut, as the Mac writes it, when it has one. */
  keys?: string;
  /** A setting's control. Without one, the line runs `run`. */
  control?: Control;
  /** What it does when chosen; for a command with a control, the action of Return when it has one. */
  run?(): void;
  /** Whether it works now; one that doesn't is left out. Default: yes. */
  available?(): boolean;
}

/** One line of the palette. */
export interface Entry {
  /** The registry's id, or the app command's. */
  id: string;
  /** What the line says. */
  name: string;
  icon: ToolbarIcon;
  keys: string | null;
  /** The words search looks in, besides the name. */
  words: string;
  control: Control | null;
  /** Chooses the line: runs the command, or for a control does what Return does. */
  run(): void;
  /** Whether the line runs a registry command (and the toolbar goes), or an app's own. */
  kind: 'command' | 'app';
}

/** The palette's name for a command, where it differs from the menu's (the menu's word is searched too). */
export const PALETTE_NAMES: Readonly<Record<string, string>> = {
  'format.link': 'Insert Link',
  'image.insert': 'Insert Image',
  'block.table': 'Insert Table',
  'block.code': 'Insert Code Block',
  'block.quote': 'Insert Quote',
  'block.alert': 'Insert Callout',
  'format.code': 'Format as Code',
  'comment.add': 'Add Comment',
  'highlight.toggle': 'Highlight Text',
  'change.accept': 'Accept Change',
  'change.reject': 'Reject Change',
  'block.ul': 'Make Bulleted List',
  'block.ol': 'Make Numbered List',
  'block.task': 'Make Checklist',
  'block.body': 'Remove List',
  'review.start': 'Review Changes',
  'image.edit': 'Edit Image in Preview',
};

/** Words that find a command besides its names. Matching is by whole word. */
export const SYNONYMS: Readonly<Record<string, string>> = {
  'format.link': 'url hyperlink',
  'image.insert': 'picture photo',
  'block.table': 'grid',
  'block.code': 'snippet fenced',
  'block.quote': 'blockquote citation',
  'block.alert': 'alert admonition note warning',
  'format.bold': 'strong',
  'format.italic': 'emphasis',
  'format.strike': 'strikethrough cross out',
  'format.code': 'monospace inline',
  'format.sub': 'subscript h2o',
  'format.sup': 'superscript',
  'format.clear': 'plain remove formatting',
  'block.ul': 'unordered list bullets bullet',
  'block.ol': 'numbers numbered ordered list',
  'block.task': 'todo checkboxes checkbox checklist task list',
  'block.body': 'paragraph no list unlist',
  'comment.add': 'note annotate',
  'highlight.toggle': 'marker',
  'change.accept': 'approve',
  'change.reject': 'decline',
  'review.start': 'changes redlines',
  'edit.cut': 'clipboard',
  'edit.copy': 'clipboard',
  'edit.paste': 'clipboard',
};

/** The icon of each command the bar's menus hold. */
const ICONS = new Map(
  [ASK, ...MENUS.flatMap((menu) => menu.rows.flat())].map((spec) => [spec.command, spec.icon]),
);
const MENU_WORD = new Map(
  [ASK, ...MENUS.flatMap((menu) => menu.rows.flat())].map((spec) => [spec.command, spec.label]),
);

const titleOf = (command: EditorCommand, state: EditorState): string =>
  typeof command.title === 'function' ? command.title(state) : command.title;

/** What is in the palette: the commands that work at the caret, then the host's. */
export function entriesOf(
  commands: readonly EditorCommand[],
  state: EditorState,
  app: readonly AppCommand[],
  run: (id: string) => void,
): Entry[] {
  const fromRegistry = commands.flatMap((command): Entry[] => {
    // The toolbar's own commands aren't for the palette that is in it.
    if (command.id === 'toolbar.show') return [];
    if (disabledReasonOf(command, state) !== undefined) return [];
    const title = titleOf(command, state).replace(/…$/, '');
    const name = PALETTE_NAMES[command.id] ?? title;
    const menu = MENU_WORD.get(command.id);
    return [
      {
        id: command.id,
        name,
        icon: ICONS.get(command.id) ?? 'command',
        keys: command.shortcut ? formatShortcut(command.shortcut) : null,
        words: [title, menu ?? '', SYNONYMS[command.id] ?? ''].join(' '),
        control: null,
        run: () => run(command.id),
        kind: 'command',
      },
    ];
  });
  const fromApp = app
    .filter((each) => each.available?.() !== false)
    .map((each): Entry => ({
      id: each.id,
      name: each.title,
      icon: 'command',
      keys: each.keys ?? null,
      words: [each.title, ...(each.synonyms ?? [])].join(' '),
      control: each.control ?? null,
      run: () => each.run?.(),
      kind: 'app',
    }));
  return [...fromRegistry, ...fromApp];
}

const wordsOf = (text: string): string[] => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

/**
 * How well `entry` answers `query`, or null for no match. Every word of the query must start a word
 * of the entry (whole words: "ordered list" finds Numbered List, never "unordered"). A word of the
 * name scores best, and an earlier word and a shorter name better.
 */
export function score(entry: Entry, query: string): number | null {
  const wanted = wordsOf(query);
  if (wanted.length === 0) return 0;
  const names = wordsOf(entry.name);
  const others = wordsOf(entry.words);
  let total = 0;
  for (const word of wanted) {
    const inName = names.findIndex((each) => each.startsWith(word));
    if (inName >= 0) {
      total += (names[inName] === word ? 0 : 1) + inName * 0.1;
    } else if (others.some((each) => each.startsWith(word))) {
      total += 5;
    } else return null;
  }
  return total + names.length * 0.01;
}

/** The entries that answer `query`, best first; in the index's own order for an empty one. */
export function search(entries: readonly Entry[], query: string): Entry[] {
  const scored = entries.flatMap((entry, order) => {
    const value = score(entry, query);
    return value === null ? [] : [{ entry, value, order }];
  });
  return scored.sort((a, b) => a.value - b.value || a.order - b.order).map(({ entry }) => entry);
}
