// Finding the markers and the ledger in a file (format §2.1, §3.1, §5.1). Code is not scanned:
// text in a fenced code block or an inline code span is the code's, and a marker or a ledger in it
// is only an example. This is not a Markdown parser. It knows fenced blocks, code spans and
// ordinary HTML comments, and nothing else: a marker in an indented code block is read as a
// marker, and no edit writes one there (`indented-code.ts`). Front matter is YAML, not Markdown
// (format §3.8): a line in it that looks like a fence or an HTML block opens none, and the body is
// read from its first line as a file is from its first.

import { bodyStart } from './blocks.ts';
import { isId } from './ids.ts';
import { decodePayload } from './payload.ts';
import type { MarkKind, Range } from './types.ts';

const KINDS: readonly string[] = ['ins', 'del', 'sub', 'fmt', 'hl', 'cmt', 'split'];

function isKind(s: string): s is MarkKind {
  return KINDS.includes(s);
}

/** `<!--KIND ID-->` or `<!--KIND ID PAYLOAD-->`; the payload is everything after the space that
 * follows the id, up to the first `-->`, on one line (format §2.1). */
const OPENER = /<!--([a-z]+) ([a-z0-9]{4})(?: ([^\r\n]*?))?-->/y;
const CLOSER = /<!--\/([a-z0-9]{4})-->/y;

/** `<!-- redlines` alone on its line (format §5.1). A line that a CR alone ends is a line too, but
 * not one a ledger can be read from: see `LedgerCandidate.crLines`. */
const LEDGER_HEAD = /<!-- redlines[ \t]*(?=[\r\n]|$)/y;

