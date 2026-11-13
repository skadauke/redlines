// A menu that opens from an icon button: on hover after a short pause, or on click, Enter, Space or
// the down arrow. A hover-opened menu closes soon after the pointer leaves both the button and the
// menu; a clicked one stays until Esc, a second click or a click elsewhere. Opening on hover
// never takes the keyboard focus from the document. A button that acts (`activate`) has its menu
// for hover and the arrow keys only: a click, Enter and Space act, and close the menu if it is open.

import { icon, type IconName } from './icons.ts';

export const HOVER_OPEN_MS = 120;
export const HOVER_CLOSE_MS = 200;

export interface MenuItem {
  role: 'menuitemradio' | 'menuitemcheckbox' | 'menuitem';
  label: string;
  icon: IconName;
  shortcut?: string;
  /** Radio items show it as a tint, checkbox items as a switch. */
  checked?: boolean;
  /** A class on the icon, such as the red of the tracking pen. */
  iconClass?: string;
  disabled?: boolean;
  select(): void;
}

export type MenuEntry = MenuItem | 'divider';

export interface MenuOptions {
  /** The menu's name, shown as its header. */
  label: string;
  /** Holds the button; the menu is added to it and placed under the button. */
  container: HTMLElement;
  button: HTMLButtonElement;
  /** The entries, read again on every refresh. Their order and number never change. */
  entries(): MenuEntry[];
  /**
   * What a click on the button does, for a button that acts, as the eye switches the view and the
   * pen turns Track Changes on and off. A click, or Enter or Space on the focused button, closes the
   * menu if it is open, whichever way it was opened, and calls this; none of them opens it. The menu
   * still opens on hover, after the pause, and from the arrow keys. Given the click, whose `detail`
   * is 0 for a key's.
   */
  activate?: (event: MouseEvent) => void;
  /** Whether a neighboring menu is open, in which case hovering opens this one at once. */
  neighborOpen(): boolean;
  /** Called as the menu opens, so that its neighbors can close. */
  onOpen(): void;
}

export interface Menu {
  readonly isOpen: boolean;
  open(how: 'hover' | 'click' | 'keyboard'): void;
  close(): void;
  /** Redraws the entries from `entries()`, keeping the menu open or closed. */
  refresh(): void;
  destroy(): void;
}

let nextId = 0;

