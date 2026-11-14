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
import {
  type ChangeSpec,
  EditorSelection,
  type EditorState,
  findClusterBreak,
  type Line,
} from '@codemirror/state';
import { decodePayload, EditError, type FormatOp, OUTDENT_NUMBERED_CHILD } from '@redlines/format';
import { onlyHidden } from '../tracked/decorations.ts';
import { authorFacet, parsedField } from '../tracked/field.ts';
import { blockFormatChanges, trackingField } from '../tracked/typing.ts';
import {
  blankOf,
  continuation,
  hardBreakAt,
  lastCharOfLine,
  type Item,
  itemsAround,
  type KeyEdit,
  moveTo,
  nothing,
  retype,
  textEnd,
  textStart,
} from './edits.ts';
import { EMPTY_ITEM, MARKER, unsoundEmptyItem } from './empty-item.ts';
import { BLANK } from './hidden.ts';
import { openBlock } from './open.ts';
import {
  type Block,
  blockAt,
  holdsMarkersOnly,
  isGapLine,
  neighbours,
  NO_TEXT,
} from './structure.ts';

type SyntaxNode = ReturnType<typeof syntaxTree>['topNode'];

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
 * when the format refuses it: the key then writes the plain edit instead. `stands` is a refusal
 * that the plain edit would only get around, by writing what the format won't (a numbered item
 * read into the text above it): it is the key's refusal, in the format's words.
 */
function formatted(
  state: EditorState,
  at: number,
  op: FormatOp,
  userEvent: 'delete.backward.block' | 'delete.forward.block',
  stands?: string,
): KeyEdit | null {
  try {
    const changes = blockFormatChanges(state, { from: at, to: at }, op);
    if (!changes.length) return null;
    return { changes, selection: state.selection, userEvent, final: true };
  } catch (error) {
    if (error instanceof EditError) {
      if (stands !== undefined && error.message === stands) {
        return { ...nothing(state), userEvent, refusal: error.message };
      }
      return null;
    }
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

/** Why a marker inside another container can't be taken out of the first line of the file, tracked. */
const DEEP_AT_START =
  "A marker inside a quote or another list can't be taken out of the first line of the file while Track Changes is on. Turn Track Changes off for this change, or start the file with a line of text first.";

/** Whether a line below a paragraph is text of it, or makes a heading of it, once an item above goes. */
const readsAsText = (row: string) =>
  /^[ \t>]*(?:(?:\d{1,9}[.)]|[-+*])[ \t]*|=+[ \t]*|-{2,}[ \t]*)$/.test(row) ||
  (/^[ \t>]*(\d{1,9})[.)](?:[ \t]|$)/.exec(row)?.[1] ?? '1') !== '1';

/**
 * Why an item can't move (up a level, or out of its list, or into the paragraph above it) while a
 * pending change in the line below it would make that line read otherwise: an item that the change
 * leaves empty (a deletion of all its text, an insertion that is all of it) is an item with text in
 * some readings of the file and empty in others, which can't follow text and would turn it into a
 * heading.
 */
const BELOW_CHANGES =
  "A pending change in the line below would make it read differently once this item has moved: an item that the change leaves empty can't follow text, and would turn it into a heading. Accept or reject that change first.";

/** Why an item can't go up a level where the line after it would become part of its text. */
const ABSORBED =
  "This item can't go up a level: the line after it would read as part of its text, since a number other than 1, an empty item or an underline can't start a block right under text. Put a blank line between them first.";

/**
 * A line as the original view reads it, every change on it rejected (an insertion's text goes, a
 * deletion's comes back); null where that can't be told on one line (a split or a format change).
 */
function originalRow(row: string): string | null {
  const text = row
    .replace(/<!--ins [a-z0-9]+-->[^]*?<!--\/[a-z0-9]+-->/g, '')
    .replace(/<!--sub [a-z0-9]+ ([^]*?)-->[^]*?<!--\/[a-z0-9]+-->/g, (_all, payload: string) =>
      decodePayload(payload),
    )
    .replace(/<!--del [a-z0-9]+ ([^]*?)-->/g, (_all, payload: string) => decodePayload(payload))
    .replace(/<!--\/[a-z0-9]+-->|<!--(?:cmt|hl) [a-z0-9]+(?: [^]*?)?-->/g, '');
  return /<!--(?:split|fmt) /.test(text) ? null : text;
}

