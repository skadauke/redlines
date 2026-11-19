import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./preferences.css', import.meta.url), 'utf8');

describe('the top bar’s tabs, chosen with the keys (#1191)', () => {
  it('look as they do under the pointer: the hover style, and no ring', () => {
    expect(css).toMatch(
      /\.rl-pref-tab:hover,\s*\.rl-pref-tab:focus-visible\s*\{[^}]*color:\s*var\(--rl-ink\)/,
    );
    const focus = /\.rl-pref-tab:focus-visible\s*\{([^}]*)\}/g;
    for (const match of css.matchAll(focus)) expect(match[1]).not.toMatch(/box-shadow|border/);
    expect(css).not.toMatch(/\.rl-pref-tab:focus(?!-visible)/);
  });
});
