// Bundles the renderer into one script for the Quick Look extension, which runs it in
// JavaScriptCore (apps/desktop/quicklook/swift). `scripts/build-quicklook` in apps/desktop runs this.
// Neither Node nor a browser: a context with only the language, as the `redlines` program's.

import { readFileSync } from 'node:fs';
import { defineConfig } from 'rolldown';

/**
 * A module id with a query, `file?raw` or `file?inline`, as its file and its kind.
 * @param {string} id
 */
function queried(id) {
  const found = /^(.*)\?(raw|inline)$/.exec(id);
  const file = found?.[1];
  const kind = found?.[2];
  return file && kind ? { file, kind } : null;
}

/**
 * `?raw` is a file's text and `?inline` a data URL of its bytes, as Vite reads them, which is what
 * the tests run through.
 * @type {import('rolldown').Plugin}
 */
const assets = {
  name: 'assets',
  async resolveId(source, importer, options) {
    const found = queried(source);
    if (!found) return null;
    const resolved = await this.resolve(found.file, importer, options);
    return resolved ? { id: `${resolved.id}?${found.kind}` } : null;
  },
  load(id) {
    const found = queried(id);
    if (!found) return null;
    const bytes = readFileSync(found.file);
    if (found.kind === 'raw') return `export default ${JSON.stringify(bytes.toString('utf8'))};`;
    const type = found.file.endsWith('.woff2') ? 'font/woff2' : 'application/octet-stream';
    return `export default ${JSON.stringify(`data:${type};base64,${bytes.toString('base64')}`)};`;
  },
};

export default defineConfig({
  input: 'src/entry.ts',
  // The packages are bundled for a context that has neither Node's nor a browser's conditions.
  platform: 'neutral',
  plugins: [assets],
  output: {
    file: 'build/preview.js',
    format: 'iife',
    minify: true,
  },
});
