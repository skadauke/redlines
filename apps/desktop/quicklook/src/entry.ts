// What the Swift extension calls (apps/desktop/quicklook/swift): two functions on the global object
// of a JavaScriptCore context, that has no Node, no browser and no `console`.

import { previewImages, renderPreview } from './render.ts';

declare global {
  /** The HTML of the preview of a file: its text, its name, whether the text is only the start of a
   * longer file, and the local images that the extension loaded, as JSON from the path that the
   * document wrote to the name to show it by (`{"images/a.png": "img-0"}`). */
  var redlinesPreview: (text: string, name: string, cut?: boolean, images?: string) => string;
  /** The local images that the preview of a file would draw, as JSON: an array of the paths that the
   * document wrote, for the extension to load those it may. */
  var redlinesImages: (text: string, cut?: boolean) => string;
}

/** The images as the host wrote them, or none, should it have written nonsense. */
function loaded(json: string | undefined): Map<string, string> {
  const images = new Map<string, string>();
  if (json === undefined || json === '') return images;
  try {
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed === 'object' && parsed !== null) {
      for (const [path, name] of Object.entries(parsed)) {
        if (typeof name === 'string') images.set(path, name);
      }
    }
  } catch {
    // Nonsense is no images.
  }
  return images;
}

globalThis.redlinesPreview = (text, name, cut, images) =>
  renderPreview(text, name, cut === true, loaded(images));
globalThis.redlinesImages = (text, cut) => JSON.stringify(previewImages(text, cut === true));
