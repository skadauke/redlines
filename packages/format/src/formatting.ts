// Format changes (format §2.6): formatting that changes while the words stay the same. With Track
// Changes on, a change is a `fmt` mark around the text, whose payload says what rejecting it undoes.
// With it off, the same syntax goes through `untrackedEdit`, and no mark is written.
//
// - Adding a format writes its syntax (`**`, `*`, `~~`, backticks, `[`…`](…)`) right against the
//   first and last characters of the text, and the markers right against the syntax. Text that has
//   the format already is left out, and a piece that would cross the edge of another format, a link
//   or a table cell is cut there. A format around all of another goes outside its syntax.
// - Removing a format takes all of its run, and the markers stand where its syntax stood.
// - A mark goes inside an insertion or a substitution, never around one: a range is cut at their
//   edges. Otherwise rejecting the insertion would leave `****`, or `** text**`.
// - In the author's own insertion the syntax is written with no mark, and a format change of the
//   author's own that is turned back goes away. Another person's change of the same format is in
//   the way, and is refused.
// - Each block has its marks, with one id for the pieces at one depth, and all of them share a group.
//
// Whatever a change comes to is checked before it is written: the plain text is the same while it
// is pending and once it is accepted, which is where a delimiter that opens nothing shows up, and
// rejecting it gives back the bytes.
//
// `readLayout` reads the emphasis of a paragraph as CommonMark does. It is not a Markdown parser:
// the constructs come from `hitsIn`, the same reading that places markers.

import {
  breakStart,
  frontMatterEnd,
  lineEnd,
  lineStart,
  lineStartKind,
  openerRange,
  prefixLength,
} from './blocks.ts';
import { applyChanges } from './changes.ts';
import {
  addPerson,
  assertNoMarkup,
  commitEdit,
  markerRanges,
  snapOut,
  spliceRepairs,
  workingLedger,
} from './edit-support.ts';
import type { MarkerRange } from './edit-support.ts';
import { EditError } from './errors.ts';
import { idsIn, newId } from './ids.ts';
import { hitsIn, inspectPlace, isSyntaxLine, paragraphRange, visible } from './inline.ts';
import type { Hit, Place } from './inline.ts';
import { parse } from './parse.ts';
import { decodePayload, encodePayload } from './payload.ts';
import { scan } from './scan.ts';
import type { TrackedEdits } from './track.ts';
import type {
  EditContext,
  MarkEntry,
  MarkRange,
  Parsed,
  Person,
  Range,
  Segment,
  TextChange,
} from './types.ts';
import { nameOf, untrackedEdit } from './untracked.ts';
import type { UntrackedContext } from './untracked.ts';

export type InlineFormat = 'bold' | 'italic' | 'strike' | 'code';

export type BlockType =
  'p' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'ul' | 'ol' | 'task' | 'quote';

/** A change of formatting that a person asks for. */
export type FormatOp =
  | { kind: 'inline'; format: InlineFormat; on: boolean }
  /** Removes every inline format in the range. */
  | { kind: 'clear' }
  /** Adds a link, changes its address, or removes it with null. */
  | { kind: 'link'; url: string | null }
  | { kind: 'check'; checked: boolean }
  | { kind: 'block'; to: BlockType }
  | { kind: 'indent'; by: 1 | -1 };

/** One operation of a `fmt` payload (format §2.6). */
export interface ParsedFormatOp {
  /** The operation as it is written in the file, escapes and all. */
  source: string;
  /** `+` added, `-` removed, nothing for a value that changed. */
  sign: '+' | '-' | '';
  /** What it is about: `bold`, `link`, `check`, `was`, `@width`. */
  name: string;
  /** What follows the `=`, with its escapes read: the old address, the old block type. */
  value?: string;
  /** The change that undoes it. Absent for an operation that `FormatOp` has no word for. */
  inverse?: FormatOp;
}

const INLINE_FORMATS: readonly InlineFormat[] = ['bold', 'italic', 'strike', 'code'];
const BLOCK_TYPES: readonly string[] = [
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'task',
  'quote',
];

/** The syntax that new text of a format is written with. */
const DELIMITER: Record<InlineFormat, string> = {
  bold: '**',
  italic: '*',
  strike: '~~',
  code: '`',
};

const isInlineFormat = (name: string): name is InlineFormat =>
  (INLINE_FORMATS as readonly string[]).includes(name);
const isBlockType = (name: string): name is BlockType => BLOCK_TYPES.includes(name);

function inverseOf(
  sign: ParsedFormatOp['sign'],
  name: string,
  value: string | undefined,
): FormatOp | undefined {
  if (isInlineFormat(name) && sign !== '')
    return { kind: 'inline', format: name, on: sign === '-' };
  if (name === 'link') {
    if (sign === '+') return { kind: 'link', url: null };
    if (value !== undefined) return { kind: 'link', url: value };
  }
  if (name === 'check' && sign !== '') return { kind: 'check', checked: sign === '-' };
  if (name === 'was' && sign === '' && value !== undefined && isBlockType(value)) {
    return { kind: 'block', to: value };
  }
  return undefined;
}

/** A payload as operations, and each operation's inverse, for views and decisions. `payload` is the
 * operations as they are written, as `Segment.payload` and `MarkRange.payload` have them. */
export function parseFormatOps(payload: string): ParsedFormatOp[] {
  return payload
    .split(' ')
    .filter((source) => source !== '')
    .map((source) => {
      const sign = source[0] === '+' || source[0] === '-' ? source[0] : '';
      const equals = source.indexOf('=');
      const name = source.slice(sign.length, equals === -1 ? undefined : equals);
      const op: ParsedFormatOp = { source, sign, name };
      if (equals !== -1) op.value = decodePayload(source.slice(equals + 1));
      const inverse = inverseOf(sign, name, op.value);
      if (inverse) op.inverse = inverse;
      return op;
    });
}

/** A value of an operation as the payload writes it: escaped, and a space is `\x20`, so that a space
 * is only ever what parts operations (format §2.6). */
function encodeValue(value: string): string {
  return value
    .split(' ')
    .map((part, i, parts) => {
      // A backslash in front of the escape of the space would be read as an escape itself.
      const ends = i < parts.length - 1 && part.endsWith('\\');
      return encodePayload(part) + (ends ? '\\' : '');
    })
    .join('\\x20');
}

/** The operation that says a format was removed: with the syntax it was written with, unless that
 * is the one this format is written with anyway. */
function removedOp(format: InlineFormat, syntax: string): string {
  return syntax === DELIMITER[format] ? `-${format}` : `-${format}=${encodeValue(syntax)}`;
}

/** Whether accepting and rejecting know all the operations of the mark. `was=` and `+check` come
 * with block format changes, and the others are read and kept. */
export function decidesFormat(mark: MarkRange): boolean {
  return mark.segments.every((segment) =>
    opsOf(mark, segment).every(
      (op) => op.inverse?.kind === 'inline' || op.inverse?.kind === 'link',
    ),
  );
}

/** The operations of a segment. Each has its own; one made by another tool may leave them to the
 * first. */
function opsOf(mark: MarkRange, segment: Segment): ParsedFormatOp[] {
  return parseFormatOps(segment.payload ?? mark.payload ?? '');
}

