// The title bar (design §5.1): part of the page, with the file name centered and three icons and
// no labels. Files, next to the window buttons, explains itself on hover; View and Review open
// their menus on hover.

import type { ViewMode } from '@redlines/editor';
import { icon } from './icons.ts';
import { createMenu, type Menu } from './menu.ts';

export interface TitleBarState {
  name: string;
  dirty: boolean;
  view: ViewMode;
  tracking: boolean;
  hasRedlines: boolean;
  sidebarOpen: boolean;
}

export interface TitleBarActions {
  setView(mode: ViewMode): void;
  toggleTracking(): void;
  openReview(): void;
  toggleSidebar(): void;
}

export const TOOLTIP_MS = 400;

export function createTitleBar(
  root: HTMLElement,
  actions: TitleBarActions,
): { update(state: TitleBarState): void; destroy(): void } {
  let state: TitleBarState = {
    name: '',
    dirty: false,
    view: 'clean',
    tracking: false,
    hasRedlines: false,
    sidebarOpen: false,
  };

  const bar = element('header', 'rl-titlebar');
  // The bar drags the window everywhere but on its controls (and double-click zooms it).
  bar.dataset['tauriDragRegion'] = 'deep';

  // Files, with its hover hint.
  const filesControl = element('div', 'rl-control rl-files-control');
  const filesButton = iconButton('Show files', icon('files', 17));
  filesButton.classList.add('rl-files-button');
  const tip = element('div', 'rl-tip');
  tip.id = 'rl-files-tip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  const tipLabel = element('span', 'rl-tip-label');
  const tipShortcut = element('span', 'rl-tip-shortcut');
  tipShortcut.textContent = '⌃⌘S';
  tip.append(tipLabel, tipShortcut);
  filesButton.setAttribute('aria-describedby', tip.id);
  filesControl.append(filesButton, tip);

  let tipTimer: ReturnType<typeof setTimeout> | undefined;
  const hideTip = () => {
    clearTimeout(tipTimer);
    tip.hidden = true;
  };
  filesButton.addEventListener('pointerenter', (event) => {
    if (event.pointerType === 'touch') return;
    clearTimeout(tipTimer);
    tipTimer = setTimeout(() => (tip.hidden = false), TOOLTIP_MS);
  });
  filesButton.addEventListener('pointerleave', hideTip);
  filesButton.addEventListener('mousedown', (event) => event.preventDefault());
  filesButton.addEventListener('click', () => {
    hideTip();
    actions.toggleSidebar();
  });

  // The file name.
  const title = element('div', 'rl-title');
  const titleName = element('span', 'rl-title-name');
  const titleEdited = element('span', 'rl-title-edited');
  title.append(titleName, titleEdited);

  // View and Review.
  const end = element('div', 'rl-titlebar-end');
  const viewControl = element('div', 'rl-control');
  const viewButton = iconButton('View', icon('eye', 18));
  viewControl.append(viewButton);
  const reviewControl = element('div', 'rl-control');
  const reviewButton = iconButton('Review', icon('pen', 18));
  reviewControl.append(reviewButton);
  end.append(viewControl, reviewControl);

  bar.append(filesControl, title, end);
  root.append(bar);

  const menus: Menu[] = [];
  const neighbors = (self: () => Menu) => ({
    neighborOpen: () => menus.some((menu) => menu !== self() && menu.isOpen),
    onOpen: () => {
      hideTip();
      for (const menu of menus) if (menu !== self()) menu.close();
    },
  });

  const viewItem = (mode: ViewMode, label: string, shortcut: string) => ({
    role: 'menuitemradio' as const,
    label,
    icon: mode,
    shortcut,
    checked: state.view === mode,
    hidden: mode === 'redlines' && !state.hasRedlines,
    select: () => actions.setView(mode),
  });
  const viewMenu: Menu = createMenu({
    label: 'View',
    container: viewControl,
    button: viewButton,
    entries: () => [
      viewItem('clean', 'Clean', '⌥⌘1'),
      viewItem('redlines', 'Redlines', '⌥⌘2'),
      viewItem('raw', 'Raw', '⌥⌘3'),
    ],
    ...neighbors(() => viewMenu),
  });

  const reviewMenu: Menu = createMenu({
    label: 'Review',
    container: reviewControl,
    button: reviewButton,
    entries: () => [
      {
        role: 'menuitemcheckbox',
        label: 'Track changes',
        icon: 'tracking',
        iconClass: state.tracking ? 'rl-pen-on' : undefined,
        shortcut: '⇧⌘E',
        checked: state.tracking,
        select: () => actions.toggleTracking(),
      },
      'divider',
      {
        role: 'menuitem',
        label: 'Review changes',
        icon: 'list',
        shortcut: '⌥⌘]',
        // Nothing to review in a document without redlines.
        disabled: !state.hasRedlines,
        select: () => actions.openReview(),
      },
    ],
    ...neighbors(() => reviewMenu),
  });
  menus.push(viewMenu, reviewMenu);

  let penTracking: boolean | null = null;
  const update = (next: TitleBarState) => {
    state = next;
    titleName.textContent = next.name;
    titleEdited.textContent = next.dirty ? ' — Edited' : '';

    const filesLabel = next.sidebarOpen ? 'Hide files' : 'Show files';
    filesButton.setAttribute('aria-label', filesLabel);
    filesButton.setAttribute('aria-pressed', String(next.sidebarOpen));
    tipLabel.textContent = filesLabel;

    if (penTracking !== next.tracking) {
      penTracking = next.tracking;
      reviewButton.replaceChildren(icon(next.tracking ? 'tracking' : 'pen', 18));
      reviewButton.classList.toggle('rl-pen-on', next.tracking);
    }
    for (const menu of menus) menu.refresh();
  };

  return {
    update,
    destroy() {
      hideTip();
      for (const menu of menus) menu.destroy();
      bar.remove();
    },
  };
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  el.className = className;
  return el;
}

function iconButton(label: string, svg: SVGSVGElement): HTMLButtonElement {
  const button = element('button', 'rl-icon-button');
  button.type = 'button';
  button.setAttribute('aria-label', label);
  button.append(svg);
  return button;
}
