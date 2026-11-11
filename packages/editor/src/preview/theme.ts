// The editor's look (design §5.1, §6.6), entirely through the tokens of @redlines/themes: a
// centered column on the page, text in the theme's ink and fonts, and Markdown drawn as the
// finished document. Syntax shown around the caret is in the quiet syntax gray. Color is kept
// for people: the caret is yours, in your author color unless the host sets --rl-caret.

import { EditorView } from '@codemirror/view';

/** The advance of one monospace (Cousine) character, which lines list text up with its source. */
const MONO = '0.6em';

/** A length inside the column, in px at the theme's own size, times the text size. */
export function textPx(px: number): string {
  return `calc(${px}px * var(--rl-text-scale, 1))`;
}
const s = textPx;

/** The theme's space between blocks of a kind, with today's sizes where no theme is set. */
const SPACE = { block: 16, h1: 18, heading: 10, item: 6, loose: 16 } as const;

/** The space between blocks of a kind, in px at the theme's own size, times the text size. */
export function space(kind: keyof typeof SPACE): string {
  return `calc(var(--rl-space-${kind}, ${SPACE[kind]}px) * var(--rl-text-scale, 1))`;
}

type ThemeSpec = Parameters<typeof EditorView.baseTheme>[0];

/**
 * A rule for each kind of space: above a block's first line, and below the text of the line above
 * code, front matter or a table, whose first line is tinted or not drawn.
 */
function spaceRules(): ThemeSpec {
  const rules: ThemeSpec = {};
  for (const kind of Object.keys(SPACE) as (keyof typeof SPACE)[]) {
    // A struck block (tracked/decorations.ts) takes the space of the kind it was.
    const above = { paddingTop: `calc(${space(kind)} + var(--rl-above, 0px))` };
    rules[`.cm-line.rl-space-${kind}`] = above;
    rules[`.rl-struck.rl-space-${kind}`] = above;
    rules[`.cm-line.rl-space-${kind}-below`] = { paddingBottom: space(kind) };
  }
  return rules;
}