const isSpace = (c: string | undefined): boolean => c === undefined || /\s/u.test(c);
/** CommonMark's punctuation since 0.31, which has the symbols, such as emoji. */
const isPunctuation = (c: string | undefined): boolean =>
  c !== undefined && /[\p{P}\p{S}]/u.test(c);
/** Punctuation as GitHub still reads it: an emoji is not. A change must read right either way. */
const isOlderPunctuation = (c: string | undefined): boolean =>
  c !== undefined && /[\p{P}$+<=>^`|~]/u.test(c);
const isWord = (c: string | undefined): boolean => c !== undefined && /[\p{L}\p{N}]/u.test(c);

/** The character in front of `index`, or what a marker that stands there is to a delimiter. */
function charBefore(s: string, index: number, joints: ReadonlySet<number>): string | undefined {
  if (joints.has(index)) return '>';
  if (index <= 0) return undefined;
  const c = s.charAt(index - 1);
  return /[\uDC00-\uDFFF]/.test(c) && index >= 2 ? s.slice(index - 2, index) : c;
}

/** The character at `index`, or what a marker that stands there is to a delimiter. */
function charAfter(s: string, index: number, joints: ReadonlySet<number>): string | undefined {
  if (joints.has(index)) return '<';
  const point = s.codePointAt(index);
  return point === undefined ? undefined : String.fromCodePoint(point);
}

/** A format in a paragraph: the syntax on either side, in offsets of its visible text. */
interface Span {
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
 * The emphasis in `[from, to)` of `s`, as CommonMark's delimiter algorithm has it, and GFM's `~~`.
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
        if (closer.char === '~') return size(opener) === 2 && size(closer) === 2;
        const either = opener.canClose || closer.canOpen;
        const sum = opener.length + closer.length;
        return !(either && sum % 3 === 0 && (opener.length % 3 !== 0 || closer.length % 3 !== 0));
      });
      const opener = runs[o];
      if (!opener) return;
      const use = closer.char === '~' || (size(opener) >= 2 && size(closer) >= 2) ? 2 : 1;
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
        span.close.to === outer.close.from,
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
const TEXT = 0;
const PREFIX = 1;
const SYNTAX = 2;

/** A link in a paragraph. `inline` is `[text](dest)`; otherwise it is `[text][label]`. */
interface LinkSpan {
  from: number;
  to: number;
  text: Range;
  dest: Range;
  inline: boolean;
}

/** A paragraph, read: offsets are in its visible text `v` unless they say otherwise. */
interface Layout {
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

const DELIMITER_ROW = /^[ \t>]*\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;

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

function readLayout(reader: FormatReader, range: Range, punctuation = isPunctuation): Layout {
  const { text, hidden, verbatim } = reader;
  const { text: v, offsets } = visible(text, hidden, range.from, range.to);
  const found = hitsIn(v, text);
  // A link is read first. An address in it is not a bare URL, which goes on past its parenthesis
  // with no marker to stop it, and a bare URL in its text ends with the text.
  const inLinks = found.hits.filter((hit) => hit.text && hit.dest);
  const hits = found.hits.flatMap((hit) => {
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
function indexAt(layout: Layout, position: number): number {
  const index = layout.offsets.findIndex((offset) => offset >= position);
  return index === -1 ? layout.v.length : index;
}

/** Where the character at `index` is in the file. */
const startOf = (layout: Layout, index: number): number => layout.offsets[index] ?? layout.range.to;

/** Where the character in front of `index` ends in the file: before the markers that follow it. */
const endOf = (layout: Layout, index: number): number =>
  index === 0 ? layout.range.from : (layout.offsets[index - 1] ?? layout.range.to - 1) + 1;

/** A stretch of the visible text as a stretch of the file; nothing but text is in it. */
const inFile = (layout: Layout, range: Range): Range => ({
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
    else if (kind === 'symbol') symbols.add(from);
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
function paragraphsIn(reader: FormatReader, from: number, to: number): Range[] {
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

/** The plain text of a file's body: what the marks and the syntax are written around. */
function plainBody(text: string, punctuation: (c: string | undefined) => boolean): string {
  const parsed = parse(text);
  const reader = formatReader(text, parsed);
  const end = parsed.ledgerRange?.from ?? text.length;
  return paragraphsIn(reader, 0, end)
    .filter((range) => range.from < end)
    .map((range) => {
      const whole = reader.verbatim.some((v) => v.from <= range.from && range.to <= v.to);
      return whole
        ? text.slice(range.from, range.to)
        : plainOf(
            readLayout(reader, { from: range.from, to: Math.min(range.to, end) }, punctuation),
          );
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const refused = (reason: string) => new EditError(reason, 'no-legal-placement');

const FLANK = 'A marker here would change how the text next to it is emphasized.';

const READS_OTHERWISE =
  "This formatting can't be written here: Markdown would read the text next to it differently.";

const IN_CODE_SPAN = "Text inside code can't be formatted. Select the whole code span instead.";

const IN_VERBATIM = "Text inside code or an HTML comment can't be formatted.";

const LOST_SYNTAX =
  "This format change can't be rejected, because its text no longer has that formatting. Accept it, or change the text in Raw with Track Changes off.";

const BARE_ROW = 'A row of a table needs a leading | to hold a format change.';

const STRADDLES =
  'This formatting starts and ends on different sides of a pending change. Accept or reject that change first.';

const REFERENCE = "A reference link's address is not in its text, so it can't be changed here.";

/** A stretch of the visible text. */
type Piece = Range;

const overlaps = (a: Range, b: Range): boolean => a.from < b.to && b.from < a.to;

/** Where the opening syntax that holds `index` starts, when all of what it opens is before `to`. */
function opensBefore(layout: Layout, index: number, to: number): number | undefined {
  for (const { open, close } of layout.spans) {
    if (open.from <= index && index < open.to && close.to <= to) return open.from;
  }
  for (const link of layout.links) if (link.from === index && link.to <= to) return link.from;
  return undefined;
}

/** Where the closing syntax that holds `index` ends, when all of what it closes is after `from`. */
function closesAfter(layout: Layout, index: number, from: number): number | undefined {
  for (const { open, close } of layout.spans) {
    if (close.from <= index && index < close.to && open.from >= from) return close.to;
  }
  for (const link of layout.links) {
    if (link.text.to <= index && index < link.to && link.from >= from) return link.to;
  }
  return undefined;
}

/**
 * A piece without what stands at its ends that is not its text: white space, the prefix of a line,
 * and syntax whose other end is not in the piece. A format goes right against the text.
 */
function trimmed(layout: Layout, piece: Piece): Piece | undefined {
  const { v, roles } = layout;
  let { from, to } = piece;
  while (from < to) {
    if (roles[from] === TEXT && !isSpace(v[from])) break;
    const start = roles[from] === SYNTAX ? opensBefore(layout, from, to) : undefined;
    if (start !== undefined) {
      from = start;
      break;
    }
    from++;
  }
  while (to > from) {
    if (roles[to - 1] === TEXT && !isSpace(v[to - 1])) break;
    const end = roles[to - 1] === SYNTAX ? closesAfter(layout, to - 1, from) : undefined;
    if (end !== undefined) {
      to = end;
      break;
    }
    to--;
  }
  return from < to ? { from, to } : undefined;
}

/** A piece that stops inside what takes no marker reaches over all of it: an entity, an image, a
 * code span (format §3.5). */
function overAtoms(layout: Layout, piece: Piece): Piece {
  let { from, to } = piece;
  const atoms: Range[] = layout.hits.filter((hit) => hit.refuse === undefined && !hit.text);
  for (const span of layout.spans) {
    if (span.format === 'code') atoms.push({ from: span.open.from, to: span.close.to });
  }
  for (let changed = true; changed;) {
    changed = false;
    for (const atom of atoms) {
      if (atom.from < from && from < atom.to) {
        from = atom.from;
        changed = true;
      }
      if (atom.from < to && to < atom.to) {
        to = atom.to;
        changed = true;
      }
    }
  }
  return { from, to };
}

/** What a piece must nest with: all of it inside `inner`, or all of `outer` inside the piece. When
 * `always` is set, the second will not do either, and the piece is cut around it. */
interface Nester {
  outer: Range;
  inner: Range;
  always?: boolean;
}

function crosses(piece: Piece, { outer, inner, always }: Nester): boolean {
  if (piece.to <= outer.from || piece.from >= outer.to) return false;
  if (inner.from <= piece.from && piece.to <= inner.to) return false;
  return always === true || !(piece.from <= outer.from && outer.to <= piece.to);
}

/** The piece, cut at what it crosses. */
function nested(layout: Layout, start: Piece, nesters: readonly Nester[]): Piece[] {
  const done: Piece[] = [];
  const todo = [start];
  for (let next = todo.pop(); next; next = todo.pop()) {
    const piece = trimmed(layout, next);
    if (!piece) continue;
    const { from, to } = piece;
    const crossed = nesters.find((nester) => crosses(piece, nester));
    if (!crossed) done.push(piece);
    else if (from < crossed.inner.from) {
      todo.push({ from: crossed.inner.from, to }, { from, to: crossed.outer.from });
    } else todo.push({ from: crossed.outer.to, to }, { from, to: crossed.inner.to });
  }
  return done.toSorted((a, b) => a.from - b.from);
}

/** `piece` without the ranges. */
function without(piece: Piece, ranges: readonly Range[]): Piece[] {
  let pieces = [piece];
  for (const range of ranges) {
    pieces = pieces.flatMap((p) => {
      if (!overlaps(p, range)) return [p];
      const left = { from: p.from, to: Math.min(p.to, range.from) };
      const right = { from: Math.max(p.from, range.to), to: p.to };
      return [left, right].filter((part) => part.from < part.to);
    });
  }
  return pieces;
}

/** A pending insertion or substitution, in the visible text of a paragraph. */
interface Holder extends Range {
  mark: MarkRange;
  own: boolean;
}

/** A segment of a format change, in the visible text of a paragraph. */
interface FormatSegment extends Range {
  mark: MarkRange;
  segment: Segment;
  ops: ParsedFormatOp[];
  own: boolean;
}

/** One thing a format change does, in offsets of the file. */
type Step =
  /** Syntax around text that had none. */
  | {
      kind: 'wrap';
      at: number;
      a: number;
      b: number;
      /** Where the opener goes: `a`, or at the end of the line before. */
      opener: number;
      left: string;
      right: string;
      op: string;
      /** The insertion of the author's own that holds it, where no mark is written. */
      own?: string;
    }
  /** Syntax taken away. */
  | {
      kind: 'unwrap';
      at: number;
      opens: Range;
      closes: Range;
      opener: number;
      op: string;
      /** How many other removals of this change are around it. */
      depth: number;
      own?: string;
    }
  /** A link's address changed. */
  | {
      kind: 'relink';
      at: number;
      outer: Range;
      opener: number;
      url: Range;
      insert: string;
      op: string;
    }
  /** A format change of the author's own changed in place. */
  | { kind: 'edit'; at: number; changes: TextChange[]; id: string; kept: boolean };

/** What the planning of one change works with. */
interface Planning extends FormatReader {
  parsed: Parsed;
  /** Whose own marks are changed in place. Nobody's, with Track Changes off. */
  me: string | undefined;
  author: Person | undefined;
  tracked: boolean;
}

function holdersIn(planning: Planning, layout: Layout): Holder[] {
  const holders: Holder[] = [];
  for (const mark of planning.parsed.marks) {
    if (mark.kind !== 'ins' && mark.kind !== 'sub') continue;
    for (const segment of mark.segments) {
      if (!segment.close) continue;
      const start = segment.carrier?.to ?? segment.content.from;
      if (segment.content.to <= layout.range.from || start >= layout.range.to) continue;
      holders.push({
        mark,
        own: mark.entry.by === planning.me,
        from: indexAt(layout, start),
        to: indexAt(layout, segment.content.to),
      });
    }
  }
  return holders;
}

function formatSegmentsIn(planning: Planning, layout: Layout): FormatSegment[] {
  const segments: FormatSegment[] = [];
  for (const mark of planning.parsed.marks) {
    if (mark.kind !== 'fmt') continue;
    for (const segment of mark.segments) {
      if (!segment.close) continue;
      const start = segment.carrier?.to ?? segment.content.from;
      if (segment.content.to <= layout.range.from || start >= layout.range.to) continue;
      segments.push({
        mark,
        segment,
        ops: opsOf(mark, segment),
        own: mark.entry.by === planning.me,
        from: indexAt(layout, start),
        to: indexAt(layout, segment.content.to),
      });
    }
  }
  return segments;
}

/** What a new piece of `format` has to nest with in the paragraph. */
function nestersFor(planning: Planning, layout: Layout, format?: InlineFormat): Nester[] {
  const nesters: Nester[] = [];
  for (const { format: other, open, close } of layout.spans) {
    if (other === format) continue;
    nesters.push({
      outer: { from: open.from, to: close.to },
      inner: { from: open.to, to: close.from },
    });
  }
  for (const link of layout.links) {
    nesters.push({ outer: { from: link.from, to: link.to }, inner: link.text });
  }
  for (const wall of layout.walls) {
    nesters.push({
      outer: { from: wall, to: wall + 1 },
      inner: { from: wall + 1, to: wall + 1 },
      always: true,
    });
  }
  const point = (at: number): Nester => ({
    outer: { from: at, to: at },
    inner: { from: at, to: at },
    always: true,
  });
  // Marks that decide the text under them hold what is written in it. With Track Changes off, the
  // syntax goes outside them, as typed text does (format §3.10).
  if (planning.tracked) {
    for (const holder of holdersIn(planning, layout)) {
      nesters.push({ outer: holder, inner: holder, always: true });
    }
  }
  for (const segment of formatSegmentsIn(planning, layout)) {
    nesters.push({ outer: segment, inner: segment });
  }
  // Bringing back a deleted block break would part the syntax on either side of it.
  for (const mark of planning.parsed.marks) {
    if (mark.kind !== 'del') continue;
    for (const { open, payload } of mark.segments) {
      if (open.from < layout.range.from || open.from > layout.range.to) continue;
      if (payload?.includes('\n')) nesters.push(point(indexAt(layout, open.to)));
    }
  }
  // Code hides what is in it, the markers as well.
  if (format === 'code') for (const joint of layout.joints) nesters.push(point(joint));
  return nesters;
}

/** A piece that is all of the text of a format or a link goes around its syntax. It stays in what
 * holds it. */
function aroundSyntax(layout: Layout, start: Piece, nesters: readonly Nester[]): Piece {
  let piece = start;
  const walls = nesters.filter((nester) => nester.always);
  const fits = (wider: Piece) => !walls.some((wall) => crosses(wider, wall));
  for (let changed = true; changed;) {
    changed = false;
    for (const { outer, inner, always } of nesters) {
      if (always || outer.to - outer.from === inner.to - inner.from) continue;
      const text = trimmed(layout, inner);
      if (text?.from !== piece.from || text.to !== piece.to || !fits(outer)) continue;
      piece = outer;
      changed = true;
      break;
    }
  }
  return piece;
}

/** Where the opener of a piece goes, after looking at the places of both markers. Only the markers
 * of a mark that the piece gets are looked at. */
function markerPlaces(planning: Planning, layout: Layout, from: number, to: number): number {
  const { text, hidden } = planning;
  if (layout.bareRow) throw refused(BARE_ROW);
  const check = (place: Place) => {
    // What a marker does to the delimiters next to it comes out in the last check of the change.
    if (place.kind === 'refuse') throw refused(place.reason);
    if (place.kind === 'construct') throw refused(FLANK);
  };
  const a = startOf(layout, from);
  check(inspectPlace(text, hidden, a));
  let opener = a;
  if (lineStartKind(text, a, hidden) === 'continuation') {
    // The marker can't start the line: it goes at the end of the one before, with the line break
    // in the mark (format §3.2).
    opener = breakStart(text, a);
    if (hidden.some((m) => m.role === 'open' && m.mark?.kind === 'split' && m.to === opener)) {
      throw refused('Text can not start the line after a line break that someone inserted yet.');
    }
    // A line of nothing but syntax takes no marker, and a bullet with no text is such a line.
    check(inspectPlace(text, hidden, opener));
    if (/^[ \t>]*[-*+][ \t]*$/.test(text.slice(lineStart(text, opener), opener))) {
      throw refused(FLANK);
    }
  }
  check(inspectPlace(text, hidden, endOf(layout, to), { joined: true }));
  const { v, roles } = layout;
  // A marker never cuts a run of delimiters in two (format §3.1). Syntax that a format reads stays
  // as it is read, and the last check of the change looks at that.
  for (const at of [from, to]) {
    const c = v[at];
    const inRun =
      (c === '*' || c === '_' || c === '~') && v[at - 1] === c && !layout.joints.has(at);
    if (inRun && (roles[at] === TEXT || roles[at - 1] === TEXT)) throw refused(FLANK);
  }
  // Never next to a `_` that has a letter or a digit on its other side (format §3.1, rule 5).
  const none = new Set<number>();
  const outerBefore = v[from - 1] === '_' && roles[from - 1] !== SYNTAX;
  const outerAfter = v[to] === '_' && roles[to] !== SYNTAX;
  if (
    (outerBefore && isWord(charBefore(v, from - 1, none))) ||
    (outerAfter && isWord(charAfter(v, to + 1, none)))
  ) {
    throw refused(FLANK);
  }
  return opener;
}

/** The innermost insertion or substitution that all of a piece is in. */
function holderOf(holders: readonly Holder[], piece: Piece): Holder | undefined {
  return holders
    .filter((holder) => holder.from <= piece.from && piece.to <= holder.to)
    .toSorted((a, b) => a.to - a.from - (b.to - b.from))[0];
}

/** The step that writes syntax around a piece. */
function wrapStep(
  planning: Planning,
  layout: Layout,
  holders: readonly Holder[],
  piece: Piece,
  left: string,
  right: string,
  op: string,
): Step {
  const a = startOf(layout, piece.from);
  const b = endOf(layout, piece.to);
  const holder = planning.tracked ? holderOf(holders, piece) : undefined;
  if (!planning.tracked || holder?.own) {
    const step: Step = { kind: 'wrap', at: a, a, b, opener: a, left, right, op };
    if (holder) step.own = holder.mark.id;
    return step;
  }
  const opener = markerPlaces(planning, layout, piece.from, piece.to);
  return { kind: 'wrap', at: a, a, b, opener, left, right, op };
}

function inTheWay(planning: Planning, mark: MarkRange): EditError {
  const name = nameOf(planning.parsed, mark, planning.author);
  return refused(
    `Formatting can't be changed here until ${name} is decided. Accept or reject it first.`,
  );
}

