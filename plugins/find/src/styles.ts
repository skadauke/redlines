// The find bar's look, in the theme's tokens and interface font, like the review bar: a thin rule,
// grays only, no badges. Matches are a gray tint, the current one outlined: color means a person.

import { EditorView } from '@codemirror/view';

/** How far the bar floats below the top of the editor and in from its right side. */
export const BAR_INSET = 12;
/** Room kept above the text the editor scrolls into view while the bar is open. */
export const BAR_ROOM = 84;

export const findTheme = EditorView.baseTheme({
  '.rl-find-match': { backgroundColor: 'var(--rl-pressed)', borderRadius: '2px' },
  '.rl-find-current': { outline: '1px solid var(--rl-ink-3)' },

  '.rl-find-bar': {
    position: 'fixed',
    zIndex: '300',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    boxSizing: 'border-box',
    width: '340px',
    maxWidth: 'calc(100vw - 32px)',
    padding: '6px',
    border: '1px solid var(--rl-rule)',
    borderRadius: '12px',
    backgroundColor: 'var(--rl-card)',
    boxShadow: 'var(--rl-shadow)',
    color: 'var(--rl-ink)',
    fontFamily: 'var(--rl-font-ui)',
    fontSize: '13.5px',
    lineHeight: '1',
    cursor: 'default',
  },
  '.rl-find-row': { display: 'flex', alignItems: 'center', gap: '2px' },
  '.rl-find-bar input': {
    flex: '1',
    minWidth: '0',
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
  '.rl-find-bar input:focus': { borderColor: 'var(--rl-ink-3)' },
  '.rl-find-count': {
    flex: 'none',
    minWidth: '64px',
    padding: '0 6px',
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
    height: '28px',
    border: '0',
    borderRadius: '8px',
    background: 'transparent',
    color: 'var(--rl-ink-2)',
    font: 'inherit',
    cursor: 'default',
  },
  '.rl-find-icon': { width: '28px', padding: '0' },
  '.rl-find-disclosure': { width: '24px' },
  '.rl-find-text': { padding: '0 10px', color: 'var(--rl-ink)' },
  '.rl-find-icon:enabled:hover, .rl-find-text:enabled:hover': {
    backgroundColor: 'var(--rl-pressed)',
  },
  '.rl-find-icon:focus-visible, .rl-find-text:focus-visible': {
    outline: '2px solid var(--rl-ink-3)',
    outlineOffset: '-2px',
  },
  '.rl-find-icon:disabled, .rl-find-text:disabled': { color: 'var(--rl-ink-3)' },
  // Why something was left alone: one line, below the rows.
  '.rl-find-error': {
    padding: '2px 8px 4px',
    color: 'var(--rl-ink-2)',
    fontSize: '12.5px',
    lineHeight: '1.35',
  },
});
