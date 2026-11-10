// The block structure of a document (design: block editing, "Blocks and breaks"): the block at a
// position, read from the syntax tree, with its kind, its text, its prefix and the containers it is
// in; the break between it and the blocks beside it; and the inline constructs open at a position.
// Pure functions of an `EditorState`: a key makes one lookup, a walk over the tree around its line.
//
// Lines that hold only markers of tracked changes (format §3.3) and the ledger are no blocks: they
// belong to the breaks between blocks, as blank lines do.

import { syntaxTree } from '@codemirror/language';
import type { EditorState, Line } from '@codemirror/state';
import type { Parsed } from '@redlines/format';
import { parsedField } from '../tracked/field.ts';

type SyntaxNode = ReturnType<typeof syntaxTree>['topNode'];

export type BlockKind =
  | 'paragraph'
  | 'heading'
  | 'code'
  | 'table'
  | 'html'
  | 'front-matter'
  | 'rule'
  | 'math'
  | 'definition';

export interface Span {
  from: number;
  to: number;
}

/** A list item or a quote that holds a block. */
export interface Container {
  kind: 'item' | 'quote';
  /**
   * Its syntax on the block's first line: an item's marker with the spaces after it (and its box),
   * or its indentation on a line after its first; a quote's `>` with the space after it. Empty, at
   * the end of the containers before it, on a line that lacks it (a quote's lazy line).
   */
  prefix: Span;
  /** How many containers of its kind hold the block, this one included: 1 for the outermost. */
  depth: number;
  /** An item of a numbered list. */
  ordered?: boolean;
  /** A task item's box: `[ ]` open, `[x]` done. */
  task?: 'open' | 'done';
  /** An item of a loose list, as CommonMark reads it. */
  loose?: boolean;
}

export interface Block {
  kind: BlockKind;
  /** A heading's level, 1 to 6. */
  level?: number;
  /** A heading underlined with `===` or `---`. */
  setext?: boolean;
  /**
   * The characters after its prefix, on its lines: a paragraph's text, a heading's without its
   * `#`s (or its underline), and for blocks that take no text of their own (code, a table, HTML, a
   * rule, math, front matter, a definition) all of the block from its first character.
   */
  text: Span;
  /** From the start of its first line to the end of its last. */
  lines: Span;
  /** From the start of its first line to the start of its text: its containers' syntax and its
   * own, as a heading's `## `. */
  prefix: Span;
  /** The containers it is in, outermost first. */
  containers: Container[];
}

/**
 * What lies between two blocks: the line break that ends the first, the lines between them, and
 * the second's prefix.
 */
export interface Break {
  /** The end of the first block's last line. */
  from: number;
  /** The start of the second block's text. */
  to: number;
  /** How many blank lines are between them (lines of markers alone not counted). */
  blank: number;
  /** The runs of whole lines between them, blank or of markers alone, each from the start of its
   * first line to the end of its last. */
  hidden: Span[];
}

/** Leaf blocks by node name. Headings are found by their prefix below. */
const LEAVES: Record<string, BlockKind> = {
  Paragraph: 'paragraph',
  FencedCode: 'code',
  CodeBlock: 'code',
  Table: 'table',
  HTMLBlock: 'html',
  CommentBlock: 'html',
  ProcessingInstructionBlock: 'html',
  FrontMatter: 'front-matter',
  HorizontalRule: 'rule',
  LinkReference: 'definition',
};

function leafKind(name: string): BlockKind | undefined {
  if (name.startsWith('ATXHeading') || name.startsWith('SetextHeading')) return 'heading';
  return LEAVES[name];
}

/** A line of white space and quote markers only: blank, also inside a quote. */
const BLANK = /^[ \t>]*$/;

/** The markers of tracked changes and the ledger, in document order, apart. */
const markerCache = new WeakMap<Parsed, Span[]>();

function markerSpans(state: EditorState): Span[] {
  const parsed = state.field(parsedField, false);
  if (!parsed) return [];
  let spans = markerCache.get(parsed);
  if (spans) return spans;
  spans = [];
  for (const mark of parsed.marks) {
    for (const segment of mark.segments) {
      spans.push(segment.open);
      if (segment.close) spans.push(segment.close);
    }
  }
  if (parsed.ledgerRange) spans.push(parsed.ledgerRange);
  spans.sort((a, b) => a.from - b.from);
  markerCache.set(parsed, spans);
  return spans;
}

