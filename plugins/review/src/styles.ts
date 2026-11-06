// The review interface's look (design §5.1, §5.7, §6.6), entirely through the theme's tokens, in
// its interface font. Notes are light: a thin border, no shadow or fill. Text and controls are
// grays; a person's color marks only their dot, a selected note's border and its anchor's tint.

import { EditorView } from '@codemirror/view';

/** The rail's width, and its distance from the text column. */
export const RAIL_WIDTH = 248;
export const RAIL_GAP = 44;
/** The least space between two notes. */
export const NOTE_GAP = 8;
/** The text column's own padding, from the editor's theme. The rail stays inside it. */
export const COLUMN_PADDING = 24;
/** How far right of the text column the rail ends: the gap, the rail and the column's padding. */
const RAIL_SPACE = RAIL_GAP + RAIL_WIDTH;

export const reviewTheme = EditorView.baseTheme({
  // With the rail, the column's box takes in the rail on its right, so that column and rail are
  // centered together and the text column moves left.
  '&.rl-has-rail .cm-content': {
    maxWidth: `calc(var(--rl-column) + ${2 * COLUMN_PADDING + RAIL_SPACE}px)`,
    paddingRight: `${COLUMN_PADDING + RAIL_SPACE}px`,
  },

  // The rail, and the notes in it, placed by the rail's measurements.
  '.rl-rail': {
    position: 'absolute',
    top: '0',
    left: '0',
    width: `${RAIL_WIDTH}px`,
    height: '0',
    color: 'var(--rl-ink)',
    fontFamily: 'var(--rl-font-ui)',
    fontSize: 'calc(13.5px * var(--rl-text-scale, 1))',
    lineHeight: '1.38',
    cursor: 'default',
  },
  '.rl-note': {
    position: 'absolute',
    left: '0',
    boxSizing: 'border-box',
    width: '100%',
    padding: '6px 10px 9px',
    border: '1px solid var(--rl-rule)',
    borderRadius: '8px',
    // Room around a new comment's note, scrolled into view as it opens.
    scrollMargin: '12px',
    transition: 'border-color 120ms ease',
  },
  // A hovered note, whose actions' hints rise above it, comes in front of its neighbors.
  '.rl-note:hover': { zIndex: '1', backgroundColor: 'var(--rl-page)' },
  '.rl-note-selected': { borderColor: 'var(--rl-color)' },
  // Replies sit a little in from the comment they answer.
  '.rl-note-item + .rl-note-item': { margin: '8px 0 0 12px' },

  // Who wrote it: a 6px dot in their color, the name, whom an agent acts for, and in a note the
  // time and the actions, which show on hover or while the note is selected.
  '.rl-note-head, .rl-card-head': {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    minWidth: '0',
    whiteSpace: 'nowrap',
  },
  '.rl-dot': {
    flex: 'none',
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    backgroundColor: 'var(--rl-color)',
  },
  '.rl-note-name, .rl-card-name': {
    flex: 'none',
    maxWidth: '100%',
    overflow: 'hidden',
    fontWeight: '700',
    textOverflow: 'ellipsis',
  },
  '.rl-note-for, .rl-card-for': {
    minWidth: '0',
    overflow: 'hidden',
    color: 'var(--rl-ink-2)',
    textOverflow: 'ellipsis',
  },
  '.rl-card-time': {
    flex: 'none',
    marginLeft: 'auto',
    paddingLeft: '4px',
    color: 'var(--rl-ink-3)',
    fontSize: 'calc(12px * var(--rl-text-scale, 1))',
  },
  '.rl-note-head': {
    minHeight: '22px',
    color: 'var(--rl-ink-2)',
    fontSize: 'calc(12.5px * var(--rl-text-scale, 1))',
  },
  '.rl-note-name': { color: 'var(--rl-ink)' },
  '.rl-note-for': { flex: 'none' },
  '.rl-note-time': {
    display: 'none',
    flex: '0 1 auto',
    minWidth: '0',
    marginLeft: '-2px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  '.rl-note-time::before': { content: '"· "' },
  '.rl-note:hover .rl-note-time, .rl-note-selected .rl-note-time': { display: 'block' },
  '.rl-note-text': {
    marginTop: '1px',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
  },
  // A change's note: what the change did, the old text struck through, and then why, quieter.
  '.rl-note-change': { marginTop: '1px', overflowWrap: 'anywhere' },
  // A suggestion of several marks: its changes in one line, clipped to three with an ellipsis.
  '.rl-note-changes': {
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: '3',
    overflow: 'hidden',
  },
  '.rl-note-old': { color: 'var(--rl-ink-2)', textDecoration: 'line-through' },
  '.rl-note-change + .rl-note-text': { marginTop: '2px', color: 'var(--rl-ink-2)' },

  // The actions: icons at the end of the first line, on hover or while the note is selected.
  '.rl-note-actions': {
    display: 'none',
    flex: 'none',
    alignItems: 'center',
    gap: '1px',
    margin: '0 -5px 0 auto',
  },
  '.rl-note:hover .rl-note-actions, .rl-note-selected .rl-note-actions': { display: 'flex' },
  '.rl-note-writing .rl-note-actions, .rl-note-writing:hover .rl-note-actions': {
    display: 'none',
  },
  '.rl-note-icon': {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '22px',
    height: '22px',
    padding: '0',
    border: '0',
    borderRadius: '6px',
    background: 'transparent',
    color: 'var(--rl-ink-2)',
    cursor: 'default',
  },
  '.rl-note-icon:hover': { backgroundColor: 'var(--rl-pressed)', color: 'var(--rl-ink)' },
  '.rl-note-icon:focus-visible': { outline: '2px solid var(--rl-ink-3)', outlineOffset: '-2px' },
  '.rl-note-button': {
    height: '22px',
    padding: '0 6px',
    border: '0',
    borderRadius: '5px',
    background: 'transparent',
    color: 'var(--rl-ink-2)',
    font: 'inherit',
    fontSize: 'calc(12.5px * var(--rl-text-scale, 1))',
    cursor: 'default',
  },
  '.rl-note-button:hover': { backgroundColor: 'var(--rl-pressed)', color: 'var(--rl-ink)' },
  '.rl-note-button:focus-visible': { outline: '2px solid var(--rl-ink-3)', outlineOffset: '-2px' },
  '.rl-note-button:disabled': { color: 'var(--rl-ink-3)', backgroundColor: 'transparent' },

  // A comment or a reply being written: private until it is posted with ⌘↩.
  '.rl-note-box': { marginTop: '8px' },
  '.rl-note-box textarea': {
    display: 'block',
    boxSizing: 'border-box',
    width: '100%',
    minHeight: '48px',
    padding: '5px 7px',
    border: '1px solid var(--rl-rule)',
    borderRadius: '6px',
    outline: 'none',
    background: 'transparent',
    color: 'inherit',
    font: 'inherit',
    resize: 'none',
  },
  '.rl-note-box textarea:focus': { borderColor: 'var(--rl-ink-3)' },
  '.rl-note-box textarea::placeholder': { color: 'var(--rl-ink-3)' },
  '.rl-note-box-row': {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '2px',
    margin: '5px -6px 0 0',
    // As for the note, and past the padding under the row.
    scrollMargin: '24px',
  },
  // Why an action was refused, for a few seconds.
  '.rl-note-error, .rl-note-notice, .rl-card-error': {
    marginTop: '4px',
    color: 'var(--rl-ink-2)',
    fontSize: 'calc(12.5px * var(--rl-text-scale, 1))',
  },
  '.rl-card-error': { paddingRight: '6px' },

  // In a narrow editor, the rail shrinks to a dot in the author's color beside each anchor. A dot
  // shows its note over the page, to its left: on hover, or pinned by a click.
  '.rl-rail-compact': { width: '0' },
  '.rl-rail-compact .rl-note': {
    display: 'none',
    left: 'auto',
    right: '14px',
    width: `${RAIL_WIDTH}px`,
    zIndex: '2',
    backgroundColor: 'var(--rl-card)',
    boxShadow: 'var(--rl-shadow)',
  },
  '.rl-rail-compact .rl-note-open': { display: 'block' },
  '.rl-note-dot': { display: 'none' },
  '.rl-rail-compact .rl-note-dot': {
    display: 'block',
    position: 'absolute',
    left: '-4px',
    boxSizing: 'border-box',
    width: '8px',
    height: '8px',
    padding: '0',
    border: '0',
    borderRadius: '50%',
    backgroundColor: 'var(--rl-color)',
    cursor: 'default',
  },
  // A target larger than the dot.
  '.rl-rail-compact .rl-note-dot::before': {
    content: '""',
    position: 'absolute',
    inset: '-6px',
  },
  '.rl-note-dot-selected': { boxShadow: '0 0 0 3px var(--rl-color-tint)' },
  '.rl-note-dot:focus-visible': { outline: '2px solid var(--rl-ink-3)', outlineOffset: '2px' },

  // The anchor of the selected note: its tint doubled.
  '.rl-anchor': { backgroundColor: 'var(--rl-color-tint)' },

  // A change's card, floating over the page above or below the change's lines. It replaces the
  // look of the tooltip that holds it.
  '&light .cm-tooltip.cm-tooltip-hover:has(> .rl-card), &dark .cm-tooltip.cm-tooltip-hover:has(> .rl-card)':
    { border: 'none', backgroundColor: 'transparent' },
  '.rl-card': {
    boxSizing: 'border-box',
    minWidth: '232px',
    maxWidth: '360px',
    padding: '6px 6px 9px 12px',
    border: '1px solid var(--rl-rule)',
    borderRadius: '10px',
    backgroundColor: 'var(--rl-card)',
    boxShadow: 'var(--rl-shadow)',
    color: 'var(--rl-ink)',
    fontFamily: 'var(--rl-font-ui)',
    fontSize: 'calc(13.5px * var(--rl-text-scale, 1))',
    lineHeight: '1.38',
    cursor: 'default',
  },
  '.rl-card-head': { fontSize: 'calc(13px * var(--rl-text-scale, 1))' },
  '.rl-card-buttons': { display: 'flex', flex: 'none', gap: '1px', marginLeft: '4px' },
  '.rl-card-button': {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '26px',
    height: '24px',
    padding: '0',
    border: '0',
    borderRadius: '6px',
    background: 'transparent',
    color: 'var(--rl-ink-2)',
    cursor: 'default',
  },
  '.rl-card-button:hover': { backgroundColor: 'var(--rl-pressed)', color: 'var(--rl-ink)' },
  '.rl-card-button:focus-visible': { outline: '2px solid var(--rl-ink-3)', outlineOffset: '-2px' },
  '.rl-card-what': {
    marginTop: '1px',
    paddingRight: '6px',
    overflowWrap: 'anywhere',
    // A suggestion of several marks: clipped to three lines with an ellipsis.
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: '3',
    overflow: 'hidden',
  },

  // The review bar: one row on the card color, floating above the bottom of the window, centered
  // under the text column, and the margin notes beside it, where the bar's measurements put its
  // middle.
  '.rl-review-bar': {
    position: 'fixed',
    zIndex: '300',
    display: 'flex',
    alignItems: 'center',
    gap: '2px',
    boxSizing: 'border-box',
    height: '42px',
    padding: '0 6px',
    border: '1px solid var(--rl-rule)',
    borderRadius: '12px',
    backgroundColor: 'var(--rl-card)',
    boxShadow: 'var(--rl-shadow)',
    color: 'var(--rl-ink)',
    fontFamily: 'var(--rl-font-ui)',
    fontSize: 'calc(13.5px * var(--rl-text-scale, 1))',
    lineHeight: '1',
    whiteSpace: 'nowrap',
    cursor: 'default',
    transform: 'translateX(-50%)',
    userSelect: 'none',
    WebkitUserSelect: 'none',
  },
  // Why a decision was refused, above the bar for a few seconds.
  '.rl-bar-error': {
    position: 'absolute',
    bottom: 'calc(100% + 8px)',
    left: '50%',
    boxSizing: 'border-box',
    width: 'max-content',
    maxWidth: '420px',
    padding: '7px 10px',
    border: '1px solid var(--rl-rule)',
    borderRadius: '8px',
    backgroundColor: 'var(--rl-card)',
    boxShadow: 'var(--rl-shadow)',
    color: 'var(--rl-ink-2)',
    fontSize: 'calc(12.5px * var(--rl-text-scale, 1))',
    lineHeight: '1.35',
    whiteSpace: 'normal',
    transform: 'translateX(-50%)',
  },
  '.rl-bar-count': {
    minWidth: '104px',
    padding: '0 4px',
    color: 'var(--rl-ink-2)',
    fontVariantNumeric: 'tabular-nums',
    textAlign: 'center',
  },
  '.rl-bar-icon, .rl-bar-text': {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '30px',
    border: '0',
    borderRadius: '8px',
    background: 'transparent',
    color: 'var(--rl-ink-2)',
    font: 'inherit',
    cursor: 'default',
  },
  '.rl-bar-icon': { width: '30px', padding: '0' },
  '.rl-bar-text': { gap: '6px', padding: '0 11px 0 9px', color: 'var(--rl-ink)' },
  '.rl-bar-text svg': { color: 'var(--rl-ink-2)' },
  '.rl-bar-icon:enabled:hover, .rl-bar-text:enabled:hover': {
    backgroundColor: 'var(--rl-pressed)',
  },
  '.rl-bar-icon:focus-visible, .rl-bar-text:focus-visible': {
    outline: '2px solid var(--rl-ink-3)',
    outlineOffset: '-2px',
  },
  '.rl-bar-icon:disabled, .rl-bar-text:disabled, .rl-bar-text:disabled svg': {
    color: 'var(--rl-ink-3)',
  },
  '.rl-bar-divider': {
    flex: 'none',
    width: '1px',
    height: '20px',
    margin: '0 5px',
    backgroundColor: 'var(--rl-rule)',
  },

  // An icon's hint, shown above it after a pause on hover: its name and shortcut.
  '.rl-hint': {
    position: 'absolute',
    bottom: 'calc(100% + 10px)',
    left: '50%',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '7px 10px',
    borderRadius: '8px',
    backgroundColor: 'var(--rl-tip)',
    color: '#ffffff',
    fontSize: 'calc(12.5px * var(--rl-text-scale, 1))',
    lineHeight: '1',
    whiteSpace: 'nowrap',
    pointerEvents: 'none',
    transform: 'translateX(-50%)',
    visibility: 'hidden',
    opacity: '0',
    transition: 'opacity 90ms ease-out, visibility 0s linear 90ms',
  },
  '.rl-bar-icon:hover .rl-hint, .rl-note-icon:hover .rl-hint': {
    visibility: 'visible',
    opacity: '1',
    transition: 'opacity 90ms ease-out 400ms, visibility 0s linear 400ms',
  },
  '.rl-hint-keys': { color: 'rgb(255 255 255 / 0.62)', letterSpacing: '0.04em' },

  '@media (prefers-reduced-motion: reduce)': {
    '.rl-note, .rl-hint, .rl-bar-icon:hover .rl-hint, .rl-note-icon:hover .rl-hint': {
      transition: 'none',
    },
  },
});
