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
const RAW_OPEN = /^[ \t]{0,3}<(script|pre|style|textarea)(?=[\s>]|$)/i;

/** Words for an edit that would end the block it is in. */
const ENDS_BLOCK =
  'This would end the code block it is typed in. Change the code first, or turn off Track Changes.';

/** The edit's lines, without the carriage returns that end them. */
const linesOf = (s: string) => s.split('\n').map((line) => line.replace(/\r$/, ''));

/** The start of the line break that ends the line before the one that starts at `start`. */
function breakBefore(text: string, start: number): number {
  return text[start - 2] === '\r' ? start - 2 : start - 1;
}

/**
 * The block that holds every edit, when they all fall in the code of one block. Null when no edit
 * does, or one falls outside the code, in a fence or a tag, or across a block's end.
 */
export function codeBlockOf(
  text: string,
  verbatim: readonly Verbatim[],
  edits: readonly TextChange[],
  frontEnd: number,
  markers: readonly Range[],
): { block: CodeBlock; edits: TextChange[] } | null {
  const first = edits[0];
  if (!first || edits.length === 0) return null;
  const lo = Math.min(...edits.map((edit) => edit.from));
  const hi = Math.max(...edits.map((edit) => edit.to));
  if (lo <= frontEnd) return null;
  let block: CodeBlock | null = null;
  const found = verbatim.find(
    (range) => range.kind !== 'comment' && range.from <= lo && hi <= range.to,
  );
  if (found) block = found.kind === 'fence' ? fencedBlock(text, found) : rawBlock(text, found);
  if (!block && text.includes('$$')) block = mathBlock(text, lo, hi, verbatim);
  if (!block && /^( {4}|\t)/.test(text.slice(lineStart(text, lo), lineEnd(text, lo)))) {
    block = indentedBlock(text, lo, hi, markers);
  }
  if (!block) return null;
  const within = block;
  // A line break typed at the start of the closing line is one typed at the end of the line before.
  const eol = text[within.editTo] === '\r' ? '\r\n' : '\n';
  const closing = within.editTo + eol.length;
  const moved = edits.map((edit) =>
    within.kind !== 'indented' &&
    edit.from === edit.to &&
    edit.from === closing &&
    /\n$/.test(edit.insert)
      ? { from: within.editTo, to: within.editTo, insert: eol + edit.insert.replace(/\r?\n$/, '') }
      : edit,
  );
  return moved.every((edit) => inCode(text, within, edit)) ? { block, edits: moved } : null;
}

/** Whether an edit falls in the code of a block, and keeps its first and last lines as they are. */
function inCode(text: string, block: CodeBlock, edit: TextChange): boolean {
  if (edit.from < block.editFrom || edit.to > block.editTo) return false;
  if (block.kind === 'indented') return true;
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
  const lastStart = lineStart(text, range.to);
  if (lastStart <= range.from || !RAW_OPEN.test(text.slice(range.from, firstEnd))) return null;
  return {
    kind: 'html',
    from: range.from,
    to: range.to,
    editFrom: firstEnd,
    editTo: breakBefore(text, lastStart),
    prefix: /^[ \t]*/.exec(text.slice(range.from, firstEnd))?.[0] ?? '',
    open: text.slice(range.from, firstEnd),
    close: text.slice(lastStart, range.to),
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
    if (MATH_LINE.test(text.slice(start, end))) {
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
  markers: readonly Range[],
): CodeBlock | null {
  const blocks = indentedCodeBlocks(text);
  const range = blocks.find((block) => block.from <= lo && hi <= block.to);
  if (!range || range.from !== lineStart(text, range.from)) return null;
  let above = range.from;
  while (above > 0) {
    const start = lineStart(text, above - 1);
    above = start;
    if (text.slice(start, lineEnd(text, start)).trim() !== '') break;
  }
  if (markers.some((marker) => marker.from < range.to && above < marker.to)) return null;
  return {
    kind: 'indented',
    from: range.from,
    to: range.to,
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
    case 'math':
      if (inner.some((line) => line.includes('$$'))) {
        throw new EditError(ENDS_BLOCK, 'no-legal-placement');
      }
      break;
    case 'html': {
      const name = RAW_OPEN.exec(block.open)?.[1] ?? '';
      if (inner.some((line) => new RegExp(`</${name}`, 'i').test(line))) {
        throw new EditError(ENDS_BLOCK, 'no-legal-placement');
      }
      break;
    }
    case 'indented': {
      const blocks = indentedCodeBlocks(now.replace(/\r/g, ''));
      const only = blocks.length === 1 && blocks[0]?.from === 0;
      const trimmed = now.replace(/[ \t\r\n]+$/, '');
      if (!only || (blocks[0]?.to ?? 0) < trimmed.length) {
        throw new EditError(ENDS_BLOCK, 'no-legal-placement');
      }
    }
  }
}

/** The payload of a substitution of a block: its text, one line. */
export const payloadOf = (old: string) => encodePayload(old);