/** The index of the first span in `spans` that ends after `pos`. */
function firstAfter(spans: readonly Span[], pos: number): number {
  let low = 0;
  let high = spans.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (spans[middle]!.to <= pos) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** A line's text without the markers on it. */
function withoutMarkers(state: EditorState, line: Line): string {
  const spans = markerSpans(state);
  let text = '';
  let pos = line.from;
  for (let i = firstAfter(spans, line.from); i < spans.length; i++) {
    const span = spans[i]!;
    if (span.from >= line.to) break;
    if (span.from > pos) text += state.sliceDoc(pos, span.from);
    pos = Math.max(pos, span.to);
  }
  if (pos < line.to) text += state.sliceDoc(pos, line.to);
  return text;
}

/** Whether a line holds markers and nothing else that shows. */
function markersOnly(state: EditorState, line: Line): boolean {
  if (BLANK.test(line.text)) return false;
  return BLANK.test(withoutMarkers(state, line));
}

/** Whether a line belongs to a break: blank, or markers alone, outside a block that holds it. */
export function isGapLine(state: EditorState, line: Line): boolean {
  return BLANK.test(line.text) || markersOnly(state, line);
}

/** The end of the spaces and tabs at `pos`. */
function spaceAfter(state: EditorState, pos: number, end: number): number {
  while (pos < end && /[ \t]/.test(state.sliceDoc(pos, pos + 1))) pos++;
  return pos;
}

/** The innermost leaf block on `line`: the one holding `pos`, or else the nearest. */
function leafOn(state: EditorState, line: Line, pos: number): SyntaxNode | null {
  let best: SyntaxNode | null = null;
  let distance = Infinity;
  syntaxTree(state).iterate({
    from: line.from,
    to: line.to,
    enter: (ref) => {
      if (ref.to < line.from || ref.from > line.to) return false;
      if (!leafKind(ref.name)) return true;
      const off = pos < ref.from ? ref.from - pos : pos > ref.to ? pos - ref.to : 0;
      if (off < distance) {
        best = ref.node;
        distance = off;
      }
      return false;
    },
  });
  return best;
}

/** The innermost list item or quote on `line` that has no leaf block there: an empty item. */
function emptyContainerOn(state: EditorState, line: Line): SyntaxNode | null {
  let found: SyntaxNode | null = null;
  syntaxTree(state).iterate({
    from: line.from,
    to: line.to,
    enter: (ref) => {
      if (ref.to < line.from || ref.from > line.to) return false;
      if (ref.name === 'ListItem' && state.doc.lineAt(ref.from).number === line.number) {
        found = ref.node;
      }
      return true;
    },
  });
  return found;
}

/** Whether a list is loose: blank lines between its items, or between two blocks of an item. */
function loose(state: EditorState, list: SyntaxNode): boolean {
  const between = (a: SyntaxNode, b: SyntaxNode) =>
    state
      .sliceDoc(a.to, b.from)
      .split('\n')
      .slice(1, -1)
      .some((text) => BLANK.test(text));
  const items = list.getChildren('ListItem');
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    if (i > 0 && between(items[i - 1]!, item)) return true;
    let previous: SyntaxNode | null = null;
    for (let child = item.firstChild; child; child = child.nextSibling) {
      if (child.name === 'ListMark' || child.name === 'Task') continue;
      if (previous && between(previous, child)) return true;
      previous = child;
    }
  }
  return false;
}

/** The containers around `node`, outermost first, with their syntax on `line`. */
function containersOf(state: EditorState, node: SyntaxNode, line: Line): Container[] {
  const around: SyntaxNode[] = [];
  for (let up: SyntaxNode | null = node; up; up = up.parent) {
    if (up.name === 'ListItem' || up.name === 'Blockquote') around.push(up);
  }
  around.reverse();
  const containers: Container[] = [];
  let pos = line.from;
  let items = 0;
  let quotes = 0;
  for (const container of around) {
    if (container.name === 'Blockquote') {
      quotes++;
      const mark = container
        .getChildren('QuoteMark')
        .find(
          (m) =>
            m.from >= pos && m.from <= line.to && state.doc.lineAt(m.from).number === line.number,
        );
      let prefix = { from: pos, to: pos };
      if (mark) {
        const space = state.sliceDoc(mark.to, mark.to + 1);
        prefix = { from: mark.from, to: mark.to + (space === ' ' || space === '\t' ? 1 : 0) };
      }
      pos = prefix.to;
      containers.push({ kind: 'quote', prefix, depth: quotes });
      continue;
    }
    items++;
    const mark = container.getChild('ListMark');
    const list = container.parent;
    const task = container.getChild('Task')?.getChild('TaskMarker');
    const entry: Container = {
      kind: 'item',
      prefix: { from: pos, to: pos },
      depth: items,
      loose: list ? loose(state, list) : false,
    };
    if (list?.name === 'OrderedList') entry.ordered = true;
    if (task) entry.task = /\[[xX]\]/.test(state.sliceDoc(task.from, task.to)) ? 'done' : 'open';
    if (mark && state.doc.lineAt(mark.from).number === line.number) {
      const end = task ? task.to : mark.to;
      entry.prefix = { from: mark.from, to: spaceAfter(state, end, line.to) };
    } else if (mark) {
      // A later line of the item: its indentation, up to the column of the item's text.
      const first = state.doc.lineAt(mark.from);
      const column = spaceAfter(state, mark.to, first.to) - first.from;
      const markColumn = mark.from - first.from;
      const width = Math.max(0, column - markColumn);
      entry.prefix = { from: pos, to: Math.min(spaceAfter(state, pos, line.to), pos + width) };
    }
    pos = entry.prefix.to;
    containers.push(entry);
  }
  return containers;
}

