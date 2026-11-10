// The review interface's look (design §5.1, §5.7, §6.6), entirely through the theme's tokens, in
// its interface font. Notes are light: a thin border, no shadow or fill. Text and controls are
// grays; a person's color marks only their dot, a selected note's border and its anchor's tint.
// The notes and cards follow the text size above 100% and keep their size at 100% and below: their
// text takes --rl-size-ui-scaled, and --rl-size-ui-small-scaled for a byline, a timestamp or a
// hint, and their lengths are px times --rl-note-scale (notePx). The review bar is a control, not
// part of the page, and keeps the interface's own sizes.

import { EditorView } from '@codemirror/view';

/** The rail's width, and its distance from the text column, at the theme's own size. */
export const RAIL_WIDTH = 248;
export const RAIL_GAP = 44;
/** How far right of the text column the rail ends: the gap and the rail. */
export const RAIL_SPACE = RAIL_GAP + RAIL_WIDTH;
/** The least space between two notes. */
export const NOTE_GAP = 8;
/** The column's least margin at 100% (`--rl-margin`); it grows above that. The rail stays inside it. */
export const MARGIN = 24;

/** A length of the notes and cards: px at 100%, times the note scale (1 or more). */
export function notePx(px: number): string {
  return `calc(${px}px * var(--rl-note-scale, 1))`;
}

/** The notes and cards shown over the page are never wider than the window less 16 px a side. */
const WINDOW = 'calc(100vw - 32px)';

