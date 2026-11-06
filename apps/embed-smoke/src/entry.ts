// The smallest embed of Redlines: the editor core and the review interface, a stub host and no
// desktop code. It is bundled to measure the core's size (size-budget.json) and mounted in a test
// to catch the moment core code starts needing the app. It is not shipped.

import { createEditor, type Author, type Editor } from '@redlines/editor';
import { plugin as formatting } from '@redlines/formatting';
import type { Host, Plugin } from '@redlines/plugin-api';
import { createReview } from '@redlines/review';

/** A host with no capabilities: every one is optional, and a plugin degrades without it. */
const STUB_HOST: Host = {};

/** The plugins this embed activates, in order. */
export const EMBED_PLUGINS: readonly Plugin[] = [formatting];

const AUTHOR: Author = { handle: 'me', name: 'Me' };

/** Mounts the editor with the review interface on `parent`, showing `doc`. */
export function mountEmbed(parent: HTMLElement, doc: string): Editor {
  const editor = createEditor(parent, { doc, author: AUTHOR });
  // Formatting before review, as the desktop app does: Add Comment comes last in the Format menu.
  const removals = EMBED_PLUGINS.map((plugin) =>
    plugin.activate({ editor, host: STUB_HOST, author: AUTHOR, notice: () => {} }),
  );
  const review = createReview(editor, { author: AUTHOR });
  const destroy = editor.destroy.bind(editor);
  editor.destroy = () => {
    for (const remove of removals.reverse()) remove();
    review.destroy();
    destroy();
  };
  return editor;
}