/** The block a leaf node is, read on the line where it starts. */
function blockOf(state: EditorState, node: SyntaxNode): Block {
  const { doc } = state;
  const first = doc.lineAt(node.from);
  const last = doc.lineAt(node.to);
  const containers = containersOf(state, node, first);
  const kind = leafKind(node.name)!;
  const lines = { from: first.from, to: last.to };
  let text = { from: node.from, to: node.to };
  const block: Block = {
    kind,
    text,
    lines,
    prefix: { from: first.from, to: node.from },
    containers,
  };
  if (node.name.startsWith('ATXHeading')) {
    block.level = Number(node.name.slice(-1));
    const marks = node.getChildren('HeaderMark');
    const open = marks[0];
    const from = open ? spaceAfter(state, open.to, last.to) : node.from;
    const close = marks.length > 1 ? marks.at(-1)! : null;
    let to = close && close.from > from ? close.from : node.to;
    while (to > from && /[ \t]/.test(state.sliceDoc(to - 1, to))) to--;
    text = { from, to: Math.max(from, to) };
  } else if (node.name.startsWith('SetextHeading')) {
    block.level = Number(node.name.slice(-1));
    block.setext = true;
    const underline = node.getChild('HeaderMark');
    const end = underline ? doc.lineAt(underline.from).from - 1 : node.to;
    text = { from: node.from, to: Math.max(node.from, end) };
  } else if (kind === 'paragraph') {
    const body = state.sliceDoc(node.from, node.to).trim();
    if (body.length >= 4 && body.startsWith('$$') && body.endsWith('$$')) block.kind = 'math';
  }
  block.text = text;
  block.prefix = { from: first.from, to: text.from };
  return block;
}

/**
 * The block at `pos`: the leaf block on its line that holds it, or the nearest one on the line, or
 * an empty item's (empty) paragraph. Null on a blank line between blocks, a line of markers alone
 * and the ledger.
 */
export function blockAt(state: EditorState, pos: number): Block | null {
  const line = state.doc.lineAt(pos);
  const leaf = leafOn(state, line, pos);
  if (leaf) {
    const ledger = state.field(parsedField, false)?.ledgerRange;
    if (ledger && leaf.from >= ledger.from && leaf.to <= ledger.to) return null;
    // A comment block of markers alone is part of a break.
    if (kind(leaf) === 'html' && markersOnly(state, line)) return null;
    return blockOf(state, leaf);
  }
  const item = emptyContainerOn(state, line);
  if (!item) return null;
  const containers = containersOf(state, item, line);
  const from = containers.at(-1)?.prefix.to ?? line.from;
  return {
    kind: 'paragraph',
    text: { from, to: line.to },
    lines: { from: line.from, to: line.to },
    prefix: { from: line.from, to: from },
    containers,
  };
}

const kind = (node: SyntaxNode) => leafKind(node.name);

/** The block on the nearest line from line `n` on, going `step` lines at a time, that isn't a gap. */
function blockFrom(state: EditorState, n: number, step: 1 | -1): Block | null {
  const { doc } = state;
  for (; n >= 1 && n <= doc.lines; n += step) {
    const line = doc.line(n);
    if (isGapLine(state, line)) continue;
    const block = blockAt(state, step > 0 ? line.from : line.to);
    // The ledger ends the body.
    if (!block) {
      const ledger = state.field(parsedField, false)?.ledgerRange;
      if (ledger && line.from >= ledger.from) return null;
      continue;
    }
    return block;
  }
  return null;
}

/** The blocks before and after `block`, past the blank lines and lines of markers between. */
export function neighbours(
  state: EditorState,
  block: Block,
): { prev: Block | null; next: Block | null } {
  const { doc } = state;
  return {
    prev: blockFrom(state, doc.lineAt(block.lines.from).number - 1, -1),
    next: blockFrom(state, doc.lineAt(block.lines.to).number + 1, 1),
  };
}

/** The break from the end of `above`'s last line to the start of `below`'s text. */
function breakBetween(state: EditorState, above: Block, below: Block): Break {
  const { doc } = state;
  const hidden: Span[] = [];
  let blank = 0;
  const first = doc.lineAt(above.lines.to).number + 1;
  const last = doc.lineAt(below.lines.from).number - 1;
  for (let n = first; n <= last; n++) {
    const line = doc.line(n);
    if (BLANK.test(line.text)) blank++;
    const run = hidden.at(-1);
    if (run && run.to === line.from - 1) run.to = line.to;
    else hidden.push({ from: line.from, to: line.to });
  }
  return { from: above.lines.to, to: below.text.from, blank, hidden };
}

/** The break before `block`, or null for the first block. */
export function breakBefore(state: EditorState, block: Block): Break | null {
  const { prev } = neighbours(state, block);
  return prev ? breakBetween(state, prev, block) : null;
}

/** The break after `block`, or null for the last block. */
export function breakAfter(state: EditorState, block: Block): Break | null {
  const { next } = neighbours(state, block);
  return next ? breakBetween(state, block, next) : null;
}
