// The find bar: a quiet bar at the top right of the editor, drawn like the review bar. A box for
// what to find, "3 of 12" as plain text, previous and next, close; and under it, with Find and
// Replace, a box for the replacement with Replace and Replace All. The bar handles its own keys,
// because the editor's keymap does not reach a text box: Enter and ⇧Enter move, ⌘G, ⇧⌘G, ⌘F and
// ⌥⌘F do what their menu items do, and Esc closes it. A chevron at the start of the find row shows
// or hides the replace row, keeping the find text and the current match. Inside the find box sit
// the count and four toggles (Match Case, Whole Word, Regular Expression, Find in Selection), on
// ⌥⌘C, ⌥⌘W, ⌥⌘R and ⌥⌘L while the box has the focus; Tab in it goes to the replace box, which it
// opens first if need be, and ⇧Tab comes back. A red pen in the replace box says Track Changes is on.

import { type Extension } from '@codemirror/state';
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { type EditorState } from '@codemirror/state';
import { type Editor, undo } from '@redlines/editor';
import {
  currentIndex,
  type FindOptions,
  findField,
  findState,
  replaceAll,
  replaceCurrent,
  selectFrom,
  setFind,
  step,
} from './search.ts';
import { BAR_INSET, BAR_ROOM, findTheme } from './styles.ts';

const mac = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? '');

/** What the app around the editor lends the bar. */
export interface FindHost {
  /** Shows news that may offer one action, such as Undo, and goes by itself. */
  toast?: (toast: { text: string; action?: { label: string; run: () => void } }) => void;
}

/** A key as a hint writes it. */
const keyName = (mark: string, letter: string) => (mac ? `${mark}${letter}` : `Ctrl+Alt+${letter}`);

const ICONS = {
  show: '<path d="M6.25 4.5L9.75 8l-3.5 3.5"/>',
  hide: '<path d="M4.5 6.25L8 9.75l3.5-3.5"/>',
  previous: '<path d="M4.5 9.75L8 6.25l3.5 3.5"/>',
  next: '<path d="M4.5 6.25L8 9.75l3.5-3.5"/>',
  close: '<path d="M5 5l6 6M11 5l-6 6"/>',
  selection:
    '<path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h6"/><path d="M1.25 2.75v10.5" stroke-width="1.1"/>',
  pen: '<path d="M10.25 3.25l2.5 2.5-6.5 6.5-3 .5.5-3z"/><path d="M9 4.5l2.5 2.5"/>',
} as const;

function icon(name: keyof typeof ICONS): SVGSVGElement {
  const template = document.createElement('template');
  template.innerHTML =
    '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" ' +
    'stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ' +
    `focusable="false">${ICONS[name]}</svg>`;
  const svg = template.content.firstElementChild;
  if (!(svg instanceof SVGSVGElement)) throw new Error(`Couldn't draw the ${name} icon`);
  return svg;
}

/**
 * A button. Pressing it keeps the focus where it is. Its hint says what it does and its key; a
 * `glyph` is its face when it has no icon.
 */
function button(
  className: string,
  label: string,
  run: () => void,
  face?: SVGSVGElement | string,
  hint = label,
) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = className;
  el.setAttribute('aria-label', label);
  el.title = hint;
  if (typeof face === 'string') el.textContent = face;
  else if (face) el.append(face);
  else el.textContent = label;
  el.addEventListener('mousedown', (event) => event.preventDefault());
  el.addEventListener('click', run);
  return el;
}

function box(className: string, placeholder: string): HTMLInputElement {
  const el = document.createElement('input');
  el.type = 'text';
  el.className = className;
  el.placeholder = placeholder;
  el.setAttribute('aria-label', placeholder);
  el.spellcheck = false;
  el.autocomplete = 'off';
  return el;
}

const row = (...children: Node[]) => {
  const el = document.createElement('div');
  el.className = 'rl-find-row';
  el.append(...children);
  return el;
};

const TOGGLES = [
  { option: 'matchCase', label: 'Match Case', letter: 'C', code: 'KeyC', face: 'Aa' },
  { option: 'wholeWord', label: 'Whole Word', letter: 'W', code: 'KeyW', face: 'ab' },
  { option: 'regex', label: 'Regular Expression', letter: 'R', code: 'KeyR', face: '.*' },
] as const satisfies readonly {
  option: keyof FindOptions;
  label: string;
  letter: string;
  code: string;
  face: string;
}[];

