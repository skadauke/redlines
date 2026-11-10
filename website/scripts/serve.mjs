// @ts-check
//
// A static server for the exported site, for the browser smoke test and for looking at the build:
//   node scripts/serve.mjs <dir> <port>
// `/` and `/x/` serve the folder's `index.html` of that path, as GitHub Pages does; a missing file
// serves `404.html` with status 404.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml; charset=utf-8',
};

const [dir = 'out', port = '4173'] = process.argv.slice(2);
const root = resolve(dir);

/** The file a path names under the root, or null. */
async function find(pathname) {
  const path = normalize(decodeURIComponent(pathname));
  const file = resolve(join(root, path));
  if (file !== root && !file.startsWith(root + sep)) return null;
  for (const candidate of [file, join(file, 'index.html')]) {
    const info = await stat(candidate).catch(() => null);
    if (info?.isFile()) return candidate;
  }
  return null;
}

createServer(async (request, response) => {
  try {
    const { pathname } = new URL(request.url ?? '/', 'http://localhost');
    const file = await find(pathname);
    const missing = file === null;
    const served = file ?? join(root, '404.html');
    const body = await readFile(served).catch(() => null);
    response.writeHead(missing ? 404 : 200, {
      'content-type': TYPES[extname(served)] ?? 'application/octet-stream',
    });
    response.end(body ?? 'Not found');
  } catch {
    response.writeHead(400).end('Bad request');
  }
}).listen(Number(port), '127.0.0.1', () => {
  console.log(`serving ${root} at http://127.0.0.1:${port}/`);
});
