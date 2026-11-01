// The editor's look (design §5.1, §6.6), entirely through the tokens of @redlines/themes: a
// centered column on the page, text in the theme's ink and fonts, and Markdown drawn as the
// finished document. Syntax shown around the caret is in the quiet syntax gray. Color is kept
// for people: the caret is yours, in your author color unless the host sets --rl-caret.

import { EditorView } from '@codemirror/view';

/** The advance of one monospace (Cousine) character, which lines list text up with its source. */
const MONO = '0.6em';

export const baseTheme = EditorView.baseTheme({
  '&': {
    color: 'var(--rl-ink)',
    backgroundColor: 'var(--rl-page)',
    fontSize: 'var(--rl-size-body)',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'var(--rl-font-body)',
    lineHeight: 'var(--rl-line-height)',
  },
  '.cm-content': {
    boxSizing: 'border-box',
    maxWidth: 'calc(var(--rl-column) + 48px)',
    margin: '0 auto',
    padding: '32px 24px 30vh',
    caretColor: 'var(--rl-caret, var(--rl-author-1))',
    // The text cursor, also in hosts whose chrome sets the default arrow.
    cursor: 'text',
  },
  '.cm-line': { padding: '0' },
  // A blank line between blocks is the space between them: even, and less than a line of text.
  // Under a heading it is smaller, so that the heading sits with the text it heads.
  '.cm-line.rl-gap': { lineHeight: '16px' },
  '.cm-line.rl-h1 + .cm-line.rl-gap': { lineHeight: '18px' },
  [['h2', 'h3', 'h4', 'h5', 'h6'].map((h) => `.cm-line.rl-${h} + .cm-line.rl-gap`).join(', ')]: {
    lineHeight: '10px',
  },

  // Headings: the heading font and weight, no rule under them, more space above than below.
  '.rl-h1, .rl-h2, .rl-h3, .rl-h4, .rl-h5, .rl-h6': {
    fontFamily: 'var(--rl-font-heading)',
    fontWeight: 'var(--rl-weight-heading)',
    lineHeight: '1.25',
  },
  '.rl-h1': {
    fontSize: 'var(--rl-size-h1)',
    letterSpacing: 'var(--rl-tracking-h1)',
    lineHeight: '1.15',
    paddingTop: '0.3em',
  },
  '.rl-h2': { fontSize: 'var(--rl-size-h2)', paddingTop: '0.8em' },
  '.rl-h3': { fontSize: 'var(--rl-size-h3)', paddingTop: '0.7em' },
  '.rl-h4, .rl-h5, .rl-h6': { fontSize: '1em', paddingTop: '0.5em' },
  '.rl-h6': { color: 'var(--rl-ink-2)' },

  '.rl-strong': { fontWeight: '700' },
  '.rl-em': { fontStyle: 'italic' },
  '.rl-strike': { textDecoration: 'line-through', color: 'var(--rl-ink-2)' },
  '.rl-code': {
    fontFamily: 'var(--rl-font-mono)',
    fontSize: '0.84em',
    backgroundColor: 'var(--rl-tint)',
    borderRadius: '5px',
    padding: '0.12em 0.38em',
  },
  // Links are text, not color: color means a person.
  '.rl-link': {
    textDecoration: 'underline',
    textDecorationColor: 'var(--rl-ink-3)',
    textDecorationThickness: '1px',
    textUnderlineOffset: '0.2em',
  },
  '.rl-syntax': { color: 'var(--rl-syntax)' },

  '.rl-quote': {
    borderLeft: '2px solid var(--rl-rule)',
    paddingLeft: '18px',
    fontFamily: 'var(--rl-quote-font)',
    fontStyle: 'var(--rl-quote-style)',
    fontSize: 'var(--rl-quote-size)',
    color: 'var(--rl-quote-color)',
  },

  // Lists: indentation and markers take the width they have in monospace, so nested items line
  // up under their parent's text and showing a marker's source doesn't move the line. A zero
  // line height keeps the monospace font's taller metrics from making those lines taller.
  '.rl-indent, .rl-list-source': { fontFamily: 'var(--rl-font-mono)', lineHeight: '0' },
  '.rl-hang': {
    paddingLeft: `calc(var(--rl-hang) * ${MONO})`,
    textIndent: `calc(var(--rl-hang) * -${MONO})`,
  },
  // The marker ends a little before the item's text, so that numbers line up on their periods.
  '.rl-list-mark': {
    display: 'inline-block',
    boxSizing: 'border-box',
    width: `calc(var(--rl-cols) * ${MONO})`,
    paddingRight: '0.45em',
    textAlign: 'right',
    textIndent: '0',
  },
  // A little space between the items of a list, nested ones included.
  '.cm-line.rl-li + .cm-line.rl-li': { paddingTop: '6px' },

  // Code blocks, and front matter, dimmed because it is about the document rather than part of it.
  '.rl-codeblock, .rl-frontmatter': {
    fontFamily: 'var(--rl-font-mono)',
    fontSize: '0.86em',
    backgroundColor: 'var(--rl-tint)',
    padding: '0 16px',
  },
  '.rl-frontmatter': { color: 'var(--rl-ink-2)' },
  '.rl-codeblock-first, .rl-frontmatter-first': {
    borderTopLeftRadius: '6px',
    borderTopRightRadius: '6px',
  },
  '.rl-codeblock-last, .rl-frontmatter-last': {
    borderBottomLeftRadius: '6px',
    borderBottomRightRadius: '6px',
  },

  // A rule drawn across the line while its source is hidden.
  '.rl-hr:not(:has(.rl-syntax))': {
    backgroundImage: 'linear-gradient(var(--rl-rule), var(--rl-rule))',
    backgroundSize: '100% 1px',
    backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat',
  },

  // Tables: a header row and horizontal rules only. The editor's line wrapping lets text break
  // anywhere, which lets a table squeeze a column below its longest word; cells break between
  // words, and inside a word only when it can't fit. The table's box reaches 24px into the margin,
  // so that its scrolling doesn't cut off the change bars of its rows.
  '.rl-table': {
    overflowX: 'auto',
    margin: '0 0 0 -24px',
    padding: '6px 0 6px 24px',
    cursor: 'text',
    wordBreak: 'normal',
    overflowWrap: 'break-word',
  },
  '.rl-table table': {
    borderCollapse: 'collapse',
    width: '100%',
    fontSize: '0.94em',
    lineHeight: '1.45',
  },
  '.rl-table th, .rl-table td': {
    padding: '10px 16px 10px 0',
    textAlign: 'left',
    verticalAlign: 'top',
    borderBottom: '1px solid var(--rl-rule)',
  },
  '.rl-table th:last-child, .rl-table td:last-child': { paddingRight: '0' },
  // The header row is quieter than the data, and sits on the darker rule.
  '.rl-table th': {
    paddingTop: '0',
    paddingBottom: '8px',
    color: 'var(--rl-ink-2)',
    fontFamily: 'var(--rl-th-font)',
    fontSize: 'var(--rl-th-size)',
    fontWeight: '700',
    textTransform: 'var(--rl-th-case)',
    letterSpacing: 'var(--rl-th-track)',
    borderBottomColor: 'var(--rl-ink-3)',
  },
});