class FindBar {
  private readonly view: EditorView;
  private readonly editor: Editor;
  private readonly host: FindHost;
  private root: HTMLElement | null = null;
  private query!: HTMLInputElement;
  private replacement!: HTMLInputElement;
  private replaceRow!: HTMLElement;
  private disclosure!: HTMLButtonElement;
  private count!: HTMLElement;
  private error!: HTMLElement;
  private field!: HTMLElement;
  private pen!: HTMLElement;
  private toggles!: Map<string, HTMLButtonElement>;
  private scopeButton!: HTMLButtonElement;
  private buttons!: {
    previous: HTMLButtonElement;
    next: HTMLButtonElement;
    all: HTMLButtonElement;
    one: HTMLButtonElement;
  };
  private wasOpen = false;
  /** The last selection that was not a match: what Find in Selection limits to, once a match is current. */
  private chosen: { from: number; to: number } | null = null;

  constructor(view: EditorView, editor: Editor, host: FindHost) {
    this.view = view;
    this.editor = editor;
    this.host = host;
    if (findState(view.state).open) this.show();
  }

  update(update: ViewUpdate): void {
    const open = findState(update.state).open;
    if (this.chosen && update.docChanged) {
      this.chosen = {
        from: update.changes.mapPos(this.chosen.from, -1),
        to: update.changes.mapPos(this.chosen.to, 1),
      };
    }
    // A selection a person made, not one find made by stepping or replacing.
    if (
      update.selectionSet &&
      !update.transactions.some((tr) => tr.isUserEvent('select.find') || tr.isUserEvent('input'))
    ) {
      this.remember(update.state);
    }
    if (open !== this.wasOpen) {
      if (open) this.show();
      else this.hide();
    } else if (this.root) {
      if (update.transactions.length) this.refresh();
      if (update.geometryChanged) this.place();
    }
  }

  /** Keeps the selection a person made, so that stepping to a match does not replace it. */
  private remember(state: EditorState): void {
    const { from, to } = state.selection.main;
    const found = findState(state);
    if (from === to || found.matches.some((m) => m.from === from && m.to === to)) return;
    this.chosen = { from, to };
  }

  /** Puts the caret in the find box (or the replace box) with its text selected. */
  focus(replace = false): void {
    const target = replace && this.replacement.isConnected ? this.replacement : this.query;
    target.focus();
    target.select();
  }

  /** Shows or hides the replace row. */
  private toggleReplace(): void {
    const replace = !findState(this.view.state).replace;
    const inReplace = document.activeElement === this.replacement;
    this.view.dispatch({ effects: setFind.of({ replace }) });
    if (!replace && inReplace) this.query.focus();
  }

  /** Turns an option on or off, and goes to the nearest match under the new rule. */
  private toggle(option: keyof FindOptions): void {
    const value = !findState(this.view.state)[option];
    this.error.hidden = true;
    this.view.dispatch({ effects: setFind.of({ [option]: value }) });
    this.settleOnMatch();
  }

  /** Turns Find in Selection on, for the selection, or off. */
  private toggleScope(): void {
    const { view } = this;
    this.error.hidden = true;
    if (findState(view.state).scope) {
      view.dispatch({ effects: setFind.of({ scope: null }) });
    } else {
      const scope = this.chosen;
      if (!scope) return;
      view.dispatch({ effects: setFind.of({ scope: { ...scope } }) });
    }
    this.settleOnMatch();
  }

  /** Makes the first match from the caret the current one, when there is one. */
  private settleOnMatch(): void {
    const { view } = this;
    if (findState(view.state).matches.length) selectFrom(view, view.state.selection.main.from);
  }

  private close(): void {
    this.view.dispatch({ effects: setFind.of({ open: false }) });
    this.view.focus();
  }

