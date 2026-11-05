// The popover that asks for a link's address: one field below the text, in the interface's grays.
// Return applies, Esc cancels, and the focus goes back to the editor either way. An empty address
// takes an existing link away; for a new link it is the same as Esc. A click outside the popover
// puts it away without applying; switching to another app, or clicking its padding, does not.

import { EditorView } from '@codemirror/view';

export interface LinkPopover {
  /** Where the popover hangs: just below this position of the document. */
  at: number;
  /** The address the link has now, or '' for text that is not yet a link. */
  url: string;
  /** Applies the address, or removes the link with null. */
  apply(url: string | null): void;
}

/** The popover that is open on a view, so that there is never more than one. */
const open = new WeakMap<EditorView, () => void>();

const GAP = 6;
const MARGIN = 16;

export const linkTheme = EditorView.baseTheme({
  '.rl-link-popover': {
    position: 'fixed',
    zIndex: '300',
    boxSizing: 'border-box',
    width: '300px',
    maxWidth: 'calc(100vw - 32px)',
    margin: '0',
    padding: '6px',
    border: '1px solid var(--rl-rule)',
    borderRadius: '12px',
    backgroundColor: 'var(--rl-card)',
    boxShadow: 'var(--rl-shadow)',
    color: 'var(--rl-ink)',
    fontFamily: 'var(--rl-font-ui)',
    fontSize: '13.5px',
    lineHeight: '1',
  },
  '.rl-link-popover input': {
    display: 'block',
    width: '100%',
    height: '28px',
    boxSizing: 'border-box',
    padding: '0 8px',
    border: '1px solid var(--rl-rule)',
    borderRadius: '8px',
    backgroundColor: 'var(--rl-page)',
    color: 'var(--rl-ink)',
    font: 'inherit',
    outline: 'none',
  },
  '.rl-link-popover input:focus': { borderColor: 'var(--rl-ink-3)' },
  '.rl-link-popover input::placeholder': { color: 'var(--rl-ink-3)' },
});

/** Closes the popover open on `view`, if any, without applying it. */
export function closeLinkPopover(view: EditorView): void {
  open.get(view)?.();
}

/** Opens the popover on `view`, with the focus in its field. A popover already open is closed. */
export function openLinkPopover(view: EditorView, popover: LinkPopover): void {
  open.get(view)?.();

  const form = document.createElement('form');
  form.className = 'rl-link-popover';
  form.setAttribute('role', 'dialog');
  // The padding can hold the focus, so that clicking it doesn't lose the typed address.
  form.tabIndex = -1;
  form.setAttribute('aria-label', 'Link');
  const field = document.createElement('input');
  field.type = 'text';
  field.value = popover.url;
  field.placeholder = 'Address';
  field.spellcheck = false;
  field.autocapitalize = 'off';
  field.setAttribute('aria-label', 'Link address');
  form.append(field);
  view.dom.append(form);

  // The text it is for stays as it was while the popover is open; if it changed, the popover is
  // for something that is no longer there.
  const doc = view.state.doc;
  const stale = () => view.state.doc !== doc;

  const place = () => {
    const box = view.coordsAtPos(popover.at) ?? view.dom.getBoundingClientRect();
    const left = Math.min(box.left, window.innerWidth - form.offsetWidth - MARGIN);
    form.style.left = `${Math.max(MARGIN, left)}px`;
    form.style.top = `${box.bottom + GAP}px`;
  };

  let closed = false;
  const outside = (event: MouseEvent) => {
    if (!(event.target instanceof Node && form.contains(event.target))) close(false);
  };
  const close = (refocus: boolean) => {
    if (closed) return;
    closed = true;
    document.removeEventListener('mousedown', outside, true);
    open.delete(view);
    form.remove();
    if (refocus) view.focus();
  };
  open.set(view, () => close(false));

  field.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === 'Enter') {
      // Return that picks a candidate in an input method is not an answer.
      if (event.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      event.stopPropagation();
      const url = field.value.trim();
      const current = !stale();
      close(true);
      if (!current) return;
      if (url) popover.apply(url);
      else if (popover.url) popover.apply(null);
    }
  });
  form.addEventListener('submit', (event) => event.preventDefault());
  // Clicking elsewhere in the window puts the popover away without applying.
  document.addEventListener('mousedown', outside, true);

  place();
  field.focus();
  field.select();
}