/** The changes that take a segment's markers away, or with `rest`, write its opener again with those
 * operations; and that give the text what undoing `ops` gives it. */
function segmentChanges(
  reader: FormatReader,
  mark: MarkRange,
  segment: Segment,
  ops: readonly ParsedFormatOp[],
  rest: readonly ParsedFormatOp[] = [],
): TextChange[] {
  const undone = undoOf(reader, segment, ops);
  const start = segment.carrier?.to ?? segment.content.from;
  const opener = openerRange(segment);
  const close = segment.close ?? { from: segment.content.to, to: segment.content.to };
  // What is written at the place of a marker goes in one change with it.
  const changes = [...undone.changes];
  if (rest.length > 0) {
    const written = `<!--fmt ${mark.id} ${rest.map((op) => op.source).join(' ')}-->`;
    changes.push({ ...segment.open, insert: written });
    if (undone.left !== '') changes.push({ from: undone.at, to: undone.at, insert: undone.left });
    changes.push({ from: segment.content.to, to: segment.content.to, insert: undone.right });
  } else {
    if (undone.at === start) changes.push({ ...opener, insert: undone.left });
    else {
      changes.push({ ...opener, insert: '' });
      changes.push({ from: undone.at, to: undone.at, insert: undone.left });
    }
    changes.push({ from: segment.content.to, to: close.to, insert: undone.right });
  }
  return changes
    .filter((change) => change.from < change.to || change.insert !== '')
    .toSorted((a, b) => a.from - b.from || a.to - b.to);
}

