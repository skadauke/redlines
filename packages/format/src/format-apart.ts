// The marks of a region that a format change is not tried against (format §2.6, "Marks apart").
//
// A format change is tried on its region, the whole list, table or block quote, in every order of
// the decisions of the marks there, and n marks have 2·n·3^(n-1) decisions: past five there are too
// many. In a list under review most marks are words that someone inserted, deleted or replaced in
// another item, and no decision of theirs can change what the change reads as. These are found
// here, and the walk leaves them pending while it tries the others (`walkDecisions`).
//
// A mark is apart when
// - it is an insertion, a deletion, a substitution or a highlight that accept and reject decide
//   (no table mark, no half of a move), each segment of it on one line, with no carrier, holding no
//   marker of another mark and inside no other mark;
// - what its decisions bring into the text or take out of it (its text, the old text of a deletion
//   or a substitution, the text of a highlight, whose markers stop standing between it and the text
//   next to it) holds no line break, no backtick, no `<` or `>`, no backslash, no `|` and no control
//   character;
// - its paragraph is none that the change writes in, and every mark there but a comment is apart;
// - each line of that paragraph starts, after its container prefix, with a character that no
//   marker holds: a letter or a digit, or for a row of a table under its delimiter row, the row's
//   `|` (the row then holds a character other than `|`, `-`, `:` and white space that no mark
//   holds, so that it never reads as a delimiter row; the header and the delimiter row hold no
//   mark, and every row of the table starts with a `|` that no mark holds, so that the table is one
//   whatever is decided); a line under the first has nothing but quote markers and white space in
//   front of it; no line has `<` or `>` after its prefix;
// - the paragraph's first line starts a block in every decision, as CommonMark reads it: it is the
//   first line of the region, or a blank line that no mark or edit touches is above it, or it is a
//   row, or it starts a list item in every decision (`itemEverywhere`, the reading of list items
//   `listItemAt`); and so does the line after its last: it is a blank line that no mark or edit
//   touches, or a list item in every decision, or, after a row, a row whose `|` no mark holds;
// - each run of marks next to one another on its lines stands between characters that no marker
//   holds: the one before is neither a backtick nor a backslash, and the one after is no backtick,
//   or the line ends there.
//
// A mark touches what its decisions take away or bring back. A split stands for its break: what
// rejecting it takes away, the line break, a blank line and the prefix of the next line
// (`splitEnd`). So a split at the end of the line before a paragraph, or before the blank line above
// it, touches the paragraph's first line, and its marks are not apart: rejecting the split would
// join the paragraph to the block before it.
//
// The walk compares the editor's reading, whose block reading (`lineStartKind`) takes more lines as
// list items than CommonMark does: a number other than 1 in the text of the item above or right
// under a wrapped line of it, and a bullet four columns or more past that text, CommonMark reads
// as more of the paragraph above (#139). A region with such a line, as it is written, leaves no
// mark apart (`holdsMisreadItem`), and is walked as it was before marks apart were; a state of the
// walk with one, which a decision made, tries every mark too (`pendingOf`). The guard reads list
// items as the block starts above do (`listItemAt`), so that the two can't come apart.
//
// Why no decision of these marks can change what the walk finds. Deciding one takes its markers
// away and leaves its text or puts its old text back, and does nothing else: no marker of it
// starts a line or stands alone on one, none of another mark is in it or around it, and what comes
// or goes can't start or end code, a comment or an HTML block (no backtick, `<` or `>`, no backslash
// before a backtick, no two backticks brought together). So it always works, alike in the file
// with the change and without it, and once the others are decided too, the same edit in both.
// Nor does it change whether another decision works, but in one way: while it is pending, a
// decision that would hide its markers in code or a comment is refused, which it may not be once it
// is decided. The walk looks for that: a decision refused in both files that works in them with
// the marks apart accepted makes it try every mark.
//
// What a file reads as is the plain text of its paragraphs, one after the other (`plainBody`). The
// paragraph of a mark apart begins and ends where it does in every decision, as the line before it
// or its own first line, and the line after its last, start blocks whatever is decided, and its
// lines never start one of their own. What a line of it starts with, and what it holds, never
// starts a definition, a fence, an HTML block, a comment or a delimiter row, nor makes another row
// of a table have other cells; what other lines read as looks at it no further than that. So a
// decision of a mark apart changes the plain text of its own paragraph and nothing else, alike in
// both files, and the reading of the other paragraphs doesn't depend on it, whatever else is
// decided. The walk makes sure of the first part as it goes: at each state it reads, each
// paragraph of marks apart must be the paragraph it was without the change, with the same segments
// of those marks (a highlight's aside, as it changes no text), the same visible text and no marker
// of a mark that is tried, or it tries every mark. The walk compares the two files piece by piece:
// the paragraphs of the marks apart one by one, and the runs of other paragraphs between them.
// Pieces that are alike stay alike with the marks apart decided either way, as what changes in them
// changes alike. A paragraph of marks apart reads alike in the two files only if what it is read
// with is alike: its markers, which a reading as code would show, are there to tell. Where the
// pieces are alike only all together, or the definitions of the two files differ while a paragraph
// of marks apart has a bracket that one could make a link of, the walk tries every mark instead.
// The warnings it counts, and the bytes once the new marks are rejected, change alike in both files
// too.
//
// The first shortcut of this kind, when format changes were new, left out the marks of the
// change's own paragraph that did not stand next to its syntax, and tried them only all accepted
// and all rejected. Both were wrong: a delimiter far off in the paragraph pairs with the new one
// once a deletion next to it is decided, and one order of decisions works where another is
// refused. Every mark of the change's paragraph is tried here, as the reading of emphasis, code and
// links stays in a paragraph, and nothing is tried at its ends only: every state of the marks apart
// reads as the state with them pending.

