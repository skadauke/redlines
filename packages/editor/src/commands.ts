// The command registry, the seam between plugins and hosts: a plugin registers a command, the core
// binds its key, and a host with menus draws it from the list and runs it by id.
//
// A command runs once for a key press. A Mac's webview sees a key before the menu bar does, and a
// key the page leaves alone goes on to the menu bar, whose item would run the command again. So a
// binding always keeps its key, even from a command that did nothing: WebKit would otherwise act on
// it too, making the text bold itself.

import type { EditorState } from '@codemirror/state';
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

  const bindings = (added: readonly EditorCommand[]): KeyBinding[] =>
    added.flatMap((command) =>
      command.shortcut
        ? [{ key: command.shortcut, preventDefault: true, run: () => run(command) }]
        : [],
    );

  return {
    list: () => commands,
    register(added) {
      const ids = new Set(commands.map(({ id }) => id));
      for (const { id } of added) {
        if (ids.has(id)) throw new Error(`The command ${id} is already registered`);
        ids.add(id);
      }
      commands = [...commands, ...added];
      const removeKeys = editor().addExtension(keymap.of(bindings(added)));
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