/** What undoing `ops` does to a segment's text: `left` goes at `at`, the place of the first text in
 * the mark, `right` at the end of the mark, and `changes` are the syntax that goes. */
function undoOf(
  reader: FormatReader,
  segment: Segment,
  ops: readonly ParsedFormatOp[],
): { at: number; left: string; right: string; changes: TextChange[] } {
  const start = segment.carrier?.to ?? segment.content.from;
  const end = segment.content.to;
  const none = { at: start, left: '', right: '', changes: [] };
  if (end <= start || ops.length === 0) return none;
  const layout = readLayout(reader, paragraphRange(reader.text, reader.hidden, start));
  const first = indexAt(layout, start);
  const to = indexAt(layout, end);
  // A mark that starts a wrapped line has the line break and the prefix of the line in it.
  let from = first;
  while (from < to && (layout.roles[from] === PREFIX || isSpace(layout.v[from]))) from++;
  if (from >= to) return none;
  const at = from > first ? startOf(layout, from) : start;
  /** Whether only syntax comes between the first text of the mark and `index`. */
  const leads = (index: number) => {
    for (let i = from; i < index; i++) if (layout.roles[i] !== SYNTAX) return false;
    return true;
  };
  const changes: TextChange[] = [];
  let left = '';
  let right = '';
  for (const op of ops) {
    const { name, sign, value } = op;
    if (name === 'link') {
      if (sign === '-') {
        left += '[';
        right = `](${value ?? ''})${right}`;
        continue;
      }
      const link = layout.links.find(
        (l) => l.inline && l.from >= from && l.to <= to && leads(l.from),
      );
      if (!link) throw refused(LOST_SYNTAX);
      if (sign === '+') {
        changes.push({
          from: startOf(layout, link.from),
          to: endOf(layout, link.text.from),
          insert: '',
        });
        changes.push({
          from: startOf(layout, link.text.to),
          to: endOf(layout, link.to),
          insert: '',
        });
      } else {
        const url = urlIn(layout.v, link);
        changes.push({ ...inFile(layout, url), insert: value ?? '' });
      }
    } else if (isInlineFormat(name) && sign === '-') {
      const syntax = value ?? DELIMITER[name];
      // A rejection does not leave `_` against a letter or a digit (format §2.6).
      const letters =
        isWord(charBefore(layout.v, from, new Set())) || isWord(charAfter(layout.v, to, new Set()));
      const written = letters ? syntax.replaceAll('_', '*') : syntax;
      left += written;
      right = [...written].reverse().join('') + right;
    } else if (isInlineFormat(name)) {
      const span = layout.spans.find(
        (s) => s.format === name && s.open.from >= from && s.close.to <= to && leads(s.open.from),
      );
      if (!span) throw refused(LOST_SYNTAX);
      changes.push({ ...inFile(layout, span.open), insert: '' });
      changes.push({ ...inFile(layout, span.close), insert: '' });
    }
  }
  return { at, left, right, changes };
}

