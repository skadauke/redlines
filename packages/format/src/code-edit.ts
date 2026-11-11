// Code edited with Track Changes on (format §3.5, rule 9): a fenced code block, indented code,
// display math and a block of raw text hold no markers, so a change inside one replaces the block
// whole. The old block is the payload of a substitution (its backticks escaped, so that knitr
// finds no chunk in it), and the block in the file holds the newest code. Further keystrokes of
// the same person in a block that their own pending insertion or substitution holds edit the code
// and make no mark. Another person's pending change that holds the block is theirs to decide
// first: the edit is refused, naming them.
//
// This module finds the block an edit lies in and plans the changes; `track.ts` commits them.

import { encodePayload } from './payload.ts';
import { lineEnd, lineStart } from './blocks.ts';
import { EditError } from './errors.ts';
import { nameOf } from './edit-support.ts';
import { indentedCodeBlocks } from './indented-code.ts';
import type { Verbatim } from './scan.ts';
import type { MarkerRange } from './markers.ts';
import type { MarkRange, Parsed, Person, Range, TextChange } from './types.ts';

/** The kinds of block a change replaces whole. */
export type CodeKind = 'fenced' | 'math' | 'html' | 'indented';

/** A block of code, math or raw text, and the part of it that an edit may fall in. */
export interface CodeBlock {
  kind: CodeKind;
  /** The start of its first line. */
  from: number;
  /** The end of its last line, before the line break. */
  to: number;
  /** Edits fall in `[editFrom, editTo]`: the code between the lines that open and close it, with the
   * line break that ends the opening line at its start and the one that starts the closing line at
   * its end. A fence or a tag is no code. */
  editFrom: number;
  editTo: number;
  /** Display math in a paragraph (`$$x = 1$$`, or `$$` lines with no blank line in them): the
   * edits fall between its two `$$`. */
  inline?: true;
  /** Indented code and the line of white space under it that something is typed on (the open line
   * that Return at its end opens): the block's end before that line, where the payload ends. */
  oldTo?: number;
  /** Indented code: the marks in it or just above it. */
  near?: MarkRange[];
  /** What stands in front of its first line's fence or tag: the quote markers and the indentation
   * of its container, which every line of the block has too. */
  prefix: string;
  /** The text of the lines that open and close the block, which an edit leaves as they are. */
  open: string;
  close: string;
}

/** A pending change that holds a block, and whose it is. */
export interface Holder {
  mark: MarkRange;
  content: Range;
  own: boolean;
}

const OPEN_FENCE = /^([ \t>]*)(`{3,}|~{3,})/;
const CLOSE_FENCE = /^[ \t>]*(`{3,}|~{3,})[ \t]*$/;
const MATH_LINE = /^[ \t>]*\$\$[ \t]*$/;
const RAW_OPEN = /^[ \t]{0,3}<(script|pre|style|textarea|title)(?=[\s>]|$)/i;

/** Words for an edit that would end the block it is in. */
const ENDS_BLOCK =
  'This would end the code block it is typed in. Change the code first, or turn off Track Changes.';

/** The edit's lines, without the carriage returns that end them. */
const linesOf = (s: string) => s.split('\n').map((line) => line.replace(/\r$/, ''));

/** The start of the line break that ends the line before the one that starts at `start`. */
function breakBefore(text: string, start: number): number {
  return text[start - 2] === '\r' ? start - 2 : start - 1;
}

/** Line breaks and the prefixes of the container's lines (a quote's `>`, a list item's spaces): what
 * Return types against a block. */
const isBreak = (insert: string) =>
  /^[ \t\r\n]*$/.test(insert) || /^(?:\r?\n[ \t>]*)+$/.test(insert);

/** What `codeBlockOf` finds: the block the edits touch, the edits (a line break typed at the start of
 * the closing line moved to the end of the line before), and whether every one is in the code. */
export interface Located {
  block: CodeBlock;
  edits: TextChange[];
  inCode: boolean;
}

/** The words for code that is not built yet: the edit is refused, and with Track Changes off every
 * key works as in any code. */
export const NOT_BUILT = {
  item: "A tracked change can't go in code that starts a list item yet. Turn off Track Changes to edit it.",
  container:
    "A tracked change can't go in indented code in a list item or a quote yet. Turn off Track Changes to edit it.",
};

/**
 * The block that the edits touch, when they all fall in one block's range: its code (`inCode`), or
 * its fence, tag or `$$` lines, which no change goes on. Null when no edit touches a block, or an
 * edit is at the very start or end of one, which is outside it. Throws for code that is not built.
 */
