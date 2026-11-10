// Indented code blocks (format §2.1): where CommonMark reads them in a text, and which markers of a
// file stand in one, in the file as a renderer reads it or at their places in its newest or its
// original view. A reader reads a marker in indented code as a marker, but every renderer shows it
// as code, so no edit writes one there, and none puts one there by moving what is around it. This
// is not a Markdown parser: it reads the blocks of a text line by line, with their block quotes and
// list items, as far as telling indented code from the rest needs. Where renderers part ways, as
// on an indented line after a table, it reads code.

import { HTML_STARTS as HTML } from './block-read.ts';
import { bodyStart } from './blocks.ts';
import { LONE_TAG } from './format-reader.ts';
import { scan } from './scan.ts';
import type { DocView, Range } from './types.ts';
import { viewsOnce } from './views.ts';
import type { Views } from './views.ts';

/** A container that a line can go on with. An item's `width` is how many columns of a line belong
 * to it, from where its container's content starts; `empty` holds while no block is in it. */
type Container = { kind: 'quote' } | { kind: 'item'; width: number; empty: boolean };

/** The block that takes the next line, if it goes on. Indented code ends at `to`, its last line
 * with text; a blank line may come after it and more code after that. */
type Leaf =
  | { kind: 'paragraph'; table: boolean; last: string }
  | { kind: 'code'; from: number; to: number }
  | { kind: 'fence'; fence: string }
  | { kind: 'html'; end: RegExp | null };

const ATX = /^#{1,6}(?:[ \t]|$)/;
const FENCE = /^(`{3,}|~{3,})(.*)$/;
const CLOSING_FENCE = /^(`{3,}|~{3,})[ \t]*$/;
const THEMATIC = /^(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const UNDERLINE = /^(?:=+|-+)[ \t]*$/;
const ITEM = /^(?:[-+*]|(\d{1,9})[.)])(?=[ \t]|$)/;
/** The delimiter row of a table, which makes a table of the paragraph line above it (GFM). */
const DELIMITER = /^\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
// The starts of HTML blocks are CommonMark's kinds 1 to 6 (`HTML`), each with its end, null for the
// ones a blank line ends, and a tag alone on its line (`LONE_TAG`), which can't interrupt a
// paragraph and ends at a blank line.

/** One line, and the column each of its characters starts at (a tab goes on to the next multiple
 * of four), worked out as far as they are asked for. */
class Line {
  readonly text: string;
  readonly start: number;
  private readonly columns = [0];

  constructor(text: string, start: number) {
    this.text = text;
    this.start = start;
  }

  /** The column that character `index` starts at; the line's length gives the column after it. */
  column(index: number): number {
    const { columns, text } = this;
    for (let i = columns.length; i <= index; i++) {
      const before = columns[i - 1] ?? 0;
      columns.push(text[i - 1] === '\t' ? before + 4 - (before % 4) : before + 1);
    }
    return columns[index] ?? 0;
  }

  /** The first character from `index` on that is not a space or a tab, or the line's length. */
  textFrom(index: number): number {
    let at = index;
    while (this.text[at] === ' ' || this.text[at] === '\t') at++;
    return at;
  }
}

/** Where a line is read: the character, and the column, which is past the character's start when a
 * container took part of a tab. */
interface Cursor {
  index: number;
  column: number;
}

/** The cursor moved on to `column`, in the middle of a tab if it falls there. */
function advance(line: Line, cursor: Cursor, column: number): Cursor {
  let { index } = cursor;
  while (index < line.text.length && line.column(index + 1) <= column) index++;
  return { index, column };
}

/** The cursor past a quote marker at `at`, and the one space, or one column of a tab, after it. */
function pastQuote(line: Line, at: number): Cursor {
  const after = { index: at + 1, column: line.column(at + 1) };
  const next = line.text[at + 1];
  return next === ' ' || next === '\t' ? advance(line, after, after.column + 1) : after;
}

/** Whether `rest`, after at most three columns of indentation, starts a block, so that the line
 * goes on no paragraph: a quote, a heading, a fence, a thematic break, an HTML block but one of a
 * lone tag, or a list item. In the paragraph's own container (`inParagraph`), an empty item starts
 * none, and nor does one numbered from another number than 1. On a line that lacks the markers of
 * the paragraph's containers, which could go on it lazily, they do (CommonMark). */
