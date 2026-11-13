// @vitest-environment happy-dom
import type { CommandRegistry } from '@redlines/editor';
import { newestView } from '@redlines/format';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appMenuModel, type MenuCommands, type MenuRow } from '../menu-model.ts';
import {
  createTitleBar,
  documentFactsLine,
  TOOLTIP_MS,
  TRACKING_ARIA_KEY,
  TRACKING_KEY,
  VIEW_ARIA_KEYS,
  VIEW_KEYS,
  wordCount,
  type TitleBarState,
} from './titlebar.ts';

const BASE: TitleBarState = {
  name: 'launch-plan.md',
  dirty: false,
  fileDraggable: true,
  view: 'redlines',
  tracking: false,
  hasRedlines: true,
  sidebarOpen: false,
  showResolved: false,
};

/** The bars the test made, which are taken down after it: an open menu listens on the document. */
const made: { destroy(): void }[] = [];

function setup(state: Partial<TitleBarState> = {}) {
  const root = document.createElement('div');
  document.body.append(root);
  const actions = {
    setView: vi.fn(),
    toggleTracking: vi.fn(),
    openReview: vi.fn(),
    toggleResolved: vi.fn(),
    toggleSidebar: vi.fn(),
    rename: vi.fn(() => Promise.resolve(true)),
    renameDocument: vi.fn(),
    dragFile: vi.fn(),
    scrollPage: vi.fn(),
    documentFacts: vi.fn(() => ({ newestText: 'One two three.', savedAt: null as Date | null })),
  };
  const bar = createTitleBar(root, actions);
  made.push(bar);
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
/** The pointer comes to an icon and rests there until its menu has opened. */
const hover = (el: Element) => {
  enter(el);
  vi.advanceTimersByTime(120);
};
/** A click as a mouse makes it (a key's has no `detail`). */
const click = (el: Element) =>
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
const press = (el: Element, key: string) =>
  el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
const shown = (el: Element) => el.closest('[hidden]') === null;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  for (const bar of made.splice(0)) bar.destroy();
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

describe('double-clicking the file name', () => {
  // Tauri's drag script zooms the window on the mouseup of a double-click anywhere in the bar
  // (macOS), and it listens on the document. This stands in for it. In the app WebKit sends the
  // page no dblclick for it (nor the click before it), so that mouseup is all there is to go by.
  const zoomed = vi.fn();
  beforeEach(() => {
    zoomed.mockClear();
    document.addEventListener('mouseup', zoomed);
  });
  afterEach(() => document.removeEventListener('mouseup', zoomed));

  const mouse = (target: Element, type: string, detail: number, button = 0, x = 100, y = 20) =>
    target.dispatchEvent(
      new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        button,
        detail,
        clientX: x,
        clientY: y,
      }),
    );
  const doubleClick = (target: Element) => {
    mouse(target, 'mousedown', 1);
    mouse(target, 'mouseup', 1);
    mouse(target, 'mousedown', 2);
    mouse(target, 'mouseup', 2);
  };
  const nameOf = (root: HTMLElement) => {
    const found = root.querySelector<HTMLElement>('.rl-title');
    if (!found) throw new Error('no file name');
    return found;
  };

  it('asks to rename the document, as File › Rename does', () => {
    const { root, actions } = setup();
    doubleClick(nameOf(root));
    expect(actions.renameDocument).toHaveBeenCalledOnce();
    // It is the app's to say what that is: a field for a file, Save As for an Untitled document.
    expect(actions.rename).not.toHaveBeenCalled();
  });

  it('asks the same for an Untitled document, which has no file to rename', () => {
    const { root, actions } = setup({ name: 'Untitled.md', fileDraggable: false });
    doubleClick(nameOf(root));
    expect(actions.renameDocument).toHaveBeenCalledOnce();
  });

  it('asks once, whether or not the system also sends a dblclick', () => {
    const { root, actions } = setup();
    doubleClick(nameOf(root));
    mouse(nameOf(root), 'click', 2);
    mouse(nameOf(root), 'dblclick', 2);
    expect(actions.renameDocument).toHaveBeenCalledOnce();
  });

  it('takes the double-click away from the window, which would zoom on it', () => {
    const { root } = setup();
    doubleClick(nameOf(root));
    // The first click's mouseup is the window's, as a drag's end is; the second's is the name's.
    expect(zoomed).toHaveBeenCalledOnce();
  });

  it('leaves a single click on the name to the window, which a drag starts with', () => {
    const { root, actions } = setup();
    mouse(nameOf(root), 'mousedown', 1);
    mouse(nameOf(root), 'mouseup', 1);
    expect(zoomed).toHaveBeenCalledOnce();
    expect(actions.renameDocument).not.toHaveBeenCalled();
  });

  it('answers only the primary button, and a double-click only', () => {
    const { root, actions } = setup();
    mouse(nameOf(root), 'mousedown', 2, 2);
    mouse(nameOf(root), 'mouseup', 2, 2);
    mouse(nameOf(root), 'mousedown', 3);
    mouse(nameOf(root), 'mouseup', 3);
    expect(actions.renameDocument).not.toHaveBeenCalled();
    // A triple-click's third press is nobody's: it reaches the window as it did.
    expect(zoomed).toHaveBeenCalledTimes(2);
  });

  it('answers a double-click whose second press began on the name, and nothing else', () => {
    const { root, actions } = setup();
    const name = nameOf(root);
    // A word selected by a double-click-drag in the text, let go of over the name: the press began
    // elsewhere, and the release is no one's but the page's own listeners'.
    mouse(document.body, 'mousedown', 2);
    mouse(name, 'mouseup', 2);
    expect(actions.renameDocument).not.toHaveBeenCalled();
    expect(zoomed).toHaveBeenCalledOnce();
    // And a press that began on the name answers once.
    zoomed.mockClear();
    mouse(name, 'mousedown', 2);
    mouse(name, 'mouseup', 2);
    mouse(name, 'mouseup', 2);
    expect(actions.renameDocument).toHaveBeenCalledOnce();
    expect(zoomed).toHaveBeenCalledOnce();
  });

  it('answers a double-click that stayed where it was, give or take a wobble of the hand', () => {
    const { root, actions } = setup();
    const name = nameOf(root);
    mouse(name, 'mousedown', 2, 0, 100, 20);
    mouse(name, 'mouseup', 2, 0, 102, 21);
    expect(actions.renameDocument).toHaveBeenCalledOnce();
    // Dragged off to another place on the name before the release, it was no double-click.
    mouse(name, 'mousedown', 2, 0, 100, 20);
    mouse(name, 'mouseup', 2, 0, 130, 20);
    expect(actions.renameDocument).toHaveBeenCalledOnce();
    expect(zoomed).toHaveBeenCalledOnce();
  });

  it('leaves a double-click anywhere else on the bar to the window, which zooms', () => {
    const { root, actions } = setup();
    const bar = root.querySelector('.rl-titlebar');
    const group = root.querySelector('.rl-title-group');
    if (!bar || !group) throw new Error('no bar');
    mouse(bar, 'mousedown', 2);
    mouse(bar, 'mouseup', 2);
    mouse(group, 'mousedown', 2);
    mouse(group, 'mouseup', 2);
    expect(zoomed).toHaveBeenCalledTimes(2);
    expect(actions.renameDocument).not.toHaveBeenCalled();
    expect(root.querySelector('.rl-title-field')).toBeNull();
  });

  it('does not start another rename from a double-click in the field', () => {
    const { root, bar, actions } = setup();
    bar.beginRename();
    const input = root.querySelector<HTMLInputElement>('.rl-title-field');
    if (!input) throw new Error('no field');
    doubleClick(input);
    expect(actions.renameDocument).not.toHaveBeenCalled();
  });
});

