// The lines and blocks of a Markdown file, as far as marker placement needs them (format §3.2 to
// §3.4, §3.8): what a line's container prefix is, whether a position starts a block or only a
// wrapped line, the form of a mark that starts a block (the opener alone on the line before it),
// the break that a `split` stands for, and where front matter ends. This is not a Markdown
// parser: it knows prefixes, bullets, quotes, ATX headings, fences, rules and table rows.

import type { DocView, MarkRange, Range, Segment } from './types.ts';

/** What may come before a marker on its line without the marker starting the line's content:
 * indentation, block quote markers, list bullets and checkboxes (format §3.2). */
export const CONTAINER_PREFIX =
  /^(?:[ \t]*(?:>|[-*+](?=[ \t])|\d{1,9}[.)](?=[ \t])|\[[ xX]\](?=[ \t])))*[ \t]*$/;

/** The container prefix at the start of a line, as long as it goes. */
const PREFIX_START =
  /^(?:[ \t]*(?:>|[-*+](?=[ \t])|\d{1,9}[.)](?=[ \t])|\[[ xX]\](?=[ \t])))*[ \t]*/;

/** The prefix of a line as a break takes it: the tokens, and one space after the last. */
const BREAK_PREFIX =
  /^(?:[ \t]*(?:>|[-*+](?=[ \t])|\d{1,9}[.)](?=[ \t])|\[[ xX]\](?=[ \t])))*[ \t]?/;

/** A list marker and the spaces after it. */
const LIST_MARKER = /(?:[-*+]|\d{1,9}[.)])[ \t]+/g;
const CHECKBOX = /\[[ xX]\][ \t]+/g;
/** A prefix that ends in a bullet, so that the text after it is a list item's first block. */
const ENDS_IN_BULLET = /(?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[[ xX]\][ \t]+)?$/;
/** A bullet anywhere in a prefix. */
const HAS_BULLET = /(?:^|[\s>])(?:[-*+]|\d{1,9}[.)])[ \t]/;
const ATX_PREFIX = /^#{1,6}[ \t]+/;
/** Lines that start a block, even right after a line of a paragraph. An ordered list item is not
 * here: it interrupts a paragraph only when it starts with 1 (`startsList`). */
const BLOCK_SYNTAX =
  /^(?:[-*+](?:[ \t]|$)|>|#{1,6}(?:[ \t]|$)|`{3,}|~{3,}|(?:-[ \t]*){3,}$|(?:\*[ \t]*){3,}$|(?:_[ \t]*){3,}$)/;
/** The first list marker of a line, after its quote markers: a bullet, or the number of an ordered
 * item. */
const FIRST_MARKER = /^(?:[ \t]*>)*[ \t]*(?:([-*+])|(\d{1,9})[.)])(?=[ \t]|$)/;
const SETEXT_UNDERLINE = /^(?:=+|-+)[ \t]*$/;

/** The opener of a segment with its carrier: all that goes when the opener goes. */
export function openerRange(segment: Segment): Range {
  return { from: segment.open.from, to: segment.carrier?.to ?? segment.open.to };
}

/** Where the marker that starts at `from` ends: after its `-->`. A payload never holds one. */
export function markerEnd(text: string, from: number): number {
  return text.indexOf('-->', from) + 3;
}

/** Where the line that holds `position` starts. */
export function lineStart(text: string, position: number): number {
  return position === 0 ? 0 : text.lastIndexOf('\n', position - 1) + 1;
}

/** Where the line after the one that holds `position` starts, past its line break (`\r\n` too), or
 * past the end of the text on the last line. */
export function nextLineStart(text: string, position: number): number {
  const newline = text.indexOf('\n', position);
  return newline === -1 ? text.length + 1 : newline + 1;
}

/** Where the line that holds `position` ends: before its line break. */
export function lineEnd(text: string, position: number): number {
  const newline = text.indexOf('\n', position);
  if (newline === -1) return text.length;
  return newline > 0 && text[newline - 1] === '\r' ? newline - 1 : newline;
}

/** How many characters of the line are its container prefix. */
export function prefixLength(line: string): number {
  return PREFIX_START.exec(line)?.[0].length ?? 0;
}

/**
 * The prefix of the lines that follow the first line of a block: the prefix of that line, with the
 * list marker replaced by spaces, because the next lines of a list item are indented to its content
 * column. A checkbox belongs to the text, not to the indentation.
 */
