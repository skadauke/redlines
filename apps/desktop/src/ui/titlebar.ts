// The title bar (design §5.1): part of the page, with the file name centered and three icons and
// no labels. Files, next to the window buttons, explains itself on hover; View and Review open
// their menus on hover. The file name says how many words the document has, and when it was last
// saved, on hover, and a double-click on it renames the document. A small document icon beside it
// drags the file, as a native title bar's proxy icon does.

import { menuViewOf } from '@redlines/editor';
import type { MenuView, ViewMode } from '@redlines/editor';
import { icon } from './icons.ts';
import { createMenu, type Menu } from './menu.ts';

export interface TitleBarState {
  name: string;
  dirty: boolean;
  /**
   * Whether the document's file can be dragged out of the window: it has a file (an Untitled
   * document has none yet), and the app can hand it over (on the Mac). The icon beside the name
   * is shown for it.
   */
  fileDraggable: boolean;
  view: ViewMode;
  tracking: boolean;
  hasRedlines: boolean;
  sidebarOpen: boolean;
  showResolved: boolean;
}

export interface TitleBarActions {
  /** Shows a view of the View menu: Redlines in the look shown last (`Editor.showView`). */
  setView(view: MenuView): void;
  toggleTracking(): void;
  openReview(): void;
  toggleResolved(): void;
  toggleSidebar(): void;
  /** Renames the file to `newName`; resolves to whether it has the name (document.ts). */
  rename(newName: string): Promise<boolean>;
  /**
   * What a double-click on the file name asks for, as File › Rename does: the name becomes a field
   * (`beginRename`) for a document with a file, and Save As asks for a name for an Untitled one,
   * which has no file to rename yet.
   */
  renameDocument(): void;
  /**
   * Starts dragging the document's file out of the window, once the pointer has dragged the icon
   * beside the name: the app takes the drag from there (`start_file_drag`, in main.ts).
   */
  dragFile(): void;
  /**
   * What the document's facts are made from, asked for when the pointer comes to the name: the
   * document's newest text (format §8), and when it was last saved here, if it was.
   */
  documentFacts(): { newestText: string; savedAt: Date | null };
}

/**
 * The words in `newestText`: runs of anything but white space that hold a letter or a digit, so
 * a `#`, a `-`, a `---` or a table's `|` is not one. Markers and ledger are not in the text.
 */
export function wordCount(newestText: string): number {
  return newestText.match(/\S+/g)?.filter((token) => /[\p{L}\p{N}]/u.test(token)).length ?? 0;
}

