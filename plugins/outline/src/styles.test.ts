// The outline's style sheet (design §6.4). Layout is what happy-dom lacks, so these hold the rules
// whose absence a person would meet in the app: what takes the pointer, and what prints.

import { describe, expect, it } from 'vitest';
import { STYLE } from './styles.ts';

/** The declarations of the rule whose selector is `selector`, or an empty text. */
function rule(selector: string): string {
  const at = STYLE.indexOf(`${selector} {`);
  if (at < 0) return '';
  return STYLE.slice(STYLE.indexOf('{', at) + 1, STYLE.indexOf('}', at));
}

describe('the outline’s style sheet', () => {
  it('lets the lines take no pointer, so the panel is what a click on them meets', () => {
    expect(rule('.rl-outline-ticks')).toMatch(/pointer-events:\s*none/);
  });

  it('lets the list take none at rest, where its entries are not where the lines are, and all when open', () => {
    expect(rule('.rl-outline-list')).toMatch(/pointer-events:\s*none/);
    expect(rule(".rl-outline[data-open='true'] .rl-outline-list")).toMatch(
      /pointer-events:\s*auto/,
    );
  });

  it('takes nothing of the outline to the printed page', () => {
    const print = STYLE.slice(STYLE.indexOf('@media print'));
    expect(print).toMatch(/\.rl-outline\s*\{[^}]*display:\s*none/);
  });
});