function startsBlock(rest: string, inParagraph: boolean): boolean {
  if (rest === '') return false;
  if (rest.startsWith('>') || ATX.test(rest) || THEMATIC.test(rest) || opensFence(rest)) {
    return true;
  }
  if (HTML.some(([open]) => open.test(rest))) return true;
  const item = ITEM.exec(rest);
  if (!item) return false;
  if (!inParagraph) return true;
  const empty = rest.slice(item[0].length).trim() === '';
  return !empty && (item[1] === undefined || Number(item[1]) === 1);
}

/** The fence that opens a block, if `rest` starts with one: a backtick fence's info string has
 * no backtick. */
function opensFence(rest: string): string | undefined {
  const fence = FENCE.exec(rest);
  const run = fence?.[1];
  if (!run || (run.startsWith('`') && fence[2]?.includes('`'))) return undefined;
  return run;
}

/**
 * The indented code blocks of `text[from, to)`, in order: each from where the code's indentation
 * starts on its first line, after the prefix of its container (the quote markers, the indentation
 * of a list item), to the end of its last line with text. The blank lines between its lines are in
 * it, and those after it are not. They are the blocks of CommonMark's reading and of micromark's,
 * which reads a few lines otherwise (`readCode`), together: what either reads as code.
 */
export function indentedCodeBlocks(text: string, from = 0, to = text.length): Range[] {
  const all = [...readCode(text, from, to, false), ...readCode(text, from, to, true)].sort(
    (a, b) => a.from - b.from || a.to - b.to,
  );
  const blocks: Range[] = [];
  for (const block of all) {
    const last = blocks.at(-1);
    if (last && block.from <= last.to) last.to = Math.max(last.to, block.to);
    else blocks.push({ ...block });
  }
  return blocks;
}

/**
 * The indented code blocks of `text[from, to)` as CommonMark reads them, or with `micromark`, as
 * micromark does where it parts ways with it: on a line that goes on every container of the line
 * before, after indented code, and behind a container that the line starts after a paragraph, an
 * empty item or one numbered from another number than 1 is no item but text; and in a quote, a
 * lone tag on a line that lacks the markers of the paragraph's containers goes on no paragraph,
 * but starts an HTML block.
 */