/**
 * Whether a line under a paragraph is text of it (or its underline) in each of the ways the file
 * reads: as it is, as the newest view reads it and as the original view reads it.
 */
const readingsOf = (row: string): boolean[] => {
  const original = originalRow(row);
  return [row, row.replace(MARKER, ''), ...(original === null ? [] : [original])].map(readsAsText);
};

/**
 * Whether the line after `line` holds a marker and is text of a paragraph above it in some of the
 * ways it reads and not in all: it can't follow text in one reading (an item with no text, a number
 * other than 1, an underline) and can in another.
 */
function readsOtherwiseBelow(state: EditorState, line: Line): boolean {
  if (line.number >= state.doc.lines) return false;
  const row = state.doc.line(line.number + 1).text;
  if (BLANK.test(row) || row.replace(MARKER, '') === row) return false;
  const reads = readingsOf(row);
  return reads.some(Boolean) && !reads.every(Boolean);
}

/** A line's quote markers, each with the space after it. */
const QUOTE_PREFIX = /^(?:[ \t]{0,3}>[ \t]?)*/;

/** The columns of white space in front of a line's text after its quote markers; null with a tab. */
function indentOf(text: string): number | null {
  const white = /^[ \t]*/.exec(text.slice(QUOTE_PREFIX.exec(text)![0].length))![0];
  return white.includes('\t') ? null : white.length;
}

/**
 * The columns an item's marker and its text start at, after the quote markers: the text is the
 * marker and the spaces after it, one to four, or one where the marker is alone or more follow.
 * Null where a tab is in the way.
 */
function itemColumns(
  state: EditorState,
  item: SyntaxNode,
): { marker: number; text: number } | null {
  const mark = item.getChild('ListMark');
  if (!mark) return null;
  const line = state.doc.lineAt(mark.from);
  const marker = indentOf(line.text);
  const after = /^[ \t]*/.exec(line.text.slice(mark.to - line.from))![0];
  if (marker === null || after.includes('\t')) return null;
  const alone = line.text.slice(mark.to - line.from).trim() === '';
  const spaces = alone || after.length > 4 ? 1 : Math.max(after.length, 1);
  return { marker, text: marker + (mark.to - mark.from) + spaces };
}

/**
 * The item that holds the last paragraph of `item` and its nested items (the paragraph a line right
 * under them follows), or null where they end in anything else. A line that starts with a marker of
 * a change is an HTML block to the parse and a paragraph to the views: it counts as a paragraph.
 */
function lastParagraphItem(state: EditorState, item: SyntaxNode): SyntaxNode | null {
  let node: SyntaxNode = item;
  for (;;) {
    let last: SyntaxNode | null = null;
    for (let child = node.lastChild; child; child = child.prevSibling) {
      if (child.name !== 'ListMark' && child.name !== 'Task') {
        last = child;
        break;
      }
    }
    if (!last) return null;
    if (last.name === 'Paragraph') return node;
    if (last.name === 'CommentBlock' || last.name === 'HTMLBlock') {
      return /<!--(?:\/|(?:split|ins|del|sub|fmt|cmt|hl) )/.test(state.sliceDoc(last.from, last.to))
        ? node
        : null;
    }
    if (last.name !== 'BulletList' && last.name !== 'OrderedList') return null;
    const inner = last.getChildren('ListItem').at(-1);
    if (!inner) return null;
    node = inner;
  }
}

/**
 * Why `items[0]` can't go up a level (to the indentation of `items[1]`, the item it is in): the
 * line right after it and its nested items, which stays where it is, would come to stand under the
 * text of its last paragraph, where a number other than 1, an empty item or an underline can't
 * start a block and is text of it. That is so where the line is indented far enough to continue the
 * item that holds that paragraph once it has moved (its text column, less the columns it moves:
 * the nested items move with it when the format writes the change, `shifted`; the plain edit moves
 * the item's own line only), and was not, where it stood: a line that continued the paragraph
 * before is text of it as it was. The format's own check reads the next item at the item's
 * indentation only, and is not made at all where it refuses first (tabs, a pending break). Null
 * where the line reads as an item in every reading, or lands elsewhere.
 */
