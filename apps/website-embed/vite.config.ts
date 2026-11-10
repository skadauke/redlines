import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// The demos' bundle for the website: one hashed ES module, its stylesheet and four fonts, written
// into the site's public folder (git-ignored; CI builds it). An app entry, not `build.lib`, which
// would keep the whitespace and cost about 35 KB gzipped. Nothing is external: the page needs the
// grammars that @codemirror/lang-markdown imports at load.
const here = import.meta.dirname;

export default defineConfig({
  // Every URL the bundle and its stylesheet hold (the fonts) is relative to the file, so one build
  // works under `/` and under a Pages base path.
  base: './',
  build: {
    outDir: resolve(here, '../../website/public/embed'),
    emptyOutDir: true,
    target: ['es2022', 'safari16'],
    minify: true,
    manifest: 'manifest.json',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      input: resolve(here, 'src/index.ts'),
      preserveEntrySignatures: 'strict',
      output: {
        entryFileNames: 'redlines-embed-[hash].js',
        assetFileNames: (asset) =>
          asset.names.some((name) => name.endsWith('.woff2'))
            ? 'fonts/[name]-[hash][extname]'
            : 'redlines-embed-[hash][extname]',
      },
    },
  },
});
