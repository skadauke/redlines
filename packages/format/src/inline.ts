// Where a marker may go in a line (format §3.1, §3.2): which constructs take no marker inside them,
// which positions would change how emphasis flanks, and which line starts a marker may not stand
// at. This is not a Markdown parser: it finds links, images, autolinks, entities, tags, escapes and
// the other constructs the rules name, in the visible text of one paragraph, and no more.

import { isBodyStart, lineEnd, lineStart, lineStartKind, prefixLength } from './blocks.ts';
import { SHORTCODE_SOURCE, shortcodeAt } from './shortcode.ts';
import { isTableRowAt } from './table-rules.ts';
import type { Range } from './types.ts';

/** What `inspectPlace` finds about a position. */
export type Place =
  | { kind: 'ok' }
  /** The first character of a block: the opener of a mark goes alone on the line before it
   * (format §3.3). */
  | { kind: 'block' }
  /** The start of a wrapped line of a paragraph or an item, where no marker may stand
   * (format §3.2). */
  | { kind: 'continuation' }
  /** Inside a construct that takes no marker: `[from, to]` is all of it, in the offsets of the
   * text. A change there replaces the whole construct (format §3.5). */
  | { kind: 'construct'; from: number; to: number }
  /** Next to a delimiter whose flanking a marker would change. One character further it is fine. */
  | { kind: 'flank' }
  /** There is no place for a marker here; `reason` says why. `backslash` is where the backslash
   * stands that a marker would be right after, at the end of a line: a change that takes the
   * backslash in goes in front of it instead (format §3.1). `trailing` is where the trailing
   * spaces of a hard break start, which a marker may not be among or behind: it goes in front of
   * them, or the change goes on past the line break. */
  | { kind: 'refuse'; reason: string; backslash?: number; trailing?: number };

/** The text next to a marker, when it is not the text of the paragraph on either side of the
 * position: what is written before a closer, or after an opener. */
export interface Around {
  before?: string;
  after?: string;
  /** The marker comes right after text that is written with it, so that it does not stand at the
   * start of its line, whatever the old text has there. */
  joined?: boolean;
}

/** The text of a paragraph without the markers, and where each character of it is in the file. */
export interface Paragraph {
  text: string;
  /** For each character, its offset in the file; one more for the end. */
  offsets: number[];
}

const BLANK = /^[ \t>]*$/;

/** The refusal of a marker on a line that is only Markdown syntax: a fence, a rule, a bullet. */
export const SYNTAX_ONLY = 'A line that is only Markdown syntax takes no change.';

export function visible(
  text: string,
  hidden: readonly Range[],
  from: number,
  to: number,
): Paragraph {
  let result = '';
  const offsets: number[] = [];
  let cursor = from;
  const add = (end: number) => {
    for (; cursor < end; cursor++) {
      result += text[cursor];
      offsets.push(cursor);
    }
  };
  for (const range of hidden) {
    if (range.to <= cursor) continue;
    if (range.from >= to) break;
    add(Math.max(range.from, cursor));
    cursor = Math.max(cursor, Math.min(range.to, to));
  }
  add(to);
  offsets.push(to);
  return { text: result, offsets };
}

/** The lines of the paragraph that holds `position`, as a range of the file. */
export function paragraphRange(text: string, hidden: readonly Range[], position: number): Range {
  const startsBlock = (start: number) => {
    const content = start + prefixLength(text.slice(start, lineEnd(text, start)));
    const kind = lineStartKind(text, content, hidden);
    return kind === 'block' || kind === 'syntax';
  };
  const isBlank = (start: number) =>
    BLANK.test(visible(text, hidden, start, lineEnd(text, start)).text.replace(/\r$/, ''));
  let from = lineStart(text, position);
  for (let lines = 0; lines < 300 && from > 0 && !startsBlock(from); lines++) {
    const before = lineStart(text, from - 1);
    if (isBlank(before)) break;
    from = before;
  }
  let to = lineEnd(text, position);
  for (let lines = 0; lines < 300 && to < text.length; lines++) {
    const next = text.indexOf('\n', to) + 1;
    if (next === 0 || next >= text.length) break;
    if (isBlank(next) || startsBlock(next)) break;
    to = lineEnd(text, next);
  }
  return { from, to };
}

