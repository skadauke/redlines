// Gzips the built bundle and its stylesheet, adds up its fonts, and fails when one is over
// size-budget.json. `vite build` writes website/public/embed/ with a manifest. Run through
// `pnpm --filter @redlines/website-embed size`; the site's `npm run embed:check` runs the same
// script. Raising a budget takes a deliberate commit that edits size-budget.json.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const root = resolve(import.meta.dirname, '..');
const out = resolve(root, '../../website/public/embed');

const fail = (message: string): never => {
  console.error(message);
  process.exit(1);
};

const budget = JSON.parse(readFileSync(join(root, 'size-budget.json'), 'utf8')) as {
  jsGzipBytes: number;
  cssGzipBytes: number;
  fontBytes: number;
};

const manifestFile = join(out, 'manifest.json');
if (!existsSync(manifestFile))
  fail(`no manifest: expected ${manifestFile}, built by \`vite build\``);
const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as Record<
  string,
  { file: string; css?: string[]; isEntry?: boolean }
>;
const entry = Object.values(manifest).find((chunk) => chunk.isEntry);
const js = entry?.file;
const css = entry?.css?.[0];
if (!js || !css) fail('the manifest has no entry with a script and a stylesheet');

const scripts = readdirSync(out).filter((name) => name.endsWith('.js'));
if (scripts.length !== 1) fail(`the bundle was split: ${scripts.join(', ') || 'no .js file'}`);
const fontFiles = existsSync(join(out, 'fonts')) ? readdirSync(join(out, 'fonts')) : [];
const old = [...readdirSync(out), ...fontFiles].filter((name) => name.endsWith('.woff'));
if (old.length > 0) fail(`a .woff file ships: ${old.join(', ')}; only woff2 is for this bundle`);

const gzipped = (name: string) => gzipSync(readFileSync(join(out, name)), { level: 9 }).length;
const fonts = fontFiles
  .filter((name) => name.endsWith('.woff2'))
  .reduce((sum, name) => sum + statSync(join(out, 'fonts', name)).size, 0);

const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
let over = 0;
const check = (label: string, what: string, bytes: number, limit: number) => {
  console.log(`${label} ${kb(bytes)} ${what} (${bytes} bytes); budget ${kb(limit)}`);
  if (bytes > limit) {
    over++;
    console.error(
      `Over budget by ${kb(bytes - limit)}. Raise size-budget.json deliberately, or cut.`,
    );
  }
};
check('js', 'gzipped', gzipped(js!), budget.jsGzipBytes);
check('css', 'gzipped', gzipped(css!), budget.cssGzipBytes);
check('fonts', 'as served', fonts, budget.fontBytes);
if (over > 0) process.exit(1);
