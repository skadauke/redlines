// Gzips the built embed (`vite build` writes dist/) and fails when it is over size-budget.json.
// Run through `pnpm --filter @redlines/embed-smoke size`. Raising the budget takes a deliberate
// commit that edits size-budget.json.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const root = resolve(import.meta.dirname, '..');
const dist = join(root, 'dist');
const budget = (
  JSON.parse(readFileSync(join(root, 'size-budget.json'), 'utf8')) as {
    gzipBytes: number;
  }
).gzipBytes;

// vite.config.ts pins the output to this one file. A split chunk or a renamed output must show up
// here, not slip past as a bundle that weighs nothing.
const BUNDLE = 'embed.js';
const others = existsSync(dist) ? readdirSync(dist).filter((name) => name !== BUNDLE) : [];
const file = join(dist, BUNDLE);
if (!existsSync(file) || readFileSync(file).length === 0) {
  console.error(`no embed bundle found: expected ${file}, built by \`vite build\``);
  process.exit(1);
}
if (others.length > 0) {
  console.error(`dist/ has more than ${BUNDLE} (${others.join(', ')}); the bundle was split`);
  process.exit(1);
}
const bytes = gzipSync(readFileSync(file), { level: 9 }).length;

const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
console.log(`embed bundle: ${kb(bytes)} gzipped (${bytes} bytes); budget ${kb(budget)}`);
if (bytes > budget) {
  console.error(
    `Over budget by ${kb(bytes - budget)}. Raise size-budget.json deliberately, or cut.`,
  );
  process.exit(1);
}