/** The address of a link: what stands in its parentheses, without a title. */
function urlIn(v: string, link: LinkSpan): Range {
  const { from, to } = link.dest;
  const raw = v.slice(from, to);
  const lead = /^\s*/.exec(raw)?.[0].length ?? 0;
  if (raw[lead] === '<') {
    let close = lead + 1;
    while (close < raw.length && raw[close] !== '>') close += raw[close] === '\\' ? 2 : 1;
    return { from: from + lead, to: from + Math.min(close + 1, raw.length) };
  }
  const end = /\s/.exec(raw.slice(lead))?.index;
  return { from: from + lead, to: end === undefined ? to : from + lead + end };
}

/** An address as a link's destination is written. */
function writtenUrl(url: string): string {
  return /[\s()<>]/.test(url) ? `<${url.replace(/[<>\\]/g, '\\$&')}>` : url;
}

function assertWritableUrl(url: string): void {
  assertNoMarkup(url);
  if (/<!--|-->|[\r\n]/.test(url)) {
    throw new EditError("This address can't be written in a link.", 'markup');
  }
}

/** The step that takes back one operation of a format change of the author's own. */
function cancelStep(planning: Planning, layout: Layout, seg: FormatSegment, index: number): Step {
  const rest = seg.ops.filter((_, i) => i !== index);
  const op = seg.ops[index];
  return {
    kind: 'edit',
    at: startOf(layout, seg.from),
    changes: segmentChanges(planning, seg.mark, seg.segment, op ? [op] : [], rest),
    id: seg.mark.id,
    kept: rest.length > 0,
  };
}

function refuseInCode(layout: Layout, clamp: Piece): void {
  for (const span of layout.spans) {
    if (span.format !== 'code') continue;
    if (span.open.to <= clamp.from && clamp.to <= span.close.from) {
      throw new EditError(IN_CODE_SPAN, 'inside-code');
    }
  }
}

function refuseInComment(layout: Layout, clamp: Piece): void {
  for (const hit of layout.hits) {
    if (hit.kind === 'comment' && hit.from < clamp.from && clamp.to < hit.to) {
      throw new EditError(IN_VERBATIM, 'inside-code');
    }
  }
}

/** Formats that are off in `clamp` turned on: what has it already is left out. */
function planOn(planning: Planning, layout: Layout, clamp: Piece, format: InlineFormat): Step[] {
  if (format !== 'code') refuseInCode(layout, clamp);
  refuseInComment(layout, clamp);
  const start = trimmed(layout, clamp);
  if (!start) return [];
  const steps: Step[] = [];
  const skip: Range[] = [];
  for (const { format: other, open, close } of layout.spans) {
    if (other === format) skip.push({ from: open.from, to: close.to });
  }
  for (const seg of formatSegmentsIn(planning, layout)) {
    if (!overlaps(seg, start)) continue;
    const index = seg.ops.findIndex((op) => op.name === format && op.sign === '-');
    if (index === -1) continue;
    if (!seg.own) throw inTheWay(planning, seg.mark);
    steps.push(cancelStep(planning, layout, seg, index));
    skip.push(seg);
  }
  const nesters = nestersFor(planning, layout, format);
  const holders = holdersIn(planning, layout);
  for (const free of without(overAtoms(layout, start), skip)) {
    for (const cut of nested(layout, free, nesters)) {
      const piece = aroundSyntax(layout, cut, nesters);
      const [left, right] = syntaxFor(format, layout.v.slice(piece.from, piece.to));
      steps.push(wrapStep(planning, layout, holders, piece, left, right, `+${format}`));
    }
  }
  return steps;
}

/** The syntax around text of a format. Code takes more backticks than the text has in a row, and a
 * space inside them next to a backtick. */
function syntaxFor(format: InlineFormat, text: string): [string, string] {
  if (format !== 'code') return [DELIMITER[format], DELIMITER[format]];
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const run = '`'.repeat(longest + 1);
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
  return [run + pad, pad + run];
}

/** Spans that stand directly one inside the other, written as one removal. */
interface Stack {
  spans: Span[];
  depth: number;
}

/** The spans in stacks, from outside in, with how many other stacks are around each. */
function stacksOf(layout: Layout, spans: readonly Span[]): Stack[] {
  const stacks: Stack[] = [];
  for (const span of spans.toSorted(
    (a, b) => a.open.from - b.open.from || b.close.to - a.close.to,
  )) {
    const on = stacks.find((stack) => {
      const inner = stack.spans.at(-1);
      return (
        inner &&
        inner.open.to === span.open.from &&
        inner.close.from === span.close.to &&
        !layout.joints.has(span.open.from) &&
        !layout.joints.has(span.close.to)
      );
    });
    if (on) on.spans.push(span);
    else stacks.push({ spans: [span], depth: 0 });
  }
  for (const stack of stacks) {
    const [outer] = stack.spans;
    if (!outer) continue;
    stack.depth = stacks.filter((other) => {
      const around = other.spans[0];
      return (
        around &&
        other !== stack &&
        around.open.from <= outer.open.from &&
        outer.close.to <= around.close.to
      );
    }).length;
  }
  return stacks;
}

