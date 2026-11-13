// The palette's parts as page elements: a row of icon buttons for each group, and above them, for a
// right-click on a misspelled word, the system's suggestions. The elements are drawn from what the
// registry holds now (`shownGroups`) and kept up to date as the selection changes. Every button
// keeps the keyboard where it is, in the document, so that using the palette with the mouse never
// moves the caret or loses the selection.

import type { ShownGroup, ShownItem } from './items.ts';
import { paletteIcon } from './icons.ts';

/** What the person may do with a misspelled word. */
export interface SpellingRows {
  word: string;
  /** The checker's guesses, best first; none for a word it has no guess for. */
  suggestions: readonly string[];
  /** Whether the word can be learned: the host has a dictionary to add it to. */
  canLearn: boolean;
}

export interface PanelHandlers {
  /** An item was chosen. */
  run(id: string): void;
  /** A suggestion was chosen. */
  pick(suggestion: string): void;
  /** Learn Spelling was chosen. */
  learn(): void;
  /** The pointer, or the keyboard, came to an item (with it) or left them all (null). */
  hint(button: HTMLElement | null): void;
}

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string) => {
  const el = document.createElement(tag);
  el.className = className;
  return el;
};

/** A hairline between the parts of the palette. */
function rule(): HTMLElement {
  const line = element('div', 'rl-palette-rule');
  line.setAttribute('role', 'separator');
  return line;
}

/** A button that leaves the keyboard in the document when the mouse presses it. */
function keepsFocus(button: HTMLButtonElement): HTMLButtonElement {
  button.type = 'button';
  button.tabIndex = -1;
  button.addEventListener('mousedown', (event) => event.preventDefault());
  return button;
}

/** The attributes of an item's button that follow the selection. */
function update(button: HTMLButtonElement, item: ShownItem): void {
  button.disabled = !item.enabled;
  if (item.toggle) button.setAttribute('aria-pressed', String(item.active));
  else button.removeAttribute('aria-pressed');
  button.setAttribute('aria-label', item.name);
  if (item.aria) button.setAttribute('aria-keyshortcuts', item.aria);
  else button.removeAttribute('aria-keyshortcuts');
  button.dataset['name'] = item.name;
  if (item.keys) button.dataset['keys'] = item.keys;
  else delete button.dataset['keys'];
}

function itemButton(item: ShownItem, handlers: PanelHandlers): HTMLButtonElement {
  const button = keepsFocus(element('button', 'rl-palette-item'));
  button.dataset['command'] = item.id;
  button.append(paletteIcon(item.icon));
  update(button, item);
  button.addEventListener('click', () => {
    if (!button.disabled) handlers.run(item.id);
  });
  for (const [type, hint] of [
    ['pointerenter', true],
    ['focus', true],
    ['pointerleave', false],
    ['blur', false],
  ] as const) {
    button.addEventListener(type, (event) => {
      if ((event as PointerEvent).pointerType === 'touch') return;
      handlers.hint(hint ? button : null);
    });
  }
  return button;
}

/** Text rows for the suggestions, Learn Spelling and, for a word with no guess, a line saying so. */
function spellingBlock(rows: SpellingRows, handlers: PanelHandlers): HTMLElement {
  const block = element('div', 'rl-palette-spelling');
  block.setAttribute('role', 'group');
  block.setAttribute('aria-label', 'Spelling');
  const row = (className: string, text: string, run: (() => void) | null) => {
    const button = keepsFocus(element('button', `rl-palette-word ${className}`));
    button.textContent = text;
    button.dataset['spelling'] = className.split(' ')[0] ?? '';
    if (run) button.addEventListener('click', run);
    else button.disabled = true;
    return button;
  };
  if (rows.suggestions.length === 0) {
    block.append(row('rl-palette-none', 'No Guesses Found', null));
  }
  for (const suggestion of rows.suggestions) {
    block.append(row('rl-palette-suggestion', suggestion, () => handlers.pick(suggestion)));
  }
  if (rows.canLearn)
    block.append(row('rl-palette-learn', 'Learn Spelling', () => handlers.learn()));
  return block;
}

/** The ids of the items, which say whether `refresh` can keep what is drawn. */
const signature = (groups: readonly ShownGroup[]) =>
  groups.map((group) => `${group.id}:${group.items.map((item) => item.id).join(',')}`).join('|');

export interface DrawnPanel {
  /** Brings the buttons up to date; false when the items are others than those drawn. */
  refresh(groups: readonly ShownGroup[]): boolean;
  /** The buttons the keyboard moves among, in order, rows of them. */
  rows(): HTMLButtonElement[][];
}

/**
 * Draws `groups` into `panel`, and above them the spelling rows if there are any, taking away what
 * was there.
 */
export function drawPanel(
  panel: HTMLElement,
  groups: readonly ShownGroup[],
  spelling: SpellingRows | null,
  handlers: PanelHandlers,
): DrawnPanel {
  panel.replaceChildren();
  const buttons = new Map<string, HTMLButtonElement>();
  if (spelling) panel.append(spellingBlock(spelling, handlers), rule());
  groups.forEach((group, i) => {
    if (i > 0) panel.append(rule());
    const row = element('div', 'rl-palette-row');
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', group.label);
    for (const item of group.items) {
      const button = itemButton(item, handlers);
      buttons.set(item.id, button);
      row.append(button);
    }
    panel.append(row);
  });
  let drawn = signature(groups);
  return {
    refresh(next) {
      if (signature(next) !== drawn) return false;
      for (const group of next) {
        for (const item of group.items) {
          const button = buttons.get(item.id);
          if (button) update(button, item);
        }
      }
      drawn = signature(next);
      return true;
    },
    rows() {
      const enabled = (buttons: Iterable<HTMLButtonElement>) =>
        [...buttons].filter((button) => !button.disabled);
      const words = enabled(panel.querySelectorAll<HTMLButtonElement>('.rl-palette-word'));
      const items = [...panel.querySelectorAll<HTMLElement>('.rl-palette-row')].map((row) =>
        enabled(row.querySelectorAll<HTMLButtonElement>('.rl-palette-item')),
      );
      // Each word is a row of its own, in front of the item rows.
      return [...words.map((word) => [word]), ...items.filter((row) => row.length > 0)];
    },
  };
}
