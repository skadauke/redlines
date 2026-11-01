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