import {
  lineEnd,
  lineStart,
  lineStartKind,
  openerRange,
  prefixLength,
  splitEnd,
} from './blocks.ts';
import { isDecidable } from './decide.ts';
import type { FormatReader } from './format-reader.ts';
import { DELIMITER_ROW, paragraphRange, visible } from './inline.ts';
import type { MarkRange, Parsed, Range, Segment } from './types.ts';

/** A paragraph of marks apart: the segments of those marks in it (`id:index`), how many of them are
 * of marks that change the text (all but highlights), and its visible text, which no decision of
 * any mark changes but theirs, and theirs not while they are pending. */
export interface ApartParagraph {
  segments: readonly string[];
  changing: number;
  shown: string;
}

/** The marks of a region that a change is not tried against, their paragraphs, and whether one of
 * those has a bracket, which a definition elsewhere can make a link. */
export interface Apart {
  ids: ReadonlySet<string>;
  paragraphs: readonly ApartParagraph[];
  bracketed: boolean;
}

/** The name of a segment of a mark, as `ApartParagraph` has it. */
export const segmentName = (mark: MarkRange, segment: Segment): string =>
  `${mark.id}:${mark.segments.indexOf(segment)}`;

const KINDS: ReadonlySet<string> = new Set(['ins', 'del', 'sub', 'hl']);

/** Whether `s` has what can start or end code, a comment, an HTML block, a cell or a line: a line
 * break, a backtick, `<`, `>`, a backslash, `|` or a control character. */
function holdsSyntax(s: string): boolean {
  for (const c of s) {
    const code = c.codePointAt(0) ?? 0;
    if ((code < 0x20 && c !== '\t') || code === 0x7f || code === 0x2028 || code === 0x2029) {
      return true;
    }
    if (c === '`' || c === '<' || c === '>' || c === '\\' || c === '|') return true;
  }
  return false;
}

/** What a decision of a segment brings into the text or takes out of it. */
function decidedText(text: string, mark: MarkRange, segment: Segment): string {
  const content = segment.close ? text.slice(segment.content.from, segment.content.to) : '';
  if (mark.kind === 'del') return segment.payload ?? '';
  if (mark.kind === 'sub') return `${segment.payload ?? ''}${content}`;
  return content;
}

/** The first line of a list item, as CommonMark reads it, in columns after its quote markers. */
interface Item {
  /** How many quote markers stand in front of it. */
  depth: number;
  /** Where its marker starts, and where its content does, after the quote markers. */
  marker: number;
  content: number;
  /** Where its text starts, in characters from the start of the line. */
  text: number;
  bullet: boolean;
  /** The number of a numbered item; 0 for a bullet. */
  number: number;
  /** The bullet, or the `.` or `)` after the number. */
  delimiter: string;
  /** Whether its text is indented code: more than four spaces stand after the marker. */
  code: boolean;
}

