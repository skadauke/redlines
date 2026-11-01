// The lines and blocks of a Markdown file, as far as marker placement needs them (format §3.2 to
// §3.4, §3.8): what a line's container prefix is, whether a position starts a block or only a
// wrapped line, the form of a mark that starts a block (the opener alone on the line before it),
// the break that a `split` stands for, and where front matter ends. This is not a Markdown
// parser: it knows prefixes, bullets, quotes, ATX headings, fences, rules and table rows.

import type { Range, Segment } from './types.ts';

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
  return quotes(before) > quotes(previous) ? 'block' : 'continuation';
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
