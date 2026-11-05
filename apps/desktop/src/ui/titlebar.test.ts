// @vitest-environment happy-dom
import { newestView } from '@redlines/format';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTitleBar, documentFactsLine, wordCount, type TitleBarState } from './titlebar.ts';

const BASE: TitleBarState = {
  name: 'launch-plan.md',
  dirty: false,
  view: 'redlines',
  tracking: false,
  hasRedlines: true,
  sidebarOpen: false,
};

function setup(state: Partial<TitleBarState> = {}) {
  const root = document.createElement('div');
  document.body.append(root);
  const actions = {
    setView: vi.fn(),
    toggleTracking: vi.fn(),
    openReview: vi.fn(),
    toggleSidebar: vi.fn(),
    rename: vi.fn(() => Promise.resolve(true)),
    documentFacts: vi.fn(() => ({ newestText: 'One two three.', savedAt: null as Date | null })),
  };
  const bar = createTitleBar(root, actions);
  bar.update({ ...BASE, ...state });
  const button = (label: string) => {
    const found = root.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    if (!found) throw new Error(`no ${label} button`);
    return found;
  };
  const menu = (label: string) => {
    const found = root.querySelector<HTMLElement>(`[role="menu"][aria-label="${label}"]`);
    if (!found) throw new Error(`no ${label} menu`);
    return found;
  };
  return { root, actions, bar, button, menu };
}

function item(menu: HTMLElement, label: string): HTMLButtonElement {
  const found = [...menu.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]')].find(
    (el) => el.querySelector('.rl-menu-label')?.textContent === label,
  );
  if (!found) throw new Error(`no ${label} item`);
  return found;
}

const enter = (el: Element) => el.dispatchEvent(new PointerEvent('pointerenter'));
const leave = (el: Element) => el.dispatchEvent(new PointerEvent('pointerleave'));
const press = (el: Element, key: string) =>
  el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
const shown = (el: Element) => el.closest('[hidden]') === null;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('renaming from the title bar', () => {
  const field = (root: HTMLElement) => root.querySelector<HTMLInputElement>('.rl-title-field');
  const type = (input: HTMLInputElement, value: string) => {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };

  it('turns the name into a field holding it, with the extension left out of the selection', () => {
    const { root, bar } = setup();
    bar.beginRename();
    const input = field(root);
    expect(input?.value).toBe('launch-plan.md');
    expect([input?.selectionStart, input?.selectionEnd]).toEqual([0, 'launch-plan'.length]);
    expect(document.activeElement).toBe(input);
  });

  it('renames on Return, and puts the name back after', async () => {
    const { root, bar, actions } = setup();
    bar.beginRename();
    const input = field(root);
    if (!input) throw new Error('no field');
    type(input, 'outline.md');
    press(input, 'Enter');
    expect(actions.rename).toHaveBeenCalledWith('outline.md');
    await vi.advanceTimersByTimeAsync(0);
    expect(field(root)).toBeNull();
    expect(root.querySelector('.rl-title-name')?.textContent).toBe('launch-plan.md');
    bar.update({ ...BASE, name: 'outline.md' });
    expect(root.querySelector('.rl-title-name')?.textContent).toBe('outline.md');
  });

  it('leaves the Return that confirms an input method’s text alone', () => {
    const { root, bar, actions } = setup();
    bar.beginRename();
    const input = field(root);
    if (!input) throw new Error('no field');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229 }));
    expect(actions.rename).not.toHaveBeenCalled();
    expect(field(root)).toBe(input);
    press(input, 'Enter');
    expect(actions.rename).toHaveBeenCalledOnce();
  });

  it('cancels on Escape, and does not rename on the blur that follows', () => {
    const { root, bar, actions } = setup();
    bar.beginRename();
    const input = field(root);
    if (!input) throw new Error('no field');
    type(input, 'outline.md');
    press(input, 'Escape');
    expect(field(root)).toBeNull();
    input.dispatchEvent(new FocusEvent('blur'));
    expect(actions.rename).not.toHaveBeenCalled();
  });

  it('renames when the field loses focus', () => {
    const { root, bar, actions } = setup();
    bar.beginRename();
    const input = field(root);
    if (!input) throw new Error('no field');
    type(input, 'outline.md');
    input.dispatchEvent(new FocusEvent('blur'));
    expect(actions.rename).toHaveBeenCalledOnce();
  });

  it('keeps what is typed when the document changes meanwhile', () => {
    const { root, bar } = setup();
    bar.beginRename();
    const input = field(root);
    if (!input) throw new Error('no field');
    type(input, 'outl');
    bar.update({ ...BASE, dirty: true });
    expect(field(root)?.value).toBe('outl');
  });

  it('asks once, and starts only one field', () => {
    const { root, bar, actions } = setup();
    bar.beginRename();
    bar.beginRename();
    expect(root.querySelectorAll('.rl-title-field')).toHaveLength(1);
    const input = field(root);
    if (!input) throw new Error('no field');
    press(input, 'Enter');
    press(input, 'Enter');
    input.dispatchEvent(new FocusEvent('blur'));
    expect(actions.rename).toHaveBeenCalledOnce();
  });
});

