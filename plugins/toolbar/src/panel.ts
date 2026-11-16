// The toolbar's parts as page elements: one row with Ask, a rule and a button for each menu, and
// under or over a button its menu (a header, then a line for each item: icon, name, keys), and for
// a right-click on a misspelled word, the system's suggestions above it all, in the same card. The
// elements are drawn from what the registry holds now (`shownBar`) and kept up to date as the
// selection changes. Every button keeps the keyboard where it is, in the document, so that using
// the toolbar with the mouse never moves the caret or loses the selection.

import type { MenuId, ShownBar, ShownItem } from './items.ts';
import { toolbarIcon } from './icons.ts';
import { buttonOf, move, type Position, type Shape } from './nav.ts';

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

/** A hairline between the parts of the toolbar. */
function rule(under = false): HTMLElement {
  const line = element('div', under ? 'rl-toolbar-rule rl-toolbar-rule-under' : 'rl-toolbar-rule');
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
function update(button: HTMLButtonElement, item: ShownItem, paired: boolean): void {
  // A grayed item stays a button the pointer and the keys can come to, so that its hint says why.
  button.setAttribute('aria-disabled', String(!item.enabled));
  if (item.toggle) button.setAttribute('aria-checked', String(item.active));
  else button.removeAttribute('aria-checked');
  // What is said is what is drawn (WCAG 2.5.3): the menu's word, not the command's title.
  const said = item.label.replace(/…$/, '');
  button.setAttribute('aria-label', item.side ? `${said}, ${item.side}` : said);
  if (item.aria) button.setAttribute('aria-keyshortcuts', item.aria);
  else button.removeAttribute('aria-keyshortcuts');
  // The hint: the reason a grayed item can't be used, and for the icons of a shared line, the name
  // and keys that their line doesn't write.
  if (item.reason !== null) {
    button.dataset['name'] = item.reason;
    delete button.dataset['keys'];
    button.dataset['reason'] = '';
  } else {
    delete button.dataset['reason'];
    if (paired) {
      button.dataset['name'] = item.name;
      if (item.keys) button.dataset['keys'] = item.keys;
      else delete button.dataset['keys'];
    } else {
      delete button.dataset['name'];
      delete button.dataset['keys'];
    }
  }
}

/** Ask's button: grayed with its reason as the hint, when the agents can't be asked here. */
function syncAsk(button: HTMLButtonElement, item: ShownItem): void {
  button.setAttribute('aria-disabled', String(!item.enabled));
  if (item.reason !== null) button.dataset['name'] = item.reason;
  else delete button.dataset['name'];
}

function hints(button: HTMLButtonElement, handlers: PanelHandlers): void {
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
}

function itemButton(item: ShownItem, paired: boolean, handlers: PanelHandlers): HTMLButtonElement {
  const button = keepsFocus(element('button', 'rl-toolbar-item'));
  button.dataset['command'] = item.id;
  button.setAttribute('role', item.toggle ? 'menuitemcheckbox' : 'menuitem');
  const label = element('span', 'rl-toolbar-label');
  label.textContent = item.label;
  button.append(toolbarIcon(item.icon), label);
  if (!paired) {
    const keys = element('span', 'rl-toolbar-keys');
    keys.textContent = item.keys ?? '';
    button.append(keys);
  }
  update(button, item, paired);
  button.addEventListener('click', () => {
    if (button.getAttribute('aria-disabled') !== 'true') handlers.run(item.id);
  });
  hints(button, handlers);
  return button;
}

/** Text rows for the suggestions, Learn Spelling and, for a word with no guess, a line saying so. */
function spellingBlock(rows: SpellingRows, handlers: PanelHandlers): HTMLElement {
  const block = element('div', 'rl-toolbar-spelling');
  block.setAttribute('role', 'group');
  block.setAttribute('aria-label', 'Spelling');
  const row = (className: string, text: string, run: (() => void) | null) => {
    const button = keepsFocus(element('button', `rl-toolbar-word ${className}`));
    button.textContent = text;
    button.dataset['spelling'] = className.split(' ')[0] ?? '';
    if (run) button.addEventListener('click', run);
    else button.disabled = true;
    return button;
  };
  if (rows.suggestions.length === 0) {
    block.append(row('rl-toolbar-none', 'No Guesses Found', null));
  }
  for (const suggestion of rows.suggestions) {
    block.append(row('rl-toolbar-suggestion', suggestion, () => handlers.pick(suggestion)));
  }
  if (rows.canLearn)
    block.append(row('rl-toolbar-learn', 'Learn Spelling', () => handlers.learn()));
  return block;
}

/** The ids of the items, which say whether `refresh` can keep what is drawn. */
const signature = (bar: ShownBar) =>
  `${bar.ask?.id ?? ''}|${bar.menus
    .map(
      (menu) =>
        `${menu.id}:${menu.rows.map((row) => row.map((item) => item.id).join('+')).join(',')}`,
    )
    .join('|')}`;

export interface DrawnPanel {
  /** Brings the buttons up to date; false when the items are others than those drawn. */
  refresh(bar: ShownBar): boolean;
  /** Opens a menu, or with null puts the open one away. */
  openMenu(id: MenuId | null): void;
  /** The menu that is open. */
  openId(): MenuId | null;
  /** The button the keyboard comes to first: the first suggestion, else Ask, else the first menu. */
  entry(): HTMLButtonElement | undefined;
  /** Moves the keyboard as the arrow keys say; false when the key is not one of the toolbar's. */
  key(event: KeyboardEvent): boolean;
  /** Closes the open menu with the keyboard on its button when it was in it; false if none was open. */
  escape(): boolean;
}

/** The room between a menu and the bar it opens from, and at the window's edges. */
const MENU_GAP = 10;
const EDGE = 8;

/**
 * Draws `bar` into `panel`, and above it the spelling rows if there are any, taking away what was
 * there.
 */
export function drawPanel(
  panel: HTMLElement,
  bar: ShownBar,
  spelling: SpellingRows | null,
  handlers: PanelHandlers,
  onMenu: (id: MenuId | null) => void = () => {},
): DrawnPanel {
  panel.replaceChildren();
  const items = new Map<string, { button: HTMLButtonElement; paired: boolean }>();
  /** The headers of the menus, which say what the selection is where the menu is about one. */
  const heads = new Map<MenuId, HTMLElement>();
  if (spelling) panel.append(spellingBlock(spelling, handlers), rule(true));
  const row = element('div', 'rl-toolbar-bar');
  panel.append(row);

  /** The bar's buttons, in order: Ask, then a button for each menu. */
  const tops: HTMLButtonElement[] = [];
  const boxes: { id: MenuId; box: HTMLElement; menu: HTMLElement; top: HTMLButtonElement }[] = [];
  /** The items of each menu, by line. */
  const lines: HTMLButtonElement[][][] = [];
  let open: number | null = null;

  const placeMenu = (index: number) => {
    const entry = boxes[index];
    if (!entry) return;
    const win = panel.ownerDocument.defaultView ?? window;
    const { menu, top } = entry;
    menu.style.maxHeight = '';
    menu.style.left = '0px';
    menu.classList.remove('rl-toolbar-menu-up');
    // From the bar's own row: the suggestions above it in the same card are not what it opens over.
    const anchor = row.getBoundingClientRect();
    const height = menu.offsetHeight;
    const below = win.innerHeight - anchor.bottom - MENU_GAP - EDGE;
    const above = anchor.top - MENU_GAP - EDGE;
    // The side with room; a menu taller than that scrolls.
    const up = height > below && above > below;
    menu.classList.toggle('rl-toolbar-menu-up', up);
    menu.style.maxHeight = `${Math.max(120, up ? above : below)}px`;
    const left = top.getBoundingClientRect().left;
    const width = menu.offsetWidth;
    const overflow = left + width + EDGE - win.innerWidth;
    menu.style.left = `${overflow > 0 ? -overflow : 0}px`;
  };

  const setOpen = (next: number | null) => {
    if (next === open) return;
    open = next;
    boxes.forEach(({ menu, top }, index) => {
      menu.hidden = index !== next;
      top.setAttribute('aria-expanded', String(index === next));
      top.classList.toggle('rl-toolbar-top-open', index === next);
    });
    if (next !== null) placeMenu(next);
    onMenu(next === null ? null : (boxes[next]?.id ?? null));
  };

  if (bar.ask) {
    const ask = keepsFocus(element('button', 'rl-toolbar-top rl-toolbar-ask'));
    ask.dataset['command'] = bar.ask.id;
    const label = element('span', 'rl-toolbar-label');
    label.textContent = bar.ask.label;
    ask.append(toolbarIcon(bar.ask.icon), label);
    const id = bar.ask.id;
    ask.addEventListener('click', () => {
      if (ask.getAttribute('aria-disabled') !== 'true') handlers.run(id);
    });
    syncAsk(ask, bar.ask);
    hints(ask, handlers);
    ask.addEventListener('pointerenter', () => setOpen(null));
    items.set(bar.ask.id, { button: ask, paired: false });
    tops.push(ask);
    row.append(ask);
    if (bar.menus.length) row.append(rule());
  }

  bar.menus.forEach((menu, index) => {
    const box = element('div', 'rl-toolbar-menubox');
    const top = keepsFocus(element('button', 'rl-toolbar-top'));
    top.dataset['menu'] = menu.id;
    top.setAttribute('aria-haspopup', 'menu');
    top.setAttribute('aria-expanded', 'false');
    const label = element('span', 'rl-toolbar-label');
    label.textContent = menu.label;
    top.append(label, toolbarIcon('chevron', 12));
    top.addEventListener('click', () => setOpen(open === index ? null : index));
    // Hovering from one open menu to another switches menus.
    top.addEventListener('pointerenter', (event) => {
      if (open !== null && event.pointerType !== 'touch') setOpen(index);
    });
    const list = element('div', 'rl-toolbar-menu');
    list.setAttribute('role', 'menu');
    list.setAttribute('aria-label', menu.label);
    list.hidden = true;
    const head = element('div', 'rl-toolbar-menu-head');
    head.textContent = menu.heading;
    head.setAttribute('role', 'presentation');
    heads.set(menu.id, head);
    list.append(head);
    if (menu.sides) {
      list.classList.add('rl-toolbar-menu-sides');
      const sides = element('div', 'rl-toolbar-sides');
      sides.setAttribute('role', 'presentation');
      for (const name of menu.sides) {
        const side = element('span', 'rl-toolbar-side');
        side.textContent = name;
        side.setAttribute('role', 'presentation');
        sides.append(side);
      }
      list.append(sides);
    }
    const rowButtons: HTMLButtonElement[][] = [];
    for (const shownRow of menu.rows) {
      const line = element(
        'div',
        shownRow.length > 1 ? 'rl-toolbar-line rl-toolbar-pair' : 'rl-toolbar-line',
      );
      const paired = shownRow.length > 1;
      const caption = shownRow[0]?.caption;
      if (caption) {
        const words = element('div', 'rl-toolbar-caption');
        words.textContent = caption;
        words.setAttribute('role', 'presentation');
        list.append(words);
      }
      const buttons = shownRow.map((item) => {
        const button = itemButton(item, paired, handlers);
        items.set(item.id, { button, paired });
        return button;
      });
      line.append(...buttons);
      list.append(line);
      rowButtons.push(buttons);
    }
    lines.push(rowButtons);
    box.append(top, list);
    boxes.push({ id: menu.id, box, menu: list, top });
    tops.push(top);
    row.append(box);
  });

  const shape = (): Shape => ({
    bar: tops.map((top) => boxes.findIndex((box) => box.top === top)),
    menus: lines.map((rows) => rows.map((buttons) => buttons.length)),
  });
  const words = () =>
    [...panel.querySelectorAll<HTMLButtonElement>('.rl-toolbar-word')].filter(
      (word) => !word.disabled,
    );
  const here = (): Position | null => {
    const active = panel.ownerDocument.activeElement;
    const index = tops.findIndex((top) => top === active);
    if (index >= 0) return { at: 'bar', index };
    for (let menu = 0; menu < lines.length; menu++) {
      for (let r = 0; r < (lines[menu]?.length ?? 0); r++) {
        const column = lines[menu]?.[r]?.findIndex((button) => button === active) ?? -1;
        if (column >= 0) return { at: 'item', menu, row: r, column };
      }
    }
    return null;
  };
  const focusAt = (position: Position) => {
    if (position.at === 'bar') tops[position.index]?.focus();
    else lines[position.menu]?.[position.row]?.[position.column]?.focus();
  };

  const drawn = signature(bar);
  return {
    refresh(next) {
      if (signature(next) !== drawn) return false;
      if (next.ask) {
        const entry = items.get(next.ask.id);
        if (entry) {
          syncAsk(entry.button, next.ask);
        }
      }
      for (const menu of next.menus) {
        const head = heads.get(menu.id);
        if (head && head.textContent !== menu.heading) head.textContent = menu.heading;
        for (const shownRow of menu.rows) {
          for (const item of shownRow) {
            const entry = items.get(item.id);
            if (entry) update(entry.button, item, entry.paired);
          }
        }
      }
      if (open !== null) placeMenu(open);
      return true;
    },
    openMenu(id) {
      const index = id === null ? -1 : boxes.findIndex((box) => box.id === id);
      setOpen(index < 0 ? null : index);
    },
    openId: () => (open === null ? null : (boxes[open]?.id ?? null)),
    entry: () => words()[0] ?? tops[0],
    key(event) {
      const active = panel.ownerDocument.activeElement;
      const list = words();
      const at = list.findIndex((word) => word === active);
      if (at >= 0) {
        // The suggestions are a column above the bar.
        if (event.key === 'ArrowDown') {
          if (at + 1 < list.length) list[at + 1]?.focus();
          else tops[0]?.focus();
        } else if (event.key === 'ArrowUp') list[(at - 1 + list.length) % list.length]?.focus();
        else if (event.key === 'Home') list[0]?.focus();
        else if (event.key === 'End') list.at(-1)?.focus();
        else return false;
        return true;
      }
      const position = here();
      if (!position) return false;
      if (position.at === 'bar' && event.key === 'ArrowUp' && list.length) {
        setOpen(null);
        list.at(-1)?.focus();
        return true;
      }
      // Return and Space press an item, as a button does: the page does that.
      if (position.at === 'item' && (event.key === 'Enter' || event.key === ' ')) return false;
      const result = move(shape(), position, event.key);
      if (!result) return false;
      setOpen(result.open);
      focusAt(result.position);
      return true;
    },
    escape() {
      if (open === null) return false;
      const inside = here()?.at === 'item';
      const index = open;
      setOpen(null);
      if (inside) focusAt(buttonOf(shape(), index));
      return true;
    },
  };
}
