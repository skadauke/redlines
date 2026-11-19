// @vitest-environment happy-dom
// The outline as a window under the title bar's button (#1193): it opens wherever the margin is,
// even where the margin has no room for the lines at all (a text zoomed so far that it is gone).

import { forceParsing } from '@codemirror/language';
import { createEditor, type Editor } from '@redlines/editor';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOutline, FLOATING_EVENT, type OutlineGeometry } from './outline.ts';

const DOC = '# Title\n\nIntro.\n\n## First\n\nText.\n\n## Second\n\nEnd.\n';

// No room in the margin: the text starts at the pane's left edge, as at 400% text size.
const geometry: OutlineGeometry = {
  pane: (view) => {
    const host = view.dom.closest<HTMLElement>('.rl-main');
    return host
      ? { host, left: 0, top: 52, height: 600, textLeft: 0, scrolled: false, atEnd: false }
      : null;
  },
  lineTop: (view, pos) => (view.state.doc.lineAt(pos).number - 1) * 30,
};

const mounted: { editor: Editor; remove: () => void }[] = [];

function mount(doc = DOC, notice = vi.fn()) {
  const host = document.createElement('div');
  host.className = 'rl-main';
  const scroller = document.createElement('div');
  const parent = document.createElement('div');
  scroller.append(parent);
  host.append(scroller);
  document.body.append(host);
  const editor = createEditor(parent, { doc, author: { handle: 'ada', name: 'Ada' } });
  forceParsing(editor.view, editor.view.state.doc.length, 10_000);
  editor.view.focus = () => {};
  editor.view.contentDOM.focus = () => {};
  const remove = createOutline(editor, {
    geometry,
    notice,
    floatingAnchor: () => ({ bottom: 44, right: 1200 }),
  });
  mounted.push({ editor, remove });
  return { editor, notice };
}

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
});
afterEach(() => {
  vi.useRealTimers();
  for (const { editor, remove } of mounted.splice(0)) {
    remove();
    editor.destroy();
  }
  document.body.replaceChildren();
});

const nav = () => document.querySelector<HTMLElement>('.rl-outline')!;
const items = () => [...nav().querySelectorAll<HTMLButtonElement>('.rl-outline-item')];
const key = (target: Element, name: string) =>
  target.dispatchEvent(
    new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }),
  );

describe('the outline as a window', () => {
  it('opens under the button, over the page, with every heading, where the margin has no room', () => {
    const { editor } = mount();
    // The margin shows no lines here.
    expect(nav().dataset['ticks']).toBe('false');
    expect(editor.commands.run('outline.toggle')).toBe(true);
    expect(nav().dataset['floating']).toBe('true');
    expect(nav().hidden).toBe(false);
    expect(nav().parentElement).toBe(document.body);
    expect([nav().style.top, nav().style.right]).toEqual(['50px', '80px']);
    expect(items().map((b) => b.textContent)).toEqual(['Title', 'First', 'Second']);
    expect(nav().dataset['open']).toBe('true');
  });

  it('tells the page when it shows and when it goes', () => {
    const { editor } = mount();
    const heard: boolean[] = [];
    document.addEventListener(FLOATING_EVENT, (event) =>
      heard.push((event as CustomEvent<boolean>).detail),
    );
    editor.commands.run('outline.toggle');
    editor.commands.run('outline.toggle');
    expect(heard).toEqual([true, false]);
    expect(nav().dataset['floating']).toBeUndefined();
    // Back in the margin, in the pane.
    expect(nav().parentElement?.className).toBe('rl-main');
  });

  it('goes to a heading on a click, and puts itself away', () => {
    const { editor } = mount();
    editor.commands.run('outline.toggle');
    items()[2]!.click();
    expect(
      editor.view.state.sliceDoc(editor.view.state.selection.main.head).startsWith('## Second'),
    ).toBe(true);
    expect(nav().dataset['floating']).toBeUndefined();
  });

  it('is put away by Esc, and by a press elsewhere but not on its button', () => {
    const { editor } = mount();
    editor.commands.run('outline.toggle');
    key(items()[0]!, 'Escape');
    expect(nav().dataset['floating']).toBeUndefined();

    editor.commands.run('outline.toggle');
    const control = document.createElement('button');
    control.dataset['outlineControl'] = '';
    document.body.append(control);
    control.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(nav().dataset['floating']).toBe('true');
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(nav().dataset['floating']).toBeUndefined();
  });

  it('puts the keyboard in the list, on the heading being read', () => {
    const { editor } = mount();
    editor.commands.run('outline.toggle');
    expect(document.activeElement).toBe(items()[0]);
    key(items()[0]!, 'ArrowDown');
    expect(document.activeElement).toBe(items()[1]);
  });

  it('says why when the document has too few headings, and shows nothing', () => {
    const { editor, notice } = mount('# Only one\n\nText.\n');
    editor.commands.run('outline.toggle');
    expect(notice).toHaveBeenCalledOnce();
    expect(nav().dataset['floating']).toBeUndefined();
  });
});
