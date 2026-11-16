// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { noFocusOnPress } from './tabs.ts';

describe('a press on a tab', () => {
  it('does not move the focus to it, and a click still reaches it', () => {
    const tab = document.createElement('button');
    document.body.append(tab);
    let clicked = false;
    tab.addEventListener('click', () => (clicked = true));
    noFocusOnPress(tab);
    const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    tab.dispatchEvent(press);
    expect(press.defaultPrevented).toBe(true);
    tab.click();
    expect(clicked).toBe(true);
  });
});
