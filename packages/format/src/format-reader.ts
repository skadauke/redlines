// Reading a paragraph as far as formats need it (format §2.6, §3.1): its emphasis as CommonMark has
// it, with GFM's strikethrough, its code spans and links, which of its characters are syntax, and the
// plain text that a change of format leaves as it is. It is not a Markdown parser: the constructs
// come from `hitsIn`, the same reading that places markers.

import { lineEnd, lineStart, prefixLength } from './blocks.ts';
import { markerRanges } from './edit-support.ts';
import type { MarkerRange } from './edit-support.ts';
import type { InlineFormat } from './format-ops.ts';
import { DELIMITER_ROW, hitsIn, isSyntaxLine, paragraphRange, visible } from './inline.ts';
import type { Hit } from './inline.ts';
import { parse } from './parse.ts';
import { scan } from './scan.ts';
import type { Parsed, Range } from './types.ts';

export const isSpace = (c: string | undefined): boolean => c === undefined || /\s/u.test(c);
/** CommonMark's punctuation since 0.31, which has the symbols, such as emoji. */
export const isPunctuation = (c: string | undefined): boolean =>
  c !== undefined && /[\p{P}\p{S}]/u.test(c);
/** Punctuation as GitHub still reads it: an emoji is not. A change must read right either way. */
export const isOlderPunctuation = (c: string | undefined): boolean =>
  c !== undefined && /[\p{P}$+<=>^`|~]/u.test(c);

/** The character in front of `index`, or what a marker that stands there is to a delimiter. */
export function charBefore(
  s: string,
  index: number,
  joints: ReadonlySet<number>,
): string | undefined {
  if (joints.has(index)) return '>';
  if (index <= 0) return undefined;
  const c = s.charAt(index - 1);
  return /[\uDC00-\uDFFF]/.test(c) && index >= 2 ? s.slice(index - 2, index) : c;
}

/** The character at `index`, or what a marker that stands there is to a delimiter. */
export function charAfter(
  s: string,
  index: number,
  joints: ReadonlySet<number>,
): string | undefined {
  if (joints.has(index)) return '<';
  const point = s.codePointAt(index);
  return point === undefined ? undefined : String.fromCodePoint(point);
}

/** A format in a paragraph: the syntax on either side, in offsets of its visible text. */
export interface Span {
  format: InlineFormat;
  open: Range;
  close: Range;
}

/** A run of delimiters on its way through `readEmphasis`: `from` and `to` close in as it is used. */
interface Run {
  char: string;
  from: number;
  to: number;
  length: number;
  canOpen: boolean;
  canClose: boolean;
}

/**
 * The emphasis in `[from, to)` of `s`, as CommonMark's delimiter algorithm has it, and GFM's `~~` and
 * `~`, which pair with a run of their own length.
 * `joints` are the places where a marker stands, which a delimiter reads as punctuation, as it reads
 * the `>` and the `<` of an HTML comment.
 */
function readEmphasis(
  s: string,
  from: number,
  to: number,
  joints: ReadonlySet<number>,
  punctuation: (c: string | undefined) => boolean,
): Span[] {
  const runs: Run[] = [];
  for (let i = from; i < to;) {
    const char = s.charAt(i);
    if (char !== '*' && char !== '_' && char !== '~') {
      i++;
      continue;
    }
    let end = i + 1;
    while (end < to && s[end] === char && !joints.has(end)) end++;
    const before = charBefore(s, i, joints);
    const after = charAfter(s, end, joints);
    const left = !isSpace(after) && (!punctuation(after) || isSpace(before) || punctuation(before));
    const right =
      !isSpace(before) && (!punctuation(before) || isSpace(after) || punctuation(after));
    runs.push({
      char,
      from: i,
      to: end,
      length: end - i,
      canOpen: char === '_' ? left && (!right || punctuation(before)) : left,
      canClose: char === '_' ? right && (!left || punctuation(after)) : right,
    });
    i = end;
  }
  const size = (run: Run) => run.to - run.from;
  const spans: Span[] = [];
  runs.forEach((closer, c) => {
    if (!closer.canClose) return;
    while (size(closer) > 0) {
      const o = runs.findLastIndex((opener, index) => {
        if (index >= c || opener.char !== closer.char || !opener.canOpen || size(opener) === 0) {
          return false;
        }
        if (closer.char === '~') return opener.length === closer.length && closer.length <= 2;
        const either = opener.canClose || closer.canOpen;
        const sum = opener.length + closer.length;
        return !(either && sum % 3 === 0 && (opener.length % 3 !== 0 || closer.length % 3 !== 0));
      });
      const opener = runs[o];
      if (!opener) return;
      const use =
        closer.char === '~' ? closer.length : size(opener) >= 2 && size(closer) >= 2 ? 2 : 1;
      const format = closer.char === '~' ? 'strike' : use === 2 ? 'bold' : 'italic';
      spans.push({
        format,
        open: { from: opener.to - use, to: opener.to },
        close: { from: closer.from, to: closer.from + use },
      });
      opener.to -= use;
      closer.from += use;
      for (const between of runs.slice(o + 1, c)) between.from = between.to;
    }
  });
  // `***a***` reads as emphasis around strong emphasis, and the bytes are the same the other way.
  // Bold on the outside lets a mark that removes it stand outside all of the stars.
  for (const outer of spans) {
    const inner = spans.find(
      (span) =>
        span.format === 'bold' &&
        outer.format === 'italic' &&
        s[span.open.from] === s[outer.open.from] &&
        span.open.from === outer.open.to &&
        span.close.to === outer.close.from &&
        !joints.has(span.open.from) &&
        !joints.has(span.close.to),
    );
    if (!inner) continue;
    const at = outer.open.from;
    const end = outer.close.to;
    inner.open = { from: at, to: at + 2 };
    inner.close = { from: end - 2, to: end };
    outer.open = { from: at + 2, to: at + 3 };
    outer.close = { from: end - 3, to: end - 2 };
  }
  return spans;
}

/** What a character of a paragraph is: text, the prefix of its line, or other syntax. */
export const TEXT = 0;
export const PREFIX = 1;
export const SYNTAX = 2;

/** A link in a paragraph. `inline` is `[text](dest)`; otherwise it is `[text][label]`. */
export interface LinkSpan {
  from: number;
  to: number;
  text: Range;
  dest: Range;
  inline: boolean;
}

/** A paragraph, read: offsets are in its visible text `v` unless they say otherwise. */
export interface Layout {
  /** The paragraph in the file. */
  range: Range;
  v: string;
  /** Each character's offset in the file; one more for the end. */
  offsets: readonly number[];
  roles: Uint8Array;
  hits: readonly Hit[];
  spans: readonly Span[];
  links: readonly LinkSpan[];
  /** The `|` that part the cells of a table row. */
  walls: readonly number[];
  /** Where a marker stands between two characters. */
  joints: ReadonlySet<number>;
  /** A row of a table that has no leading `|`, which a marker needs (format §3.2). */
  bareRow: boolean;
}

/** What a function needs to read paragraphs. */
export interface FormatReader {
  text: string;
  hidden: readonly MarkerRange[];
  verbatim: readonly Range[];
}

/** A reader for a file and its parse. */
export function formatReader(text: string, parsed: Parsed): FormatReader {
  return { text, hidden: markerRanges(parsed), verbatim: scan(text).verbatim };
}

/** Whether the line that holds `position` is a row of a table: it and the lines above it have a `|`,
 * up to a delimiter row, or the line below is the delimiter row of its header. */
function inTable(text: string, position: number): boolean {
  let at = lineStart(text, position);
  const below = text.indexOf('\n', at) + 1;
  const next = below === 0 ? '' : text.slice(below, lineEnd(text, below));
  if (next.includes('|') && DELIMITER_ROW.test(next)) return true;
  for (let lines = 0; lines < 500; lines++) {
    const line = text.slice(at, lineEnd(text, at));
    if (!line.includes('|')) return false;
    if (DELIMITER_ROW.test(line)) return true;
    if (at === 0) return false;
    at = lineStart(text, at - 1);
  }
  return false;
}

/** What may stand between the parentheses of a link: an address, and a title after it. */
const LINK_DEST =
  /^\s*(?:<(?:[^<>\n\\]|\\.)*>|(?!<)\S*)(?:\s+(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\((?:[^()\\]|\\.)*\)))?\s*$/s;

export function readLayout(
  reader: FormatReader,
  range: Range,
  punctuation = isPunctuation,
): Layout {
  const { text, hidden, verbatim } = reader;
  const { text: v, offsets } = visible(text, hidden, range.from, range.to);
  const found = hitsIn(v, text);
  // A link is read first. An address in it is not a bare URL, which goes on past its parenthesis
  // with no marker to stop it, and a bare URL in its text ends with the text.
  const inLinks = found.hits.filter((hit) => hit.text && hit.dest);
  const hits = found.hits.flatMap((hit) => {
    // Brackets and parentheses around what can't be an address are text.
    if (hit.kind === 'link' && hit.dest && !LINK_DEST.test(v.slice(hit.dest.from, hit.dest.to))) {
      return [];
    }
    if (hit.kind !== 'url') return [hit];
    if (inLinks.some(({ dest }) => dest && dest.from <= hit.from && hit.from <= dest.to)) return [];
    const holder = inLinks.find(({ text: t }) => t && t.from <= hit.from && hit.from < t.to);
    return holder?.text ? [{ ...hit, to: Math.min(hit.to, holder.text.to) }] : [hit];
  });
  const indexOf = (position: number) => {
    const index = offsets.findIndex((offset) => offset >= position);
    return index === -1 ? v.length : index;
  };
  // An HTML comment in a line takes no marker, as code does not.
  for (const { from, to } of verbatim) {
    if (from < range.from || to > range.to) continue;
    const start = indexOf(from);
    const end = indexOf(to);
    hits.push({ lo: start + 1, hi: end - 1, from: start, to: end, kind: 'comment' });
  }
  const joints = new Set<number>();
  for (let i = 0; i <= v.length; i++) {
    const last = i === 0 ? range.from : (offsets[i - 1] ?? 0) + 1;
    if ((offsets[i] ?? 0) > last) joints.add(i);
  }

  const chars = v.split('');
  const blank = (from: number, to: number, c: string) => {
    for (let i = from; i < to; i++) if (chars[i] !== '\n') chars[i] = c;
  };
  for (const code of found.code) blank(code.from + 1, code.to - 1, 'x');
  const links: LinkSpan[] = [];
  for (const hit of hits) {
    if (hit.refuse !== undefined) continue;
    if (hit.kind === 'escape') chars[hit.from + 1] = '.';
    else if (hit.text && hit.dest) {
      const { from, to, text: inner, dest } = hit;
      links.push({ from, to, text: inner, dest, inline: hit.kind === 'link' });
    } else blank(hit.from + 1, hit.to - 1, 'x');
  }

  const roles = new Uint8Array(v.length);
  const walls: number[] = [];
  let bareRow = false;
  for (let start = 0; start <= v.length;) {
    const newline = v.indexOf('\n', start);
    const line = v.slice(start, newline === -1 ? v.length : newline).replace(/\r$/, '');
    const end = start + line.length;
    const prefix = prefixLength(line);
    const heading = /^#{1,6}[ \t]+/.exec(line.slice(prefix))?.[0].length ?? 0;
    const lead = start + prefix + heading;
    roles.fill(PREFIX, start, lead);
    blank(start, lead, ' ');
    if (heading > 0) {
      const tail = /(?:[ \t]+#+)?(?:[ \t]*\{[^{}]*\})?[ \t]*$/.exec(v.slice(lead, end));
      if (tail) roles.fill(SYNTAX, lead + tail.index, end);
    }
    if (isSyntaxLine(line, true)) roles.fill(SYNTAX, start, end);
    else if (line.includes('|') && inTable(text, offsets[start] ?? 0)) {
      for (let i = start; i < end; i++) {
        if (chars[i] !== '|') continue;
        walls.push(i);
        roles[i] = SYNTAX;
      }
      if (v[lead] !== '|') bareRow = true;
    }
    if (newline === -1) break;
    start = newline + 1;
  }

  // Emphasis does not go in or out of the text of a link, or a cell of a table.
  const inner = chars.join('');
  const outerChars = [...chars];
  for (const link of links) {
    roles.fill(SYNTAX, link.from, link.text.from);
    roles.fill(SYNTAX, link.text.to, link.to);
    outerChars.fill('x', link.from + 1, link.to - 1);
  }
  const outer = outerChars.join('');
  const spans: Span[] = [];
  let cell = 0;
  for (const wall of [...walls, v.length]) {
    spans.push(...readEmphasis(outer, cell, wall, joints, punctuation));
    cell = wall + 1;
  }
  for (const link of links) {
    spans.push(...readEmphasis(inner, link.text.from, link.text.to, joints, punctuation));
  }
  for (const code of found.code) {
    const run = /^`+/.exec(v.slice(code.from, code.to))?.[0].length ?? 1;
    const body = v.slice(code.from + run, code.to - run);
    // One space on each side belongs to the syntax, when the text is not all spaces.
    const pad = body.length > 1 && /^ .* $/su.test(body) && body.trim() !== '' ? 1 : 0;
    spans.push({
      format: 'code',
      open: { from: code.from, to: code.from + run + pad },
      close: { from: code.to - run - pad, to: code.to },
    });
  }
  for (const { open, close } of spans) {
    roles.fill(SYNTAX, open.from, open.to);
    roles.fill(SYNTAX, close.from, close.to);
  }
  spans.sort((a, b) => a.open.from - b.open.from || b.close.to - a.close.to);
  return { range, v, offsets, roles, hits, spans, links, walls, joints, bareRow };
}

