// What the Swift thumbnail extension calls (apps/desktop/quicklook/swift): one function on the
// global object of a JavaScriptCore context, as the preview's is (entry.ts).

import { thumbnailBlocks } from './thumbnail.ts';

declare global {
  /** The blocks of the thumbnail of a file, as JSON: the file's text. */
  var redlinesThumbnail: (text: string) => string;
}

globalThis.redlinesThumbnail = (text) => JSON.stringify(thumbnailBlocks(text));
