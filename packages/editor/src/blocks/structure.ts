// The block structure of a document (design: block editing, "Blocks and breaks"): the block at a
// position, read from the syntax tree, with its kind, its text, its prefix and the containers it is
// in; the break between it and the blocks beside it; and the inline constructs open at a position.
// Pure functions of an `EditorState`: a key makes one lookup, a walk over the tree around its line.
//
// Lines that hold only markers of tracked changes (format §3.3) and the ledger are no blocks: they
// belong to the breaks between blocks, as blank lines do.

import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import type { EditorState, Line } from '@codemirror/state';
import { type Parsed, readBlocks } from '@redlines/format';
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

/**
 * The syntax tree, parsed at least to `to`: the state's own tree covers only what the parser has
 * reached, which in a long document can end before the position a key acts at.
 */
function treeTo(state: EditorState, to: number) {
  return ensureSyntaxTree(state, to, 50) ?? syntaxTree(state);
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

/** The kind of block a node of the parse is, if it is a leaf block. */
export function leafKind(name: string): BlockKind | undefined {
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

/**
 * Whether a block's text is markers of tracked changes and nothing else that shows: an item whose
 * only text is another person's deletion (`- <del x>`), which the parse reads as an HTML block.
 */
export function holdsMarkersOnly(state: EditorState, block: Block): boolean {
  const spans = markerSpans(state);
  let text = '';
  let pos = block.text.from;
  for (let i = firstAfter(spans, block.text.from); i < spans.length; i++) {
    const span = spans[i]!;
    if (span.from >= block.text.to) break;
    if (span.from > pos) text += state.sliceDoc(pos, span.from);
    pos = Math.max(pos, span.to);
  }
  if (pos < block.text.to) text += state.sliceDoc(pos, block.text.to);
  return block.text.to > block.text.from && BLANK.test(text) && pos > block.text.from;
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
  treeTo(state, line.to).iterate({
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
  treeTo(state, line.to).iterate({
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
export function loose(state: Pick<EditorState, 'sliceDoc'>, list: SyntaxNode): boolean {
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
      } else {
        // On a later line the parse gives every marker of a nested quote to the innermost one: the
        // outer quotes find theirs in the text, one after the other.
        const text = /^[ \t]{0,3}>[ \t]?/.exec(state.sliceDoc(pos, line.to))?.[0];
        if (text) prefix = { from: pos + text.search(/>/), to: pos + text.length };
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

/**
 * Whether an HTML block starts with markers of tracked changes and then text of the line that isn't
 * HTML itself (`<ins>b</ins> c`): the block is a paragraph that another person's mark starts.
 */
function startsWithMarkerText(state: EditorState, node: SyntaxNode, first: Line): boolean {
  const spans = markerSpans(state);
  const at = spans[firstAfter(spans, node.from - 1)];
  if (!at || at.from !== node.from) return false;
  const rest = withoutMarkers(state, first).slice(
    /^[ \t>]*/.exec(withoutMarkers(state, first))?.[0].length ?? 0,
  );
  const shown = rest.replace(/^(?:[-*+]|\d{1,9}[.)])[ \t]+/, '');
  return shown.trim() !== '' && !/^<[!?/a-zA-Z]/.test(shown.trim());
}

/** The block a leaf node is, read on the line where it starts. */
function blockOf(state: EditorState, node: SyntaxNode): Block {
  const { doc } = state;
  const first = doc.lineAt(node.from);
  const last = doc.lineAt(node.to);
  const containers = containersOf(state, node, first);
  let kind = leafKind(node.name)!;
  // The parse reads a line that starts with a comment as an HTML block, and a mark's marker is one:
  // text that follows markers at the start of a block is a paragraph's (review I4).
  if (kind === 'html' && startsWithMarkerText(state, node, first)) kind = 'paragraph';
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

/** An inline construct that a position is inside of. */
export interface OpenConstruct {
  kind: 'emphasis' | 'strong' | 'strike' | 'code' | 'sub' | 'sup' | 'link' | 'atom';
  /** The construct, its delimiters included. */
  from: number;
  to: number;
  /** Its opening and closing delimiters; empty for an atom. */
  open: string;
  close: string;
  /** A link's closing bracket and what follows it, its destination or reference: `](url)`. */
  tail?: string;
}

const DELIMITED: Record<string, { kind: OpenConstruct['kind']; mark: string }> = {
  Emphasis: { kind: 'emphasis', mark: 'EmphasisMark' },
  StrongEmphasis: { kind: 'strong', mark: 'EmphasisMark' },
  Strikethrough: { kind: 'strike', mark: 'StrikethroughMark' },
  InlineCode: { kind: 'code', mark: 'CodeMark' },
  // The tags are the delimiters: a break inside closes `</sub>` and opens `<sub>` again.
  Subscript: { kind: 'sub', mark: 'SubscriptMark' },
  Superscript: { kind: 'sup', mark: 'SuperscriptMark' },
};

/** Constructs that can't be parted: the break goes after them. */
const ATOMS = new Set(['Image', 'Autolink', 'HTMLTag', 'Entity', 'URL']);

/**
 * The inline constructs open at `pos`, innermost last: those whose text holds it, between their
 * delimiters and not at either edge of their text (there the break goes outside), and the atoms
 * it is strictly inside of. A bracketed phrase with no destination or reference is text.
 */
export function openConstructs(state: EditorState, pos: number): OpenConstruct[] {
  const found: OpenConstruct[] = [];
  // The text of a tag of subscript or superscript, paired or not, is no text to part, as the text
  // of any other tag is not: a pair with the tags hidden has no node for the tags, and a tag with no
  // pair is text to the parse.
  const line = state.doc.lineAt(pos);
  for (const tag of line.text.matchAll(/<\/?(?:sub|sup)>/g)) {
    const from = line.from + tag.index;
    if (from < pos && pos < from + tag[0].length) {
      found.push({ kind: 'atom', from, to: from + tag[0].length, open: '', close: '' });
    }
  }
  for (
    let node: SyntaxNode | null = treeTo(state, pos).resolveInner(pos, 1);
    node;
    node = node.parent
  ) {
    if (leafKind(node.name)) break;
    const slice = (from: number, to: number) => state.sliceDoc(from, to);
    const delimited = DELIMITED[node.name];
    if (delimited) {
      const marks = node.getChildren(delimited.mark);
      const open = marks[0];
      const close = marks.length > 1 ? marks.at(-1)! : null;
      if (open && close && open.to < pos && pos < close.from) {
        found.push({
          kind: delimited.kind,
          from: node.from,
          to: node.to,
          open: slice(open.from, open.to),
          close: slice(close.from, close.to),
        });
      }
    } else if (node.name === 'Link') {
      const [open, close] = node.getChildren('LinkMark');
      const target = node.getChild('URL') ?? node.getChild('LinkLabel');
      if (open && close && target && open.to < pos && pos < close.from) {
        found.push({
          kind: 'link',
          from: node.from,
          to: node.to,
          open: slice(open.from, open.to),
          close: slice(close.from, close.to),
          tail: slice(close.from, node.to),
        });
      } else if (close && target && close.from < pos && pos < node.to) {
        // In its destination or reference, which can't be parted.
        found.push({ kind: 'atom', from: node.from, to: node.to, open: '', close: '' });
      }
    } else if (ATOMS.has(node.name) && node.from < pos && pos < node.to) {
      // A link's or an image's own URL is part of it, not an atom of its own.
      const owner = node.parent?.name;
      if (node.name !== 'URL' || (owner !== 'Link' && owner !== 'Image' && owner !== 'Autolink')) {
        found.push({ kind: 'atom', from: node.from, to: node.to, open: '', close: '' });
      }
    }
  }
  return found.reverse();
}

/** The kinds of the format's block reading for a block's kind; none for kinds it doesn't read. */
const READ_KINDS: Partial<Record<BlockKind, (read: string, block: Block) => boolean>> = {
  paragraph: (read) => read === 'paragraph',
  math: (read) => read === 'paragraph',
  heading: (read, block) => read === `h${block.level}`,
  code: (read) => read === 'code' || read === 'fence',
  html: (read) => read === 'html',
  rule: (read) => read === 'rule',
};

/**
 * How the format's block reading (format §3.4, `block-read.ts`), which reads as micromark does,
 * reads the lines of `block`: `agrees` when it reads a block of the same kind on the same lines;
 * `differs` when it reads them otherwise, as where lezer reads a lazy line that CommonMark starts a
 * block with; `unread` where it reads nothing (a tab, an empty item, a table, front matter and the
 * other cases `readBlocks` gives up on). The keys defer to it where it differs. It reads the run of
 * lines from the start of the top-level block the block is in to the end of that block.
 */
export function formatReading(state: EditorState, block: Block): 'agrees' | 'differs' | 'unread' {
  const accepts = READ_KINDS[block.kind];
  if (!accepts) return 'unread';
  const { doc } = state;
  const tree = treeTo(state, block.lines.to);
  let top = tree.resolveInner(block.text.from, 1);
  while (top.parent && top.parent.parent) top = top.parent;
  const end = top.to;
  // The run starts where CommonMark is surely at the top level, whatever lezer read: at a line that
  // starts at column 0, at the start of the document or after a blank line, and not after indented
  // code (after which micromark reads an item otherwise). Lezer may end a list or a quote where
  // CommonMark goes on with it.
  for (let steps = 0; ; steps++) {
    const above = top.prevSibling;
    if (!above) break;
    const apart = /\n[ \t]*\n/.test(state.sliceDoc(above.to, top.from));
    const column0 = /^[^ \t]/.test(doc.lineAt(top.from).text);
    if (apart && column0 && above.name !== 'CodeBlock') break;
    if (steps === 40) return 'unread';
    top = above;
  }
  const from = doc.lineAt(Math.min(top.from, block.lines.from));
  const to = doc.lineAt(Math.max(end, block.lines.to));
  const blocks = readBlocks(state.sliceDoc(from.from, to.to));
  if (!blocks) return 'unread';
  const first = doc.lineAt(block.lines.from).number - from.number;
  const last = doc.lineAt(block.lines.to).number - from.number;
  const same = blocks.some(
    (read) => read.first === first && read.last === last && accepts(read.kind, block),
  );
  return same ? 'agrees' : 'differs';
}

/** Blocks that take no text of their own: the keys never join text into them. */
export const NO_TEXT = new Set(['code', 'table', 'html', 'front-matter', 'math', 'definition']);