describe('title bar', () => {
  it('hover opens the view menu after 120 ms', () => {
    const { button, menu } = setup();
    enter(button('View'));
    vi.advanceTimersByTime(119);
    expect(shown(menu('View'))).toBe(false);
    vi.advanceTimersByTime(1);
    expect(shown(menu('View'))).toBe(true);
  });

  it('leaving closes it after 200 ms', () => {
    const { button, menu } = setup();
    enter(button('View'));
    vi.advanceTimersByTime(120);
    leave(button('View'));
    vi.advanceTimersByTime(199);
    expect(shown(menu('View'))).toBe(true);
    vi.advanceTimersByTime(1);
    expect(shown(menu('View'))).toBe(false);
  });

  it('a short pass over the icon opens nothing', () => {
    const { button, menu } = setup();
    enter(button('View'));
    vi.advanceTimersByTime(60);
    leave(button('View'));
    vi.advanceTimersByTime(500);
    expect(shown(menu('View'))).toBe(false);
  });

  it('moving from button to menu keeps it open', () => {
    const { button, menu } = setup();
    enter(button('View'));
    vi.advanceTimersByTime(120);
    leave(button('View'));
    enter(menu('View'));
    vi.advanceTimersByTime(1000);
    expect(shown(menu('View'))).toBe(true);
    leave(menu('View'));
    vi.advanceTimersByTime(200);
    expect(shown(menu('View'))).toBe(false);
  });

  it('moving to the other icon switches menus at once', () => {
    const { button, menu } = setup();
    enter(button('View'));
    vi.advanceTimersByTime(120);
    leave(button('View'));
    enter(button('Review'));
    expect(shown(menu('Review'))).toBe(true);
    expect(shown(menu('View'))).toBe(false);
  });

  it('offers Redlines whatever the document holds', () => {
    const { actions, bar, button, menu } = setup({ hasRedlines: false, view: 'clean' });
    button('View').click();
    const redlines = () => item(menu('View'), 'Redlines');
    expect(shown(redlines())).toBe(true);
    expect(redlines().disabled).toBe(false);
    expect(redlines().textContent).toContain('⌥⌘2');
    redlines().click();
    expect(actions.setView).toHaveBeenCalledWith('redlines');
    // With redlines, or with the last one gone while it is the view that is shown.
    bar.update({ ...BASE, hasRedlines: true });
    expect(shown(redlines()) && !redlines().disabled).toBe(true);
    bar.update({ ...BASE, hasRedlines: false, view: 'redlines' });
    expect(shown(redlines()) && !redlines().disabled).toBe(true);
    expect(redlines().getAttribute('aria-checked')).toBe('true');
  });

  it('keeps Review changes for documents with redlines', () => {
    const { bar, menu } = setup({ hasRedlines: false, view: 'clean' });
    expect(item(menu('Review'), 'Review changes').disabled).toBe(true);
    bar.update({ ...BASE, hasRedlines: true });
    expect(item(menu('Review'), 'Review changes').disabled).toBe(false);
  });

  it('tints the current view', () => {
    const { menu } = setup({ view: 'redlines' });
    expect(item(menu('View'), 'Redlines').getAttribute('aria-checked')).toBe('true');
    expect(item(menu('View'), 'Raw').getAttribute('aria-checked')).toBe('false');
  });

  it('clicking Raw calls setView(raw)', () => {
    const { actions, button, menu } = setup();
    enter(button('View'));
    vi.advanceTimersByTime(120);
    item(menu('View'), 'Raw').click();
    expect(actions.setView).toHaveBeenCalledWith('raw');
  });

  it('the pen is red while tracking', () => {
    const { bar, button, menu } = setup();
    expect(button('Review').classList.contains('rl-pen-on')).toBe(false);
    bar.update({ ...BASE, tracking: true });
    expect(button('Review').classList.contains('rl-pen-on')).toBe(true);
    expect(item(menu('Review'), 'Track changes').getAttribute('aria-checked')).toBe('true');
    bar.update({ ...BASE, tracking: false });
    expect(button('Review').classList.contains('rl-pen-on')).toBe(false);
  });

  it('the Review menu switches tracking and starts a review', () => {
    const { actions, button, menu } = setup();
    button('Review').click();
    const review = menu('Review');
    expect(item(review, 'Track changes').textContent).toContain('⇧⌘E');
    expect(item(review, 'Review changes').textContent).toContain('⌥⌘]');
    item(review, 'Track changes').click();
    expect(actions.toggleTracking).toHaveBeenCalledOnce();
    item(review, 'Review changes').click();
    expect(actions.openReview).toHaveBeenCalledOnce();
    expect(shown(review)).toBe(false);
  });

  it('the files tooltip shows the shortcut', () => {
    const { root, actions, button } = setup();
    enter(button('Show files'));
    const tip = root.querySelector<HTMLElement>('[role="tooltip"]');
    vi.advanceTimersByTime(399);
    expect(tip && shown(tip)).toBe(false);
    vi.advanceTimersByTime(1);
    expect(tip && shown(tip)).toBe(true);
    expect(tip?.textContent).toContain('Show files');
    expect(tip?.textContent).toContain('⌃⌘S');
    leave(button('Show files'));
    expect(tip && shown(tip)).toBe(false);
    button('Show files').click();
    expect(actions.toggleSidebar).toHaveBeenCalledOnce();
  });

  it('the button has aria-haspopup and aria-expanded', () => {
    const { button, menu } = setup();
    const view = button('View');
    expect(view.getAttribute('aria-haspopup')).toBe('menu');
    expect(view.getAttribute('aria-expanded')).toBe('false');
    expect(view.getAttribute('aria-controls')).toBe(menu('View').id);
    enter(view);
    vi.advanceTimersByTime(120);
    expect(view.getAttribute('aria-expanded')).toBe('true');
  });

  it('click opens the menu and keeps it open; a second click closes it', () => {
    const { button, menu } = setup();
    button('View').click();
    expect(shown(menu('View'))).toBe(true);
    leave(button('View'));
    vi.advanceTimersByTime(1000);
    expect(shown(menu('View'))).toBe(true);
    button('View').click();
    expect(shown(menu('View'))).toBe(false);
  });

  it('a click on a menu that hover opened keeps it open', () => {
    const { button, menu } = setup();
    enter(button('View'));
    vi.advanceTimersByTime(120);
    button('View').click();
    leave(button('View'));
    vi.advanceTimersByTime(1000);
    expect(shown(menu('View'))).toBe(true);
  });

  it('Esc closes the menu', () => {
    const { button, menu } = setup();
    button('View').click();
    press(document.body, 'Escape');
    expect(shown(menu('View'))).toBe(false);
  });

  it('the arrow keys move between items', () => {
    const { button, menu } = setup({ hasRedlines: false, view: 'clean' });
    press(button('View'), 'ArrowDown');
    const view = menu('View');
    expect(shown(view)).toBe(true);
    expect(document.activeElement).toBe(item(view, 'Clean'));
    press(view, 'ArrowDown');
    expect(document.activeElement).toBe(item(view, 'Redlines'));
    press(view, 'ArrowDown');
    expect(document.activeElement).toBe(item(view, 'Raw'));
    press(view, 'ArrowDown');
    expect(document.activeElement).toBe(item(view, 'Clean'));
    press(view, 'ArrowUp');
    expect(document.activeElement).toBe(item(view, 'Raw'));
    press(view, 'Escape');
    expect(shown(view)).toBe(false);
    expect(document.activeElement).toBe(button('View'));
  });

  it('shows the file name, and Edited when there are unsaved edits', () => {
    const { root, bar } = setup();
    const title = root.querySelector('.rl-title');
    expect(title?.textContent).toBe('launch-plan.md');
    bar.update({ ...BASE, dirty: true });
    expect(title?.textContent).toBe('launch-plan.md — Edited');
  });
});