function absorbedBelow(state: EditorState, items: Item[], shifted: boolean): string | null {
  const [moved, parent] = items;
  if (!moved || !parent) return null;
  const { doc } = state;
  const last = doc.lineAt(moved.node.to);
  if (last.number >= doc.lines) return null;
  const row = doc.line(last.number + 1).text;
  if (BLANK.test(row)) return null;
  const reads = readingsOf(row);
  if (!reads.some(Boolean)) return null;
  const deepest = lastParagraphItem(state, moved.node);
  if (!deepest) return null;
  const own = itemColumns(state, moved.node);
  const inner = itemColumns(state, deepest);
  const up = itemColumns(state, parent.node);
  const at = indentOf(row);
  // A tab in the way (the format refuses it, and the columns can't be told): keep the line apart.
  if (own && inner && up && at !== null) {
    const shift = own.marker - up.marker;
    const after = shifted || deepest === moved.node ? inner.text - shift : inner.text;
    if (!(at >= after && at < inner.text)) return null;
  }
  if (!reads.every(Boolean)) return BELOW_CHANGES;
  const number = /^[ \t>]*(\d{1,9})[.)](?:[ \t]|$)/.exec(row.replace(MARKER, ''))?.[1];
  return number !== undefined && number !== '1' ? OUTDENT_NUMBERED_CHILD : ABSORBED;
}

/** Why a join in a list or quote can't keep the next numbered item apart, tracked. */
const NUMBERED_IN_CONTAINER =
  "This join would make the next numbered item a line of the text, and the blank line that keeps it apart can't be written as a tracked change inside a list or quote. Turn Track Changes off for this join, or start the next list at 1.";

/** Why the first item of a numbered list at the start of a file can't leave it, tracked. */
const FIRST_NUMBERED =
  "This item can't leave its list while Track Changes is on: a line below it (a number other than 1, an empty item or an underline) would read as part of its text. Take the marker out with Track Changes off, or move the lines below it first.";

/** Words for a join onto a setext heading with Track Changes on. */
const SETEXT_JOIN =
  "A heading underlined with === or --- can't take the block below it while Track Changes is on: its underline would have to be written again after the new text, behind a marker, where it would no longer be an underline. Join them with Track Changes off.";

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
  const { doc } = state;
  // The item that `below` is the first block of goes into the text above: its marker is taken, as
  // when Backspace takes the first item out of its list, and the line after it reads otherwise in
  // some readings if a pending change empties it (#292).
  const taken = itemStartedBy(state, below, containerNodes(state, below));
  if (taken && !itemBefore(taken) && readsOtherwiseBelow(state, doc.lineAt(taken.to))) {
    return { ...nothing(state), refusal: BELOW_CHANGES };
  }
  const changes: ChangeSpec[] = [];
  let from = above.lines.to;
  if (above.kind === 'heading' && above.setext && state.field(trackingField, false)) {
    // The underline would be written again after the text joined to it, as an insertion, whose
    // closer ends the underline's line: micromark reads that line as text, and the newest view as
    // a heading. No other order of the marks puts a clean `===` line there (format §3.4).
    return { ...nothing(state), refusal: SETEXT_JOIN };
  }
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
  const blank = numberedKept(state, above, below);
  if (blank !== null && state.field(trackingField, false) && above.containers.length) {
    // The blank line that keeps the next numbered item from becoming text would be written with
    // the closer of the change on its own line, inside a list or a quote, where it is no blank
    // line to a reader that doesn't know the markers (format §3.4; #248, walk seed 887).
    return { ...nothing(state), refusal: NUMBERED_IN_CONTAINER };
  }
  const first = changes[0] as { from: number; to: number };
  if (
    blank !== null &&
    !(above.kind === 'heading' && above.setext) &&
    !(below.kind === 'heading' && below.setext)
  ) {
    const words = holdsOthersChange(state, first.from, doc.lineAt(below.lines.to).to);
    if (words) return { ...nothing(state), refusal: words };
    changes[0] = withBlankAfter(state, first, doc.lineAt(below.lines.to).to, blank);
  } else if (blank !== null) {
    changes.push({ from: doc.lineAt(below.lines.to).to + 1, insert: `${blank}\n` });
  }
  return edit(state, changes, from, userEvent);
}

/**
 * Words for a join that has to write text again that holds another person's change (the numbered
 * join rewrites the item's text with the line break behind it, and a change can't hold a marker),
 * naming them; null when no mark's marker is in `from`–`to`. Plain edits refuse it too.
 */
