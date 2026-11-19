// The find bar's look, in the theme's tokens and interface font, like the review bar: a thin rule,
// grays only, no badges. Matches are a light gray tint with no box, the current one a stronger one: color means a person.

import { EditorView } from '@codemirror/view';

/** How far the bar floats below the top of the editor and in from its right side. */
export const BAR_INSET = 12;
/** Room kept above the text the editor scrolls into view while the bar is open. */
export const BAR_ROOM = 84;

export const findThemeSpec: Parameters<typeof EditorView.baseTheme>[0] = {
  // Every match a light gray tint, no box; the current one a stronger tint. The scope of Find in
  // Selection is a faint wash under them.
  '.rl-find-match': {
    backgroundColor: 'color-mix(in srgb, var(--rl-ink) 8%, transparent)',
  },
  '.rl-find-current': {
    backgroundColor: 'color-mix(in srgb, var(--rl-ink) 22%, transparent)',
  },
  '.rl-find-scope': { backgroundColor: 'color-mix(in srgb, var(--rl-ink) 6%, transparent)' },

  '.rl-find-bar': {
    position: 'fixed',
    zIndex: '300',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    boxSizing: 'border-box',
    width: '460px',
    maxWidth: 'calc(100vw - 32px)',
    padding: '6px',
    border: '1px solid var(--rl-rule)',
    borderRadius: 'var(--rl-radius-card, 12px)',
    backgroundColor: 'var(--rl-card)',
    boxShadow: 'var(--rl-shadow)',
    color: 'var(--rl-ink)',
    fontFamily: 'var(--rl-font-ui)',
    fontSize: 'var(--rl-size-ui)',
    lineHeight: '1',
    cursor: 'grab',
  },
  '.rl-find-dragging': { cursor: 'grabbing', userSelect: 'none' },
  '.rl-find-row': { display: 'flex', alignItems: 'center', gap: '2px' },
  // The box and what sits inside it: the count and the toggles at the find box's right end, the
  // red pen at the replace box's.
  '.rl-find-field': {
    flex: '1',
    minWidth: '0',
    display: 'flex',
    alignItems: 'center',
    gap: '2px',
    height: 'var(--rl-ctl-h, 26px)',
    boxSizing: 'border-box',
    padding: '0 2px 0 0',
    border: '1px solid var(--rl-rule)',
    borderRadius: 'var(--rl-ctl-radius, 7px)',
    backgroundColor: 'var(--rl-page)',
  },
  '.rl-find-field:focus-within': { borderColor: 'var(--rl-ink-3)' },
  '.rl-find-field.rl-find-invalid': { borderColor: 'var(--rl-red)' },
  '.rl-find-invalid .rl-find-count': { color: 'var(--rl-red)' },
  '.rl-find-bar input': {
    flex: '1',
    minWidth: '0',
    height: 'calc(var(--rl-ctl-h, 26px) - 2px)',
    boxSizing: 'border-box',
    padding: '0 8px',
    border: '0',
    backgroundColor: 'transparent',
    color: 'var(--rl-ink)',
    font: 'inherit',
    fontSize: 'var(--rl-size-field)',
    outline: 'none',
  },
  '.rl-find-toggle': {
    flex: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '24px',
    height: 'calc(var(--rl-chip-h, 24px) - 2px)',
    padding: '0',
    border: '0',
    borderRadius: 'var(--rl-ctl-radius, 7px)',
    background: 'transparent',
    color: 'var(--rl-ink-2)',
    font: 'inherit',
    fontSize: 'var(--rl-size-ui-small)',
    cursor: 'default',
  },
  '.rl-find-toggle-wholeWord': { textDecoration: 'underline', textUnderlineOffset: '3px' },
  '.rl-find-toggle:hover, .rl-find-toggle:focus-visible': {
    backgroundColor: 'color-mix(in srgb, var(--rl-pressed) 55%, transparent)',
    outline: 'none',
  },
  '.rl-find-toggle[aria-pressed="true"]': {
    backgroundColor: 'color-mix(in srgb, var(--rl-ink) 18%, transparent)',
    color: 'var(--rl-ink)',
  },
  '.rl-find-pen': {
    flex: 'none',
    display: 'flex',
    alignItems: 'center',
    padding: '0 6px',
    color: 'var(--rl-red)',
  },
  '.rl-find-pen[hidden]': { display: 'none' },
  '.rl-find-spacer': { flex: 'none', width: '24px' },
  '.rl-find-count': {
    flex: 'none',
    minWidth: '56px',
    padding: '0 4px',
    color: 'var(--rl-ink-2)',
    fontVariantNumeric: 'tabular-nums',
    textAlign: 'center',
    whiteSpace: 'nowrap',
  },
  '.rl-find-icon, .rl-find-text': {
    flex: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: 'var(--rl-ctl-h, 26px)',
    border: '0',
    borderRadius: 'var(--rl-ctl-radius, 7px)',
    background: 'transparent',
    color: 'var(--rl-ink-2)',
    font: 'inherit',
    fontSize: 'var(--rl-size-ctl)',
    cursor: 'default',
  },
  '.rl-find-icon': { width: 'var(--rl-ctl-h, 26px)', padding: '0' },
  '.rl-find-disclosure': { width: '24px' },
  '.rl-find-text': { padding: '0 10px', color: 'var(--rl-ink)' },
  '.rl-find-icon:enabled:hover, .rl-find-text:enabled:hover, .rl-find-icon:focus-visible, .rl-find-text:focus-visible':
    {
      backgroundColor: 'color-mix(in srgb, var(--rl-pressed) 55%, transparent)',
      outline: 'none',
    },
  '.rl-find-icon:disabled, .rl-find-text:disabled': { color: 'var(--rl-ink-3)' },
  // Why something was left alone: one line, below the rows.
  '.rl-find-error': {
    padding: '2px 8px 4px',
    color: 'var(--rl-ink-2)',
    fontSize: 'var(--rl-size-ui)',
    lineHeight: '1.35',
  },
};

export const findTheme = EditorView.baseTheme(findThemeSpec);
