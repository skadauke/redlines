import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('print.css', () => {
  const css = readFileSync(new URL('./print.css', import.meta.url), 'utf8');
  const print = css.slice(css.indexOf('@media print'));

  it('shows the container on paper only, and nothing else of the window', () => {
    expect(css).toMatch(/^#rl-print\s*\{\s*display: none;/m);
    expect(print).toMatch(/body > :not\(#rl-print\)\s*\{\s*display: none !important;/);
    expect(print).toMatch(/#rl-print\s*\{\s*display: block;/);
  });

  it('prints black on white at 11 pt, whatever the theme', () => {
    expect(print).toMatch(/background: #ffffff !important/);
    expect(print).toContain('color-scheme: light');
    expect(print).toContain('font-size: 14.67px');
    // The theme's face, not a dark theme's colors.
    expect(print).toContain('font-family: var(--rl-font-body');
    expect(print).not.toMatch(/var\(--rl-(?:ink|page|tint|rule)/);
  });

  it('keeps headings with what follows, rows and images whole, and wraps code and tables', () => {
    expect(print).toMatch(/h6\s*\{[^}]*break-after: avoid/);
    expect(print).toMatch(/#rl-print tr\s*\{\s*display: flex;\s*break-inside: avoid/);
    expect(print).toMatch(/#rl-print img\s*\{[^}]*max-width: 100%/);
    expect(print).toMatch(/#rl-print pre\s*\{[^}]*white-space: pre-wrap/);
    expect(print).toMatch(/#rl-print tbody\s*\{[^}]*width: 100%/);
  });
});