/** A stretch where no marker may go: the positions `lo` to `hi`, and the construct `[from, to]`.
 * `kind` says what a reader of emphasis and links needs to know of it: a `symbol`, such as an entity,
 * reads as another character than it is written with. A link and a full reference link have `text`,
 * between their brackets, which takes marks, and `dest`, the rest between the parentheses or the
 * second brackets. */
export interface Hit {
  lo: number;
  hi: number;
  from: number;
  to: number;
  refuse?: string;
  /** The refusal is a marker right after a backslash at the end of a line. */
  backslash?: boolean;
  kind?:
    | 'symbol'
    /** An emoji of several code points, or outside the first plane: no marker goes in it, and it
     * reads as the character it is. */
    | 'emoji'
    | 'footnote'
    | 'url'
    | 'autolink'
    | 'tag'
    | 'escape'
    | 'link'
    | 'reference'
    | 'image'
    | 'comment'
    | 'alert';
  text?: Range;
  dest?: Range;
  /** The alt text of an image. */
  alt?: Range;
}

const ENTITY = /&(?:[A-Za-z][A-Za-z0-9]{1,31}|#\d{1,7}|#[xX][0-9a-fA-F]{1,6});/g;
const AUTOLINK =
  /<(?:[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*|[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*)>/g;
const TAG =
  /<\/?[A-Za-z][A-Za-z0-9-]*(?:\s+[A-Za-z_:][\w:.-]*(?:\s*=\s*(?:[^\s"'=<>`]+|'[^']*'|"[^"]*"))?)*\s*\/?>/g;
const BARE_URL = /(?:https?|ftp):\/\/[^\s<]+/g;
const WWW = /(?<![\w.])www\.[^\s<]+/g;
const EMAIL = /[A-Za-z0-9._+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const FOOTNOTE = /\[\^[^\]\s]+\]/g;
const MATH = /(?<![\\$])\$(?=\S)[^$\n]*?(?<=[^\s\\$])\$(?![\d$])|(?<![\\$])\$[^\s$\\]\$(?![\d$])/g;
const SHORTCODE = new RegExp(SHORTCODE_SOURCE, 'g');

/** A skin tone or a variation selector, which a picture takes after it. */
const TONE = '(?:[\\u{1F3FB}-\\u{1F3FF}]|\\uFE0F)';

/**
 * An emoji that is more than one code point (#312): a flag, a keycap, a ZWJ sequence such as a family,
 * a picture with a skin tone or a variation selector, and the flag of a subdivision. Each is one
 * character to a reader, which no marker may part. A picture of one code point outside the first
 * plane is two UTF-16 units, which no marker may part either.
 */
const EMOJI = new RegExp(
  [
    '\\p{Regional_Indicator}{2}',
    '[#*0-9]\\uFE0F?\\u20E3',
    '\\p{Extended_Pictographic}[\\u{E0020}-\\u{E007E}]+\\u{E007F}',
    `\\p{Extended_Pictographic}${TONE}*(?:\\u200D\\p{Extended_Pictographic}${TONE}*)+`,
    `\\p{Extended_Pictographic}${TONE}+`,
    '[\\u{10000}-\\u{10FFFF}]',
  ].join('|'),
  'gu',
);
/** What an emoji has that other text has not: a surrogate, a variation selector, a joiner or the
 * combining keycap. */
const MAY_BE_EMOJI = /[\ud800-\udfff]|\u200d|\ufe0f|\u20e3/;
/** What a change is told that would leave a shortcode at the start of a text with a letter before it. */
const STUCK_SHORTCODE =
  'A marker between a letter and an emoji shortcode would make it show as an emoji. Select the shortcode along with the word.';
const ATTRIBUTES = /\{\{<[^\n]*?>\}\}|\{[#.][^{}\n]*\}/g;
/** The type of an alert at the start of a quote's line; the word is `ALERT_LINE`'s (callout.ts). */
const ALERT = /^[ \t>]*\[![A-Za-z][A-Za-z0-9-]*\]/gm;

/** The end of a URL in running text: GitHub leaves out the punctuation that ends a sentence, and
 * a closing parenthesis that has no opening one. */
function trimUrl(url: string): string {
  const count = (s: string, c: string) => s.split(c).length - 1;
  let end = url.length;
  for (;;) {
    const last = url[end - 1];
    const so_far = url.slice(0, end);
    if (last !== undefined && '?!.,:;*_~\'"'.includes(last)) end--;
    else if (last === ')' && count(so_far, '(') < count(so_far, ')')) end--;
    else break;
  }
  return url.slice(0, end);
}

/** Whether the character at `index` is escaped: an odd number of backslashes come before it. */
function isEscaped(text: string, index: number): boolean {
  let backslashes = 0;
  while (index - 1 - backslashes >= 0 && text[index - 1 - backslashes] === '\\') backslashes++;
  return backslashes % 2 === 1;
}

/** The text with the inside of every code span replaced by `x`, so that nothing in it is read. */
function maskCode(text: string): { masked: string; code: Range[] } {
  const code: Range[] = [];
  let masked = text;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\') {
      i++;
      continue;
    }
    if (text[i] !== '`') continue;
    let run = 1;
    while (text[i + run] === '`') run++;
    const close = new RegExp(`(?<!\`)\`{${run}}(?!\`)`, 'g');
    close.lastIndex = i + run;
    const found = close.exec(text);
    if (!found) {
      i += run - 1;
      continue;
    }
    const end = found.index + run;
    masked = masked.slice(0, i) + text.slice(i, end).replace(/[^\n]/g, 'x') + masked.slice(end);
    code.push({ from: i, to: end });
    i = end - 1;
  }
  return { masked, code };
}

/** The `)` that closes the `(` at `open`, after a link destination and a title, or -1. */
function closeParen(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '\\') i++;
    else if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return i;
    } else if (c === '<' && /^\(\s*$/.test(text.slice(open, i + 1).slice(0, -1))) {
      const end = text.indexOf('>', i);
      if (end === -1) return -1;
      i = end;
    } else if ((c === '"' || c === "'") && /\s/.test(text[i - 1] ?? '')) {
      let j = i + 1;
      while (j < text.length && text[j] !== c) j += text[j] === '\\' ? 2 : 1;
      if (j >= text.length) return -1;
      i = j;
    } else if (c === '\n' && /^[ \t>]*\n/.test(text.slice(i + 1))) return -1;
  }
  return -1;
}

/** The labels of the file read last: the paragraphs of a file are read one after another. */
let lastLabels: { text: string; labels: Set<string> } | undefined;

/** The labels of the link reference definitions in the file, in the form that links use. */
export function definedLabels(text: string): ReadonlySet<string> {
  if (lastLabels?.text === text) return lastLabels.labels;
  const labels = new Set<string>();
  for (const match of text.matchAll(/^[ \t]{0,3}\[((?:[^\]\\]|\\.)+)\]:/gm)) {
    labels.add(normalizeLabel(match[1] ?? ''));
  }
  lastLabels = { text, labels };
  return labels;
}

function normalizeLabel(label: string): string {
  return label.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Everything in the paragraph that takes no marker inside it. `v` is its visible text. */
export function hitsIn(v: string, file: string): { hits: Hit[]; code: Range[] } {
  const { masked: w, code } = maskCode(v);
  const hits: Hit[] = [];
  const inside = (from: number, to: number, kind?: Hit['kind']) => {
    const hit: Hit = { lo: from + 1, hi: to - 1, from, to };
    if (kind !== undefined) hit.kind = kind;
    hits.push(hit);
  };
  for (const m of w.matchAll(AUTOLINK)) inside(m.index, m.index + m[0].length, 'autolink');
  // A `<` that a backslash escapes starts no tag: the tag's text is text.
  for (const m of w.matchAll(TAG)) {
    if (!isEscaped(w, m.index)) inside(m.index, m.index + m[0].length, 'tag');
  }
  for (const m of w.matchAll(FOOTNOTE)) inside(m.index, m.index + m[0].length, 'footnote');
  // A shortcode has a colon, and an emoji has a surrogate, a variation selector, a joiner or a
  // keycap: the keystroke's cost is the same for the text that has none.
  const symbols = [ENTITY, MATH, ATTRIBUTES];
  if (w.includes(':')) symbols.push(SHORTCODE);
  for (const re of symbols) {
    for (const m of w.matchAll(re)) inside(m.index, m.index + m[0].length, 'symbol');
  }
  if (MAY_BE_EMOJI.test(w)) {
    for (const m of w.matchAll(EMOJI)) inside(m.index, m.index + m[0].length, 'emoji');
  }
  for (const m of w.matchAll(BARE_URL)) inside(m.index, m.index + trimUrl(m[0]).length, 'url');
  for (const m of w.matchAll(EMAIL)) {
    inside(m.index, m.index + m[0].replace(/[.\-_]+$/, '').length, 'url');
  }
  for (const m of w.matchAll(WWW)) {
    const end = m.index + trimUrl(m[0]).length;
    inside(m.index, end, 'url');
    // Nothing may stand directly before www. either: it must follow a space or a delimiter.
    hits.push({
      lo: m.index,
      hi: m.index,
      from: m.index,
      to: end,
      refuse: 'A marker directly before www. would stop it from being a link.',
    });
  }
  for (const m of w.matchAll(ALERT)) {
    const open = m.index + m[0].indexOf('[');
    const end = m.index + m[0].length;
    hits.push({
      lo: open,
      hi: end - 1,
      from: open,
      to: end,
      kind: 'alert',
      refuse:
        "This is an alert's type: a change can't start in it or before it. Choose another type from the alert's menu, or edit the text of the alert.",
    });
  }
  // Escapes: a backslash and the character it escapes. A backslash before a marker escapes it.
  for (let i = 0; i < w.length; i++) {
    if (w[i] !== '\\') continue;
    if (i + 1 < w.length && w[i + 1] !== '\n') {
      hits.push({ lo: i + 1, hi: i + 1, from: i, to: i + 2, kind: 'escape' });
      i++;
    } else {
      hits.push({
        lo: i + 1,
        hi: i + 1,
        from: i,
        to: i + 1,
        refuse: 'A marker after a backslash at the end of a line would escape it.',
        backslash: true,
      });
    }
  }
  // Brackets: links, images and references.
  let labels: ReadonlySet<string> | undefined;
  const stack: number[] = [];
  for (let i = 0; i < w.length; i++) {
    const c = w[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (c === '[') stack.push(i);
    if (c !== ']') continue;
    const open = stack.pop();
    if (open === undefined) continue;
    const label = w.slice(open + 1, i);
    if (w[i + 1] === '(') {
      const end = closeParen(w, i + 1);
      if (end === -1) continue;
      if (open > 0 && w[open - 1] === '!' && !isEscaped(w, open - 1)) {
        hits.push({
          lo: open,
          hi: end,
          from: open - 1,
          to: end + 1,
          kind: 'image',
          alt: { from: open + 1, to: i },
        });
      } else {
        hits.push({
          lo: i + 1,
          hi: end,
          from: open,
          to: end + 1,
          kind: 'link',
          text: { from: open + 1, to: i },
          dest: { from: i + 2, to: end },
        });
      }
    } else if (label[0] !== '^') {
      labels ??= definedLabels(file);
      if (w[i + 1] === '[') {
        const close = w.indexOf(']', i + 2);
        if (close === -1) continue;
        const named = w.slice(i + 2, close);
        if (!labels.has(normalizeLabel(named === '' ? label : named))) continue;
        if (named === '') inside(open, close + 1, 'reference');
        else {
          hits.push({
            lo: i + 1,
            hi: close,
            from: open,
            to: close + 1,
            kind: 'reference',
            text: { from: open + 1, to: i },
            dest: { from: i + 2, to: close },
          });
        }
      } else if (labels.has(normalizeLabel(label))) inside(open, i + 1, 'reference');
    }
  }
  return { hits, code };
}

export const isWord = (c: string | undefined): boolean =>
  c !== undefined && /[\p{L}\p{N}]/u.test(c);

const isDelimiter = (c: string | undefined): boolean => c === '*' || c === '~' || c === '_';

/** How far from a marker the characters are looked at. */
const WINDOW = 16;

/** The characters before `index` in one line, as code points: the last is the nearest. */
function charsBefore(v: string, index: number): string[] {
  const start = Math.max(v.lastIndexOf('\n', index - 1) + 1, index - 2 * WINDOW);
  return [...v.slice(start, index)].slice(-WINDOW);
}

/** The characters after `index` in one line, as code points: the first is the nearest. */
function charsAfter(v: string, index: number): string[] {
  const newline = v.indexOf('\n', index);
  const end = Math.min(newline === -1 ? v.length : newline, index + 2 * WINDOW);
  return [...v.slice(index, end)].slice(0, WINDOW);
}

/**
 * Whether a marker would change how an emphasis delimiter next to it flanks (format §3.1, rule 5):
 * one in the middle of a run of delimiters cuts it in two; on the inner side of `*` or `~`, where
 * the run has a letter or digit on its outer side, it stops the run from being a delimiter; next to
 * a `_` that has a letter or digit on its other side, the same. `around` gives the text next to
 * the marker where it is not that of the paragraph.
 */
function changesFlanking(v: string, index: number, around: Around): boolean {
  const left =
    around.before !== undefined ? [...around.before].slice(-WINDOW) : charsBefore(v, index);
  const right =
    around.after !== undefined ? [...around.after].slice(0, WINDOW) : charsAfter(v, index);
  const last = left.at(-1);
  const first = right[0];
  if (isDelimiter(last) && last === first) return true;
  if (isDelimiter(last)) {
    let at = left.length - 1;
    while (at > 0 && left[at - 1] === last) at--;
    const outer = at > 0 ? left[at - 1] : undefined;
    if (last === '_' ? isWord(outer) : isWord(first) && isWord(outer)) return true;
  }
  if (isDelimiter(first)) {
    let at = 0;
    while (at < right.length - 1 && right[at + 1] === first) at++;
    const outer = right[at + 1];
    if (first === '_' ? isWord(outer) : isWord(last) && isWord(outer)) return true;
  }
  return false;
}

/** The line under the header of a table, without the need for a `|` that it has to have. */
export const DELIMITER_ROW = /^[ \t>]*\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;

/** A line that is only syntax: a thematic break, a setext underline, a table delimiter row or a
 * fence (format §3.1, rule 7). */
export function isSyntaxLine(line: string, hasTextAbove: boolean): boolean {
  return (
    /^[ \t>]*(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(line) ||
    (hasTextAbove && /^[ \t>]*(?:=+|-+)[ \t]*$/.test(line)) ||
    (line.includes('|') && DELIMITER_ROW.test(line)) ||
    /^[ \t>]*(?:`{3,}|~{3,})/.test(line)
  );
}

/** The quote markers at the start of a line, and what follows them. */
const QUOTES = /^((?:[ \t]{0,3}>[ \t]?)*)(.*)$/;
/** A list item's marker at the start of a line's text, with its indentation and the spaces after. */
const ITEM_START = /^([ \t]*)(?:[-*+]|\d{1,9}[.)])([ \t]+|$)/;

/**
 * Whether `line`, under `above`, is outside the container of the paragraph that `above` is a line
 * of, so that it could only be a lazy line of it: it has fewer quote markers, or `above` starts a
 * list item whose text starts to the right of where `line`'s text does. A setext underline can't be
 * a lazy line (CommonMark).
 */
function lazyUnder(above: string, line: string): boolean {
  const [, aboveQuotes = '', aboveRest = ''] = QUOTES.exec(above) ?? [];
  const [, lineQuotes = '', lineRest = ''] = QUOTES.exec(line) ?? [];
  const depth = (quotes: string) => quotes.split('>').length - 1;
  if (depth(lineQuotes) < depth(aboveQuotes)) return true;
  if (depth(lineQuotes) > depth(aboveQuotes)) return false;
  const item = ITEM_START.exec(aboveRest);
  if (!item) return false;
  const column = item[0].length;
  const indent = /^[ \t]*/.exec(lineRest)?.[0].length ?? 0;
  return indent < column;
}

/**
 * Whether a line can be underlined as the text of a setext heading: words, not a blank line nor the
 * syntax of another block (a heading, a thematic break, a fence, HTML, a table row, a definition).
 */
export function textLike(line: string): boolean {
  const rest = line.replace(/^(?:[ \t]*(?:>|[-*+](?=[ \t])|\d{1,9}[.)](?=[ \t])))*[ \t]*/, '');
  return (
    rest !== '' &&
    !/^(?:#{1,6}(?:[ \t]|$)|(?:[-*_=][ \t]*){2,}$|`{3,}|~{3,}|<|\||\[[^\]]*\]:)/.test(rest)
  );
}

/**
 * Whether `line` is a bullet with nothing after it that reads as the setext underline of the text
 * in `above`, the line over it: an empty item can't interrupt a paragraph, and an underline is no
 * lazy line (#143).
 */
export function underliningBullet(above: string, line: string): boolean {
  return /^[ \t>]*-[ \t]*$/.test(line) && textLike(above) && !lazyUnder(above, line);
}

/**
 * Whether a split's marker starts on the line of `text` that `position` is on, after a bullet and
 * the white space after it (`-<marker>` is no item: its dash is text of the paragraph).
 */
function splitOnLine(text: string, hidden: readonly Range[], position: number): boolean {
  const from = lineStart(text, position);
  const to = lineEnd(text, position);
  if (!/^[ \t>]*-[ \t]+<!--/.test(text.slice(from, to))) return false;
  return hidden.some(
    (range) => range.from >= from && range.from <= to && text.startsWith('<!--split ', range.from),
  );
}

/**
 * What the rules of format §3.1 to §3.3 say about a marker at `position` of `text`. `hidden` are the
 * ranges of the markers that are in the text: they are not looked at, and a line made of nothing
 * else is a blank line. `around` gives the characters next to the marker when they are not those
 * of the text.
 */
export function inspectPlace(
  text: string,
  hidden: readonly Range[],
  position: number,
  around: Around = {},
): Place {
  const range = paragraphRange(text, hidden, position);
  const paragraph = visible(text, hidden, range.from, range.to);
  const v = paragraph.text;
  // The position in the visible text: before any marker that stands there.
  let index = paragraph.offsets.findIndex((offset) => offset >= position);
  if (index === -1) index = v.length;
  const offsetAt = (i: number) =>
    paragraph.offsets[Math.min(i, paragraph.offsets.length - 1)] ?? position;

  const start = v.lastIndexOf('\n', index - 1) + 1;
  const newline = v.indexOf('\n', index);
  const lineText = v.slice(start, newline === -1 ? v.length : newline).replace(/\r$/, '');
  const column = index - start;

  // The first line of the body has no line above it, after front matter too (format §3.8).
  const first = isBodyStart(text, range.from);
  const above = first
    ? ''
    : visible(text, hidden, lineStart(text, range.from - 1), lineEnd(text, range.from - 1)).text;
  const hasTextAbove = start > 0 || !BLANK.test(above.replace(/\r$/, ''));
  // A setext underline is a line of the paragraph above, in its container: under a list item's
  // line and left of its text, or with fewer quote markers, `-` is a lazy line, which no underline
  // can be, such as the bullet of the next item (#143).
  const lineAbove = start > 0 ? v.slice(v.lastIndexOf('\n', start - 2) + 1, start - 1) : above;
  const underlines = hasTextAbove && !lazyUnder(lineAbove.replace(/\r$/, ''), lineText);
  // A bullet that a split's marker stands on is an item in the file, whose first line is the marker,
  // wherever the view reads the bullet as the underline of the text above it: an empty item can't
  // interrupt a paragraph. An opener written beside the split's marker, for typed text (the caller
  // gives the text after it), changes neither reading; a comment or a highlight, which has no text
  // to write there, would stand on a line that the view reads as an underline, and stays refused
  // (#143).
  const ofSplit =
    around.after !== undefined &&
    /^[ \t>]*-[ \t]*$/.test(lineText) &&
    splitOnLine(text, hidden, position);
  // A row of a table whose cells are all dashes is a row, not the delimiter row (format §3.7).
  if (
    !around.joined &&
    !ofSplit &&
    isSyntaxLine(lineText, underlines && !(first && start === 0)) &&
    !isTableRowAt(text, position)
  ) {
    return { kind: 'refuse', reason: SYNTAX_ONLY };
  }
  const prefix = prefixLength(lineText);
  const heading = /^#{1,6}[ \t]+/.exec(lineText.slice(prefix))?.[0].length ?? 0;
  if (column < prefix + heading && !around.joined) {
    return {
      kind: 'refuse',
      reason:
        "A marker can't go in a line's indentation, or in front of or inside its list marker, quote marker or heading #s.",
    };
  }
  if (heading > 0) {
    // Nothing goes after a heading's text: its closing #s and its attributes come next.
    const tail = /^(#{1,6}[ \t]+)(.*?)((?:[ \t]+#+)?(?:[ \t]*\{[^{}]*\})?)[ \t]*$/.exec(
      lineText.slice(prefix),
    );
    const tailStart = prefix + (tail?.[1]?.length ?? 0) + (tail?.[2]?.length ?? 0);
    if ((tail?.[3]?.length ?? 0) > 0 && column > tailStart) {
      return { kind: 'refuse', reason: "A heading's closing #s and attributes take no change." };
    }
  }

  const { hits, code } = hitsIn(v, text);
  if (code.some((c) => c.from < index && index < c.to)) return { kind: 'ok' };
  let widest: Hit | undefined;
  for (const hit of hits) {
    if (index < hit.lo || index > hit.hi) continue;
    if (hit.refuse !== undefined) {
      // A closer after text that is written with it: the old text before it is the text that the
      // change replaces, and a backslash right before the closer is for the caller to see, in the
      // text as it will be.
      if (hit.backslash && around.before !== undefined) continue;
      return {
        kind: 'refuse',
        reason: hit.refuse,
        ...(hit.backslash ? { backslash: offsetAt(hit.from) } : {}),
      };
    }
    if (!widest || hit.to - hit.from > widest.to - widest.from) widest = hit;
  }
  if (widest) {
    // The end is just after the construct's last character, not after the markers that follow it.
    return { kind: 'construct', from: offsetAt(widest.from), to: offsetAt(widest.to - 1) + 1 };
  }
  // A shortcode that a letter or a digit stands against is no emoji to GitHub, which shows it only
  // at the start of a text or after a space; a marker between the two would leave it at the start of
  // a text, where it shows as the emoji (format §3.1, rule 9). What stands on each side of the marker
  // is what the change leaves there: `around`, or the text of the paragraph.
  const upcoming =
    around.after !== undefined ? around.after.slice(0, 80) : v.slice(index, index + 80);
  if (upcoming.startsWith(':')) {
    const beforeMarker = around.before !== undefined ? around.before.slice(-1) : v[index - 1];
    const code = shortcodeAt(upcoming);
    if (code !== null && isWord(beforeMarker)) {
      // A closer, which has the text of the change before it (`around.before`), takes the shortcode
      // into the change, as a closer inside any construct does: the shortcode is then in the old text
      // and the new, and no marker stands between it and the letter. An opener, or a format's edge,
      // has no such way, and is refused.
      if (around.before === undefined) return { kind: 'refuse', reason: STUCK_SHORTCODE };
      return {
        kind: 'construct',
        from: offsetAt(index),
        to: offsetAt(index + code.length - 1) + 1,
      };
    }
  }

  // The trailing spaces of a hard break.
  const trailing = / {2,}$/.exec(lineText);
  if (trailing && column > trailing.index && newline !== -1) {
    return {
      kind: 'refuse',
      reason: 'A marker can not go between a hard break and the line end.',
      trailing: offsetAt(start + trailing.index),
    };
  }
  if (changesFlanking(v, index, around)) return { kind: 'flank' };

  const kind = around.joined ? 'inline' : lineStartKind(text, position, hidden);
  if (kind === 'block') return { kind: 'block' };
  if (kind === 'continuation') return { kind: 'continuation' };
  if (kind === 'syntax') {
    return { kind: 'refuse', reason: SYNTAX_ONLY };
  }
  return { kind: 'ok' };
}

/**
 * The code span that `position` is inside of, in the offsets of the file: a marker can't go there
 * (format §3.1), and `inspectPlace` reads such a place as one that needs no widening.
 */
export function codeSpanAt(
  text: string,
  hidden: readonly Range[],
  position: number,
): Range | undefined {
  const range = paragraphRange(text, hidden, position);
  const paragraph = visible(text, hidden, range.from, range.to);
  let index = paragraph.offsets.findIndex((offset) => offset >= position);
  if (index === -1) index = paragraph.text.length;
  const span = hitsIn(paragraph.text, text).code.find((c) => c.from < index && index < c.to);
  if (!span) return undefined;
  const at = (i: number) =>
    paragraph.offsets[Math.min(i, paragraph.offsets.length - 1)] ?? position;
  return { from: at(span.from), to: at(span.to - 1) + 1 };
}

/** `position` moved to the left by one character, over the markers that end there. */
export function stepLeft(text: string, hidden: readonly Range[], position: number): number {
  let p = position;
  // Each pass that goes on moves `p` over a marker, so the markers are the most passes there are.
  for (let again = true, passes = 0; again && passes <= hidden.length; passes++) {
    again = false;
    for (const range of hidden) {
      if (range.to === p && range.from < p) {
        p = range.from;
        again = true;
      }
    }
  }
  if (p <= 0) return 0;
  return /[\uDC00-\uDFFF]/.test(text[p - 1] ?? '') && p >= 2 ? p - 2 : p - 1;
}

/** `position` moved to the right by one character, over the markers that start there. */
export function stepRight(text: string, hidden: readonly Range[], position: number): number {
  let p = position;
  for (let again = true, passes = 0; again && passes <= hidden.length; passes++) {
    again = false;
    for (const range of hidden) {
      if (range.from === p && range.to > p) {
        p = range.to;
        again = true;
      }
    }
  }
  if (p >= text.length) return text.length;
  return /[\uD800-\uDBFF]/.test(text[p] ?? '') && p + 2 <= text.length ? p + 2 : p + 1;
}