/** A line's quote markers (up to three spaces, a `>` and a space after it, each time): how many,
 * and how long they are. */
const QUOTES = /^(?: {0,3}> ?)*/;

const THEMATIC_BREAK = /^ {0,3}([-*_])(?: *\1){2,} *$/;

/** The list item that `line` starts, with text after its marker, as CommonMark reads its first
 * line: one to four spaces after the marker, or more and the content starts one space after it. A
 * thematic break is none, nor a line with a tab before its text, which counts in columns. */
function itemOf(line: string): Item | undefined {
  const quotes = QUOTES.exec(line)?.[0] ?? '';
  const rest = line.slice(quotes.length);
  if (THEMATIC_BREAK.test(rest)) return undefined;
  const item = /^( *)(?:([-*+])|(\d{1,9})([.)]))( +)(?=\S)/.exec(rest);
  if (!item || /\t/.test(line.slice(0, quotes.length + item[0].length))) return undefined;
  const marker = (item[1] ?? '').length;
  const width = (item[2] ?? `${item[3] ?? ''}${item[4] ?? ''}`).length;
  const spaces = (item[5] ?? '').length;
  return {
    depth: (quotes.match(/>/g) ?? []).length,
    marker,
    content: marker + width + (spaces > 4 ? 1 : spaces),
    text: quotes.length + item[0].length,
    bullet: item[2] !== undefined,
    number: item[3] === undefined ? 0 : Number(item[3]),
    delimiter: item[2] ?? item[4] ?? '',
    code: spaces > 4,
  };
}

/** A line's quote markers, how many. */
const depthOf = (line: string) => (QUOTES.exec(line)?.[0].match(/>/g) ?? []).length;

/** A line after its quote markers. */
const afterQuotes = (line: string) => line.slice(QUOTES.exec(line)?.[0].length ?? 0);

/** A list marker as the editor's block reading takes one (`lineStartKind`): after the quote
 * markers and indentation, a bullet or a number with `.` or `)`, then white space or the end. */
const LIST_START = /^(?:[ \t]*>)*[ \t]*(?:[-*+]|\d{1,9}[.)])(?=[ \t]|$)/;

/** What starts a block of its own after the container prefix, so that the line is no text of a
 * paragraph: a heading, a fence, a row, a setext underline, HTML. */
