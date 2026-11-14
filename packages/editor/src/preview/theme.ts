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
    // Narrower than the widest thing in it, if it comes to that: a table's cells can't fit the
    // column at 400%, and the table scrolls in its own box, where the column would otherwise grow
    // to its width and the page scroll sideways.
    minWidth: '0',
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
  // Subscript and superscript are smaller, and moved from the baseline without changing the line's
  // height, so that a line with one is as tall as the others.
  '.rl-sub, .rl-sup': {
    fontSize: '0.75em',
    lineHeight: '0',
    position: 'relative',
    verticalAlign: 'baseline',
  },
  '.rl-sub': { bottom: '-0.25em' },
  '.rl-sup': { top: '-0.5em' },
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

  // Alerts (#311): the lines of the quote are a box, tinted like code and not like a quote, with a
  // title row on its first line: an icon, the type's name and a menu that shows for the pointer or
  // the caret and is gone otherwise. Gray: color is for people, and a pending change of the type is
  // in its author's.
  '.rl-callout': {
    backgroundColor: 'var(--rl-tint)',
    padding: `0 ${s(16)}`,
  },
  '.rl-callout-first': {
    borderTopLeftRadius: '8px',
    borderTopRightRadius: '8px',
    paddingTop: s(10),
  },
  '.rl-callout-last': {
    borderBottomLeftRadius: '8px',
    borderBottomRightRadius: '8px',
    paddingBottom: s(10),
  },
  '.rl-callout-head': {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.45em',
    fontWeight: '600',
    color: 'var(--rl-ink)',
    cursor: 'text',
  },
  '.rl-callout-text': { fontWeight: '600' },
  '.rl-callout-icon': {
    width: '1em',
    height: '1em',
    flex: 'none',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: '1.3',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    color: 'var(--rl-ink-2)',
  },
  '.rl-callout-menu': {
    display: 'inline-flex',
    alignItems: 'center',
    margin: '0 0 0 0.1em',
    padding: '0.1em 0.2em',
    border: 'none',
    borderRadius: '4px',
    background: 'transparent',
    color: 'var(--rl-ink-3)',
    opacity: '0',
    cursor: 'pointer',
    font: 'inherit',
  },
  '.rl-callout-menu svg': {
    width: '0.8em',
    height: '0.8em',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: '1.5',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  },
  '.rl-callout-title:hover .rl-callout-menu, .rl-callout-active .rl-callout-menu, .rl-callout-menu:focus-visible':
    { opacity: '1' },
  '.rl-callout-menu:hover': { color: 'var(--rl-ink)', backgroundColor: 'var(--rl-rule)' },
  '.rl-callout-menu:focus': { outline: 'none' },
  '.rl-callout-menu:focus-visible': { outline: '2px solid var(--rl-ink-3)', outlineOffset: '1px' },
  '.rl-callout-pending, .rl-callout-pending .rl-callout-icon': { color: 'var(--rl-color)' },

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
  // Task boxes: a small SVG, 0.8em square and centred on the x-height, so it is the size of the
  // text at every text size, in every theme. Gray, never red: a 1.25px border in the third ink
  // (the SVG is 16 units across, so 1.5625 units are 1.25px at 16px text) and a radius of 0.18em.
  // A checked one is filled in the second ink, with its check mark in the page's color.
  '.rl-box': {
    display: 'inline-block',
    width: '0.8em',
    height: '0.8em',
    verticalAlign: 'middle',
    cursor: 'default',
    overflow: 'visible',
  },
  '.rl-box rect': {
    fill: 'none',
    stroke: 'var(--rl-ink-3)',
    strokeWidth: '1.5625',
  },
  '.rl-box:hover rect': { stroke: 'var(--rl-ink-2)' },
  '.rl-box-checked rect': { fill: 'var(--rl-ink-2)', stroke: 'var(--rl-ink-2)' },
  '.rl-box-checked:hover rect': { fill: 'var(--rl-ink)', stroke: 'var(--rl-ink)' },
  '.rl-box path': {
    fill: 'none',
    stroke: 'var(--rl-page)',
    strokeWidth: '1.9',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  },
  // A box with a pending change, in its new state: border and fill in its author's color.
  '.rl-box-pending .rl-box rect': { stroke: 'var(--rl-color)' },
  '.rl-box-pending .rl-box-checked rect': { fill: 'var(--rl-color)', stroke: 'var(--rl-color)' },
  // The keyboard's focus: the ring every control has, on keyboard focus only.
  '.rl-box:focus': { outline: 'none' },
  '.rl-box:focus-visible': { outline: '2px solid var(--rl-ink-3)', outlineOffset: '2px' },
  '.rl-box-pending .rl-box-checked:hover rect': {
    fill: 'color-mix(in srgb, var(--rl-color) 70%, var(--rl-ink))',
    stroke: 'color-mix(in srgb, var(--rl-color) 70%, var(--rl-ink))',
  },
  '.rl-box-pending .rl-box:hover rect': {
    stroke: 'color-mix(in srgb, var(--rl-color) 70%, var(--rl-ink))',
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
  // A cell that is empty has a filler for the caret to stand on, which takes no room. An inline-block
  // with `overflow: hidden` rests its bottom edge on the baseline, so a box as high as a line made the
  // line, and the row, 6.85 px taller than a line of text (measured in Chromium); aligned to the top
  // of the line it is no taller than the line.
  '.rl-tc-fill': {
    display: 'inline-block',
    width: '0',
    overflow: 'hidden',
    verticalAlign: 'top',
  },
  // The cells a row lacks (`table/missing.ts`) stand at the end of the row, where the page's own caret
  // can't say which of them it is in: the one the caret is in draws it, and the line's own is hidden.
  // (The last cell of a row has no padding on its right, and the break CodeMirror ends a line with, hidden
  // below, would be the last child.)
  '.rl-tc-missing:last-of-type': { paddingRight: '0' },
  '.rl-tc-active > .rl-tc-fill': { position: 'relative', overflow: 'visible' },
  // The line stands only while the editor has the focus, as CodeMirror's own cursor does: a solid line
  // left after the editor blurs or the window is deactivated would be a caret in a text that has none
  // (the page's own is hidden below either way).
  '&.cm-focused .rl-tc-active > .rl-tc-fill::after': {
    content: '""',
    position: 'absolute',
    left: '0',
    top: '0.12em',
    bottom: '0.12em',
    borderLeft: '1px solid var(--rl-caret, var(--rl-author-1))',
  },
  '.cm-line:has(> .rl-tc-active)': { caretColor: 'transparent' },
  // CodeMirror's buffers beside a widget and its line-end break are inline boxes in the row, each of
  // which a table row wraps in a cell of its own: between the cells of a row that lacks some they would
  // push the cells after them a column along. They are not needed there, for the caret is never beside
  // a widget of the row (found in a browser, measuring the cells of a row).
  '.rl-trow:has(> .rl-tc-missing) > .cm-widgetBuffer, .rl-trow:has(> .rl-tc-missing) > br': {
    display: 'none',
  },
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
