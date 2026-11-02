// The look is in styles.css, which no test renders. These read it as a file, because tests don't
// process CSS, and check the rules of color that it keeps: color means a person, and red, the
// app's own, is the Track Changes pen's alone (design §5.4, §6.6).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** The style sheet's rules as selector and declarations (it has no nested rules but @media). */
function rules(css: string): { selector: string; declarations: string }[] {
  const uncommented = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...uncommented.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, declarations]) => ({
    selector: (selector ?? '').trim(),
    declarations: (declarations ?? '').trim(),
  }));
}

const all = rules(readFileSync(new URL('./styles.css', import.meta.url), 'utf8'));

describe('styles.css', () => {
  it('finds its rules', () => {
    expect(all.length).toBeGreaterThan(50);
  });

  it('uses red only for the Track Changes pen', () => {
    const red = all.filter(({ declarations }) => /--rl-red|#d42a1e/i.test(declarations));
    expect(red.map(({ selector }) => selector)).toEqual([
      '.rl-pen-on',
      '.rl-menu-item .rl-menu-icon.rl-pen-on',
    ]);
  });

  it('draws notifications in the grays that every theme has, light and dark', () => {
    const cards = all.filter(({ selector }) => selector.includes('.rl-notification'));
    expect(cards.length).toBeGreaterThan(8);
    const used = new Set<string>();
    for (const { selector, declarations } of cards) {
      // No color of their own: only the theme's tokens, so they follow the theme and appearance.
      expect(declarations, selector).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
      for (const [, token] of declarations.matchAll(/var\((--rl-[a-z0-9-]+)/g)) {
        if (token) used.add(token);
      }
    }
    // Grays: neither the pen's red nor a person's color.
    expect([...used].filter((token) => /red|author|mixed/.test(token))).toEqual([]);
    expect(used).toContain('--rl-card');

    const tokens = readFileSync(
      new URL('../../../plugins/themes/src/tokens.css', import.meta.url),
      'utf8',
    );
    const themes = [
      ...tokens.matchAll(
        /\[data-rl-theme='([a-z]+)'\]\[data-rl-appearance='(light|dark)'\]\s*\{([^}]*)\}/g,
      ),
    ];
    expect(new Set(themes.map(([, , appearance]) => appearance))).toEqual(
      new Set(['light', 'dark']),
    );
    for (const [, theme, appearance, body] of themes) {
      for (const token of used) expect(body, `${theme}, ${appearance}`).toContain(`${token}:`);
    }
  });

  it('draws the Track Changes switch in the ink colors, on and off', () => {
    const track = all.filter(({ selector }) => /\.rl-switch$/.test(selector));
    expect(track.map(({ selector }) => selector)).toEqual([
      '.rl-switch',
      ".rl-menu-item[aria-checked='true'] .rl-switch",
    ]);
    for (const { declarations } of track) {
      expect(declarations).toMatch(/background:\s*var\(--rl-ink(-\d)?\)/);
    }
  });
});