export function codeBlockOf(
  text: string,
  verbatim: readonly Verbatim[],
  edits: readonly TextChange[],
  frontEnd: number,
  markers: readonly MarkerRange[],
): Located | null {
  const first = edits[0];
  if (!first || edits.length === 0) return null;
  const lo = Math.min(...edits.map((edit) => edit.from));
  const hi = Math.max(...edits.map((edit) => edit.to));
  if (lo <= frontEnd) return null;
  let block: CodeBlock | null = null;
  const found = verbatim.find(
    (range) => range.kind !== 'comment' && range.from <= lo && hi <= range.to,
  );
  if (found) {
    block = found.kind === 'fence' ? fencedBlock(text, found) : rawBlock(text, found);
    const item = /^[ \t>]*(?:[-*+]|\d{1,9}[.)])[ \t]/.test(
      text.slice(found.from, lineEnd(text, found.from)),
    );
    if (!block && found.kind === 'fence' && item && lo > found.from && hi < found.to) {
      // A fence that starts a list item: the mark would go after the bullet.
      throw new EditError(NOT_BUILT.item, 'inside-code');
    }
  }
  if (!block && text.includes('$$')) {
    block = mathBlock(text, lo, hi, verbatim) ?? paragraphMath(text, lo, hi, verbatim);
  }
  if (!block && /^[ \t>]*(?: {4}|\t)/.test(text.slice(lineStart(text, lo), lineEnd(text, lo)))) {
    block = indentedBlock(text, lo, hi, markers);
  }
  if (!block) return null;
  const within = block;
  // At the very start or end of a block, a change is outside it.
  // Line breaks are the text around it; anything else typed against the `$$` of display math is
  // read as part of the block, which it could not be (`x$$` opens no math): refused.
  if (
    within.kind !== 'indented' &&
    lo === hi &&
    (lo === within.from || lo === within.from + within.prefix.length || lo === within.to) &&
    (within.kind !== 'math' || edits.every((edit) => isBreak(edit.insert)))
  ) {
    return null;
  }
  // A line break typed at the start of the closing line is one typed at the end of the line before.
  const eol = text[within.editTo] === '\r' ? '\r\n' : '\n';
  const closing = within.editTo + eol.length;
  const moved = edits.map((edit) =>
    within.kind !== 'indented' &&
    !within.inline &&
    edit.from === edit.to &&
    edit.from === closing &&
    /\n$/.test(edit.insert)
      ? { from: within.editTo, to: within.editTo, insert: eol + edit.insert.replace(/\r?\n$/, '') }
      : edit,
  );
  const inside = moved.every((edit) => inCode(text, within, edit));
  // Indented code takes only what is in it: the rest is the text around it.
  if (within.kind === 'indented' && !inside) return null;
  return { block, edits: moved, inCode: inside };
}

/** Whether an edit falls in the code of a block, and keeps its first and last lines as they are. */
function inCode(text: string, block: CodeBlock, edit: TextChange): boolean {
  if (edit.from < block.editFrom || edit.to > block.editTo) return false;
  if (block.kind === 'indented') {
    // White space put at the end of the last line is no part of the block: it is after it.
    return !(
      edit.from === edit.to &&
      edit.from === block.editTo &&
      /^[ \t\r\n]*$/.test(edit.insert)
    );
  }
  if (block.inline) return true;
  // The line break that ends the opening line is not taken away, nor text put before it: the
  // opening line is a fence, and what is typed at its end would be its info string.
  if (edit.from === block.editFrom && (edit.to > edit.from || !/^\r?\n/.test(edit.insert))) {
    return false;
  }
  return edit.to <= block.editTo && text.length >= edit.to;
}

/** The end of a scanned range, before the carriage return that ends its last line. */
const endOf = (text: string, range: Range) =>
  text[range.to - 1] === '\r' ? range.to - 1 : range.to;

function fencedBlock(text: string, scanned: Range): CodeBlock | null {
  const range = { from: scanned.from, to: endOf(text, scanned) };
  const firstEnd = lineEnd(text, range.from);
  const lastStart = lineStart(text, range.to);
  if (lastStart <= range.from) return null;
  const open = text.slice(range.from, firstEnd);
  const close = text.slice(lastStart, range.to);
  const run = OPEN_FENCE.exec(open)?.[2];
  const closing = CLOSE_FENCE.exec(close)?.[1];
  if (!run || !closing || closing[0] !== run[0] || closing.length < run.length) return null;
  // A list marker in front of the fence is the item's: the mark would go after the bullet.
  if (/[-*+]|\d/.test(OPEN_FENCE.exec(open)?.[1] ?? '')) return null;
  return {
    kind: 'fenced',
    from: range.from,
    to: range.to,
    editFrom: firstEnd,
    editTo: breakBefore(text, lastStart),
    prefix: OPEN_FENCE.exec(open)?.[1] ?? '',
    open,
    close,
  };
}

