// The bundle rule: `@redlines/word` is for the desktop app's File commands and the CLI. The editor,
// the plugins and the website's embed never import it, so that the embed's size budgets don't move.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const GUARDED = [
  'packages/editor',
  'packages/plugin-api',
  'apps/embed-smoke',
  'apps/website-embed',
  ...readdirSync(`${ROOT}plugins`)
    .filter((name) => statSync(`${ROOT}plugins/${name}`).isDirectory())
    .map((name) => `plugins/${name}`),
];

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const path = `${dir}/${name}`;
    if (statSync(path).isDirectory()) out.push(...files(path));
    else if (/\.(ts|tsx|js|mjs|json|css)$/.test(name)) out.push(path);
  }
  return out;
}

describe('the bundle rule', () => {
  it('keeps @redlines/word out of the editor, the plugins and the website embed', () => {
    const reaching: string[] = [];
    for (const place of GUARDED) {
      for (const file of files(`${ROOT}${place}`)) {
        if (readFileSync(file, 'utf8').includes('@redlines/word')) reaching.push(file);
      }
    }
    expect(reaching).toEqual([]);
  });
});