/** "1,204 words · Saved 3:41 PM", or without the second part for a document not saved here. */
export function documentFactsLine(newestText: string, savedAt: Date | null): string {
  const words = wordCount(newestText);
  const count = `${words.toLocaleString()} ${words === 1 ? 'word' : 'words'}`;
  if (!savedAt) return count;
  const time = savedAt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${count} · Saved ${time}`;
}

export const TOOLTIP_MS = 400;

/** How far the pointer moves, with the button down, before the document icon's drag starts. */
const DRAG_START_PX = 4;

/** How far the pointer may move between the second press of a double-click and its release. */
const DOUBLE_CLICK_SLOP_PX = 3;

export function createTitleBar(
  root: HTMLElement,
  actions: TitleBarActions,
): {
  update(state: TitleBarState): void;
  beginRename(): void;
  /** Closes the View and Review menus, as a zoom change does: they were placed for the old layout. */
  closeMenus(): void;
  destroy(): void;
} {
  let state: TitleBarState = {
    name: '',
    dirty: false,
    fileDraggable: false,
    view: 'clean',
    tracking: false,
    hasRedlines: false,
    sidebarOpen: false,
    showResolved: false,
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

  // The file name, and beside it the document's icon, which drags the file: the two are centered
  // as one.
  const titleGroup = element('div', 'rl-title-group');
  const docIcon = element('span', 'rl-doc-icon');
  // The bar drags the window everywhere but here: a drag on the icon drags the file.
  docIcon.dataset['tauriDragRegion'] = 'false';
  docIcon.setAttribute('role', 'img');
  docIcon.title = 'Drag to copy the file';
  docIcon.append(icon('document', 16));
  // The press leaves the document's caret and keyboard focus where they were.
  docIcon.addEventListener('mousedown', (event) => event.preventDefault());
  let forgetPress: (() => void) | null = null;
  docIcon.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.pointerType === 'touch') return;
    forgetPress?.();
    const { clientX, clientY } = event;
    const onMove = (move: PointerEvent) => {
      // A button that went up unseen: the system takes a drag over, and the page hears no more.
      if ((move.buttons & 1) === 0) return forget();
      if (Math.hypot(move.clientX - clientX, move.clientY - clientY) < DRAG_START_PX) return;
      forget();
      actions.dragFile();
    };
    const forget = () => {
      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('pointerup', forget, true);
      document.removeEventListener('pointercancel', forget, true);
      forgetPress = null;
    };
    forgetPress = forget;
    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('pointerup', forget, true);
    document.addEventListener('pointercancel', forget, true);
  });

  /** The rename field, while the name is one. */
  let field: HTMLInputElement | null = null;
  const title = element('div', 'rl-title');
  const titleName = element('span', 'rl-title-name');
  const titleEdited = element('span', 'rl-title-edited');
  title.append(titleName, titleEdited);
  titleGroup.append(docIcon, title);
  // Counted when the pointer comes, not as the document changes.
  title.addEventListener('pointerenter', () => {
    const { newestText, savedAt } = actions.documentFacts();
    title.title = documentFactsLine(newestText, savedAt);
  });
  title.addEventListener('pointerleave', () => title.removeAttribute('title'));
  // A double-click on the name renames the document, and a double-click anywhere else on the bar
  // zooms the window. Tauri's drag script zooms on the mouseup of a double-click in any drag
  // region, and listens on the document: the name keeps that mouseup from reaching it, and goes by
  // it too, since in the app WebKit sends the page no click or dblclick for a second press. A drag
  // on the name still moves the window, which starts on the first mousedown.
  // Where the second press of a double-click on the name was, to tell the release that ends it from
  // one that ends a press that began elsewhere (a word selected by a double-click-drag in the text,
  // let go of over the name), which is no one's but the page's own.
  let secondPress: { x: number; y: number } | null = null;
  title.addEventListener('mousedown', (event) => {
    secondPress =
      event.button === 0 && event.detail === 2 ? { x: event.clientX, y: event.clientY } : null;
  });
  title.addEventListener('mouseup', (event) => {
    const press = secondPress;
    secondPress = null;
    if (event.button !== 0 || event.detail !== 2 || !press) return;
    // Where it began, as the window's own zoom asks, give or take the pixels a hand wobbles by.
    if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > DOUBLE_CLICK_SLOP_PX) return;
    event.stopPropagation();
    // In the field, a double-click selects a word.
    if (!field) actions.renameDocument();
  });

  // Rename…: the name becomes a field until Return, Escape or a click elsewhere.
  const beginRename = () => {
    if (field) return;
    const input = element('input', 'rl-title-field');
    field = input;
    input.type = 'text';
    input.value = state.name;
    input.setAttribute('aria-label', 'File name');
    input.spellcheck = false;
    input.autocomplete = 'off';
    // Wide enough for the name, which the title's own width follows.
    const fit = () => (input.style.width = `${Math.max(input.value.length, 8) + 1}ch`);
    fit();
    input.addEventListener('input', fit);
    const finish = (rename: boolean) => {
      if (field !== input) return;
      field = null;
      const { value } = input;
      input.remove();
      title.prepend(titleName, titleEdited);
      if (rename) void actions.rename(value);
    };
    input.addEventListener('keydown', (event) => {
      // An input method's own Return, which confirms what it is composing, is not ours.
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === 'Enter') finish(true);
      else if (event.key === 'Escape') finish(false);
      else return;
      event.preventDefault();
    });
    input.addEventListener('blur', () => finish(true));
    title.replaceChildren(input);
    input.focus();
    // Not the extension: typing replaces the name, and the file stays what it is.
    const dot = state.name.lastIndexOf('.');
    input.setSelectionRange(0, dot > 0 ? dot : state.name.length);
  };

  // View and Review.
  const end = element('div', 'rl-titlebar-end');
  const viewControl = element('div', 'rl-control');
  const viewButton = iconButton('View', icon('eye', 18));
  viewControl.append(viewButton);
  const reviewControl = element('div', 'rl-control');
  const reviewButton = iconButton('Review', icon('pen', 18));
  reviewControl.append(reviewButton);
  end.append(viewControl, reviewControl);

  bar.append(filesControl, titleGroup, end);
  root.append(bar);

  const menus: Menu[] = [];
  const neighbors = (self: () => Menu) => ({
    neighborOpen: () => menus.some((menu) => menu !== self() && menu.isOpen),
    onOpen: () => {
      hideTip();
      for (const menu of menus) if (menu !== self()) menu.close();
    },
  });

  // All three views are there for any document (design §5.3): Redlines too, with or without
  // redlines, whether Track Changes is on or off. Redlines is checked in both its looks: Simple is
  // its simple look, switched by a click on a change bar and by nothing in this menu.
  const viewItem = (view: MenuView, label: string, shortcut: string) => ({
    role: 'menuitemradio' as const,
    label,
    icon: view,
    shortcut,
    checked: menuViewOf(state.view) === view,
    select: () => actions.setView(view),
  });
  const viewMenu: Menu = createMenu({
    label: 'View',
    container: viewControl,
    button: viewButton,
    // ⌥⌘1 to ⌥⌘3, as in menu-model.ts.
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
      'divider',
      {
        role: 'menuitemcheckbox',
        label: 'Show resolved comments',
        icon: 'resolved',
        checked: state.showResolved,
        select: () => actions.toggleResolved(),
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
    // A document that has not been saved has no file to drag.
    docIcon.hidden = !next.fileDraggable;
    docIcon.setAttribute('aria-label', `${next.name}, document icon`);
    // With edits the file is behind: what is handed over is the file as it was last saved.
    docIcon.title = next.dirty ? 'Drag to copy the file as saved' : 'Drag to copy the file';

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
    beginRename,
    closeMenus() {
      hideTip();
      for (const menu of menus) menu.close();
    },
    destroy() {
      hideTip();
      forgetPress?.();
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
