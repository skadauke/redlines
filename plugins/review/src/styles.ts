// The review interface's look (design §5.1, §5.7, §6.6), entirely through the theme's tokens, in
// its interface font. Notes are light: a thin border, no shadow or fill. Text and controls are
// grays; a person's color marks only their dot, a selected note's border and its anchor's tint.

import { EditorView } from '@codemirror/view';

/** The rail's width, and its distance from the text column. */
export const RAIL_WIDTH = 248;
export const RAIL_GAP = 44;
/** The least space between two notes. */
export const NOTE_GAP = 8;
/** The height of a note's actions, which appear on hover. */
export const ACTIONS_HEIGHT = 28;
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
    fontSize: '13.5px',
    lineHeight: '1.38',
    cursor: 'default',
  },
  '.rl-note': {
    position: 'absolute',
    left: '0',
    boxSizing: 'border-box',
    width: '100%',
    padding: '8px 11px 9px',
    border: '1px solid var(--rl-rule)',
    borderRadius: '8px',
    transition: 'border-color 120ms ease',
  },
  '.rl-note-selected': { borderColor: 'var(--rl-color)' },
  '.rl-note-item + .rl-note-item': { marginTop: '9px' },

  // Who wrote it: a 6px dot in their color, the name, whom an agent acts for, and the time, which
  // shows on hover or while the note is selected.
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
  '.rl-note-time, .rl-card-time': {
    flex: 'none',
    marginLeft: 'auto',
    paddingLeft: '4px',
    color: 'var(--rl-ink-3)',
    fontSize: '12px',
  },
  '.rl-note-time': { display: 'none' },
  '.rl-note:hover .rl-note-time, .rl-note-selected .rl-note-time': { display: 'block' },
  '.rl-note-head': { fontSize: '13px' },
  '.rl-note-text': {
    marginTop: '1px',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
  },

  // The actions, which show on hover or while the note is selected. The rail keeps room for them
  // under every note, so that showing them never moves another note.
  '.rl-note-actions': {
    display: 'none',
    boxSizing: 'border-box',
    height: `${ACTIONS_HEIGHT}px`,
    margin: '0 -6px',
    paddingTop: '6px',
    gap: '2px',
  },
  '.rl-note:hover .rl-note-actions, .rl-note-selected .rl-note-actions': { display: 'flex' },
  '.rl-note-replying .rl-note-actions, .rl-note-replying:hover .rl-note-actions': {
    display: 'none',
  },
  '.rl-note-button': {
    height: '22px',
    padding: '0 6px',
    border: '0',
    borderRadius: '5px',
    background: 'transparent',
    color: 'var(--rl-ink-2)',
    font: 'inherit',
    fontSize: '12.5px',
    cursor: 'default',
  },
  '.rl-note-button:hover': { backgroundColor: 'var(--rl-pressed)', color: 'var(--rl-ink)' },
  '.rl-note-button:focus-visible': { outline: '2px solid var(--rl-ink-3)', outlineOffset: '-2px' },
  '.rl-note-button:disabled': { color: 'var(--rl-ink-3)', backgroundColor: 'transparent' },

  // A reply being written: private until it is posted with ⌘↩.
  '.rl-note-reply': { marginTop: '8px' },
  '.rl-note-reply textarea': {
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
  '.rl-note-reply textarea:focus': { borderColor: 'var(--rl-ink-3)' },
  '.rl-note-reply textarea::placeholder': { color: 'var(--rl-ink-3)' },
  '.rl-note-reply-row': {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '2px',
    margin: '5px -6px 0 0',
  },
  '.rl-note-error': { marginTop: '4px', color: 'var(--rl-ink-2)', fontSize: '12.5px' },

  // The anchor of the selected note: its tint doubled.
  '.rl-anchor': { backgroundColor: 'var(--rl-color-tint)' },
});