export function continuationPrefix(prefix: string): string {
  return prefix.replace(LIST_MARKER, (marker) => ' '.repeat(marker.length)).replace(CHECKBOX, '');
}

/**
 * What goes after the opener of a mark that starts a block, between it and the block's text, when
 * the opener stands alone on the line before the block (format §3.3): a line break, a blank line
 * (not after a bullet, where it would make the list loose, nor further down a run of such lines),
 * and the prefix of the block's lines. `prefix` is what comes before the opener on its line.
 */
export function scaffold(prefix: string, eol: string, tight = false): string {
  const next = continuationPrefix(prefix);
  return tight || ENDS_IN_BULLET.test(prefix) ? eol + next : eol + prefix.trimEnd() + eol + next;
}

/** A line that has nothing but its prefix in it. */
function isBlank(line: string): boolean {
  return /^[ \t>]*$/.test(line);
}

/**
 * Where the carrier of an opener ends. An opener that is alone on its line, after the container
 * prefix, stands for a mark that starts the block that follows (format §3.3). The line break, the
 * blank line and the prefix of the block's first line that follow it are part of that form, not
 * text, and go with the marker wherever it goes. `[from, to)` is the marker. Returns `to` when
 * the opener has no carrier: there is text after it on its line, or text before it other than
 * markers, or no block follows.
 */
export function carrierEnd(text: string, from: number, to: number): number {
  const start = lineStart(text, from);
  // Markers may stand in front of the opener on its line: where the mark of one ends and another
  // starts a block, the closer of the first is in front of the opener of the second.
  const before = text.slice(start, from).replace(/<!--.*?-->/g, '');
  if (!CONTAINER_PREFIX.test(before)) return to;
  const end = lineEnd(text, to);
  if (text.slice(to, end).trim() !== '') return to;
  let position = text.indexOf('\n', to);
  if (position === -1) return to;
  position++;
  // The blank lines, then the first line of the block.
  for (;;) {
    const next = text.indexOf('\n', position);
    if (next === -1 || !isBlank(text.slice(position, next).replace(/\r$/, ''))) break;
    position = next + 1;
  }
  if (position >= text.length) return to;
  const prefix = continuationPrefix(before);
  let matched = 0;
  while (matched < prefix.length && text[position + matched] === prefix[matched]) matched++;
  return position + matched;
}

/**
 * How much of `rest` a break takes (format §3.4), when `rest` starts with it: the syntax of a hard
 * break (two spaces, or a backslash), one line break, one blank line if there is one, and the
 * prefix of the next line (`- `, `> `, `## `). `linePrefix` is the container prefix of the line the
 * break ends, which tells how far the next line's indentation belongs to the break. 0 when `rest`
 * does not start with a line break.
 */
export function breakLength(linePrefix: string, rest: string): number {
  const first = /^(?:[ \t]*|\\)\r?\n/.exec(rest);
  if (!first) return 0;
  let position = first[0].length;
  const next = rest.indexOf('\n', position);
  if (next !== -1 && isBlank(rest.slice(position, next).replace(/\r$/, ''))) position = next + 1;
  const lineBreak = rest.indexOf('\n', position);
  const line = rest.slice(position, lineBreak === -1 ? rest.length : lineBreak).replace(/\r$/, '');
  // Indentation alone is part of the break only when it is the indentation of a list item's lines;
  // otherwise it is the next block's own.
  const indent = continuationPrefix(linePrefix);
  // The space after a bullet or a `>` is one space; more of them are the text's own.
  const prefix = BREAK_PREFIX.exec(line)?.[0] ?? '';
  let container = prefix;
  if (!/[>\-*+\d\]]/.test(prefix))
    container = indent !== '' && line.startsWith(indent) ? indent : '';
  const heading = ATX_PREFIX.exec(line.slice(container.length))?.[0].length ?? 0;
  return position + container.length + heading;
}

/** The syntax of a hard break: two spaces, or a backslash, at the end of a line. */
export const HARD_BREAK = / {2,}$|\\$/;

/** Where the line break in front of the line that holds `position` starts, with the syntax of a
 * hard break before it. The line must not be the first. */
export function breakStart(text: string, position: number): number {
  const end = lineEnd(text, lineStart(text, position) - 1);
  const hard = HARD_BREAK.exec(text.slice(Math.max(0, end - 64), end));
  return end - (hard ? hard[0].length : 0);
}

