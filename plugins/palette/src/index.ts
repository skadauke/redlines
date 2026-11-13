// The formatting palette (issue #313; design §5.1: there is no toolbar, and this is not one). It is
// hidden while you write, and opens in two ways: on hover over a handle at the bottom center of the
// window, and on right-click, at the pointer, in place of WebKit's own menu. Its items are commands
// of the registry, by id, so that it, the Format menu and the shortcuts never disagree about names,
// keys or whether an item is there. Items show no labels: hovering names one and its keys, after the
// title bar's delay. Esc closes it, and it is reachable from the keyboard (Show Formatting Palette,
// or the context menu key), where the arrow keys move among its items.

import { EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { Editor, EditorCommand } from '@redlines/editor';
import type { Plugin } from '@redlines/plugin-api';
import { editCommands, type PaletteClipboard, pageClipboard } from './edit.ts';
import { shownGroups } from './items.ts';
import { type DrawnPanel, drawPanel, type PanelHandlers, type SpellingRows } from './panel.ts';
import { type PaletteSpelling, SPELLING_WAIT_MS, within } from './spelling.ts';
import { installStyle } from './styles.ts';

export type { PaletteClipboard } from './edit.ts';
export { pageClipboard } from './edit.ts';
export type { PaletteSpelling } from './spelling.ts';
export { formatShortcut } from './shortcuts.ts';

export interface PaletteOptions {
  /**
   * The box the palette and its handle go in. Default: the editor's own element. Where it goes
   * makes no difference to where they appear: both are fixed to the window.
   */
  container?: HTMLElement;
  /** How long the pointer rests on an item before its hint shows: the title bar's `TOOLTIP_MS`. */
  tooltipMs?: number;
  /** How the Edit items reach the clipboard. Without it, Cut, Copy and Paste are left out. */
  clipboard?: PaletteClipboard;
  /** The spell checker, for suggestions on a right-click on a misspelled word. Default: none. */
  spelling?: PaletteSpelling;
  /**
   * Whether a right-click in the text opens the palette. Default: true. Where false, the browser's
   * own menu stays. ⇧ with the right-click always shows that one, which has what the palette
   * doesn't (Look Up, Services, Writing Tools).
   */
  contextMenu?: boolean;
  /** Shows a one-line message that doesn't interrupt, for what can't be done. */
  notice(message: string): void;
}

export interface Palette {
  /**
   * Opens the palette below the caret with the keyboard in its first item, or puts it away when it
   * is open. Returns whether it is open.
   */
  show(): boolean;
  /** Puts the palette away. */
  hide(): void;
  isOpen(): boolean;
  /** Takes the palette, its handle and its commands out of the page. */
  destroy(): void;
}

/** How the palette was opened, which says what puts it away. */
type How = 'hover' | 'click' | 'keyboard' | 'context';

/** The title bar's delays: a menu opens a moment after the pointer comes, and closes after it goes. */
const HOVER_OPEN_MS = 120;
const HOVER_CLOSE_MS = 200;
/** The space around the palette, and between it and what it is placed against. */
const MARGIN = 8;
const GAP = 8;
/** The hint's distance from the item it names. */
const HINT_GAP = 6;

const NO_TEXT = 'The clipboard has no text to paste.';

/** `selection.main` is where `pos` is, for a right-click: kept when inside the selection. */
function moveSelectionTo(view: EditorView, pos: number): void {
  const { main } = view.state.selection;
  if (!main.empty && pos >= main.from && pos <= main.to) return;
  // As the Mac does for a right-click in text: the word under the pointer is selected.
  const word = view.state.wordAt(pos);
  view.dispatch({
    selection: word ? EditorSelection.range(word.from, word.to) : EditorSelection.cursor(pos),
    userEvent: 'select.pointer',
  });
}

/**
 * Adds the palette to an editor: its handle, its right-click, and the commands Show Formatting
 * Palette (⌥⌘P, in the View menu) and, with a clipboard, Cut, Copy and Paste (which have no menu
 * or key here). Register the plugins whose commands it shows first, or later: an item appears when
 * its command is registered. Returns the palette, whose `destroy` takes it out again.
 */
export function createPalette(editor: Editor, options: PaletteOptions): Palette {
  const { view } = editor;
  const doc = view.dom.ownerDocument;
  const win = doc.defaultView ?? window;
  const tooltipMs = options.tooltipMs ?? 400;
  const removeStyle = installStyle(doc);

  // The parts: the handle, the palette, and the hint, which is the palette's own.
  const handle = doc.createElement('button');
  handle.type = 'button';
  handle.className = 'rl-palette-handle';
  handle.tabIndex = -1;
  handle.setAttribute('aria-label', 'Formatting palette');
  handle.setAttribute('aria-haspopup', 'true');
  handle.setAttribute('aria-expanded', 'false');
  const grip = doc.createElement('span');
  grip.className = 'rl-palette-grip';
  handle.append(grip);
  const panel = doc.createElement('div');
  panel.className = 'rl-palette';
  panel.setAttribute('role', 'toolbar');
  panel.setAttribute('aria-label', 'Formatting palette');
  panel.hidden = true;
  const tip = doc.createElement('div');
  tip.className = 'rl-palette-tip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  const tipName = doc.createElement('span');
  const tipKeys = doc.createElement('span');
  tipKeys.className = 'rl-palette-tip-keys';
  tip.append(tipName, tipKeys);
  const container = options.container ?? view.dom;
  container.append(handle, panel, tip);

  let how: How | null = null;
  let drawn: DrawnPanel | null = null;
  /** The spelling rows the palette holds, and the word they are for. */
  let spelling: {
    rows: SpellingRows;
    from: number;
    to: number;
    doc: typeof view.state.doc;
  } | null = null;
  /** Counts the palette's openings, so that an answer that comes late knows its own. */
  let opening = 0;
  let placeAgain: () => void = () => {};
  let openTimer: ReturnType<typeof setTimeout> | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  let hintTimer: ReturnType<typeof setTimeout> | undefined;

  const groups = () => shownGroups(editor.commands.list(), view.state);

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
      tip.style.top = `${room >= MARGIN || tip.offsetHeight === 0 ? below : rect.top - HINT_GAP - tip.offsetHeight}px`;
    }, tooltipMs);
  };

  // Where the palette goes: at a point, above a point, or below a box, kept inside the window.
  const clamp = (value: number, size: number, limit: number) =>
    Math.max(MARGIN, Math.min(value, limit - size - MARGIN));
  const placeAt = (x: number, y: number) => {
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    // At the pointer, or above it when the window ends first, as a menu does.
    const top = y + height + MARGIN > win.innerHeight ? y - height : y;
    panel.style.left = `${clamp(x, width, win.innerWidth)}px`;
    panel.style.top = `${Math.max(MARGIN, top)}px`;
  };
  const placeAbove = (rect: DOMRect) => {
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    panel.style.left = `${clamp(rect.left + rect.width / 2 - width / 2, width, win.innerWidth)}px`;
    panel.style.top = `${Math.max(MARGIN, rect.top - GAP - height)}px`;
  };
  const placeBelow = (rect: { left: number; top: number; bottom: number }) => {
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    const fits = rect.bottom + GAP + height + MARGIN <= win.innerHeight;
    panel.style.left = `${clamp(rect.left, width, win.innerWidth)}px`;
    panel.style.top = `${Math.max(MARGIN, fits ? rect.bottom + GAP : rect.top - GAP - height)}px`;
  };

  /** Draws the items as the registry has them now; in place when they are the ones drawn. */
  const refresh = () => {
    if (how === null) return;
    if (!drawn?.refresh(groups()))
      drawn = drawPanel(panel, groups(), spelling?.rows ?? null, handlers);
  };

  const handlers: PanelHandlers = {
    run(id) {
      close(true);
      editor.commands.run(id);
    },
    pick(suggestion) {
      const held = spelling;
      close(true);
      // The text moved on since the word was found: it is not this word any more.
      if (!held || view.state.doc !== held.doc) return;
      editor.pickCorrection({ from: held.from, to: held.to }, held.rows.word, suggestion);
    },
    learn() {
      const held = spelling;
      close(true);
      if (held) void Promise.resolve(options.spelling?.learn?.(held.rows.word)).catch(() => {});
    },
    hint,
  };

  // What puts the palette away: Esc, a press elsewhere, leaving the window, a scroll or a resize,
  // and typing, which means the person went back to writing.
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || event.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    close(true);
  };
  const onPress = (event: PointerEvent) => {
    const target = event.target;
    if (target instanceof Node && (panel.contains(target) || handle.contains(target))) return;
    close();
  };
  const onScroll = (event: Event) => {
    // The handle's palette is fixed to the window, and what is under it can scroll.
    if (how === 'context' || how === 'keyboard') {
      if (!(event.target instanceof Node) || !panel.contains(event.target)) close();
    }
  };
  const onGone = () => close();

  function listen(): void {
    doc.addEventListener('keydown', onKey, true);
    doc.addEventListener('pointerdown', onPress, true);
    doc.addEventListener('scroll', onScroll, true);
    win.addEventListener('blur', onGone);
    win.addEventListener('resize', onGone);
  }
  function unlisten(): void {
    doc.removeEventListener('keydown', onKey, true);
    doc.removeEventListener('pointerdown', onPress, true);
    doc.removeEventListener('scroll', onScroll, true);
    win.removeEventListener('blur', onGone);
    win.removeEventListener('resize', onGone);
  }

  function open(next: How, place: () => void, rows: typeof spelling = null): void {
    clearTimeout(openTimer);
    clearTimeout(closeTimer);
    hideHint();
    if (how === null) listen();
    how = next;
    spelling = rows;
    drawn = drawPanel(panel, groups(), rows?.rows ?? null, handlers);
    panel.hidden = false;
    placeAgain = place;
    place();
    handle.setAttribute('aria-expanded', 'true');
  }

  function close(refocus = false): void {
    clearTimeout(openTimer);
    clearTimeout(closeTimer);
    hideHint();
    opening++;
    if (how === null) return;
    const hadFocus = panel.contains(doc.activeElement);
    how = null;
    drawn = null;
    spelling = null;
    panel.hidden = true;
    handle.setAttribute('aria-expanded', 'false');
    unlisten();
    // The keyboard was in the palette, and has nowhere to be but the text.
    if (hadFocus || refocus) view.focus();
  }

  const fromHandle = (next: 'hover' | 'click') => () => {
    open(next, () => placeAbove(handle.getBoundingClientRect()));
  };

  // The handle: hovering brings the palette up, and moving away puts it away. A press on it keeps
  // the palette until Esc or a press elsewhere. A pointer with a button held is selecting text, and
  // brings up nothing.
  handle.addEventListener('pointerenter', (event) => {
    if (event.pointerType === 'touch' || event.buttons !== 0) return;
    clearTimeout(closeTimer);
    if (how === null) openTimer = setTimeout(fromHandle('hover'), HOVER_OPEN_MS);
  });
  const scheduleClose = (event: PointerEvent) => {
    if (event.pointerType === 'touch') return;
    clearTimeout(openTimer);
    if (how === 'hover') closeTimer = setTimeout(() => close(), HOVER_CLOSE_MS);
  };
  handle.addEventListener('pointerleave', scheduleClose);
  panel.addEventListener('pointerenter', () => clearTimeout(closeTimer));
  panel.addEventListener('pointerleave', scheduleClose);
  handle.addEventListener('mousedown', (event) => event.preventDefault());
  handle.addEventListener('click', () => {
    if (how === 'click') close();
    else fromHandle('click')();
  });

  // The keys in the palette: the arrows move among the items, Home and End to the ends, and Tab and
  // Esc put it away. Return and Space press the item, as a button does.
  panel.addEventListener('keydown', (event) => {
    const rows = drawn?.rows() ?? [];
    const flat = rows.flat();
    const at = flat.indexOf(doc.activeElement as HTMLButtonElement);
    const row = rows.findIndex((r) => r.includes(doc.activeElement as HTMLButtonElement));
    const go = (button: HTMLButtonElement | undefined) => button?.focus();
    switch (event.key) {
      case 'ArrowRight':
        go(flat[(at + 1) % flat.length]);
        break;
      case 'ArrowLeft':
        go(flat[(at - 1 + flat.length) % flat.length]);
        break;
      case 'ArrowDown':
      case 'ArrowUp': {
        const next = rows[(row + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length];
        // The same column, or the last item of a shorter row.
        const column = Math.max(0, rows[row]?.indexOf(doc.activeElement as HTMLButtonElement) ?? 0);
        go(next?.[Math.min(column, next.length - 1)]);
        break;
      }
      case 'Home':
        go(flat[0]);
        break;
      case 'End':
        go(flat.at(-1));
        break;
      case 'Tab':
        event.preventDefault();
        close(true);
        return;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  });

  // Typing: the handle goes out of the way until the pointer moves, and a palette that the pointer
  // opened goes too. A key that only moves the caret or holds a modifier is not writing.
  const onWriting = (event: KeyboardEvent) => {
    if (event.key.length > 1 && !/^(Backspace|Delete|Enter|Tab)$/.test(event.key)) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    handle.dataset['writing'] = '';
    if (how !== null && how !== 'keyboard') close();
  };
  const onMove = () => delete handle.dataset['writing'];
  view.contentDOM.addEventListener('keydown', onWriting);
  win.addEventListener('pointermove', onMove);

  // The right-click.
  const rowsOf = (word: string, suggestions: readonly string[]): SpellingRows => ({
    word,
    suggestions,
    canLearn: options.spelling?.learn !== undefined,
  });

  async function openContext(x: number, y: number, fromKeyboard: boolean): Promise<void> {
    close();
    const mine = ++opening;
    let at = view.state.selection.main.head;
    if (!fromKeyboard) {
      const pos = view.posAtCoords({ x, y }, false);
      at = pos;
      moveSelectionTo(view, pos);
    }
    const found = options.spelling?.enabled() ? editor.wordAt(at) : null;
    let rows: typeof spelling = null;
    if (found && options.spelling) {
      const asked = options.spelling.suggest(found.word, found.before);
      const answer = await within(asked, SPELLING_WAIT_MS, 'late' as const).catch(() => null);
      if (mine !== opening) return;
      const held = (suggestions: readonly string[]) => ({
        rows: rowsOf(found.word, suggestions),
        from: found.from,
        to: found.to,
        doc: view.state.doc,
      });
      if (answer === 'late') {
        // The palette opens without them, and takes them in if they come while it is open.
        void asked.then(
          (late) => {
            if (mine !== opening || how === null || !late) return;
            spelling = held(late);
            drawn = drawPanel(panel, groups(), spelling.rows, handlers);
            placeAgain();
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
    // From the keyboard, the keyboard goes into the palette.
    if (fromKeyboard) drawn?.rows()[0]?.[0]?.focus();
  }

  const onContextMenu = (event: MouseEvent) => {
    if (options.contextMenu === false || event.defaultPrevented || event.shiftKey) return;
    event.preventDefault();
    // The menu key and Ctrl-Return ask for the menu at the caret: no button is down.
    void openContext(event.clientX, event.clientY, event.button === 0 && event.buttons === 0);
  };
  view.contentDOM.addEventListener('contextmenu', onContextMenu);

  // The palette stays true to the selection while it is open: Bold is on inside bold text, and
  // Cut and Copy need a selection.
  const removeExtension = editor.addExtension(
    EditorView.updateListener.of((update) => {
      if (how !== null && (update.selectionSet || update.docChanged)) refresh();
    }),
  );

  const failed = (what: 'cut' | 'copy' | 'paste') =>
    options.notice(what === 'paste' ? NO_TEXT : `Couldn’t ${what}.`);
  const show = (): boolean => {
    if (how !== null) {
      close(true);
      return false;
    }
    open('keyboard', () =>
      placeBelow(
        view.coordsAtPos(view.state.selection.main.head) ?? view.dom.getBoundingClientRect(),
      ),
    );
    drawn?.rows()[0]?.[0]?.focus();
    return true;
  };

  const commands: EditorCommand[] = [
    {
      id: 'palette.show',
      title: 'Show Formatting Palette',
      shortcut: 'Mod-Alt-p',
      menu: 'view',
      group: 'palette',
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
    hide: () => close(),
    isOpen: () => how !== null,
    destroy() {
      close();
      removeCommands();
      removeExtension();
      view.contentDOM.removeEventListener('keydown', onWriting);
      view.contentDOM.removeEventListener('contextmenu', onContextMenu);
      win.removeEventListener('pointermove', onMove);
      handle.remove();
      panel.remove();
      tip.remove();
      removeStyle();
    },
  };
}

export const plugin: Plugin = {
  manifest: {
    id: 'redlines.palette',
    name: 'Formatting palette',
    version: '0.0.0',
    needs: ['document:read', 'document:edit', 'clipboard'],
    contributes: {
      commands: [{ id: 'palette.show', title: 'Show Formatting Palette', shortcut: 'Mod-Alt-p' }],
    },
  },
  activate: (context) => {
    const editor = context.editor as Editor;
    const read = context.host.clipboard;
    const palette = createPalette(editor, {
      notice: (message) => context.notice(message),
      ...(read
        ? {
            clipboard: pageClipboard(editor, async () => (await read.read())['text/plain'] ?? ''),
          }
        : {}),
    });
    return () => palette.destroy();
  },
};
