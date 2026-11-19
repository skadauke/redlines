// One hover fill for every button and row, and the item the keys chose marked with that same fill and
// no ring (#1247). The sheet (journeys/tests/sheet.spec.ts) reads the computed styles in WebKit;
// this holds the sources to it where a journey isn't run: a button or row of these files that shows
// a ring when chosen with the keys, or a fill that is another gray under the pointer, fails here.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');

/** The one hover fill: the pressed gray at 55%. */
const FILL = 'color-mix(in srgb, var(--rl-pressed) 55%, transparent)';

/** Where each button or row is drawn, and the selector that its hover and keys rules name. */
const BUTTONS: readonly [file: string, selectors: readonly string[]][] = [
  [
    'apps/desktop/src/styles.css',
    [
      '.rl-icon-button',
      '.rl-menu-item',
      '.rl-notification-close',
      '.rl-notification-dismiss',
      '.rl-notification-action',
      '.rl-sidebar-item',
    ],
  ],
  ['plugins/review/src/styles.ts', ['.rl-card-button', '.rl-note-button', '.rl-note-icon']],
  ['plugins/find/src/styles.ts', ['.rl-find-toggle', '.rl-find-icon']],
  ['packages/editor/src/preview/theme.ts', ['.rl-callout-menu', '.rl-callout-fold']],
];

/** The declarations of every rule (CSS, or the editor's style objects) with a selector ending `name`. */
function rulesFor(file: string, source: string, name: string, pseudo: string): string[] {
  const found: string[] = [];
  const pattern = file.endsWith('.ts') ? /'([^'\n]+)':\s*\{([^{}]*)\}/g : /([^{}]+)\{([^{}]*)\}/g;
  for (const match of source.matchAll(pattern)) {
    const selectors = (match[1] ?? '').split(',').map((part) => part.trim().replace(/\s+/g, ' '));
    if (selectors.some((selector) => selector.endsWith(`${name}${pseudo}`))) {
      found.push(match[2] ?? '');
    }
  }
  return found;
}

describe('an item chosen with the keys looks as one under the pointer (#1247)', () => {
  for (const [file, names] of BUTTONS) {
    const source = read(file);
    for (const name of names) {
      it(`${name} in ${file}: no ring, and the one fill`, () => {
        // The notification's buttons share one rule for the keys.
        const focus = name.startsWith('.rl-notification-') ? '.rl-notification button' : name;
        const keyed = rulesFor(file, source, focus, ':focus-visible');
        expect(keyed.length, 'a rule for the keys').toBeGreaterThan(0);
        for (const body of keyed) {
          expect(body).not.toMatch(/outline:\s*['"]?\d|box-shadow|boxShadow/);
        }
        expect(keyed.join(' ')).toContain(FILL);
        expect(rulesFor(file, source, name, ':hover').join(' ') + keyed.join(' ')).toContain(FILL);
      });
    }
  }
});