function rawBlock(text: string, scanned: Range): CodeBlock | null {
  const range = { from: scanned.from, to: endOf(text, scanned) };
  const firstEnd = lineEnd(text, range.from);
  const name = RAW_OPEN.exec(text.slice(range.from, firstEnd))?.[1];
  if (!name) return null;
  // The code is what stands between the opening tag's `>` and the closing tag.
  const gt = text.indexOf('>', range.from);
  if (gt < 0 || gt >= range.to) return null;
  const closer = new RegExp(`</${name}`, 'gi');
  closer.lastIndex = gt + 1;
  const end = closer.exec(text);
  if (!end || end.index + end[0].length > range.to) return null;
  return {
    kind: 'html',
    inline: true,
    from: range.from,
    to: range.to,
    editFrom: gt + 1,
    editTo: end.index,
    prefix: /^[ \t]*/.exec(text.slice(range.from, firstEnd))?.[0] ?? '',
    open: text.slice(range.from, gt + 1),
    close: text.slice(end.index, range.to),
  };
}

/**
 * Display math in a paragraph: it starts with `$$` and ends with `$$`, with no blank line between
 * (`$$x = 1$$`, or `$$`, lines of math and `$$` as Markdown readers have it). Edits fall between the
 * two `$$`.
 */
function paragraphMath(
  text: string,
  lo: number,
  hi: number,
  verbatim: readonly Verbatim[],
): CodeBlock | null {
  // A line of markers alone is no line of the paragraph: the block starts and ends at it.
  const blank = (at: number) =>
    /^[ \t>]*(?:<!--[^]*?-->[ \t]*)*\r?$/.test(text.slice(lineStart(text, at), lineEnd(text, at)));
  const inVerbatim = (at: number) => verbatim.some((range) => range.from <= at && at < range.to);
  let from = lineStart(text, lo);
  for (let n = 0; n < 200 && from > 0 && !blank(from - 1) && !inVerbatim(from - 1); n++) {
    from = lineStart(text, from - 1);
  }
  let to = lineEnd(text, hi);
  for (let n = 0; n < 200 && to < text.length && !blank(to + 1) && !inVerbatim(to + 1); n++) {
    to = lineEnd(text, to + 1);
  }
  if (blank(from) || inVerbatim(from)) return null;
  // Markers on its lines are not math: they are masked, so that their payloads hold no `$$` to find.
  const body = text.slice(from, to).replace(/<!--[^]*?-->/g, (marker) => ' '.repeat(marker.length));
  const prefix = /^[ \t>]*/.exec(body)?.[0] ?? '';
  const open = body.slice(prefix.length).startsWith('$$') ? prefix.length : -1;
  const close = body.lastIndexOf('$$');
  if (open < 0 || close < open + 2 || !/^[ \t]*$/.test(body.slice(close + 2))) return null;
  // Text after a line of the paragraph that is no math, a list marker or a heading, starts a block.
  return {
    kind: 'math',
    inline: true,
    from,
    to,
    editFrom: from + open + 2,
    editTo: from + close,
    prefix,
    open: text.slice(from, from + open + 2),
    close: text.slice(from + close, to),
  };
}

/** Display math: a line of `$$`, lines of math, a line of `$$`, outside fenced code. */
function mathBlock(
  text: string,
  lo: number,
  hi: number,
  verbatim: readonly Verbatim[],
): CodeBlock | null {
  let open = -1;
  for (let start = 0; start <= text.length;) {
    if (open < 0 && start > hi) break;
    const end = lineEnd(text, start);
    const fenced = verbatim.find((range) => range.from <= start && start < range.to);
    if (fenced) {
      // Past the whole block: a line of `$$` in it is code.
      start = Math.max(nextAfter(text, fenced.to), start + 1);
      continue;
    }
    const line = text.slice(start, end);
    const bare = line.replace(/<!--[^]*?-->/g, '');
    // A closing line that markers and the text after them share is the block's too, so that the
    // markers on it are found in its range.
    if (MATH_LINE.test(bare) || (open >= 0 && bare !== line && /^[ \t>]*\$\$/.test(bare))) {
      if (open < 0) open = start;
      else {
        if (end >= hi && open <= lo) {
          return {
            kind: 'math',
            from: open,
            to: end,
            editFrom: lineEnd(text, open),
            editTo: breakBefore(text, start),
            prefix: /^[ \t>]*/.exec(text.slice(open, lineEnd(text, open)))?.[0] ?? '',
            open: text.slice(open, lineEnd(text, open)),
            close: text.slice(start, end),
          };
        }
        open = -1;
      }
    }
    start = nextAfter(text, end);
  }
  return null;
}

