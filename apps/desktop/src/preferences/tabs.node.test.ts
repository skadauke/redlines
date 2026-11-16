import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./preferences.css', import.meta.url), 'utf8');

describe('the tabs’ focus ring', () => {
  it('is drawn for :focus-visible only, never for a plain :focus', () => {
    expect(css).toMatch(/\.rl-pref-tab:focus-visible\s*\{[^}]*box-shadow/);
    expect(css).not.toMatch(/\.rl-pref-tab:focus(?!-visible)/);
  });
});
