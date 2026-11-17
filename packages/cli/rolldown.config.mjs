// Bundles the command line's logic into scripts for the native `redlines` program, which runs them
// in QuickJS (apps/desktop/redlines). `scripts/build-redlines` in apps/desktop runs this.
// `redlines.js` is every command; `word.js` is `@redlines/word`, which the program evaluates only
// for `import-docx` and `export-docx`.

import { defineConfig } from 'rolldown';

// Neither Node nor a browser: QuickJS, with only what the program defines.
const platform = 'neutral';

export default defineConfig([
  {
    input: 'src/quickjs-entry.ts',
    platform,
    output: {
      file: '../../apps/desktop/redlines/bundle/redlines.js',
      format: 'iife',
      minify: true,
    },
  },
  {
    input: 'src/quickjs-word.ts',
    platform,
    output: { file: '../../apps/desktop/redlines/bundle/word.js', format: 'iife', minify: true },
  },
]);