function holdsOthersChange(state: EditorState, from: number, to: number): string | null {
  const names = markNames(state, from, to);
  if (!names.length) return null;
  return `This line holds a tracked change by ${names.join(' and ')}, which the join would have to write again. Decide that change first, or edit it in the raw view.`;
}

/** The names of the people whose marks have a marker in `from`–`to`. */
function markNames(state: EditorState, from: number, to: number): string[] {
  const parsed = state.field(parsedField, false);
  if (!parsed) return [];
  const names = new Set<string>();
  for (const mark of parsed.marks) {
    for (const { open, close } of mark.segments) {
      if ((open.from < to && open.to > from) || (close && close.from < to && close.to > from)) {
        const by = mark.entry.by;
        names.add(parsed.ledger.people.find((person) => person.handle === by)?.name ?? by);
      }
    }
  }
  return [...names];
}

/** Words for a join with a block that holds only another person's deleted text. */
function onlyDeletedText(state: EditorState, block: Block): string | null {
  if (block.kind !== 'html' || !holdsMarkersOnly(state, block)) return null;
  // Lines that go on right under it (the parse cuts a paragraph after a comment's line) are its text.
  const last = state.doc.lineAt(block.lines.to);
  if (last.number < state.doc.lines) {
    const after = state.doc.line(last.number + 1).text;
    if (!BLANK.test(after) && !/^[ \t>]*(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/.test(after)) return null;
  }
  const names = markNames(state, block.text.from, block.text.to);
  if (!names.length) return null;
  return `This block holds only text that ${names.join(' and ')} deleted, so it can't be joined while the change is pending. Decide that change first.`;
}

/**
 * A blank line right after the text a change leaves (a numbered item other than 1 below it needs
 * one), written as part of that change, as the format's form wants: the change takes the text up
 * to the end of its block too, and writes it again with the line break behind it. Two edits, the
 * deletion and the blank line, are what the format refuses together (format §3.6, review I5).
 */
function withBlankAfter(
  state: EditorState,
  changes: { from: number; to: number; insert?: string },
  lineEnd: number,
  blank: string,
): { from: number; to: number; insert: string } {
  return {
    from: changes.from,
    to: lineEnd,
    insert: `${changes.insert ?? ''}${state.sliceDoc(changes.to, lineEnd)}\n${blank}`,
  };
}

/**
 * A numbered item other than 1 that a join leaves right under text keeps a blank line before it,
 * which would otherwise make it a line of the text above (design: the Call on numbered joins):
 * when the joined block was an item of that list, and the text it joins is not.
 */
function numberedKept(state: EditorState, above: Block, joined: Block): string | null {
  const { doc } = state;
  const last = doc.lineAt(joined.lines.to);
  if (last.number >= doc.lines) return null;
  const next = doc.line(last.number + 1);
  const number = /^([ \t>]*)(\d{1,9})[.)](?:[ \t]|$)/.exec(next.text);
  if (!number || number[2] === '1') return null;
  const items = joined.containers.filter((c) => c.kind === 'item');
  if (!items.length) return null;
  // Joined into an item of the list the next item is in: the list goes on, tight as it was. The
  // list is the next item's own (a nested one, not the list around it: #248, walk seed 887).
  const marker = next.from + (/^[ \t>]*/.exec(next.text)?.[0].length ?? 0);
  let own: SyntaxNode | null = tree(state, marker + 1).resolveInner(marker, 1);
  while (own && own.name !== 'ListItem') own = own.parent;
  const list = own?.parent ?? null;
  for (const node of containerNodes(state, above)) {
    if (node.name === 'ListItem' && node.parent && list && node.parent.from === list.from) {
      return null;
    }
  }
  return blankOf(number[1]!);
}

/** The lines between the last line of `above` and the first line of `below`. */
const blankLines = (state: EditorState, above: Block, below: Block): number =>
  state.doc.lineAt(below.lines.from).number - state.doc.lineAt(above.lines.to).number - 1;

