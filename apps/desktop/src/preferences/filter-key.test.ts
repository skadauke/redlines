// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { startsFilter } from './filter-key.ts';

/** The key as the window sees it, pressed with `target` focused. */
function press(target: Element, init: KeyboardEventInit = {}): boolean {
  let starts = false;
  const listener = (event: KeyboardEvent) => {
    starts = startsFilter(event);
  };
  window.addEventListener('keydown', listener, { once: true });
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true, ...init }));
  return starts;
}

function made<T extends HTMLElement>(html: string): T {
  document.body.innerHTML = html;
  return document.body.firstElementChild as T;
}

describe('the key that starts the filter', () => {
  it('is a letter or a digit with a tab button focused', () => {
    const tab = made('<button role="tab">General</button>');
    expect(press(tab)).toBe(true);
    expect(press(tab, { key: '7' })).toBe(true);
  });

  it('is a letter on any other button, a switch, a checkbox or the page', () => {
    expect(press(made('<button role="switch">On</button>'))).toBe(true);
    expect(press(made('<input type="checkbox">'))).toBe(true);
    expect(press(document.body)).toBe(true);
  });

  it('leaves Space and Return to a button, and every shortcut and named key', () => {
    const tab = made('<button role="tab">General</button>');
    expect(press(tab, { key: ' ' })).toBe(false);
    expect(press(tab, { key: 'Enter' })).toBe(false);
    expect(press(tab, { key: 'ArrowRight' })).toBe(false);
    expect(press(tab, { metaKey: true })).toBe(false);
    expect(press(tab, { ctrlKey: true })).toBe(false);
    expect(press(tab, { altKey: true })).toBe(false);
  });

  it('leaves a field that takes text, a menu and an editable element their keys', () => {
    expect(press(made('<input type="text">'))).toBe(false);
    expect(press(made('<input type="search">'))).toBe(false);
    expect(press(made('<textarea></textarea>'))).toBe(false);
    expect(press(made('<select><option>a</option></select>'))).toBe(false);
    expect(press(made('<div contenteditable="true"><span>x</span></div>').firstElementChild!)).toBe(
      false,
    );
  });

  it('leaves an input method that is composing its keys', () => {
    const tab = made('<button role="tab">General</button>');
    expect(press(tab, { isComposing: true })).toBe(false);
    expect(press(tab, { key: 'Process' })).toBe(false);
  });
});