describe('the file name on hover', () => {
  it('counts the words when the pointer comes, not before', () => {
    const { root, actions } = setup();
    const title = root.querySelector<HTMLElement>('.rl-title');
    expect(title?.title).toBe('');
    expect(actions.documentFacts).not.toHaveBeenCalled();

    actions.documentFacts.mockReturnValue({ newestText: 'Four words in total.', savedAt: null });
    title?.dispatchEvent(new PointerEvent('pointerenter'));
    expect(title?.title).toBe('4 words');
    title?.dispatchEvent(new PointerEvent('pointerleave'));
    expect(title?.title).toBe('');
  });
});

describe('wordCount', () => {
  it('counts runs of text in the newest text', () => {
    expect(wordCount('')).toBe(0);
    expect(wordCount('  \n\t ')).toBe(0);
    expect(wordCount('One  two\n\nthree-four, five.')).toBe(4);
    // Markdown's own signs between the words are not words.
    expect(wordCount('# Title\n\n- one\n- two\n\n---\n\n| a | b |\n|---|---|\n')).toBe(5);
  });

  it('is the newest text of a document, with no markers, deleted text or ledger', () => {
    const source = [
      'Keep <!--ins k3x9-->this<!--/k3x9--> one.<!--del w2rf  gone words here-->',
      '',
      '<!-- redlines',
      'version: 1',
      'people:',
      '  bo: {name: Bo Chen}',
      'marks:',
      '  k3x9: {by: bo, at: 2026-10-31T09:30Z}',
      '  w2rf: {by: bo, at: 2026-10-31T09:31Z}',
      '-->',
      '',
    ].join('\n');
    expect(wordCount(newestView(source).text)).toBe(3);
  });
});

describe('documentFactsLine', () => {
  it('says the words, thousands set apart, and when it was saved', () => {
    expect(documentFactsLine('word '.repeat(1204), null)).toBe('1,204 words');
    expect(documentFactsLine('word', null)).toBe('1 word');
    expect(documentFactsLine('a b', new Date(2026, 10, 5, 15, 41))).toMatch(
      /^2 words · Saved 3:41\s?PM$/,
    );
  });
});