/** The first character of `index` or after it, in the visible text of the paragraph. */
export function indexAt(layout: Layout, position: number): number {
  const index = layout.offsets.findIndex((offset) => offset >= position);
  return index === -1 ? layout.v.length : index;
}

/** Where the character at `index` is in the file. */
export const startOf = (layout: Layout, index: number): number =>
  layout.offsets[index] ?? layout.range.to;

/** Where the character in front of `index` ends in the file: before the markers that follow it. */
export const endOf = (layout: Layout, index: number): number =>
  index === 0 ? layout.range.from : (layout.offsets[index - 1] ?? layout.range.to - 1) + 1;

/** A stretch of the visible text as a stretch of the file; nothing but text is in it. */
export const inFile = (layout: Layout, range: Range): Range => ({
  from: startOf(layout, range.from),
  to: endOf(layout, range.to),
});

/** The text of a paragraph that a change of format does not change: without its syntax. */
function plainOf(layout: Layout): string {
  const { v, roles, hits } = layout;
  const dropped = new Set<number>();
  const symbols = new Set<number>();
  const drop = (from: number, to: number) => {
    for (let i = from; i < to; i++) dropped.add(i);
  };
  for (const { kind, from, to, alt } of hits) {
    if (kind === 'escape') dropped.add(from);
    else if (kind === 'autolink') dropped.add(from).add(to - 1);
    else if (kind === 'symbol' || kind === 'footnote' || kind === 'reference') symbols.add(from);
    else if (kind === 'tag' || kind === 'comment') drop(from, to);
    else if (alt) {
      drop(from, alt.from);
      drop(alt.to, to);
    }
  }
  let plain = '';
  for (let i = 0; i < v.length; i++) {
    // A symbol is another character than what it is written with, which is what code shows.
    if (symbols.has(i)) plain += '\u0001';
    if (roles[i] === TEXT && !dropped.has(i)) plain += v[i];
  }
  return plain;
}

