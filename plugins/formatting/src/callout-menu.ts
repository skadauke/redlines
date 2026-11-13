// The menu of an alert's types (#311): what the button in the alert's title asks for. A short list
// under the button, in the interface's grays, with a check mark at the type the alert has. Return or
// Space chooses, ↑ and ↓ move, Esc puts it away with the focus back in the editor, and so does a
// click elsewhere. Choosing a type is a block format change, which the plugin makes.

import { EditorView } from '@codemirror/view';

export interface CalloutMenu {
  /** The button the menu hangs from: just below it, or above it with no room below. */
  anchor: HTMLElement;
  /** The types offered, in order, and the one the alert has now. */
  types: readonly { type: string; name: string }[];
  current: string;
  /** Called with the type chosen, when it is not the current one. */
  choose(type: string): void;
}

/** The menu that is open on a view, so that there is never more than one. */
const open = new WeakMap<EditorView, () => void>();

const GAP = 4;
const MARGIN = 8;

export const calloutMenuTheme = EditorView.baseTheme({
  '.rl-callout-popover': {
    position: 'fixed',
    zIndex: '300',
    boxSizing: 'border-box',
    minWidth: '150px',
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
  '.rl-callout-item': {
    display: 'flex',
    alignItems: 'center',
    boxSizing: 'border-box',
    width: '100%',
    height: '28px',
    padding: '0 10px 0 6px',
    border: 'none',
    borderRadius: '6px',
    background: 'transparent',
    color: 'inherit',
    font: 'inherit',
    textAlign: 'left',
    cursor: 'default',
  },
  '.rl-callout-item:hover, .rl-callout-item:focus': {
    outline: 'none',
    backgroundColor: 'var(--rl-tint)',
  },
  '.rl-callout-item-check': { width: '18px', flex: 'none', color: 'var(--rl-ink-2)' },
});

/** Closes the menu open on `view`, if any, without choosing. */
export function closeCalloutMenu(view: EditorView): void {
  open.get(view)?.();
}

/** Opens the menu on `view`, with the focus on the type the alert has. One already open is closed. */
export function openCalloutMenu(view: EditorView, menu: CalloutMenu): void {
  open.get(view)?.();

  const list = document.createElement('div');
  list.className = 'rl-callout-popover';
  list.setAttribute('role', 'menu');
  list.setAttribute('aria-label', 'Alert type');
  const items: HTMLButtonElement[] = [];
  for (const { type, name } of menu.types) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'rl-callout-item';
    item.dataset['type'] = type;
    item.setAttribute('role', 'menuitemradio');
    item.setAttribute('aria-checked', String(type === menu.current));
    const check = document.createElement('span');
    check.className = 'rl-callout-item-check';
    check.setAttribute('aria-hidden', 'true');
    check.textContent = type === menu.current ? '✓' : '';
    item.append(check, name);
    items.push(item);
    list.append(item);
  }
  view.dom.append(list);

  // The text it is for stays as it was while the menu is open; if it changed, the menu is for
  // something that is no longer there.
  const doc = view.state.doc;
  const stale = () => view.state.doc !== doc;

  const place = () => {
    const box = menu.anchor.getBoundingClientRect();
    const height = list.offsetHeight;
    const below = box.bottom + GAP;
    const top = below + height > window.innerHeight - MARGIN ? box.top - GAP - height : below;
    const left = Math.min(box.left, window.innerWidth - list.offsetWidth - MARGIN);
    list.style.left = `${Math.max(MARGIN, left)}px`;
    list.style.top = `${Math.max(MARGIN, top)}px`;
  };

  let closed = false;
  const outside = (event: MouseEvent) => {
    if (!(event.target instanceof Node && list.contains(event.target))) close(false);
  };
  const close = (refocus: boolean) => {
    if (closed) return;
    closed = true;
    document.removeEventListener('mousedown', outside, true);
    open.delete(view);
    list.remove();
    if (refocus) view.focus();
  };
  open.set(view, () => close(false));

  const pick = (item: HTMLButtonElement) => {
    const type = item.dataset['type'];
    const current = !stale();
    close(true);
    if (current && type !== undefined && type !== menu.current) menu.choose(type);
  };
  for (const item of items) item.addEventListener('click', () => pick(item));

  const move = (by: number) => {
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = items[(at + by + items.length) % items.length];
    next?.focus();
  };
  list.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      move(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      move(-1);
    } else if (event.key === 'Tab') {
      event.preventDefault();
      close(true);
    }
  });
  // Clicking elsewhere in the window puts the menu away without choosing.
  document.addEventListener('mousedown', outside, true);

  place();
  (items.find((item) => item.dataset['type'] === menu.current) ?? items[0])?.focus();
}