function readCode(text: string, from: number, to: number, micromark: boolean): Range[] {
  const blocks: Range[] = [];
  const stack: Container[] = [];
  let leaf: Leaf | undefined;
  // The last line with text was indented code, on a line that went on every container above it or
  // started one: micromark reads the code of a line that does neither as a lazy line, and what
  // comes after it interrupts nothing.
  let afterCode = false;
  const close = () => {
    if (leaf?.kind === 'code') blocks.push({ from: leaf.from, to: leaf.to });
    leaf = undefined;
  };
  // The innermost item has a block in it now.
  const filled = () => {
    const top = stack.at(-1);
    if (top?.kind === 'item') top.empty = false;
  };
  for (let start = from; start <= to;) {
    const newline = text.indexOf('\n', start);
    const end = newline === -1 || newline >= to ? to : newline;
    const raw = text.slice(start, end);
    const line = new Line(raw.endsWith('\r') ? raw.slice(0, -1) : raw, start);
    start = end + 1;
    let cursor: Cursor = { index: 0, column: 0 };
    // The containers the line goes on with.
    let matched = 0;
    for (const container of stack) {
      const at = line.textFrom(cursor.index);
      const blank = at === line.text.length;
      const indent = line.column(at) - cursor.column;
      if (container.kind === 'quote') {
        if (blank || indent > 3 || line.text[at] !== '>') break;
        cursor = pastQuote(line, at);
      } else if (blank) {
        // A blank line goes on with an item that has a block in it: one right after an empty
        // item's marker ends it, however indented (commonmark.js, micromark).
        if (container.empty) break;
      } else if (indent >= container.width) {
        cursor = advance(line, cursor, cursor.column + container.width);
      } else break;
      matched++;
    }
    const all = matched === stack.length;
    let at = line.textFrom(cursor.index);
    let indent = line.column(at) - cursor.column;
    let rest = line.text.slice(at);
    const blank = rest === '';
    const codeAbove = afterCode;
    const paragraphAbove = leaf?.kind === 'paragraph';
    if (!blank) afterCode = false;

    // A fence and an HTML block take every line of their container, as far as their end.
    if (leaf?.kind === 'fence' || leaf?.kind === 'html') {
      if (all) {
        if (leaf.kind === 'fence') {
          const closing = CLOSING_FENCE.exec(rest)?.[1];
          if (
            indent <= 3 &&
            closing?.startsWith(leaf.fence[0] ?? '') &&
            closing.length >= leaf.fence.length
          ) {
            close();
          }
        } else if (blank && leaf.end === null) close();
        else if (leaf.end?.test(line.text.slice(cursor.index))) close();
        continue;
      }
      close();
    }
    // A paragraph goes on, lazily too, unless the line starts another block: indented code can't
    // interrupt it. An underline makes a heading of it.
    if (leaf?.kind === 'paragraph' && !blank) {
      if (all && !leaf.table && indent <= 3 && UNDERLINE.test(rest)) {
        close();
        continue;
      }
      if (indent >= 4 || !startsBlock(rest, all)) {
        if (
          micromark &&
          !all &&
          indent < 4 &&
          LONE_TAG.test(rest) &&
          stack.some((container) => container.kind === 'quote')
        ) {
          close();
          leaf = { kind: 'html', end: null };
          continue;
        }
        // The lines of a table end at an indented one, which some renderers read as code.
        if (!(leaf.table && all && indent >= 4)) {
          if (all && leaf.last.includes('|') && rest.includes('|') && DELIMITER.test(rest)) {
            leaf.table = true;
          }
          leaf.last = rest;
          continue;
        }
      }
    }
    // Indented code goes on, over blank lines. A line of white space four columns wide or more is
    // a line of it too, after its last line with text, as micromark reads it.
    if (leaf?.kind === 'code' && all) {
      if (blank && indent < 4) continue;
      if (indent >= 4) {
        leaf.to = line.start + line.text.length;
        if (!blank) afterCode = true;
        continue;
      }
    }
    if (!all || blank || leaf?.kind === 'code') close();
    if (!all) stack.length = matched;
    if (blank) continue;

    // The containers the line starts.
    let started = 0;
    for (; ; started++) {
      if (indent >= 4 || rest === '') break;
      if (rest.startsWith('>')) {
        close();
        filled();
        stack.push({ kind: 'quote' });
        cursor = pastQuote(line, at);
      } else {
        const item = THEMATIC.test(rest) ? null : ITEM.exec(rest);
        if (!item) break;
        const marker = at + item[0].length;
        const content = line.textFrom(marker);
        const empty = content === line.text.length;
        // A paragraph goes on over an empty item, and over one numbered from another number. So
        // does indented code above, for micromark, and a paragraph above behind a container the
        // line starts, but only on a line that goes on every container it was in: a line that
        // doesn't, such as the next item of a list, interrupts nothing.
        const weak = empty || (item[1] !== undefined && Number(item[1]) !== 1);
        const text =
          leaf?.kind === 'paragraph' ||
          (micromark && all && (codeAbove || (started > 0 && paragraphAbove)));
        if (weak && text) break;
        const spaces = line.column(content) - line.column(marker);
        // Five spaces or more after the marker make indented code of the text, one space past it.
        const gap = empty || spaces > 4 ? 1 : spaces;
        close();
        filled();
        const column = line.column(marker) + gap;
        stack.push({ kind: 'item', width: column - cursor.column, empty: true });
        cursor = advance(line, { index: marker, column: line.column(marker) }, column);
      }
      at = line.textFrom(cursor.index);
      indent = line.column(at) - cursor.column;
      rest = line.text.slice(at);
    }
    if (rest === '') continue;

    // The block the line starts.
    filled();
    if (indent >= 4) {
      close();
      leaf = { kind: 'code', from: line.start + cursor.index, to: line.start + line.text.length };
      afterCode = all || started > 0;
      continue;
    }
    const fence = opensFence(rest);
    const html = HTML.find(([open]) => open.test(rest));
    if (ATX.test(rest) || THEMATIC.test(rest)) close();
    else if (fence !== undefined) {
      close();
      leaf = { kind: 'fence', fence };
    } else if (html || (leaf?.kind !== 'paragraph' && LONE_TAG.test(rest))) {
      close();
      leaf = { kind: 'html', end: html?.[1] ?? null };
      if (leaf.end?.test(rest)) close();
    } else if (leaf?.kind === 'paragraph') leaf.last = rest;
    else {
      close();
      leaf = { kind: 'paragraph', table: false, last: rest };
    }
  }
  close();
  return blocks;
}

