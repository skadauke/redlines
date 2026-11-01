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
});
