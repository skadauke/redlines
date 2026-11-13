// @vitest-environment happy-dom
// The outline in the left margin (design §6.4): a column of short lines, one for each heading, that
// opens on hover into a list of their text, follows the reading place, goes to a heading on a click
// and is reached from the keyboard.

import { forceParsing } from '@codemirror/language';
import { createEditor, type Editor } from '@redlines/editor';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOutline, type OutlineGeometry } from './outline.ts';

const author = { handle: 'ada', name: 'Ada Lovelace' };

const DOC = [
  '# Title',
  '',
  'Intro text.',
  '',
  '## First',
  '',
  'Text.',
  '',
  '### Nested',
  '',
  'More.',
  '',
  '## Second',
  '',
  'End.',
  '',
].join('\n');

/** What the page lays out, which happy-dom doesn't: set by the tests. */
const room = { left: 0, top: 52, height: 600, textLeft: 160, scrolled: 0 };

/** A pane 1000 px wide whose lines are 30 px high. */
const geometry: OutlineGeometry = {
  pane: (view) => {
    const host = view.dom.closest<HTMLElement>('.rl-main');
    if (!host) return null;
    return {
      host,
      left: room.left,
      top: room.top,
      height: room.height,
      textLeft: room.textLeft,
    };
  },
  lineTop: (view, pos) => (view.state.doc.lineAt(pos).number - 1) * 30 - room.scrolled,
};

interface Mounted {
  editor: Editor;
  host: HTMLElement;
  nav: () => HTMLElement | null;
  remove: () => void;
}

const mounted: Mounted[] = [];

function mount(doc = DOC): Mounted {
  const host = document.createElement('div');
  host.className = 'rl-main';
  const scroller = document.createElement('div');
  scroller.className = 'rl-scroller';
  const parent = document.createElement('div');
  scroller.append(parent);
  host.append(scroller);
  document.body.append(host);
  const editor = createEditor(parent, { doc, author });
  forceParsing(editor.view, editor.view.state.doc.length, 10_000);
  // happy-dom fires `selectionchange` while CodeMirror writes a focused editor's selection.
  editor.view.focus = () => {};
  editor.view.contentDOM.focus = () => {};
  const remove = createOutline(editor, { geometry });
  const made = { editor, host, nav: () => host.querySelector<HTMLElement>('.rl-outline'), remove };
  mounted.push(made);
  return made;
}

beforeEach(() => {
  vi.useFakeTimers();
  Object.assign(room, { left: 0, top: 52, height: 600, textLeft: 160, scrolled: 0 });
});
afterEach(() => {
  vi.useRealTimers();
  for (const { editor, remove } of mounted.splice(0)) {
    remove();
    editor.destroy();
  }
  document.body.replaceChildren();
});

const buttons = (nav: HTMLElement) => [...nav.querySelectorAll<HTMLButtonElement>('button')];
const names = (nav: HTMLElement) => buttons(nav).map((b) => b.textContent);
const settle = () => vi.advanceTimersByTime(300);
const mouse = (el: Element, type: string) =>
  el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
const key = (el: Element, name: string) =>
  el.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));

