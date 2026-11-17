// Bundles what the Finder thumbnail extension runs in JavaScriptCore, as rolldown.config.mjs does
// the preview's: the Clean view's blocks (src/thumbnail.ts), with the format library and nothing
// else. `scripts/build-quicklook` in apps/desktop runs both.

import { defineConfig } from 'rolldown';

export default defineConfig({
  input: 'src/thumbnail-entry.ts',
  platform: 'neutral',
  output: {
    file: 'build/thumbnail.js',
    format: 'iife',
    minify: true,
  },
});