/** The empty block goes, with the break above it (or below, for the first), the caret above. */
function removeEmpty(
  state: EditorState,
  block: Block,
  userEvent: 'delete.backward.block' | 'delete.forward.block',
): KeyEdit {
  const { prev, next } = neighbours(state, block);
  if (userEvent === 'delete.forward.block' && next) {
    // No blank line above the block and one below it: the forward edit takes the one below and
    // keeps the line break above, which leaves the next block right under the text above, as a
    // line of it (`- one⏎- ‸⏎⏎After.`: the paragraph is a lazy line of the item; `- one⏎  - ‸⏎⏎After.`:
    // the same, and an empty bullet is the underline of `one`). The block goes with the break
    // above it, as Backspace takes it, and the blank line stays (#441). With a blank line above,
    // the forward edit keeps one and is sound; front matter above has no break to take, and the
    // caret in a table's hidden pipes is no place for the key to leave it.
    if (
      prev &&
      prev.kind !== 'front-matter' &&
      next.kind !== 'table' &&
      blankLines(state, prev, block) === 0 &&
      blankLines(state, block, next) > 0
    ) {
      return edit(
        state,
        [{ from: prev.lines.to, to: block.lines.to }],
        prev.lines.to,
        userEvent,
        next.text.from,
      );
    }
    // Delete: the next block keeps its kind, the caret at its start.
    const forward = edit(
      state,
      [{ from: block.lines.from, to: next.lines.from }],
      block.lines.from,
      userEvent,
      next.text.from,
    );
    // The format has no place for the marker of that deletion in front of an item nested under
    // another one (`  - ` alone on the line, at the start of it), tracked: the same text goes as
    // the break above it and the item, as Backspace takes it, one edit that is a substitution
    // (#204). Untracked the first form is refused only where a change of someone else's is next to
    // it, which the break above it would decide: that refusal stands.
    if (!prev || !state.field(trackingField, false)) return forward;
    return {
      ...forward,
      fallback: edit(
        state,
        [{ from: prev.lines.to, to: block.lines.to }],
        prev.lines.to,
        userEvent,
        next.text.from,
      ),
    };
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
    if (parent?.name === 'ListItem') {
      // The items after it would become its children, and a numbered one other than 1 can't start a
      // list under its text: it would be text (#248, walk seed 332; #292): `outdent` keeps the
      // format's refusal and checks the rest itself.
      return outdent(state, block);
    }
    return outOfList(state, block, item, prev);
  }
  return removeBullet(state, block, prev) ?? joinOrMove(state, block, prev, userEvent);
}

/** Whether a mark's marker starts at `pos`. */
function startsWithMarker(state: EditorState, pos: number): boolean {
  const parsed = state.field(parsedField, false);
  return !!parsed?.marks.some((mark) =>
    mark.segments.some(({ open, close }) => open.from === pos || close?.from === pos),
  );
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
  // Another person's mark starts the text: with Track Changes off, a line break in front of it
  // would put its marker at the start of a line, which another reader takes for HTML. The
  // press joins at once (review I4).
  if (!state.field(trackingField, false) && startsWithMarker(state, block.text.from)) return null;
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
  const change = formatted(
    state,
    block.text.from,
    { kind: 'indent', by: -1 },
    userEvent,
    OUTDENT_NUMBERED_CHILD,
  );
  if (change?.refusal) return change;
  // The format's own check is not exact, and not made at all where it refuses first (tabs, a
  // pending break), where the plain edit below was written: so the line after is looked at here.
  const words = absorbedBelow(state, itemsAround(state, block), change !== null);
  if (words) return { ...nothing(state), userEvent, refusal: words };
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
  // A line below that a pending change empties would follow the text as an underline (#292).
  if (readsOtherwiseBelow(state, doc.lineAt(item.to))) {
    return { ...nothing(state), refusal: BELOW_CHANGES };
  }
  const list = item.parent;
  // A one-item list is the format's block change, which writes nothing for the line below: a number
  // other than 1 there is text of the paragraph once the item is one (the key writes the blank line
  // that keeps it apart), so it takes the way of a longer list.
  const underItem = doc.lineAt(item.to);
  const below = underItem.number < doc.lines ? doc.line(underItem.number + 1).text : '';
  const alone =
    (list?.getChildren('ListItem').length ?? 0) <= 1 &&
    (BLANK.test(below) || !readingsOf(below).some(Boolean));
  if (alone) {
    const change = formatted(state, block.text.from, { kind: 'block', to: 'p' }, userEvent);
    if (change) return { ...change, caretAt: block.text.from };
  }
  const line = doc.lineAt(block.lines.from);
  const own = block.containers.at(-1)!;
  // The first line of the file, Track Changes on: the format takes the marker out as a change of
  // its own, and the lines below it, up to a blank line, must not turn into text of this one or
  // make a heading of it (an item that can't interrupt a paragraph: numbered other than 1, or
  // empty; an underline), which the format's reading of them would also differ on (#248).
  if (!prev && line.number === 1 && state.field(trackingField, false)) {
    for (let n = 2; n <= doc.lines; n++) {
      const row = doc.line(n).text;
      if (/^[ \t>]*$/.test(row)) break;
      if (readsAsText(row)) {
        return { ...nothing(state), refusal: FIRST_NUMBERED };
      }
    }
  }
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
      // The first line of the file, Track Changes on: the format takes the marker out as a change
      // of its own, and has no place for the blank line that this item's number needs after it
      // (a line break before a numbered item, which is a line of its list: #248).
      let first = changes[0] as { from: number; to: number; insert?: string };
      // The marker's removal and the blank line are one change with the break above, as the
      // format writes the block's change.
      if (prev && first.insert === undefined) {
        first = {
          from: prev.lines.to,
          to: first.to,
          insert: state.sliceDoc(prev.lines.to, first.from),
        };
      }
      const words = holdsOthersChange(state, first.from, last.to);
      if (words) return { ...nothing(state), refusal: words };
      changes[0] = withBlankAfter(state, first, last.to, blankOf(number[1]!));
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
  const done = edit(state, changes, block.text.from, userEvent, block.text.from);
  // With no block above, the marker's removal and the blank line after are one replacement of the
  // item's first line to its end, and the text starts where the replacement does: the caret, an
  // interior point of it, would map to its end (review I1).
  const [first] = changes;
  if (!prev && first && typeof first === 'object' && 'to' in first && first.to !== undefined) {
    if (first.to > block.text.from && 'insert' in first) {
      const rest = { ...done };
      delete rest.caretAt;
      return {
        ...rest,
        selection: EditorSelection.single(first.from),
        caretBefore: block.text.from,
      };
    }
  }
  return done;
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
    return nothing(state);
  }
  return null;
}