/** Formats in `clamp` turned off: all of the run of each that it touches. */
function planOff(
  planning: Planning,
  layout: Layout,
  clamp: Piece,
  formats: readonly InlineFormat[],
  clearing: boolean,
): Step[] {
  if (!formats.includes('code')) refuseInCode(layout, clamp);
  refuseInComment(layout, clamp);
  const start = trimmed(layout, clamp);
  if (!start) return [];
  const steps: Step[] = [];
  const segments = formatSegmentsIn(planning, layout);
  const free: Span[] = [];
  for (const span of layout.spans) {
    if (!formats.includes(span.format)) continue;
    if (!overlaps({ from: span.open.to, to: span.close.from }, start)) continue;
    // Clearing leaves code that holds Markdown: without the backticks, the words would change.
    if (clearing && span.format === 'code') {
      if (/[\\*_~`<[&]/.test(layout.v.slice(span.open.to, span.close.from))) continue;
    }
    const pending = segments.find(
      (seg) =>
        seg.from <= span.open.from &&
        span.close.to <= seg.to &&
        seg.ops.some((op) => op.name === span.format && op.sign === '+'),
    );
    if (!pending) {
      free.push(span);
      continue;
    }
    if (!pending.own) throw inTheWay(planning, pending.mark);
    const index = pending.ops.findIndex((op) => op.name === span.format && op.sign === '+');
    steps.push(cancelStep(planning, layout, pending, index));
  }
  const holders = planning.tracked ? holdersIn(planning, layout) : [];
  for (const { spans, depth } of stacksOf(layout, free)) {
    const outer = spans[0];
    const inner = spans.at(-1);
    if (!outer || !inner) continue;
    const side = (index: number) =>
      holders.filter((holder) => holder.from <= index && index <= holder.to);
    const before = side(outer.open.to);
    const after = side(outer.close.from);
    if (before.length !== after.length || before.some((holder, i) => holder !== after[i])) {
      throw refused(STRADDLES);
    }
    const all: Piece = { from: outer.open.from, to: outer.close.to };
    const holder = holderOf(holders, all);
    const opens = inFile(layout, { from: outer.open.from, to: inner.open.to });
    const closes = inFile(layout, { from: inner.close.from, to: outer.close.to });
    const op = spans
      .map((s) => removedOp(s.format, layout.v.slice(s.open.from, s.open.to)))
      .join(' ');
    if (!planning.tracked || holder?.own) {
      const step: Step = {
        kind: 'unwrap',
        at: opens.from,
        opens,
        closes,
        opener: opens.from,
        op,
        depth,
      };
      if (holder) step.own = holder.mark.id;
      steps.push(step);
    } else {
      const opener = markerPlaces(planning, layout, all.from, all.to);
      steps.push({ kind: 'unwrap', at: opens.from, opens, closes, opener, op, depth });
    }
  }
  return steps;
}

/** A link of a format change of the author's own, changed in place. */
function ownLinkStep(
  planning: Planning,
  layout: Layout,
  seg: FormatSegment,
  index: number,
  url: string | null,
): Step | undefined {
  const op = seg.ops[index];
  if (!op) return undefined;
  const at = startOf(layout, seg.from);
  const id = seg.mark.id;
  const rest = seg.ops.filter((_, i) => i !== index);
  const replaced = (source: string, changes: TextChange[]): Step => {
    const payload = [...rest.map((other) => other.source), source].join(' ');
    const written = `<!--fmt ${id} ${payload}-->`;
    return {
      kind: 'edit',
      at,
      changes: [{ ...seg.segment.open, insert: written }, ...changes],
      id,
      kept: true,
    };
  };
  const link = layout.links.find((l) => l.inline && l.from >= seg.from && l.to <= seg.to);
  // A link that was there before, whose address was changed or removed.
  if (op.sign === '-') {
    if (url === null) return undefined;
    if (url === op.value) return cancelStep(planning, layout, seg, index);
    // The address it had, and what stood after it stays after the new one.
    const old = op.value ?? '';
    const lead = urlIn(old, {
      from: 0,
      to: old.length,
      text: { from: 0, to: 0 },
      dest: { from: 0, to: old.length },
      inline: true,
    });
    const after = old.slice(lead.to);
    const start = seg.segment.carrier?.to ?? seg.segment.content.from;
    return replaced(`link=${encodeValue(old.slice(lead.from, lead.to))}`, [
      { from: start, to: start, insert: '[' },
      {
        from: seg.segment.content.to,
        to: seg.segment.content.to,
        insert: `](${writtenUrl(url)}${after})`,
      },
    ]);
  }
  if (!link) throw refused(LOST_SYNTAX);
  const place = urlIn(layout.v, link);
  if (url === null) {
    if (op.sign === '+') return cancelStep(planning, layout, seg, index);
    // The title it has is the one it had.
    const old = op.value ?? '';
    const after = layout.v.slice(place.to, link.dest.to);
    return replaced(`-link=${encodeValue(old + after)}`, [
      { from: startOf(layout, link.from), to: endOf(layout, link.text.from), insert: '' },
      { from: startOf(layout, link.text.to), to: endOf(layout, link.to), insert: '' },
    ]);
  }
  const insert = writtenUrl(url);
  if (op.sign === '' && (url === op.value || insert === op.value)) {
    return cancelStep(planning, layout, seg, index);
  }
  if (insert === layout.v.slice(place.from, place.to)) return undefined;
  return { kind: 'edit', at, changes: [{ ...inFile(layout, place), insert }], id, kept: true };
}

function planLink(planning: Planning, layout: Layout, clamp: Piece, url: string | null): Step[] {
  refuseInCode(layout, clamp);
  refuseInComment(layout, clamp);
  const start = trimmed(layout, clamp);
  if (!start) return [];
  const steps: Step[] = [];
  const skip: Range[] = [];
  for (const seg of formatSegmentsIn(planning, layout)) {
    if (!overlaps(seg, start)) continue;
    const index = seg.ops.findIndex((op) => op.name === 'link');
    if (index === -1) continue;
    if (!seg.own) throw inTheWay(planning, seg.mark);
    const step = ownLinkStep(planning, layout, seg, index, url);
    if (step) steps.push(step);
    skip.push(seg);
  }
  for (const link of layout.links) {
    if (skip.some((range) => overlaps(range, link))) continue;
    if (!overlaps(link.text, start)) continue;
    if (!link.inline) throw refused(REFERENCE);
    skip.push(link);
    const place = urlIn(layout.v, link);
    const old = layout.v.slice(place.from, place.to);
    const all = { from: link.from, to: link.to };
    const outer = inFile(layout, all);
    const holder = planning.tracked ? holderOf(holdersIn(planning, layout), all) : undefined;
    const direct = !planning.tracked || holder?.own === true;
    const opener = direct ? outer.from : markerPlaces(planning, layout, all.from, all.to);
    if (url === null) {
      const dest = layout.v.slice(link.dest.from, link.dest.to);
      const step: Step = {
        kind: 'unwrap',
        at: outer.from,
        opens: inFile(layout, { from: link.from, to: link.text.from }),
        closes: inFile(layout, { from: link.text.to, to: link.to }),
        opener,
        op: `-link=${encodeValue(dest)}`,
        depth: 0,
      };
      if (holder?.own) step.own = holder.mark.id;
      steps.push(step);
    } else {
      const insert = writtenUrl(url);
      if (insert === old) continue;
      const address = inFile(layout, place);
      if (holder?.own) {
        const changes = [{ ...address, insert }];
        steps.push({ kind: 'edit', at: outer.from, changes, id: holder.mark.id, kept: true });
      } else {
        steps.push({
          kind: 'relink',
          at: outer.from,
          outer,
          opener,
          url: address,
          insert,
          op: `link=${encodeValue(old)}`,
        });
      }
    }
  }
  if (url !== null) {
    // A link can't hold a link, and an autolink is one.
    for (const hit of layout.hits) if (hit.kind === 'autolink') skip.push(hit);
    const nesters = nestersFor(planning, layout);
    const holders = holdersIn(planning, layout);
    const right = `](${writtenUrl(url)})`;
    for (const free of without(overAtoms(layout, start), skip)) {
      for (const cut of nested(layout, free, nesters)) {
        const piece = aroundSyntax(layout, cut, nesters);
        steps.push(wrapStep(planning, layout, holders, piece, '[', right, '+link'));
      }
    }
  }
  return steps;
}

function planParagraph(planning: Planning, layout: Layout, clamp: Piece, op: FormatOp): Step[] {
  switch (op.kind) {
    case 'inline':
      return op.on
        ? planOn(planning, layout, clamp, op.format)
        : planOff(planning, layout, clamp, [op.format], false);
    case 'clear':
      return planOff(planning, layout, clamp, INLINE_FORMATS, true);
    case 'link':
      return planLink(planning, layout, clamp, op.url);
    default:
      throw new EditError('This format change is not supported yet.', 'not-supported');
  }
}

/** What a change does, block by block. */
interface Plan {
  planning: Planning;
  blocks: Step[][];
}

function planFormat(
  text: string,
  range: Range,
  op: FormatOp,
  tracked: boolean,
  author: Person | undefined,
): Plan {
  if (range.from < 0 || range.to < range.from || range.to > text.length) {
    throw new RangeError(
      `The range ${range.from}-${range.to} is out of order or outside the text (${text.length} characters)`,
    );
  }
  if (op.kind === 'link' && op.url !== null) assertWritableUrl(op.url);
  const parsed = parse(text);
  const planning: Planning = {
    ...formatReader(text, parsed),
    parsed,
    me: tracked ? author?.handle : undefined,
    author,
    tracked,
  };
  const limit = parsed.ledgerRange?.from ?? text.length;
  const to = Math.min(limit, snapOut(planning.hidden, range.to, false));
  let from = Math.min(to, snapOut(planning.hidden, range.from, true));
  const blocks: Step[][] = [];
  if (from >= to) return { planning, blocks };
  const front = frontMatterEnd(text);
  if (front >= 0 && from <= front) {
    if (to <= front) throw new EditError("Front matter can't be formatted.", 'front-matter');
    from = front + 1;
  }
  let inVerbatim = false;
  let elsewhere = false;
  for (const paragraph of paragraphsIn(planning, from, to)) {
    if (paragraph.to <= from || paragraph.from >= to) continue;
    if (planning.verbatim.some((v) => v.from <= paragraph.from && paragraph.to <= v.to)) {
      inVerbatim = true;
      continue;
    }
    elsewhere = true;
    const layout = readLayout(planning, paragraph);
    const clamp = {
      from: indexAt(layout, Math.max(from, paragraph.from)),
      to: indexAt(layout, Math.min(to, paragraph.to)),
    };
    if (clamp.from >= clamp.to) continue;
    const steps = planParagraph(planning, layout, clamp, op);
    if (steps.length > 0) blocks.push(steps.toSorted((a, b) => a.at - b.at));
  }
  if (inVerbatim && !elsewhere) throw new EditError(IN_VERBATIM, 'inside-code');
  return { planning, blocks };
}

/** The changes of a file's body, in the order they go. */
const inOrder = (changes: readonly TextChange[]): TextChange[] =>
  changes.toSorted((a, b) => a.from - b.from || a.to - b.to);

/** The body of a file without the line breaks that end it. */
function bodyWithoutEnd(text: string): string {
  const range = parse(text).ledgerRange;
  return (range ? text.slice(0, range.from) : text).replace(/[\r\n]+$/, '');
}

/** The message of a change that came out other than it should. */
const SELF_CHECK =
  "This format change can't be written here without altering other text. Make it on less text, or decide the changes next to it first.";

/**
 * Looks at what the change makes of the file, as a last check. The plain text is what it was, while
 * the marks are pending and once they are accepted: a delimiter that opens nothing would be read
 * as text. And rejecting the new marks gives back the bytes of the body, up to what the change did
 * with no mark (`direct`).
 */
function selfCheck(
  text: string,
  after: string,
  created: readonly string[],
  direct: readonly TextChange[],
): void {
  const parsed = parse(after);
  const reader = formatReader(after, parsed);
  const marks = parsed.marks.filter((mark) => created.includes(mark.id));
  const gone = marks.flatMap((mark) =>
    mark.segments.flatMap((segment) => {
      const changes: TextChange[] = [{ ...openerRange(segment), insert: '' }];
      if (segment.close) changes.push({ ...segment.close, insert: '' });
      return changes;
    }),
  );
  const accepted = applyChanges(after, inOrder(gone));
  for (const punctuation of [isPunctuation, isOlderPunctuation]) {
    const plain = plainBody(text, punctuation);
    if (plainBody(after, punctuation) !== plain || plainBody(accepted, punctuation) !== plain) {
      throw refused(READS_OTHERWISE);
    }
  }
  let undone: string;
  try {
    const undo = marks.flatMap((mark) =>
      mark.segments.flatMap((segment) => {
        return segmentChanges(reader, mark, segment, opsOf(mark, segment));
      }),
    );
    undone = applyChanges(after, inOrder(undo));
  } catch {
    throw refused(SELF_CHECK);
  }
  if (bodyWithoutEnd(undone) !== bodyWithoutEnd(applyChanges(text, inOrder(direct)))) {
    throw refused(SELF_CHECK);
  }
}

/**
 * The change as tracked `fmt` marks by `ctx.author`: one mark per block, sharing a `group` when there
 * are several, which is `ctx.group` or a new id. Text in the author's own insertion gets the syntax
 * with no mark, and a pending format change of the author's that this one turns back goes away.
 * `range` covers visible text, as `trackedEdit`'s does. Nothing changes where the text is as asked.
 *
 * @throws RangeError when the range lies outside the text.
 * @throws EditError in the words the editor shows: in code (`inside-code`), in front matter
 *   (`front-matter`), where another person's pending format change or the placement of the markers
 *   is in the way (`no-legal-placement`), for an address that would be read as markup (`markup`).
 */
export function trackedFormat(
  text: string,
  range: Range,
  op: FormatOp,
  ctx: EditContext,
): TrackedEdits {
  const { planning, blocks } = planFormat(text, range, op, true, ctx.author);
  if (blocks.length === 0) return { changes: [], markIds: [], extendedIds: [] };
  const { parsed } = planning;
  const taken = idsIn(text);
  const draw = () => {
    const id = newId(taken, ctx.random);
    taken.add(id);
    return id;
  };
  const created: string[] = [];
  const segments = new Map<string, number>();
  const body: TextChange[] = [];
  const direct: TextChange[] = [];
  const extended: string[] = [];
  let removes = false;
  for (const steps of blocks) {
    const ids = new Map<number, string>();
    /** The id of a mark of this block at a depth; a new one for the first segment. */
    const idAt = (depth: number) => {
      const known = ids.get(depth);
      if (known !== undefined) {
        segments.set(known, (segments.get(known) ?? 0) + 1);
        return known;
      }
      const id = draw();
      ids.set(depth, id);
      created.push(id);
      segments.set(id, 1);
      return id;
    };
    for (const step of steps) {
      if (step.kind === 'edit') {
        direct.push(...step.changes);
        body.push(...step.changes);
        if (step.kept) extended.push(step.id);
        else removes = true;
      } else if (step.kind === 'wrap') {
        const { a, b, opener, left, right, op: written, own } = step;
        if (own !== undefined) {
          const changes = [
            { from: a, to: a, insert: left },
            { from: b, to: b, insert: right },
          ];
          direct.push(...changes);
          body.push(...changes);
          extended.push(own);
          continue;
        }
        const id = idAt(0);
        const open = `<!--fmt ${id} ${written}-->`;
        if (opener === a) body.push({ from: a, to: a, insert: open + left });
        else
          body.push({ from: opener, to: opener, insert: open }, { from: a, to: a, insert: left });
        body.push({ from: b, to: b, insert: `${right}<!--/${id}-->` });
      } else if (step.kind === 'unwrap') {
        const { opens, closes, opener, op: written, depth, own } = step;
        if (own !== undefined) {
          const changes = [
            { ...opens, insert: '' },
            { ...closes, insert: '' },
          ];
          direct.push(...changes);
          body.push(...changes);
          extended.push(own);
          continue;
        }
        const id = idAt(depth);
        const open = `<!--fmt ${id} ${written}-->`;
        if (opener === opens.from) body.push({ ...opens, insert: open });
        else body.push({ from: opener, to: opener, insert: open }, { ...opens, insert: '' });
        body.push({ ...closes, insert: `<!--/${id}-->` });
      } else {
        const { outer, opener, url, insert, op: written } = step;
        const id = idAt(0);
        const open = `<!--fmt ${id} ${written}-->`;
        body.push(
          { from: opener, to: opener, insert: open },
          { ...url, insert },
          { from: outer.to, to: outer.to, insert: `<!--/${id}-->` },
        );
      }
    }
  }
  const ledger = workingLedger(parsed.ledger);
  if (created.length > 0) addPerson(ledger, ctx.author);
  const group = ctx.group ?? (created.length > 1 ? draw() : undefined);
  for (const id of created) {
    const entry: MarkEntry = { by: ctx.author.handle, at: ctx.time };
    if (group !== undefined) entry.group = group;
    if (ctx.note !== undefined) entry.note = ctx.note;
    ledger.marks[id] = entry;
  }
  const changes = commitEdit(text, body, ledger, {
    parsed,
    created,
    ...(removes && created.length === 0 ? { removes: true } : {}),
    verify: (_after, read) => {
      for (const id of created) {
        const mark = read.marks.find((candidate) => candidate.id === id);
        if (mark?.segments.length !== segments.get(id)) {
          throw new EditError(IN_VERBATIM, 'inside-code');
        }
      }
    },
  });
  selfCheck(text, applyChanges(text, changes), created, direct);
  return { changes, markIds: created, extendedIds: [...new Set(extended)] };
}

/** Where a position of the text went, in front of what the changes put right at it. */
function positionAfter(changes: readonly TextChange[], position: number): number {
  let delta = 0;
  for (const change of changes) {
    if (change.to > position || (change.to === position && change.from === change.to)) break;
    delta += change.insert.length - (change.to - change.from);
  }
  return position + delta;
}

/**
 * The same change made directly: each piece of syntax goes through `untrackedEdit`'s rules, as typed
 * or deleted text, so that it stays outside pending insertions, and makes no mark. It refuses what
 * `trackedFormat` refuses, and what `untrackedEdit` refuses.
 *
 * @throws RangeError when the range lies outside the text.
 * @throws EditError as `trackedFormat` and `untrackedEdit` do.
 */
export function untrackedFormat(
  text: string,
  range: Range,
  op: FormatOp,
  ctx: UntrackedContext = {},
): TextChange[] {
  const { blocks } = planFormat(text, range, op, false, ctx.author);
  const edits: TextChange[] = [];
  for (const step of blocks.flat()) {
    if (step.kind === 'wrap') {
      edits.push(
        { from: step.a, to: step.a, insert: step.left },
        { from: step.b, to: step.b, insert: step.right },
      );
    } else if (step.kind === 'unwrap') {
      edits.push({ ...step.opens, insert: '' }, { ...step.closes, insert: '' });
    } else if (step.kind === 'relink') {
      edits.push({ ...step.url, insert: step.insert });
    }
  }
  // From the end, so that what comes first is where it was, unless a repair moved it.
  let todo = inOrder(edits);
  let changes: TextChange[] = [];
  let current = text;
  for (let edit = todo.pop(); edit; edit = todo.pop()) {
    const step = untrackedEdit(current, edit, ctx);
    changes = spliceRepairs(text, changes, current, step);
    current = applyChanges(current, step);
    todo = todo.map((later) => ({
      ...later,
      from: positionAfter(step, later.from),
      to: positionAfter(step, later.to),
    }));
  }
  for (const punctuation of [isPunctuation, isOlderPunctuation]) {
    if (plainBody(current, punctuation) !== plainBody(text, punctuation)) {
      throw refused(READS_OTHERWISE);
    }
  }
  return changes;
}

/**
 * The changes that decide one segment of a format change: its markers go, and rejecting it undoes
 * its operations, so that the text is as it was.
 *
 * @throws EditError when its text no longer has the formatting that rejecting takes away.
 */
export function formatDecision(
  reader: FormatReader,
  mark: MarkRange,
  segment: Segment,
  action: 'accept' | 'reject',
): TextChange[] {
  return segmentChanges(reader, mark, segment, action === 'reject' ? opsOf(mark, segment) : []);
}

/**
 * What a decision about format changes rewrites: `_` emphasis that a marker it takes away kept off a
 * letter or a digit would render literally (`re_built_`), so it is written with `*` (format §2.6).
 * `changes` are those of the decision.
 */
export function underscoreRewrites(
  reader: FormatReader,
  segments: readonly Segment[],
  changes: readonly TextChange[],
): TextChange[] {
  const sorted = inOrder(changes);
  /** Whether the changes take away all of a range that holds something, and write nothing there. */
  const cleared = ({ from, to }: Range) => {
    if (from >= to) return false;
    let at = from;
    for (const change of sorted) {
      if (change.to < at || change.from > to) continue;
      if (change.insert !== '') return false;
      if (change.from <= at && change.to > at) at = change.to;
    }
    return at >= to;
  };
  const rewrites: TextChange[] = [];
  const seen = new Set<number>();
  const none = new Set<number>();
  for (const segment of segments) {
    const start = segment.carrier?.to ?? segment.content.from;
    const paragraph = paragraphRange(reader.text, reader.hidden, start);
    if (seen.has(paragraph.from)) continue;
    seen.add(paragraph.from);
    const layout = readLayout(reader, paragraph);
    for (const span of layout.spans) {
      const { open, close } = span;
      if (layout.v[open.from] !== '_') continue;
      const before = { from: endOf(layout, open.from), to: startOf(layout, open.from) };
      const after = { from: endOf(layout, close.to), to: startOf(layout, close.to) };
      const exposed =
        (open.from > 0 && isWord(charBefore(layout.v, open.from, none)) && cleared(before)) ||
        (close.to < layout.v.length &&
          isWord(charAfter(layout.v, close.to, none)) &&
          cleared(after));
      if (!exposed) continue;
      const opens = inFile(layout, open);
      const closes = inFile(layout, close);
      if (sorted.some((change) => overlaps(change, opens) || overlaps(change, closes))) continue;
      const stars = '*'.repeat(open.to - open.from);
      rewrites.push({ ...opens, insert: stars }, { ...closes, insert: stars });
    }
  }
  return rewrites;
}