const OTHER_BLOCK = /^(?:#{1,6}(?:[ \t]|$)|`{3,}|~{3,}|\||=+[ \t]*$|-+[ \t]*$|<)/;

/** How the reading of list items (`listItemAt`) takes the lines of a file: as they are written, or
 * as they are in every decision of the marks in them. */
interface ListLines {
  text: string;
  /** The line that starts at `start`. */
  line: (start: number) => string;
  /** Whether the line at `start` is blank. */
  blank: (start: number) => boolean;
  /** Whether the prefix of the line at `start` and the character at `at` are as they are. */
  fixed: (start: number, at: number) => boolean;
  /** Whether the line at `start`, which starts no item, is text of a paragraph. */
  plain: (start: number) => boolean;
  known: Map<number, Item | null>;
}

/**
 * The list item that the line at `start` starts, as CommonMark reads it from the lines above it:
 * undefined when it starts none, or when the reading can't be sure. A bullet, or the number 1, less
 * than four columns in is an item in any container. Otherwise the reading goes up to the nearest
 * item at its column or to the left of it, past lines of text, items further in and blank lines,
 * when the line under each blank line is still in that item. At that item's column it is an item
 * as that one is, which it ends. Further in than that item's text, it is in it: an item when less
 * than four columns past the text (more is code, or more of a paragraph), and right under a line of
 * a paragraph only as a bullet or a 1, which alone interrupt one; after an item further in, or a
 * blank line, as anything. Anything else, and a line between the item's marker and its text, the
 * reading isn't sure of.
 */
function listItemAt(lines: ListLines, start: number, steps = 0): Item | undefined {
  const known = lines.known.get(start);
  if (known !== undefined) return known ?? undefined;
  if (steps > 50) return undefined;
  const found = readListItem(lines, start, steps);
  lines.known.set(start, found ?? null);
  return found;
}

function readListItem(lines: ListLines, start: number, steps: number): Item | undefined {
  const { text } = lines;
  const item = itemOf(lines.line(start));
  if (!item || !lines.fixed(start, start + item.text)) return undefined;
  const first = item.bullet || item.number === 1;
  if (first && item.marker <= 3) return item;
  // Right under a blank line, no paragraph is interrupted: anything less than four columns in.
  // Indented code goes on past a blank line, though, and micromark lets only what interrupts a
  // paragraph interrupt it: so the line above the blank lines is neither code nor an item of code.
  // A line of nothing but quote markers is blank only in a quote of its depth: with more or fewer,
  // it starts or ends a quote, which ends the item.
  const blankHere = (at: number) => lines.blank(at) && depthOf(lines.line(at)) === item.depth;
  if (start > 0 && blankHere(lineStart(text, start - 1)) && item.marker <= 3) {
    let above = lineStart(text, start - 1);
    while (above > 0 && blankHere(above)) above = lineStart(text, above - 1);
    const line = lines.line(above);
    const indent = /^ */.exec(afterQuotes(line))?.[0].length ?? 0;
    const alike = depthOf(line) === item.depth;
    if (blankHere(above) || (alike && indent <= 3 && itemOf(line)?.code !== true)) return item;
  }
  /** Whether the nearest item further in, under the item above, is still open right above the
   * line, which then ends it and interrupts no paragraph. */
  let nested: boolean | undefined;
  /** The least marker column of an item further in: one left of the text of the item above ends
   * that item. */
  let inner = Infinity;
  /** Whether a paragraph goes on right above the line. */
  let paragraph: boolean | undefined;
  /** The least and the most indentation of a line right under a blank line, between the item
   * above and this one: less than the item's text ends the item, and four columns past it is code,
   * which no line goes on lazily. */
  let under = Infinity;
  let deep = 0;
  for (let below = start, n = 0; below > 0 && n < 200; n++) {
    const at = lineStart(text, below - 1);
    if (lines.blank(at)) {
      if (depthOf(lines.line(at)) !== item.depth) return undefined;
      paragraph ??= false;
      if (below !== start) {
        const indent = /^ */.exec(afterQuotes(lines.line(below)))?.[0].length ?? 0;
        under = Math.min(under, indent);
        deep = Math.max(deep, indent);
      }
      below = at;
      continue;
    }
    const line = lines.line(at);
    if (depthOf(line) !== item.depth) return undefined;
    paragraph ??= true;
    if (itemOf(line)) {
      const over = listItemAt(lines, at, steps + 1);
      // An item of code ends at the first line that is not in it: no line of it goes on lazily.
      if (
        !over ||
        over.code ||
        /^(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)|^>/.test(line.slice(over.text))
      ) {
        return undefined;
      }
      if (over.marker > item.marker) {
        nested ??= under >= over.content;
        inner = Math.min(inner, over.marker);
        below = at;
        continue;
      }
      if (under < over.content || deep >= over.content + 4 || inner < over.content) {
        return undefined;
      }
      if (item.marker === over.marker) return item;
      if (item.marker < over.content || item.marker - over.content > 3) return undefined;
      return nested === true || !paragraph || first ? item : undefined;
    }
    if (!lines.plain(at)) return undefined;
    below = at;
  }
  return undefined;
}

/** The lines of `text` as they are written, with the markers hidden (`hidden`). */
function writtenLines(text: string, hidden: readonly Range[]): ListLines {
  const read = new Map<number, string>();
  const line = (start: number) => {
    let found = read.get(start);
    if (found === undefined) {
      found = visible(text, hidden, start, lineEnd(text, start)).text.replace(/\r$/, '');
      read.set(start, found);
    }
    return found;
  };
  return {
    text,
    line,
    blank: (start) => /^[ \t>]*$/.test(line(start)),
    fixed: () => true,
    plain: (start) => {
      const rest = afterQuotes(line(start));
      const indent = /^[ \t]*/.exec(rest)?.[0] ?? '';
      const content = rest.slice(indent.length);
      return (
        content !== '' &&
        !indent.includes('\t') &&
        !LIST_START.test(rest) &&
        !OTHER_BLOCK.test(content) &&
        !THEMATIC_BREAK.test(rest)
      );
    },
    known: new Map(),
  };
}

/**
 * Whether a line of `text` that the editor's block reading (`lineStartKind`) takes as the start of
 * a list item, right under a line of a paragraph, is as CommonMark reads it no item that the
 * reading of list items is sure of (`listItemAt`): more of that paragraph, which the editor's
 * reading ends there (#139). The text as it is written, with the markers `hidden`, to `limit`.
 */
export function holdsMisreadItem(text: string, hidden: readonly Range[], limit: number): boolean {
  const lines = writtenLines(text, hidden);
  for (let start = 0; start < limit;) {
    const raw = text.slice(start, lineEnd(text, start));
    const above = start === 0 ? 0 : lineStart(text, start - 1);
    if (
      start > 0 &&
      LIST_START.test(raw) &&
      !lines.blank(above) &&
      !THEMATIC_BREAK.test(afterQuotes(lines.line(start)))
    ) {
      const words = lines.line(above);
      const prefix = prefixLength(words);
      const paragraph =
        prefix < words.length &&
        !OTHER_BLOCK.test(words.slice(prefix)) &&
        !THEMATIC_BREAK.test(afterQuotes(words));
      if (
        paragraph &&
        lineStartKind(text, start + prefixLength(raw), hidden) === 'block' &&
        !listItemAt(lines, start)
      ) {
        return true;
      }
    }
    // The items top down, so that each looks up those above it once.
    listItemAt(lines, start);
    start = text.indexOf('\n', start) + 1 || limit;
  }
  return false;
}

/** A segment of a mark, with what it takes up of the file. */
interface Part extends Range {
  mark: MarkRange;
  segment: Segment;
}

/**
 * The marks of the region file `text` that a format change, which makes the edits `footprint`
 * there (in offsets of `text`), is not tried against: see the top of this module.
 */
export function marksApart(
  reader: FormatReader,
  parsed: Parsed,
  footprint: readonly Range[],
): Apart {
  const { text, hidden } = reader;
  const limit = parsed.ledgerRange?.from ?? text.length;
  // A line that the editor reads as a list item and CommonMark as more of the paragraph above
  // (#139): the walk compares the editor's reading, so no mark of the region is left apart.
  if (holdsMisreadItem(text, hidden, limit)) {
    return { ids: new Set(), paragraphs: [], bracketed: false };
  }
  const markers = hidden.filter((marker) => marker.role !== 'ledger');
  const deletions = parsed.marks.flatMap((mark) => (mark.kind === 'del' ? mark.segments : []));
  const parts: Part[] = parsed.marks.flatMap((mark) =>
    mark.segments.map((segment) => ({
      mark,
      segment,
      from: segment.open.from,
      // A split stands for its break: rejecting it takes the line break, a blank line and the
      // prefix of the next line, as `segmentSpan` and `decide` have it.
      to:
        mark.kind === 'split'
          ? splitEnd(text, segment.open, deletions, limit)
          : (segment.close ?? openerRange(segment)).to,
    })),
  );
  // Where the text can change: every mark but a comment, and the edits of the change.
  const changing: Range[] = [...parts.filter((part) => part.mark.kind !== 'cmt'), ...footprint];
  const isHidden = (at: number) => markers.some((marker) => marker.from <= at && at < marker.to);
  const isHeld = (at: number) => changing.some((range) => range.from <= at && at < range.to);
  /** Whether something that changes meets the closed stretch `[from, to]`. */
  const meets = (from: number, to: number) =>
    changing.some((range) => range.from <= to && from <= range.to);
  /** Whether something that changes is in the prefix `[from, to)`, or is written in front of it. */
  const inPrefix = (from: number, to: number) =>
    changing.some((range) =>
      range.from === range.to
        ? from <= range.from && range.from < to
        : range.from < to && from < range.to,
    );
  /** A blank line that nothing changes. */
  const stillBlank = (start: number) => {
    const end = lineEnd(text, start);
    return /^[ \t>]*$/.test(visible(text, hidden, start, end).text) && !meets(start, end);
  };

  const wordEdit = (mark: MarkRange) =>
    KINDS.has(mark.kind) &&
    isDecidable(mark) &&
    parts
      .filter((part) => part.mark === mark)
      .every((part) => {
        const { segment } = part;
        if (segment.carrier !== undefined || (mark.kind !== 'del' && !segment.close)) return false;
        if (part.to > limit || text.slice(part.from, part.to).includes('\n')) return false;
        if (holdsSyntax(decidedText(text, mark, segment))) return false;
        if (markers.some((m) => m.mark !== mark && m.from < part.to && part.from < m.to)) {
          return false;
        }
        return !parts.some((p) => p.mark !== mark && p.from <= part.from && part.to <= p.to);
      });

  const apart = new Set(parsed.marks.filter(wordEdit));

  /** Whether the runs of marks next to one another on the line `[start, end)`, whose text starts
   * at `at`, stand between characters that keep code and escapes as they are. */
  const runsStandApart = (start: number, end: number, at: number) => {
    const onLine = parts
      .filter((part) => part.mark.kind !== 'cmt' && part.from >= start && part.to <= end)
      .toSorted((a, b) => a.from - b.from);
    for (let i = 0; i < onLine.length;) {
      let j = i;
      while (j + 1 < onLine.length && onLine[j + 1]?.from === onLine[j]?.to) j++;
      const before = (onLine[i]?.from ?? at) - 1;
      const after = onLine[j]?.to ?? end;
      const left = text[before];
      if (before < at || isHidden(before) || left === '`' || left === '\\') return false;
      if (after < end && (isHidden(after) || text[after] === '`')) return false;
      i = j + 1;
    }
    return true;
  };

  /** Whether the character at `at` is text that no decision takes away. */
  const fixedAt = (at: number) => !isHidden(at) && !isHeld(at) && !/\s/.test(text[at] ?? ' ');

  /** The lines of the table around the line at `start`: its header row, its delimiter row, and the
   * rows under it to a line that starts no row. Undefined when no delimiter row is above. */
  const tableOf = (
    start: number,
  ): { header: number; delimiter: number; rows: number[] } | undefined => {
    let delimiter: number | undefined;
    for (let line = start; line > 0 && delimiter === undefined;) {
      line = lineStart(text, line - 1);
      const raw = text.slice(line, lineEnd(text, line));
      if (!raw.includes('|')) return undefined;
      if (DELIMITER_ROW.test(raw)) delimiter = line;
    }
    if (delimiter === undefined || delimiter === 0) return undefined;
    const header = lineStart(text, delimiter - 1);
    const rows: number[] = [];
    for (let line = text.indexOf('\n', delimiter) + 1; line > 0 && line < limit;) {
      const end = lineEnd(text, line);
      if (/^[ \t>]*$/.test(visible(text, hidden, line, end).text)) break;
      rows.push(line);
      line = text.indexOf('\n', end) + 1;
    }
    return { header, delimiter, rows };
  };

  /**
   * Whether the row of a table at `at` (its `|`), to `end`, is a row under its delimiter row in every
   * decision, and holds a character that no delimiter row has and no mark holds. A mark in the
   * header or the delimiter row could make the table none, and a row that starts otherwise could
   * end it: then CommonMark reads its rows as the lines of one paragraph. So the header and the
   * delimiter row hold no mark, and every row starts with a `|` that no mark holds.
   */
  const bodyRow = (start: number, at: number, end: number) => {
    let fixed = false;
    for (let i = at; i < end && !fixed; i++) {
      fixed = !isHidden(i) && !isHeld(i) && !/[\s|:-]/.test(text[i] ?? ' ');
    }
    if (!fixed) return false;
    const table = tableOf(start);
    if (!table) return false;
    const { header, delimiter, rows } = table;
    if (meets(header, lineEnd(text, header)) || meets(delimiter, lineEnd(text, delimiter))) {
      return false;
    }
    return rows.every((line) => {
      const bar = line + prefixLength(text.slice(line, lineEnd(text, line)));
      return text[bar] === '|' && !isHidden(bar) && !inPrefix(line, bar + 1);
    });
  };

  /**
   * The lines as they are in every decision, for the reading of list items: a line's prefix and the
   * first character of its text are fixed, a blank line stays blank, and a line of text starts,
   * after its prefix, with a letter or a digit that no mark holds.
   */
  const everyDecision: ListLines = {
    text,
    line: (start) => text.slice(start, lineEnd(text, start)),
    blank: stillBlank,
    fixed: (start, at) => !inPrefix(start, at) && fixedAt(at),
    plain: (start) => {
      const line = text.slice(start, lineEnd(text, start));
      const at = start + prefixLength(line);
      return (
        !LIST_START.test(line) &&
        !line.slice(0, at - start).includes('\t') &&
        !inPrefix(start, at) &&
        fixedAt(at) &&
        /^[\p{L}\p{N}]$/u.test(String.fromCodePoint(text.codePointAt(at) ?? 0))
      );
    },
    known: new Map(),
  };

  /** Whether the line at `start` is the first line of a list item in every decision, as CommonMark
   * reads it (`listItemAt`). */
  const itemEverywhere = (start: number) => listItemAt(everyDecision, start);
  // The items top down, so that each looks up those above it once.
  for (let start = 0; start < limit; start = text.indexOf('\n', start) + 1 || limit) {
    itemEverywhere(start);
  }

  /** Whether the first line of a paragraph, at `from`, starts a block in every decision, as
   * CommonMark reads it: after a blank line that nothing changes, or as a list item that is one in
   * every decision, or as a row. */
  const startsBlock = (from: number, row: boolean) => {
    if (row || from === 0) return true;
    return stillBlank(lineStart(text, from - 1)) || itemEverywhere(from) !== undefined;
  };

  /** Whether the line after the last line of a paragraph, which ends at `to`, starts a block in
   * every decision: a blank line that nothing changes, a list item that is one in every decision,
   * or, after a row, a row whose `|` no mark holds. */
  const nextStartsBlock = (to: number, row: boolean) => {
    const newline = text.indexOf('\n', to);
    const next = newline + 1;
    if (newline === -1 || next >= limit || stillBlank(next)) return true;
    if (!row) return itemEverywhere(next) !== undefined;
    const bar = next + prefixLength(text.slice(next, lineEnd(text, next)));
    return text[bar] === '|' && !isHidden(bar) && !inPrefix(next, bar + 1);
  };

  let bracketed = false;
  /** Whether the paragraph `[from, to]` is one whose marks are apart, as far as `apart` goes. */
  const standsApart = ({ from, to }: Range) => {
    if (to > limit || footprint.some((edit) => edit.from <= to && from <= edit.to)) return false;
    if (
      parts.some((p) => p.mark.kind !== 'cmt' && !apart.has(p.mark) && p.from <= to && from <= p.to)
    ) {
      return false;
    }
    let row = false;
    for (let start = from, first = true; start <= to; first = false) {
      const end = lineEnd(text, start);
      const line = text.slice(start, end);
      const at = start + prefixLength(line);
      if (at >= end || isHidden(at)) return false;
      if (!first && !/^[ \t>]*$/.test(line.slice(0, at - start))) return false;
      const c = String.fromCodePoint(text.codePointAt(at) ?? 0);
      if (c === '|' && first && end >= to) {
        row = true;
        if (!bodyRow(start, at, end)) return false;
      } else if (!/^[\p{L}\p{N}]$/u.test(c)) return false;
      if (/[<>]/.test(visible(text, hidden, at, end).text)) return false;
      if (!runsStandApart(start, end, at)) return false;
      const newline = text.indexOf('\n', end);
      if (newline === -1) break;
      start = newline + 1;
    }
    return startsBlock(from, row) && nextStartsBlock(to, row);
  };

  let found: ApartParagraph[] = [];
  for (let changed = true; changed;) {
    changed = false;
    const paragraphs = new Map<
      number,
      { range: Range; marks: Set<MarkRange>; segments: string[]; changing: number }
    >();
    for (const part of parts) {
      if (!apart.has(part.mark)) continue;
      const range = paragraphRange(text, hidden, part.from);
      const known = paragraphs.get(range.from) ?? {
        range,
        marks: new Set(),
        segments: [],
        changing: 0,
      };
      known.marks.add(part.mark);
      known.segments.push(segmentName(part.mark, part.segment));
      if (part.mark.kind !== 'hl') known.changing++;
      paragraphs.set(range.from, known);
    }
    bracketed = false;
    found = [];
    for (const { range, marks, segments, changing } of paragraphs.values()) {
      if (standsApart(range)) {
        bracketed ||= /[[\]]/.test(text.slice(range.from, range.to));
        const shown = visible(text, hidden, range.from, range.to).text;
        found.push({ segments, changing, shown });
        continue;
      }
      for (const mark of marks) apart.delete(mark);
      changed = true;
    }
  }
  return { ids: new Set([...apart].map((mark) => mark.id)), paragraphs: found, bracketed };
}