/** The container prefix of the line that holds `position`, up to `position`. */
export function linePrefixAt(text: string, position: number): string {
  return PREFIX_START.exec(text.slice(lineStart(text, position), position))?.[0] ?? '';
}

/**
 * Where the break after a `split` marker ends: see `breakLength`. `at` is the end of the marker.
 * Returns `at` when no line break follows. Rejecting the split removes this much. The break does
 * not go on into the ledger, which starts at `limit`.
 */
export function breakEnd(text: string, at: number, limit = text.length): number {
  const end = at + breakLength(linePrefixAt(text, at), text.slice(at, Math.min(at + 4096, limit)));
  return Math.min(end, Math.max(at, limit));
}

/**
 * Where what a `split` inserted ends (format §3.4): its break, or, when someone deleted the break
 * and recorded that as a deletion right after the marker, the end of that deletion. Rejecting the
 * split takes all of it, and the original view has none of it. `open` is the marker, and
 * `deletions` the segments of the deletions of the text.
 */
export function splitEnd(
  text: string,
  open: Range,
  deletions: readonly Segment[],
  limit?: number,
): number {
  const end = breakEnd(text, open.to, limit);
  if (end > open.to) return end;
  const gone = deletions.find((segment) => {
    const { payload } = segment;
    return (
      segment.open.from === open.to &&
      payload !== undefined &&
      payload !== '' &&
      breakLength(linePrefixAt(text, open.to), payload) === payload.length
    );
  });
  return gone ? openerRange(gone).to : open.to;
}

/**
 * Where the YAML front matter at the top of the file ends: the end of the line that closes it
 * (`---` or `...`), before its line break. -1 when the file has none. The first line must be `---`
 * and the second must not be blank (format §3.8).
 */
export function frontMatterEnd(text: string): number {
  const open = /^---[ \t]*\r?\n/.exec(text);
  if (!open) return -1;
  let position = open[0].length;
  if (position >= text.length || isBlank(text.slice(position, lineEnd(text, position)))) return -1;
  while (position <= text.length) {
    const end = lineEnd(text, position);
    if (/^(?:---|\.\.\.)[ \t]*$/.test(text.slice(position, end))) return end;
    if (end >= text.length) return -1;
    position = text.indexOf('\n', end) + 1;
    if (position === 0) return -1;
  }
  return -1;
}

/** `text[range]` with every character of `hidden` that falls on it replaced by a NUL. */
function masked(text: string, from: number, to: number, hidden: readonly Range[]): string {
  let line = text.slice(from, to);
  for (const range of hidden) {
    if (range.to <= from || range.from >= to) continue;
    const a = Math.max(range.from, from) - from;
    const b = Math.min(range.to, to) - from;
    line = line.slice(0, a) + '\0'.repeat(b - a) + line.slice(b);
  }
  return line;
}

/**
 * Whether the line that holds `position` follows lines of nothing but markers that start with a
 * bullet (`- <!--ins k3x9-->`, then `  <!--cmt c9qf-->`): the lines of one list item's first block,
 * where a blank line would make the list loose. `hidden` are the ranges of the markers.
 */
export function afterBullet(text: string, position: number, hidden: readonly Range[]): boolean {
  let start = lineStart(text, position);
  for (let lines = 0; lines < 100 && start > 0; lines++) {
    const before = lineStart(text, start - 1);
    const line = masked(text, before, lineEnd(text, before), hidden);
    const bare = line.replaceAll('\0', '');
    if (!line.includes('\0') || !CONTAINER_PREFIX.test(bare)) return false;
    if (ENDS_IN_BULLET.test(bare)) return true;
    start = before;
  }
  return false;
}

/**
 * Whether the line that starts at `first`, and the lines above it up to a blank line, are an item of
 * a list or the lines of one: a line among them starts with a bullet or a number.
 */
function inListFrom(text: string, first: number, hidden: readonly Range[]): boolean {
  let line = first;
  for (let lines = 0; lines < 100; lines++) {
    const bare = masked(text, line, lineEnd(text, line), hidden).replaceAll('\0', '');
    // A bullet with nothing but markers after it is an item, not a blank line: its text is on the
    // next line (format §3.3).
    if (HAS_BULLET.test(bare.slice(0, prefixLength(bare)))) return true;
    if (CONTAINER_PREFIX.test(bare)) return false;
    if (line === 0) return false;
    line = lineStart(text, line - 1);
  }
  return false;
}

