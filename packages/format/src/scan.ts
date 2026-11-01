// Finding the markers and the ledger in a file (format §2.1, §3.1, §5.1). Code is not scanned:
// text in a fenced code block or an inline code span is the code's, and a marker or a ledger in it
// is only an example. This is not a Markdown parser. It knows fenced blocks, code spans and
// ordinary HTML comments, and nothing else; indented code blocks are a known gap.

import { isId } from './ids.ts';
import { decodePayload } from './payload.ts';
import type { MarkKind } from './types.ts';

const KINDS: readonly string[] = ['ins', 'del', 'sub', 'fmt', 'hl', 'cmt', 'split'];

function isKind(s: string): s is MarkKind {
  return KINDS.includes(s);
}

/** `<!--KIND ID-->` or `<!--KIND ID PAYLOAD-->`; the payload is everything after the space that
 * follows the id, up to the first `-->`, on one line (format §2.1). */
const OPENER = /<!--([a-z]+) ([a-z0-9]{4})(?: ([^\r\n]*?))?-->/y;
const CLOSER = /<!--\/([a-z0-9]{4})-->/y;

/** `<!-- redlines` alone on its line (format §5.1). */
const LEDGER_HEAD = /<!-- redlines[ \t]*(?=\r?\n|$)/y;

/** The next thing that needs a look: a run of backticks, a comment, or a line break. */
const NEXT = /`+|<!--|\n/g;

/** A line that opens a fenced code block: three or more backticks or tildes, after the `>` of a
 * block quote or the marker of a list item, if there is one. The rest of the line is the info
 * string, which can't hold a backtick if the fence is made of them. */
const FENCE_OPEN = /[ \t>]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)*(`{3,}|~{3,})([^\n]*)/y;
const FENCE_CLOSE = /^[ \t>]*(`{3,}|~{3,})[ \t]*\r?$/;

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
}

export interface Scan {
  /** In the order they appear. Nothing is checked beyond the grammar. */
  markers: Marker[];
  /** Every `<!-- redlines` comment outside code, in order. The last one is the ledger. */
  ledgers: LedgerCandidate[];
}

/** What a scan remembers, so that no part of the text is searched again and again. */
interface Memo {
  /** Every position in `[from, to)` is in a paragraph that ends at `to`. */
  paragraph: { from: number; to: number };
  /** There is no `-->` in the rest of the text. */
  noCommentEnd: boolean;
}

/**
 * Finds every marker and ledger comment in the text. An HTML comment that isn't a marker is skipped
 * whole, so a marker inside one is not found, as a renderer would not show it either. Fenced code
 * blocks and code spans are skipped, and so is an escaped backtick.
 */
export function scan(text: string): Scan {
  const markers: Marker[] = [];
  const ledgers: LedgerCandidate[] = [];
  const memo: Memo = { paragraph: { from: 0, to: 0 }, noCommentEnd: false };
  let at = 0;
  let atLineStart = true;
  while (at < text.length) {
    if (atLineStart) {
      atLineStart = false;
      FENCE_OPEN.lastIndex = at;
      const fence = FENCE_OPEN.exec(text);
      const run = fence?.[1];
      if (fence && run && !(run.startsWith('`') && fence[2]?.includes('`'))) {
        at = fenceEnd(text, run, at + fence[0].length);
        continue;
      }
    }
    NEXT.lastIndex = at;
    const next = NEXT.exec(text);
    if (!next) break;
    if (next[0] === '\n') {
      at = next.index + 1;
      atLineStart = true;
    } else if (next[0] === '<!--') {
      at = readComment(text, next.index, markers, ledgers, memo);
    } else {
      at = skipCodeSpan(text, next.index, next[0].length, memo);
    }
  }
  return { markers, ledgers };
}

/** Reads the comment at `at`: a marker, a ledger, or an ordinary comment. Returns where to go on. */
function readComment(
  text: string,
  at: number,
  markers: Marker[],
  ledgers: LedgerCandidate[],
  memo: Memo,
): number {
  OPENER.lastIndex = at;
  const open = OPENER.exec(text);
  const [, kind, openId, payload] = open ?? [];
  if (open && kind !== undefined && isKind(kind) && openId !== undefined && isId(openId)) {
    const marker: Marker = { type: 'open', id: openId, kind, from: at, to: at + open[0].length };
    if (payload !== undefined) marker.payload = decodePayload(payload);
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
  if (at === 0 || text[at - 1] === '\n') {
    LEDGER_HEAD.lastIndex = at;
    const head = LEDGER_HEAD.exec(text);
    if (head) ledgers.push({ start: at, headerEnd: at + head[0].length, end });
  }
  return end + 3;
}

function lineEndAt(text: string, from: number): number {
  const newline = text.indexOf('\n', from);
  return newline === -1 ? text.length : newline;
}

/** The end of the fenced code block whose opening line ends at `from`: the end of the closing
 * fence's line, or the end of the text when the block is never closed (as in CommonMark). */
function fenceEnd(text: string, run: string, from: number): number {
  let end = lineEndAt(text, from);
  while (end < text.length) {
    const start = end + 1;
    end = lineEndAt(text, start);
    const close = FENCE_CLOSE.exec(text.slice(start, end))?.[1];
    if (close && close.startsWith(run.charAt(0)) && close.length >= run.length) return end;
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
  if (!ATX_HEADING.test(text.slice(lineStart, end))) {
    while (end < text.length) {
      const nextEnd = lineEndAt(text, end + 1);
      const line = text.slice(end + 1, nextEnd);
      if (BLANK_LINE.test(line) || BLOCK_START.test(line)) break;
      end = nextEnd;
    }
  }
  memo.paragraph = { from: lineStart, to: end };
  return end;
}
