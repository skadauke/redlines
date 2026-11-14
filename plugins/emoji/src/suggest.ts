// The list of emoji after a colon (#312). Typing `:` and two letters lists the emoji whose names
// start with them, in a small card under the caret; Return or Tab writes the one chosen, ↑ and ↓
// move, and Esc puts the list away. What is written is the emoji itself, never the shortcode, and it
// replaces what was typed like any typing does: with Track Changes on, in the author's own
// insertion.
//
// It keeps out of the way. It opens only after a colon that starts a word (never `10:30`, nor
// `Note:` or `a:b`), with a letter in what follows it, and not in code, in front matter or a link's
// address, in Raw, while an input method composes, or where the text is read only. Nothing else in
// the editor changes: the macOS emoji picker inserts text as it does in any text field.

import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { viewModeField } from '@redlines/editor';
import { emojiMatches, type EmojiName } from './lookup.ts';

/** The colon and the letters typed after it. */
export interface Trigger {
  /** The start of the colon, and the caret, which is the end of what was typed. */
  from: number;
  to: number;
  /** What follows the colon, in lowercase. */
  query: string;
}

/** The kinds of node whose text is not prose. */
const NOT_PROSE = new Set([
  'InlineCode',
  'CodeText',
  'CodeBlock',
  'FencedCode',
  'FrontMatter',
  'URL',
  'HTMLTag',
  'HTMLBlock',
  'CommentBlock',
  'Comment',
  'ProcessingInstruction',
]);

/** The markers of tracked changes, which are no text: HTML comments right before the colon. */
const MARKERS_AT_END = /(?:<!--(?:(?!-->)[^])*-->)+$/;

/**
 * The colon and letters the caret ends, if the list should open for them: a colon that starts a
 * word, then at least two of a name's characters with a letter among them (or `+` or `-`, for
 * `:+1:`), and no letter after the caret.
 */
export function triggerAt(state: EditorState): Trigger | null {
  const range = state.selection.main;
  if (!range.empty || state.readOnly) return null;
  const line = state.doc.lineAt(range.head);
  const column = range.head - line.from;
  const found = /:([A-Za-z0-9_+-]{2,})$/.exec(line.text.slice(0, column));
  if (!found) return null;
  const query = found[1]!.toLowerCase();
  if (!/[a-z]/.test(query) && !/^[+-]/.test(query)) return null;
  // The colon starts a word: what is before it, without the markers of tracked changes, is not a
  // letter, a digit or another colon.
  const before = line.text.slice(0, column - found[0].length).replace(MARKERS_AT_END, '');
  if (/[\p{L}\p{N}:]$/u.test(before)) return null;
  if (/[\p{L}\p{N}]/u.test(line.text.charAt(column))) return null;
  for (let node = syntaxTree(state).resolveInner(range.head, -1); node.parent; node = node.parent) {
    if (NOT_PROSE.has(node.name)) return null;
  }
  return { from: range.head - found[0].length, to: range.head, query };
}

export interface SuggestOptions {
  /** Whether the list may open: Preferences say. Asked each time. */
  enabled?: () => boolean;
}

/** A name as a screen reader says it: its words, with the `_` and `-` between them taken out. */
const spoken = (name: string) => name.replace(/(?<=[a-z0-9])[_-](?=[a-z0-9])/g, ' ');

const MAX_ROWS = 8;
const GAP = 4;
const MARGIN = 8;

