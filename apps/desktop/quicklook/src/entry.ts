// What the Swift extension calls (apps/desktop/quicklook/swift): one function on the global object
// of a JavaScriptCore context, that has no Node, no browser and no `console`.

import { renderPreview } from './render.ts';

declare global {
  /** The HTML of the preview of a file: its name, its text, and whether the text is only the start
   * of a longer file. */
  var redlinesPreview: (text: string, name: string, cut?: boolean) => string;
}

globalThis.redlinesPreview = (text, name, cut) => renderPreview(text, name, cut === true);
