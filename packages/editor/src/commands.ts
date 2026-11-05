// The command registry, the seam between plugins and hosts: a plugin registers a command, the core
// binds its key, and a host with menus draws it from the list and runs it by id.
//
// A key belongs to its command, which comes before the core's own keys: CodeMirror's defaults bind
// Mod-i, Mod-] and Mod-[, which the formatting commands use. The command has the key even when it
// did nothing, so that the key doesn't go on to the core's binding. Nor does it go on to the menu
// bar, whose item would run the command again (a Mac's webview sees a key before the menu bar does),
// or to WebKit, which would make the text bold itself.

import { type EditorState, Prec } from '@codemirror/state';
import { type EditorView, keymap, type KeyBinding } from '@codemirror/view';
import type { CommandRegistry, Editor, EditorCommand } from './api.ts';

const isEnabled = (command: EditorCommand, state: EditorState) =>
  command.isEnabled?.(state) ?? true;

/** The ids of the commands that are active in `state`. */
export const activeCommands = (commands: readonly EditorCommand[], state: EditorState) =>
  commands.filter((command) => command.isActive?.(state)).map(({ id }) => id);

/** The ids of the commands that can run in `state`. */
export const enabledCommands = (commands: readonly EditorCommand[], state: EditorState) =>
  commands.filter((command) => isEnabled(command, state)).map(({ id }) => id);

/** The modifiers CodeMirror reads. */
const MODIFIER = /^(mod|cmd|meta|m|ctrl|control|c|alt|a|shift|s)$/i;

/**
 * Throws on a shortcut with a modifier CodeMirror can't read. CodeMirror finds out only when it
 * builds its keymaps, at the next key press, and then no key in the editor works.
 */
function checkShortcut({ id, shortcut }: EditorCommand): void {
  // As CodeMirror splits it: a "-" at the end is the key itself, as in `Mod--`.
  const modifiers = shortcut?.split(/-(?!$)/).slice(0, -1) ?? [];
  const unknown = modifiers.find((modifier) => !MODIFIER.test(modifier));
  if (unknown === undefined) return;
  throw new Error(`The command ${id} has the shortcut ${shortcut}, and ${unknown} is no modifier`);
}

/** Kinds of `<input>` that take no typing, so that a command can run while one has the focus. */
const NOT_TYPED_IN = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]);

/** Whether the keyboard is typing into something other than the document. */
function focusInOtherField(view: EditorView): boolean {
  const focused = view.root.activeElement;
  if (focused === view.contentDOM) return false;
  if (focused instanceof HTMLTextAreaElement) return true;
  if (focused instanceof HTMLInputElement) return !NOT_TYPED_IN.has(focused.type);
  return focused instanceof HTMLElement && focused.isContentEditable;
}

/**
 * Makes the registry of an editor that doesn't exist yet: `editor` is asked for it when a command
 * is registered or run. `changed` is told when the list of commands has changed.
 */
export function createCommandRegistry(editor: () => Editor, changed: () => void): CommandRegistry {
  let commands: readonly EditorCommand[] = [];

  const run = (command: EditorCommand) =>
    isEnabled(command, editor().view.state) && command.run(editor());

  /** Keeps the key whatever the command does. */
  const binding = (command: EditorCommand, key: string): KeyBinding => ({
    key,
    run: () => {
      run(command);
      return true;
    },
  });
  const bindings = (added: readonly EditorCommand[]) =>
    added.flatMap((command) => (command.shortcut ? [binding(command, command.shortcut)] : []));

  return {
    list: () => commands,
    register(added) {
      const ids = new Set(commands.map(({ id }) => id));
      for (const command of added) {
        if (ids.has(command.id)) throw new Error(`The command ${command.id} is already registered`);
        ids.add(command.id);
        checkShortcut(command);
      }
      commands = [...commands, ...added];
      const removeKeys = editor().addExtension(Prec.high(keymap.of(bindings(added))));
      changed();
      let removed = false;
      return () => {
        if (removed) return;
        removed = true;
        commands = commands.filter((command) => !added.includes(command));
        removeKeys();
        changed();
      };
    },
    run(id) {
      const command = commands.find((candidate) => candidate.id === id);
      return !!command && !focusInOtherField(editor().view) && run(command);
    },
  };
}
