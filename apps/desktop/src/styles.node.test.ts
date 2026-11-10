// The look is in styles.css, which no test renders. These read it as a file, because tests don't
// process CSS, and check the rules of color that it keeps: color means a person, and the interface
// draws red, the app's own, for the Track Changes pen alone. (Red is also the first author color,
// yours, but that is the document's, set by the theme's tokens: design §5.4, §5.5, §6.6.)

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SIDEBAR_COVERS } from './ui/sidebar.ts';

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

  it('prints in light ink on white, whatever the theme, and leaves the authors’ colors', () => {
    const reset = all.find(
      ({ selector, declarations }) =>
        selector.includes('html[data-rl-theme]') && declarations.includes('--rl-ink:'),
    );
    expect(reset).toBeDefined();
    const { selector, declarations } = reset ?? { selector: '', declarations: '' };
    // More specific than a theme's own tokens, which sit on the same element.
    expect(selector).toContain('html[data-rl-theme][data-rl-appearance]');
    for (const token of [
      '--rl-page',
      '--rl-ink',
      '--rl-ink-2',
      '--rl-ink-3',
      '--rl-rule',
      '--rl-tint',
    ]) {
      expect(declarations).toContain(`${token}:`);
    }
    expect(declarations).toContain('color-scheme: light');
    expect(declarations).toMatch(/background:\s*#fff/);
    expect(declarations).not.toContain('--rl-author');
    // It is among the print rules, the last of the style sheet.
    const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
    expect(css.indexOf(selector.split(',')[0] ?? '')).toBeGreaterThan(css.indexOf('@media print'));
  });

  it("prints at the theme's own size, whatever the text size, without the rail's room", () => {
    const reset = all.find(
      ({ selector, declarations }) =>
        selector.includes('html[data-rl-theme]') && declarations.includes('--rl-ink:'),
    );
    expect(reset?.declarations).toContain('--rl-text-scale: 1 !important');
    const room = all.find(
      ({ selector }) =>
        selector.includes('#editor') && selector.includes('.rl-has-rail .cm-content'),
    );
    expect(room?.declarations).toContain(
      'max-width: calc(var(--rl-column) + 2 * var(--rl-margin, 24px))',
    );
    expect(room?.declarations).toContain('padding-right: var(--rl-margin, 24px)');
    const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
    expect(css.indexOf(room?.selector ?? '')).toBeGreaterThan(css.indexOf('@media print'));
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

  it('lays the sidebar over the page when the page beside it would be under 360 px', () => {
    const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
    expect(SIDEBAR_COVERS).toBe('(max-width: 599.98px)');
    const block = new RegExp(
      `@media ${SIDEBAR_COVERS.replace(/[().]/g, '\\$&')} \\{([\\s\\S]*?)\\n\\}`,
    ).exec(css);
    expect(block, 'the style sheet has the @media block').not.toBeNull();
    const covering = rules(block?.[1] ?? '').find(
      ({ selector }) => selector === ".rl-app[data-sidebar='open'] .rl-sidebar",
    );
    expect(covering?.declarations).toContain('position: absolute');
    // 240 px of sidebar and 360 of page.
    expect(240 + 360).toBe(600);
  });

  it('keeps the frame in points beside the window buttons, its controls zooming to 150%', () => {
    const declared = (selector: string, css = all) =>
      css.find((rule) => rule.selector === selector)?.declarations ?? '';
    expect(declared('.rl-titlebar')).toContain('height: calc(52 * var(--rl-pt))');
    expect(declared('.rl-titlebar')).toContain('padding: 0 calc(12 * var(--rl-pt))');
    expect(declared('.rl-files-control')).toContain(
      'top: calc(26 * var(--rl-pt) - 14 * var(--rl-frame))',
    );
    expect(declared('.rl-files-control')).toContain('left: calc(84 * var(--rl-pt))');
    expect(declared('.rl-icon-button')).toContain('width: calc(32 * var(--rl-frame))');
    expect(declared('.rl-icon-button')).toContain('height: calc(28 * var(--rl-frame))');
    expect(declared('.rl-title')).toContain('font-size: var(--rl-size-ui-frame)');
    expect(declared('.rl-sidebar-head')).toContain('height: calc(52 * var(--rl-pt))');
    expect(declared('.rl-notice')).toContain('top: calc(56 * var(--rl-pt))');
    expect(declared('.rl-menu')).toContain('max-width: calc(100vw - 32px)');
    const preferences = rules(
      readFileSync(new URL('./preferences/preferences.css', import.meta.url), 'utf8'),
    );
    expect(declared('.rl-pref-bar', preferences)).toContain('height: calc(56 * var(--rl-pt))');
    expect(declared('.rl-pref-tab', preferences)).toContain('width: calc(44 * var(--rl-frame))');
  });
});
