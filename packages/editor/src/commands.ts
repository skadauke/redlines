// The command registry, the seam between plugins and hosts: a plugin registers a command, the core
// binds its key, and a host with menus draws it from the list and runs it by id.
//
// A key belongs to its command, which comes before the core's own keys: CodeMirror's defaults bind
// Mod-i, Mod-] and Mod-[, which the formatting commands use. The command has the key even when it
// did nothing, so that the key doesn't go on to the core's binding. Nor does it go on to the menu
// bar, whose item would run the command again (a Mac's webview sees a key before the menu bar does),
// or to WebKit, which would make the text bold itself.

import { EditorState, Prec } from '@codemirror/state';
import { type EditorView, keymap, type KeyBinding } from '@codemirror/view';
import type { CommandKeys, CommandRegistry, Editor, EditorCommand } from './api.ts';

/** Why `command` can't run in `state`, or undefined when it can. */
export const disabledReasonOf = (command: EditorCommand, state: EditorState): string | undefined =>
  command.disabledReason?.(state);

const isEnabled = (command: EditorCommand, state: EditorState) =>
  disabledReasonOf(command, state) === undefined;

/** The ids of the commands that are active in `state`. */
export const activeCommands = (commands: readonly EditorCommand[], state: EditorState) =>
  commands.filter((command) => command.isActive?.(state)).map(({ id }) => id);

/** The ids of the commands that can run in `state`. */
export const enabledCommands = (commands: readonly EditorCommand[], state: EditorState) =>
  commands.filter((command) => isEnabled(command, state)).map(({ id }) => id);

/** The reason of each registered command that can't run in `state`, by id. */
export function disabledReasons(
  commands: readonly EditorCommand[],
  state: EditorState,
): Record<string, string> {
  const reasons: Record<string, string> = {};
  for (const command of commands) {
    const reason = disabledReasonOf(command, state);
    if (reason !== undefined) reasons[command.id] = reason;
  }
  return reasons;
}

/** A command's title in `state`. */
export const titleOf = (command: EditorCommand, state: EditorState): string =>
  typeof command.title === 'function' ? command.title(state) : command.title;

/** A command's title before there is a state to read: what its function says of an empty document,
 * so a title function must work on a state that has none of the editor's fields. */
export const baseTitle = (command: EditorCommand): string =>
  typeof command.title === 'function' ? command.title(EditorState.create()) : command.title;

/** The titles of the commands whose title reads the state, by id. */
export function commandTitles(
  commands: readonly EditorCommand[],
  state: EditorState,
): Record<string, string> {
  const titles: Record<string, string> = {};
  for (const command of commands) {
    if (typeof command.title === 'function') titles[command.id] = command.title(state);
  }
  return titles;
}

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
 * is registered or run. `changed` is told when the list of commands has changed. `notice` says why a
 * key does nothing: the key of a disabled command says its reason (`EditorCommand.disabledReason`),
 * unless the key goes on to the core's binding. `keys` has the person's own keys: a command's key is
 * what it says, which is the command's own until they change it, and the keys follow a change.
 */
export function createCommandRegistry(
  editor: () => Editor,
  changed: () => void,
  notice: (message: string) => void = () => {},
  keys?: CommandKeys,
): CommandRegistry {
  let commands: readonly EditorCommand[] = [];
  /** The commands as listed: each with the key it has now, and the one it came with. */
  let listed: readonly EditorCommand[] = [];
  const keyOf = (command: EditorCommand) =>
    keys ? keys.keyOf(command.id, command.shortcut) : command.shortcut;
  const relist = () => {
    listed = commands.map((command) => {
      const shortcut = keyOf(command);
      return shortcut === command.shortcut
        ? command
        : { ...command, shortcut, defaultShortcut: command.shortcut };
    });
  };

  /** Runs a command, or says why it can't be run: a disabled command (its key, or a click that got
   * past a grayed menu item or button) is told, since a command that does nothing and says nothing
   * is a bug. */
  const run = (command: EditorCommand) => {
    const reason = disabledReasonOf(command, editor().view.state);
    if (reason === undefined) return command.run(editor());
    notice(reason);
    return false;
  };

  /** Keeps the key whatever the command does, unless the command lets it go on. */
  const binding = (command: EditorCommand, key: string): KeyBinding => ({
    key,
    run: () => {
      const state = editor().view.state;
      const falls = command.keyFallsThrough;
      const goesOn = typeof falls === 'function' ? falls(state) : falls;
      // A key that goes on to the core's binding when its command can't run says nothing.
      if (goesOn && disabledReasonOf(command, state) !== undefined) return false;
      return run(command) || !goesOn;
    },
  });
  const bindings = () =>
    commands.flatMap((command) => {
      const key = keyOf(command);
      return key ? [binding(command, key)] : [];
    });
  let removeKeys = () => {};
  /** Binds every command's key again, in one keymap that comes before the core's. */
  const bindAll = () => {
    removeKeys();
    relist();
    removeKeys = editor().addExtension(Prec.high(keymap.of(bindings())));
  };
  keys?.subscribe(() => {
    if (commands.length) bindAll();
    changed();
  });

  return {
    list: () => listed,
    register(added) {
      const ids = new Set(commands.map(({ id }) => id));
      for (const command of added) {
        if (ids.has(command.id)) throw new Error(`The command ${command.id} is already registered`);
        ids.add(command.id);
        checkShortcut(command);
      }
      commands = [...commands, ...added];
      bindAll();
      changed();
      let removed = false;
      return () => {
        if (removed) return;
        removed = true;
        commands = commands.filter((command) => !added.includes(command));
        bindAll();
        changed();
      };
    },
    run(id) {
      const command = commands.find((candidate) => candidate.id === id);
      return (
        !!command && (command.runsInFields || !focusInOtherField(editor().view)) && run(command)
      );
    },
  };
}