/** The start of the line after the one that ends at `end`. */
function nextAfter(text: string, end: number): number {
  const newline = text.indexOf('\n', end);
  return newline === -1 ? text.length + 1 : newline + 1;
}

/**
 * Indented code at the top level. A line is code in the file as it stands, but in one view only
 * when a pending change next to it adds or takes away the blank line that makes it code, and then
 * its readers part ways (#153): no marker may stand in the block, or in the lines up to the text
 * above it, which is where such a change would be.
 */
function indentedBlock(
  text: string,
  lo: number,
  hi: number,
  markers: readonly MarkerRange[],
): CodeBlock | null {
  const blocks = indentedCodeBlocks(text);
  let range = blocks.find((block) => block.from <= lo && hi <= block.to);
  let oldTo: number | undefined;
  if (!range && lo === hi) {
    // A line of white space right under the block, indented as code is, which something is typed
    // at the end of: it goes on the block's code, and the block replaced is the one without it.
    const line = text.slice(lineStart(text, lo), lineEnd(text, lo));
    const under = blocks.find((block) => {
      if (lineEnd(text, lo) !== lo || !/^(?: {4}|\t)[ \t]*$/.test(line)) return false;
      const gap = text.slice(block.to, lineStart(text, lo));
      return /^(?:[ \t]*\r?\n)+$/.test(gap);
    });
    if (under) {
      oldTo = under.to;
      range = { from: under.from, to: lo };
    }
  }
  if (
    range &&
    lo === hi &&
    lo === range.to &&
    /^[ \t]*$/.test(text.slice(lineStart(text, lo), lo))
  ) {
    // The open line is read as the block's last line: the block replaced is the one without it.
    const text0 = text.slice(range.from, range.to).replace(/[ \t\r\n]+$/, '');
    if (text0.length > 0) oldTo = range.from + text0.length;
  }
  if (!range) return null;
  // Indented code in a list item or a quote is not built.
  if (range.from !== lineStart(text, range.from))
    throw new EditError(NOT_BUILT.container, 'inside-code');
  // Where the blank lines that open the block start (or the block, with none), and the end of the
  // line of text above them, which a pending deletion of the break stands at the end of.
  let gap = range.from;
  while (gap > 0) {
    const start = lineStart(text, gap - 1);
    if (text.slice(start, lineEnd(text, start)).trim() !== '') break;
    gap = start;
  }
  const edge = gap > 0 ? gap - (text[gap - 2] === '\r' ? 2 : 1) : 0;
  // A marker in the block or in the blank lines that open it, or at the end of the line above, is a
  // pending change that could make it code in one view and text in the other: the key is refused,
  // by the marks (which the substitution that holds the block is not).
  const near = markers
    .filter(
      (marker) =>
        marker.mark !== undefined &&
        marker.from < range.to &&
        (edge <= marker.to ||
          // A deletion of the blank line that opens the block, on the line of text above it: the
          // text after it on that line is the block's first line in the original text.
          (marker.role === 'open' &&
            gap > 0 &&
            lineStart(text, gap - 1) <= marker.from &&
            /\n[ \t]*\r?\n[ \t]*$/.test(marker.segment?.payload ?? ''))),
    )
    .map((marker) => marker.mark as MarkRange);
  return {
    kind: 'indented',
    ...(near.length > 0 ? { near } : {}),
    from: range.from,
    to: range.to,
    ...(oldTo === undefined ? {} : { oldTo }),
    editFrom: range.from,
    editTo: range.to,
    prefix: '',
    open: '',
    close: '',
  };
}

/** The pending changes of insertions and substitutions that hold `block`. */
export function holdersOf(block: CodeBlock, holders: readonly Holder[]): Holder[] {
  return holders.filter(
    (holder) => holder.content.from <= block.from && block.to <= holder.content.to,
  );
}

