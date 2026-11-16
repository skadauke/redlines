// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installTitleHints, TITLE_HINT_MS, type TitleHints } from './title-hints.ts';

let hints: TitleHints;
let button: HTMLButtonElement;

function pointer(type: string, target: Element, init: Record<string, unknown> = {}) {
  const event = new Event(type, { bubbles: true });
  Object.assign(event, { pointerType: 'mouse', ...init });
  target.dispatchEvent(event);
}

const hint = () => document.querySelector('.rl-title-hint');

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '<button title="Drag to move">Move</button>';
  button = document.querySelector('button')!;
  hints = installTitleHints(document);
});

afterEach(() => {
  hints.destroy();
  vi.useRealTimers();
});

describe('title hints', () => {
  it('puts the system’s title away at once and shows the app’s own hint after the pause', () => {
    pointer('pointerover', button);
    expect(button.hasAttribute('title')).toBe(false);
    vi.advanceTimersByTime(TITLE_HINT_MS - 1);
    expect(hint()).toBeNull();
    vi.advanceTimersByTime(1);
    expect(hint()?.textContent).toBe('Drag to move');
  });

  it('gives the title back when the pointer leaves, and takes the hint away', () => {
    pointer('pointerover', button);
    vi.advanceTimersByTime(TITLE_HINT_MS);
    pointer('pointerout', button, { relatedTarget: document.body });
    expect(hint()).toBeNull();
    expect(button.getAttribute('title')).toBe('Drag to move');
  });

  it('shows nothing for a touch, and keeps the title', () => {
    pointer('pointerover', button, { pointerType: 'touch' });
    vi.advanceTimersByTime(TITLE_HINT_MS);
    expect(hint()).toBeNull();
    expect(button.getAttribute('title')).toBe('Drag to move');
  });

  it('after a press or Escape, shows no hint and keeps the title away until the pointer leaves', () => {
    pointer('pointerover', button);
    pointer('pointerdown', button);
    vi.advanceTimersByTime(TITLE_HINT_MS);
    expect(hint()).toBeNull();
    expect(button.hasAttribute('title')).toBe(false);
    pointer('pointermove', button);
    expect(button.hasAttribute('title')).toBe(false);

    pointer('pointerout', button, { relatedTarget: document.body });
    pointer('pointerover', button);
    vi.advanceTimersByTime(TITLE_HINT_MS);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(hint()).toBeNull();
    expect(button.hasAttribute('title')).toBe(false);
    pointer('pointerout', button, { relatedTarget: document.body });
    expect(button.getAttribute('title')).toBe('Drag to move');
  });

  it('puts away a title that is set after the pointer came, as the title bar sets its own', () => {
    const bare = document.createElement('div');
    document.body.append(bare);
    pointer('pointerover', bare);
    bare.setAttribute('title', 'Saved just now');
    pointer('pointermove', bare);
    expect(bare.hasAttribute('title')).toBe(false);
    pointer('pointermove', bare);
    vi.advanceTimersByTime(TITLE_HINT_MS);
    expect(hint()?.textContent).toBe('Saved just now');
  });

  it('shows no hint for an element that is gone when the pause ends', () => {
    pointer('pointerover', button);
    button.remove();
    vi.advanceTimersByTime(TITLE_HINT_MS);
    expect(hint()).toBeNull();
  });

  it('does not bring back a title that its owner has taken away or changed meanwhile', () => {
    pointer('pointerover', button);
    button.setAttribute('title', 'Now another');
    pointer('pointerout', button, { relatedTarget: document.body });
    expect(button.getAttribute('title')).toBe('Now another');
  });

  it('finds the title on an ancestor of what the pointer is over', () => {
    button.innerHTML = '<span>inside</span>';
    pointer('pointerover', button.querySelector('span')!);
    vi.advanceTimersByTime(TITLE_HINT_MS);
    expect(hint()?.textContent).toBe('Drag to move');
  });
});
