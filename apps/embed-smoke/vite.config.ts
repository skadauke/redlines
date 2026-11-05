import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// The embed as a host would bundle it: one entry, minified. Fonts and language grammars are
// loaded on demand and stay out of the measurement.
export default defineConfig({
  build: {
    lib: {
      entry: resolve(import.meta.dirname, 'src/entry.ts'),
      formats: ['es'],
      fileName: () => 'embed.js',
    },
    minify: true,
    emptyOutDir: true,
    rollupOptions: {
      // Deliberate: fonts and language grammars load on demand, so they stay out of the budget.
      external: [
        /\.(woff2?|ttf|otf)$/,
        /^@codemirror\/lang-(?!markdown$)/,
        /^@codemirror\/legacy-modes/,
      ],
    },
  },
});
