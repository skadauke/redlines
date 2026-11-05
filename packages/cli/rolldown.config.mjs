// Bundles the command line's logic into one script for the native `redlines` program, which runs it
// in QuickJS (apps/desktop/redlines). `scripts/build-redlines` in apps/desktop runs this.

import { defineConfig } from 'rolldown';

export default defineConfig({
  input: 'src/quickjs-entry.ts',
  // Neither Node nor a browser: QuickJS, with only what the program defines.
  platform: 'neutral',
  output: {
    file: '../../apps/desktop/redlines/bundle/redlines.js',
    format: 'iife',
    minify: true,
  },
});
