// The title bar (design §5.1): part of the page, with the file name centered and three icons and
// no labels. Files, next to the window buttons, explains itself on hover; View and Review open
// their menus on hover, and a click on either does what it does most often: the eye switches
// between Clean and Redlines, the pen turns Track Changes on and off. Each says what a click will
// do, with its key, in a hint. The file name says how many words the document has, and when it was
// last saved, on hover, and a double-click on it renames the document. A small document icon beside
// it drags the file, as a native title bar's proxy icon does.

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
   * Scrolls the page by this many pixels, for the wheel that turns over the bar: the page runs
   * under it, and scrolls there as it does over the text.
   */
  scrollPage(dx: number, dy: number): void;
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

/** The views a click on the View icon switches between: Raw is for the menu. */
type SwitchView = Exclude<MenuView, 'raw'>;

/** The views' names and the keys the menus give them (menu-model.ts). */
const VIEW_NAMES: Record<MenuView, string> = { clean: 'Clean', redlines: 'Redlines', raw: 'Raw' };
const VIEW_KEYS: Record<MenuView, string> = { clean: '⌥⌘1', redlines: '⌥⌘2', raw: '⌥⌘3' };
/** The same keys as assistive technology names them (`aria-keyshortcuts`). */
const VIEW_ARIA_KEYS: Record<MenuView, string> = {
  clean: 'Alt+Meta+1',
  redlines: 'Alt+Meta+2',
  raw: 'Alt+Meta+3',
};
const TRACKING_KEY = '⇧⌘E';
const TRACKING_ARIA_KEY = 'Shift+Meta+E';

/**
 * The bar is 52 points tall, and the fade that the text passes into under it ends 64 points down
 * (styles.css, which a test keeps these numbers in step with): the text rests below the fade, and
 * what the editor scrolls to is kept clear of both (`room`).
 */
export const BAR_PT = 52;
export const FADE_PT = 64;

/** How far the pointer moves, with the button down, before the document icon's drag starts. */
const DRAG_START_PX = 4;

/** How far the pointer may move between the second press of a double-click and its release. */
const DOUBLE_CLICK_SLOP_PX = 3;

/** How many pixels a wheel that counts in lines scrolls for each line. */
const WHEEL_LINE_PX = 16;

