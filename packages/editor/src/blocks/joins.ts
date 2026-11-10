// Backspace and Delete at block edges (design: block editing, "Backspace and Delete at block
// edges"): when no Return is there to take back, Backspace at the start of a block's text and
// Delete at its end act on blocks. They join two blocks, the first keeping its kind; take an empty
// block away; take the first block of a quote out of it, and a list's first item up a level or out
// of the list; move the caret to a block that takes no text (code, a table) rather than join into
// it; and delete a thematic break. Each is a pure function of the state, as `edits.ts`'s Return is,
// and null declines, so that CodeMirror's own key runs inside a block's text.
//
// A join's edit covers the break as a reader sees it: from the end of the first block's last line
// to the start of the second's text, the hidden markers at its edges left outside, which makes it
// a join for the format and not a deletion "together with other text".

import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { type ChangeSpec, EditorSelection, type EditorState, type Line } from '@codemirror/state';
import { EditError, type FormatOp } from '@redlines/format';
import { onlyHidden } from '../tracked/decorations.ts';
import { blockFormatChanges, trackingField } from '../tracked/typing.ts';
import {
  blankOf,
  continuation,
  hardBreakAt,
  itemsAround,
  type KeyEdit,
  moveTo,
  nothing,
  retype,
  textEnd,
  textStart,
} from './edits.ts';
import { BLANK } from './hidden.ts';
import { openBlock } from './open.ts';
import { type Block, blockAt, isGapLine, neighbours } from './structure.ts';

type SyntaxNode = ReturnType<typeof syntaxTree>['topNode'];

/** Blocks that take no text of their own: the keys never join text into them. */
const NO_TEXT = new Set(['code', 'table', 'html', 'front-matter', 'math', 'definition']);

/** Whether a block has no text: an empty heading, item or paragraph. */
const isEmpty = (state: EditorState, block: Block) =>
  !NO_TEXT.has(block.kind) &&
  block.kind !== 'rule' &&
  !state.sliceDoc(block.text.from, block.text.to).trim();

const tree = (state: EditorState, to: number) =>
  ensureSyntaxTree(state, to, 50) ?? syntaxTree(state);

/** The list items and quotes a block is in, as nodes of the syntax tree, outermost first. */
function containerNodes(state: EditorState, block: Block): SyntaxNode[] {
  const empty = block.text.from >= block.text.to;
  let node: SyntaxNode | null = empty
    ? tree(state, block.lines.to).resolveInner(block.lines.to, -1)
    : tree(state, block.text.to).resolveInner(block.text.from, 1);
  const found: SyntaxNode[] = [];
  for (; node; node = node.parent) {
    if (node.name === 'ListItem' || node.name === 'Blockquote') found.push(node);
  }
  return found.reverse();
}

/** Whether `block` is inside the syntax node `node`. */
const within = (block: Block, node: SyntaxNode) =>
  block.text.from >= node.from && block.text.from <= node.to;

/**
 * A plain edit of the text, for Backspace or Delete, the caret at `caret` (a position of the
 * state's text), or in front of `caretAt` however the tracked layer writes the edits.
 */
function edit(
  state: EditorState,
  changes: ChangeSpec[],
  caret: number,
  userEvent: 'delete.backward.block' | 'delete.forward.block',
  caretAt?: number,
): KeyEdit {
  return {
    changes,
    selection: EditorSelection.single(state.changes(changes).mapPos(caret, -1)),
    userEvent,
    ...(caretAt === undefined ? {} : { caretAt }),
  };
}

/**
 * A block change as the format writes it (`trackedFormat` or `untrackedFormat`), final, or null
 * when the format refuses it: the key then writes the plain edit instead.
 */
function formatted(
  state: EditorState,
  at: number,
  op: FormatOp,
  userEvent: 'delete.backward.block' | 'delete.forward.block',
): KeyEdit | null {
  try {
    const changes = blockFormatChanges(state, { from: at, to: at }, op);
    if (!changes.length) return null;
    return { changes, selection: state.selection, userEvent, final: true };
  } catch (error) {
    if (error instanceof EditError) return null;
    throw error;
  }
}