/** The paragraphs that have lines in `[from, to]`, in order. */
export function paragraphsIn(reader: FormatReader, from: number, to: number): Range[] {
  const { text, hidden } = reader;
  const found: Range[] = [];
  let at = lineStart(text, from);
  while (at < text.length && at <= to) {
    let end = lineEnd(text, at);
    if (!/^[ \t>]*\r?$/.test(visible(text, hidden, at, end).text)) {
      const paragraph = paragraphRange(text, hidden, at);
      found.push(paragraph);
      end = Math.max(end, paragraph.to);
    }
    const newline = text.indexOf('\n', end);
    if (newline === -1) break;
    at = newline + 1;
  }
  return found;
}

/** The start of an HTML block, after the prefix of its line: the elements that start one, and the
 * forms CommonMark gives other numbers (`<?`, `<!`). */
const HTML_BLOCK =
  /^<(?:\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:[ \t>]|\/>|$)|[?!])/i;

/** Any other tag, alone on its line, starts one too, where a paragraph could start. */
const LONE_TAG =
  /^<\/?[A-Za-z][A-Za-z0-9-]*(?:\s+[A-Za-z_:][\w:.-]*(?:\s*=\s*(?:[^\s"'=<>`]+|'[^']*'|"[^"]*"))?)*\s*\/?>\s*$/;

/** How many lines above a paragraph are looked at, to tell what it is in. */
export const LINES_ABOVE = 500;

/**
 * Whether the lines of the paragraph are an indented code block: indented by four spaces or more
 * from where text starts, which is the text of the list item above, if there is one.
 */
function isIndentedCode(reader: FormatReader, range: Range): boolean {
  const { text, hidden } = reader;
  const lineAt = (at: number) => visible(text, hidden, at, lineEnd(text, at)).text;
  const quotes = (line: string) => /^(?:[ \t]*>[ \t]?)*/.exec(line)?.[0].length ?? 0;
  const first = lineAt(lineStart(text, range.from));
  const body = first.slice(quotes(first));
  const indent = (/^[ \t]*/.exec(body)?.[0] ?? '').replaceAll('\t', '    ').length;
  if (indent < 4 || body.trim() === '') return false;
  // A line that starts inside a marker goes on from the line above: the line break of a marker
  // alone on its line, and the indentation after it, are the marker's (format §3.3).
  const goesOn = (at: number) => {
    let lo = 0;
    let hi = hidden.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((hidden[mid]?.from ?? 0) < at) lo = mid + 1;
      else hi = mid;
    }
    return (hidden[lo - 1]?.to ?? 0) > at;
  };
  let at = lineStart(text, range.from);
  for (let lines = 0; lines < LINES_ABOVE && at > 0; lines++) {
    at = lineStart(text, at - 1);
    if (goesOn(at)) continue;
    const whole = lineAt(at);
    const line = whole.slice(quotes(whole));
    if (line.trim() === '') continue;
    // An item with nothing on its first line, or only a marker, has its text one column on.
    const bullet = /^[ \t]*(?:[-*+]|\d{1,9}[.)])(?:[ \t]+|$)/.exec(line)?.[0];
    const item =
      bullet === undefined ? undefined : Math.max(bullet.length, bullet.trimEnd().length + 1);
    if (item !== undefined && item <= indent) return indent - item >= 4;
    if (!/^[ \t]/.test(line)) return true;
  }
  return true;
}

