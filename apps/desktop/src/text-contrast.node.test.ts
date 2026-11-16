// Text a person has to read keeps 4.5:1 (#578). --rl-ink-3, the tertiary gray, is under that on the
// page in every theme, and WCAG exempts only the text of inactive controls: so --rl-ink-3 may color
// a disabled control's text and a decorative glyph, and nothing else. Hints, placeholders,
// captions, timestamps, empty states and the labels of controls at rest are --rl-ink-2 (which
// plugins/themes holds to 4.5:1 on the page, the tint and the card) or darker. The style sources
// are read as files, because tests don't process CSS, as interface-text.node.test.ts does for sizes.

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const repo = new URL('../../../', import.meta.url);

/** Selectors whose text is decorative, not read: a glyph that is drawn, never a word. */
const DECORATIVE = new Set([
  // The + that a table's row or column shows between two others (plugins/tables).
  '.rl-plus, .rl-col-plus',
]);

function sources(): string[] {
  const folders = [
    'apps/desktop/src',
    'apps/desktop/quicklook/src',
    'apps/website-embed/src',
    'packages/editor/src',
    ...readdirSync(new URL('plugins/', repo), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== 'themes')
      .map(({ name }) => `plugins/${name}/src`),
  ];
  return folders.flatMap((folder) =>
    readdirSync(new URL(`${folder}/`, repo), { recursive: true })
      .map(String)
      .filter((file) => /\.(ts|css)$/.test(file) && !/\.test\.ts$/.test(file))
      .map((file) => `${folder}/${file}`),
  );
}

/** The selector of the rule that holds the declaration at `at`: the text before its `{`. */
function selectorAt(code: string, at: number): string {
  const open = code.lastIndexOf('{', at);
  const start = Math.max(code.lastIndexOf('}', open), code.lastIndexOf(';', open), -1) + 1;
  const before = code.slice(start, open);
  // A selector in a style object ends in a quote and a colon, a style sheet's in nothing.
  return before
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/^[\s,]*['"`]?/, '')
    .replace(/['"`]?\s*:?\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Every rule that sets a text color (`color`, `fill`, `-webkit-text-fill-color`, quoted or not, in
 * a style sheet or a style object) to something that holds --rl-ink-3, not a border's, an
 * outline's or a background's: the selector of each.
 */
function inkThreeText(code: string): string[] {
  const found: string[] = [];
  const text = /(?<![\w-])['"`]?(?:color|fill|-webkit-text-fill-color)['"`]?\s*:\s*([^;}\n]*)/g;
  for (const match of code.matchAll(text)) {
    if (/--rl-ink-3\b/.test(match[1] ?? '')) found.push(selectorAt(code, match.index));
  }
  return found;
}

/** Whether every selector of a list is a disabled control, as `.x:disabled` is (not `:not(:disabled)`). */
function disabledOnly(selector: string): boolean {
  return selector
    .split(/,(?![^(]*\))/)
    .every(
      (part) =>
        /(?::disabled|\[aria-disabled="true"\])(?:\s+[\w.#\-\s>]*)?$/.test(part.trim()) &&
        !/:not\(/.test(part),
    );
}

describe('text contrast (#578)', () => {
  const all = sources()
    .map((file) => ({
      file,
      code: readFileSync(new URL(file, repo), 'utf8'),
      uses: [] as string[],
    }))
    .map((source) => ({ ...source, uses: inkThreeText(source.code) }));

  it('reads the style sources, and finds the disabled controls that keep the tertiary gray', () => {
    const uses = all.flatMap(({ file, uses }) => uses.map((selector) => `${file}: ${selector}`));
    expect(uses.length).toBeGreaterThan(5);
    expect(uses).toContain('apps/desktop/src/styles.css: .rl-menu-item:disabled');
    expect(uses).toContain('plugins/palette/src/styles.ts: .rl-palette-item:disabled');
  });

  it('colors text with --rl-ink-3 only in a disabled control or a decorative glyph', () => {
    const wrong = all.flatMap(({ file, uses }) =>
      uses
        .filter((selector) => !disabledOnly(selector) && !DECORATIVE.has(selector))
        .map((selector) => `${file}: ${selector}`),
    );
    expect(
      wrong,
      `--rl-ink-3 is under 4.5:1; use --rl-ink-2 for text to be read:\n${wrong.join('\n')}`,
    ).toEqual([]);
  });

  it('takes a control grayed with aria-disabled as disabled, and only that attribute set to true', () => {
    expect(disabledOnly('.g[aria-disabled="true"] svg')).toBe(true);
    expect(disabledOnly('.g[aria-disabled="true"], .h')).toBe(false);
    expect(disabledOnly('.g[aria-disabled="false"]')).toBe(false);
  });

  it('reads the shapes a rule can take, and is not fooled by a disabled selector beside another', () => {
    const css =
      '.a { color: var(--rl-ink-3); }\n.b, .c:disabled { color: var(--rl-ink-3); }\n.d:not(:disabled) { fill: color-mix(in srgb, var(--rl-ink-3) 50%, red); }\n.e:disabled svg { color: var(--rl-ink-3, gray); }\n.f { border-color: var(--rl-ink-3); background-color: var(--rl-ink-3); }';
    const uses = inkThreeText(css);
    expect(uses).toEqual(['.a', '.b, .c:disabled', '.d:not(:disabled)', '.e:disabled svg']);
    expect(uses.filter((selector) => !disabledOnly(selector))).toEqual([
      '.a',
      '.b, .c:disabled',
      '.d:not(:disabled)',
    ]);
  });

  // A focus ring is a shape: WCAG 1.4.11 asks 3:1 of it. The grays that hold that on the page, the
  // tint and the card in every theme are --rl-ink-3 and the inks above it (plugins/themes tests); a
  // ring in --rl-rule, --rl-syntax or --rl-mixed would be under it (#653).
  it('draws every outline in --rl-ink-3 or darker, or in none', () => {
    const wrong = all.flatMap(({ file, code }) =>
      [...code.matchAll(/(?<![\w-])outline(?:-color)?\s*:\s*['"`]?([^;}\n]*)/g)]
        .map(([, value = '']) => value.trim().replace(/['"`,]+$/, ''))
        .filter((value) => /^(?:\d|var\(|#|rgb)/.test(value))
        .filter((value) => !/^(none|0)\b/.test(value) && !/var\(--rl-ink(?:-[23])?\)/.test(value))
        .map((value) => `${file}: outline ${value}`),
    );
    expect(wrong, `focus rings under 3:1:\n${wrong.join('\n')}`).toEqual([]);
  });

  // The rings drawn as an inset shadow (a menu item's, a tab's, the sidebar's current file) are the
  // same shapes: in a gray that holds 3:1 on every ground, the pressed and the rule's as well.
  it('draws every inset ring of a shadow in --rl-ink-3 or darker', () => {
    const wrong = all.flatMap(({ file, code }) =>
      [...code.matchAll(/box-shadow\s*:\s*['"`]?inset\s+0\s+0\s+0\s+\d+px\s+([^;}\n]*)/g)]
        .map(([, value = '']) => value.trim().replace(/['"`,]+$/, ''))
        .filter((value) => !/^var\(--rl-ink(?:-[23])?\b/.test(value))
        .map((value) => `${file}: inset ring ${value}`),
    );
    expect(wrong, `rings under 3:1:\n${wrong.join('\n')}`).toEqual([]);
  });
});
