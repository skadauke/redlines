// The column may be narrower than the widest thing in it (#390). At 400% a table's cells can't fit
// the column, and the table scrolls in its own box; if the column keeps a minimum width, the page
// scrolls sideways instead. `theme.test.ts` holds the editor's own entry, but a rule of another
// source that wins by specificity would go unseen, so every style source of the app, its plugins
// and the editor is read for a rule of the `.cm-content` that sets a minimum width above zero.
// The real layout is checked in the app by `zoom-check.ts` (`nothing-spills-at-the-largest-sizes`).

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const repo = new URL('../../../', import.meta.url);

function sources(): string[] {
  const folders = [
    'apps/desktop/src',
    'apps/website-embed/src',
    'packages/editor/src',
    ...readdirSync(new URL('plugins/', repo), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map(({ name }) => `plugins/${name}/src`),
  ];
  return folders.flatMap((folder) =>
    readdirSync(new URL(`${folder}/`, repo), { recursive: true })
      .map(String)
      .filter((file) => /\.(ts|css)$/.test(file) && !/\.test\.ts$/.test(file))
      .map((file) => `${folder}/${file}`),
  );
}

/** The `min-width` values given by rules whose selector names `.cm-content`. */
function minWidths(text: string): string[] {
  const code = text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    // A template's `${...}` holes would end a rule early.
    .replace(/\$\{[^{}]*\}/g, 'X');
  const found: string[] = [];
  for (const [, selector, body] of code.matchAll(/([^{}]*\.cm-content[^{}]*)\{([^{}]*)\}/g)) {
    // A rule for something inside the column (`.cm-content .x`) is not the column's own.
    const own = (selector ?? '')
      .split(',')
      .some((one) => /(^|[\s'"`])\.cm-content\s*(['"`:.[>+~]|$)/.test(one.trim()));
    if (!own) continue;
    for (const [, value] of (body ?? '').matchAll(
      /(?:min-width|minWidth|min-inline-size|minInlineSize)\s*:\s*([^;,}\n]+)/g,
    )) {
      found.push((value ?? '').trim().replace(/^['"`]|['"`]$/g, ''));
    }
  }
  return found;
}

describe('the column keeps no minimum width', () => {
  it('sets no min-width on .cm-content that is not zero, in any style source', () => {
    const all = sources().flatMap((file) =>
      minWidths(readFileSync(new URL(file, repo), 'utf8')).map((value) => `${file}: ${value}`),
    );
    expect(all.filter((line) => !/: 0(px|em|rem|%)?( !important)?$/.test(line))).toEqual([]);
  });

  it('finds the rule it looks for (the reader reads the editor theme)', () => {
    const theme = readFileSync(new URL('packages/editor/src/preview/theme.ts', repo), 'utf8');
    expect(minWidths(theme)).toContain('0');
    expect(minWidths("'.cm-content': { minWidth: '40em' }")).toEqual(['40em']);
  });
});