describe('the document icon', () => {
  const iconOf = (root: HTMLElement) => root.querySelector<HTMLElement>('.rl-doc-icon');
  const pointer = (type: string, x: number, buttons: number, target: Element | Document, y = 20) =>
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerType: 'mouse',
        button: 0,
        buttons,
        clientX: x,
        clientY: y,
      }),
    );

  it('sits left of the file name, for a document with a file', () => {
    const { root } = setup();
    const icon = iconOf(root);
    const name = root.querySelector('.rl-title');
    if (!icon || !name) throw new Error('no icon');
    expect(shown(icon)).toBe(true);
    expect(icon.querySelector('svg')).not.toBeNull();
    expect(icon.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Beside the name, in the group the two are centered as one.
    expect(icon.parentElement).toBe(name.parentElement);
  });

  it('is hidden for an Untitled document, and shown once it has a file', () => {
    const { root, bar } = setup({ name: 'Untitled.md', fileDraggable: false });
    const icon = iconOf(root);
    if (!icon) throw new Error('no icon');
    expect(shown(icon)).toBe(false);
    bar.update({ ...BASE, fileDraggable: true });
    expect(shown(icon)).toBe(true);
    bar.update({ ...BASE, fileDraggable: false });
    expect(shown(icon)).toBe(false);
  });

  it('is left out of the bar’s drag region, so that a drag on it is not the window’s', () => {
    const { root } = setup();
    // Tauri's drag script: "false" blocks the bar's "deep" region for what is under it.
    expect(root.querySelector('.rl-titlebar')?.getAttribute('data-tauri-drag-region')).toBe('deep');
    expect(iconOf(root)?.getAttribute('data-tauri-drag-region')).toBe('false');
  });

  it('starts dragging the file once the pointer has moved a few pixels with the button down', () => {
    const { root, actions } = setup();
    const icon = iconOf(root);
    if (!icon) throw new Error('no icon');
    pointer('pointerdown', 100, 1, icon);
    pointer('pointermove', 102, 1, document);
    expect(actions.dragFile).not.toHaveBeenCalled();
    pointer('pointermove', 106, 1, document);
    expect(actions.dragFile).toHaveBeenCalledOnce();
    // One drag for one press, however far the pointer goes on.
    pointer('pointermove', 140, 1, document);
    pointer('pointermove', 180, 1, document);
    expect(actions.dragFile).toHaveBeenCalledOnce();
  });

  it('measures how far the pointer went in both directions', () => {
    const { root, actions } = setup();
    const icon = iconOf(root);
    if (!icon) throw new Error('no icon');
    // Straight down, 6 px: as far as 6 across.
    pointer('pointerdown', 100, 1, icon, 20);
    pointer('pointermove', 100, 1, document, 26);
    expect(actions.dragFile).toHaveBeenCalledOnce();
    // Diagonally 3 and 3, which is 4.2: past the 4 px, though neither way is.
    pointer('pointerdown', 100, 1, icon, 20);
    pointer('pointermove', 103, 1, document, 23);
    expect(actions.dragFile).toHaveBeenCalledTimes(2);
  });

  it('starts nothing on a click, and takes no part in what the pointer does after it', () => {
    const { root, actions } = setup();
    const icon = iconOf(root);
    if (!icon) throw new Error('no icon');
    pointer('pointerdown', 100, 1, icon);
    pointer('pointerup', 100, 0, document);
    pointer('pointermove', 160, 1, document);
    pointer('pointermove', 200, 0, document);
    expect(actions.dragFile).not.toHaveBeenCalled();
  });

  it('forgets a press whose release it never saw, as a drag the system took over leaves', () => {
    const { root, actions } = setup();
    const icon = iconOf(root);
    if (!icon) throw new Error('no icon');
    pointer('pointerdown', 100, 1, icon);
    // The button is up when the pointer next moves.
    pointer('pointermove', 160, 0, document);
    pointer('pointermove', 200, 1, document);
    expect(actions.dragFile).not.toHaveBeenCalled();
    // And the next press starts afresh.
    pointer('pointerdown', 300, 1, icon);
    pointer('pointermove', 310, 1, document);
    expect(actions.dragFile).toHaveBeenCalledOnce();
  });

  it('measures from the press it is in, not from an earlier one that was never released', () => {
    const { root, actions } = setup();
    const icon = iconOf(root);
    if (!icon) throw new Error('no icon');
    pointer('pointerdown', 100, 1, icon);
    pointer('pointerdown', 300, 1, icon);
    // 4 px from the second press, 204 from the first, whose watch the second took over.
    pointer('pointermove', 304, 1, document);
    expect(actions.dragFile).toHaveBeenCalledOnce();
  });

  it('answers the left button of a mouse only, not another button or a finger', () => {
    const { root, actions } = setup();
    const icon = iconOf(root);
    if (!icon) throw new Error('no icon');
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 });
    icon.dispatchEvent(down);
    // Keeps the keyboard where it was: no focus moves to the icon, no text is selected.
    expect(down.defaultPrevented).toBe(true);
    // The right button pressed, with the left one held too: the press is not the left's.
    icon.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        pointerType: 'mouse',
        button: 2,
        buttons: 3,
      }),
    );
    pointer('pointermove', 400, 3, document);
    // A finger: a touch has no drag of the file to start.
    icon.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        pointerType: 'touch',
        button: 0,
        buttons: 1,
        clientX: 100,
        clientY: 20,
      }),
    );
    pointer('pointermove', 400, 1, document);
    expect(actions.dragFile).not.toHaveBeenCalled();
  });

  it('lets go of a press when the bar goes', () => {
    const { root, bar, actions } = setup();
    const icon = iconOf(root);
    if (!icon) throw new Error('no icon');
    pointer('pointerdown', 100, 1, icon);
    bar.destroy();
    pointer('pointermove', 200, 1, document);
    expect(actions.dragFile).not.toHaveBeenCalled();
  });

  it('says what it is for, for those who cannot see it', () => {
    const { root, bar } = setup();
    const icon = iconOf(root);
    expect(icon?.getAttribute('role')).toBe('img');
    expect(icon?.getAttribute('aria-label')).toBe('launch-plan.md, document icon');
    expect(icon?.title).toBe('Drag to copy the file');
    // With edits the file is behind: what is handed over is the file as it was last saved.
    bar.update({ ...BASE, dirty: true });
    expect(icon?.title).toBe('Drag to copy the file as saved');
    bar.update({ ...BASE, dirty: false });
    expect(icon?.title).toBe('Drag to copy the file');
  });

  it('stays away from the hover facts and the rename field', () => {
    const { root, bar } = setup();
    bar.beginRename();
    // The field takes the name's place, and the icon stays beside it.
    const icon = iconOf(root);
    const input = root.querySelector('.rl-title-field');
    expect(icon && shown(icon)).toBe(true);
    expect(icon?.parentElement).toBe(input?.parentElement?.parentElement);
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

  it('closes its menus when asked', () => {
    const { bar, button, menu } = setup();
    hover(button('View'));
    expect(shown(menu('View'))).toBe(true);
    bar.closeMenus();
    expect(shown(menu('View'))).toBe(false);
    leave(button('View'));
    hover(button('Track Changes'));
    expect(shown(menu('Review'))).toBe(true);
    bar.closeMenus();
    expect(shown(menu('Review'))).toBe(false);
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
    enter(button('Track Changes'));
    expect(shown(menu('Review'))).toBe(true);
    expect(shown(menu('View'))).toBe(false);
  });

  it('offers Redlines whatever the document holds', () => {
    const { actions, bar, button, menu } = setup({ hasRedlines: false, view: 'clean' });
    hover(button('View'));
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

  it('lists Clean, Redlines and Raw in order, with their keys and one check mark', () => {
    const { actions, menu, button } = setup({ view: 'clean' });
    hover(button('View'));
    const rows = [...menu('View').querySelectorAll('[role="menuitemradio"]')];
    // Simple is Redlines' simple look, switched by a click on a change bar and by nothing here.
    expect(rows.map((row) => row.textContent)).toEqual(['Clean⌥⌘1', 'Redlines⌥⌘2', 'Raw⌥⌘3']);
    expect(rows.map((row) => row.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);
    // Each has an icon of its own.
    expect(rows.every((row) => row.querySelector('svg'))).toBe(true);
    (rows[1] as HTMLElement).click();
    expect(actions.setView).toHaveBeenCalledWith('redlines');
  });

  it('checks Redlines, and no other view, in its simple look', () => {
    const { menu } = setup({ view: 'simple' });
    const rows = [...menu('View').querySelectorAll('[role="menuitemradio"]')];
    expect(rows.map((row) => row.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);
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
    expect(button('Track Changes').classList.contains('rl-pen-on')).toBe(false);
    bar.update({ ...BASE, tracking: true });
    expect(button('Track Changes').classList.contains('rl-pen-on')).toBe(true);
    expect(item(menu('Review'), 'Track changes').getAttribute('aria-checked')).toBe('true');
    bar.update({ ...BASE, tracking: false });
    expect(button('Track Changes').classList.contains('rl-pen-on')).toBe(false);
  });

  it('the Review menu switches tracking and starts a review', () => {
    const { actions, button, menu } = setup();
    hover(button('Track Changes'));
    const review = menu('Review');
    expect(item(review, 'Track changes').textContent).toContain('⇧⌘E');
    expect(item(review, 'Review changes').textContent).toContain('⌥⌘]');
    item(review, 'Track changes').click();
    expect(actions.toggleTracking).toHaveBeenCalledOnce();
    item(review, 'Review changes').click();
    expect(actions.openReview).toHaveBeenCalledOnce();
    expect(shown(review)).toBe(false);
  });

  it('the Review menu checks Show resolved comments, and switches it', () => {
    const { actions, bar, button, menu } = setup();
    hover(button('Track Changes'));
    const review = menu('Review');
    const row = item(review, 'Show resolved comments');
    expect(row.getAttribute('role')).toBe('menuitemcheckbox');
    expect(row.getAttribute('aria-checked')).toBe('false');
    // Its own glyph, not the View button's eye.
    expect(row.querySelector('svg')?.innerHTML).not.toBe(
      button('View').querySelector('svg')?.innerHTML,
    );
    bar.update({ ...BASE, showResolved: true });
    expect(item(menu('Review'), 'Show resolved comments').getAttribute('aria-checked')).toBe(
      'true',
    );
    // Any document can show them: it isn't tied to the document having redlines.
    bar.update({ ...BASE, hasRedlines: false });
    expect(item(menu('Review'), 'Show resolved comments').disabled).toBe(false);
    item(menu('Review'), 'Show resolved comments').click();
    expect(actions.toggleResolved).toHaveBeenCalledOnce();
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

  it('the arrow key opens the menu and keeps it open until Esc, a click elsewhere or the icon', () => {
    const { button, menu } = setup();
    press(button('View'), 'ArrowDown');
    expect(shown(menu('View'))).toBe(true);
    leave(button('View'));
    vi.advanceTimersByTime(1000);
    expect(shown(menu('View'))).toBe(true);
    // A click on the icon acts, and takes its menu away with it.
    click(button('View'));
    expect(shown(menu('View'))).toBe(false);
  });

  it('Esc closes the menu', () => {
    const { button, menu } = setup();
    hover(button('View'));
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

describe('the bar floating over the page', () => {
  const wheel = (target: Element, init: WheelEventInit) => {
    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });
    // The modifier is the event's own in a browser; happy-dom drops it from the init.
    if (init.ctrlKey) Object.defineProperty(event, 'ctrlKey', { value: true });
    target.dispatchEvent(event);
    return event;
  };

  it('scrolls the page when the wheel turns over it, as over the text it floats on', () => {
    const { root, actions } = setup();
    const bar = root.querySelector('.rl-titlebar');
    if (!bar) throw new Error('no bar');
    const event = wheel(bar, { deltaX: 3, deltaY: 40 });
    expect(actions.scrollPage).toHaveBeenCalledWith(3, 40);
    expect(event.defaultPrevented).toBe(true);
    // From anything in the bar: the name, the icons.
    wheel(root.querySelector('.rl-title') ?? bar, { deltaX: 0, deltaY: -12 });
    expect(actions.scrollPage).toHaveBeenLastCalledWith(0, -12);
  });

  it('turns lines into pixels for a wheel that counts in lines', () => {
    const { root, actions } = setup();
    const bar = root.querySelector('.rl-titlebar');
    if (!bar) throw new Error('no bar');
    wheel(bar, { deltaY: 3, deltaMode: 1 });
    expect(actions.scrollPage).toHaveBeenCalledWith(0, 48);
  });

  it('leaves a pinch to the text size, and a wheel over an open menu to the menu', () => {
    const { root, actions, button, menu } = setup();
    const bar = root.querySelector('.rl-titlebar');
    if (!bar) throw new Error('no bar');
    // A pinch on a trackpad arrives as a wheel with the control key down.
    const pinch = wheel(bar, { deltaY: -5, ctrlKey: true });
    expect(pinch.defaultPrevented).toBe(false);
    enter(button('View'));
    vi.advanceTimersByTime(120);
    wheel(menu('View'), { deltaY: 30 });
    expect(actions.scrollPage).not.toHaveBeenCalled();
  });

  it('says how tall it is, for the room the page keeps under it', () => {
    const { root, bar } = setup();
    const element = root.querySelector('.rl-titlebar');
    if (!element) throw new Error('no bar');
    // 52 points: as many CSS pixels as the window zoom makes of them.
    element.getBoundingClientRect = () => new DOMRect(0, 0, 800, 41.6);
    expect(bar.height()).toBe(41.6);
    element.getBoundingClientRect = () => new DOMRect(0, 0, 800, 65);
    expect(bar.height()).toBe(65);
  });

  it('says how much of the page’s top it keeps, its fade included, which the text scrolls clear of', () => {
    const { root, bar } = setup();
    const element = root.querySelector('.rl-titlebar');
    if (!element) throw new Error('no bar');
    // The bar is 52 points and its fade ends 64 points down: whatever a point is worth in pixels.
    element.getBoundingClientRect = () => new DOMRect(0, 0, 800, 52);
    expect(bar.room()).toBe(64);
    element.getBoundingClientRect = () => new DOMRect(0, 0, 800, 41.6);
    expect(bar.room()).toBeCloseTo(51.2, 9);
  });
});

describe('a click on the View and Review icons', () => {
  it('switches between Clean and Redlines on the View icon', () => {
    const { actions, bar, button } = setup({ view: 'redlines' });
    click(button('View'));
    expect(actions.setView).toHaveBeenLastCalledWith('clean');
    bar.update({ ...BASE, view: 'clean' });
    click(button('View'));
    expect(actions.setView).toHaveBeenLastCalledWith('redlines');
    expect(actions.setView).toHaveBeenCalledTimes(2);
  });

  it('takes the simple look for Redlines, which it switches from', () => {
    const { actions, button } = setup({ view: 'simple' });
    click(button('View'));
    expect(actions.setView).toHaveBeenCalledWith('clean');
  });

  it('goes back from Raw to the one of Clean and Redlines that was shown last', () => {
    const { actions, bar, button } = setup({ view: 'clean' });
    bar.update({ ...BASE, view: 'raw' });
    click(button('View'));
    expect(actions.setView).toHaveBeenLastCalledWith('clean');
    bar.update({ ...BASE, view: 'redlines' });
    bar.update({ ...BASE, view: 'raw' });
    click(button('View'));
    expect(actions.setView).toHaveBeenLastCalledWith('redlines');
    // The simple look is a look of Redlines.
    bar.update({ ...BASE, view: 'simple' });
    bar.update({ ...BASE, view: 'raw' });
    click(button('View'));
    expect(actions.setView).toHaveBeenLastCalledWith('redlines');
  });

  it('goes to Redlines from a Raw that no other view came before', () => {
    const { actions, button } = setup({ view: 'raw' });
    click(button('View'));
    expect(actions.setView).toHaveBeenCalledWith('redlines');
  });

  it('turns Track Changes on and off on the pen, as the key does', () => {
    const { actions, bar, button } = setup({ tracking: false });
    click(button('Track Changes'));
    expect(actions.toggleTracking).toHaveBeenCalledOnce();
    bar.update({ ...BASE, tracking: true });
    click(button('Track Changes'));
    expect(actions.toggleTracking).toHaveBeenCalledTimes(2);
    expect(actions.setView).not.toHaveBeenCalled();
  });

  it('is what Space or Return does on a focused icon, which the browser sends as a click', () => {
    // A click that a key makes has no position: it is `detail` 0, and `click()` makes one.
    const { actions, button, menu } = setup({ view: 'clean' });
    button('View').click();
    expect(actions.setView).toHaveBeenCalledWith('redlines');
    button('Track Changes').click();
    expect(actions.toggleTracking).toHaveBeenCalledOnce();
    expect(shown(menu('View'))).toBe(false);
    expect(shown(menu('Review'))).toBe(false);
  });

  it('opens no menu, which hover and the arrow keys do', () => {
    const { button, menu } = setup();
    click(button('View'));
    click(button('Track Changes'));
    expect(shown(menu('View'))).toBe(false);
    expect(shown(menu('Review'))).toBe(false);
    press(button('Track Changes'), 'ArrowDown');
    expect(shown(menu('Review'))).toBe(true);
    expect(document.activeElement).toBe(item(menu('Review'), 'Track changes'));
    press(menu('Review'), 'Escape');
    press(button('View'), 'ArrowUp');
    expect(shown(menu('View'))).toBe(true);
  });

  it('closes a menu that hover opened, and acts', () => {
    const { actions, button, menu } = setup({ view: 'redlines' });
    hover(button('View'));
    expect(shown(menu('View'))).toBe(true);
    click(button('View'));
    expect(shown(menu('View'))).toBe(false);
    expect(actions.setView).toHaveBeenCalledOnce();
    // The pointer that stays does not open it again: the menu comes back when the pointer has left
    // and returned.
    vi.advanceTimersByTime(1000);
    expect(shown(menu('View'))).toBe(false);
    leave(button('View'));
    hover(button('View'));
    expect(shown(menu('View'))).toBe(true);
  });

  it('closes a menu that a key opened, and acts', () => {
    const { actions, button, menu } = setup({ tracking: false });
    press(button('Track Changes'), 'ArrowDown');
    expect(shown(menu('Review'))).toBe(true);
    click(button('Track Changes'));
    expect(shown(menu('Review'))).toBe(false);
    expect(actions.toggleTracking).toHaveBeenCalledOnce();
  });

  it('acts before the menu would have opened, and the menu does not open after', () => {
    const { actions, button, menu } = setup();
    enter(button('Track Changes'));
    vi.advanceTimersByTime(60);
    click(button('Track Changes'));
    vi.advanceTimersByTime(1000);
    expect(actions.toggleTracking).toHaveBeenCalledOnce();
    expect(shown(menu('Review'))).toBe(false);
  });

  it('leaves the menu’s own items to choose for themselves', () => {
    const { actions, button, menu } = setup({ view: 'redlines' });
    hover(button('View'));
    item(menu('View'), 'Raw').click();
    expect(actions.setView).toHaveBeenCalledOnce();
    expect(actions.setView).toHaveBeenCalledWith('raw');
  });
});

describe('the icons and the document’s keyboard focus', () => {
  it('leaves the caret and the keyboard focus where they were when the pointer presses an icon', () => {
    const { button } = setup();
    for (const label of ['View', 'Track Changes', 'Show files']) {
      const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
      button(label).dispatchEvent(press);
      expect(press.defaultPrevented, label).toBe(true);
    }
  });
});

describe('the keys the icons name', () => {
  /** The rows of the menu bar, in every menu and submenu. */
  const allRows = (rows: readonly MenuRow[]): MenuRow[] =>
    rows.flatMap((row) => ('rows' in row ? allRows(row.rows) : [row]));
  const accelerator = (text: string) => {
    const registry = {
      register: () => () => {},
      list: () => [],
      run: () => true,
    } satisfies CommandRegistry;
    const model = appMenuModel({} as MenuCommands, registry);
    const found = model.menus
      .flatMap((menu) => allRows(menu.rows))
      .find((row) => 'text' in row && row.text === text && 'accelerator' in row);
    if (!found || !('accelerator' in found) || !found.accelerator) throw new Error(`no ${text}`);
    return found.accelerator;
  };
  /** 'Alt+CmdOrCtrl+1' as the Mac writes it: ⌥⌘1. */
  const mac = (tauri: string) => {
    const parts = tauri.split('+');
    const key = parts.pop();
    const glyph = { Ctrl: '⌃', Alt: '⌥', Shift: '⇧', CmdOrCtrl: '⌘' } as Record<string, string>;
    const order = ['Ctrl', 'Alt', 'Shift', 'CmdOrCtrl'];
    return (
      order
        .filter((modifier) => parts.includes(modifier))
        .map((modifier) => glyph[modifier])
        .join('') + key
    );
  };
  /** The same as assistive technology names them: Alt+Meta+1. */
  const aria = (tauri: string) => tauri.replace('CmdOrCtrl', 'Meta');

  it('are the menu bar’s, in the hints and for assistive technology', () => {
    for (const [view, text] of [
      ['clean', 'Clean'],
      ['redlines', 'Redlines'],
      ['raw', 'Raw'],
    ] as const) {
      expect(VIEW_KEYS[view], view).toBe(mac(accelerator(text)));
      expect(VIEW_ARIA_KEYS[view], view).toBe(aria(accelerator(text)));
    }
    expect(TRACKING_KEY).toBe(mac(accelerator('Track Changes')));
    expect(TRACKING_ARIA_KEY).toBe(aria(accelerator('Track Changes')));
  });
});

describe('what a click on the icons will do, said before it is made', () => {
  const tips = (root: HTMLElement) => ({
    view: root.querySelector<HTMLElement>('#rl-view-tip'),
    review: root.querySelector<HTMLElement>('#rl-review-tip'),
  });

  it('says on the View icon which view a click shows, with its key', () => {
    const { root, bar } = setup({ view: 'redlines' });
    const { view } = tips(root);
    expect(view?.getAttribute('role')).toBe('tooltip');
    expect(view?.textContent).toBe('Show Clean⌥⌘1');
    bar.update({ ...BASE, view: 'clean' });
    expect(view?.textContent).toBe('Show Redlines⌥⌘2');
    // From Raw, the one shown last: Clean, then.
    bar.update({ ...BASE, view: 'raw' });
    expect(view?.textContent).toBe('Show Clean⌥⌘1');
    bar.update({ ...BASE, view: 'redlines' });
    bar.update({ ...BASE, view: 'raw' });
    expect(view?.textContent).toBe('Show Redlines⌥⌘2');
    bar.update({ ...BASE, view: 'clean' });
    bar.update({ ...BASE, view: 'raw' });
    expect(view?.textContent).toBe('Show Clean⌥⌘1');
  });

  it('says on the pen whether a click turns Track Changes on or off, with the key', () => {
    const { root, bar } = setup({ tracking: false });
    const { review } = tips(root);
    expect(review?.getAttribute('role')).toBe('tooltip');
    expect(review?.textContent).toBe('Turn on Track Changes⇧⌘E');
    bar.update({ ...BASE, tracking: true });
    expect(review?.textContent).toBe('Turn off Track Changes⇧⌘E');
  });

  it('describes the icon, which keeps its name, and gives its key to those who cannot see it', () => {
    const { root, bar, button } = setup({ view: 'redlines', tracking: false });
    expect(button('View').getAttribute('aria-describedby')).toBe(tips(root).view?.id);
    expect(button('Track Changes').getAttribute('aria-describedby')).toBe(tips(root).review?.id);
    expect(button('View').getAttribute('aria-keyshortcuts')).toBe('Alt+Meta+1');
    expect(button('Track Changes').getAttribute('aria-keyshortcuts')).toBe('Shift+Meta+E');
    bar.update({ ...BASE, view: 'clean' });
    expect(button('View').getAttribute('aria-keyshortcuts')).toBe('Alt+Meta+2');
  });

  it('shows the pen as pressed while Track Changes is on, and the eye as no switch', () => {
    const { bar, button } = setup({ tracking: false });
    expect(button('Track Changes').getAttribute('aria-pressed')).toBe('false');
    bar.update({ ...BASE, tracking: true });
    expect(button('Track Changes').getAttribute('aria-pressed')).toBe('true');
    expect(button('View').hasAttribute('aria-pressed')).toBe(false);
  });

  it('shows after a pause on an icon whose menu is not open, as the Show files hint does', () => {
    const { root, button } = setup({ view: 'redlines' });
    const { view } = tips(root);
    // A click that was made before the menu opened: the pointer stays, and what comes next is said.
    enter(button('View'));
    vi.advanceTimersByTime(30);
    click(button('View'));
    vi.advanceTimersByTime(TOOLTIP_MS - 1);
    expect(view && shown(view)).toBe(false);
    vi.advanceTimersByTime(1);
    expect(view && shown(view)).toBe(true);
    leave(button('View'));
    expect(view && shown(view)).toBe(false);
  });

  it('leaves what the pen did to the notice, which says it, and puts no hint over it', () => {
    // "Track Changes is on" is said under the bar's middle, and a hint after the click, at the
    // bar's end, can run into it when the window is narrow and zoomed.
    const { root, button } = setup({ tracking: false });
    click(button('Track Changes'));
    vi.advanceTimersByTime(TOOLTIP_MS * 3);
    const { review } = tips(root);
    expect(review && shown(review)).toBe(false);
  });

  it('says what the next click will do after this one, when the pointer stays', () => {
    const { root, bar, button } = setup({ view: 'redlines' });
    const { view } = tips(root);
    click(button('View'));
    bar.update({ ...BASE, view: 'clean' });
    vi.advanceTimersByTime(TOOLTIP_MS);
    expect(view && shown(view)).toBe(true);
    expect(view?.textContent).toBe('Show Redlines⌥⌘2');
  });

  it('does not bring back a hint that Escape took away when a key acts', () => {
    // Return and Space on the focused icon are clicks with no position (`detail` 0): the pointer
    // has not rested anywhere, so nothing is said after them.
    const { root, button } = setup({ view: 'clean' });
    const { view } = tips(root);
    button('View').focus();
    press(button('View'), 'Escape');
    expect(view && shown(view)).toBe(false);
    button('View').click();
    vi.advanceTimersByTime(TOOLTIP_MS * 2);
    expect(view && shown(view)).toBe(false);
  });

  it.each([
    ['View', 'view', 'View'],
    ['Track Changes', 'review', 'Review'],
  ] as const)(
    'does not show over the menu of %s, which is open, however the pointer came back to it',
    (icon, key, menuName) => {
      const { root, button, menu } = setup();
      // The pointer leaves and returns within the wait before the menu closes.
      hover(button(icon));
      leave(button(icon));
      enter(button(icon));
      vi.advanceTimersByTime(TOOLTIP_MS * 2);
      expect(shown(menu(menuName))).toBe(true);
      const hint = tips(root)[key];
      expect(hint && shown(hint)).toBe(false);
    },
  );

  it('does not show the hint of an icon that opens its menu at once, beside an open one', () => {
    const { root, button, menu } = setup();
    hover(button('View'));
    leave(button('View'));
    enter(button('Track Changes'));
    vi.advanceTimersByTime(TOOLTIP_MS * 2);
    expect(shown(menu('Review'))).toBe(true);
    const { review } = tips(root);
    expect(review && shown(review)).toBe(false);
  });

  it('goes with Escape wherever the focus is, as a hint should', () => {
    const { root, button } = setup({ view: 'redlines' });
    const { view } = tips(root);
    click(button('View'));
    vi.advanceTimersByTime(TOOLTIP_MS);
    expect(view && shown(view)).toBe(true);
    // The focus is in the document, not on the icon.
    press(document.body, 'Escape');
    expect(view && shown(view)).toBe(false);
  });

  it('shows one hint at a time', () => {
    const { root, button } = setup({ view: 'redlines' });
    const { view, review } = tips(root);
    button('Track Changes').focus();
    expect(review && shown(review)).toBe(true);
    click(button('View'));
    vi.advanceTimersByTime(TOOLTIP_MS);
    expect(view && shown(view)).toBe(true);
    expect(review && shown(review)).toBe(false);
  });

  it('goes when the window loses the focus', () => {
    const { root, button } = setup({ view: 'redlines' });
    const { view } = tips(root);
    click(button('View'));
    vi.advanceTimersByTime(TOOLTIP_MS);
    expect(view && shown(view)).toBe(true);
    window.dispatchEvent(new Event('blur'));
    expect(view && shown(view)).toBe(false);
  });

  it('shows none for a finger: nothing rests under it, and no pointer leaves to take it away', () => {
    const { root, button } = setup({ view: 'redlines' });
    const { view } = tips(root);
    const touch = (type: string) =>
      new PointerEvent(type, { pointerType: 'touch', bubbles: true, cancelable: true });
    button('View').dispatchEvent(touch('pointerenter'));
    vi.advanceTimersByTime(TOOLTIP_MS * 2);
    expect(view && shown(view)).toBe(false);
    // The tap: down, then the click that acts (the pointer has already left).
    button('View').dispatchEvent(touch('pointerdown'));
    button('View').dispatchEvent(touch('pointerleave'));
    click(button('View'));
    vi.advanceTimersByTime(TOOLTIP_MS * 2);
    expect(view && shown(view)).toBe(false);
    // A mouse after it is a mouse again.
    button('View').dispatchEvent(
      new PointerEvent('pointerdown', { pointerType: 'mouse', bubbles: true }),
    );
    click(button('View'));
    vi.advanceTimersByTime(TOOLTIP_MS);
    expect(view && shown(view)).toBe(true);
  });

  it('is aligned with the right edge of the icons at the bar’s right end, and Files’ with its left', () => {
    const { root } = setup();
    const files = root.querySelector('#rl-files-tip');
    const { view, review } = tips(root);
    expect(view?.classList.contains('rl-tip-end')).toBe(true);
    expect(review?.classList.contains('rl-tip-end')).toBe(true);
    expect(files?.classList.contains('rl-tip-end')).toBe(false);
  });

  it('is taken away with a click on Files, and with the menus closed, and with the bar', () => {
    const { root, bar, button } = setup();
    const files = root.querySelector<HTMLElement>('#rl-files-tip');
    const { view } = tips(root);
    enter(button('Show files'));
    vi.advanceTimersByTime(TOOLTIP_MS);
    expect(files && shown(files)).toBe(true);
    click(button('Show files'));
    expect(files && shown(files)).toBe(false);
    // A zoom closes the menus, which were placed for the old layout, and the hints with them.
    button('View').focus();
    expect(view && shown(view)).toBe(true);
    bar.closeMenus();
    expect(view && shown(view)).toBe(false);
    button('View').blur();
    button('View').focus();
    expect(view && shown(view)).toBe(true);
    bar.destroy();
    expect(view?.hidden).toBe(true);
  });

  it('never shows over the icon’s own menu: the menu opens first, and takes the hint away', () => {
    const { root, button, menu } = setup();
    hover(button('View'));
    expect(shown(menu('View'))).toBe(true);
    vi.advanceTimersByTime(TOOLTIP_MS * 3);
    const { view } = tips(root);
    expect(view && shown(view)).toBe(false);
  });

  it('shows at once on the keyboard focus, and goes with the focus or Escape', () => {
    const { root, button } = setup();
    const { review } = tips(root);
    button('Track Changes').focus();
    expect(review && shown(review)).toBe(true);
    button('Track Changes').blur();
    expect(review && shown(review)).toBe(false);
    button('Track Changes').focus();
    press(button('Track Changes'), 'Escape');
    expect(review && shown(review)).toBe(false);
  });

  it('goes when the menu opens by a key', () => {
    const { root, button, menu } = setup();
    const { view } = tips(root);
    button('View').focus();
    expect(view && shown(view)).toBe(true);
    press(button('View'), 'ArrowDown');
    expect(shown(menu('View'))).toBe(true);
    expect(view && shown(view)).toBe(false);
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
