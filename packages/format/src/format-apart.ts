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
// - its paragraph is none that the change writes in, and every mark there is apart;
// - each line of that paragraph starts, after its container prefix, with a character that no
//   marker holds: a letter or a digit, or for a row of a table under its delimiter row, the row's
//   `|` (the row then holds a character other than `|`, `-`, `:` and white space that no mark
//   holds, so that it never reads as a delimiter row); a line under the first has nothing but
//   quote markers and white space in front of it; no line has `<` or `>` after its prefix;
// - the paragraph's first line starts a block in every decision: it is the first line of the
//   region, or it has a bullet or the number 1, or a number under a line whose prefix has a list
//   marker that no mark or edit touches, or it is a row, or a blank line that no mark or edit
//   touches is above it; and so does the line after its last: it is a blank line that no mark or
//   edit touches, or a prefix that no mark or edit touches holds a bullet or the number 1 (another
//   number when the paragraph's first line has a list marker), or it is a row whose `|` no mark
//   holds;
// - each run of marks next to one another on its lines stands between characters that no marker
//   holds: the one before is neither a backtick nor a backslash, and the one after is no backtick,
//   or the line ends there.
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
// decided. The walk compares the two files piece by piece: the paragraphs of the marks apart one
// by one, and the runs of other paragraphs between them. Pieces that are alike stay alike with the
// marks apart decided either way, as what changes in them changes alike. A paragraph of marks apart
// reads alike in the two files only if what it is read with is alike: its markers, which a reading
// as code would show, are there to tell. Where the pieces are alike only all together, or the
// definitions of the two files differ while a paragraph of marks apart has a bracket that one could
// make a link of, the walk tries every mark instead. The warnings it counts, and the bytes once the
// new marks are rejected, change alike in both files too.
//
// The first shortcut of this kind, when format changes were new, left out the marks of the
// change's own paragraph that did not stand next to its syntax, and tried them only all accepted
// and all rejected. Both were wrong: a delimiter far off in the paragraph pairs with the new one
// once a deletion next to it is decided, and one order of decisions works where another is
// refused. Every mark of the change's paragraph is tried here, as the reading of emphasis, code and
// links stays in a paragraph, and nothing is tried at its ends only: every state of the marks apart
// reads as the state with them pending.

import {
  FIRST_MARKER,
  HAS_BULLET,
  lineEnd,
  lineStart,
  openerRange,
  prefixLength,
} from './blocks.ts';
import { isDecidable } from './decide.ts';
import type { FormatReader } from './format-reader.ts';
import { DELIMITER_ROW, paragraphRange, visible } from './inline.ts';
import type { MarkRange, Parsed, Range, Segment } from './types.ts';

/** The marks of a region that a change is not tried against, and whether a paragraph of theirs has
 * a bracket, which a definition elsewhere can make a link. */
export interface Apart {
  ids: ReadonlySet<string>;
  bracketed: boolean;
}

export const NONE_APART: Apart = { ids: new Set(), bracketed: false };

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
  const markers = hidden.filter((marker) => marker.role !== 'ledger');
  const parts: Part[] = parsed.marks.flatMap((mark) =>
    mark.segments.map((segment) => ({
      mark,
      segment,
      from: segment.open.from,
      to: (segment.close ?? openerRange(segment)).to,
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

  /** Whether the row of a table at `at` (its `|`), to `end`, is under a delimiter row, and holds a
   * character that no delimiter row has and no mark holds. */
  const bodyRow = (start: number, at: number, end: number) => {
    let fixed = false;
    for (let i = at; i < end && !fixed; i++) {
      fixed = !isHidden(i) && !isHeld(i) && !/[\s|:-]/.test(text[i] ?? ' ');
    }
    if (!fixed) return false;
    for (let line = start; line > 0;) {
      line = lineStart(text, line - 1);
      const raw = text.slice(line, lineEnd(text, line));
      if (!raw.includes('|')) return false;
      if (DELIMITER_ROW.test(raw)) return true;
    }
    return false;
  };

  /** Whether the first line of a paragraph, at `from`, starts a block in every decision. */
  const startsBlock = (from: number, row: boolean) => {
    if (row || from === 0) return true;
    const marker = FIRST_MARKER.exec(text.slice(from, lineEnd(text, from)));
    if (marker && (marker[1] !== undefined || Number(marker[2]) === 1)) return true;
    const above = lineStart(text, from - 1);
    if (!marker) return stillBlank(above);
    // A number other than 1 starts an item only under a line of a list.
    const length = prefixLength(text.slice(above, lineEnd(text, above)));
    return HAS_BULLET.test(text.slice(above, above + length)) && !inPrefix(above, above + length);
  };

  /** Whether the line after the last line of a paragraph, which ends at `to`, starts a block in
   * every decision. `first` is the paragraph's first line. */
  const nextStartsBlock = (to: number, first: string) => {
    const newline = text.indexOf('\n', to);
    const next = newline + 1;
    if (newline === -1 || next >= limit || stillBlank(next)) return true;
    const line = text.slice(next, lineEnd(text, next));
    const length = prefixLength(line);
    if (inPrefix(next, next + length)) return false;
    const marker = FIRST_MARKER.exec(line);
    if (marker) {
      return marker[1] !== undefined || Number(marker[2]) === 1 || FIRST_MARKER.test(first);
    }
    const at = next + length;
    return text[at] === '|' && !isHidden(at) && !inPrefix(at, at + 1);
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
    if (!startsBlock(from, row)) return false;
    return nextStartsBlock(to, text.slice(from, lineEnd(text, from)));
  };

  for (let changed = true; changed;) {
    changed = false;
    const paragraphs = new Map<number, { range: Range; marks: Set<MarkRange> }>();
    for (const part of parts) {
      if (!apart.has(part.mark)) continue;
      const range = paragraphRange(text, hidden, part.from);
      const known = paragraphs.get(range.from) ?? { range, marks: new Set<MarkRange>() };
      known.marks.add(part.mark);
      paragraphs.set(range.from, known);
    }
    bracketed = false;
    for (const { range, marks } of paragraphs.values()) {
      if (standsApart(range)) {
        bracketed ||= /[[\]]/.test(text.slice(range.from, range.to));
        continue;
      }
      for (const mark of marks) apart.delete(mark);
      changed = true;
    }
  }
  return { ids: new Set([...apart].map((mark) => mark.id)), bracketed };
}