/** The refusal of an edit in a block that another person's pending change holds. */
export function theirChange(parsed: Parsed, mark: MarkRange, author: Person): EditError {
  return new EditError(
    `This would change how ${nameOf(parsed, mark, author)} reads. Decide it first, or turn off Track Changes.`,
    'no-legal-placement',
  );
}

/** The refusal of an edit in a block whose range holds a pending change that is not the one the edit
 * goes through: it is decided first. */
export function markInCode(parsed: Parsed, mark: MarkRange, author: Person): EditError {
  const { by } = mark.entry;
  const whose =
    by === author.handle
      ? 'Your'
      : `${parsed.ledger.people.find((person) => person.handle === by)?.name ?? by}'s`;
  return new EditError(
    `${whose} pending change is in this code block. Decide it first, or turn off Track Changes.`,
    'no-legal-placement',
  );
}

/** Words for an edit on a fence, a tag or a `$$` line, which hold no code. */
export const NOT_CODE =
  "A tracked change can't go on the line that opens or closes code, math or raw text. Turn off Track Changes to edit it.";

/** Words for a block whose line breaks are not all the file's: the payload gives one kind back. */
export const MIXED_BREAKS =
  "This code block has line breaks that the rest of the file doesn't, which a tracked change can't give back exactly yet. Turn off Track Changes to edit it.";

/** The block as it is after the edits: what the substitution's new text holds. */
export function edited(text: string, block: CodeBlock, edits: readonly TextChange[]): string {
  let out = '';
  let at = block.from;
  for (const edit of edits.toSorted((a, b) => a.from - b.from || a.to - b.to)) {
    out += text.slice(at, edit.from) + edit.insert;
    at = edit.to;
  }
  return out + text.slice(at, block.to);
}

/**
 * Throws when the block, as the edits leave it, would not be the one block it was: a line in it
 * that closes it early, or, in indented code, a line that is code no more.
 */
export function assertStillBlock(block: CodeBlock, now: string): void {
  const lines = linesOf(now);
  const inner = lines.slice(1, -1);
  // Every line keeps the container's prefix (a blank line may lose its trailing space): a line
  // without it would end the quote or the list item the block is in.
  const { prefix } = block;
  if (
    prefix !== '' &&
    lines.some((line) => !line.startsWith(prefix) && line !== prefix.trimEnd())
  ) {
    throw new EditError(ENDS_BLOCK, 'no-legal-placement');
  }
  switch (block.kind) {
    case 'fenced': {
      const run = OPEN_FENCE.exec(block.open)?.[2] ?? '```';
      const ends = inner.some((line) => {
        const fence = CLOSE_FENCE.exec(line)?.[1];
        return fence !== undefined && fence[0] === run[0] && fence.length >= run.length;
      });
      if (ends) throw new EditError(ENDS_BLOCK, 'no-legal-placement');
      break;
    }
    case 'math': {
      if (block.inline) {
        // One paragraph, `$$` at its start and its end, and no `$$` between them.
        const body = now.slice(prefix.length);
        const inside = body.slice(2, body.lastIndexOf('$$'));
        if (
          !body.startsWith('$$') ||
          body.lastIndexOf('$$') < 2 ||
          inside.includes('$$') ||
          lines.some((line) => /^[ \t>]*$/.test(line))
        ) {
          throw new EditError(ENDS_BLOCK, 'no-legal-placement');
        }
      } else if (
        !MATH_LINE.test(lines[0] ?? '') ||
        !MATH_LINE.test(lines.at(-1) ?? '') ||
        inner.some((line) => line.includes('$$'))
      ) {
        throw new EditError(ENDS_BLOCK, 'no-legal-placement');
      }
      break;
    }
    case 'html': {
      const name = RAW_OPEN.exec(block.open)?.[1] ?? '';
      const inside = now.slice(block.open.length, now.length - block.close.length);
      if (new RegExp(`</${name}`, 'i').test(inside)) {
        throw new EditError(ENDS_BLOCK, 'no-legal-placement');
      }
      break;
    }
    case 'indented': {
      const blocks = indentedCodeBlocks(now.replace(/\r/g, ''));
      const only = blocks.length === 1 && blocks[0]?.from === 0;
      const trimmed = now.replace(/\r/g, '').replace(/[ \t\n]+$/, '');
      if (!only || (blocks[0]?.to ?? 0) < trimmed.length) {
        throw new EditError(ENDS_BLOCK, 'no-legal-placement');
      }
    }
  }
}

/** The payload of a substitution of a block: its text, one line. */
export const payloadOf = (old: string) => encodePayload(old);
