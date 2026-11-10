// The interface's text is never too small to read (#163). Every size of text that the app draws
// around the document (its windows, menus, notices and notifications, the margin notes and cards,
// the review and find bars) is one of the theme's interface sizes, which keep to the floors of
// 13 px for interface text and 12 px for captions, timestamps and hints (plugins/themes), or a
// size of its own of at least 13 px. A size relative to its surroundings, in em or %, could go
// under the floor, and so could one multiplied by the text size outside the theme's tokens. The
// style sheets are read as files, because tests don't process CSS. The document's own sizes are
// the theme's and the person's (packages/editor), and are not checked here.

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const repo = new URL('../../../', import.meta.url);

/** The interface's sizes, from the theme's tokens: they are tested against the floors there. */
const TOKENS = new Set([
  'var(--rl-size-ui)',
  'var(--rl-size-ui-small)',
  'var(--rl-size-ui-scaled)',
  'var(--rl-size-ui-small-scaled)',
  // The frame's, worked out from the window zoom (zoom.css).
  'var(--rl-size-ui-frame)',
  'var(--rl-size-ui-small-frame)',
]);

/** The least size of interface text. */
const FLOOR = 13;

/** Every style source of the app, of its plugins and of the website's embed, but the themes' own tokens. */
function sources(): string[] {
  const folders = [
    'apps/desktop/src',
    'apps/website-embed/src',
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

/** The sizes a source gives text: its `font-size`s, and its `font` shorthands. */
function sizes(text: string): { sizes: string[]; shorthands: string[] } {
  const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const value = (raw: string) => raw.trim().replace(/^['"`]|['"`],?$/g, '');
  return {
    sizes: [...code.matchAll(/(?:font-size|fontSize)\s*:\s*([^;}\n]+)/g)].map(([, raw]) =>
      value(raw ?? ''),
    ),
    shorthands: [...code.matchAll(/(?<![\w-])font\s*:\s*([^;}\n]+)/g)].map(([, raw]) =>
      value(raw ?? ''),
    ),
  };
}

const all = sources().map((file) => ({
  file,
  ...sizes(readFileSync(new URL(file, repo), 'utf8')),
}));

describe('interface text', () => {
  it('finds the style sheets of the windows, the review interface and the find bar', () => {
    const sized = all.filter(({ sizes }) => sizes.length > 0).map(({ file }) => file);
    expect(sized).toEqual(
      expect.arrayContaining([
        'apps/desktop/src/styles.css',
        'apps/desktop/src/preferences/preferences.css',
        'apps/desktop/src/install/question.css',
        'plugins/review/src/styles.ts',
        'plugins/find/src/styles.ts',
        'plugins/formatting/src/link-popover.ts',
        'plugins/agents/src/picker.ts',
        'plugins/agents/src/live-line.ts',
      ]),
    );
    expect(all.flatMap(({ sizes }) => sizes).length).toBeGreaterThan(30);
  });

  it('is never under 13 px, or 12 px for a secondary line, at any text size', () => {
    for (const { file, sizes } of all) {
      for (const size of sizes) {
        if (TOKENS.has(size)) continue;
        const px = /^(\d+(?:\.\d+)?)px$/.exec(size);
        expect(px, `${file}: font-size ${size}`).not.toBeNull();
        expect(Number(px?.[1]), `${file}: font-size ${size}`).toBeGreaterThanOrEqual(FLOOR);
      }
    }
  });

  it('gives no size in a font shorthand', () => {
    for (const { file, shorthands } of all) {
      for (const shorthand of shorthands) expect(shorthand, file).toBe('inherit');
    }
  });

  it("keeps the frame's text at the interface's sizes or larger, in points, at every zoom from 100%", () => {
    const css = readFileSync(new URL('apps/desktop/src/zoom.css', repo), 'utf8')
      // Prettier may wrap a long value.
      .replace(/\s+/g, ' ')
      .replace(/\( /g, '(')
      .replace(/ \)/g, ')');
    const formula = (token: string, size: string) =>
      `${token}: calc(var(${size}) * min(var(--rl-zoom), 1.5) / var(--rl-zoom));`;
    expect(css).toContain(formula('--rl-size-ui-frame', '--rl-size-ui'));
    expect(css).toContain(formula('--rl-size-ui-small-frame', '--rl-size-ui-small'));
    // The formula, in points: the size in CSS px times the zoom, which WebKit draws it at.
    const frame = (size: number, zoom: number) => size * (Math.min(zoom, 1.5) / zoom) * zoom;
    for (const zoom of [1, 1.1, 1.25, 1.5, 1.75, 2]) {
      for (const size of [14, 13]) {
        expect(frame(size, zoom), `${size} px at ${zoom}`).toBeGreaterThanOrEqual(size - 1e-9);
      }
    }
    expect(frame(14, 2)).toBeCloseTo(21, 9);
  });
});
