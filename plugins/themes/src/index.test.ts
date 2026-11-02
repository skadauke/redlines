// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { applyTheme, THEMES, TOKENS, type Appearance } from './index.ts';

// A path rather than a URL: under happy-dom, `URL` is the DOM's class, which node:fs rejects.
const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'tokens.css'), 'utf8');

/** The declarations of the block for one theme and appearance, by property name. */
function block(theme: string, appearance: Appearance): Map<string, string> {
  const selector = `[data-rl-theme='${theme}'][data-rl-appearance='${appearance}']`;
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`tokens.css has no block for ${selector}`);
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  const declarations = new Map<string, string>();
  for (const match of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    declarations.set(match[1]!, match[2]!.trim());
  }
  return declarations;
}

/** WCAG relative luminance of a #rrggbb color. */
function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** The color in OKLab, where the distance between two colors follows how different they look. */
function oklab(hex: string): [number, number, number] {
  const linear = (i: number) => {
    const c = parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = [linear(0), linear(1), linear(2)];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function difference(a: string, b: string): number {
  const [x, y] = [oklab(a), oklab(b)];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

/** The brand's red, the Track Changes pen's and the website's, and the first author color. */
const BRAND_RED: Record<Appearance, string> = { light: '#d42a1e', dark: '#ff6a5c' };

const APPEARANCES: Appearance[] = ['light', 'dark'];

describe('themes', () => {
  it('applyTheme sets attributes', () => {
    const root = document.createElement('div');
    applyTheme(root, 'book', 'dark');
    expect(root.getAttribute('data-rl-theme')).toBe('book');
    expect(root.getAttribute('data-rl-appearance')).toBe('dark');

    applyTheme(root, 'editorial', 'light');
    expect(root.getAttribute('data-rl-theme')).toBe('editorial');
    expect(root.getAttribute('data-rl-appearance')).toBe('light');
  });

  it('every theme defines every token', () => {
    for (const { name } of THEMES) {
      for (const appearance of APPEARANCES) {
        const declared = block(name, appearance);
        const missing = TOKENS.filter((token) => !declared.has(token));
        expect(missing, `${name} ${appearance}`).toEqual([]);
      }
    }
  });

  it('author colors meet 4.5:1', () => {
    for (const { name } of THEMES) {
      for (const appearance of APPEARANCES) {
        const declared = block(name, appearance);
        const page = declared.get('--rl-page')!;
        expect(page).toMatch(/^#[0-9a-f]{6}$/);
        for (let n = 1; n <= 8; n++) {
          const color = declared.get(`--rl-author-${n}`)!;
          expect(color).toMatch(/^#[0-9a-f]{6}$/);
          expect(contrast(color, page), `${name} ${appearance} author ${n}`).toBeGreaterThanOrEqual(
            4.5,
          );
        }
      }
    }
  });

  it('the first author color, yours, is the brand red in every theme', () => {
    for (const { name } of THEMES) {
      for (const appearance of APPEARANCES) {
        const declared = block(name, appearance);
        expect(declared.get('--rl-author-1'), `${name} ${appearance}`).toBe(BRAND_RED[appearance]);
      }
    }
  });

  it('every tint is its color at 17%', () => {
    for (const { name } of THEMES) {
      for (const appearance of APPEARANCES) {
        const declared = block(name, appearance);
        for (let n = 1; n <= 8; n++) {
          const [r, g, b] = [1, 3, 5].map((at) =>
            parseInt(declared.get(`--rl-author-${n}`)!.slice(at, at + 2), 16),
          );
          expect(declared.get(`--rl-author-${n}-tint`), `${name} ${appearance} author ${n}`).toBe(
            `rgb(${r} ${g} ${b} / 0.17)`,
          );
        }
      }
    }
  });

  it('no author color is close to another, the red included', () => {
    // The closest pairs sit just above 0.08 apart. Keep that floor, so a
    // color added or changed later doesn't land next to one that is already there.
    for (const { name } of THEMES) {
      for (const appearance of APPEARANCES) {
        const declared = block(name, appearance);
        for (let a = 1; a <= 8; a++) {
          for (let b = a + 1; b <= 8; b++) {
            const [first, second] = [
              declared.get(`--rl-author-${a}`)!,
              declared.get(`--rl-author-${b}`)!,
            ];
            expect(
              difference(first, second),
              `${name} ${appearance} authors ${a} and ${b}`,
            ).toBeGreaterThanOrEqual(0.08);
          }
        }
      }
    }
  });
});