/**
 * Whether the line (`whole`, from the line start `start`) starts a list item, and so a block, right
 * after a line of a paragraph. A bullet does. An ordered item interrupts a paragraph only when its
 * number is 1: `2024. That year` on a wrapped line is text, unless the lines above are a list, which
 * it goes on (CommonMark, list items).
 */
function startsList(text: string, start: number, whole: string, hidden: readonly Range[]): boolean {
  const marker = FIRST_MARKER.exec(whole);
  if (!marker) return false;
  if (marker[1] !== undefined || Number(marker[2]) === 1) return true;
  return start > 0 && inListFrom(text, lineStart(text, start - 1), hidden);
}

/** Where a position is in its line (see `lineStartKind`). */
export type LineStart =
  /** Not at the start of the line's content: text comes before it. */
  | 'inline'
  /** The first character of a block: a paragraph, a list item, a heading. */
  | 'block'
  /** The start of a wrapped line of a paragraph or an item. */
  | 'continuation'
  /** On a line that is only syntax, such as a setext underline or a table row. */
  | 'syntax';

/**
 * Whether `position` is at the start of its line's content, after the container prefix, and if so
 * whether a block starts there (a marker may stand alone on the line before it) or a wrapped line
 * of a paragraph (a marker may not start it). `hidden` are ranges of markers: a line made of
 * nothing else counts as blank, because the block that follows it starts there.
 */
