// The plugins the desktop app runs, and how it starts them. A host chooses its plugins by what
// it lists here.

import type { Editor } from '@redlines/editor';
import { plugin as code } from '@redlines/code';
import { plugin as find } from '@redlines/find';
import type {
  Host,
  HostDocumentData,
  Plugin,
  PluginContext,
  PluginManifest,
} from '@redlines/plugin-api';

/** The plugins the desktop app activates, in order. */
export const DESKTOP_PLUGINS: readonly Plugin[] = [find, code];

export interface ActivateOptions {
  /** Who is using the app; until it is known, plugins see a stand-in. */
  author?: PluginContext['author'];
  /** Shows a short message that does not interrupt; defaults to the console. */
  notice?: (message: string) => void;
  /**
   * The store of document data for a plugin (`DocumentData.forPlugin`), or none for one whose
   * manifest doesn't ask for `document:data`. Each plugin gets its own.
   */
  documentData?: (manifest: PluginManifest) => HostDocumentData | undefined;
}

/**
 * Activates `plugins` in order and returns a function that takes them out in reverse. A plugin
 * that throws is logged by id and does not stop the others, or the app. A plugin with the id of one
 * listed before it is not activated: its id is what its data and commands are known by. Each
 * plugin gets the host with its own store of document data, if its manifest asks for one, and
 * never another's.
 */
export function activatePlugins(
  editor: Editor,
  host: Host,
  plugins: readonly Plugin[],
  options: ActivateOptions = {},
): () => void {
  const { author = { handle: 'me', name: 'Me' }, notice = (message) => console.info(message) } =
    options;
  // A store in the host itself would be every plugin's: each gets its own, or none.
  const shared: Host = { ...host };
  delete shared.documentData;
  const removals: { id: string; remove: () => void }[] = [];
  const ids = new Set<string>();
  for (const plugin of plugins) {
    const { id } = plugin.manifest;
    if (ids.has(id)) {
      console.error(`Plugin ${id} is not activated: another plugin has its id`);
      continue;
    }
    ids.add(id);
    try {
      const documentData = options.documentData?.(plugin.manifest);
      const own: Host = documentData ? { ...shared, documentData } : shared;
      removals.push({ id, remove: plugin.activate({ editor, host: own, author, notice }) });
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
