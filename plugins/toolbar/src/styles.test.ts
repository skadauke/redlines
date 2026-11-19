import { describe, expect, it } from 'vitest';
import { TOOLBAR_STYLE } from './styles.ts';

/** The declarations of every rule whose selector list names `selector`. */
function rulesFor(selector: string): string[] {
  const found: string[] = [];
  for (const match of TOOLBAR_STYLE.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (match[1]?.includes(selector)) found.push(match[2] ?? '');
  }
  return found;
}

describe('an item chosen with the keys (#1191)', () => {
  const HOVER = 'background: color-mix(in srgb, var(--rl-pressed) 55%, transparent)';

  it.each([
    ['top', ''],
    ['item', ''],
    ['word', ':enabled'],
  ])('looks as one under the pointer: no ring on a %s', (kind, state) => {
    const focus = rulesFor(`.rl-toolbar-${kind}:focus-visible`);
    expect(focus.length).toBeGreaterThan(0);
    for (const rule of focus) expect(rule).not.toMatch(/box-shadow|border/);
    // The hover rule names the key focus too, so that the two share one look.
    expect(rulesFor(`.rl-toolbar-${kind}${state}:hover`).join(' ')).toContain(HOVER);
    expect(rulesFor(`.rl-toolbar-${kind}:focus-visible`).join(' ')).toContain(HOVER);
  });

  it('shows a line of the palette the same under the pointer as chosen', () => {
    const hover = rulesFor('.rl-toolbar-result:hover').join(' ');
    expect(hover).toContain('background: color-mix(in srgb, var(--rl-pressed) 55%, transparent)');
    expect(rulesFor(".rl-toolbar-result[aria-selected='true']").join(' ')).toContain(hover.trim());
  });
});
