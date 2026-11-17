// Where the tracked layer's drawing can be redone alone (#744). The layer draws marks, hidden lines
// and comments, and a piece of its drawing depends on the text and the marks around it, never on
// the text far away, except across a stretch that holds a mark open or a hidden run of lines.
// A stretch that does neither is "firm": a plain paragraph, heading, list, quote or fence (parsed),
// or a plain line (beyond what the parse has reached), with no marker, no comment and no blank line in
// it, and no mark over it. No piece of the drawing reaches across a firm stretch, so the drawing
// between two of them is a function of the text, the marks and the tree between them.
//
// A window is the stretch from the end of one firm stretch to the end of another, `[from, to)`. Each
// piece of the drawing belongs to the window its start is in; a field that keeps its pieces draws a
// window again, and keeps (and maps) every piece outside the windows.

import { syntaxTree } from '@codemirror/language';
import type { EditorState, Text } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import type { MarkRange, Parsed } from '@redlines/format';
import { BLANK } from '../blocks/hidden.ts';

/** A window: the pieces that start from `from` up to (not including) `to`. */
export interface Zone {
  from: number;
  to: number;
}

/** The blocks that can be firm (when nothing in them is hidden). */
const FIRM =
  /^(?:Paragraph|ATXHeading[1-6]|SetextHeading[12]|BulletList|OrderedList|Blockquote|FencedCode)$/;

/** A block longer than this is never read to see whether it is firm. */
const MAX_FIRM = 4000;
/** How many blocks or lines are looked at before a window runs to the end of the text. */
const MAX_STEPS = 4000;

interface MarkIndex {
  starts: number[];
  /** The largest end of the marks up to each one. */
  ends: number[];
}

const indexes = new WeakMap<Parsed, MarkIndex>();

/** Where a mark ends: the end of its last segment. */
export function markEnd(mark: MarkRange): number {
  let end = 0;
  for (const segment of mark.segments) end = Math.max(end, segment.close?.to ?? segment.open.to);
  return end;
}

function indexOf(parsed: Parsed): MarkIndex {
  let index = indexes.get(parsed);
  if (index) return index;
  const starts: number[] = [];
  const ends: number[] = [];
  let max = -1;
  for (const mark of parsed.marks) {
    starts.push(mark.segments[0]?.open.from ?? 0);
    max = Math.max(max, markEnd(mark));
    ends.push(max);
  }
  indexes.set(parsed, (index = { starts, ends }));
  return index;
}