class Suggester {
  readonly view: EditorView;
  readonly options: SuggestOptions;
  private list: HTMLElement | null = null;
  private rows: EmojiName[] = [];
  private index = 0;
  private trigger: Trigger | null = null;
  /** The colon whose list Esc put away, which stays away until another colon is typed. */
  private dismissed: number | null = null;
  private readonly onBlur = () => this.close();
  /**
   * The keys of the list, taken before the editor's own: the block keys and the table keys hold
   * Return, Tab, Esc and the arrows at the highest precedence, and a plugin's keymap would come
   * after them. A listener in the capture phase of the editor's element sees the key first, and
   * only while the list is open.
   */
  private readonly onKey = (event: KeyboardEvent) => {
    if (!this.isOpen || event.isComposing || event.shiftKey || event.altKey) return;
    if (event.metaKey || event.ctrlKey) return;
    const taken =
      event.key === 'ArrowDown'
        ? this.move(1)
        : event.key === 'ArrowUp'
          ? this.move(-1)
          : event.key === 'Enter' || event.key === 'Tab'
            ? this.accept()
            : event.key === 'Escape'
              ? this.dismiss()
              : false;
    if (taken) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  constructor(view: EditorView, options: SuggestOptions) {
    this.view = view;
    this.options = options;
    view.contentDOM.addEventListener('blur', this.onBlur);
    view.dom.addEventListener('keydown', this.onKey, true);
  }

  get isOpen(): boolean {
    return this.list !== null;
  }

  update(update: ViewUpdate): void {
    // The view too: the list is not for Raw, whatever was typed before the view was switched.
    const view = (state: EditorState) => state.field(viewModeField, false);
    const switched = view(update.startState) !== view(update.state);
    if (!update.docChanged && !update.selectionSet && !update.focusChanged && !switched) return;
    this.refresh();
  }

  refresh(): void {
    const { view } = this;
    const state = view.state;
    const allowed =
      view.hasFocus &&
      !view.composing &&
      state.field(viewModeField, false) !== 'raw' &&
      (this.options.enabled?.() ?? true);
    const found = allowed ? triggerAt(state) : null;
    if (!found) {
      this.dismissed = null;
      this.close();
      return;
    }
    if (this.dismissed === found.from) {
      this.close();
      return;
    }
    const rows = emojiMatches(found.query, MAX_ROWS);
    if (rows.length === 0) {
      this.close();
      return;
    }
    const same =
      this.trigger?.from === found.from &&
      this.rows.length === rows.length &&
      this.rows.every((row, i) => row.name === rows[i]?.name);
    this.trigger = found;
    this.rows = rows;
    if (!same) this.index = 0;
    this.draw();
  }

  /** Moves the choice by `by` rows, around the ends. */
  move(by: number): boolean {
    if (!this.isOpen) return false;
    this.index = (this.index + by + this.rows.length) % this.rows.length;
    this.draw();
    return true;
  }

  /** Writes the emoji chosen in place of what was typed. */
  accept(index = this.index): boolean {
    const { trigger } = this;
    const row = this.rows[index];
    if (!this.isOpen || !trigger || !row) return false;
    this.close();
    this.view.dispatch({
      changes: { from: trigger.from, to: trigger.to, insert: row.char },
      selection: { anchor: trigger.from + row.char.length },
      userEvent: 'input.complete',
      scrollIntoView: true,
    });
    return true;
  }

  /** Puts the list away for the colon it is for; typing another colon opens it again. */
  dismiss(): boolean {
    if (!this.isOpen) return false;
    this.dismissed = this.trigger?.from ?? null;
    this.close();
    return true;
  }

  close(): void {
    if (!this.list) return;
    this.list.remove();
    this.list = null;
    this.trigger = null;
    const content = this.view.contentDOM;
    for (const name of [
      'aria-expanded',
      'aria-controls',
      'aria-activedescendant',
      'aria-autocomplete',
    ]) {
      content.removeAttribute(name);
    }
  }

  destroy(): void {
    this.view.contentDOM.removeEventListener('blur', this.onBlur);
    this.view.dom.removeEventListener('keydown', this.onKey, true);
    this.close();
  }

  private draw(): void {
    const { view } = this;
    if (!this.list) {
      const list = document.createElement('div');
      list.className = 'rl-emoji-popover';
      list.id = `rl-emoji-list-${Math.random().toString(36).slice(2, 8)}`;
      list.setAttribute('role', 'listbox');
      list.setAttribute('aria-label', 'Emoji');
      // Pressing a row must not take the focus from the text.
      list.addEventListener('mousedown', (event) => event.preventDefault());
      view.dom.append(list);
      this.list = list;
    }
    const list = this.list;
    list.replaceChildren();
    this.rows.forEach((row, i) => {
      const item = document.createElement('div');
      item.className = 'rl-emoji-row';
      item.id = `${list.id}-${i}`;
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(i === this.index));
      item.setAttribute('aria-label', spoken(row.name));
      if (i === this.index) item.classList.add('rl-emoji-selected');
      const glyph = document.createElement('span');
      glyph.className = 'rl-emoji-glyph';
      glyph.setAttribute('aria-hidden', 'true');
      glyph.textContent = row.char;
      const name = document.createElement('span');
      name.className = 'rl-emoji-name';
      name.textContent = `:${row.name}:`;
      item.append(glyph, name);
      item.addEventListener('click', () => this.accept(i));
      list.append(item);
    });
    const content = view.contentDOM;
    content.setAttribute('aria-controls', list.id);
    content.setAttribute('aria-autocomplete', 'list');
    content.setAttribute('aria-activedescendant', `${list.id}-${this.index}`);
    this.place(list);
  }

  /** Under the colon, or above it where there is no room below. Measured after the update. */
  private place(list: HTMLElement): void {
    const { view } = this;
    view.requestMeasure({
      key: this,
      read: () => {
        // At the colon, so that the list stays where it is as more letters are typed.
        const at = this.trigger?.from ?? view.state.selection.main.head;
        return {
          box: view.coordsAtPos(at),
          height: list.offsetHeight,
          width: list.offsetWidth,
        };
      },
      write: ({ box, height, width }) => {
        if (!box || list !== this.list) return;
        const below = box.bottom + GAP;
        const top = below + height > window.innerHeight - MARGIN ? box.top - GAP - height : below;
        const left = Math.min(box.left, window.innerWidth - width - MARGIN);
        list.style.left = `${Math.max(MARGIN, left)}px`;
        list.style.top = `${Math.max(MARGIN, top)}px`;
      },
    });
  }
}

export const suggestTheme = EditorView.baseTheme({
  '.rl-emoji-popover': {
    position: 'fixed',
    zIndex: '300',
    boxSizing: 'border-box',
    minWidth: '200px',
    margin: '0',
    padding: '4px',
    border: '1px solid var(--rl-rule)',
    borderRadius: '10px',
    backgroundColor: 'var(--rl-card)',
    boxShadow: 'var(--rl-shadow)',
    color: 'var(--rl-ink)',
    fontFamily: 'var(--rl-font-ui)',
    fontSize: 'var(--rl-size-ui)',
    lineHeight: '1',
  },
  '.rl-emoji-row': {
    display: 'flex',
    alignItems: 'center',
    boxSizing: 'border-box',
    height: '28px',
    padding: '0 10px 0 6px',
    borderRadius: '6px',
    cursor: 'default',
  },
  // The pressed gray shows on the card in every theme (the tint is the card's own gray in the dark
  // ones), and a bar at the edge shows the row where no color does.
  '.rl-emoji-selected': {
    backgroundColor: 'var(--rl-pressed)',
    boxShadow: 'inset 2px 0 0 var(--rl-ink-2)',
  },
  '.rl-emoji-glyph': { width: '26px', flex: 'none', fontSize: '16px' },
  '.rl-emoji-name': { color: 'var(--rl-ink-2)' },
});

/** The extensions of the list: the view's plugin, which handles its keys, and its look. */
export function suggestExtensions(options: SuggestOptions = {}) {
  return [ViewPlugin.define((view) => new Suggester(view, options)), suggestTheme];
}