/** The next thing that needs a look: a run of backticks, a comment, or a line break. */
const NEXT = /`+|<!--|\n/g;

/** A line that opens a fenced code block: three or more backticks or tildes, after the `>` of a
 * block quote or the marker of a list item, if there is one. The rest of the line is the info
 * string, which can't hold a backtick if the fence is made of them. Any indentation is read as a
 * fence, also four spaces, which CommonMark reads as indented code: the scan reads code either
 * way, and so finds no marker there. */
const FENCE_OPEN = /([ \t>]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)*)(`{3,}|~{3,})([^\n]*)/y;
const FENCE_CLOSE = /^([ \t>]*)(`{3,}|~{3,})[ \t]*\r?$/;

/** What stands in front of a fence on its line: how many quote markers, how far the fence is
 * indented after them in columns (a tab to the next multiple of four), and whether a list marker
 * is there too. `content` is the column after the quote markers where the content of the container
 * the fence is in starts: the fence's own, after a list marker; otherwise that of the list item
 * above that holds the line, or 0. */
interface FenceLead {
  depth: number;
  indent: number;
  marker: boolean;
  content: number;
}

/** A line's quote markers and the rest of it, measured in columns after them. */
function afterQuotes(line: string): { depth: number; rest: string; base: number } {
  let column = 0;
  let depth = 0;
  let base = 0;
  let at = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c !== '>' && c !== ' ' && c !== '\t') break;
    column += c === '\t' ? 4 - (column % 4) : 1;
    if (c !== '>') continue;
    depth++;
    // One space after a quote marker belongs to it.
    if (line[i + 1] === ' ') {
      i++;
      column++;
    }
    base = column;
    at = i + 1;
  }
  return { depth, rest: line.slice(at), base };
}

/** The columns of the white space at the start of `rest`, which starts at column `base`. */
function columns(rest: string, base: number): number {
  let column = base;
  for (const c of rest) {
    if (c === ' ') column++;
    else if (c === '\t') column += 4 - (column % 4);
    else break;
  }
  return column - base;
}

/** A list item's marker at the start of a line's rest after its quote markers: where its content
 * starts, in columns from there (one to four spaces after the marker; more make indented code, and
 * the content starts one space after it). */
function itemContent(rest: string): number | undefined {
  const item = /^([ ]*)([-*+]|\d{1,9}[.)])( +)(?=\S)/.exec(rest);
  if (!item) return undefined;
  const spaces = (item[3] ?? '').length;
  return (item[1] ?? '').length + (item[2] ?? '').length + (spaces > 4 ? 1 : spaces);
}

function fenceLead(prefix: string): Omit<FenceLead, 'content'> {
  const { depth, rest, base } = afterQuotes(prefix);
  return {
    depth,
    indent: columns(
      rest.replace(/(?:[-*+]|\d{1,9}[.)])(?=[ \t])/g, (m) => ' '.repeat(m.length)),
      base,
    ),
    marker: /(?:[-*+]|\d[.)])[ \t]/.test(rest),
  };
}

/** Where the content of the container of a fence with `lead` on the line at `start` starts: see
 * `FenceLead`. The lines above, back to a list item with no line less indented than its content
 * between, as far as a line of text at the left edge, which no list item holds. */
function containerContent(
  text: string,
  start: number,
  lead: Omit<FenceLead, 'content'>,
  body: number,
): number {
  if (lead.marker) return lead.indent;
  let lowest = Infinity;
  for (let lines = 0, at = start; lines < 200 && at > body; lines++) {
    // The line before the one at `at`.
    const top = at >= 2 ? text.lastIndexOf('\n', at - 2) + 1 : 0;
    const line = text.slice(top, at - 1).replace(/\r$/, '');
    at = top;
    const { depth, rest } = afterQuotes(line);
    if (depth !== lead.depth) break;
    if (rest.trim() === '') continue;
    const content = itemContent(rest);
    if (content !== undefined && content <= lead.indent && lowest >= content) return content;
    const indent = columns(rest, 0);
    lowest = Math.min(lowest, indent);
    if (indent === 0 && content === undefined) break;
  }
  return 0;
}

/**
 * Whether a closing fence with `lead` in front of it closes a block opened with `opened`: in the
 * same quote, and in the same container, indented no more than three columns past where its
 * content starts (CommonMark). A fence indented less is outside the container, and a renderer reads
 * it as opening a block of its own.
 */
function closes(opened: FenceLead, lead: Omit<FenceLead, 'content'>): boolean {
  return (
    lead.depth === opened.depth &&
    lead.indent >= opened.content &&
    lead.indent <= opened.content + 3
  );
}

/**
 * Whether the fence on the line at `start`, with `prefix` in front of it, opens a block. An ordered
 * list item numbered other than 1 can't interrupt a paragraph (CommonMark): after a line of text,
 * its line is text, unless that line is an item of the list it goes on, whose content starts to the
 * right of it, or a heading. The first line of the body has no line above it.
 */
function opensBlock(text: string, start: number, prefix: string, body: number): boolean {
  const { depth, rest } = afterQuotes(prefix);
  const ordered = /^([ ]*)(\d{1,9})[.)][ \t]/.exec(rest);
  if (!ordered || Number(ordered[2]) === 1 || start <= body) return true;
  const above = start >= 2 ? text.lastIndexOf('\n', start - 2) + 1 : 0;
  const line = text.slice(above, start - 1).replace(/\r$/, '');
  const before = afterQuotes(line);
  if (before.rest.trim() === '' || /^ {0,3}#{1,6}(?:[ \t]|$)/.test(before.rest)) return true;
  const content = before.depth === depth ? itemContent(before.rest) : undefined;
  return content !== undefined && content > (ordered[1] ?? '').length;
}

/** The start of an HTML block of raw text (CommonMark's type 1): its name is the first group. */
const RAW_BLOCK = /[ \t]{0,3}<(script|pre|style|textarea)(?=[\s>]|$)/iy;

/** A heading is a single line: a code span that starts in one ends there. */
const ATX_HEADING = /^[ \t>]*#{1,6}(?:[ \t]|\r?$)/;

/** A line that ends a paragraph, so a code span can't reach past it. */
const BLANK_LINE = /^[ \t>]*\r?$/;
const BLOCK_START =
  /^[ \t>]*(?:#{1,6}(?:[ \t]|\r?$)|[-*+](?:[ \t]|\r?$)|\d{1,9}[.)](?:[ \t]|\r?$)|`{3,}|~{3,}|([-*_])(?:[ \t]*\1){2,}[ \t]*\r?$)/;

/** One marker found in the text. */
export type Marker =
  | { type: 'open'; id: string; kind: MarkKind; payload?: string; from: number; to: number }
  | { type: 'close'; id: string; from: number; to: number };

/** A `<!-- redlines` comment: where it starts, where its first line ends, and where its `-->` is. */
export interface LedgerCandidate {
  start: number;
  headerEnd: number;
  end: number;
  /** A CR alone comes right before it, or ends its first line: it was written with CRs for line
   * breaks, which Redlines doesn't read, so it is a ledger that can't be read (format §5.1). */
  crLines?: true;
}