/** What a line starts with before the text that tells its block: quote markers, list markers and
 * white space. */
const LEAD = /^(?:[ \t>]|(?:[-+*]|\d{1,9}[.)])(?=[ \t]|$))*/;

/** The kinds of HTML block that may be open above a line, whose end the line could hold: a comment
 * ends at `-->` and a declaration, such as `<!DOCTYPE`, at `>`, and every marker has both. */
export interface HtmlOpen {
  comment: boolean;
  declaration: boolean;
}

/** Any HTML block may be open. */
export const ANY_HTML: HtmlOpen = { comment: true, declaration: true };

/** Which of an HTML comment and a declaration may be open at `at`, the start of a line of `text`:
 * one has started before it, and nothing that would end it has come since. */
export function htmlOpenAt(text: string, at: number): HtmlOpen {
  if (at === 0) return { comment: false, declaration: false };
  const end = text.lastIndexOf('>', at - 1);
  return {
    comment: text.lastIndexOf('<!--', at - 1) > text.lastIndexOf('-->', at - 1),
    declaration: /<![A-Za-z]/.test(text.slice(end + 1, at)),
  };
}

/**
 * What `readCode` reads of a line, whatever is open above it, as a string to compare: its lead, and
 * the outcome of every test it makes of the text from wherever it may start reading it, which is
 * at a marker of the lead or after the lead. The ends of an HTML comment and of a declaration are
 * left out where neither is open and the line starts neither. Undefined for a line with nothing
 * after its lead, which may be blank in its container.
 */
function lineReading(line: string, open: HtmlOpen): string | undefined {
  const lead = LEAD.exec(line)?.[0] ?? '';
  if (lead.length === line.length) return undefined;
  const text = line.slice(lead.length);
  const starts: number[] = [];
  for (let at = 0; at < lead.length;) {
    if (lead[at] === ' ' || lead[at] === '\t') at++;
    else {
      starts.push(at);
      at += lead[at] === '>' ? 1 : (/^(?:[-+*]|\d{1,9}[.)])/.exec(lead.slice(at))?.[0].length ?? 1);
    }
  }
  starts.push(lead.length);
  const read: unknown[] = [lead, text.includes('|')];
  const opened = new Set<number>();
  for (const at of starts) {
    const rest = line.slice(at);
    const html = HTML.findIndex(([start]) => start.test(rest));
    opened.add(html);
    read.push(
      CLOSING_FENCE.exec(rest)?.[1] ?? '',
      UNDERLINE.test(rest),
      THEMATIC.test(rest),
      DELIMITER.test(rest),
      ATX.test(rest),
      opensFence(rest) ?? '',
      html,
      LONE_TAG.test(rest),
      startsBlock(rest, true),
      startsBlock(rest, false),
    );
  }
  // The end of an HTML block can be anywhere on its lines; no end has a character of a lead but
  // `>`, the declaration's, so the text tells them.
  HTML.forEach(([, end], kind) => {
    if (end === null) return;
    const skip = (kind === 1 && !open.comment) || (kind === 3 && !open.declaration);
    if (!skip || opened.has(kind)) read.push(end.test(text));
  });
  return JSON.stringify(read);
}

/**
 * Whether a line, changed to `after`, is read as it was by `readCode`, whatever lines are around
 * it: the same block, in the same containers, with the same effect on the lines after it. Neither
 * may be blank. `open` says which HTML blocks may be open above it (`htmlOpenAt`).
 */