/** Whether the text from `from` to `to` is inside a pending insertion of the author's own. */
function inOwnInsertion(state: EditorState, from: number, to: number): boolean {
  const me = state.facet(authorFacet)?.handle;
  return !!state
    .field(parsedField, false)
    ?.marks.some(
      (mark) =>
        mark.kind === 'ins' &&
        mark.entry.by === me &&
        mark.segments.some(({ open, close }) => open.to <= from && close && close.from >= to),
    );
}

/**
 * Backspace (or Delete) over the only character of an item's text, where the item left empty is no
 * item in Markdown: an empty bullet under a line of text is the underline of a heading, and an empty
 * numbered item is more of the text (`empty-item.ts`). The file must not hold it (#204: it held the
 * item's marker alone, which read the text above it as a heading, though the editor drew an empty
 * item), so the item does not stay in it:
 *
 * - Track Changes off: the plain key, and `open.ts` opens the empty item after it, as after any
 *   edit that takes the text of such an item (#442): drawn, out of the file, written when text is
 *   typed in it, gone with the next Backspace or when the caret leaves.
 * - Track Changes on, text of the author's own insertion that holds the item's break: the item goes
 *   whole with the character, as the author's own pending text does.
 * - Track Changes on, text that isn't the author's own: the format deletes the whole item itself.
 *
 * Null where the item holds more, where the text is more than one code point, and where the empty
 * item would be sound.
 */
function onlyCharOfItem(
  state: EditorState,
  block: Block,
  head: number,
  forward: boolean,
): KeyEdit | null {
  if (block.kind !== 'paragraph' || block.containers.at(-1)?.kind !== 'item') return null;
  // One character and the closer of the insertion that holds it, at most: the rest is a key inside
  // the text, which costs nothing here.
  if (block.text.to - block.text.from > 64) return null;
  const start = textStart(state, block);
  const end = textEnd(state, block);
  if (forward ? head !== start : head !== end) return null;
  if ([...state.sliceDoc(start, end)].length !== 1) return null;
  const { doc } = state;
  const item = itemsAround(state, block)[0];
  const line = doc.lineAt(block.lines.from);
  if (
    !item ||
    line.number < 2 ||
    item.line.number !== line.number ||
    doc.lineAt(item.node.to).number !== line.number
  ) {
    return null;
  }
  // What the item is once the character is gone.
  const rest = (doc.sliceString(line.from, start) + doc.sliceString(end, line.to)).replace(
    MARKER,
    '',
  );
  const found = EMPTY_ITEM.exec(rest);
  if (!found || !unsoundEmptyItem(doc, line.number, found[1]!, found[2]!.length, found[3]!)) {
    return null;
  }
  const userEvent = forward ? 'delete.forward.block' : 'delete.backward.block';
  const above = doc.line(line.number - 1);
  // Track Changes off is the plain key's: `open.ts` opens the item it leaves.
  if (!state.field(trackingField, false)) return null;
  // Text that isn't the author's own is deleted whole by the format; the author's own goes with
  // the break that it made, and the item.
  if (!inOwnInsertion(state, start, end)) return null;
  return edit(state, [{ from: above.to, to: end }], above.to, userEvent);
}

