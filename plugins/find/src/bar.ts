// The find bar: a quiet bar at the top right of the editor, drawn like the review bar. A box for
// what to find, "3 of 12" as plain text, previous and next, close; and under it, with Find and
// Replace, a box for the replacement with Replace and Replace All. The bar handles its own keys,
// because the editor's keymap does not reach a text box: Enter and ⇧Enter move, ⌘G, ⇧⌘G, ⌘F and
// ⌥⌘F do what their menu items do, and Esc closes it.

import { type Extension } from '@codemirror/state';
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import type { Editor } from '@redlines/editor';
import {
  currentIndex,
  findField,
  findState,
  replaceAll,
  replaceCurrent,
  setFind,
  step,
} from './search.ts';
import { BAR_INSET, BAR_ROOM, findTheme } from './styles.ts';

const mac = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? '');

const ICONS = {
  previous: '<path d="M4.5 9.75L8 6.25l3.5 3.5"/>',
  next: '<path d="M4.5 6.25L8 9.75l3.5-3.5"/>',
  close: '<path d="M5 5l6 6M11 5l-6 6"/>',
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

/** A button. Pressing it keeps the focus where it is. */
function button(className: string, label: string, run: () => void, svg?: SVGSVGElement) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = className;
  el.setAttribute('aria-label', label);
  if (svg) el.append(svg);
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

class FindBar {
  private readonly view: EditorView;
  private readonly editor: Editor;
  private root: HTMLElement | null = null;
  private query!: HTMLInputElement;
  private replacement!: HTMLInputElement;
  private replaceRow!: HTMLElement;
  private count!: HTMLElement;
  private error!: HTMLElement;
  private buttons!: {
    previous: HTMLButtonElement;
    next: HTMLButtonElement;
    all: HTMLButtonElement;
    one: HTMLButtonElement;
  };
  private wasOpen = false;

  constructor(view: EditorView, editor: Editor) {
    this.view = view;
    this.editor = editor;
    if (findState(view.state).open) this.show();
  }

  update(update: ViewUpdate): void {
    const open = findState(update.state).open;
    if (open !== this.wasOpen) {
      if (open) this.show();
      else this.hide();
    } else if (this.root) {
      if (update.transactions.length) this.refresh();
      if (update.geometryChanged) this.place();
    }
  }

  /** Puts the caret in the find box with its text selected. */
  focus(): void {
    this.query.focus();
    this.query.select();
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
      ),
      next: button(
        'rl-find-icon',
        'Next match',
        run(() => step(view, 1)),
        icon('next'),
      ),
      one: button(
        'rl-find-text',
        'Replace',
        run(() => replaceCurrent(view, this.replacement.value)),
      ),
      all: button(
        'rl-find-text',
        'Replace All',
        run(() => this.replaceAll()),
      ),
    };
    const close = button('rl-find-icon', 'Close', () => this.close(), icon('close'));
    this.replaceRow = row(this.replacement, this.buttons.one, this.buttons.all);

    const root = document.createElement('div');
    root.className = 'rl-find-bar';
    root.setAttribute('role', 'search');
    root.append(
      row(this.query, this.count, this.buttons.previous, this.buttons.next, close),
      this.error,
    );
    this.query.addEventListener('input', () => {
      this.error.hidden = true;
      view.dispatch({ effects: setFind.of({ query: this.query.value }) });
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
    const { left } = replaceAll(this.view, this.replacement.value);
    if (left) {
      this.error.textContent = `Couldn’t change ${left} ${left === 1 ? 'match' : 'matches'} here.`;
      this.error.hidden = false;
    }
  }

  private key(event: KeyboardEvent, editor: Editor): void {
    const mod = mac ? event.metaKey : event.ctrlKey;
    let handled = true;
    if (event.key === 'Escape') this.close();
    else if (event.key === 'Enter' && !mod) {
      if (event.target === this.replacement) replaceCurrent(this.view, this.replacement.value);
      else step(this.view, event.shiftKey ? -1 : 1);
    } else if (mod && event.code === 'KeyG') {
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
    const n = state.matches.length;
    const current = currentIndex(this.view.state, state.matches);
    this.count.textContent = !state.query
      ? ''
      : !n
        ? 'No matches'
        : current >= 0
          ? `${current + 1} of ${n}`
          : `${n} ${n === 1 ? 'match' : 'matches'}`;
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
          top: Math.max(scroller.top, 0) + BAR_INSET,
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

/** The bar as an extension, and a way to put the caret in its find box. */
export function findBar(editor: Editor): { extension: Extension; focus(): void } {
  const plugin = ViewPlugin.define((view) => new FindBar(view, editor));
  const extension = [
    findField,
    plugin,
    findTheme,
    EditorView.scrollMargins.of((view) => (findState(view.state).open ? { top: BAR_ROOM } : null)),
  ];
  return { extension, focus: () => editor.view.plugin(plugin)?.focus() };
}
