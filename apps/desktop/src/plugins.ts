// The plugins the desktop app runs, and how it starts them. A host chooses its plugins by what
// it lists here.

import type { Editor } from '@redlines/editor';
import { plugin as code } from '@redlines/code';
import { plugin as find } from '@redlines/find';
import type { Host, Plugin, PluginContext } from '@redlines/plugin-api';

/** The plugins the desktop app activates, in order. */
export const DESKTOP_PLUGINS: readonly Plugin[] = [find, code];

export interface ActivateOptions {
  /** Who is using the app; until it is known, plugins see a stand-in. */
  author?: PluginContext['author'];
  /** Shows a short message that does not interrupt; defaults to the console. */
  notice?: (message: string) => void;
}

/**
 * Activates `plugins` in order and returns a function that takes them out in reverse. A plugin
 * that throws is logged by id and does not stop the others, or the app.
 */
export function activatePlugins(
  editor: Editor,
  host: Host,
  plugins: readonly Plugin[],
  options: ActivateOptions = {},
): () => void {
  const { author = { handle: 'me', name: 'Me' }, notice = (message) => console.info(message) } =
    options;
  const removals: { id: string; remove: () => void }[] = [];
  for (const plugin of plugins) {
    const { id } = plugin.manifest;
    try {
      removals.push({ id, remove: plugin.activate({ editor, host, author, notice }) });
    } catch (error) {
      console.error(`Plugin ${id} could not start`, error);
    }
  }
  return () => {
    for (const { id, remove } of removals.reverse()) {
      try {
        remove();
      } catch (error) {
        console.error(`Plugin ${id} could not be removed`, error);
      }
    }
  };
}
