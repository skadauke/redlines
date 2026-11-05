// Gzips the built embed (`vite build` writes dist/) and fails when it is over size-budget.json.
// Run through `pnpm --filter @redlines/embed-smoke size`. Raising the budget takes a deliberate
// commit that edits size-budget.json.

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const root = resolve(import.meta.dirname, '..');
const dist = join(root, 'dist');
const budget = (
  JSON.parse(readFileSync(join(root, 'size-budget.json'), 'utf8')) as {
    gzipBytes: number;
  }
).gzipBytes;

const files = readdirSync(dist).filter((name) => name.endsWith('.js'));
const bytes = files.reduce(
  (sum, name) => sum + gzipSync(readFileSync(join(dist, name)), { level: 9 }).length,
  0,
);

const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
console.log(`embed bundle: ${kb(bytes)} gzipped (${bytes} bytes); budget ${kb(budget)}`);
if (bytes > budget) {
  console.error(
    `Over budget by ${kb(bytes - budget)}. Raise size-budget.json deliberately, or cut.`,
  );
  process.exit(1);
}
