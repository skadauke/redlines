// The title bar (design §5.1): part of the page, with the file name centered and four icons and
// no labels. Files, next to the window buttons, explains itself on hover; the outline button shows and
// hides the toolbar (#685); View and Review open their menus on hover, and a click on either does
// what it does most often: the View button, a page that shows the view, switches between Clean and
// Redlines, the pen turns Track Changes on and off. Each says what a click will
// do, with its key, in a hint. The file name says how many words the document has, and when it was
// last saved, on hover, and a double-click on it renames the document. A small document icon beside
// it drags the file, as a native title bar's proxy icon does.

import { menuViewOf, PLAIN_ONLY_TRACKING, PLAIN_ONLY_VIEWS } from '@redlines/editor';
import type { MenuView, ViewMode } from '@redlines/editor';
import { icon, type IconName } from './icons.ts';
import { createMenu, type Menu } from './menu.ts';
import { ariaKey, displayKey } from '../shortcuts.ts';

export interface TitleBarState {
  name: string;
  dirty: boolean;
  /**
   * Where the document stands in a session with other windows, beside its name: "Window 2", or
   * that edits are kept while the session can't be reached. Nothing for a document held alone.
   */
  sync?: string;
  /**
   * Whether the document's file can be dragged out of the window: it has a file (an Untitled
   * document has none yet), and the app can hand it over (on the Mac). The icon beside the name
   * is shown for it.
   */
  fileDraggable: boolean;
  /** A Plain-only file (text or code): Plain alone, and no Track Changes. */
  plainOnly: boolean;
  view: ViewMode;
  tracking: boolean;
  hasRedlines: boolean;
  sidebarOpen: boolean;
  showResolved: boolean;
  /** Whether the outline shows as a window: its button is pressed while it does. */
  outlineShown: boolean;
}

