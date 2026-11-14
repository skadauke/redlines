// @vitest-environment happy-dom
// The outline in the left margin (design §6.4): a column of short lines, one for each heading, that
// opens on hover into a list of their text, follows the reading place, goes to a heading on a click
// and is reached from the keyboard.

import { forceParsing } from '@codemirror/language';
import { createEditor, type Editor } from '@redlines/editor';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOutline, type OutlineGeometry, type OutlineOptions } from './outline.ts';

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
const room = { left: 0, top: 52, height: 600, textLeft: 160, scrolled: 0, atEnd: false };

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
      scrolled: room.scrolled > 0,
      atEnd: room.atEnd,
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

function mount(doc = DOC, options: Partial<OutlineOptions> = {}): Mounted {
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
  const remove = createOutline(editor, { geometry, ...options });
  const made = { editor, host, nav: () => host.querySelector<HTMLElement>('.rl-outline'), remove };
  mounted.push(made);
  return made;
}

beforeEach(() => {
  vi.useFakeTimers();
  Object.assign(room, { left: 0, top: 52, height: 600, textLeft: 160, scrolled: 0, atEnd: false });
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

const current = (nav: HTMLElement) =>
  buttons(nav).findIndex((b) => b.getAttribute('aria-current') === 'location');
const scrolled = (host: HTMLElement) =>
  host.querySelector('.rl-scroller')!.dispatchEvent(new Event('scroll'));

describe('the section being read', () => {
  it('follows a scroll that goes on, and not only once it stops', () => {
    const { nav, host } = mount();
    // The page has moved to "### Nested" (line 9, 30 px a line) and the events keep coming, every
    // 16 ms, as a trackpad's do: a pause after the last of them would be after the scroll is over.
    room.scrolled = 8 * 30;
    for (let i = 0; i < 20; i++) {
      scrolled(host);
      vi.advanceTimersByTime(16);
    }
    expect(current(nav()!)).toBe(2);
  });

  it('is the last heading on screen when the page has scrolled as far as it goes', () => {
    const { nav, host } = mount();
    // The reading line is 80 px down; "## Second" is 330 px down, in a pane 600 px high, and the
    // page can go no further, so nothing can bring it to the reading line.
    room.scrolled = 30;
    room.atEnd = true;
    scrolled(host);
    settle();
    expect(current(nav()!)).toBe(3);
    // Not at the end of the page: the reading line decides.
    room.atEnd = false;
    scrolled(host);
    settle();
    expect(current(nav()!)).toBe(0);
    // A page that fits and was never scrolled is at its start, and its end.
    room.scrolled = 0;
    room.atEnd = true;
    scrolled(host);
    settle();
    expect(current(nav()!)).toBe(0);
  });

  it('is the heading that was clicked, when the page cannot scroll to put it at the reading line', () => {
    const { nav, host } = mount();
    // The page fits in the pane: nothing scrolls, and "## Second" is below the reading line.
    room.atEnd = true;
    buttons(nav()!)[3]!.click();
    expect(current(nav()!)).toBe(3);
    scrolled(host);
    settle();
    expect(current(nav()!)).toBe(3);
    // The page scrolls away from its end: the reading line decides again, and the click is forgotten.
    room.atEnd = false;
    scrolled(host);
    settle();
    expect(current(nav()!)).toBe(0);
    room.atEnd = true;
    scrolled(host);
    settle();
    expect(current(nav()!)).toBe(0);
  });
});

describe('what scrolls in the outline', () => {
  it('is the person’s own, and leaves the reading place alone', () => {
    const { nav, host } = mount();
    expect(current(nav()!)).toBe(0);
    // The page is elsewhere, but it is the card that scrolls: no work of the reading place.
    room.scrolled = 8 * 30;
    nav()!.querySelector('.rl-outline-panel')!.dispatchEvent(new Event('scroll'));
    nav()!.querySelector('.rl-outline-list')!.dispatchEvent(new Event('scroll'));
    settle();
    expect(current(nav()!)).toBe(0);
    // The page's own scroll is heard.
    scrolled(host);
    settle();
    expect(current(nav()!)).toBe(2);
  });
});

describe('the heading that was clicked, when the text changes', () => {
  it('is forgotten: the headings it counted by are not the ones that are there', () => {
    const { nav, editor } = mount();
    room.atEnd = true;
    buttons(nav()!)[3]!.click();
    expect(current(nav()!)).toBe(3);
    // Text after the last heading: the headings are the same, and so are their places.
    editor.view.dispatch({ changes: { from: editor.view.state.doc.length, insert: 'More.\n' } });
    settle();
    expect(names(nav()!)).toEqual(['Title', 'First', 'Nested', 'Second']);
    expect(current(nav()!)).toBe(0);
  });
});

describe('a long outline', () => {
  const LONG = Array.from({ length: 40 }, (_, i) => `## Section ${i}\n\nText.\n`).join('\n');
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
  const saved = new Map<string, PropertyDescriptor | undefined>();

  /** happy-dom lays nothing out: the lines are 11 px apart, the entries 31 px, the panel 300 px. */
  beforeEach(() => {
    const define = (name: string, get: (this: HTMLElement) => number) => {
      saved.set(name, Object.getOwnPropertyDescriptor(proto, name));
      Object.defineProperty(proto, name, { configurable: true, get });
    };
    define('offsetTop', function () {
      const at = [...(this.parentElement?.children ?? [])].indexOf(this);
      return at * (this.classList.contains('rl-outline-tick') ? 11 : 31);
    });
    define('clientHeight', function () {
      return this.classList.contains('rl-outline-panel') ? 300 : 0;
    });
  });
  afterEach(() => {
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(proto, name, descriptor);
      else Reflect.deleteProperty(proto, name);
    }
    saved.clear();
  });

  it('keeps the line of the section being read in view at rest', () => {
    const { nav, host } = mount(LONG);
    const panel = nav()!.querySelector<HTMLElement>('.rl-outline-panel')!;
    expect(panel.scrollTop).toBe(0);
    // "## Section 30": the 31st heading, 3 lines to a section.
    room.scrolled = 30 * 4 * 30 - 30;
    scrolled(host);
    settle();
    expect(current(nav()!)).toBe(30);
    // Its line, 330 px down the column, is put in the middle of the panel.
    expect(panel.scrollTop).toBe(30 * 11 - 150);
  });

  it('opens with the heading being read in view in its list', () => {
    const { nav, host } = mount(LONG);
    room.scrolled = 30 * 4 * 30 - 30;
    scrolled(host);
    settle();
    const panel = nav()!.querySelector<HTMLElement>('.rl-outline-panel')!;
    mouse(panel, 'mouseenter');
    vi.advanceTimersByTime(100);
    expect(nav()!.dataset['open']).toBe('true');
    expect(panel.scrollTop).toBe(30 * 31 - 150);
  });
});

describe('the outline hidden for want of headings', () => {
  it('says why when the command is run, where the outline has somewhere to say it', () => {
    const notice = vi.fn();
    const { editor } = mount('# Only\n\nText.\n', { notice });
    expect(editor.commands.run('outline.focus')).toBe(true);
    expect(notice).toHaveBeenCalledTimes(1);
    expect(notice.mock.calls[0]![0]).toMatch(/two headings/);
  });

  it('is a command that does nothing, as any, where it has no way to say so', () => {
    const { editor } = mount('# Only\n\nText.\n');
    expect(editor.commands.run('outline.focus')).toBe(false);
  });
});

describe('the outline’s timing and its clean-up', () => {
  it('reads the headings again a pause after the last change, and not a pause after the first', () => {
    const { nav, editor } = mount();
    const at = editor.view.state.doc.toString().indexOf('Nested');
    editor.view.dispatch({ changes: { from: at, to: at + 6, insert: 'Deeper' } });
    vi.advanceTimersByTime(200);
    const first = editor.view.state.doc.toString().indexOf('Second');
    editor.view.dispatch({ changes: { from: first, to: first + 6, insert: 'Last' } });
    // 300 ms after the first change, 100 after the second: the pause begins again at each.
    vi.advanceTimersByTime(100);
    expect(names(nav()!)).toEqual(['Title', 'First', 'Nested', 'Second']);
    vi.advanceTimersByTime(200);
    expect(names(nav()!)).toEqual(['Title', 'First', 'Deeper', 'Last']);
  });

  it('keeps the focus on the same heading when the list is drawn again under it', () => {
    const { nav, editor } = mount();
    editor.commands.run('outline.focus');
    key(buttons(nav()!)[0]!, 'ArrowDown');
    key(buttons(nav()!)[1]!, 'ArrowDown');
    expect(document.activeElement).toBe(buttons(nav()!)[2]);
    // A change somewhere that leaves the headings as they were still draws the list again.
    editor.view.dispatch({ changes: { from: 0, insert: ' ' } });
    settle();
    expect(document.activeElement).toBe(buttons(nav()!)[2]);
  });

  it('closes at once on a click, whatever keeps the pointer over it', () => {
    const { nav } = mount();
    const panel = nav()!.querySelector('.rl-outline-panel')!;
    mouse(panel, 'mouseenter');
    vi.advanceTimersByTime(100);
    expect(nav()!.dataset['open']).toBe('true');
    buttons(nav()!)[1]!.click();
    expect(nav()!.dataset['open']).toBe('false');
  });

  it('stays open while the pointer is on it or the focus is in it, whichever the other leaves', () => {
    const { nav } = mount();
    const panel = nav()!.querySelector('.rl-outline-panel')!;
    const inside = buttons(nav()!)[1]!;
    // The focus comes in, the pointer comes and goes: the focus keeps it open.
    inside.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    mouse(panel, 'mouseenter');
    mouse(panel, 'mouseleave');
    vi.advanceTimersByTime(400);
    expect(nav()!.dataset['open']).toBe('true');
    // The pointer comes in, the focus leaves: the pointer keeps it open.
    mouse(panel, 'mouseenter');
    inside.dispatchEvent(
      new FocusEvent('focusout', { bubbles: true, relatedTarget: document.body }),
    );
    vi.advanceTimersByTime(400);
    expect(nav()!.dataset['open']).toBe('true');
    mouse(panel, 'mouseleave');
    vi.advanceTimersByTime(400);
    expect(nav()!.dataset['open']).toBe('false');
  });

  it('leaves no timer and no listener behind when it is taken out', () => {
    const added: [string, unknown, unknown][] = [];
    const removed: [string, unknown, unknown][] = [];
    for (const target of [document, window] as const) {
      const add = target.addEventListener.bind(target);
      const remove = target.removeEventListener.bind(target);
      vi.spyOn(target, 'addEventListener').mockImplementation(
        (type: string, fn: unknown, o: unknown) => {
          if (type === 'scroll' || type === 'resize') added.push([type, fn, o]);
          add(type, fn as EventListener, o as AddEventListenerOptions);
        },
      );
      vi.spyOn(target, 'removeEventListener').mockImplementation(
        (type: string, fn: unknown, o: unknown) => {
          if (type === 'scroll' || type === 'resize') removed.push([type, fn, o]);
          remove(type, fn as EventListener, o as AddEventListenerOptions);
        },
      );
    }
    const disconnect = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect = disconnect;
      },
    );
    const { nav, editor, remove } = mount();
    const placing = vi.spyOn(geometry, 'pane');
    expect(added.length).toBeGreaterThan(0);
    // A timer of each kind that comes back to the page is pending: the headings read again, the
    // placing, the opening.
    editor.view.dispatch({ changes: { from: 0, insert: ' ' } });
    mouse(nav()!.querySelector('.rl-outline-panel')!, 'mouseenter');
    window.dispatchEvent(new Event('resize'));
    disconnect.mockClear();
    placing.mockClear();
    remove();
    // Nothing that was pending comes back to the page, or asks it anything.
    expect(() => vi.advanceTimersByTime(2000)).not.toThrow();
    expect(nav()).toBeNull();
    expect(placing).not.toHaveBeenCalled();
    // The editor's own listeners stay until it is destroyed: the outline's are its `locateSoon`.
    const ours = added.filter(([, fn]) => (fn as { name?: string }).name === 'locateSoon');
    expect(ours.map(([type]) => type).sort()).toEqual(['resize', 'scroll']);
    for (const [type, fn, options] of ours) {
      expect(
        removed.some(([t, f, o]) => t === type && f === fn && o === options),
        type,
      ).toBe(true);
    }
    expect(disconnect).toHaveBeenCalled();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
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