export function lineStartKind(
  text: string,
  position: number,
  hidden: readonly Range[] = [],
): LineStart {
  const start = lineStart(text, position);
  const before = text.slice(start, position);
  if (!CONTAINER_PREFIX.test(before)) return 'inline';
  const rest = text.slice(position, lineEnd(text, position));
  const previous =
    start === 0 ? null : masked(text, lineStart(text, start - 1), lineEnd(text, start - 1), hidden);
  if (/^\|/.test(rest.trimStart())) return 'syntax';
  // A line with nothing but its prefix and markers has no text: the block that follows it starts.
  const blank = previous !== null && CONTAINER_PREFIX.test(previous.replaceAll('\0', ''));
  if (previous !== null && !blank && SETEXT_UNDERLINE.test(rest)) return 'syntax';
  if (previous === null || blank) return 'block';
  // A heading is one line: what follows it starts a block.
  if (/^[ \t>]*#{1,6}(?:[ \t]|\0|$)/.test(previous)) return 'block';
  if (startsList(text, start, before + rest, hidden) || BLOCK_SYNTAX.test(rest)) return 'block';
  const quotes = (line: string) => (line.slice(0, prefixLength(line)).match(/>/g) ?? []).length;
  // The quote markers of the line above as written: the carrier of an opener alone on the line
  // before it takes the prefix of that line, and masks it.
  const above = text.slice(lineStart(text, start - 1), lineEnd(text, start - 1));
  return quotes(before) > quotes(above) ? 'block' : 'continuation';
}

/** A line break between two lines, with the blank line and the prefix of the next line that go
 * with it (format §3.4). */
export interface Break {
  /** Where the line break starts: the end of the line before. */
  start: number;
  /** The first character of the next line's content, after its prefix. */
  end: number;
  /** The next line starts a block (after a blank line, or a list item, a quote, a heading), and
   * is not a wrapped line of the same paragraph. */
  block: boolean;
}

/**
 * The breaks that start between the line before the one that holds `from` and the end of `to`'s
 * line, in order. A line break inside a marker (the carrier of an opener) is no break.
 */
export function breaksBetween(
  text: string,
  from: number,
  to: number,
  hidden: readonly Range[] = [],
): Break[] {
  const breaks: Break[] = [];
  // Start at a line with text on it, so that a break is found from its first line break and not
  // from the second of a blank line's.
  let first = lineStart(text, Math.max(0, lineStart(text, from) - 1));
  while (first > 0 && isBlank(text.slice(first, lineEnd(text, first)).replace(/\r$/, ''))) {
    first = lineStart(text, first - 1);
  }
  let newline = text.indexOf('\n', first);
  while (newline !== -1) {
    const start = newline > 0 && text[newline - 1] === '\r' ? newline - 1 : newline;
    if (start > to) break;
    if (hidden.some((range) => range.from <= start && start < range.to)) {
      newline = text.indexOf('\n', newline + 1);
      continue;
    }
    const end = breakEnd(text, start);
    const next = lineStart(text, end);
    const content = next + prefixLength(text.slice(next, lineEnd(text, next)));
    const kind = lineStartKind(text, content, hidden);
    // The first row of a table starts a block too: after a blank line, or a heading, which is one.
    const row = /^\|/.test(text.slice(content, lineEnd(text, content)).trimStart());
    const apart =
      (text.slice(start, next).match(/\n/g) ?? []).length >= 2 ||
      /^[ \t>]*#{1,6}(?:[ \t]|$)/.test(text.slice(lineStart(text, start), start));
    breaks.push({ start, end, block: kind === 'block' || (kind === 'syntax' && row && apart) });
    newline = text.indexOf('\n', Math.max(end, newline + 1));
  }
  return breaks;
}

/** The white space that holds `at`: from the end of the text before it to the first character after
 * it, with the lines of text on either side. */
interface WhiteSpace {
  from: number;
  to: number;
  /** How many line breaks it holds. */
  breaks: number;
}

function whiteSpaceAt(text: string, at: number): WhiteSpace {
  let from = at;
  while (from > 0 && /[ \t\r\n]/.test(text[from - 1] ?? '')) from--;
  let to = at;
  while (to < text.length && /[ \t\r\n]/.test(text[to] ?? '')) to++;
  return { from, to, breaks: (text.slice(from, to).match(/\n/g) ?? []).length };
}

/**
 * Whether a blank line written at `at`, between two lines with no blank line between them, would
 * make a list loose, or part an item from a block inside it (format §3.4): the line before is in a
 * list, and the line after is an item or is indented as the content of one. Blank lines that are
 * there already change nothing, and nor do those between a paragraph and a list that follows it,
 * which is not an item of it. `hidden` are the ranges of markers.
 */
export function loosensList(text: string, at: number, hidden: readonly Range[] = []): boolean {
  const space = whiteSpaceAt(text, at);
  if (space.breaks !== 1 || space.from === 0 || space.to >= text.length) return false;
  const next = lineStart(text, space.to);
  const line = text.slice(next, lineEnd(text, next));
  const prefix = line.slice(0, prefixLength(line));
  const item = HAS_BULLET.test(prefix) || /^[ \t]/.test(prefix.replace(/^(?:>[ \t]?)+/, ''));
  return item && inListFrom(text, lineStart(text, space.from), hidden);
}

/**
 * Whether `at` is between two lines of indented code, or of the content of a list item that is
 * indented as much: both neighbours of the white space are indented by four spaces or a tab, after
 * the quote markers, and no item starts above them. Blank lines there are code.
 */
export function betweenIndentedCode(
  text: string,
  at: number,
  hidden: readonly Range[] = [],
): boolean {
  const space = whiteSpaceAt(text, at);
  if (space.from === 0 || space.to >= text.length) return false;
  const indented = (line: string) => /^(?: {4}|\t)/.test(line.replace(/^(?:[ \t]*>[ \t]?)+/, ''));
  const above = lineStart(text, space.from);
  const below = lineStart(text, space.to);
  return (
    indented(text.slice(above, lineEnd(text, above))) &&
    indented(text.slice(below, lineEnd(text, below))) &&
    !inListFrom(text, above, hidden)
  );
}

/**
 * A block from `top` (the start of its first line) to `end` (in its last line), with its edges: back
 * over the blank lines before it to the end of the block before it, and on over the blank lines
 * after it to the start of the block after it. A line break that a change adds or takes away in
 * that range decides what the block is and where it ends (format §2.6). A line of `>` alone is
 * blank, as a quote's blank lines are, and so, going back, is a line of nothing but markers, as of
 * the deletion of a whole block in front of this one: the break that comes before the deleted
 * block decides as much (`onlyMarkers`).
 */
export function blockEdges(text: string, top: number, end: number): Range {
  const blank = (from: number, to: number) => /^[ \t>]*\r?$/.test(text.slice(from, to));
  let from = top;
  while (from > 0) {
    const start = lineStart(text, from - 1);
    if (!blank(start, from - 1) && !onlyMarkers(text, start)) {
      from = lineEnd(text, start);
      break;
    }
    from = start;
  }
  let to = end;
  for (let newline = text.indexOf('\n', end); newline !== -1; newline = text.indexOf('\n', to)) {
    to = newline + 1;
    if (!blank(to, lineEnd(text, to))) break;
  }
  return { from, to };
}

/**
 * Whether the line that holds `position` has nothing on it but markers (and white space), as the
 * line of the deletion of a whole block, or of an opener that starts a block. A line break that a
 * change on such a line in front of a block holds is the deleted block's own, which goes with it,
 * and decides nothing about the block after it.
 */
export function onlyMarkers(text: string, position: number): boolean {
  const start = lineStart(text, position);
  // A marker's text holds no `-->`, so that a line of many markers is read in one pass.
  return /^[ \t>]*(?:<!--(?:[^-]|-(?!->))*-->[ \t]*)+\r?$/.test(
    text.slice(start, lineEnd(text, start)),
  );
}

/**
 * Where the lines right above `top` start that touch it, with no blank line between: the items of
 * a tight list above an item, a paragraph right above a list. `top` when the line above is blank.
 * A line break in them can decide how the lines down to the block read (`continuesList`).
 */
export function touchingAbove(text: string, top: number): number {
  const full = (start: number) => !/^[ \t>]*\r?$/.test(text.slice(start, lineEnd(text, start)));
  let from = top;
  while (from > 0 && full(lineStart(text, from - 1))) from = lineStart(text, from - 1);
  return from;
}

/**
 * The number of a numbered item that doesn't start at 1, and its delimiter, in the syntax of a
 * block (the container prefix of its line, or the old syntax that a block change keeps). Such an
 * item can't interrupt a paragraph: right after one it is text (`continuesList`). Any other block
 * starts a block, or a list, of its own there.
 */
export function numberedFromTwo(syntax: string): string | undefined {
  // Each `>` takes the white space after it with the next one, so that a long quote prefix with no
  // number is read in one pass.
  const number = /^(?:[ \t]*>)*[ \t]*(\d{1,9})([.)])/.exec(syntax);
  return number && Number(number[1]) !== 1 ? number[2] : undefined;
}

