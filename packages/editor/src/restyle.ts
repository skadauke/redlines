// Restyling only what changed (#696). A field that draws from the Markdown parse used to rebuild
// its decorations for the whole document whenever the tree changed, which the background parse does
// at every chunk: the cost of parsing a long document to its end grew with the square of its
// length. This module finds, for a transaction, the stretches of the document whose drawing can
// differ, as windows of whole top-level blocks, so that a field recomputes those and keeps (and
// maps) the rest.
//
// A window is the blocks that a change can touch, with the block before it and the one after,
// since the space between blocks is a function of both neighbors, and a few blocks before that for
// the reading of what lies above.

import { syntaxTree } from '@codemirror/language';
import { type ChangeSet, type EditorState, type Transaction } from '@codemirror/state';
import type { SyntaxNode, Tree } from '@lezer/common';
import { type DecorationSet, Decoration } from '@codemirror/view';
import type { Range } from '@codemirror/state';

/** A stretch of the document that is recomputed. */
export interface Window {
  /** Where the reading starts: blocks before `from`, which `from`'s own space depends on. */
  context: number;
  /** The first and last positions whose decorations are replaced. */
  from: number;
  to: number;
  /** How far the reading goes: a few blocks past `to`, whose space above they decide. */
  reach: number;
}

/** How many blocks above the first replaced one the reading starts. */
const CONTEXT_BLOCKS = 3;
const REACH_BLOCKS = 3;

/** More windows than this, or a window this much of the tree, and a field rebuilds it all. */
const MAX_WINDOWS = 24;
const MAX_SHARE = 0.5;

/** The child of the document that holds `pos`, looking to `side`, or the nearest one. */
function blockAt(tree: Tree, pos: number, side: -1 | 1): SyntaxNode | null {
  const top = tree.topNode;
  return side < 0
    ? (top.childBefore(pos + 1) ?? top.firstChild)
    : (top.childAfter(pos - 1) ?? top.lastChild);
}

/** The blocks around `from` to `to`: this and the neighbors, as a window. */
export function windowAround(tree: Tree, from: number, to: number): Window {
  const first = blockAt(tree, Math.min(from, tree.length), -1);
  const last = blockAt(tree, Math.min(to, tree.length), 1);
  if (!first || !last)
    return { context: 0, from: 0, to: Math.max(to, tree.length), reach: Math.max(to, tree.length) };
  const start: SyntaxNode = first.prevSibling ?? first;
  let context = start;
  for (let n = 0; n < CONTEXT_BLOCKS && context.prevSibling; n++) context = context.prevSibling;
  const end = last.nextSibling ?? last;
  let reach = end;
  for (let n = 0; n < REACH_BLOCKS && reach.nextSibling; n++) reach = reach.nextSibling;
  // A change before the first block, or beyond the last, is still in the window.
  return {
    context: Math.min(context.from, from),
    from: Math.min(start.from, from),
    to: Math.max(end.to, to),
    reach: Math.max(reach.to, to),
  };
}

/**
 * Where the drawing of a transaction can differ from the one before it, as windows over the new
 * document, or null where the whole document has to be drawn again: the edits, the tree reaching
 * further (or less far) than it did, and `extra` places (the selections, the ledger). `drop` is
 * what a field would anyway have to rebuild for.
 */
export function windowsOf(tr: Transaction, extra: readonly [number, number][]): Window[] | null {
  const tree = syntaxTree(tr.state);
  const before = syntaxTree(tr.startState);
  const regions: [number, number][] = [];
  tr.changes.iterChangedRanges((_a, _b, from, to) => regions.push([from, to]));
  // Edits can make the parse differ below them, as an opened fence does: the drawing follows the
  // tree until it is the old one again.
  if (tr.docChanged)
    for (const region of regions) region[1] = resync(tr.changes, before, tree, region[1]);
  const reach = tr.changes.mapPos(before.length, -1);
  if (tree.length !== reach)
    regions.push([Math.min(tree.length, reach), Math.max(tree.length, reach)]);
  for (const place of extra) regions.push([place[0], place[1]]);
  if (regions.length > MAX_WINDOWS * 4) return null;
  regions.sort((a, b) => a[0] - b[0]);
  const windows: Window[] = [];
  for (const [from, to] of regions) {
    const next = windowAround(tree, from, to);
    const prev = windows[windows.length - 1];
    if (prev && next.context <= prev.to) {
      prev.to = Math.max(prev.to, next.to);
      prev.reach = Math.max(prev.reach, next.reach);
      prev.from = Math.min(prev.from, next.from);
    } else windows.push(next);
  }
  if (windows.length > MAX_WINDOWS) return null;
  let span = 0;
  for (const window of windows) span += window.to - window.from;
  return span > Math.max(2000, tree.length * MAX_SHARE) ? null : windows;
}

/**
 * Past an edit, the end of the stretch that the parse read differently from before: the first
 * place where two blocks in a row are what they were (the same kind, the same size) before the
 * edit. Never past the end of the old tree: the tree's progress is a region of its own.
 */
export function resync(changes: ChangeSet, before: Tree, tree: Tree, from: number): number {
  const back = changes.invertedDesc;
  let node = blockAt(tree, from, 1);
  let same = 0;
  let end = from;
  for (; node; node = node.nextSibling) {
    if (node.to <= from) continue;
    const old = back.mapPos(node.from, 1);
    if (old + (node.to - node.from) > before.length) return end;
    const found = before.topNode.childAfter(old - 1);
    const equal =
      found !== null &&
      found.from === old &&
      found.name === node.name &&
      found.to === back.mapPos(node.to, -1);
    end = node.to;
    if (equal) {
      if (++same >= 2) return end;
    } else same = 0;
  }
  return end;
}

/** The decorations of a set that start inside a window. */
export function inWindow(set: DecorationSet, window: Window): Range<Decoration>[] {
  const found: Range<Decoration>[] = [];
  set.between(window.from, window.to, (from, to, value) => {
    if (from >= window.from && from <= window.to) found.push(value.range(from, to));
  });
  return found;
}

/** A set with what starts inside a window taken out, and `add` put in. */
export function replaceIn(
  set: DecorationSet,
  window: Window,
  add: readonly Range<Decoration>[],
): DecorationSet {
  return set.update({
    filter: (from) => from < window.from || from > window.to,
    filterFrom: window.from,
    filterTo: window.to,
    add: [...add],
    sort: true,
  });
}

/** Whether the transaction moved the selection (also by the edits). */
export function selectionMoved(tr: Transaction): boolean {
  return !tr.startState.selection.map(tr.changes).eq(tr.state.selection);
}

/** The places of both selections: where a caret was, and where it is. */
export function selectionPlaces(tr: Transaction): [number, number][] {
  const places: [number, number][] = [];
  for (const range of tr.startState.selection.map(tr.changes).ranges) {
    places.push([range.from, range.to]);
  }
  for (const range of tr.state.selection.ranges) places.push([range.from, range.to]);
  return places;
}

export type { EditorState };