export const reviewThemeSpec: Parameters<typeof EditorView.baseTheme>[0] = {
  // With the rail, the column's box takes in the rail on its right, so that column and rail are
  // centered together and the text column moves left.
  '&.rl-has-rail .cm-content': {
    maxWidth: `calc(var(--rl-column) * var(--rl-text-scale, 1) + 2 * var(--rl-margin, ${MARGIN}px) + ${RAIL_SPACE}px * var(--rl-note-scale, 1))`,
    paddingRight: `calc(var(--rl-margin, ${MARGIN}px) + ${RAIL_SPACE}px * var(--rl-note-scale, 1))`,
  },

  // The rail, and the notes in it, placed by the rail's measurements.
  '.rl-rail': {
    position: 'absolute',
    top: '0',
    left: '0',
    width: notePx(RAIL_WIDTH),
    height: '0',
    color: 'var(--rl-ink)',
    fontFamily: 'var(--rl-font-ui)',
    fontSize: 'var(--rl-size-ui-scaled)',
    lineHeight: '1.38',
    cursor: 'default',
  },
  '.rl-note': {
    position: 'absolute',
    left: '0',
    boxSizing: 'border-box',
    width: '100%',
    padding: `${notePx(6)} ${notePx(10)} ${notePx(9)}`,
    border: '1px solid var(--rl-rule)',
    borderRadius: notePx(8),
    // Room around a new comment's note, scrolled into view as it opens.
    scrollMargin: notePx(12),
    transition: 'border-color 120ms ease',
  },
  // A hovered note, whose actions' hints rise above it, comes in front of its neighbors.
  '.rl-note:hover': { zIndex: '1', backgroundColor: 'var(--rl-page)' },
  '.rl-note-selected': { borderColor: 'var(--rl-color)' },
  // Replies sit a little in from the comment they answer.
  '.rl-note-item + .rl-note-item': { margin: `${notePx(8)} 0 0 ${notePx(12)}` },

  // Who wrote it: a 6px dot in their color, the name, whom an agent acts for, and in a note the
  // time and the actions, which show on hover or while the note is selected.
  '.rl-note-head, .rl-card-head': {
    display: 'flex',
    alignItems: 'center',
    gap: notePx(6),
    minWidth: '0',
    whiteSpace: 'nowrap',
  },
  '.rl-dot': {
    flex: 'none',
    width: notePx(6),
    height: notePx(6),
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
    paddingLeft: notePx(4),
    color: 'var(--rl-ink-3)',
    fontSize: 'var(--rl-size-ui-small-scaled)',
  },
  '.rl-note-head': {
    minHeight: notePx(22),
    color: 'var(--rl-ink-2)',
    fontSize: 'var(--rl-size-ui-small-scaled)',
  },
  '.rl-note-name': { color: 'var(--rl-ink)' },
  '.rl-note-for': { flex: 'none' },
  '.rl-note-time': {
    display: 'none',
    flex: '0 1 auto',
    minWidth: '0',
    marginLeft: notePx(-2),
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  '.rl-note-time::before': { content: '"· "' },
  '.rl-note:hover .rl-note-time, .rl-note-selected .rl-note-time': { display: 'block' },
  '.rl-note-text': {
    marginTop: notePx(1),
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
  },
  // A change's note: what the change did, the old text struck through, and then why, quieter.
  '.rl-note-change': { marginTop: notePx(1), overflowWrap: 'anywhere' },
  // A suggestion of several marks: its changes in one line, clipped to three with an ellipsis.
  '.rl-note-changes': {
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: '3',
    overflow: 'hidden',
  },
  '.rl-note-old': { color: 'var(--rl-ink-2)', textDecoration: 'line-through' },
  '.rl-note-change + .rl-note-text': { marginTop: notePx(2), color: 'var(--rl-ink-2)' },

  // The actions: icons at the end of the first line, on hover or while the note is selected.
  '.rl-note-actions': {
    display: 'none',
    flex: 'none',
    alignItems: 'center',
    gap: notePx(1),
    margin: `0 ${notePx(-5)} 0 auto`,
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
    width: notePx(22),
    height: notePx(22),
    padding: '0',
    border: '0',
    borderRadius: notePx(6),
    background: 'transparent',
    color: 'var(--rl-ink-2)',
    cursor: 'default',
  },
  // The icons are drawn at 14, 12 and 16 px; the note scale makes them grow with their boxes.
  '.rl-note-icon svg': { width: notePx(14), height: notePx(14) },
  '.rl-note-icon:hover': { backgroundColor: 'var(--rl-pressed)', color: 'var(--rl-ink)' },
  '.rl-note-icon:focus-visible': { outline: '2px solid var(--rl-ink-3)', outlineOffset: '-2px' },
  '.rl-note-button': {
    height: notePx(22),
    padding: `0 ${notePx(6)}`,
    border: '0',
    borderRadius: notePx(5),
    background: 'transparent',
    color: 'var(--rl-ink-2)',
    font: 'inherit',
    fontSize: 'var(--rl-size-ui-scaled)',
    cursor: 'default',
  },
  '.rl-note-button:hover': { backgroundColor: 'var(--rl-pressed)', color: 'var(--rl-ink)' },
  '.rl-note-button:focus-visible': { outline: '2px solid var(--rl-ink-3)', outlineOffset: '-2px' },
  '.rl-note-button:disabled': { color: 'var(--rl-ink-3)', backgroundColor: 'transparent' },

  // A comment or a reply being written: private until it is posted with ⌘↩.
  '.rl-note-box': { marginTop: notePx(8) },
  '.rl-note-box textarea': {
    display: 'block',
    boxSizing: 'border-box',
    width: '100%',
    minHeight: notePx(48),
    padding: `${notePx(5)} ${notePx(7)}`,
    border: '1px solid var(--rl-rule)',
    borderRadius: notePx(6),
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
    gap: notePx(2),
    margin: `${notePx(5)} ${notePx(-6)} 0 0`,
    // As for the note, and past the padding under the row.
    scrollMargin: notePx(24),
  },
  // Why an action was refused, for a few seconds.
  '.rl-note-error, .rl-note-notice, .rl-card-error': {
    marginTop: notePx(4),
    color: 'var(--rl-ink-2)',
    fontSize: 'var(--rl-size-ui-scaled)',
  },
  '.rl-card-error': { paddingRight: notePx(6) },

  // In a narrow editor, the rail shrinks to a dot in the author's color beside each anchor. A dot
  // shows its note over the page, to its left: on hover, or pinned by a click.
  '.rl-rail-compact': { width: '0' },
  '.rl-rail-compact .rl-note': {
    display: 'none',
    left: 'auto',
    right: notePx(14),
    width: `min(${notePx(RAIL_WIDTH)}, ${WINDOW})`,
    zIndex: '2',
    backgroundColor: 'var(--rl-card)',
    boxShadow: 'var(--rl-shadow)',
  },
  '.rl-rail-compact .rl-note-open': { display: 'block' },
  '.rl-note-dot': { display: 'none' },
  '.rl-rail-compact .rl-note-dot': {
    display: 'block',
    position: 'absolute',
    left: notePx(-4),
    boxSizing: 'border-box',
    width: notePx(8),
    height: notePx(8),
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
    inset: notePx(-6),
  },
  '.rl-note-dot-selected': { boxShadow: '0 0 0 3px var(--rl-color-tint)' },
  '.rl-note-dot:focus-visible': { outline: '2px solid var(--rl-ink-3)', outlineOffset: '2px' },

  // A resolved thread's dot is a hollow ring in gray, apart from the open ones.
  '.rl-rail-compact .rl-note-dot-resolved': {
    backgroundColor: 'transparent',
    border: '1.5px solid var(--rl-ink-3)',
  },

  // The anchor of the selected note: its tint doubled. A resolved thread's text has none at rest,
  // so its selected anchor takes only a light one.
  '.rl-anchor': { backgroundColor: 'var(--rl-color-tint)' },
  '.rl-anchor-resolved': {
    backgroundColor: 'color-mix(in srgb, var(--rl-ink-3) 18%, transparent)',
  },

  // A resolved note is settled: its text and names in the theme's grays, its border plain until
  // it is selected, and who resolved it under the thread.
  // Settled means gray, never a person's color: the border, the anchor and the dots.
  '.rl-note-resolved': { borderStyle: 'dashed' },
  '.rl-note-resolved.rl-note-selected': { borderColor: 'var(--rl-ink-3)' },
  '.rl-note-dot-resolved.rl-note-dot-selected': {
    boxShadow: '0 0 0 3px color-mix(in srgb, var(--rl-ink-3) 25%, transparent)',
  },
  '.rl-note-resolved .rl-note-name, .rl-note-resolved .rl-note-text': {
    color: 'var(--rl-ink-3)',
  },
  '.rl-note-resolved .rl-dot': { backgroundColor: 'var(--rl-ink-3)' },
  '.rl-note-resolved-line': {
    display: 'flex',
    alignItems: 'center',
    gap: notePx(4),
    marginTop: notePx(6),
    color: 'var(--rl-ink-3)',
    fontSize: 'var(--rl-size-ui-small-scaled)',
  },
  '.rl-note-resolved-line svg': { flex: 'none', width: notePx(12), height: notePx(12) },
  '.rl-note-resolved-time::before': { content: '"· "' },

  // A change's card, floating over the page above or below the change's lines. It replaces the
  // look of the tooltip that holds it.
  '&light .cm-tooltip.cm-tooltip-hover:has(> .rl-card), &dark .cm-tooltip.cm-tooltip-hover:has(> .rl-card)':
    { border: 'none', backgroundColor: 'transparent' },
  '.rl-card': {
    boxSizing: 'border-box',
    minWidth: `min(${notePx(232)}, ${WINDOW})`,
    maxWidth: `min(${notePx(360)}, ${WINDOW})`,
    padding: `${notePx(6)} ${notePx(6)} ${notePx(9)} ${notePx(12)}`,
    border: '1px solid var(--rl-rule)',
    borderRadius: notePx(10),
    backgroundColor: 'var(--rl-card)',
    boxShadow: 'var(--rl-shadow)',
    color: 'var(--rl-ink)',
    fontFamily: 'var(--rl-font-ui)',
    fontSize: 'var(--rl-size-ui-scaled)',
    lineHeight: '1.38',
    cursor: 'default',
  },
  '.rl-card-head': { fontSize: 'var(--rl-size-ui-small-scaled)' },
  '.rl-card-buttons': { display: 'flex', flex: 'none', gap: notePx(1), marginLeft: notePx(4) },
  '.rl-card-button': {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: notePx(26),
    height: notePx(24),
    padding: '0',
    border: '0',
    borderRadius: notePx(6),
    background: 'transparent',
    color: 'var(--rl-ink-2)',
    cursor: 'default',
  },
  '.rl-card-button svg': { width: notePx(16), height: notePx(16) },
  '.rl-card-button:hover': { backgroundColor: 'var(--rl-pressed)', color: 'var(--rl-ink)' },
  '.rl-card-button:focus-visible': { outline: '2px solid var(--rl-ink-3)', outlineOffset: '-2px' },
  '.rl-card-what': {
    marginTop: notePx(1),
    paddingRight: notePx(6),
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
    fontSize: 'var(--rl-size-ui)',
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
    maxWidth: 'min(420px, calc(100vw - 32px))',
    padding: '7px 10px',
    border: '1px solid var(--rl-rule)',
    borderRadius: '8px',
    backgroundColor: 'var(--rl-card)',
    boxShadow: 'var(--rl-shadow)',
    color: 'var(--rl-ink-2)',
    fontSize: 'var(--rl-size-ui)',
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
  // In a bar too wide for its window Accept and Reject are icons, named by their hints.
  '.rl-bar-text .rl-hint': { display: 'none' },
  '.rl-review-bar-narrow .rl-bar-label': { display: 'none' },
  '.rl-review-bar-narrow .rl-bar-text': { width: '30px', padding: '0' },
  '.rl-review-bar-narrow .rl-bar-text .rl-hint': { display: 'flex' },
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
    fontSize: 'var(--rl-size-ui-small-scaled)',
    lineHeight: '1',
    whiteSpace: 'nowrap',
    pointerEvents: 'none',
    transform: 'translateX(-50%)',
    visibility: 'hidden',
    opacity: '0',
    transition: 'opacity 90ms ease-out, visibility 0s linear 90ms',
  },
  '.rl-bar-icon:hover .rl-hint, .rl-note-icon:hover .rl-hint, .rl-review-bar-narrow .rl-bar-text:hover .rl-hint':
    {
      visibility: 'visible',
      opacity: '1',
      transition: 'opacity 90ms ease-out 400ms, visibility 0s linear 400ms',
    },
  // The review bar's hints keep the interface's own size, whatever the text size.
  '.rl-review-bar .rl-hint': { fontSize: 'var(--rl-size-ui-small)' },
  '.rl-hint-keys': { color: 'rgb(255 255 255 / 0.62)', letterSpacing: '0.04em' },

  '@media (prefers-reduced-motion: reduce)': {
    '.rl-note, .rl-hint, .rl-bar-icon:hover .rl-hint, .rl-note-icon:hover .rl-hint': {
      transition: 'none',
    },
  },
};

export const reviewTheme = EditorView.baseTheme(reviewThemeSpec);