export function readsAlike(before: string, after: string, open: HtmlOpen): boolean {
  const reading = lineReading(before, open);
  return reading !== undefined && reading === lineReading(after, open);
}

/** Whether a line is no line of indented code, whatever its containers: it has text after its
 * lead, and no run of white space four columns wide in its lead (a tab to the next stop of four). */
export function neverCode(line: string): boolean {
  const lead = LEAD.exec(line)?.[0] ?? '';
  if (lead.length === line.length) return false;
  let column = 0;
  let run = 0;
  for (const char of lead) {
    const next = char === '\t' ? column + 4 - (column % 4) : column + 1;
    run = char === ' ' || char === '\t' ? run + next - column : 0;
    column = next;
    if (run >= 4) return false;
  }
  return true;
}

/** Whether the line of `text` that holds `at` is in no indented code, whatever its containers: it
 * is `neverCode`, or it is blank, but for quote markers each at most three spaces in, and the line
 * with text above it is (or there is none), since a blank line is code only between two lines of
 * code. */
export function lineOutOfCode(text: string, at: number): boolean {
  let start = at === 0 ? 0 : text.lastIndexOf('\n', at - 1) + 1;
  for (;;) {
    const line = text.slice(start, lineEndOf(text, start));
    if (neverCode(line)) return true;
    if (!/^(?: {0,3}>)*[ \t]*$/.test(line)) return false;
    if (start === 0) return true;
    start = start === 1 ? 0 : text.lastIndexOf('\n', start - 2) + 1;
  }
}

/** Where the line that starts at `start` ends, before its line break. */
function lineEndOf(text: string, start: number): number {
  const newline = text.indexOf('\n', start);
  const end = newline === -1 ? text.length : newline;
  return text[end - 1] === '\r' ? end - 1 : end;
}

/** Whether a body may have a line indented four columns or more, as it is written or in a view: a
 * tab, or four spaces in a row, also once its markers are taken out and the white space at the
 * ends of the text of a deletion comes back. When it has none, it has no indented code, and
 * nothing need be read. */
export function mayIndent(body: string): boolean {
  if (/ {4}|\t|\\x(?:09|20)/i.test(body)) return true;
  if (!body.includes('<!--')) return false;
  const edges = body.replace(
    /<!--[^\n]*?-->/g,
    (comment) =>
      (/^<!--\S+ \S+ ([ \t]*)/.exec(comment)?.[1] ?? '') +
      (/([ \t]*)-->$/.exec(comment)?.[1] ?? ''),
  );
  return / {4}/.test(edges);
}

/**
 * How many of each mark's markers stand in indented code (format §2.1): in the file as a renderer
 * reads it, where the markers are HTML comments, or at their places in its newest or its original
 * view, after the start of the code's first line and up to the end of its last line. A marker on
 * a blank line between two lines of code would part the block in two, and is in it too. The ids
 * are those of the markers, comment anchors whose thread is not in the ledger as well. `limit` is
 * where the body ends, before the ledger; `views` gives the views, which may have been worked out
 * already.
 */
export function markersInIndentedCode(
  text: string,
  limit = text.length,
  views: Views = viewsOnce(),
): Map<string, number> {
  const counts = new Map<string, number>();
  const body = text.slice(0, limit);
  if (!mayIndent(body)) return counts;
  const markers = scan(body).markers;
  if (markers.length === 0) return counts;
  const codeOf = (view: DocView) => ({
    view,
    blocks: indentedCodeBlocks(view.text, bodyStart(view.text)),
  });
  const file = indentedCodeBlocks(text, bodyStart(text), limit);
  const read = [codeOf(views.newest(text)), codeOf(views.original(text))];
  for (const marker of markers) {
    const inFile = file.some((code) => marker.from < code.to && code.from < marker.to);
    const inView = read.some(({ view, blocks }) => {
      const at = view.map.fromSource(marker.from);
      return blocks.some((code) => code.from < at && at <= code.to);
    });
    if (inFile || inView) counts.set(marker.id, (counts.get(marker.id) ?? 0) + 1);
  }
  return counts;
}