export function createMenu(options: MenuOptions): Menu {
  const { button, container } = options;
  const id = `rl-menu-${++nextId}`;

  const anchor = document.createElement('div');
  anchor.className = 'rl-menu-anchor';
  anchor.hidden = true;
  // Clicks in the menu's padding must not drag the window.
  anchor.dataset['tauriDragRegion'] = 'false';
  const panel = document.createElement('div');
  panel.className = 'rl-menu';
  panel.id = id;
  panel.setAttribute('role', 'menu');
  panel.setAttribute('aria-label', options.label);
  const header = document.createElement('div');
  header.className = 'rl-menu-header';
  header.setAttribute('aria-hidden', 'true');
  header.textContent = options.label;
  panel.append(header);

  const rows = options.entries().map((entry) => {
    if (entry === 'divider') {
      const divider = document.createElement('div');
      divider.className = 'rl-menu-divider';
      divider.setAttribute('role', 'separator');
      panel.append(divider);
      return null;
    }
    const row = buildItem(entry);
    panel.append(row.element);
    return row;
  });
  anchor.append(panel);
  container.append(anchor);

  button.setAttribute('aria-haspopup', 'menu');
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', id);

  let isOpen = false;
  /** Opened by a click or the keyboard, so leaving doesn't close it. */
  let pinned = false;
  let openTimer: ReturnType<typeof setTimeout> | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  const clearTimers = () => {
    clearTimeout(openTimer);
    clearTimeout(closeTimer);
  };

  const items = () => rows.filter((row): row is ItemRow => row !== null && !row.element.disabled);

  const refresh = () => {
    options.entries().forEach((entry, i) => {
      const row = rows[i];
      if (row && entry !== 'divider') row.update(entry);
    });
  };

  const open = (how: 'hover' | 'click' | 'keyboard') => {
    clearTimers();
    pinned ||= how !== 'hover';
    if (!isOpen) {
      options.onOpen();
      refresh();
      isOpen = true;
      anchor.hidden = false;
      button.setAttribute('aria-expanded', 'true');
      document.addEventListener('keydown', onDocumentKey, true);
      document.addEventListener('pointerdown', onDocumentPointer, true);
      window.addEventListener('blur', close);
    }
    if (how === 'keyboard') {
      const current = items().find((row) => row.element.getAttribute('aria-checked') === 'true');
      (current ?? items()[0])?.element.focus();
    }
  };

  function close() {
    clearTimers();
    pinned = false;
    if (!isOpen) return;
    isOpen = false;
    const hadFocus = panel.contains(document.activeElement);
    anchor.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    document.removeEventListener('keydown', onDocumentKey, true);
    document.removeEventListener('pointerdown', onDocumentPointer, true);
    window.removeEventListener('blur', close);
    if (hadFocus) button.focus();
  }

  function onDocumentKey(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  }

  function onDocumentPointer(event: PointerEvent) {
    if (!(event.target instanceof Node) || !container.contains(event.target)) close();
  }

  const isTouch = (event: PointerEvent) => event.pointerType === 'touch';

  const onEnterButton = (event: PointerEvent) => {
    if (isTouch(event)) return;
    clearTimeout(closeTimer);
    if (isOpen) return;
    if (options.neighborOpen()) open('hover');
    else openTimer = setTimeout(() => open('hover'), HOVER_OPEN_MS);
  };
  const onEnterPanel = () => clearTimeout(closeTimer);
  const onLeave = (event: PointerEvent) => {
    if (isTouch(event)) return;
    clearTimeout(openTimer);
    if (isOpen && !pinned) closeTimer = setTimeout(close, HOVER_CLOSE_MS);
  };

  const onClick = (event: MouseEvent) => {
    if (options.activate) {
      // The button acts. Its menu goes with the click, and the pause that was running does not
      // open it after: the pointer has to leave and come back.
      close();
      options.activate(event);
      return;
    }
    // A click on a menu that hover opened keeps it open; a click on a clicked menu closes it.
    if (isOpen && pinned) close();
    else open(event.detail === 0 ? 'keyboard' : 'click');
  };

  const onButtonKey = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      open('keyboard');
      if (event.key === 'ArrowUp') items().at(-1)?.element.focus();
    }
  };

  const onPanelKey = (event: KeyboardEvent) => {
    const list = items();
    const at = list.findIndex((row) => row.element === document.activeElement);
    const focus = (index: number) => list.at(index % list.length)?.element.focus();
    switch (event.key) {
      case 'ArrowDown':
        focus(at + 1);
        break;
      case 'ArrowUp':
        focus(at < 0 ? -1 : at - 1);
        break;
      case 'Home':
        focus(0);
        break;
      case 'End':
        focus(-1);
        break;
      // Escape is handled for the whole document while the menu is open.
      case 'Tab':
        close();
        return;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  const onPanelClick = (event: MouseEvent) => {
    const target = event.target instanceof Element ? event.target.closest('button') : null;
    const row = rows.find((r) => r?.element === target);
    if (!row) return;
    row.select();
    // Choosing a view or flipping the switch leaves the menu open to show the result; commands
    // close it.
    if (row.element.getAttribute('role') === 'menuitem') close();
  };

  // Keep the document's focus and caret when the controls are used with the mouse.
  const keepFocus = (event: MouseEvent) => event.preventDefault();

  button.addEventListener('pointerenter', onEnterButton);
  button.addEventListener('pointerleave', onLeave);
  button.addEventListener('click', onClick);
  button.addEventListener('keydown', onButtonKey);
  button.addEventListener('mousedown', keepFocus);
  panel.addEventListener('pointerenter', onEnterPanel);
  panel.addEventListener('pointerleave', onLeave);
  panel.addEventListener('keydown', onPanelKey);
  panel.addEventListener('click', onPanelClick);
  panel.addEventListener('mousedown', keepFocus);

  return {
    get isOpen() {
      return isOpen;
    },
    open,
    close,
    refresh,
    destroy() {
      close();
      button.removeEventListener('pointerenter', onEnterButton);
      button.removeEventListener('pointerleave', onLeave);
      button.removeEventListener('click', onClick);
      button.removeEventListener('keydown', onButtonKey);
      button.removeEventListener('mousedown', keepFocus);
      anchor.remove();
    },
  };
}

interface ItemRow {
  element: HTMLButtonElement;
  update(item: MenuItem): void;
  select(): void;
}

function buildItem(initial: MenuItem): ItemRow {
  let current = initial;
  const element = document.createElement('button');
  element.type = 'button';
  element.className = 'rl-menu-item';
  element.tabIndex = -1;
  element.setAttribute('role', initial.role);

  const iconBox = document.createElement('span');
  iconBox.className = 'rl-menu-icon';
  iconBox.append(icon(initial.icon));
  const label = document.createElement('span');
  label.className = 'rl-menu-label';
  label.textContent = initial.label;
  element.append(iconBox, label);
  if (initial.shortcut) {
    const shortcut = document.createElement('span');
    shortcut.className = 'rl-menu-shortcut';
    shortcut.textContent = initial.shortcut;
    element.append(shortcut);
  }
  if (initial.role === 'menuitemcheckbox') {
    const toggle = document.createElement('span');
    toggle.className = 'rl-switch';
    toggle.setAttribute('aria-hidden', 'true');
    element.append(toggle);
  }

  const update = (item: MenuItem) => {
    current = item;
    if (item.role !== 'menuitem') element.setAttribute('aria-checked', String(!!item.checked));
    element.disabled = !!item.disabled;
    iconBox.className = item.iconClass ? `rl-menu-icon ${item.iconClass}` : 'rl-menu-icon';
  };
  update(initial);
  return { element, update, select: () => current.select() };
}