/** A line that starts a block of its own where a paragraph is open, so that it is no lazy line:
 * a heading, a fence, a thematic break or an underline, or an HTML block. */
const INTERRUPTS = /^ {0,3}(?:#{1,6}(?:[ \t]|$)|`{3,}|~{3,}|(?:[-*_=][ \t]*){3,}$|=+[ \t]*$|<)/;

/** A list item's start: its indentation, the marker, the spaces after it, and a box. */
const ITEM_START = /^([ \t]*)([-*+]|\d{1,9}[.)])(?:([ \t]+)(?:\[[ xX]\][ \t]+)?|$)/;

/** How many columns of white space a line starts with: a tab goes to the next stop of four. */
export function indentColumns(line: string): number {
  let column = 0;
  for (const char of /^[ \t]*/.exec(line)?.[0] ?? '') {
    column = char === '\t' ? column + 4 - (column % 4) : column + 1;
  }
  return column;
}

/** How long the prefix of a line of a view is: a list item's indentation, marker, spaces and box,
 * or the line's indentation. */
export function listPrefixLength(line: string): number {
  return ITEM_START.exec(line)?.[0].length ?? /^[ \t]*/.exec(line)?.[0].length ?? 0;
}

/** A stretch of text without its markers, read in one pass: an opener with no `-->` after it, and
 * what follows it, are kept. */
export function withoutMarkers(text: string): string {
  let kept = '';
  let at = 0;
  for (;;) {
    const open = text.indexOf('<!--', at);
    const close = open < 0 ? -1 : text.indexOf('-->', open + 4);
    if (close < 0) return kept + text.slice(at);
    kept += text.slice(at, open);
    at = close + 3;
  }
}

/**
 * What a line of a view is to the reading of a list (`listStep`): its prefix, whether it is a
 * quote's, starts a block that interrupts a paragraph, or a fence, and whether its text is empty or
 * starts a heading. Words typed or taken out after the start of its text leave it as it is.
 */