export function createTitleBar(
  root: HTMLElement,
  actions: TitleBarActions,
): {
  update(state: TitleBarState): void;
  beginRename(): void;
  /** Closes the View and Review menus, as a zoom change does: they were placed for the old layout. */
  closeMenus(): void;
  /**
   * How tall the bar is now, in CSS pixels: 52 points, which the window zoom makes more or fewer of.
   */
  height(): number;
  /**
   * How much of the page's top the bar keeps, in CSS pixels: the bar and its fade, 64 points. The bar
   * floats over the top of the page, whose text starts below it and passes under it, so the editor
   * keeps what it scrolls to clear of this much: a caret that scrolls into view rests where the
   * text is no longer faded.
   */
  room(): number;
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
  filesControl.append(filesButton);
  const filesTip = createTip(filesControl, filesButton, 'rl-files-tip');
  filesButton.addEventListener('mousedown', (event) => event.preventDefault());
  filesButton.addEventListener('click', () => {
    filesTip.hide();
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
  // What a click on each will do, which the hint under it says, and the icon's description is.
  const viewTip = createTip(viewControl, viewButton, 'rl-view-tip', true);
  const reviewControl = element('div', 'rl-control');
  const reviewButton = iconButton('Review', icon('pen', 18));
  reviewControl.append(reviewButton);
  const reviewTip = createTip(reviewControl, reviewButton, 'rl-review-tip', true);
  reviewButton.setAttribute('aria-keyshortcuts', TRACKING_ARIA_KEY);
  end.append(viewControl, reviewControl);
  const tips = [filesTip, viewTip, reviewTip];
  const hideTips = () => {
    for (const tip of tips) tip.hide();
  };

  bar.append(filesControl, titleGroup, end);
  root.append(bar);

  // The page runs under the bar, which is no part of the scroller: a wheel that turns over it
  // scrolls the page, as over the text. A pinch, which arrives as a wheel with the control key down,
  // is the text size's, and an open menu's own wheel is its own.
  bar.addEventListener(
    'wheel',
    (event) => {
      if (event.ctrlKey || (event.target instanceof Element && event.target.closest('.rl-menu'))) {
        return;
      }
      event.preventDefault();
      // Lines, for a wheel that counts them, are about as tall as the text's.
      const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? WHEEL_LINE_PX : 1;
      actions.scrollPage(event.deltaX * unit, event.deltaY * unit);
    },
    { passive: false },
  );

  const menus: Menu[] = [];
  const neighbors = (self: () => Menu) => ({
    neighborOpen: () => menus.some((menu) => menu !== self() && menu.isOpen),
    // A menu that opens takes the hints away: they would be over it.
    onOpen: () => {
      hideTips();
      for (const menu of menus) if (menu !== self()) menu.close();
    },
  });

  /**
   * The view the last click on the eye leaves behind it, and the one a click goes back to from
   * Raw. Redlines for a window that has shown neither.
   */
  let lastShown: SwitchView = 'redlines';
  /** What a click on the eye shows: Clean and Redlines in turn, and from Raw the one shown last. */
  const viewAfterClick = (view: ViewMode): SwitchView => {
    const shownNow = menuViewOf(view);
    if (shownNow === 'raw') return lastShown;
    return shownNow === 'clean' ? 'redlines' : 'clean';
  };

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
    // The keys are the menu bar's, as in menu-model.ts.
    entries: () => [
      viewItem('clean', VIEW_NAMES.clean, VIEW_KEYS.clean),
      viewItem('redlines', VIEW_NAMES.redlines, VIEW_KEYS.redlines),
      viewItem('raw', VIEW_NAMES.raw, VIEW_KEYS.raw),
    ],
    // A click switches Clean and Redlines; Raw is for the menu.
    activate: (event) => {
      actions.setView(viewAfterClick(state.view));
      // The pointer is still there: what the next click will do is said once it has rested.
      if (event.detail > 0) viewTip.arm();
    },
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
        shortcut: TRACKING_KEY,
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
    // A click turns Track Changes on and off, as the key does.
    activate: (event) => {
      actions.toggleTracking();
      if (event.detail > 0) reviewTip.arm();
    },
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
    filesTip.set(filesLabel, '⌃⌘S');

    // What a click on each icon will do, said in its hint and to assistive technology.
    const shownNow = menuViewOf(next.view);
    if (shownNow !== 'raw') lastShown = shownNow;
    const toView = viewAfterClick(next.view);
    viewTip.set(`Show ${VIEW_NAMES[toView]}`, VIEW_KEYS[toView]);
    viewButton.setAttribute('aria-keyshortcuts', VIEW_ARIA_KEYS[toView]);
    reviewTip.set(next.tracking ? 'Turn off Track Changes' : 'Turn on Track Changes', TRACKING_KEY);
    reviewButton.setAttribute('aria-pressed', String(next.tracking));

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
      hideTips();
      for (const menu of menus) menu.close();
    },
    height: () => bar.getBoundingClientRect().height,
    room: () => (bar.getBoundingClientRect().height * FADE_PT) / BAR_PT,
    destroy() {
      hideTips();
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

/** A hint under an icon, which says what the icon does and its key. */
interface Tip {
  /** What the hint says: the label, and beside it the key. */
  set(label: string, shortcut: string): void;
  /** Starts the pause after which it shows, which the pointer leaving ends. */
  arm(): void;
  hide(): void;
}

/**
 * The hint under an icon, in the dark bubble: it shows after the pointer has rested on the icon for
 * a pause, and at once when the keyboard brings the focus there (the mouse never does: a press
 * leaves the focus where it was), and goes when the pointer leaves, the focus goes, Escape is
 * pressed, or `hide` is called, as a menu opening does. It is the icon's description for assistive
 * technology. `end` aligns it with the right of the icon, for the icons at the bar's right end.
 */
function createTip(control: HTMLElement, button: HTMLButtonElement, id: string, end = false): Tip {
  const tip = element('div', end ? 'rl-tip rl-tip-end' : 'rl-tip');
  tip.id = id;
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  const label = element('span', 'rl-tip-label');
  const shortcut = element('span', 'rl-tip-shortcut');
  tip.append(label, shortcut);
  button.setAttribute('aria-describedby', id);
  control.append(tip);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const hide = () => {
    clearTimeout(timer);
    tip.hidden = true;
  };
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => (tip.hidden = false), TOOLTIP_MS);
  };
  button.addEventListener('pointerenter', (event) => {
    if (event.pointerType !== 'touch') arm();
  });
  button.addEventListener('pointerleave', hide);
  button.addEventListener('focus', () => {
    clearTimeout(timer);
    tip.hidden = false;
  });
  button.addEventListener('blur', hide);
  button.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hide();
  });
  return {
    set(text, key) {
      label.textContent = text;
      shortcut.textContent = key;
    },
    arm,
    hide,
  };
}

function iconButton(label: string, svg: SVGSVGElement): HTMLButtonElement {
  const button = element('button', 'rl-icon-button');
  button.type = 'button';
  button.setAttribute('aria-label', label);
  button.append(svg);
  return button;
}