export interface Scan {
  /** In the order they appear. Nothing is checked beyond the grammar. */
  markers: Marker[];
  /** Every `<!-- redlines` comment outside code, in order. The last one is the ledger. */
  ledgers: LedgerCandidate[];
  /** Where a blank line is content, not the end of a block: fenced code blocks (from the start of
   * the opening fence's line to the end of the closing fence's), HTML comments that are not
   * markers, and `<pre>`, `<script>`, `<style>` and `<textarea>` blocks. */
  verbatim: Range[];
}

/** What a scan remembers, so that no part of the text is searched again and again. */
interface Memo {
  /** Every position in `[from, to)` is in a paragraph that ends at `to`. */
  paragraph: { from: number; to: number };
  /** There is no `-->` in the rest of the text. */
  noCommentEnd: boolean;
  /** Where the body starts, after front matter. */
  body: number;
}

/**
 * Finds every marker and ledger comment in the text. An HTML comment that isn't a marker is skipped
 * whole, so a marker inside one is not found, as a renderer would not show it either. Fenced code
 * blocks and code spans are skipped, and so is an escaped backtick.
 */
export function scan(text: string): Scan {
  const markers: Marker[] = [];
  const ledgers: LedgerCandidate[] = [];
  const verbatim: Range[] = [];
  const body = bodyStart(text);
  const memo: Memo = { paragraph: { from: 0, to: 0 }, noCommentEnd: false, body };
  let at = 0;
  let atLineStart = true;
  while (at < text.length) {
    const from = at;
    // No block starts in front matter.
    if (atLineStart && at < body) atLineStart = false;
    if (atLineStart) {
      atLineStart = false;
      FENCE_OPEN.lastIndex = at;
      const fence = FENCE_OPEN.exec(text);
      const run = fence?.[2];
      if (
        fence &&
        run &&
        !(run.startsWith('`') && fence[3]?.includes('`')) &&
        opensBlock(text, at, fence[1] ?? '', body)
      ) {
        const lead = fenceLead(fence[1] ?? '');
        const opened = { ...lead, content: containerContent(text, at, lead, body) };
        const end = fenceEnd(text, run, opened, at + fence[0].length);
        verbatim.push({ from: at, to: end });
        at = end;
        continue;
      }
      // A block of raw text ends at the line that has its closing tag, blank lines or not.
      RAW_BLOCK.lastIndex = at;
      const raw = RAW_BLOCK.exec(text)?.[1];
      if (raw) {
        const closing = new RegExp(`</${raw}>`, 'gi');
        closing.lastIndex = at;
        const found = closing.exec(text);
        verbatim.push({ from: at, to: found ? lineEndAt(text, found.index) : text.length });
      }
    }
    NEXT.lastIndex = at;
    const next = NEXT.exec(text);
    if (!next) break;
    if (next[0] === '\n') {
      at = next.index + 1;
      atLineStart = true;
    } else if (next[0] === '<!--') {
      at = readComment(text, next.index, markers, ledgers, memo, verbatim);
    } else {
      at = skipCodeSpan(text, next.index, next[0].length, memo);
    }
    // Every step goes on, whatever the text: a file can't keep the scan from ending.
    if (at <= from) at = from + 1;
  }
  return { markers, ledgers, verbatim };
}

/** Reads the comment at `at`: a marker, a ledger, or an ordinary comment. Returns where to go on. */
function readComment(
  text: string,
  at: number,
  markers: Marker[],
  ledgers: LedgerCandidate[],
  memo: Memo,
  verbatim: Range[],
): number {
  OPENER.lastIndex = at;
  const open = OPENER.exec(text);
  const [, kind, openId, payload] = open ?? [];
  if (open && kind !== undefined && isKind(kind) && openId !== undefined && isId(openId)) {
    const marker: Marker = { type: 'open', id: openId, kind, from: at, to: at + open[0].length };
    // The operations of a format change are escaped one by one, and a space between them is no
    // space in a value (format §2.6): `parseFormatOps` reads them as they are written.
    if (payload !== undefined) marker.payload = kind === 'fmt' ? payload : decodePayload(payload);
    markers.push(marker);
    return marker.to;
  }
  CLOSER.lastIndex = at;
  const close = CLOSER.exec(text);
  const closeId = close?.[1];
  if (close && closeId !== undefined && isId(closeId)) {
    markers.push({ type: 'close', id: closeId, from: at, to: at + close[0].length });
    return at + close[0].length;
  }
  const end = memo.noCommentEnd ? -1 : text.indexOf('-->', at + 2);
  if (end === -1) {
    memo.noCommentEnd = true;
    return at + 4;
  }
  if (at === 0 || text[at - 1] === '\n' || text[at - 1] === '\r') {
    LEDGER_HEAD.lastIndex = at;
    const head = LEDGER_HEAD.exec(text);
    if (head) {
      const headerEnd = at + head[0].length;
      const found: LedgerCandidate = { start: at, headerEnd, end };
      if (text[at - 1] === '\r' || (text[headerEnd] === '\r' && text[headerEnd + 1] !== '\n')) {
        found.crLines = true;
      }
      ledgers.push(found);
      return end + 3;
    }
  }
  verbatim.push({ from: at, to: end + 3 });
  return end + 3;
}

