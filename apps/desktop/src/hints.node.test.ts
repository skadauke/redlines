// Every hint the app draws is one style, the notifications' grays (#684, docs/widgets.md): the
// theme's card ground, its ink and its rule, at the interface's small size. It is never the
// system's black bubble with white text. Style sources are read as files, as the interface-text
// test does, and this fails when a new hint is drawn black.

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const repo = new URL('../../../', import.meta.url);

function sources(): { file: string; code: string }[] {
  const folders = [
    'apps/desktop/src',
    'apps/website-embed/src',
    'packages/editor/src',
    ...readdirSync(new URL('plugins/', repo), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== 'themes')
      .map(({ name }) => `plugins/${name}/src`),
  ];
  return folders
    .flatMap((folder) =>
      readdirSync(new URL(`${folder}/`, repo), { recursive: true })
        .map(String)
        .filter((file) => /\.(ts|css)$/.test(file) && !/\.test\.ts$/.test(file))
        .map((file) => `${folder}/${file}`),
    )
    .map((file) => ({
      file,
      code: readFileSync(new URL(file, repo), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, ''),
    }));
}

const all = sources();
const drawnBlocks = all.flatMap(({ code }) => blocks(code));

/** Every `{ … }` that holds no other: a CSS rule, or a CodeMirror theme's rule, with its selector. */
function blocks(code: string): { selector: string; body: string }[] {
  return [...code.matchAll(/([^{}]*)\{([^{}]*)\}/g)].map(([, selector, body]) => ({
    selector: (selector ?? '').replace(/^[\s,]+/, '').trim(),
    body: body ?? '',
  }));
}

/** The first value a rule gives a property, in CSS or camelCase spelling. */
function value(body: string, property: string): string | undefined {
  const camel = property.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
  const found = new RegExp(`(?:^|[\\s;,'"])(?:${property}|${camel})['"]?\\s*:\\s*([^;\\n]+)`).exec(
    body,
  );
  return found?.[1]
    ?.trim()
    .replace(/,$/, '')
    .replace(/^['"`]|['"`]$/g, '');
}

const WHITE = /^(#fff(fff)?|white|rgba?\(\s*255[ ,]+255[ ,]+255\b.*)$/i;

/** True for a literal ground that is dark: black, near black, or a black with some see-through. */
function darkGround(ground: string): boolean {
  if (/^var\(--rl-tip/.test(ground) || /^black$/i.test(ground)) return true;
  const rgb = /^rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/i.exec(ground);
  if (rgb) return Math.max(Number(rgb[1]), Number(rgb[2]), Number(rgb[3])) < 70;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})\b/i.exec(ground)?.[1];
  if (hex) {
    const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
    return [0, 2, 4].every((at) => parseInt(full.slice(at, at + 2), 16) < 70);
  }
  return false;
}

/** The hints, by the class that draws each one. */
const HINTS = [
  '.rl-tip',
  '.rl-grip-hint',
  '.rl-toolbar-tip',
  '.rl-hint',
  '.rl-link-hint',
  '.rl-image-badge',
  '.rl-title-hint',
];

describe('hover hints', () => {
  it('no style draws light text on a black ground, or uses the retired black hint token', () => {
    const found: string[] = [];
    for (const { file, code } of all) {
      if (/var\(--rl-tip|--rl-tip:/.test(code)) found.push(`${file}: the retired black hint`);
      for (const { selector, body } of blocks(code)) {
        const ink = value(body, 'color');
        const ground = value(body, 'background-color') ?? value(body, 'background');
        if (ink && ground && WHITE.test(ink) && darkGround(ground)) {
          found.push(`${file}: ${selector} is white on ${ground}`);
        }
      }
    }
    expect(found).toEqual([]);
  });

  it('draws each hint on the theme’s card, in its ink, with its rule, at the small size', () => {
    for (const hint of HINTS) {
      const drawn = drawnBlocks.filter(({ selector }) =>
        selector.split(',').some((part) =>
          part
            .trim()
            .replace(/^['"`]/, '')
            .replace(/['"`]?\s*:\s*$/, '')
            .replace(/^&\w+\s+/, '')
            .endsWith(hint),
        ),
      );
      const rule = drawn.find(({ body }) => /var\(--rl-card/.test(body));
      expect(rule, `${hint} has no rule on the card`).toBeDefined();
      const body = rule?.body ?? '';
      expect(value(body, 'color'), hint).toMatch(/^var\(--rl-ink\b/);
      expect(body, hint).toMatch(/var\(--rl-rule\)/);
      expect(value(body, 'font-size'), hint).toMatch(/^var\(--rl-size-ui-small/);
    }
  });
});