/**
 * Where the caret goes in a block that takes no text, when Backspace below it or a click lands
 * there: the end of its content (the line before a closing fence), or its last line's end.
 */
function endOfNoText(state: EditorState, block: Block): number {
  const { doc } = state;
  const last = doc.lineAt(block.lines.to);
  if (block.kind === 'code' && /^[ \t>]*(?:`{3,}|~{3,})[ \t]*$/.test(last.text)) {
    const first = doc.lineAt(block.lines.from);
    if (last.number > first.number + 1) return doc.line(last.number - 1).to;
    return first.to;
  }
  return last.to;
}

/**
 * The join of `below` onto `above`: the break between them goes, and `above` keeps its kind. A
 * setext heading's underline goes with the text joined to it, so that neither block turns into
 * the other.
 */
function join(
  state: EditorState,
  above: Block,
  below: Block,
  userEvent: 'delete.backward.block' | 'delete.forward.block',
): KeyEdit {
  const changes: ChangeSpec[] = [];
  let from = above.lines.to;
  if (above.kind === 'heading' && above.setext) {
    // `Head⏎===` takes the text below before its underline.
    from = above.text.to;
    const underline = state.sliceDoc(above.text.to, above.lines.to);
    changes.push({ from, to: below.text.from });
    changes.push({ from: below.lines.to, insert: underline });
  } else {
    changes.push({ from, to: below.text.from });
  }
  if (below.kind === 'heading' && below.setext) {
    // The underline of the heading joined into the block above goes too.
    changes.push({ from: below.text.to, to: below.lines.to });
  }
  changes.push(...numberedKept(state, above, below));
  return edit(state, changes, from, userEvent);
}

/**
 * A numbered item other than 1 that a join leaves right under text keeps a blank line before it,
 * which would otherwise make it a line of the text above (design: the Call on numbered joins):
 * when the joined block was an item of that list, and the text it joins is not.
 */
function numberedKept(state: EditorState, above: Block, joined: Block): ChangeSpec[] {
  const { doc } = state;
  const last = doc.lineAt(joined.lines.to);
  if (last.number >= doc.lines) return [];
  const next = doc.line(last.number + 1);
  const number = /^([ \t>]*)(\d{1,9})[.)](?:[ \t]|$)/.exec(next.text);
  if (!number || number[2] === '1') return [];
  const items = joined.containers.filter((c) => c.kind === 'item');
  if (!items.length) return [];
  // Joined into an item of the list the next item is in: the list goes on, tight as it was.
  for (const node of containerNodes(state, above)) {
    if (node.name === 'ListItem' && node.parent && node.parent.to >= next.from) return [];
  }
  return [{ from: next.from, insert: `${blankOf(number[1]!)}\n` }];
}

/** The empty block goes, with the break above it (or below, for the first), the caret above. */
function removeEmpty(
  state: EditorState,
  block: Block,
  userEvent: 'delete.backward.block' | 'delete.forward.block',
): KeyEdit {
  const { prev, next } = neighbours(state, block);
  if (userEvent === 'delete.forward.block' && next) {
    // Delete: the next block keeps its kind, the caret at its start.
    return edit(
      state,
      [{ from: block.lines.from, to: next.lines.from }],
      block.lines.from,
      userEvent,
      next.text.from,
    );
  }
  if (prev)
    return edit(state, [{ from: prev.lines.to, to: block.lines.to }], prev.lines.to, userEvent);
  if (next) {
    return edit(
      state,
      [{ from: block.lines.from, to: next.lines.from }],
      block.lines.from,
      userEvent,
    );
  }
  // The only block: its syntax goes, and the document is one empty paragraph.
  return edit(state, [{ from: block.lines.from, to: block.lines.to }], block.lines.from, userEvent);
}

/**
 * The first block of a quote taken out of it, one level: a block alone in its quote as the
 * format's block change, otherwise each of its lines' marker taken out, and the blank line under
 * it, as edits of the break.
 */
function unquote(state: EditorState, block: Block, quote: SyntaxNode): KeyEdit {
  const { doc } = state;
  const userEvent = 'delete.backward.block';
  const blocks = quote.getChildren('Paragraph').length + countOtherBlocks(quote);
  if (blocks <= 1) {
    const change = formatted(state, block.text.from, { kind: 'block', to: 'p' }, userEvent);
    if (change) return { ...change, caretAt: block.text.from };
  }
  const changes: ChangeSpec[] = [];
  const first = doc.lineAt(block.lines.from);
  const last = doc.lineAt(block.lines.to);
  const markOn = (line: Line): { from: number; to: number } | null => {
    // The quote's own marker on the line: lezer puts those of later lines in the paragraph.
    let found: { from: number; to: number } | null = null;
    tree(state, line.to).iterate({
      from: line.from,
      to: line.to,
      enter: (node) => {
        if (node.name !== 'QuoteMark' || node.from < line.from || node.to > line.to) return;
        let up = node.node.parent;
        while (up && up.name !== 'Blockquote') up = up.parent;
        if (up && up.from === quote.from && up.to === quote.to) {
          found = { from: node.from, to: node.to };
        }
      },
    });
    const mark = found as { from: number; to: number } | null;
    if (!mark) return null;
    const space = /[ \t]/.test(state.sliceDoc(mark.to, mark.to + 1)) ? 1 : 0;
    return { from: mark.from, to: mark.to + space };
  };
  const { prev } = neighbours(state, block);
  const own = markOn(first);
  let before: string | null = null;
  if (own && prev) {
    // The first line's marker goes as a change of the break in front of it, which the format
    // writes as a join and a split; right under text of the block above, a blank line between.
    const outer = state.sliceDoc(first.from, own.from);
    const between = isGapLine(state, doc.line(first.number - 1))
      ? state.sliceDoc(prev.lines.to, first.from)
      : `\n${blankOf(outer)}\n`;
    before = `${between}${outer}${state.sliceDoc(own.to, block.text.from)}`;
    changes.push({ from: prev.lines.to, to: block.text.from, insert: before });
  } else if (own) {
    changes.push(own);
  }
  for (let n = first.number + 1; n <= last.number; n++) {
    const change = markOn(doc.line(n));
    if (change) changes.push(change);
  }
  // The blank line under it ends the quote's first block; it stays blank, and the quote goes on
  // after it. With Track Changes on the format keeps its marker, which parts nothing: the quote
  // after it starts there.
  if (last.number < doc.lines && !state.field(trackingField, false)) {
    const under = doc.line(last.number + 1);
    if (BLANK.test(under.text) && under.from < quote.to) {
      const change = markOn(under);
      if (change) changes.push(change);
    }
  }
  if (before && prev) {
    return {
      ...edit(state, changes, block.text.from, userEvent),
      caretAfterText: { from: prev.lines.to, text: before },
    };
  }
  return edit(state, changes, block.text.from, userEvent, block.text.from);
}

/** The blocks of a quote other than its paragraphs, at its own level. */
function countOtherBlocks(quote: SyntaxNode): number {
  let n = 0;
  for (let child = quote.firstChild; child; child = child.nextSibling) {
    if (child.name !== 'QuoteMark' && child.name !== 'Paragraph') n++;
  }
  return n;
}

/** The list item a block's first line is the marker line of, if any. */
function itemStartedBy(state: EditorState, block: Block, nodes: SyntaxNode[]): SyntaxNode | null {
  const item = nodes.at(-1);
  if (!item || item.name !== 'ListItem') return null;
  const mark = item.getChild('ListMark');
  if (!mark) return null;
  return state.doc.lineAt(mark.from).number === state.doc.lineAt(block.lines.from).number
    ? item
    : null;
}

/** The list item before `item` in its list. */
function itemBefore(item: SyntaxNode): SyntaxNode | null {
  for (let node = item.prevSibling; node; node = node.prevSibling) {
    if (node.name === 'ListItem') return node;
  }
  return null;
}

/**
 * Backspace at the start of a list item's text: an empty item goes (#204); the first item of a
 * nested list goes up a level, of a list at the top level out of the list; an item after another
 * loses its bullet first (`removeBullet`), and the next press joins it.
 */
function backspaceAtItem(
  state: EditorState,
  block: Block,
  item: SyntaxNode,
  nodes: SyntaxNode[],
  prev: Block | null,
): KeyEdit {
  const userEvent = 'delete.backward.block';
  if (isEmpty(state, block)) return removeEmpty(state, block, userEvent);
  if (!itemBefore(item)) {
    const parent = nodes.at(-2);
    if (parent?.name === 'ListItem') return outdent(state, block);
    return outOfList(state, block, item, prev);
  }
  return removeBullet(state, block, prev) ?? joinOrMove(state, block, prev, userEvent);
}

/**
 * The ladder's first press (design: block editing, Word's two presses): the bullet goes and the
 * text stays where it is, after the item above (or its last nested item): as a hard line break in
 * a tight list, as a second paragraph of that item in a loose one, at that item's text column in
 * the file's own indentation. The item's nested items become the item above's. Null where the
 * block above takes no line break or no text (a heading joins at once; code, a table: the caret
 * goes there), for the join or the move.
 */
function removeBullet(state: EditorState, block: Block, prev: Block | null): KeyEdit | null {
  if (!prev || prev.kind !== 'paragraph' || isEmpty(state, prev)) return null;
  const userEvent = 'delete.backward.block';
  const { doc } = state;
  const line = doc.lineAt(block.lines.from);
  const cont = continuation(state, prev);
  if (block.containers.at(-1)?.loose) {
    // A second paragraph of the item above: the marker becomes its indentation.
    const change = retype(line, block.text.from, cont);
    const before = `${state.sliceDoc(prev.lines.to, line.from)}${cont}`;
    return {
      ...edit(state, [change], block.text.from, userEvent),
      caretAfterText: { from: prev.lines.to, text: before },
    };
  }
  // A hard break at the end of the item above, the text on its next line.
  const before = `\\\n${cont}`;
  return {
    ...edit(
      state,
      [{ from: prev.lines.to, to: block.text.from, insert: before }],
      prev.lines.to,
      userEvent,
    ),
    caretAfterText: { from: prev.lines.to, text: before },
  };
}

/** The first item of a nested list, up one level: Shift-Tab's block change, or its plain edit. */
function outdent(state: EditorState, block: Block): KeyEdit {
  const userEvent = 'delete.backward.block';
  const change = formatted(state, block.text.from, { kind: 'indent', by: -1 }, userEvent);
  if (change) return { ...change, caretAt: block.text.from };
  // The block doesn't stand alone for the format: its marker line takes its parent's indentation.
  const items = itemsAround(state, block);
  const own = items[0];
  const parent = items[1];
  if (!own || !parent) return nothing(state);
  const line = own.line;
  const from = line.from;
  const markerAt = line.from + line.text.length - line.text.trimStart().length;
  return edit(
    state,
    [{ from, to: markerAt, insert: parent.indent }],
    block.text.from,
    userEvent,
    block.text.from,
  );
}

/**
 * The first item of a list at the top level, out of the list: a paragraph. A one-item list as the
 * format's block change; otherwise the break and the item's marker replaced by a blank line, as a
 * substitution of the break. A blank line goes above it under other text (a lazy line otherwise),
 * and after it where the next item is numbered other than 1.
 */
function outOfList(
  state: EditorState,
  block: Block,
  item: SyntaxNode,
  prev: Block | null,
): KeyEdit {
  const userEvent = 'delete.backward.block';
  const { doc } = state;
  const list = item.parent;
  const alone = (list?.getChildren('ListItem').length ?? 0) <= 1;
  if (alone) {
    const change = formatted(state, block.text.from, { kind: 'block', to: 'p' }, userEvent);
    if (change) return { ...change, caretAt: block.text.from };
  }
  const line = doc.lineAt(block.lines.from);
  const own = block.containers.at(-1)!;
  const outer = state.sliceDoc(line.from, own.prefix.from);
  const changes: ChangeSpec[] = [];
  const above = line.number > 1 ? doc.line(line.number - 1) : null;
  let before: string | null = null;
  if (prev && above && !isGapLine(state, above)) {
    // Right under the block above: a blank line between, in the same edit as the marker.
    before = `\n${blankOf(outer)}\n${outer}`;
    changes.push({ from: prev.lines.to, to: block.text.from, insert: before });
  } else {
    // The item's marker goes, which the format writes as a substitution of the break.
    changes.push({ from: own.prefix.from, to: block.text.from });
    if (prev) before = state.sliceDoc(prev.lines.to, own.prefix.from);
  }
  // The next item, numbered other than 1, right under it would be read into the paragraph.
  const last = doc.lineAt(block.lines.to);
  if (last.number < doc.lines) {
    const next = doc.line(last.number + 1);
    const number = /^([ \t>]*)(\d{1,9})[.)](?:[ \t]|$)/.exec(next.text);
    if (number && number[2] !== '1') {
      changes.push({ from: next.from, insert: `${blankOf(number[1]!)}\n` });
    }
  }
  // In front of the text, however the format writes the break: right after the break's line
  // breaks, which a marker's payload never holds as they are.
  if (before && prev) {
    return {
      ...edit(state, changes, block.text.from, userEvent),
      caretAfterText: { from: prev.lines.to, text: before },
    };
  }
  return edit(state, changes, block.text.from, userEvent, block.text.from);
}

/** Joins `block` onto the block above, or moves the caret into a block above that takes no text. */
function joinOrMove(
  state: EditorState,
  block: Block,
  prev: Block | null,
  userEvent: 'delete.backward.block',
): KeyEdit {
  if (!prev) return nothing(state);
  // Front matter, and a block drawn as nothing (an HTML comment): nothing joins into it.
  if (prev.kind === 'front-matter' || onlyHidden(state, prev.lines.from, prev.lines.to)) {
    return nothing(state);
  }
  if (NO_TEXT.has(prev.kind)) return moveTo(endOfNoText(state, prev));
  if (prev.kind === 'rule') {
    // The rule goes, with the break above it (the format deletes a rule only with a break), or
    // under it when it is the first block.
    const { prev: before } = neighbours(state, prev);
    const change = before
      ? { from: before.lines.to, to: prev.lines.to }
      : { from: prev.lines.from, to: block.lines.from };
    return edit(state, [change], block.text.from, userEvent, block.text.from);
  }
  if (isEmpty(state, prev)) {
    // The empty block above goes; this one keeps its kind.
    const { prev: before } = neighbours(state, prev);
    const from = before ? before.lines.to : prev.lines.from;
    const to = before ? prev.lines.to : block.lines.from;
    return edit(state, [{ from, to }], block.text.from, userEvent, block.text.from);
  }
  return join(state, prev, block, userEvent);
}

/** Backspace in the open empty paragraph, without a Return to take back: it goes. */
function backspaceInOpen(state: EditorState): KeyEdit | null {
  const open = openBlock(state)!;
  const line = state.doc.lineAt(open.empty.from);
  for (let n = line.number - 1; n >= 1; n--) {
    const above = state.doc.line(n);
    if (isGapLine(state, above)) continue;
    const block = blockAt(state, above.to);
    if (!block) break;
    return {
      ...moveTo(NO_TEXT.has(block.kind) ? endOfNoText(state, block) : textEnd(state, block)),
      close: true,
    };
  }
  return deleteInOpen(state);
}

/** Delete in the open empty paragraph: it goes, and the caret goes to the next block's start. */
function deleteInOpen(state: EditorState): KeyEdit | null {
  const open = openBlock(state)!;
  const line = state.doc.lineAt(open.empty.from);
  for (let n = line.number + 1; n <= state.doc.lines; n++) {
    const below = state.doc.line(n);
    if (isGapLine(state, below)) continue;
    const block = blockAt(state, below.from);
    if (!block) break;
    return {
      ...moveTo(NO_TEXT.has(block.kind) ? block.text.from : textStart(state, block)),
      close: true,
    };
  }
  return { ...nothing(state), close: true };
}

/**
 * The start of the text of the first block after the caret's line: where Delete in an empty
 * paragraph puts the caret, once the paragraph is gone.
 */
export function nextTextStart(state: EditorState): number | null {
  const line = state.doc.lineAt(state.selection.main.head);
  for (let n = line.number + 1; n <= state.doc.lines; n++) {
    const below = state.doc.line(n);
    if (isGapLine(state, below)) continue;
    const block = blockAt(state, below.from);
    if (!block) return null;
    return NO_TEXT.has(block.kind) ? block.text.from : textStart(state, block);
  }
  return null;
}

/** Whether a position is in the open empty paragraph. */
function inOpen(state: EditorState, head: number): boolean {
  const open = openBlock(state);
  return !!open && head >= open.empty.from && head <= open.empty.to;
}

/**
 * The fenced code's content lines, from the line after its opening fence to the line before its
 * closing one; null for code without fences.
 */
function fencedContent(state: EditorState, block: Block): { first: Line; last: Line } | null {
  const { doc } = state;
  const open = doc.lineAt(block.lines.from);
  if (!/^[ \t>]*(?:[-*+] |\d{1,9}[.)] )?[ \t]*(?:`{3,}|~{3,})/.test(open.text)) return null;
  const end = doc.lineAt(block.lines.to);
  const closed = end.number > open.number && /^[ \t>]*(?:`{3,}|~{3,})[ \t]*$/.test(end.text);
  const lastN = closed ? end.number - 1 : end.number;
  if (lastN <= open.number) return { first: end, last: open };
  return { first: doc.line(open.number + 1), last: doc.line(lastN) };
}

/** The start of the text of a line in a block: past its containers' syntax. */
const contentStart = (line: Line) => line.from + (/^[ \t>]*/.exec(line.text)?.[0].length ?? 0);

/**
 * Backspace or Delete in a block that takes no text: nothing at the start of code's first line or
 * the end of its last (as at the ends of a file in a code editor); an empty code block goes whole;
 * at the start of the block itself, Backspace moves the caret to the block above and joins
 * nothing. Elsewhere CodeMirror's key edits the code.
 */
function inNoText(
  state: EditorState,
  block: Block,
  head: number,
  forward: boolean,
): KeyEdit | null {
  const userEvent = forward ? 'delete.forward.block' : 'delete.backward.block';
  const content = block.kind === 'code' ? fencedContent(state, block) : null;
  if (content) {
    const { first, last } = content;
    const empty = first.number > last.number || !state.sliceDoc(first.from, last.to).trim();
    const inside = head >= first.from && head <= last.to;
    if (empty && (inside || first.number > last.number))
      return removeEmpty(state, block, userEvent);
    if (!forward && head === first.from) return nothing(state);
    if (forward && head === last.to) return nothing(state);
  } else if (['code', 'math', 'front-matter'].includes(block.kind)) {
    if (!forward && head <= contentStart(state.doc.lineAt(block.text.from))) return nothing(state);
    if (forward && head >= block.text.to) return nothing(state);
  }
  if (!forward && head <= block.text.from) {
    // In front of the block: nothing joins into the block above, which the caret goes to.
    const { prev } = neighbours(state, block);
    if (!prev || prev.kind === 'front-matter') return nothing(state);
    return moveTo(NO_TEXT.has(prev.kind) ? endOfNoText(state, prev) : textEnd(state, prev));
  }
  if (forward && head >= state.doc.lineAt(block.lines.to).to) {
    const { next } = neighbours(state, block);
    if (!next || NO_TEXT.has(next.kind)) return nothing(state);
    return nothing(state);
  }
  return null;
}

/**
 * Backspace at the caret, without a Return to take back (design: block editing, "Backspace and
 * Delete at block edges"). Null declines: inside a block's text, in a prefix that shows as source,
 * on a line that is no block, and over a selection that `planSelectionDelete` leaves to the
 * tracked layer.
 */
export function planBackspace(state: EditorState): KeyEdit | null {
  const { selection } = state;
  if (selection.ranges.length > 1) return null;
  if (!selection.main.empty) return planSelectionDelete(state, false);
  const head = selection.main.head;
  if (inOpen(state, head)) return backspaceInOpen(state);
  const block = blockAt(state, head);
  if (!block) return null;
  if (NO_TEXT.has(block.kind)) return inNoText(state, block, head, false);
  if (block.kind === 'rule') return null;
  if (head < block.text.from) return null;
  const start = textStart(state, block);
  if (head > start) return afterHardBreak(state, block, head);
  const nodes = containerNodes(state, block);
  const { prev } = neighbours(state, block);
  const item = itemStartedBy(state, block, nodes);
  if (item) return backspaceAtItem(state, block, item, nodes, prev);
  if (isEmpty(state, block)) return removeEmpty(state, block, 'delete.backward.block');
  const inner = nodes.at(-1);
  if (inner?.name === 'Blockquote' && (!prev || !within(prev, inner))) {
    return unquote(state, block, inner);
  }
  return joinOrMove(state, block, prev, 'delete.backward.block');
}

/**
 * Backspace at the start of a line after a hard line break: the break goes whole, as one
 * character, its backslash or spaces with it. Null elsewhere.
 */
function afterHardBreak(state: EditorState, block: Block, head: number): KeyEdit | null {
  const line = state.doc.lineAt(head);
  if (line.from <= block.text.from || head !== contentStart(line)) return null;
  const hard = hardBreakAt(state, block, head);
  if (!hard) return null;
  return edit(state, [{ from: hard.from, to: hard.to }], hard.from, 'delete.backward.block');
}

/**
 * Delete at the caret (design: block editing, "Backspace and Delete at block edges"): at the end
 * of a block's text it joins the next block's text into this one, which keeps its kind; an empty
 * block goes. Null declines, inside a block's text.
 */
export function planDelete(state: EditorState): KeyEdit | null {
  const { selection } = state;
  if (selection.ranges.length > 1) return null;
  if (!selection.main.empty) return planSelectionDelete(state, true);
  const head = selection.main.head;
  const userEvent = 'delete.forward.block';
  if (inOpen(state, head)) return deleteInOpen(state);
  const block = blockAt(state, head);
  if (!block) return null;
  if (NO_TEXT.has(block.kind)) return inNoText(state, block, head, true);
  if (block.kind === 'rule') return null;
  if (isEmpty(state, block) && head >= block.text.from) return removeEmpty(state, block, userEvent);
  const end = textEnd(state, block);
  if (head < end || head < block.text.from) return null;
  const { next } = neighbours(state, block);
  if (!next || NO_TEXT.has(next.kind) || onlyHidden(state, next.lines.from, next.lines.to)) {
    return nothing(state);
  }
  if (next.kind === 'rule') {
    // The rule goes, with the break above it.
    return edit(state, [{ from: block.lines.to, to: next.lines.to }], head, userEvent, head);
  }
  if (isEmpty(state, next)) {
    return edit(state, [{ from: block.lines.to, to: next.lines.to }], head, userEvent, head);
  }
  return { ...join(state, block, next, userEvent), caretAt: head };
}

/**
 * Deleting a selection with Backspace or Delete. A selection from the start of a block's text to
 * the start of another's deletes the blocks it covers whole, with their breaks, in both modes, and
 * the block where it ends keeps its kind. A selection of the whole document leaves one empty
 * paragraph. Any other selection is the tracked layer's, as typing deletes it (null).
 */
export function planSelectionDelete(state: EditorState, forward: boolean): KeyEdit | null {
  const { from, to } = state.selection.main;
  const userEvent = forward ? 'delete.forward.block' : 'delete.backward.block';
  const first = blockAt(state, from);
  const last = blockAt(state, to);
  if (!first || !last || first.lines.from === last.lines.from) return null;
  if (from > textStart(state, first) || to !== textStart(state, last)) return null;
  if (NO_TEXT.has(last.kind)) return null;
  // The covered blocks go whole, from the start of the first one's line to the start of the last
  // one's: the last keeps its own syntax, and so its kind.
  const lineStart = state.doc.lineAt(first.lines.from);
  const sharedTo = sharedPrefix(lineStart, state.doc.lineAt(last.lines.from));
  return edit(
    state,
    [{ from: lineStart.from + sharedTo, to: state.doc.lineAt(last.lines.from).from + sharedTo }],
    lineStart.from + sharedTo,
    userEvent,
    last.text.from,
  );
}

/** How many characters of container syntax (quote markers) two lines share at their start. */
function sharedPrefix(a: Line, b: Line): number {
  const quotes = (text: string) => /^(?:[ \t]*>)*[ \t]?/.exec(text)?.[0] ?? '';
  const qa = quotes(a.text);
  const qb = quotes(b.text);
  let n = 0;
  while (n < qa.length && n < qb.length && qa[n] === qb[n]) n++;
  return n;
}