function lineEndAt(text: string, from: number): number {
  const newline = text.indexOf('\n', from);
  return newline === -1 ? text.length : newline;
}

/** The end of the fenced code block whose opening line ends at `from`: the end of the closing
 * fence's line; or of the line before the one that ends its container, which ends it too (a line
 * with fewer quote markers, also a blank one, or a line with text left of where the content of its
 * list item starts); or the end of the text when the block is never closed (as in CommonMark). */
function fenceEnd(text: string, run: string, opened: FenceLead, from: number): number {
  let end = lineEndAt(text, from);
  while (end < text.length) {
    const start = end + 1;
    const lineEnd = lineEndAt(text, start);
    const line = text.slice(start, lineEnd).replace(/\r$/, '');
    const { depth, rest, base } = afterQuotes(line);
    if (depth < opened.depth) return end;
    if (opened.content > 0 && rest.trim() !== '' && columns(rest, base) < opened.content)
      return end;
    end = lineEnd;
    const found = FENCE_CLOSE.exec(line);
    const close = found?.[2];
    if (
      close &&
      close.startsWith(run.charAt(0)) &&
      close.length >= run.length &&
      closes(opened, fenceLead(found[1] ?? ''))
    ) {
      return end;
    }
  }
  return text.length;
}

/** Skips the run of backticks at `at`, and the code span it opens, if it opens one. */
function skipCodeSpan(text: string, at: number, length: number, memo: Memo): number {
  let start = at;
  let count = length;
  let backslashes = 0;
  while (text[at - 1 - backslashes] === '\\') backslashes++;
  // An escaped backtick is a backtick, and the others may still open a span.
  if (backslashes % 2 === 1) {
    start++;
    count--;
  }
  if (count === 0) return at + length;
  const end = codeSpanEnd(text, start + count, count, memo);
  return end === -1 ? start + count : end;
}

/** Where the code span opened by `length` backticks, ending at `from`, ends: after the next run of
 * exactly that many, within the paragraph. -1 when there is none. */
function codeSpanEnd(text: string, from: number, length: number, memo: Memo): number {
  const limit = paragraphEnd(text, from, memo);
  let position = from;
  for (;;) {
    const run = text.indexOf('`', position);
    if (run === -1 || run >= limit) return -1;
    let end = run + 1;
    while (text[end] === '`') end++;
    if (end - run === length) return end;
    position = end;
  }
}

/** Where the paragraph that holds `from` ends: at its last line's break, or the end of the text.
 * A paragraph goes on until a blank line or a line that starts another block; a heading is one
 * line. All the spans in a paragraph share one answer. */
function paragraphEnd(text: string, from: number, memo: Memo): number {
  const known = memo.paragraph;
  if (from >= known.from && from < known.to) return known.to;
  const lineStart = text.lastIndexOf('\n', from - 1) + 1;
  let end = lineEndAt(text, from);
  // A code span in front matter ends there: the body is no more of its line's paragraph.
  const limit = from < memo.body ? memo.body - 1 : text.length;
  if (!ATX_HEADING.test(text.slice(lineStart, end))) {
    while (end < limit) {
      const nextEnd = lineEndAt(text, end + 1);
      const line = text.slice(end + 1, nextEnd);
      if (BLANK_LINE.test(line) || BLOCK_START.test(line)) break;
      end = nextEnd;
    }
  }
  memo.paragraph = { from: lineStart, to: end };
  return end;
}