export const baseThemeSpec: ThemeSpec = {
  '&': {
    color: 'var(--rl-ink)',
    backgroundColor: 'var(--rl-page)',
    fontSize: 'calc(var(--rl-size-body) * var(--rl-text-scale, 1))',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'var(--rl-font-body)',
    lineHeight: 'var(--rl-line-height)',
  },
  '.cm-content': {
    boxSizing: 'border-box',
    // The measure grows with the text size, between margins that grow above 100%.
    maxWidth: 'calc(var(--rl-column) * var(--rl-text-scale, 1) + 2 * var(--rl-margin, 24px))',
    margin: '0 auto',
    padding: `${s(32)} var(--rl-margin, 24px) 30vh`,
    caretColor: 'var(--rl-caret, var(--rl-author-1))',
    // The text cursor, also in hosts whose chrome sets the default arrow.
    cursor: 'text',
  },
  '.cm-line': { padding: '0' },
  // The space between blocks, by their kinds (preview/spacing.ts): padding on the first line of the
  // block below, whatever blank lines the file has between them, which are hidden. A heading adds
  // the space it keeps above itself.
  ...spaceRules(),

  // Headings: the heading font and weight, no rule under them, more space above than below.
  '.rl-h1, .rl-h2, .rl-h3, .rl-h4, .rl-h5, .rl-h6': {
    fontFamily: 'var(--rl-font-heading)',
    fontWeight: 'var(--rl-weight-heading)',
    lineHeight: '1.25',
  },
  // `--rl-above` is the space a heading keeps above itself, added to the space between blocks.
  '.rl-h1': {
    fontSize: 'calc(var(--rl-size-h1) * var(--rl-text-scale, 1))',
    letterSpacing: 'var(--rl-tracking-h1)',
    lineHeight: '1.15',
    '--rl-above': '0.3em',
    paddingTop: 'var(--rl-above)',
  },
  '.rl-h2': {
    fontSize: 'calc(var(--rl-size-h2) * var(--rl-text-scale, 1))',
    '--rl-above': '0.8em',
    paddingTop: 'var(--rl-above)',
  },
  '.rl-h3': {
    fontSize: 'calc(var(--rl-size-h3) * var(--rl-text-scale, 1))',
    '--rl-above': '0.7em',
    paddingTop: 'var(--rl-above)',
  },
  '.rl-h4, .rl-h5, .rl-h6': {
    fontSize: '1em',
    '--rl-above': '0.5em',
    paddingTop: 'var(--rl-above)',
  },
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
    paddingLeft: s(18),
    fontFamily: 'var(--rl-quote-font)',
    fontStyle: 'var(--rl-quote-style)',
    fontSize: 'var(--rl-quote-size)',
    color: 'var(--rl-quote-color)',
  },

  // Images: no frame. One on a line of its own is centered, at most as wide as the text column;
  // inline, it sits in the text. A missing one is its alt text, quietly.
  '.rl-image img': { maxWidth: '100%', height: 'auto', verticalAlign: 'middle' },
  '.rl-image-own': { display: 'block', textAlign: 'center', padding: `${s(6)} 0`, textIndent: '0' },
  '.rl-image-own img': { display: 'block', margin: '0 auto', verticalAlign: 'top' },
  '.rl-image-missing': { color: 'var(--rl-ink-3)' },

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
  // Task boxes: gray, never red. A checked one is filled, with a check mark in the page's color.
  '.rl-box': {
    display: 'inline-block',
    boxSizing: 'border-box',
    width: '0.95em',
    height: '0.95em',
    border: '1.5px solid var(--rl-ink-3)',
    borderRadius: '3px',
    verticalAlign: '-0.1em',
    cursor: 'default',
    textAlign: 'center',
    fontSize: '0.75em',
    lineHeight: '1.1em',
    fontFamily: 'var(--rl-font-body)',
  },
  '.rl-box-checked': {
    backgroundColor: 'var(--rl-ink-3)',
    borderColor: 'var(--rl-ink-3)',
    color: 'var(--rl-page)',
  },
  // Code blocks, and front matter, dimmed because it is about the document rather than part of it.
  '.rl-codeblock, .rl-frontmatter': {
    fontFamily: 'var(--rl-font-mono)',
    fontSize: '0.86em',
    backgroundColor: 'var(--rl-tint)',
    padding: `0 ${s(16)}`,
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
    // In the middle of the line's text, not of the space above it.
    backgroundOrigin: 'content-box',
  },

  // Tables: a header row and horizontal rules only. A table is the lines of its source laid out as
  // one (`table/layout.ts`): a wrapper that scrolls, a wrapper that is the table, a line for each
  // row and a mark for each cell. The editor's line wrapping lets text break anywhere, which lets a
  // table squeeze a column below its longest word; cells break between words, and inside a word only
  // when it can't fit. The box reaches 24px into the margin, so that its scrolling doesn't cut off
  // the change bars of its rows.
  '.rl-tbl-scroll': {
    overflowX: 'auto',
    margin: '0 0 0 -24px',
    padding: `${s(6)} 0 ${s(6)} 24px`,
    cursor: 'text',
    wordBreak: 'normal',
    overflowWrap: 'break-word',
  },
  '.rl-tbl': {
    display: 'table',
    tableLayout: 'fixed',
    borderCollapse: 'collapse',
    width: '100%',
    fontSize: '0.94em',
    lineHeight: '1.45',
  },
  '.cm-line.rl-trow': { display: 'table-row', padding: '0' },
  '.rl-tc': {
    display: 'table-cell',
    // The widths (`table/widths.ts`) are of the whole cell, its padding in them.
    boxSizing: 'border-box',
    padding: `${s(10)} ${s(16)} ${s(10)} 0`,
    textAlign: 'left',
    verticalAlign: 'top',
    borderBottom: '1px solid var(--rl-rule)',
  },
  '.rl-tc:last-child': { paddingRight: '0' },
  '.rl-tc-hidden': { display: 'none' },
  '.rl-tc[data-align="left"]': { textAlign: 'left' },
  '.rl-tc[data-align="center"]': { textAlign: 'center' },
  '.rl-tc[data-align="right"]': { textAlign: 'right' },
  // A cell that is empty has a filler for the caret to stand on, which takes no room.
  '.rl-tc-fill': { display: 'inline-block', width: '0', overflow: 'hidden' },
  // The cells a selection reaches (`table/reach.ts`): the system's selection color, over the whole
  // cell; the text highlight stays for what lies outside the table.
  // The cell is painted, not the mark: a block mark inside a cell, between the widget buffers
  // around it, stacks into lines and makes the row taller (found in a measure of a selected row).
  '.rl-tc:has(.rl-sel)': {
    backgroundColor: 'Highlight',
    color: 'HighlightText',
  },
  '.rl-sel': { color: 'inherit' },
  // The text highlight stays out of selected cells: the cell is the selection.
  '.rl-sel::selection, .rl-sel *::selection': {
    backgroundColor: 'transparent',
    color: 'inherit',
  },
  // The header row is quieter than the data, and sits on the darker rule.
  '.rl-th .rl-tc': {
    paddingTop: '0',
    paddingBottom: s(8),
    color: 'var(--rl-ink-2)',
    fontFamily: 'var(--rl-th-font)',
    fontSize: 'var(--rl-th-size)',
    fontWeight: '700',
    textTransform: 'var(--rl-th-case)',
    letterSpacing: 'var(--rl-th-track)',
    borderBottomColor: 'var(--rl-ink-3)',
  },
};

export const baseTheme = EditorView.baseTheme(baseThemeSpec);