interface TitleBarActions {
  /**
   * The key a row of the menu bar has now (`View/Clean`, in CodeMirror's notation), or null for
   * none: the hints and the menus show the person's own keys (#551). Without it the fixed keys below.
   */
  keyOf?(id: string): string | null;
  /** Shows the outline as a window under its button, or puts it away. */
  toggleOutline(): void;
  /** Shows a view of the View menu: Redlines in the look shown last (`Editor.showView`). */
  setView(view: MenuView): void;
  /** Turns Redlines' simple look on or off, as a click on a change bar does (`Editor.switchLook`). */
  switchLook(): void;
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

/** The views a click on the View icon switches between: Plain is for the menu. */
type SwitchView = Exclude<MenuView, 'raw'>;

/** The views' names, and the keys the menu bar gives them (menu-model.ts, which a test compares). */
const VIEW_NAMES: Record<MenuView, string> = { clean: 'Clean', redlines: 'Redlines', raw: 'Plain' };
export const VIEW_KEYS: Record<MenuView, string> = { clean: '⌥⌘1', redlines: '⌥⌘2', raw: '⌥⌘3' };
/** The same keys as assistive technology names them (`aria-keyshortcuts`). */
export const VIEW_ARIA_KEYS: Record<MenuView, string> = {
  clean: 'Alt+Meta+1',
  redlines: 'Alt+Meta+2',
  raw: 'Alt+Meta+3',
};
export const TRACKING_KEY = '⇧⌘E';
export const TRACKING_ARIA_KEY = 'Shift+Meta+E';
const FILES_KEY = '⌃⌘S';

/** The menu bar rows whose keys the bar shows. */
const KEY_ROWS = {
  clean: 'View/Clean',
  redlines: 'View/Redlines',
  raw: 'View/Raw',
  tracking: 'Review/Track Changes',
  files: 'View/Show Files',
} as const;

/**
 * The bar is 52 points tall, and the fade that the text passes into under it ends 64 points down
 * (styles.css, which a test keeps these numbers in step with): the text rests below the fade, and
 * what the editor scrolls to is kept clear of both (`room`).
 */
export const BAR_PT = 52;
export const FADE_PT = 64;

/** The page that the View button draws for each view: the view shows in its icon (#661). */
const VIEW_ICONS: Record<MenuView, IconName> = {
  clean: 'viewClean',
  redlines: 'viewRedlines',
  raw: 'viewPlain',
};

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
  keysChanged(): void;
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
    plainOnly: false,
    view: 'clean',
    tracking: false,
    hasRedlines: false,
    sidebarOpen: false,
    showResolved: false,
    outlineShown: false,
  };

  const bar = element('header', 'rl-titlebar');
  // The bar drags the window everywhere but on its controls (and double-click zooms it).
  bar.dataset['tauriDragRegion'] = 'deep';

  // Files, with its hover hint.
  const filesControl = element('div', 'rl-control rl-files-control');
  const filesButton = iconButton('Show files', icon('files', 17));
  filesButton.classList.add('rl-files-button');
  filesControl.append(filesButton);
  const filesTip = createTip(filesControl, filesButton, 'rl-files-tip', {
    beforeShow: () => hideTips(),
  });
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

  // The outline: a click shows it as a window under the button, or puts it away, and the button is
  // pressed while it shows. It is reached at every text size, where the margin has no room for it.
  const outlineControl = element('div', 'rl-control');
  const outlineButton = iconButton('Outline', icon('outline', 18));
  outlineButton.classList.add('rl-outline-button');
  // The outline's own press handling leaves it to the click (plugins/outline).
  outlineButton.dataset['outlineControl'] = '';
  outlineControl.append(outlineButton);
  const outlineTip = createTip(outlineControl, outlineButton, 'rl-outline-tip', {
    end: true,
    beforeShow: () => hideTips(),
  });
  // The press leaves the document's caret and selection where they were.
  outlineButton.addEventListener('mousedown', (event) => event.preventDefault());
  outlineButton.addEventListener('click', (event) => {
    actions.toggleOutline();
    // The pointer is still there: what the next click will do is said once it has rested.
    if (event.detail > 0) outlineTip.arm();
  });

  // View and Review.
  const end = element('div', 'rl-titlebar-end');
  const viewControl = element('div', 'rl-control');
  const viewButton = iconButton('View', icon(VIEW_ICONS[menuViewOf(state.view)], 18));
  viewButton.dataset['tour'] = 'views';
  viewControl.append(viewButton);
  // What a click on each will do, which the hint under it says, and the icon's description is.
  // (A hint is not shown over its own icon's menu, which is open when the pointer has rested.)
  const viewTip = createTip(viewControl, viewButton, 'rl-view-tip', {
    end: true,
    suppressed: () => viewMenu.isOpen,
    beforeShow: () => hideTips(),
  });
  const reviewControl = element('div', 'rl-control');
  // Named for what a click on it does, and pressed while that is on; its menu is Review.
  const reviewButton = iconButton('Track Changes', icon('pen', 18));
  reviewButton.dataset['tour'] = 'pen';
  reviewControl.append(reviewButton);
  const reviewTip = createTip(reviewControl, reviewButton, 'rl-review-tip', {
    end: true,
    suppressed: () => reviewMenu.isOpen,
    beforeShow: () => hideTips(),
  });
  reviewButton.setAttribute('aria-keyshortcuts', TRACKING_ARIA_KEY);
  end.append(outlineControl, viewControl, reviewControl);
  const tips = [filesTip, outlineTip, viewTip, reviewTip];
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
   * The one of Clean and Redlines shown last, by any means (the menu, the keys, a click on a change
   * bar): what a click on the eye goes back to from Plain. Redlines for a window that has shown
   * neither.
   */
  let lastShown: SwitchView = 'redlines';
  /** What a click on the eye shows: Clean and Redlines in turn, and from Plain the one shown last. */
  const viewAfterClick = (view: ViewMode): SwitchView => {
    const shownNow = menuViewOf(view);
    if (shownNow === 'raw') return lastShown;
    return shownNow === 'clean' ? 'redlines' : 'clean';
  };

  // Redlines is checked in both its looks. The simple look is no row of this menu (it is reached by
  // a click on a change bar, ⌥⌘4 and the View menu of the menu bar, #499). The menu bar keeps
  // Redlines there for any document, since a disabled item would take its key away (design §5.3);
  // this menu has nothing to show in a file with no changes and no ledger, and says so.
  /** A row's key as the hints draw it: the person's own, else the fixed one; "" for none. */
  const keyShown = (row: keyof typeof KEY_ROWS, fixed: string): string => {
    if (!actions.keyOf) return fixed;
    const key = actions.keyOf(KEY_ROWS[row]);
    return key ? displayKey(key) : '';
  };
  const keyAria = (row: keyof typeof KEY_ROWS, fixed: string): string => {
    if (!actions.keyOf) return fixed;
    const key = actions.keyOf(KEY_ROWS[row]);
    return key ? ariaKey(key) : '';
  };
  const setAria = (button: HTMLElement, key: string) => {
    if (key) button.setAttribute('aria-keyshortcuts', key);
    else button.removeAttribute('aria-keyshortcuts');
  };
  const viewItem = (view: MenuView, label: string, shortcut: string, disabled = false) => ({
    role: 'menuitemradio' as const,
    label,
    icon: view,
    shortcut,
    checked: menuViewOf(state.view) === view,
    disabled,
    disabledHint: state.plainOnly && view !== 'raw' ? PLAIN_ONLY_VIEWS : undefined,
    select: () => actions.setView(view),
  });
  const viewMenu: Menu = createMenu({
    label: 'View',
    container: viewControl,
    button: viewButton,
    // The keys are the menu bar's, as in menu-model.ts.
    entries: () => [
      viewItem('clean', VIEW_NAMES.clean, keyShown('clean', VIEW_KEYS.clean), state.plainOnly),
      // Not disabled while it is the view shown: the menu opens on the row that is checked, and
      // a disabled row can't be focused (the keys and VoiceOver would not find the current view).
      viewItem(
        'redlines',
        VIEW_NAMES.redlines,
        keyShown('redlines', VIEW_KEYS.redlines),
        state.plainOnly || (!state.hasRedlines && menuViewOf(state.view) !== 'redlines'),
      ),
      'divider',
      viewItem('raw', VIEW_NAMES.raw, keyShown('raw', VIEW_KEYS.raw)),
    ],
    // A click switches Clean and Redlines; Plain is for the menu.
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
        label: 'Track Changes',
        icon: 'tracking',
        iconClass: state.tracking ? 'rl-pen-on' : undefined,
        shortcut: keyShown('tracking', TRACKING_KEY),
        checked: state.tracking,
        disabled: state.plainOnly,
        disabledHint: PLAIN_ONLY_TRACKING,
        select: () => actions.toggleTracking(),
      },
      'divider',
      {
        role: 'menuitem',
        label: 'Review Changes',
        icon: 'list',
        // No key, as in the menu bar: ⌥⌘] is Next Change.
        // Nothing to review in a document without redlines.
        disabled: !state.hasRedlines || state.plainOnly,
        disabledHint: state.plainOnly ? PLAIN_ONLY_TRACKING : undefined,
        select: () => actions.openReview(),
      },
      'divider',
      {
        role: 'menuitemcheckbox',
        label: 'Show Resolved Comments',
        icon: 'resolved',
        checked: state.showResolved,
        select: () => actions.toggleResolved(),
      },
    ],
    // A click turns Track Changes on and off, as the key does. Its notice says so ("Track Changes
    // is on"), and a hint at the bar's end would run into it in a narrow, zoomed window.
    activate: () => actions.toggleTracking(),
    ...neighbors(() => reviewMenu),
  });
  menus.push(viewMenu, reviewMenu);

  /** The icons' hints and keys, from the state and the keys now: what a click on each will do. */
  const drawHints = (next: TitleBarState) => {
    const filesLabel = next.sidebarOpen ? 'Hide files' : 'Show files';
    filesButton.setAttribute('aria-label', filesLabel);
    filesButton.setAttribute('aria-pressed', String(next.sidebarOpen));
    filesTip.set(filesLabel, keyShown('files', FILES_KEY));

    // What a click on each icon will do, said in its hint and to assistive technology.
    const shownNow = menuViewOf(next.view);
    if (shownNow !== 'raw') lastShown = shownNow;
    const toView = viewAfterClick(next.view);
    viewTip.set(`Show ${VIEW_NAMES[toView]}`, keyShown(toView, VIEW_KEYS[toView]));
    setAria(viewButton, keyAria(toView, VIEW_ARIA_KEYS[toView]));
    outlineTip.set(next.outlineShown ? 'Hide Outline' : 'Show Outline', '');
    reviewTip.set(
      next.tracking ? 'Turn off Track Changes' : 'Turn on Track Changes',
      keyShown('tracking', TRACKING_KEY),
    );
    setAria(reviewButton, keyAria('tracking', TRACKING_ARIA_KEY));
  };

  let penTracking: boolean | null = null;
  let shownIcon: MenuView = menuViewOf(state.view);
  const update = (next: TitleBarState) => {
    state = next;
    titleName.textContent = next.name;
    titleEdited.textContent = [next.dirty ? 'Edited' : '', next.sync ?? '']
      .filter(Boolean)
      .map((part) => ` — ${part}`)
      .join('');
    // A document that has not been saved has no file to drag.
    docIcon.hidden = !next.fileDraggable;
    docIcon.setAttribute('aria-label', `${next.name}, document icon`);
    // With edits the file is behind: what is handed over is the file as it was last saved.
    docIcon.title = next.dirty ? 'Drag to copy the file as saved' : 'Drag to copy the file';

    drawHints(next);
    // The button is a page that shows the view: lines of text, a red bar in the margin, or a #.
    const shownNow = menuViewOf(next.view);
    if (shownIcon !== shownNow) {
      shownIcon = shownNow;
      viewButton.replaceChildren(icon(VIEW_ICONS[shownNow], 18));
    }
    outlineButton.setAttribute('aria-pressed', String(next.outlineShown));
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
    /** A key changed (Preferences, another window): the hints and menus show it from now on. */
    keysChanged() {
      drawHints(state);
      for (const menu of menus) menu.refresh();
    },
    beginRename,
    closeMenus() {
      hideTips();
      for (const menu of menus) menu.close();
    },
    height: () => bar.getBoundingClientRect().height,
    room: () => (bar.getBoundingClientRect().height * FADE_PT) / BAR_PT,
    destroy() {
      for (const tip of tips) tip.destroy();
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
  /** Takes the hint away and stops listening to the document and the window. */
  destroy(): void;
}

interface TipOptions {
  /** Aligns it with the right of the icon, for the icons at the bar's right end. */
  end?: boolean;
  /** Whether it may not show now, as while the icon's menu is open: it would be over it. */
  suppressed?: () => boolean;
  /** Called as it shows, so that the others can go: one hint at a time. */
  beforeShow?: () => void;
}

/**
 * The hint under an icon, in the dark bubble: it shows after the pointer has rested on the icon for
 * a pause (a mouse's, not a finger's), and at once when the keyboard brings the focus there (the
 * mouse never does: a press leaves the focus where it was), unless the icon's menu is open. It goes
 * when the pointer leaves, the focus goes, the window loses the focus, Escape is pressed wherever
 * the focus is, or `hide` is called, as a menu opening does. It is the icon's description for
 * assistive technology.
 */
function createTip(
  control: HTMLElement,
  button: HTMLButtonElement,
  id: string,
  options: TipOptions = {},
): Tip {
  const tip = element('div', options.end ? 'rl-tip rl-tip-end' : 'rl-tip');
  tip.id = id;
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  const label = element('span', 'rl-tip-label');
  const shortcut = element('span', 'rl-tip-shortcut');
  tip.append(label, shortcut);
  button.setAttribute('aria-describedby', id);
  control.append(tip);

  let timer: ReturnType<typeof setTimeout> | undefined;
  /** The last press was a finger's, whose tap leaves no pointer to rest or to leave. */
  let touched = false;
  // Escape dismisses a hint that is showing, wherever the focus is, and is left to whatever else
  // it means.
  const onEscape = (event: KeyboardEvent) => {
    if (event.key === 'Escape') hide();
  };
  const show = () => {
    if (options.suppressed?.()) return;
    options.beforeShow?.();
    tip.hidden = false;
    document.addEventListener('keydown', onEscape, true);
  };
  function hide() {
    clearTimeout(timer);
    tip.hidden = true;
    document.removeEventListener('keydown', onEscape, true);
  }
  const arm = () => {
    clearTimeout(timer);
    if (!touched) timer = setTimeout(show, TOOLTIP_MS);
  };
  button.addEventListener('pointerdown', (event) => {
    touched = event.pointerType === 'touch';
  });
  button.addEventListener('pointerenter', (event) => {
    if (event.pointerType === 'touch') return;
    touched = false;
    arm();
  });
  button.addEventListener('pointerleave', hide);
  button.addEventListener('focus', () => {
    clearTimeout(timer);
    show();
  });
  button.addEventListener('blur', hide);
  window.addEventListener('blur', hide);
  return {
    set(text, key) {
      label.textContent = text;
      shortcut.textContent = key;
    },
    arm,
    hide,
    destroy() {
      hide();
      window.removeEventListener('blur', hide);
    },
  };
}

function iconButton(label: string, svg: SVGSVGElement): HTMLButtonElement {
  const button = element('button', 'rl-icon-button');
  button.type = 'button';
  button.setAttribute('aria-label', label);
  button.append(svg);
  return button;
}
