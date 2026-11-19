// Gzips the built embed (`vite build` writes dist/) and fails when it is over size-budget.json.
// Run through `pnpm --filter @redlines/embed-smoke size`. Raising the budget takes a deliberate
// commit that edits size-budget.json.
//
// On an Epic's integration branch, and on a pull request into one, CI sets REDLINES_SIZE=epic and
// the bundle may go past the budget by the file's `epicAllowanceBytes`, with a warning. The
// Epic's lanes land in parallel, each measured against the branch it last ran on, so a budget
// that each of them must stay under fails them in turn as the others land. The one pull request
// from the Epic to main is held to the budget itself, which the Epic's final sweep sets to what
// the Epic measures.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const root = resolve(import.meta.dirname, '..');
const dist = join(root, 'dist');
const { gzipBytes: budget, epicAllowanceBytes } = JSON.parse(
  readFileSync(join(root, 'size-budget.json'), 'utf8'),
) as { gzipBytes: number; epicAllowanceBytes: number };
const epic = process.env.REDLINES_SIZE === 'epic';
const limit = budget + (epic ? epicAllowanceBytes : 0);

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
const most = epic ? `, and ${kb(limit)} (${limit} bytes) on an Epic's branch` : '';
console.log(
  `embed bundle: ${kb(bytes)} gzipped (${bytes} bytes); budget ${kb(budget)} (${budget} bytes)${most}`,
);
if (bytes > limit) {
  const what = epic ? "the budget and the Epic's allowance" : 'budget';
  console.error(
    `Over ${what} by ${kb(bytes - limit)} (${bytes - limit} bytes). Raise size-budget.json deliberately, or cut.`,
  );
  process.exit(1);
}
if (bytes > budget) {
  // A GitHub annotation: the run passes, and the pull request shows the warning.
  console.log(
    `::warning title=Embed size::${bytes - budget} bytes over the budget, within the Epic's allowance; the Epic's final sweep sets the budget to what it measures.`,
  );
}
