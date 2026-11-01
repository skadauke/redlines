// The look of the install question is in question.css, which no test renders. These read it as a
// file, because tests don't process CSS, and check what it keeps to: the theme's tokens for every
// color (so that the question is right in light and dark, in every theme), no red (the Track
// Changes pen's), the app's own quiet buttons and not a black one, and a question on one line.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** The style sheet's rules as selector and declarations (it has no nested rules). */
function rules(css: string): { selector: string; declarations: string }[] {
  const uncommented = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...uncommented.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, declarations]) => ({
    selector: (selector ?? '').trim().replace(/\s+/g, ' '),
    declarations: (declarations ?? '').trim().replace(/\s+/g, ' '),
  }));
}

const sheet = readFileSync(new URL('./question.css', import.meta.url), 'utf8');
const all = rules(sheet);

/** The declarations of the rule for exactly this selector. */
function declarationsOf(selector: string): string {
  const found = all.filter((rule) => rule.selector === selector);
  expect(found, selector).toHaveLength(1);
  return found[0]?.declarations ?? '';
}

describe('question.css', () => {
  it('finds its rules', () => {
    expect(all.length).toBeGreaterThan(10);
  });

  it('takes every color from the theme, and no red', () => {
    const uncommented = sheet.replace(/\/\*[\s\S]*?\*\//g, '');
    // No color of its own: not a hex or functional color, and not red.
    expect(uncommented).not.toMatch(/#[0-9a-f]{3,8}\b|\b(rgb|rgba|hsl|hsla|oklch|color-mix)\(/i);
    expect(uncommented).not.toMatch(/--rl-red|--rl-author|\bred\b/i);
    expect(uncommented).toMatch(/var\(--rl-ink\b/);
  });

  it('draws Not Now as an outline and Install as the pressed gray, never as ink', () => {
    expect(declarationsOf('.rl-question-buttons .rl-question-not-now')).toMatch(
      /border:\s*1px solid var\(--rl-rule\).*background:\s*transparent.*color:\s*var\(--rl-ink-2\)/,
    );
    const install = declarationsOf('.rl-question-buttons .rl-question-install');
    expect(install).toMatch(/background:\s*var\(--rl-pressed\)/);
    expect(install).toMatch(/border:\s*1px solid var\(--rl-syntax\)/);
    expect(install).toMatch(/font-weight:\s*700/);
    // Nothing is filled with the ink color: that was the black button.
    for (const { selector, declarations } of all) {
      expect(declarations, selector).not.toMatch(/background(-color)?:\s*var\(--rl-ink\b/);
    }
  });

  it('makes the buttons the same size, and quiet on hover and focus, as the app is', () => {
    // One rule gives both their size and shape, and the variants below it only color them.
    const shared = declarationsOf('.rl-question-buttons button');
    expect(shared).toMatch(/width:\s*140px/);
    expect(shared).toMatch(/height:\s*36px/);
    expect(shared).toMatch(/border-radius:\s*6px/);
    for (const { selector, declarations } of all) {
      if (/rl-question-(not-now|install)/.test(selector)) {
        expect(declarations, selector).not.toMatch(/\b(width|height|padding|border-radius):/);
      }
    }
    const hover = declarationsOf(
      '.rl-question-buttons .rl-question-not-now:hover:enabled, ' +
        '.rl-question-buttons .rl-question-not-now:active:enabled',
    );
    expect(hover).toMatch(/background:\s*var\(--rl-pressed\)/);
    expect(declarationsOf('.rl-question-buttons button:focus-visible')).toMatch(
      /outline:\s*2px solid var\(--rl-ink-3\)/,
    );
  });

  it('keeps the question on one line', () => {
    const text = declarationsOf('.rl-question-text');
    expect(text).toMatch(/white-space:\s*nowrap/);
    expect(text).toMatch(/font-weight:\s*700/);
  });
});