/**
 * Backspace or Delete over the only character of the first line of a paragraph that goes on: the
 * line goes with its break and the next line's prefix, as the format deletes a whole line, so that
 * no empty line is left in front of the paragraph's text (`delt⏎⏎⏎ship`, a stray blank line; walk
 * seed 1141). Null elsewhere: the character is not alone on the line, a marker is on it, or the
 * paragraph has no line after it.
 */
function onlyCharOfFirstLine(
  state: EditorState,
  block: Block,
  head: number,
  forward: boolean,
): KeyEdit | null {
  if (block.kind !== 'paragraph') return null;
  const start = block.text.from;
  const { doc } = state;
  const first = doc.lineAt(block.lines.from);
  // Where the caret is on the line, and how long the line is, decide before anything is read: a key
  // inside the text costs nothing here.
  if (forward ? head !== start : head !== first.to) return null;
  if (first.to - start > 32 || first.number >= doc.lineAt(block.lines.to).number) return null;
  const line = state.sliceDoc(start, first.to);
  if (line.includes('<!--') || line === '' || findClusterBreak(line, 0) !== line.length)
    return null;
  // The next line's text, after its quote markers and indentation. As the first line it is the
  // start of the block: syntax there (a number, a bullet, a `>`, a `#`, an underline) is no longer
  // the text it was as a wrapped line, so only a line of words takes the place.
  const next = doc.line(first.number + 1);
  const to = next.from + (/^[ \t>]*/.exec(next.text)?.[0].length ?? 0);
  const words = next.text.slice(to - next.from);
  if (!/^[\p{L}\p{N}]/u.test(words) || /^\d{1,9}[.)](?:[ \t]|$)/.test(words)) return null;
  return edit(
    state,
    [{ from: start, to }],
    start,
    forward ? 'delete.forward.block' : 'delete.backward.block',
    to,
  );
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
  if (head > start) {
    return (
      onlyCharOfItem(state, block, head, false) ??
      onlyCharOfFirstLine(state, block, head, false) ??
      lastCharOfLine(state, block, head) ??
      afterHardBreak(state, block, head)
    );
  }
  const nodes = containerNodes(state, block);
  const { prev } = neighbours(state, block);
  const deleted = prev && onlyDeletedText(state, prev);
  if (deleted) return { ...nothing(state), refusal: deleted };
  const item = itemStartedBy(state, block, nodes);
  let edit: KeyEdit;
  const inner = nodes.at(-1);
  if (item) edit = backspaceAtItem(state, block, item, nodes, prev);
  else if (isEmpty(state, block)) edit = removeEmpty(state, block, 'delete.backward.block');
  else if (inner?.name === 'Blockquote' && (!prev || !within(prev, inner))) {
    edit = unquote(state, block, inner);
  } else edit = joinOrMove(state, block, prev, 'delete.backward.block');
  // A container inside another (a quote in a quote, a list in a quote) on the first line of the file:
  // the format has no place for the mark in front of its marker; the words say what to do (#248).
  if (
    edit.changes.length &&
    !edit.fallback &&
    !prev &&
    nodes.length > 1 &&
    state.doc.lineAt(block.lines.from).number === 1 &&
    state.field(trackingField, false)
  ) {
    return { ...edit, fallback: { ...nothing(state), refusal: DEEP_AT_START } };
  }
  return edit;
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
  if (head < end || head < block.text.from) {
    return (
      onlyCharOfItem(state, block, head, true) ?? onlyCharOfFirstLine(state, block, head, true)
    );
  }
  const { next } = neighbours(state, block);
  const deleted = next && onlyDeletedText(state, next);
  if (deleted) return { ...nothing(state), refusal: deleted };
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
