// The toolbar (issues #313 and #504; design §5.1). It is shown only when summoned, in three ways:
// the title bar's wrench, which docks it at the bottom center (and a preference keeps it there), a
// right-click, at the pointer, in place of WebKit's own menu, and from the keyboard (Show Toolbar,
// ⇧⌘P, below the caret). What puts it away is `model.ts`'s. Its items are commands
// of the registry, by id, so that it, the Format menu and the shortcuts never disagree about names,
// keys or whether an item is there. Items show no labels: hovering names one and its keys, after the
// title bar's delay. Esc closes it, and it is reachable from the keyboard (Show Toolbar,
// or the context menu key), where the arrow keys move among its items.

import { EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { Editor, EditorCommand } from '@redlines/editor';
import type { Plugin } from '@redlines/plugin-api';
import {
  type Dismissal,
  dismiss,
  fades,
  keyAction,
  setAtBottom as modelSetAtBottom,
  type Summoned,
  wrench,
} from './model.ts';
import { editCommands, type ToolbarClipboard, pageClipboard } from './edit.ts';
import { shownBar } from './items.ts';
import { type DrawnPanel, drawPanel, type PanelHandlers, type SpellingRows } from './panel.ts';
import { type ToolbarSpelling, SPELLING_WAIT_MS, within } from './spelling.ts';
import { installStyle } from './styles.ts';

export type { ToolbarClipboard } from './edit.ts';
export { pageClipboard } from './edit.ts';
export type { ToolbarSpelling } from './spelling.ts';
export { formatShortcut } from './shortcuts.ts';

export interface ToolbarOptions {
  /**
   * The box the toolbar goes in. Default: the editor's own element. Where it goes
   * makes no difference to where it appears: it is fixed to the window.
   */
  container?: HTMLElement;
  /** How long the pointer rests on an item before its hint shows: the title bar's `TOOLTIP_MS`. */
  tooltipMs?: number;
  /** How the Edit items reach the clipboard. Without it, Cut, Copy and Paste are left out. */
  clipboard?: ToolbarClipboard;
  /** The spell checker, for suggestions on a right-click on a misspelled word. Default: none. */
  spelling?: ToolbarSpelling;
  /**
   * Whether a right-click in the text opens the toolbar. Default: true. Where false, the browser's
   * own menu stays. ⇧ with the right-click always shows that one, which has what the toolbar
   * doesn't (Look Up, Services, Writing Tools).
   */
  contextMenu?: boolean;
  /** Shows a one-line message that doesn't interrupt, for what can't be done. */
  notice(message: string): void;
  /** Called when the toolbar appears or goes away, however it came to: the wrench follows it. */
  onChange?(shown: boolean): void;
}

export interface Toolbar {
  /**
   * ⇧⌘P: opens the toolbar below the caret with the keyboard in its first item, or puts it away
   * when it is open there. Docked, it moves the keyboard between the toolbar and the text. Returns
   * whether it is open.
   */
  show(): boolean;
  /** The wrench: docks the toolbar at the bottom center, or puts it away. Returns whether it shows. */
  toggle(): boolean;
  /** The preference: keeps the toolbar docked at the bottom of the window, or lets it go again. */
  setAtBottom(atBottom: boolean): void;
  /**
   * Puts away a toolbar at the pointer or the caret, as a zoom does (it was placed for the old
   * layout). A docked one stays, where CSS places it.
   */
  hide(): void;
  isOpen(): boolean;
  /** Takes the toolbar and its commands out of the page. */
  destroy(): void;
}

/** How soon, and how near, a press of the mouse comes before the menu event it is the pointer's for. */
const PRESS_MS = 1000;
const PRESS_PX = 6;

/** The space around the toolbar, and between it and what it is placed against. */
const MARGIN = 8;
const GAP = 8;
/** The hint's distance from the item it names. */
const HINT_GAP = 6;

/** The room a docked toolbar leaves under the text: its distance from the window's edge, and a gap. */
const DOCK_BOTTOM = 16;
const DOCK_GAP = 8;

const NO_TEXT = 'The clipboard has no text to paste.';

/**
 * Puts the selection where a right-click is: kept where the pointer is inside it, else the word
 * under the pointer, as the Mac selects it, and the caret where there is none. The editor's word is
 * the Mac's (an apostrophe inside a word is part of it, `don't`), and the one the spell checker is
 * asked about; CodeMirror's own, which splits at the apostrophe, is for where the editor reads none.
 */
function moveSelectionTo(editor: Editor, pos: number): void {
  const { view } = editor;
  const { main } = view.state.selection;
  if (!main.empty && pos >= main.from && pos <= main.to) return;
  const word = editor.wordAt(pos) ?? view.state.wordAt(pos);
  view.dispatch({
    selection: word ? EditorSelection.range(word.from, word.to) : EditorSelection.cursor(pos),
    userEvent: 'select.pointer',
  });
}

/**
 * Adds the toolbar to an editor: its right-click, and the commands Show
 * Toolbar (⇧⌘P, in the View menu) and, with a clipboard, Cut, Copy and Paste (which have no menu
 * or key here). Register the plugins whose commands it shows first, or later: an item appears when
 * its command is registered. Returns the toolbar, whose `destroy` takes it out again.
 */
export function createToolbar(editor: Editor, options: ToolbarOptions): Toolbar {
  const { view } = editor;
  const doc = view.dom.ownerDocument;
  const win = doc.defaultView ?? window;
  const tooltipMs = options.tooltipMs ?? 400;
  const removeStyle = installStyle(doc);

  // The parts: the toolbar, and the hint, which is the toolbar's own.
  const panel = doc.createElement('div');
  panel.className = 'rl-toolbar';
  panel.setAttribute('role', 'toolbar');
  panel.setAttribute('aria-label', 'Toolbar');
  panel.hidden = true;
  const tip = doc.createElement('div');
  tip.className = 'rl-toolbar-tip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  const tipName = doc.createElement('span');
  const tipKeys = doc.createElement('span');
  tipKeys.className = 'rl-toolbar-tip-keys';
  tip.append(tipName, tipKeys);
  const container = options.container ?? view.dom;
  container.append(panel, tip);

  let how: Summoned | null = null;
  let atBottom = false;
  let told = false;
  /** Whether a docked toolbar a right-click replaced comes back when that one goes. */
  let redock = false;
  let drawn: DrawnPanel | null = null;
  /** The spelling rows the toolbar holds, and where the word they are for is. */
  let spelling: { rows: SpellingRows; from: number; to: number } | null = null;
  /** Counts the toolbar's openings, so that an answer that comes late knows its own. */
  let opening = 0;
  let placeAgain: () => void = () => {};
  let hintTimer: ReturnType<typeof setTimeout> | undefined;

  const bar = () => shownBar(editor.commands.list(), view.state);

  // The hint.
  const hideHint = () => {
    clearTimeout(hintTimer);
    tip.hidden = true;
  };
  const hint = (button: HTMLElement | null) => {
    hideHint();
    if (!button?.dataset['name']) return;
    hintTimer = setTimeout(() => {
      tipName.textContent = button.dataset['name'] ?? '';
      tipKeys.textContent = button.dataset['keys'] ?? '';
      tipKeys.hidden = !button.dataset['keys'];
      tip.hidden = false;
      const rect = button.getBoundingClientRect();
      const below = rect.bottom + HINT_GAP;
      // Under the item; above it when there is no room under.
      const room = win.innerHeight - below - tip.offsetHeight;
      tip.style.left = `${rect.left + rect.width / 2}px`;
      // An item of a menu that opened over the bar has its hint above it: below would cover the bar.
      const over = button.closest('.rl-toolbar-menu-up') !== null;
      const under = !over && (room >= MARGIN || tip.offsetHeight === 0);
      tip.style.top = `${under ? below : rect.top - HINT_GAP - tip.offsetHeight}px`;
    }, tooltipMs);
  };

  // Where the toolbar goes: at a point, above a point, or below a box, kept inside the window.
  const clamp = (value: number, size: number, limit: number) =>
    Math.max(MARGIN, Math.min(value, limit - size - MARGIN));
  const placeAt = (x: number, y: number) => {
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    // At the pointer, or above it when the window ends first, as a menu does.
    const top = y + height + MARGIN > win.innerHeight ? y - height : y;
    panel.style.left = `${clamp(x, width, win.innerWidth)}px`;
    panel.style.top = `${clamp(top, height, win.innerHeight)}px`;
  };
  const placeBelow = (rect: { left: number; top: number; bottom: number }) => {
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    const fits = rect.bottom + GAP + height + MARGIN <= win.innerHeight;
    // A caret scrolled out of the window is still a place: the toolbar stays in the window.
    const top = fits ? rect.bottom + GAP : rect.top - GAP - height;
    panel.style.left = `${clamp(rect.left, width, win.innerWidth)}px`;
    panel.style.top = `${clamp(top, height, win.innerHeight)}px`;
  };

  /** Draws the bar as the registry has it now, with the spelling rows above it if there are any. */
  const draw = (rows: SpellingRows | null) => {
    drawn = drawPanel(panel, bar(), rows, handlers, () => hideHint());
  };

  /** Draws the items as the registry has them now; in place when they are the ones drawn. */
  const refresh = () => {
    if (how === null) return;
    if (drawn?.refresh(bar())) return;
    // The items changed (List came or went with the selection): drawn again, with the menu that was
    // open open, and the keyboard on the same item, or at the start when that is gone.
    const active = doc.activeElement;
    const focused = active instanceof HTMLElement && panel.contains(active) ? active : null;
    const menu = drawn?.openId() ?? null;
    draw(spelling?.rows ?? null);
    drawn?.openMenu(menu);
    if (!focused) return;
    const same = focused.dataset['command']
      ? panel.querySelector<HTMLElement>(`[data-command="${focused.dataset['command']}"]`)
      : focused.dataset['menu']
        ? panel.querySelector<HTMLElement>(`[data-menu="${focused.dataset['menu']}"]`)
        : null;
    (same ?? drawn?.entry())?.focus();
  };

  /** Draws the toolbar again with other spelling rows, or none, and the keyboard where it was. */
  const respell = (next: typeof spelling): void => {
    const hadFocus = panel.contains(doc.activeElement);
    spelling = next;
    // A hint waiting for a button that is gone goes too.
    hideHint();
    draw(next?.rows ?? null);
    placeAgain();
    if (hadFocus) drawn?.entry()?.focus();
  };
  const dropSpelling = () => respell(null);

  /** Puts the toolbar away and the keyboard in the text: a choice made in the toolbar is for it. */
  const choose = (): void => {
    drawn?.openMenu(null);
    // A docked toolbar stays: the next command may be one more.
    if (how !== 'docked') close();
    view.focus();
  };

  const handlers: PanelHandlers = {
    run(id) {
      choose();
      editor.commands.run(id);
    },
    pick(suggestion) {
      const held = spelling;
      choose();
      if (held) {
        editor.pickCorrection({ from: held.from, to: held.to }, held.rows.word, suggestion);
      }
    },
    learn() {
      const held = spelling;
      choose();
      if (held) void Promise.resolve(options.spelling?.learn?.(held.rows.word)).catch(() => {});
    },
    hint,
  };

  // What puts the toolbar away: Esc, a press elsewhere, leaving the window, a scroll or a resize,
  // and typing, which means the person went back to writing.
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || event.isComposing) return;
    // A text box of the page that has the keyboard, a comment's or the find bar's, has the key.
    if (inOtherField()) return;
    // A menu that is open goes first, with the keyboard on its button.
    if (drawn?.escape()) {
      event.preventDefault();
      event.stopPropagation();
      hideHint();
      return;
    }
    // A docked toolbar stays; Esc in it only gives the keyboard back to the text.
    if (how === 'docked') {
      if (!panel.contains(doc.activeElement)) return;
      event.preventDefault();
      event.stopPropagation();
      view.focus();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    close(true);
  };
  /** Puts the toolbar away for a reason, if the model says it goes. */
  const away = (why: Dismissal): void => {
    if (how !== null && dismiss({ how, atBottom }, why).how === null) close();
  };
  const onPress = (event: PointerEvent) => {
    const target = event.target;
    if (target instanceof Node && panel.contains(target)) return;
    // A press in the text puts an open menu away, whichever way the toolbar was shown.
    drawn?.openMenu(null);
    // The control that shows and hides the toolbar (the title bar's wrench) acts on the click.
    if (target instanceof Element && target.closest('[data-toolbar-control]')) return;
    away('press');
  };
  const onScroll = (event: Event) => {
    // The toolbar is fixed to the window, and what is under it can scroll.
    if (!(event.target instanceof Node) || !panel.contains(event.target)) away('scroll');
  };
  const onGone = () => away('blur');
  // The pointer moving brings back a bar that faded while the person typed.
  const onMove = () => {
    if (panel.hasAttribute('data-writing')) panel.removeAttribute('data-writing');
  };
  const onResize = () => away('resize');

  function listen(): void {
    doc.addEventListener('keydown', onKey, true);
    doc.addEventListener('pointerdown', onPress, true);
    doc.addEventListener('scroll', onScroll, true);
    doc.addEventListener('pointermove', onMove, true);
    win.addEventListener('blur', onGone);
    win.addEventListener('resize', onResize);
  }
  function unlisten(): void {
    doc.removeEventListener('keydown', onKey, true);
    doc.removeEventListener('pointerdown', onPress, true);
    doc.removeEventListener('scroll', onScroll, true);
    doc.removeEventListener('pointermove', onMove, true);
    win.removeEventListener('blur', onGone);
    win.removeEventListener('resize', onResize);
  }

  function open(next: Summoned, place: () => void, rows: typeof spelling = null): void {
    hideHint();
    if (how === null) listen();
    how = next;
    spelling = rows;
    draw(rows?.rows ?? null);
    // Docked, CSS places it; elsewhere, `place` does, with a left and a top of its own.
    panel.classList.toggle('rl-toolbar-docked', next === 'docked');
    if (next === 'docked') {
      panel.style.removeProperty('left');
      panel.style.removeProperty('top');
    }
    panel.hidden = false;
    placeAgain = place;
    place();
    keepRoom();
    tell();
  }
  /**
   * Keeps the text clear of a docked toolbar: the room it takes at the bottom of the window is
   * published as `--rl-toolbar-room` on the toolbar's container (the page pads its scroller by it,
   * so that the last lines scroll above the bar), and the editor keeps what it scrolls to above it.
   */
  function keepRoom(): void {
    const docked = how === 'docked' && !panel.hidden;
    if (docked) {
      const room = panel.offsetHeight + DOCK_BOTTOM + DOCK_GAP;
      container.style.setProperty('--rl-toolbar-room', `${room}px`);
    } else container.style.removeProperty('--rl-toolbar-room');
  }
  // A docked toolbar that wraps in a narrow window changes height.
  const watchSize =
    typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => keepRoom());
  watchSize?.observe(panel);
  /** Tells the host whether the toolbar shows, when that has changed. */
  function tell(): void {
    const shown = how !== null;
    if (shown === told) return;
    told = shown;
    options.onChange?.(shown);
  }

  /** Whether the keyboard is in a text field of the page other than the document and the toolbar. */
  function inOtherField(): boolean {
    const active = doc.activeElement;
    if (!(active instanceof HTMLElement) || panel.contains(active) || view.dom.contains(active)) {
      return false;
    }
    return (
      active instanceof HTMLTextAreaElement ||
      (active instanceof HTMLInputElement &&
        !/^(button|checkbox|radio|submit|reset)$/.test(active.type)) ||
      active.isContentEditable
    );
  }

  function close(refocus = false): void {
    hideHint();
    opening++;
    if (how === null) return;
    const hadFocus = panel.contains(doc.activeElement);
    // The keyboard goes back to the text, unless it is in another field, which keeps it.
    const takeBack = hadFocus || (refocus && !inOtherField());
    how = null;
    drawn = null;
    spelling = null;
    panel.hidden = true;
    panel.removeAttribute('data-writing');
    keepRoom();
    unlisten();
    tell();
    if (takeBack) view.focus();
    const again = redock;
    redock = false;
    if (again) open('docked', () => {});
  }

  // A press on the padding or the hairlines leaves the keyboard where it is, as one on an item does.
  panel.addEventListener('mousedown', (event) => event.preventDefault());
  // The keys in the toolbar: the arrows move among the items, Home and End to the ends, and Tab and
  // Esc put it away. Return and Space press the item, as a button does.
  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Tab') {
      event.preventDefault();
      drawn?.openMenu(null);
      // A docked toolbar stays: Tab only gives the keyboard back to the text.
      if (how === 'docked') view.focus();
      else close(true);
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey || !drawn?.key(event)) return;
    event.preventDefault();
    event.stopPropagation();
  });

  // A Space that pressed a button on its key down must not press it again on its key up.
  panel.addEventListener('keyup', (event) => {
    if (event.key === ' ') event.preventDefault();
  });

  // Typing: a toolbar that the pointer opened goes, as the person went back to writing. A key that
  // only moves the caret or holds a modifier is not writing.
  const onWriting = (event: KeyboardEvent) => {
    if (event.key.length > 1 && !/^(Backspace|Delete|Enter|Tab)$/.test(event.key)) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    // Docked, it can't go: it fades, and the pointer moving brings it back.
    if (how === 'docked' && fades({ how, atBottom })) {
      drawn?.openMenu(null);
      hideHint();
      panel.setAttribute('data-writing', '');
    }
    away('writing');
  };
  view.contentDOM.addEventListener('keydown', onWriting);

  // The right-click.
  const rowsOf = (word: string, suggestions: readonly string[]): SpellingRows => ({
    word,
    suggestions,
    canLearn: options.spelling?.learn !== undefined,
  });

  async function openContext(x: number, y: number, fromKeyboard: boolean): Promise<void> {
    // A docked toolbar comes back when this one goes: it is the person's to put away.
    const wasDocked = how === 'docked';
    close();
    redock = wasDocked;
    const mine = ++opening;
    let at = view.state.selection.main.head;
    if (!fromKeyboard) {
      const pos = view.posAtCoords({ x, y }, false);
      at = pos;
      moveSelectionTo(editor, pos);
    }
    const found = options.spelling?.enabled() ? editor.wordAt(at) : null;
    // The text the word was found in: a suggestion is for the word where it was, and not for text
    // that moved while the checker thought.
    const foundIn = view.state.doc;
    let rows: typeof spelling = null;
    if (found && options.spelling) {
      const asked = options.spelling.suggest(found.word, found.before);
      const answer = await within(asked, SPELLING_WAIT_MS, 'late' as const).catch(() => null);
      if (mine !== opening) return;
      const held = (suggestions: readonly string[]) => ({
        rows: rowsOf(found.word, suggestions),
        from: found.from,
        to: found.to,
      });
      if (answer === 'late') {
        // The toolbar opens without them, and takes them in if they come while it is open.
        void asked.then(
          (late) => {
            if (mine !== opening || how === null || !late || view.state.doc !== foundIn) return;
            respell(held(late));
          },
          () => {},
        );
      } else if (answer) {
        rows = held(answer);
      }
    }
    if (mine !== opening) return;
    open(
      'context',
      fromKeyboard
        ? () =>
            placeBelow(
              view.coordsAtPos(view.state.selection.main.head) ?? { left: x, top: y, bottom: y },
            )
        : () => placeAt(x, y),
      rows,
    );
    // From the keyboard, the keyboard goes into the toolbar.
    if (fromKeyboard) drawn?.entry()?.focus();
  }

  // The last press of the mouse in the text. A menu event after a press, at the same place, is the
  // pointer's: WebKit gives it the right button, and the buttons held only as the hardware has them
  // when the event is made, which a quick tap may have let go of already.
  let lastPress: { x: number; y: number; at: number } | null = null;
  const notePress = (event: MouseEvent) => {
    lastPress = { x: event.clientX, y: event.clientY, at: event.timeStamp };
  };
  view.contentDOM.addEventListener('mousedown', notePress, true);

  const onContextMenu = (event: MouseEvent) => {
    if (options.contextMenu === false || event.defaultPrevented || event.shiftKey) return;
    event.preventDefault();
    // The menu key and Ctrl-Return ask for the menu at the caret: WebKit sends the event with the
    // right button, no press before it, and no button held.
    const pressed =
      lastPress !== null &&
      event.timeStamp - lastPress.at < PRESS_MS &&
      Math.hypot(event.clientX - lastPress.x, event.clientY - lastPress.y) <= PRESS_PX;
    void openContext(event.clientX, event.clientY, !pressed && event.buttons === 0);
  };
  view.contentDOM.addEventListener('contextmenu', onContextMenu);

  // The toolbar stays true to the selection while it is open: Bold is on inside bold text, and
  // Cut and Copy need a selection.
  const removeExtension = editor.addExtension([
    EditorView.scrollMargins.of(() => ({
      bottom: how === 'docked' && !panel.hidden ? panel.offsetHeight + DOCK_BOTTOM + DOCK_GAP : 0,
    })),
    EditorView.updateListener.of((update) => {
      if (how === null) return;
      if (update.geometryChanged || update.docChanged) keepRoom();
      // Suggestions are for the word where it was found: text that moves takes them away.
      if (update.docChanged && spelling) dropSpelling();
      if (update.selectionSet || update.docChanged) refresh();
    }),
  ]);

  const failed = (what: 'cut' | 'copy' | 'paste') =>
    options.notice(what === 'paste' ? NO_TEXT : `Couldn’t ${what}.`);
  const show = (): boolean => {
    opening++;
    switch (keyAction({ how, atBottom }, panel.contains(doc.activeElement))) {
      case 'hide':
        close(true);
        return false;
      case 'focus-toolbar':
        // A bar that faded while typing is seen again when the keyboard goes to it.
        panel.removeAttribute('data-writing');
        drawn?.entry()?.focus();
        return true;
      case 'focus-document':
        view.focus();
        return true;
      case 'show-at-caret':
        open('keyboard', () =>
          placeBelow(
            view.coordsAtPos(view.state.selection.main.head) ?? view.dom.getBoundingClientRect(),
          ),
        );
        drawn?.entry()?.focus();
        return true;
    }
  };
  const toggle = (): boolean => {
    opening++;
    redock = false;
    if (wrench({ how, atBottom }).how === 'docked') open('docked', () => {});
    else close();
    return how !== null;
  };
  const setAtBottom = (next: boolean): void => {
    if (next === atBottom) return;
    redock = false;
    const after = modelSetAtBottom({ how, atBottom }, next);
    atBottom = next;
    // At the bottom the toolbar is docked, and away from it a docked one goes.
    if (after.how === 'docked' && how !== 'docked') {
      close();
      open('docked', () => {});
    } else if (after.how === null && how === 'docked') {
      close();
    }
  };

  const commands: EditorCommand[] = [
    {
      id: 'toolbar.show',
      title: 'Show Toolbar',
      shortcut: 'Mod-Shift-p',
      menu: 'view',
      group: 'toolbar',
      run: () => {
        show();
        return true;
      },
    },
    ...(options.clipboard ? editCommands(options.clipboard, failed) : []),
  ];
  const removeCommands = editor.commands.register(commands);

  return {
    show,
    toggle,
    setAtBottom,
    hide: () => away('zoom'),
    isOpen: () => how !== null,
    destroy() {
      redock = false;
      close();
      removeCommands();
      removeExtension();
      watchSize?.disconnect();
      container.style.removeProperty('--rl-toolbar-room');
      view.contentDOM.removeEventListener('keydown', onWriting);
      view.contentDOM.removeEventListener('contextmenu', onContextMenu);
      view.contentDOM.removeEventListener('mousedown', notePress, true);
      panel.remove();
      tip.remove();
      removeStyle();
    },
  };
}

export const plugin: Plugin = {
  manifest: {
    id: 'redlines.toolbar',
    name: 'Toolbar',
    version: '0.0.0',
    needs: ['document:read', 'document:edit', 'clipboard'],
    contributes: {
      commands: [{ id: 'toolbar.show', title: 'Show Toolbar', shortcut: 'Mod-Shift-p' }],
    },
  },
  activate: (context) => {
    const editor = context.editor as Editor;
    const read = context.host.clipboard;
    const toolbar = createToolbar(editor, {
      notice: (message) => context.notice(message),
      ...(read
        ? {
            clipboard: pageClipboard(editor, async () => (await read.read())['text/plain'] ?? ''),
          }
        : {}),
    });
    return () => toolbar.destroy();
  },
};