  private show(): void {
    const { view, editor } = this;
    this.wasOpen = true;
    this.query = box('rl-find-query', 'Find');
    this.replacement = box('rl-find-replacement', 'Replace with');
    this.count = document.createElement('span');
    this.count.className = 'rl-find-count';
    this.count.setAttribute('aria-live', 'polite');
    this.error = document.createElement('div');
    this.error.className = 'rl-find-error';
    this.error.hidden = true;
    const run = (fn: () => void) => () => {
      this.error.hidden = true;
      fn();
    };
    this.buttons = {
      previous: button(
        'rl-find-icon',
        'Previous match',
        run(() => step(view, -1)),
        icon('previous'),
        `Previous Match (${mac ? '⇧↩' : 'Shift+Enter'})`,
      ),
      next: button(
        'rl-find-icon',
        'Next match',
        run(() => step(view, 1)),
        icon('next'),
        `Next Match (${mac ? '↩' : 'Enter'})`,
      ),
      one: button(
        'rl-find-text',
        'Replace',
        run(() => replaceCurrent(view, this.replacement.value)),
        undefined,
        `Replace this match and go to the next (${mac ? '↩' : 'Enter'} in the box)`,
      ),
      all: button(
        'rl-find-text',
        'Replace All',
        run(() => this.replaceAll()),
        undefined,
        'Replace every match in one step; Undo takes them all back',
      ),
    };
    this.disclosure = button(
      'rl-find-icon rl-find-disclosure',
      'Show Replace',
      () => this.toggleReplace(),
      icon('show'),
      `Show Replace (${mac ? '⌥⌘F' : 'Ctrl+Alt+F'})`,
    );
    const close = button('rl-find-icon', 'Close', () => this.close(), icon('close'), 'Close (Esc)');

    this.toggles = new Map();
    const options = TOGGLES.map(({ option, label, letter, face }) => {
      const el = button(
        `rl-find-toggle rl-find-toggle-${option}`,
        label,
        () => this.toggle(option),
        face,
        `${label} (${keyName('⌥⌘', letter)})`,
      );
      this.toggles.set(option, el);
      return el;
    });
    this.scopeButton = button(
      'rl-find-toggle rl-find-toggle-scope',
      'Find in Selection',
      () => this.toggleScope(),
      icon('selection'),
      `Find in Selection (${keyName('⌥⌘', 'L')})`,
    );
    this.field = document.createElement('div');
    this.field.className = 'rl-find-field';
    this.field.append(this.query, this.count, ...options, this.scopeButton);

    this.pen = document.createElement('span');
    this.pen.className = 'rl-find-pen';
    this.pen.title = 'Track Changes is on: each replacement is a tracked change';
    this.pen.append(icon('pen'));
    const replaceField = document.createElement('div');
    replaceField.className = 'rl-find-field';
    replaceField.append(this.replacement, this.pen);
    const spacer = document.createElement('span');
    spacer.className = 'rl-find-spacer';
    this.replaceRow = row(spacer, replaceField, this.buttons.one, this.buttons.all);

    const root = document.createElement('div');
    root.className = 'rl-find-bar';
    root.setAttribute('role', 'search');
    root.append(
      row(this.disclosure, this.field, this.buttons.previous, this.buttons.next, close),
      this.error,
    );
    this.query.addEventListener('input', () => {
      this.error.hidden = true;
      view.dispatch({ effects: setFind.of({ query: this.query.value }) });
      this.settleOnMatch();
    });
    root.addEventListener('keydown', (event) => this.key(event, editor));
    view.dom.append(root);
    this.root = root;
    this.refresh();
    this.place();
  }

  private hide(): void {
    this.wasOpen = false;
    this.root?.remove();
    this.root = null;
  }

  private replaceAll(): void {
    const { view, editor, host } = this;
    const { replaced, left } = replaceAll(view, this.replacement.value);
    if (left) {
      this.error.textContent = `Couldn’t change ${left} ${left === 1 ? 'match' : 'matches'} here.`;
      this.error.hidden = false;
    }
    if (!replaced) return;
    const after = view.state.doc;
    host.toast?.({
      text: `Replaced ${replaced} ${replaced === 1 ? 'match' : 'matches'}.`,
      action: {
        label: 'Undo',
        // Only while the document is as this Replace All left it: never a later edit, or another
        // Replace All.
        run: () => {
          if (view.state.doc === after && editor.getUiState().undo === 'Replace All') undo(view);
        },
      },
    });
  }

  /** Tab in Find goes to Replace (opening its row first); ⇧Tab in Replace goes back. */
  private tab(event: KeyboardEvent): boolean {
    if (event.target === this.query && !event.shiftKey) {
      if (!findState(this.view.state).replace) {
        this.view.dispatch({ effects: setFind.of({ replace: true }) });
      }
      this.focus(true);
      return true;
    }
    if (event.target === this.replacement && event.shiftKey) {
      this.focus();
      return true;
    }
    return false;
  }

