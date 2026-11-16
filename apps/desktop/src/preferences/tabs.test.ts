// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { noRingOnClick } from './tabs.ts';

describe('a click on a tab', () => {
  it('marks it as the pointer’s, and a key or the focus leaving takes the mark off', () => {
    const tab = document.createElement('button');
    document.body.append(tab);
    noRingOnClick(tab);
    tab.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(tab.hasAttribute('data-by-pointer')).toBe(true);
    tab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(tab.hasAttribute('data-by-pointer')).toBe(false);
    tab.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    tab.dispatchEvent(new FocusEvent('blur'));
    expect(tab.hasAttribute('data-by-pointer')).toBe(false);
  });
});