describe('the outline', () => {
  it('lists the headings as buttons in a landmark, and a short line for each', () => {
    const { nav } = mount();
    const outline = nav()!;
    expect(outline.tagName).toBe('NAV');
    expect(outline.getAttribute('aria-label')).toBe('Outline');
    expect(names(outline)).toEqual(['Title', 'First', 'Nested', 'Second']);
    expect(buttons(outline).map((b) => b.dataset['level'])).toEqual(['1', '2', '3', '2']);
    const ticks = outline.querySelector('.rl-outline-ticks');
    expect(ticks?.getAttribute('aria-hidden')).toBe('true');
    expect(ticks?.children).toHaveLength(4);
    expect(outline.hidden).toBe(false);
  });

  it('hides for a document with fewer than two headings, and comes when a second is written', () => {
    const { nav, editor } = mount('# Only\n\nText.\n');
    expect(nav()!.hidden).toBe(true);
    editor.view.dispatch({ changes: { from: editor.view.state.doc.length, insert: '\n## Two\n' } });
    // Not at each keystroke: after a pause.
    expect(nav()!.hidden).toBe(true);
    settle();
    expect(nav()!.hidden).toBe(false);
    expect(names(nav()!)).toEqual(['Only', 'Two']);
  });

  it('follows the text: a heading renamed, added or taken away', () => {
    const { nav, editor } = mount();
    const at = editor.view.state.doc.toString().indexOf('Nested');
    editor.view.dispatch({ changes: { from: at, to: at + 'Nested'.length, insert: 'Deeper' } });
    settle();
    expect(names(nav()!)).toEqual(['Title', 'First', 'Deeper', 'Second']);
    const second = editor.view.state.doc.toString().indexOf('## Second');
    editor.view.dispatch({ changes: { from: second, to: second + 3, insert: '' } });
    settle();
    expect(names(nav()!)).toEqual(['Title', 'First', 'Deeper']);
  });

  it('reads headings with pending changes as they read with them accepted', () => {
    const { nav } = mount(
      '# A <!--ins k3x9-->new <!--/k3x9-->head<!--del w2rf  old-->ing\n\n## <!--sub p7qd Old-->New<!--/p7qd--> two\n',
    );
    expect(names(nav()!)).toEqual(['A new heading', 'New two']);
  });

  it('marks the section the reader is in, from the scroll', () => {
    const { nav, host } = mount();
    const current = () =>
      buttons(nav()!).findIndex((b) => b.getAttribute('aria-current') === 'location');
    expect(current()).toBe(0);
    // Line 9 is "### Nested": 30 px a line, and the reading line a little below the pane's top.
    room.scrolled = 8 * 30;
    host.querySelector('.rl-scroller')!.dispatchEvent(new Event('scroll'));
    settle();
    expect(current()).toBe(2);
    const ticks = [...nav()!.querySelectorAll<HTMLElement>('.rl-outline-tick')];
    expect(ticks.map((t) => t.dataset['current'] === 'true')).toEqual([false, false, true, false]);
    room.scrolled = 20 * 30;
    host.querySelector('.rl-scroller')!.dispatchEvent(new Event('scroll'));
    settle();
    expect(current()).toBe(3);
  });

  it('goes to the right line while the headings wait to be read again, after text typed above them', () => {
    const { nav, editor } = mount();
    editor.view.dispatch({ changes: { from: 0, insert: 'Added above.\n\n' } });
    // At once, before the pause: the lines have moved, and so must the places the buttons go to.
    buttons(nav()!)[1]!.click();
    expect(editor.view.state.selection.main.head).toBe(
      editor.view.state.doc.toString().indexOf('## First'),
    );
  });

  it('goes to a heading on a click: the caret at its line, the scroll to it, the focus to the text', () => {
    const { nav, editor } = mount();
    const focus = vi.spyOn(editor.view, 'focus');
    const dispatch = vi.spyOn(editor.view, 'dispatch');
    buttons(nav()!)[2]!.click();
    const from = editor.view.state.doc.toString().indexOf('### Nested');
    expect(editor.view.state.selection.main.head).toBe(from);
    const scrolled = dispatch.mock.calls.some(([spec]) => {
      const effects = (spec as { effects?: unknown }).effects;
      return Array.isArray(effects) ? effects.length > 0 : effects !== undefined;
    });
    expect(scrolled).toBe(true);
    expect(focus).toHaveBeenCalled();
  });

  it('opens when the pointer comes, after a pause, and closes after it leaves', () => {
    const { nav } = mount();
    const outline = nav()!;
    expect(outline.dataset['open']).toBe('false');
    mouse(outline.querySelector('.rl-outline-panel')!, 'mouseenter');
    vi.advanceTimersByTime(30);
    expect(outline.dataset['open']).toBe('false');
    vi.advanceTimersByTime(60);
    expect(outline.dataset['open']).toBe('true');
    mouse(outline.querySelector('.rl-outline-panel')!, 'mouseleave');
    expect(outline.dataset['open']).toBe('true');
    vi.advanceTimersByTime(300);
    expect(outline.dataset['open']).toBe('false');
    // A pointer that comes and goes inside the pause opens nothing.
    mouse(outline.querySelector('.rl-outline-panel')!, 'mouseenter');
    mouse(outline.querySelector('.rl-outline-panel')!, 'mouseleave');
    vi.advanceTimersByTime(300);
    expect(outline.dataset['open']).toBe('false');
  });

  it('opens with the focus too, and closes when the focus leaves', () => {
    const { nav } = mount();
    const outline = nav()!;
    buttons(outline)[1]!.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(outline.dataset['open']).toBe('true');
    buttons(outline)[1]!.dispatchEvent(
      new FocusEvent('focusout', { bubbles: true, relatedTarget: document.body }),
    );
    vi.advanceTimersByTime(300);
    expect(outline.dataset['open']).toBe('false');
  });
});