  private key(event: KeyboardEvent, editor: Editor): void {
    const mod = mac ? event.metaKey : event.ctrlKey;
    let handled = true;
    const toggle = TOGGLES.find((t) => event.code === t.code);
    if (event.key === 'Escape') this.close();
    else if (event.key === 'Tab' && !mod && !event.altKey) handled = this.tab(event);
    else if (event.key === 'Enter' && !mod) {
      if (event.target === this.replacement) replaceCurrent(this.view, this.replacement.value);
      else step(this.view, event.shiftKey ? -1 : 1);
    } else if (mod && event.altKey && toggle) this.toggle(toggle.option);
    else if (mod && event.altKey && event.code === 'KeyL') this.toggleScope();
    else if (mod && event.code === 'KeyG') {
      editor.commands.run(event.shiftKey ? 'find.previous' : 'find.next');
    } else if (mod && event.code === 'KeyF') {
      editor.commands.run(event.altKey ? 'find.replace' : 'find.open');
    } else handled = false;
    if (!handled) return;
    // Not on to the menu bar, whose item would run it again.
    event.preventDefault();
    event.stopPropagation();
  }

  /** Brings the boxes, the count and the buttons up to date. */
  private refresh(): void {
    const state = findState(this.view.state);
    if (this.query.value !== state.query) this.query.value = state.query;
    if (state.replace !== this.replaceRow.isConnected) {
      if (state.replace) this.root?.insertBefore(this.replaceRow, this.error);
      else this.replaceRow.remove();
    }
    const label = state.replace ? 'Hide Replace' : 'Show Replace';
    this.disclosure.setAttribute('aria-label', label);
    this.disclosure.title = `${label} (${mac ? '⌥⌘F' : 'Ctrl+Alt+F'})`;
    this.disclosure.setAttribute('aria-expanded', String(state.replace));
    this.disclosure.replaceChildren(icon(state.replace ? 'hide' : 'show'));
    for (const [option, el] of this.toggles) {
      el.setAttribute('aria-pressed', String(state[option as keyof FindOptions]));
    }
    this.scopeButton.setAttribute('aria-pressed', String(!!state.scope));
    this.query.placeholder = state.scope ? 'Find in selection' : 'Find';
    this.query.setAttribute('aria-label', this.query.placeholder);
    this.field.classList.toggle('rl-find-invalid', state.invalid);
    this.pen.hidden = !state.tracking;
    const n = state.matches.length;
    const current = currentIndex(this.view.state, state.matches);
    this.count.textContent = state.invalid
      ? 'Invalid'
      : !state.query
        ? ''
        : !n
          ? 'No results'
          : current >= 0
            ? `${current + 1} of ${n}`
            : `${n} ${n === 1 ? 'result' : 'results'}`;
    this.buttons.previous.disabled = this.buttons.next.disabled = !n;
    this.buttons.one.disabled = this.buttons.all.disabled = !n;
  }

  /** Keeps the bar in the top right corner of the editor. */
  private place(): void {
    this.view.requestMeasure({
      key: this,
      read: (view) => {
        const win = view.dom.ownerDocument.defaultView ?? window;
        const scroller = view.scrollDOM.getBoundingClientRect();
        return {
          // Below what the host floats over the top of the editor, such as a title bar.
          top: Math.max(scroller.top, hostRoom(view)) + BAR_INSET,
          right: win.innerWidth - Math.min(scroller.right, win.innerWidth) + BAR_INSET,
        };
      },
      write: ({ top, right }) => {
        if (!this.root) return;
        this.root.style.top = `${top}px`;
        this.root.style.right = `${right}px`;
      },
    });
  }

  destroy(): void {
    this.hide();
  }
}

/**
 * The room the host keeps at the top of the editor for itself, which text is scrolled clear of: a
 * title bar that floats over the page, say. What the other scroll margins ask for, not the bar's
 * own, which sits below it.
 */
function hostRoom(view: EditorView): number {
  let room = 0;
  for (const margins of view.state.facet(EditorView.scrollMargins)) {
    if (margins !== barRoom) room = Math.max(room, margins(view)?.top ?? 0);
  }
  return room;
}

/** While the bar is open, the room it and the host's keep above the text the editor scrolls to. */
function barRoom(view: EditorView) {
  return findState(view.state).open ? { top: hostRoom(view) + BAR_ROOM } : null;
}

/** The bar as an extension, and a way to put the caret in its find box. */
export function findBar(
  editor: Editor,
  host: FindHost = {},
): { extension: Extension; focus(replace?: boolean): void } {
  const plugin = ViewPlugin.define((view) => new FindBar(view, editor, host));
  const extension = [findField, plugin, findTheme, EditorView.scrollMargins.of(barRoom)];
  return { extension, focus: (replace) => editor.view.plugin(plugin)?.focus(replace) };
}
