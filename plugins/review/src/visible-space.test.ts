// @vitest-environment happy-dom
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { visibleSpace } from './shared.ts';

/** An editor in a page that scrolls (an ancestor does, as the desktop app's does), at `top`. */
function mount(top: number, paddingTop?: string) {
  const page = document.createElement('div');
  page.style.overflowY = 'auto';
  if (paddingTop) page.style.paddingTop = paddingTop;
  page.getBoundingClientRect = () => new DOMRect(0, top, 800, 600 - top);
  document.body.append(page);
  return new EditorView({ state: EditorState.create({ doc: 'text' }), parent: page });
}

afterEach(() => document.body.replaceChildren());

describe('visibleSpace', () => {
  it('is the window, less what a title bar above the scrolling page hides', () => {
    const { top, bottom, left, right } = visibleSpace(mount(52));
    expect({ left, right }).toEqual({ left: 0, right: window.innerWidth });
    expect(top).toBe(52);
    expect(bottom).toBe(600);
  });

  it('is the window, less the room a title bar floating over the scrolling page hides', () => {
    // The page reaches the top of the window, and keeps the bar's room as its top padding: the
    // text starts below it, and passes under it.
    expect(visibleSpace(mount(0, '52px')).top).toBe(52);
    expect(visibleSpace(mount(10, '52px')).top).toBe(62);
  });

  it('keeps the whole window when nothing hides the top', () => {
    expect(visibleSpace(mount(0)).top).toBe(0);
  });
});