describe('the outline from the keyboard', () => {
  it('is reached by a command that puts the focus on the heading the reader is in', () => {
    const { nav, editor } = mount();
    const command = editor.commands.list().find((c) => c.id === 'outline.focus');
    expect(command).toMatchObject({ title: 'Show Outline', shortcut: 'Mod-Ctrl-o', menu: 'view' });
    room.scrolled = 8 * 30;
    expect(editor.commands.run('outline.focus')).toBe(true);
    expect(document.activeElement).toBe(buttons(nav()!)[2]);
    expect(nav()!.dataset['open']).toBe('true');
  });

  it('moves with the arrows, one tab stop, and goes to a heading with Return', () => {
    const { nav, editor } = mount();
    editor.commands.run('outline.focus');
    const list = buttons(nav()!);
    expect(list.map((b) => b.tabIndex)).toEqual([0, -1, -1, -1]);
    key(list[0]!, 'ArrowDown');
    expect(document.activeElement).toBe(list[1]);
    expect(list.map((b) => b.tabIndex)).toEqual([-1, 0, -1, -1]);
    key(list[1]!, 'ArrowDown');
    key(list[2]!, 'ArrowDown');
    key(list[3]!, 'ArrowDown');
    expect(document.activeElement).toBe(list[3]);
    key(list[3]!, 'ArrowUp');
    expect(document.activeElement).toBe(list[2]);
    key(list[2]!, 'Home');
    expect(document.activeElement).toBe(list[0]);
    key(list[0]!, 'End');
    expect(document.activeElement).toBe(list[3]);
    // Return is the button's own click, which goes to the heading.
    list[3]!.click();
    expect(editor.view.state.selection.main.head).toBe(
      editor.view.state.doc.toString().indexOf('## Second'),
    );
  });

  it('is left with Escape, which gives the focus back to the text and closes it', () => {
    const { nav, editor } = mount();
    const focus = vi.spyOn(editor.view, 'focus');
    editor.commands.run('outline.focus');
    key(buttons(nav()!)[0]!, 'Escape');
    expect(focus).toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(nav()!.dataset['open']).toBe('false');
  });

  it('opens its list from the keyboard even where the margin has no room for the lines', () => {
    room.textLeft = 40;
    const { nav, editor } = mount();
    expect(nav()!.dataset['ticks']).toBe('false');
    expect(nav()!.hidden).toBe(false);
    editor.commands.run('outline.focus');
    expect(nav()!.dataset['open']).toBe('true');
    expect(document.activeElement).toBe(buttons(nav()!)[0]);
  });
});

describe('the outline in the margin', () => {
  it('stands at the pane’s left edge, below the title bar, and moves with the pane', () => {
    const { nav } = mount();
    expect(nav()!.style.left).toBe('0px');
    expect(nav()!.style.top).toBe('52px');
    expect(nav()!.style.height).toBe('600px');
    // The sidebar opens: the pane moves right, and the outline with it.
    room.left = 240;
    room.height = 500;
    window.dispatchEvent(new Event('resize'));
    settle();
    expect(nav()!.style.left).toBe('240px');
    expect(nav()!.style.height).toBe('500px');
  });

  it('shows its lines only where the margin has room beside the change bars', () => {
    const { nav } = mount();
    expect(nav()!.dataset['ticks']).toBe('true');
    room.textLeft = 70;
    window.dispatchEvent(new Event('resize'));
    settle();
    expect(nav()!.dataset['ticks']).toBe('false');
    room.textLeft = 200;
    window.dispatchEvent(new Event('resize'));
    settle();
    expect(nav()!.dataset['ticks']).toBe('true');
  });

  it('takes no pointer event but its own, so a click meant for a change bar reaches it', () => {
    const { nav } = mount();
    expect(nav()!.style.pointerEvents).toBe('none');
    expect(nav()!.querySelector<HTMLElement>('.rl-outline-panel')!.style.pointerEvents).toBe(
      'auto',
    );
  });

  it('takes none at all where its lines are not shown, unless its list is open', () => {
    room.textLeft = 40;
    const { nav, editor } = mount();
    const panel = () => nav()!.querySelector<HTMLElement>('.rl-outline-panel')!;
    // Nothing shows at the margin's edge, and the change bars may be under it.
    expect(panel().style.pointerEvents).toBe('none');
    editor.commands.run('outline.focus');
    expect(panel().style.pointerEvents).toBe('auto');
    key(buttons(nav()!)[0]!, 'Escape');
    expect(panel().style.pointerEvents).toBe('none');
    // The margin grows: the lines come back, and the panel takes the pointer again.
    room.textLeft = 200;
    window.dispatchEvent(new Event('resize'));
    settle();
    expect(panel().style.pointerEvents).toBe('auto');
  });

  it('is taken out again by its remover, with its timers', () => {
    const { nav, remove, host } = mount();
    mouse(nav()!.querySelector('.rl-outline-panel')!, 'mouseenter');
    remove();
    expect(nav()).toBeNull();
    expect(() => vi.advanceTimersByTime(1000)).not.toThrow();
    host.querySelector('.rl-scroller')!.dispatchEvent(new Event('scroll'));
    expect(() => vi.advanceTimersByTime(1000)).not.toThrow();
  });
});
