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
  // The notes slide into place when the note level with its anchor changes, as the page scrolls or
  // another is selected: the rail has this class for a moment then (rail.ts), and not while a
  // keystroke or a resize moves the text, when a note should keep up with its anchor.
  '.rl-rail-sliding .rl-note': { transition: 'border-color 120ms ease, top 180ms ease' },
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
  // A change's note: what the change did (in the full markup the old text struck through, in the
  // simple look a sentence in the card's words), and then why, quieter.
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
  '.rl-note-parked': { display: 'none !important' },
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
  '.rl-rail-sliding.rl-rail-compact .rl-note-dot': { transition: 'top 180ms ease' },
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
  // The change Review Changes is on: a ring around its text in the theme's inks, so that it reads
  // as "this one" and never as a selection (the system's blue) or a comment's tint (an author's
  // color). It has no wash: text sits on the page, or on the tint of code blocks and tables, and
  // any wash takes some author colors under 4.5:1 there (measured over every theme; Book's red on
  // its tint is already 4.49 bare), so the ring and the wider bar carry the mark.
  '.rl-review-current': {
    boxShadow:
      '0 0 0 1px color-mix(in srgb, var(--rl-page) 80%, transparent), 0 0 0 2.5px color-mix(in srgb, var(--rl-ink-2) 75%, transparent)',
    borderRadius: '2px',
  },
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

  // The review panel (Review Changes): a card beside the change, in the margin or below or above it,
  // fixed in the window. Its title is the handle that drags it.
  '.rl-review-panel': {
    position: 'fixed',
    // Above the text, below the title bar (2) whose menus open over it.
    zIndex: '1',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    boxSizing: 'border-box',
    width: '304px',
    maxWidth: 'calc(100vw - 24px)',
    padding: '8px 10px 10px',
    border: '1px solid var(--rl-rule)',
    borderRadius: '12px',
    backgroundColor: 'var(--rl-card)',
    boxShadow: 'var(--rl-shadow)',
    color: 'var(--rl-ink)',
    fontFamily: 'var(--rl-font-ui)',
    fontSize: 'var(--rl-size-ui)',
    lineHeight: '1.35',
    cursor: 'default',
    userSelect: 'none',
    WebkitUserSelect: 'none',
  },
  '.rl-review-panel:focus': { outline: 'none' },
  '.rl-review-panel-dragging': { boxShadow: 'var(--rl-shadow-lifted, var(--rl-shadow))' },
  '.rl-rp-top': {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    margin: '-2px -4px 0 0',
    cursor: 'grab',
    touchAction: 'none',
    color: 'var(--rl-ink-2)',
    fontSize: 'var(--rl-size-ui-small)',
  },
  '.rl-review-panel-dragging .rl-rp-top': { cursor: 'grabbing' },
  '.rl-rp-title': {
    color: 'var(--rl-ink)',
    fontSize: 'var(--rl-size-ui)',
    fontWeight: '700',
    lineHeight: '1.3',
  },
  '.rl-rp-top .rl-bar-count': {
    flex: '1',
    minWidth: '0',
    padding: '0',
    textAlign: 'right',
    fontVariantNumeric: 'tabular-nums',
  },
  '.rl-rp-body': { display: 'flex', flexDirection: 'column', gap: '4px' },
  '.rl-rp-head': {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    color: 'var(--rl-ink-2)',
    fontSize: 'var(--rl-size-ui-small)',
  },
  '.rl-rp-head .rl-dot': {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    backgroundColor: 'var(--rl-color)',
  },
  '.rl-rp-name': { color: 'var(--rl-ink)', fontWeight: '600' },
  '.rl-rp-what': { overflowWrap: 'anywhere', userSelect: 'text', WebkitUserSelect: 'text' },
  '.rl-rp-form': { display: 'block' },
  '.rl-rp-form[hidden]': { display: 'none' },
  '.rl-rp-field': {
    boxSizing: 'border-box',
    width: '100%',
    resize: 'none',
    padding: '6px 8px',
    border: '1px solid var(--rl-rule)',
    borderRadius: '8px',
    backgroundColor: 'var(--rl-paper, transparent)',
    color: 'var(--rl-ink)',
    font: 'inherit',
    userSelect: 'text',
    WebkitUserSelect: 'text',
  },
  '.rl-rp-field:focus': { outline: '2px solid var(--rl-ink-3)', outlineOffset: '-1px' },
  '.rl-rp-actions': { display: 'flex', gap: '2px', flexWrap: 'wrap' },
  '.rl-rp-nav': {
    display: 'flex',
    justifyContent: 'space-between',
    margin: '0 -4px',
    paddingTop: '6px',
    borderTop: '1px solid var(--rl-rule)',
  },
  '.rl-rp-actions[hidden], .rl-rp-nav[hidden]': { display: 'none' },
  '.rl-bar-key': {
    marginLeft: '2px',
    minWidth: '16px',
    padding: '1px 4px',
    border: '1px solid var(--rl-rule)',
    borderRadius: '4px',
    color: 'var(--rl-ink-3)',
    fontSize: 'var(--rl-size-ui-small)',
    lineHeight: '1.2',
    textAlign: 'center',
  },
  // Why a decision was refused, above the bar for a few seconds.
  '.rl-bar-error': {
    boxSizing: 'border-box',
    padding: '7px 10px',
    border: '1px solid var(--rl-rule)',
    borderRadius: '8px',
    backgroundColor: 'var(--rl-card)',
    color: 'var(--rl-ink-2)',
    fontSize: 'var(--rl-size-ui)',
    lineHeight: '1.35',
    whiteSpace: 'normal',
  },
  '.rl-bar-error[hidden]': { display: 'none' },
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
  '.rl-bar-icon:hover .rl-hint, .rl-note-icon:hover .rl-hint': {
    visibility: 'visible',
    opacity: '1',
    transition: 'opacity 90ms ease-out 400ms, visibility 0s linear 400ms',
  },
  // The review bar's hints keep the interface's own size, whatever the text size.
  '.rl-review-panel .rl-hint': { fontSize: 'var(--rl-size-ui-small)' },
  '.rl-hint-keys': { color: 'rgb(255 255 255 / 0.62)', letterSpacing: '0.04em' },

  '@media (prefers-reduced-motion: reduce)': {
    // Every selector above that moves something by a transition is here, with its own specificity.
    '.rl-note, .rl-rail-sliding .rl-note, .rl-note-dot, .rl-rail-sliding.rl-rail-compact .rl-note-dot, .rl-hint, .rl-bar-icon:hover .rl-hint, .rl-note-icon:hover .rl-hint':
      {
        transition: 'none',
      },
  },
};

export const reviewTheme = EditorView.baseTheme(reviewThemeSpec);