/**
 * Whether the paragraph is not one: its lines are in code, an HTML comment or a raw-text block, an
 * HTML block, or an indented code block. Syntax means nothing there, and none is written there.
 */
export function isRawParagraph(reader: FormatReader, range: Range): boolean {
  const { text, hidden, verbatim } = reader;
  if (verbatim.some((v) => v.from <= range.from && range.to <= v.to)) return true;
  const lineAt = (at: number) =>
    visible(text, hidden, at, lineEnd(text, at)).text.replace(/\r$/, '');
  const inBlock = (line: string) => line.slice(prefixLength(line));
  const { top, html } = runAt(reader, range.from, lineAt, inBlock);
  if (LONE_TAG.test(inBlock(lineAt(top)))) return true;
  if (html <= range.to) return true;
  return isIndentedCode(reader, range);
}

/** A run of lines with no blank line: where it starts, and the first of its lines that starts an
 * HTML block, which goes on to the end of the run. */
interface LineRun {
  top: number;
  html: number;
}

/** The runs of the lines of a file that have been read, by the line starts that were passed. The
 * paragraphs of a long list are read one after the other, and each would look up all of it. */
const runsRead = new WeakMap<FormatReader, Map<number, LineRun>>();

function runAt(
  reader: FormatReader,
  position: number,
  lineAt: (at: number) => string,
  inBlock: (line: string) => string,
): LineRun {
  const { text } = reader;
  let known = runsRead.get(reader);
  if (!known) {
    known = new Map();
    runsRead.set(reader, known);
  }
  const passed: number[] = [];
  let top = lineStart(text, position);
  let run = known.get(top);
  for (let lines = 0; !run && lines < LINES_ABOVE && top > 0; lines++) {
    const above = lineStart(text, top - 1);
    if (/^[ \t>]*$/.test(lineAt(above))) break;
    passed.push(top);
    top = above;
    run = known.get(top);
  }
  if (!run) {
    let html = Infinity;
    for (let at = top; ;) {
      const line = lineAt(at);
      if (at > top && /^[ \t>]*$/.test(line)) break;
      if (HTML_BLOCK.test(inBlock(line))) {
        html = at;
        break;
      }
      const newline = text.indexOf('\n', at);
      if (newline === -1) break;
      at = newline + 1;
    }
    run = { top, html };
    known.set(top, run);
  }
  for (const start of passed) known.set(start, run);
  return run;
}

/**
 * The plain text of the paragraphs of a file's body that have lines in `[from, to]`, all of them by
 * default: what the marks and the syntax are written around.
 */
export function plainBody(
  text: string,
  punctuation: (c: string | undefined) => boolean,
  from = 0,
  to = Infinity,
  parsed: Parsed = parse(text),
): string {
  const reader = formatReader(text, parsed);
  const end = parsed.ledgerRange?.from ?? text.length;
  return paragraphsIn(reader, from, Math.min(to, end))
    .filter((range) => range.from < end)
    .map((range) => {
      const clipped = { from: range.from, to: Math.min(range.to, end) };
      return isRawParagraph(reader, clipped)
        ? text.slice(clipped.from, clipped.to)
        : plainOf(readLayout(reader, clipped, punctuation));
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}