/** The index of the first mark that starts after `pos`. */
function after(starts: readonly number[], pos: number): number {
  let low = 0;
  let high = starts.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (starts[middle]! <= pos) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** Whether a mark's range (open to end of its last segment) touches `from`–`to`, ends included. */
export function overlapsMarks(parsed: Parsed, from: number, to: number): boolean {
  const { starts, ends } = indexOf(parsed);
  const last = after(starts, to) - 1;
  return last >= 0 && ends[last]! >= from;
}

/** The marks that overlap `from`–`to`, ends included. */
export function marksOverlapping(parsed: Parsed, from: number, to: number): MarkRange[] {
  const { starts, ends } = indexOf(parsed);
  const found: MarkRange[] = [];
  const last = after(starts, to) - 1;
  if (last < 0 || ends[last]! < from) return found;
  for (let i = last; i >= 0 && ends[i]! >= from; i--) {
    const mark = parsed.marks[i]!;
    if (markEnd(mark) >= from) found.push(mark);
  }
  return found.reverse();
}

/**
 * Whether mark `i` is a block of its own: an insertion whose opening marker is alone on its line
 * and whose closing marker ends its last line, between blank lines, with no other marker or comment
 * in it and no other mark over it or touching it. Its text ends where its closing marker starts,
 * and nothing but that marker reaches past it, so it ends a window as a plain paragraph does (the
 * window below it draws the marker, and the lines that hide with it, with the mark `marksReaching`
 * gives it). A document of such blocks (an agent's rewrite, a pasted text) has no plain paragraph,
 * and without this each edit would draw the whole text again (#1025). Returns where the closing
 * marker starts, or -1.
 */
function blockEnd(r: Reading, index: MarkIndex, i: number): number {
  const mark = r.parsed.marks[i]!;
  if (mark.kind !== 'ins' || mark.segments.length !== 1) return -1;
  const segment = mark.segments[0]!;
  const { close } = segment;
  if (!close || close.to - segment.open.from > MAX_FIRM) return -1;
  const { doc } = r;
  if (i > 0 && index.ends[i - 1]! >= segment.open.from - 1) return -1;
  if (i + 1 < index.starts.length && index.starts[i + 1]! <= close.to + 1) return -1;
  const first = doc.lineAt(segment.open.from);
  const last = doc.lineAt(close.to);
  if (first.from !== segment.open.from || segment.open.to !== first.to || last.to !== close.to) {
    return -1;
  }
  if (first.number < 2 || !BLANK.test(doc.line(first.number - 1).text)) return -1;
  if (last.number < doc.lines && !BLANK.test(doc.line(last.number + 1).text)) return -1;
  const ledger = r.parsed.ledgerRange;
  if (ledger && close.to >= ledger.from) return -1;
  // Only its own two markers, and all of it read by the parse.
  if (!r.whole && close.to >= r.reach) return -1;
  const text = doc.sliceString(segment.open.from, close.to);
  if (text.split('<!--').length !== 3 || text.split('-->').length !== 3) return -1;
  return close.from;
}

/**
 * The marks that start in `from`–`to` and those that reach into it from above, whose closing
 * marker (or the end of a block of their own) is in it.
 */
export function marksReaching(parsed: Parsed, from: number, to: number): MarkRange[] {
  return marksOverlapping(parsed, from, to - 1);
}

interface Reading {
  doc: Text;
  parsed: Parsed;
  /** How far the tree goes, or the end of the text when it is whole. */
  reach: number;
  whole: boolean;
  tree: ReturnType<typeof syntaxTree>;
}

function readingOf(state: EditorState, parsed: Parsed): Reading {
  const tree = syntaxTree(state);
  return {
    doc: state.doc,
    parsed,
    reach: tree.length,
    whole: tree.length >= state.doc.length,
    tree,
  };
}

/** Whether a line beyond the tree is a plain one, which the drawing doesn't reach across. */
function plainLine(r: Reading, n: number): boolean {
  const line = r.doc.line(n);
  if (line.from < r.reach) return false;
  if (BLANK.test(line.text) || line.text.includes('<!--') || line.text.includes('-->'))
    return false;
  const ledger = r.parsed.ledgerRange;
  if (ledger && line.to >= ledger.from) return false;
  return !overlapsMarks(r.parsed, line.from, line.to);
}

/** Whether a block of the tree is firm: plain text that nothing hides and no mark is over. */
function firmNode(r: Reading, node: SyntaxNode): boolean {
  if (!FIRM.test(node.name) || node.to - node.from > MAX_FIRM) return false;
  // The last block of a tree that stops short may be cut off.
  if (!r.whole && node.to >= r.reach) return false;
  const text = r.doc.sliceString(node.from, node.to);
  if (text.includes('<!--') || text.includes('-->')) return false;
  for (const line of text.split('\n')) if (BLANK.test(line)) return false;
  const ledger = r.parsed.ledgerRange;
  if (ledger && node.to >= ledger.from) return false;
  return !overlapsMarks(r.parsed, node.from, node.to);
}

/**
 * Where the window around `pos` starts: the end of the nearest firm stretch that ends before it,
 * or 0 where there is none.
 */
export function windowStart(state: EditorState, parsed: Parsed, pos: number): number {
  const r = readingOf(state, parsed);
  const { doc } = r;
  let steps = 0;
  // The nearest block of its own that ends before `pos`; a firm stretch farther back doesn't count.
  const index = indexOf(parsed);
  let own = 0;
  for (let i = after(index.starts, pos) - 1; i >= 0 && steps++ < MAX_STEPS; i--) {
    const end = blockEnd(r, index, i);
    if (end >= 0 && end <= pos) {
      own = end;
      break;
    }
  }
  steps = 0;
  if (!r.whole) {
    for (let n = doc.lineAt(Math.min(pos, doc.length)).number - 1; n >= 1; n--) {
      if (doc.line(n).from < r.reach || steps++ > MAX_STEPS) break;
      if (plainLine(r, n)) return Math.max(doc.line(n).to, own);
    }
  }
  let node: SyntaxNode | null = r.tree.topNode.childBefore(Math.min(pos, r.reach));
  while (node && node.to >= pos) node = node.prevSibling;
  for (; node && node.to > own && steps++ < MAX_STEPS; node = node.prevSibling) {
    if (firmNode(r, node)) return node.to;
  }
  return own;
}

/**
 * Where the window around `pos` ends: the end of the nearest firm stretch that starts after it
 * (the window holds it), or past the end of the text where there is none.
 */
export function windowEnd(state: EditorState, parsed: Parsed, pos: number): number {
  const r = readingOf(state, parsed);
  const { doc } = r;
  let steps = 0;
  // The nearest block of its own that ends after `pos`: the window ends where its text does.
  const index = indexOf(parsed);
  let own = Infinity;
  for (let i = Math.max(0, after(index.starts, pos) - 1); i < index.starts.length; i++) {
    if (steps++ > MAX_STEPS) break;
    const end = blockEnd(r, index, i);
    if (end > pos) {
      own = end;
      break;
    }
  }
  steps = 0;
  let node: SyntaxNode | null = r.tree.topNode.childAfter(Math.min(pos, r.reach));
  while (node && node.from <= pos) node = node.nextSibling;
  for (; node && node.from < own && steps++ < MAX_STEPS; node = node.nextSibling) {
    if (firmNode(r, node)) return Math.min(node.to, own);
  }
  if (own !== Infinity) return own;
  if (!r.whole) {
    const start = doc.lineAt(Math.min(Math.max(pos, r.reach), doc.length)).number;
    for (let n = start; n <= doc.lines; n++) {
      const line = doc.line(n);
      if (steps++ > MAX_STEPS) break;
      if (line.from > pos && plainLine(r, n)) return line.to;
    }
  }
  return doc.length + 1;
}