export function lineKind(line: string): string {
  const item = ITEM_START.exec(line);
  const rest = item ? line.slice(item[0].length).trim() : line.trim();
  return JSON.stringify([
    item ? [item[1], item[2], item[3]] : /^[ \t]*/.exec(line)?.[0],
    /^[ \t]*>/.test(line),
    INTERRUPTS.test(line),
    rest === '',
    /^(?:#{1,6}(?:[ \t]|$)|`{3,}|~{3,})/.test(rest),
  ]);
}

/**
 * Where a numbered list stands, read line by line down to a numbered item that doesn't start at 1:
 * whether a list of the item's indentation is open, and where the open item's content starts;
 * whether a paragraph of the lines' own is open, which such an item can't interrupt (an empty item
 * has none, and takes no lazy line); and whether one is open in an item of another list, which a
 * lazy line goes on with but any item breaks out of.
 */
export interface ListState {
  list: boolean;
  paragraph: boolean;
  inner: boolean;
  column: number;
  /** The open item started empty, and nothing of it has come yet: a blank line ends it. */
  fresh: boolean;
  /** The last block is code, which blank lines go on with. */
  code: boolean;
}

/** The state at the top of the lines that touch an item, after a blank line. */
export const LIST_START: ListState = {
  list: false,
  paragraph: false,
  inner: false,
  column: 0,
  fresh: false,
  code: false,
};

/**
 * The state after one more line, `text`, read for a numbered item with `delimiter` at indentation
 * `own`. Undefined for a fence or an HTML block outside the item: the item is taken to be text after
 * it.
 */
export function listStep(
  state: ListState,
  text: string,
  own: number,
  delimiter: string,
): ListState | undefined {
  const indent = indentColumns(text);
  // A blank line: the list stays open, with no paragraph. A line indented to the item after it is
  // more of the item, as its next paragraph; an unindented one ends the list.
  if (text.trim() === '') {
    // An item that started empty takes nothing after a blank line; code goes on over it.
    const column = state.fresh ? Number.MAX_SAFE_INTEGER : state.column;
    return { ...state, paragraph: state.code, inner: false, column, fresh: false };
  }
  const item = ITEM_START.exec(text);
  const rest = item ? text.slice(item[0].length).trim() : text.trim();
  const opens = rest !== '' && !/^(?:#{1,6}(?:[ \t]|$)|`{3,}|~{3,})/.test(rest);
  // A line of the open item, and an item under it.
  if (state.list && indent >= state.column) {
    return { ...state, paragraph: opens, inner: false, fresh: false, code: false };
  }
  // Four columns of white space past the item's own: code, or more of an open paragraph, which
  // code can't interrupt.
  const deep = indent - own >= 4;
  // The line without the item's own indentation, as far as it has it.
  let cut = 0;
  for (let column = 0; cut < text.length && column < own; cut++) {
    const char = text[cut];
    if (char === ' ') column++;
    else if (char === '\t') column += 4 - (column % 4);
    else break;
  }
  const local = text.slice(cut);
  if (!deep && local.trimStart().startsWith('>')) {
    // A quote, a block of its own that interrupts a paragraph: a lazy line after it goes on with
    // the paragraph in it, and any item breaks out of it.
    let inside = local;
    while (inside.trimStart().startsWith('>'))
      inside = inside
        .trimStart()
        .slice(1)
        .replace(/^[ \t]/, '');
    const words = inside.trim();
    const quoted =
      words !== '' &&
      !/^(?:#{1,6}(?:[ \t]|$)|`{3,}|~{3,})/.test(words) &&
      !/^(?:[-*_][ \t]*){3,}$/.test(words);
    return {
      list: false,
      paragraph: false,
      inner: quoted,
      column: state.column,
      fresh: false,
      code: false,
    };
  }
  if (item && !deep) {
    const marker = item[2] ?? '';
    const spaces = item[3]?.length ?? 1;
    const fromTwo = /\d/.test(marker) && !/^1\D/.test(marker);
    if (indent === own && /\d/.test(marker) && marker.at(-1) === delimiter) {
      // An item of the list, or one that starts it: from 2 or empty, not after a paragraph of the
      // lines' own.
      if (!state.list && state.paragraph && (fromTwo || rest === '')) return state;
      const column = indent + marker.length + (spaces > 4 ? 1 : spaces);
      return {
        list: true,
        paragraph: opens,
        inner: false,
        column,
        fresh: rest === '',
        code: false,
      };
    }
    // An item that can't interrupt a paragraph of the lines' own, an empty one or one numbered from
    // 2, is more of it. Any other item, as one under a paragraph in an item it breaks out of,
    // starts or goes on with another list, and its paragraph is that item's.
    if (!state.list && !state.inner && state.paragraph && (rest === '' || fromTwo)) return state;
    return { ...state, list: false, paragraph: false, inner: opens, fresh: false, code: false };
  }
  // A fence outside the item: what follows it is code, up to a fence that may not come.
  if (!deep && /^ {0,3}(?:`{3,}|~{3,})/.test(local)) return undefined;
  // A lazy line of an open paragraph; not one that starts a block of its own, which interrupts the
  // paragraph and ends the list: a heading, a fence, a thematic break, an HTML block, or a line
  // that would make the paragraph a heading.
  if ((state.paragraph || state.inner) && (deep || !INTERRUPTS.test(local))) {
    return deep || !state.code ? state : { ...state, code: false };
  }
  // An HTML block, which goes on to a blank line: the item is taken to be text after it.
  if (!deep && /^ {0,3}</.test(local)) return undefined;
  // A line at the list's column that nothing holds: a paragraph, or a heading or a thematic break,
  // which are none; or code, after which a numbered item from 2 is text, as after a paragraph.
  const rule = /^ {0,3}(?:[-*_][ \t]*){3,}$/.test(local);
  return {
    list: false,
    paragraph: deep || (opens && !rule),
    inner: false,
    column: state.column,
    fresh: false,
    code: deep,
  };
}

/** Whether a numbered item from 2 is read as an item after `state`: it goes on with an open list,
 * or starts one where no paragraph is open. */
export function listGoesOn(state: ListState): boolean {
  return state.list || !state.paragraph;
}

/**
 * Whether a numbered item that doesn't start at 1, with `delimiter`, on the line of `view` that
 * starts at `at`, is read as an item: the lines right above it that touch it are read from the
 * blank line before them (or before an item they are more of), and the item goes on with a
 * numbered list of its indentation open there, or starts one where no paragraph is open. It is text after a paragraph line: one outside a list,
 * one that an empty item can't hold, one after an item of a bulleted list or of a parent list. A
 * quote is taken to be text.
 */
export function continuesList(view: string, at: number, delimiter: string): boolean {
  const lineAt = (start: number) => view.slice(start, lineEnd(view, start));
  const indentAt = (start: number) => indentColumns(lineAt(start));
  const own = indentAt(at);
  // From the blank line before them, or before that where an indented line, more of an item
  // above, follows it, or where code comes before it, which a numbered item from 2 can't follow.
  let first = touchingAbove(view, at);
  for (;;) {
    let gap = first;
    while (gap > 0 && /^[ \t>]*\r?$/.test(lineAt(lineStart(view, gap - 1)))) {
      gap = lineStart(view, gap - 1);
    }
    const above = lineStart(view, gap - 1);
    if (gap === 0 || gap === first || (indentAt(first) <= own && indentAt(above) - own < 4)) break;
    first = touchingAbove(view, above);
  }
  let state: ListState | undefined = LIST_START;
  for (let line = first; line < at; line = nextLineStart(view, line)) {
    state = listStep(state, lineAt(line), own, delimiter);
    if (!state) return false;
  }
  return listGoesOn(state);
}

/**
 * Where a pending change holds a line break as a view reads it, in offsets of `text`: a visible
 * line break of an insertion's or a substitution's new text in the newest view, the opener of a
 * deletion or a substitution whose old text has one, and the break after a split. A line break
 * that only carries a marker is in no view, and is not one. `newest` is `newestView(text)`.
 */
export function viewBreaks(text: string, mark: MarkRange, newest: DocView): number[] {
  const breaks: number[] = [];
  const shown = (at: number) => newest.map.fromSource(at + 1) === newest.map.fromSource(at) + 1;
  for (const segment of mark.segments) {
    if (mark.kind === 'split') breaks.push(segment.open.to);
    if ((mark.kind === 'del' || mark.kind === 'sub') && (segment.payload ?? '').includes('\n')) {
      breaks.push(segment.open.from);
    }
    if ((mark.kind === 'ins' || mark.kind === 'sub') && segment.close) {
      for (let at = segment.open.to; at < segment.close.from; at++) {
        if (text[at] === '\n' && shown(at)) breaks.push(at);
      }
    }
  }
  return breaks;
}
