// What the block keys write (design: block editing, the matrix). Each key is a pure function of the
// state that gives plain edits of the text, which the tracked layer then records through the
// format's trackedEdit or untrackedEdit as typing is recorded, and where the caret and the empty
// paragraph go; or null to decline, so that CodeMirror's own key runs.
//
// A new block always gets a blank line above and below it, whatever the file's habit, so that no
// new block is read into its neighbour. The blocks around it keep their spacing.

import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { type ChangeSpec, EditorSelection, type EditorState, type Line } from '@codemirror/state';
import type { FormatOp } from '@redlines/format';
import { atomsOf, onlyHidden, pastHidden } from '../tracked/decorations.ts';
import { authorFacet, bodyEnd, parsedField, viewModeField } from '../tracked/field.ts';
import { trackingField } from '../tracked/typing.ts';
import { BLANK } from './hidden.ts';
import { openBlock, type OpenRequest } from './open.ts';
import { type Block, blockAt, isGapLine, neighbours, openConstructs } from './structure.ts';

/** A key's edit: plain changes, where the caret goes, and what it is, for the history. */
export interface KeyEdit {
  /** Plain edits of the text, in the state's offsets. Empty for a key that only moves the caret. */
  changes: ChangeSpec[];
  /** The selection after them, in the offsets of the text they make. */
  selection: EditorSelection;
  userEvent:
    | 'input.break'
    | 'input.break.line'
    | 'delete.selection'
    | 'delete.backward.block'
    | 'delete.forward.block'
    | 'indent';
  /** Why the key does nothing, for people. */
  refusal?: string;
  /** A block change to make instead of the changes (Tasks 1.16, 1.17). */
  block?: FormatOp;
  /** Where the empty paragraph is after it, if the key opens one or keeps it open. */
  open?: OpenRequest;
  /**
   * Where the caret goes, as a position of the state's text that the edits leave in place: it
   * stays in front of that text however the tracked layer writes the edits. Otherwise the caret
   * goes where the tracked layer puts it, after the text the main edit inserts.
   */
  caretAt?: number;
  /** The caret stays right before `caretBefore`, a position of the state's text (⌃O). */
  caretBefore?: number;
  /**
   * The selection's ends, positions of the state's text that the edits leave in place, which stay
   * with their text: the start in front of what an edit writes there, the end behind it.
   */
  range?: { anchor: number; head: number };
  /** The caret goes to the end of the open block's line (`open`), wherever the edits put it. */
  caretInOpen?: boolean;
  /**
   * The caret goes `col` characters into the line `down` lines below the one that holds `at`, a
   * position of the state's text: for a row of a table the key writes, whatever markers the
   * tracked layer puts on the lines between.
   */
  caretOnLine?: { at: number; down: number; col: number };
  /**
   * The caret goes right after the first `text` the edits leave after the start-of-text position
   * `from`: for text a key writes again, as the second half of a code span.
   */
  caretAfterText?: { from: number; text: string };
  /** Joins the step before it in the history, so that the two are one step to undo. */
  join?: boolean;
  /** Kept in the record of Returns (Return and Shift-Return are, whatever their user event). */
  record?: boolean;
  /**
   * The changes are what the format wrote for a block change (`trackedFormat`, `untrackedFormat`),
   * markers and all: the tracked layer takes them as they are.
   */
  final?: boolean;
  /** The open empty paragraph goes with the caret's move, as an edit of its own. */
  close?: boolean;
  /**
   * The changes only open the empty paragraph, which the file never gets: they go in as they are,
   * past the tracked layer, where the format would mark them.
   */
  plain?: boolean;
  /**
   * Line breaks that open the empty paragraph, put in as they are once the tracked layer has written
   * `changes` (and the ledger, if it adds one): at the end of the body, or in front of what the
   * edits write at `at`, a position of the state's text; the caret and the open block on the line
   * `down` lines into them. For a Return whose mark the format writes only without them: the file
   * never gets them.
   */
  openPlain?: { insert: string; down: number; at?: number };
  /** What the key does instead when the format refuses its changes. */
  fallback?: KeyEdit;
}

/** A key that is taken and does nothing, the caret left where it is. */
export function nothing(state: EditorState): KeyEdit {
  return { changes: [], selection: state.selection, userEvent: 'input.break' };
}

/** A key that only moves the caret. */
export function moveTo(pos: number): KeyEdit {
  return { changes: [], selection: EditorSelection.single(pos), userEvent: 'input.break' };
}

const LIST_MARKER = /([-*+]|\d{1,9}[.)])(?=[ \t]|$)/g;
const TASK_BOX = /\[[ xX]\][ \t]?/;

/**
 * The syntax of a block's containers as a line after their first has it: a quote's `> `, an
 * item's indentation, up to its text, in the file's own characters (a tab stays a tab).
 */
export function continuation(state: EditorState, block: Block): string {
  const end = block.containers.at(-1)?.prefix.to ?? block.lines.from;
  let text = state.sliceDoc(block.lines.from, end);
  if (block.containers.some((c) => c.task)) text = text.replace(TASK_BOX, '');
  return text.replace(LIST_MARKER, (marker) => ' '.repeat(marker.length));
}

/** The syntax of a blank line in a block's containers: its quote markers, without spaces after. */
export const blankOf = (cont: string) => cont.replace(/[ \t]+$/, '');

/** The start of a block's text, past the hidden markers in front of it. */
export const textStart = (state: EditorState, block: Block) => {
  let pos = pastHidden(state, block.text.from, true);
  // Inside hidden text that goes on past the block's start (an opener right after hidden lines,
  // stepped over with them): past it, within the text.
  atomsOf(state).between(pos, pos, (from, to) => {
    if (from <= pos && to > pos) pos = Math.min(to, block.text.to);
  });
  return Math.max(pos, block.text.from);
};

/** The end of a block's text, before the hidden markers after it. */
export const textEnd = (state: EditorState, block: Block) => {
  let pos = pastHidden(state, block.text.to, false);
  // Inside hidden text that goes on past the block's end (another person's closer, stepped over
  // with the hidden lines after it): in front of it, within the text.
  atomsOf(state).between(pos, pos, (from, to) => {
    if (from < pos && to >= pos) pos = Math.max(from, block.text.from);
  });
  return Math.min(pos, block.text.to);
};

/** The block on the nearest line above `line` that isn't a break, if any. */
function lineAbove(state: EditorState, line: Line): Line | null {
  return line.number > 1 ? state.doc.line(line.number - 1) : null;
}

/** Whether the line after `line` is a blank line (or the end of the document). */
function blankAfter(state: EditorState, line: Line): boolean {
  if (line.number >= state.doc.lines) return true;
  return BLANK.test(state.doc.line(line.number + 1).text);
}

/** Whether the line before `line` is a blank line (or the start of the document). */
function blankBefore(state: EditorState, line: Line): boolean {
  const above = lineAbove(state, line);
  return !above || BLANK.test(above.text);
}

/** A heading's own syntax for a new heading of its level: `## `. */
const atxPrefix = (block: Block) => `${'#'.repeat(block.level ?? 1)} `;

/** Whether a block is a GitHub alert's first line, `[!NOTE]`, in a quote. */
const isAlertLine = (state: EditorState, block: Block) =>
  block.containers.at(-1)?.kind === 'quote' &&
  /^\[!\w+\]$/.test(
    state.doc.lineAt(block.text.from).text.slice(block.text.from - block.lines.from),
  );

type SyntaxNode = ReturnType<typeof syntaxTree>['topNode'];

/** A list item, read from the syntax tree, with what a new item next to it is written with. */
export interface Item {
  node: SyntaxNode;
  /** The line its marker is on. */
  line: Line;
  /** What is in front of its marker on that line, as a later line of it has it (`> `, spaces). */
  indent: string;
  /** Its marker, `-` or `2.`. */
  marker: string;
  /** The white space after its marker, up to its box or its text. */
  after: string;
  task: boolean;
  /** Its list holds more than one item and is loose. */
  loose: boolean;
}

/** The list items a block is in, innermost first. */
export function itemsAround(state: EditorState, block: Block): Item[] {
  const tree = ensureSyntaxTree(state, block.lines.to, 50) ?? syntaxTree(state);
  const empty = block.text.from >= block.text.to;
  let node: SyntaxNode | null = empty
    ? tree.resolveInner(block.lines.to, -1)
    : tree.resolveInner(block.text.from, 1);
  const items: Item[] = [];
  const kinds = block.containers.filter((c) => c.kind === 'item').reverse();
  for (; node; node = node.parent) {
    if (node.name !== 'ListItem') continue;
    const mark = node.getChild('ListMark');
    if (!mark) continue;
    const line = state.doc.lineAt(mark.from);
    const rest = line.text.slice(mark.to - line.from);
    const space = /^[ \t]*/.exec(rest)?.[0] ?? '';
    const container = kinds[items.length];
    const list = node.parent;
    items.push({
      node,
      line,
      indent: line.text
        .slice(0, mark.from - line.from)
        .replace(LIST_MARKER, (m) => ' '.repeat(m.length)),
      marker: state.sliceDoc(mark.from, mark.to),
      after: space || ' ',
      task: node.getChild('Task') !== null,
      loose: !!container?.loose && (list?.getChildren('ListItem').length ?? 0) > 1,
    });
  }
  return items;
}

/** The marker of a new item after `item`: its bullet, or the next number (or the same, in a list
 * numbered alike throughout, as `1.` all the way down). */
export function nextMarker(state: EditorState, item: Item): string {
  const number = /^(\d+)([.)])$/.exec(item.marker);
  if (!number) return item.marker;
  const numbers = (item.node.parent?.getChildren('ListItem') ?? []).map((other) => {
    const mark = other.getChild('ListMark');
    return mark ? Number.parseInt(state.sliceDoc(mark.from, mark.to), 10) : NaN;
  });
  const n = Number.parseInt(number[1]!, 10);
  const alike = numbers.length > 1 && numbers.every((m) => m === numbers[0]);
  return `${alike ? n : n + 1}${number[2]}`;
}

/** The syntax a new item after `item` starts with, on its own line. */
const newItem = (state: EditorState, item: Item) =>
  `${item.indent}${nextMarker(state, item)}${item.after}${item.task ? '[ ] ' : ''}`;

/** The change that turns line `line`'s text from its start into `target`, leaving what they share. */
export function retype(line: Line, upTo: number, target: string): ChangeSpec {
  const text = line.text.slice(0, upTo - line.from);
  let same = 0;
  while (same < target.length && same < text.length && target[same] === text[same]) same++;
  let end = 0;
  while (
    end < target.length - same &&
    end < text.length - same &&
    target[target.length - 1 - end] === text[text.length - 1 - end]
  ) {
    end++;
  }
  return {
    from: line.from + same,
    to: upTo - end,
    insert: target.slice(same, target.length - end),
  };
}

/** The nearest line above `line` that holds text. */
function textLineAbove(state: EditorState, line: Line): Line | null {
  for (let n = line.number - 1; n >= 1; n--) {
    const above = state.doc.line(n);
    if (!isGapLine(state, above)) return above;
  }
  return null;
}

/** Whether a block of an item is its last one, but for lists nested in it. */
function lastInItem(state: EditorState, block: Block, item: Item): boolean {
  let child: SyntaxNode | null = (
    ensureSyntaxTree(state, block.lines.to, 50) ?? syntaxTree(state)
  ).resolveInner(block.text.from, 1);
  while (child && child.parent && child.parent.from !== item.node.from) child = child.parent;
  for (let next = child?.nextSibling ?? null; next; next = next.nextSibling) {
    if (next.name !== 'BulletList' && next.name !== 'OrderedList') return false;
  }
  return true;
}

/** Return in an empty item: up a level, or out of the list at the top. One container per Return. */
function returnInEmptyItem(state: EditorState, block: Block, items: Item[]): KeyEdit {
  const { doc } = state;
  const item = items[0]!;
  const line = doc.lineAt(block.lines.from);
  const nested = item.node.getChild('BulletList') ?? item.node.getChild('OrderedList');
  const parent = items[1];
  if (parent && !nested) {
    // Up one level: the item's syntax as its parent's next item has it.
    const target = `${parent.indent}${nextMarker(state, parent)}${parent.after}${item.task ? '[ ] ' : ''}`;
    const change = retype(line, line.to, target);
    return {
      changes: [change],
      selection: EditorSelection.single(line.from + target.length),
      userEvent: 'input.break',
    };
  }
  // Out of the list: an empty paragraph after it, in the containers around it. With Track Changes
  // on, the format takes a line of a quote's `> ` alone for syntax it won't write: the empty
  // paragraph's line is `>`, which typing fills as well.
  const tracking = state.field(trackingField, false);
  const cont = tracking ? blankOf(item.indent) : item.indent;
  const above = textLineAbove(state, line);
  const from = above ? above.to : line.from;
  const insert = `${above ? '\n' : ''}${blankOf(cont)}\n${cont}`;
  // At the end of a file with no ledger yet, a Return that writes a mark makes the tracked layer
  // add the ledger, which takes the file's last line break and a blank line in front of it as
  // its own (format §9) when the text ends in one: one more keeps the empty paragraph in the body.
  const ledgerless = tracking && !state.field(parsedField, false)?.ledgerRange;
  const tail = (end: number) =>
    ledgerless && end === doc.length && insert.endsWith('\n') ? '\n' : '';
  // The first line of the file, an empty item's marker alone on it: nothing is in front of it for
  // the format to write a mark around, so the empty item's deletion alone is tracked (the format
  // takes the break after it with it, and a following item's marker), and the empty paragraph's
  // line breaks go in front of it as they are (#248).
  const atFileStart: KeyEdit | null =
    tracking && !nested && line.from === 0 && /^[ \t]*(?:[-+*]|\d{1,9}[.)])[ \t]*$/.test(line.text)
      ? {
          changes: [{ from: line.from, to: line.to }],
          selection: EditorSelection.single(line.from),
          userEvent: 'input.break',
          openPlain: { insert: '\n\n', down: 0, at: 0 },
        }
      : null;
  const changes: ChangeSpec[] = [];
  let at: number;
  let caret: number;
  if (nested) {
    // It holds nested items: they go back under the item above, and the empty paragraph opens
    // after them, as taking back the Return that made it and leaving the list would give.
    changes.push({ from, to: line.to });
    const end = doc.lineAt(nested.to);
    changes.push({ from: end.to, insert: insert + tail(end.to) });
    at = end.to;
    caret = end.to - (line.to - from) + insert.length;
    if (end.number < doc.lines && !BLANK.test(doc.line(end.number + 1).text)) {
      changes.push({ from: end.to + 1, insert: `${blankOf(cont)}\n` });
    }
  } else {
    // The next item, or block, right under it: a blank line between them too, in the same edit.
    // With Track Changes on that is line breaks alone, which the format writes behind text that is
    // no item of the list (the empty first item of a list). Behind an item of the same list it
    // refuses them: the newest view would read one loose list, and the closer in front of the next
    // item would end it for other readers. The key then opens the empty paragraph right above the
    // next item, which a bullet can start under text.
    const below = line.number < doc.lines && !BLANK.test(doc.line(line.number + 1).text);
    changes.push({
      from,
      to: line.to,
      insert: below ? `${insert}\n${blankOf(cont)}` : insert + tail(line.to),
    });
    // The start of the text the change writes, from which the open line is `down` lines on.
    at = below ? line.to : from;
    caret = from + insert.length;
    if (below) {
      return {
        changes,
        selection: EditorSelection.single(caret),
        userEvent: 'input.break',
        open: { at, assoc: 1, up: 1 },
        ...(tracking ? { caretInOpen: true } : {}),
        ...(tracking
          ? {
              fallback: {
                changes: [{ from, to: line.to, insert: insert + tail(line.to) }],
                selection: EditorSelection.single(caret),
                userEvent: 'input.break',
                open: { at: from, assoc: 1, down: lineBreaks(insert) },
                caretInOpen: true,
                ...(atFileStart ? { fallback: atFileStart } : {}),
              },
            }
          : {}),
      };
    }
  }
  return {
    changes,
    selection: EditorSelection.single(caret),
    userEvent: 'input.break',
    open: { at, assoc: 1, down: lineBreaks(insert) },
    // In it, wherever the tracked layer puts the caret after the text it writes.
    caretInOpen: true,
    // At the end of the body with Track Changes on, where the format may write the empty item's
    // deletion only with nothing after it: the empty paragraph's line breaks go in as they are,
    // after it.
    ...(tracking && !nested && atBodyEnd(state, line)
      ? {
          fallback: {
            changes: [{ from, to: line.to }],
            selection: EditorSelection.single(from),
            userEvent: 'input.break',
            openPlain: { insert, down: lineBreaks(insert) },
          },
        }
      : atFileStart
        ? { fallback: atFileStart }
        : {}),
  };
}

/**
 * The end of the line above `head`, when `head` is at the start of a line's text after a soft
 * line break inside a paragraph (not a hard one): where Return and Shift-Return act for it.
 */
function softLineStart(state: EditorState, head: number): number | null {
  const block = blockAt(state, head);
  if (!block || block.kind !== 'paragraph') return null;
  const line = state.doc.lineAt(head);
  if (line.from <= block.text.from) return null;
  // At the start of the text or in front of it, in the prefix or the indentation.
  if (head > line.from + (/^[ \t>]*/.exec(line.text)?.[0].length ?? 0)) return null;
  if (hardBreakAt(state, block, head)) return null;
  return state.doc.line(line.number - 1).to;
}

/** Whether only white space follows a line (or a position) in the body, up to the ledger. */
function atBodyEnd(state: EditorState, line: Line | number): boolean {
  const parsed = state.field(parsedField, false);
  const end = (parsed && bodyEnd(parsed)) ?? state.doc.length;
  const at = typeof line === 'number' ? line : line.to;
  return at <= end && !state.sliceDoc(at, end).trim();
}

/** How many line breaks a text holds. */
const lineBreaks = (text: string) => text.split('\n').length - 1;

/** How many list items a line's text is in. */
function itemDepth(state: EditorState, line: Line): number {
  const block = blockAt(state, line.to);
  return block ? itemsAround(state, block).length : 0;
}

/** Why Return at the start of a nested list's first item, under the text of its item, is refused. */
const NEEDS_BLANK_LINE =
  "An empty item can't start a list right under a line of text in Markdown, and a blank line there would make the item above it loose. Put a blank line above the list first.";

/** Return in a paragraph of a list item. */
function returnInItem(state: EditorState, block: Block, head: number): KeyEdit | null {
  const items = itemsAround(state, block);
  const item = items[0];
  if (!item) return null;
  if (block.text.from >= block.text.to || !state.sliceDoc(block.text.from, block.text.to).trim()) {
    return returnInEmptyItem(state, block, items);
  }
  const start = textStart(state, block);
  const end = textEnd(state, block);
  const between = item.loose ? `\n${blankOf(item.indent)}` : '';
  const sibling = newItem(state, item);
  const refuse = (refusal: string): KeyEdit => ({ ...nothing(state), refusal });
  const first = state.doc.lineAt(block.lines.from).number === item.line.number;
  if (head <= start && first) {
    // An empty item above, the caret staying with the text. A task item keeps its own box: the
    // new item's goes in front of it.
    // With Track Changes on, the format takes no marker in front of the box: the empty item above
    // keeps the box as it is, and the item takes a copy of it.
    const box = item.node.getChild('Task');
    const tracking = state.field(trackingField, false);
    const at = box && !tracking ? box.from : block.text.from;
    const insert = !box
      ? `${between}\n${sibling}`
      : tracking
        ? `${between}\n${item.indent}${item.marker}${item.after}${state.sliceDoc(box.from, block.text.from)}`
        : `[ ] ${between}\n${item.indent}${item.marker}${item.after}`;
    // The first item of a list right under a line of text (it interrupts that paragraph): an empty
    // item can't, so a blank line goes between them, as in front of any block on top of another
    // (walk seed 54). Under an item of another list, as deep or deeper, the format keeps its own
    // rule for a break in front of an item, which this is not the place to change. In the text of
    // an item the blank line would make the item loose, which a change can't write: its closer
    // would stand on the blank line, with Track Changes on the key says so.
    const above = item.node.prevSibling ? null : lineAbove(state, item.line);
    const under = above && !BLANK.test(above.text) && itemDepth(state, above) < items.length;
    if (under && tracking && items.length > 1) {
      // In the text of an item the blank line is one insertion with the new item's line, at the end
      // of the line above: the format writes it as a split whose break is the blank line and the
      // item, which reads alike in every order (a blank line of its own, with the closer of an
      // insertion on it, would be no blank line to a reader that doesn't know the markers; #248).
      // The new item takes the first item's own number: the list starts where it did and reads, by
      // position, as it did with one more item (the next number would put it ahead of `1.`).
      const same = `${between}\n${item.indent}${item.marker}${item.after}`;
      const joined = `\n${blankOf(item.indent)}${same}`;
      return {
        changes: [{ from: above.to, insert: joined }],
        selection: EditorSelection.single(start + joined.length),
        userEvent: 'input.break',
        caretAt: start,
        fallback: refuse(NEEDS_BLANK_LINE),
      };
    }
    const apart = above && under ? [{ from: above.to, insert: `\n${blankOf(item.indent)}` }] : [];
    const added = apart.reduce((total, change) => total + change.insert.length, 0);
    return {
      changes: [...apart, { from: at, insert }],
      selection: EditorSelection.single(start + added + insert.length),
      userEvent: 'input.break',
      caretAt: start,
    };
  }
  if (head >= end) {
    // A paragraph of the item comes after this one: an empty paragraph in the item, between them.
    if (!lastInItem(state, block, item)) return returnAtEnd(state, block);
    const at = state.doc.lineAt(block.lines.to).to;
    const insert = `${between}\n${sibling}`;
    return {
      changes: [{ from: at, insert }],
      selection: EditorSelection.single(at + insert.length),
      userEvent: 'input.break',
    };
  }
  const line = state.doc.lineAt(head);
  if (head === line.to && line.to < block.text.to && !hardBreakAt(state, block, head)) {
    // At a soft line break, the end of a source line inside the item's text: Return at the start
    // of the next line's text, the soft break becoming the new item's line break.
    const next = state.doc.line(line.number + 1);
    const text = next.from + (/^[ \t>]*/.exec(next.text)?.[0].length ?? 0);
    const insert = `${between}\n${sibling}`;
    return {
      changes: [{ from: head, to: text, insert }],
      selection: EditorSelection.single(head + insert.length),
      userEvent: 'input.break',
      // After the new item's syntax, however the format writes the break (a substitution of a
      // lazy line takes its text with it).
      caretAfterText: { from: head, text: insert },
    };
  }
  const hard = hardBreakAt(state, block, head);
  if (hard) {
    const insert = `${between}\n${sibling}`;
    return {
      changes: [{ from: hard.from, to: hard.to, insert }],
      selection: EditorSelection.single(hard.from + insert.length),
      userEvent: 'input.break',
      caretAt: hard.to,
    };
  }
  const { caretAfterText, ...change } = splitAt(state, head, `${between}\n${sibling}`);
  return {
    changes: [change],
    selection: EditorSelection.single(change.from + change.insert.length),
    userEvent: 'input.break',
    ...(caretAfterText ? { caretAfterText } : {}),
  };
}

/** Return in the empty paragraph open in a list item: a new item after it, or nothing. */
function returnInOpenItem(state: EditorState, line: Line): KeyEdit {
  const above = textLineAbove(state, line);
  const prev = above && blockAt(state, above.to);
  if (!prev || !above) return nothing(state);
  const items = itemsAround(state, prev);
  const item = items.find((it) => continuationOf(it) === line.text);
  if (!item) return nothing(state);
  // Between two paragraphs of the item: nothing.
  for (let n = line.number + 1; n <= state.doc.lines; n++) {
    const next = state.doc.line(n);
    if (isGapLine(state, next)) continue;
    const block = blockAt(state, next.from);
    if (block && itemsAround(state, block).some((it) => it.node.from === item.node.from)) {
      return nothing(state);
    }
    break;
  }
  const insert = `${item.loose ? `\n${blankOf(item.indent)}` : ''}\n${newItem(state, item)}`;
  return {
    changes: [{ from: above.to, to: line.to, insert }],
    selection: EditorSelection.single(above.to + insert.length),
    userEvent: 'input.break',
  };
}

/** The syntax of a line after an item's first, as far as `item`, for a block in it. */
function continuationOf(item: Item): string {
  return `${item.indent}${' '.repeat(item.marker.length)}${item.after}`;
}

/** Return in the open empty paragraph. */
function returnInOpen(state: EditorState, head: number): KeyEdit | null {
  const open = openBlock(state);
  if (!open || head < open.empty.from || head > open.empty.to) return null;
  const { doc } = state;
  const line = doc.lineAt(open.empty.from);
  const syntax = line.text;
  // At the top level: nothing (Markdown keeps no second empty paragraph). In a list item: a new
  // item after it, or nothing between two of its paragraphs.
  if (!/>[ \t]?$/.test(syntax)) return syntax ? returnInOpenItem(state, line) : nothing(state);
  // In a quote: out of it one level, from the end of the block above, as the empty paragraph opened
  // after it. In the middle of the quote, this parts it.
  const above = lineAbove(state, line);
  const higher = above && lineAbove(state, above);
  if (!above || !higher || !BLANK.test(above.text) || isGapLine(state, higher)) {
    return nothing(state);
  }
  const quote = syntax.lastIndexOf('>');
  const cont = syntax.slice(0, quote) + syntax.slice(quote + 1).replace(/^[ \t]/, '');
  // Each line's quote marker taken out on its own, as Backspace over them one at a time would:
  // the format then writes it plain where the quote reads the same, at its end, and as a change
  // where it parts the quote.
  // In a quote in a quote, the blank line above stays the inner quote's, which it ends: taking its
  // marker out too would part the outer quote for the format.
  const lines: (readonly [Line, string])[] = /\S/.test(cont)
    ? [[line, cont]]
    : [
        [above, blankOf(cont)],
        [line, cont],
      ];
  const changes: ChangeSpec[] = [];
  for (const [at, target] of lines) {
    let same = 0;
    while (same < target.length && target[same] === at.text[same]) same++;
    changes.push({ from: at.from + same, to: at.to, insert: target.slice(same) });
  }
  const shrunk = lines.length > 1 ? above.text.length - blankOf(cont).length : 0;
  return {
    changes,
    selection: EditorSelection.single(line.from - shrunk + cont.length),
    userEvent: 'input.break',
    open: { at: line.to, assoc: 1 },
  };
}

/** Return at the end of a block's text: an empty paragraph below it. */
export function returnAtEnd(state: EditorState, block: Block): KeyEdit {
  const { doc } = state;
  const last = doc.lineAt(block.lines.to);
  const cont = continuation(state, block);
  const at = last.to;
  const changes: ChangeSpec[] = [];
  let insert: string;
  if (isAlertLine(state, block)) {
    // Into the alert's body, on the line under its marker.
    insert = `\n${cont}`;
  } else {
    insert = `\n${blankOf(cont)}\n${cont}`;
  }
  changes.push({ from: at, insert });
  if (!isAlertLine(state, block) && !blankAfter(state, last)) {
    // The block below is right under this one: the empty paragraph gets a blank line below it too.
    const next = neighbours(state, block).next;
    const below = next ? blankOf(continuation(state, next)) : '';
    changes.push({ from: last.to + 1, insert: `${below}\n` });
  }
  return {
    changes,
    selection: EditorSelection.single(at + insert.length),
    userEvent: 'input.break',
    open: {
      at,
      assoc: 1,
      pressedIn: { from: block.lines.from, to: block.lines.to },
    },
  };
}

/**
 * Where an empty paragraph opened above a block goes: in front of its own syntax, after its
 * containers' (`> `), or, at the top level, in front of the lines of markers alone right above it
 * (another person's pending change to the block), so that they stay with the block.
 */
function aboveAt(state: EditorState, block: Block): number {
  const { doc } = state;
  const first = doc.lineAt(block.lines.from);
  const own = block.containers.at(-1)?.prefix.to ?? first.from;
  if (block.containers.length) return own;
  let at = first.from;
  for (let n = first.number - 1; n >= 1; n--) {
    const line = doc.line(n);
    if (!isGapLine(state, line)) break;
    if (!BLANK.test(line.text)) at = line.from;
  }
  return at;
}

/** Return at the start of a block's text: an empty paragraph above it, the caret staying. */
function returnAtStart(state: EditorState, block: Block, start: number): KeyEdit {
  const { doc } = state;
  const at = aboveAt(state, block);
  const cont = continuation(state, block);
  const line = doc.lineAt(at);
  const changes: ChangeSpec[] = [];
  const above = lineAbove(state, line);
  if (at === line.from && above && !blankBefore(state, line)) {
    // The block above is right on top of this one: a blank line between it and the new paragraph.
    changes.push({ from: above.to, insert: `\n${blankOf(cont)}` });
  }
  changes.push({ from: at, insert: `\n${blankOf(cont)}\n${cont}` });
  return {
    changes,
    selection: EditorSelection.single(start),
    userEvent: 'input.break',
    open: { at, assoc: -1, pressedIn: { from: start, to: block.lines.to } },
    caretAt: start,
  };
}

/**
 * The hard line break the caret is on either side of, in a block's text: its syntax (a backslash,
 * or two or more spaces), the line break and the next line's prefix, up to its text.
 */
export function hardBreakAt(
  state: EditorState,
  block: Block,
  head: number,
): { from: number; to: number } | null {
  const { doc } = state;
  const line = doc.lineAt(head);
  const ending = (l: Line) => /(?<!\\)(?:\\\\)*(\\| {2,})$/.exec(l.text);
  const prefixEnd = (l: Line) => l.from + (/^[ \t>]*/.exec(l.text)?.[0].length ?? 0);
  // Before (or inside) the break's syntax, at the end of a line of the block's text.
  if (line.to < block.text.to) {
    const match = ending(line);
    const from = match ? line.to - match[1]!.length : -1;
    if (match && head >= from) return { from, to: prefixEnd(doc.line(line.number + 1)) };
  }
  // At the start of the line after one.
  if (line.from > block.text.from && head <= prefixEnd(line)) {
    const above = doc.line(line.number - 1);
    const match = ending(above);
    if (match) return { from: above.to - match[1]!.length, to: prefixEnd(line) };
  }
  return null;
}

/** The inline syntax whose delimiters the caret is right inside of, at an edge of its text. */
const EDGED = new Set(['Emphasis', 'StrongEmphasis', 'Strikethrough', 'InlineCode', 'Link']);

/**
 * A position at the edge of an inline construct's text, right inside its delimiters, moved out of
 * them: a break there goes outside the construct (`**‸bold**` breaks in front of the `**`).
 */
function outsideEdges(state: EditorState, head: number): number {
  const tree = ensureSyntaxTree(state, head, 50) ?? syntaxTree(state);
  let at = head;
  for (let moved = true; moved;) {
    moved = false;
    for (const side of [-1, 1] as const) {
      for (let node: SyntaxNode | null = tree.resolveInner(at, side); node; node = node.parent) {
        if (!EDGED.has(node.name)) continue;
        const marks = node.getChildren(
          node.name === 'Link'
            ? 'LinkMark'
            : node.name === 'InlineCode'
              ? 'CodeMark'
              : node.name === 'Strikethrough'
                ? 'StrikethroughMark'
                : 'EmphasisMark',
        );
        const open = marks[0];
        const close = node.name === 'Link' ? marks[1] : marks.at(-1);
        if (open && open.to === at && node.from < at) {
          at = node.from;
          moved = true;
        } else if (close && close !== open && close.from === at && node.to > at) {
          at = node.to;
          moved = true;
        }
        if (moved) break;
      }
      if (moved) break;
    }
  }
  return at;
}

/**
 * The paragraph break `insert` at `head`, in the inline constructs open there: each is closed
 * before the break and opened again after it (a link's destination repeated), and white space at
 * the split goes outside the delimiters, after the break. An atom (an image, an autolink, a tag)
 * the caret is inside of is never parted: the break goes after it.
 */
function splitAt(
  state: EditorState,
  head: number,
  insert: string,
): { from: number; to: number; insert: string; caretAfterText?: { from: number; text: string } } {
  let at = outsideEdges(state, head);
  let open = openConstructs(state, at);
  const atom = open.find((c) => c.kind === 'atom');
  if (atom) {
    at = atom.to;
    open = openConstructs(state, at);
  }
  if (!open.length) return { from: at, to: at, insert };
  const code = open.find((c) => c.kind === 'code');
  if (code) {
    // A code span is parted as a whole, which Track Changes writes as one change of it: a change
    // inside code would not be read.
    const inner = open.slice(0, open.indexOf(code));
    const closes = [...inner]
      .reverse()
      .map((c) => (c.kind === 'link' ? (c.tail ?? c.close) : c.close));
    const opens = inner.map((c) => c.open);
    const left = state.sliceDoc(code.from + code.open.length, at);
    const right = state.sliceDoc(at, code.to - code.close.length);
    return {
      from: code.from,
      to: code.to,
      insert:
        `${code.open}${left}${code.close}${closes.join('')}${insert}` +
        `${opens.join('')}${code.open}${right}${code.close}`,
      caretAfterText: { from: code.from, text: `${insert}${opens.join('')}${code.open}` },
    };
  }
  const text = state.doc.lineAt(at).text;
  const lineFrom = state.doc.lineAt(at).from;
  let from = at;
  let to = at;
  while (from > lineFrom && /[ \t]/.test(text[from - 1 - lineFrom] ?? '')) from--;
  while (/[ \t]/.test(text[to - lineFrom] ?? '')) to++;
  const closes = [...open]
    .reverse()
    .map((c) => (c.kind === 'link' ? (c.tail ?? c.close) : c.close));
  const opens = open.map((c) => c.open);
  return {
    from,
    to,
    insert: `${closes.join('')}${insert}${state.sliceDoc(from, to)}${opens.join('')}`,
  };
}

/** Return in the middle of a block's text: two blocks of its kind, the caret at the second's start. */
function returnInMiddle(state: EditorState, block: Block, head: number): KeyEdit {
  const cont = continuation(state, block);
  const { doc } = state;
  const line = doc.lineAt(head);
  // Either side of a hard line break: the hard break becomes the paragraph break.
  const hard = block.kind === 'paragraph' ? hardBreakAt(state, block, head) : null;
  if (hard) {
    const insert = `\n${blankOf(cont)}\n${cont}`;
    return {
      changes: [{ from: hard.from, to: hard.to, insert }],
      selection: EditorSelection.single(hard.from + insert.length),
      userEvent: 'input.break',
      caretAt: hard.to,
    };
  }
  let insert: string;
  if (block.kind === 'heading' && block.setext) {
    const underline = doc.lineAt(block.lines.to);
    const mark = underline.text.slice(cont.length).trim();
    insert = `\n${cont}${mark}\n${blankOf(cont)}\n${cont}`;
  } else if (block.kind === 'heading') {
    insert = `\n${blankOf(cont)}\n${cont}${atxPrefix(block)}`;
  } else if ((head === line.to || onlyHidden(state, head, line.to)) && line.to < block.text.to) {
    // At a soft line break, the end of a source line inside the paragraph (text that is deleted and
    // hidden after the caret is no text; walk seed 146): the paragraph break is
    // written there, and the caret goes to the start of the line below, which begins the new
    // paragraph. With Track Changes off the line break already there is one of the two; with it on,
    // both go in front of it, since rejecting a split of one would take the soft line break too.
    const next = doc.line(line.number + 1);
    const syntax = /^[ \t>]*/.exec(next.text)?.[0].length ?? 0;
    insert = state.field(trackingField, false)
      ? `\n${blankOf(cont)}\n${cont}`
      : `\n${blankOf(cont)}`;
    return {
      changes: [{ from: head, insert }],
      selection: EditorSelection.single(head + insert.length + 1 + syntax),
      userEvent: 'input.break',
      caretAt: next.from + syntax,
    };
  } else {
    insert = `\n${blankOf(cont)}\n${cont}`;
  }
  const { caretAfterText, ...change } = splitAt(state, head, insert);
  return {
    changes: [change],
    selection: EditorSelection.single(change.from + change.insert.length),
    userEvent: 'input.break',
    ...(caretAfterText ? { caretAfterText } : {}),
  };
}

/**
 * Return at the caret: a new block (design: block editing, "The matrix"). A selection is
 * `planSelectionReturn`'s. Null declines: in code, a table, an HTML block and the other blocks
 * that take no text (but for Return in front of one), and on a line that is no block, CodeMirror's
 * key runs, until Task 1.18 binds them.
 */
export function planReturn(state: EditorState): KeyEdit | null {
  const { selection } = state;
  if (selection.ranges.length > 1 || !selection.main.empty) return null;
  const head = selection.main.head;
  // At the start of a line after a soft line break: Return at that break, the end of the line above.
  const atLine = softLineStart(state, head);
  if (atLine !== null) {
    return planReturn(state.update({ selection: EditorSelection.cursor(atLine) }).state);
  }
  const inOpen = returnInOpen(state, head);
  if (inOpen) return inOpen;
  const block = blockAt(state, head);
  if (!block) return null;
  if (block.kind !== 'paragraph' && block.kind !== 'heading') {
    // Before a block that takes no text (a fence, a table, an HTML block): an empty paragraph above
    // it, as Word does above a table at the top of a document.
    // The caret goes into it: typed at the block's start, text would land in the fence or the row.
    if (['code', 'table', 'html', 'rule'].includes(block.kind) && head === block.text.from) {
      const above: KeyEdit = { ...returnAtStart(state, block, head), caretInOpen: true };
      delete above.caretAt;
      return above;
    }
    // At the end of an HTML block's last line: an empty paragraph after it. Inside it, a line
    // break in the block (CodeMirror's).
    // The same after a thematic break (typed `---` and Return).
    if (
      (block.kind === 'html' || block.kind === 'rule') &&
      head === state.doc.lineAt(block.lines.to).to
    ) {
      return returnAtEnd(state, block);
    }
    return null;
  }
  if (block.kind === 'paragraph' && block.containers.at(-1)?.kind === 'item') {
    return returnInItem(state, block, head);
  }
  const start = textStart(state, block);
  const end = textEnd(state, block);
  const open = openBlock(state);
  const table = head >= end && head > start ? tableFromRow(state, block, head) : null;
  if (table) return table;
  if (head <= start) {
    // Again at the start of a block whose empty paragraph is open above it: nothing.
    if (open?.pressedIn && open.pressedIn.from <= start && open.empty.to < head) {
      return nothing(state);
    }
    return returnAtStart(state, block, start);
  }
  if (head >= end) {
    // The empty paragraph this block's Return opened is still open below it: into it.
    if (open?.pressedIn && open.empty.from > head && open.pressedIn.to >= head) {
      return moveTo(open.empty.to);
    }
    // Right before a split that ends the line (another person's, or one of yours): the empty
    // paragraph opens after the split's break, at the start of the next block, as it does in front
    // of an opener there; a Return next to the split's marker would be written beside it.
    const next = splitEnds(state, block, end) ? neighbours(state, block).next : null;
    if (next && next.kind !== 'rule') {
      const above: KeyEdit = {
        ...returnAtStart(state, next, textStart(state, next)),
        caretInOpen: true,
        // With Track Changes on, the format would write the line breaks next to the split's break
        // as a split of their own, which no reader sees: they go in as they are, as the empty
        // paragraph is no change of the file. Typing in it is the format's whole-block insertion.
        plain: !!state.field(trackingField, false),
      };
      delete above.caretAt;
      return above;
    }
    return returnAtEnd(state, block);
  }
  return returnInMiddle(state, block, head);
}

/** A row of cells typed on a line of its own: pipes round at least one cell. */
const TYPED_ROW = /^\|(?:[^|\n]+\|)+[ \t]*$/;

/**
 * Return at the end of a paragraph that is one row of cells, `| a | b |`, alone at the top level
 * (typed syntax, design: block editing): the table's delimiter row, and a first row to type in,
 * the caret in its first cell. Null elsewhere, where Return opens an empty paragraph.
 */
function tableFromRow(state: EditorState, block: Block, head: number): KeyEdit | null {
  const { doc } = state;
  if (block.kind !== 'paragraph' || block.containers.length > 0) return null;
  const first = doc.lineAt(block.lines.from);
  const last = doc.lineAt(block.lines.to);
  // The markers of the author's own insertion on the line (its closer) are no part of the row.
  const row = first.text.replace(/<!--[^]*?-->/g, '');
  if (first.number !== last.number || head < first.from + row.length) return null;
  if (!TYPED_ROW.test(row) || state.sliceDoc(first.from, head) !== row) return null;
  if (!blankBefore(state, first) || !blankAfter(state, last)) return null;
  const cells = row.replace(/[ \t]+$/, '').split('|').length - 2;
  const delimiter = `|${' --- |'.repeat(cells)}`;
  const body = `|${'  |'.repeat(cells)}`;
  const insert = `\n${delimiter}\n${body}`;
  const tracking = state.field(trackingField, false);
  if (tracking) {
    // With Track Changes on the row must be the author's own pending insertion, and the rows join
    // it as text, with no split and no mark of their own (format §3.7); on any other paragraph
    // Return is an ordinary Return, and Paragraph › Table makes a table.
    const handle = state.facet(authorFacet)?.handle;
    const own = state
      .field(parsedField)
      .marks.some(
        (mark) =>
          mark.kind === 'ins' &&
          mark.entry.by === handle &&
          mark.segments.some(
            (g) =>
              g.close?.from === head &&
              g.content.to === head &&
              /^\n*$/.test(state.sliceDoc(g.content.from, first.from)),
          ),
      );
    if (!own) return null;
  }
  return {
    ...(tracking ? { final: true } : {}),
    changes: [{ from: head, insert }],
    selection: EditorSelection.single(head + insert.length),
    userEvent: 'input.break',
    record: false,
    caretOnLine: { at: head, down: 2, col: 2 },
  };
}

/** Whether a split's marker stands between the end of a block's text and the end of its line. */
function splitEnds(state: EditorState, block: Block, end: number): boolean {
  const line = state.doc.lineAt(block.lines.to);
  return end <= line.to && /<!--split [a-z0-9]+-->/.test(state.sliceDoc(end, line.to));
}

/**
 * Return over a selection, as two edits that are one step to undo: the selection deleted as typing
 * deletes it, then, where the key makes a break, a Return at the caret (`then`), which alone is
 * recorded, so that Backspace right after joins the blocks again and leaves the deleted text
 * deleted, as in Word. A selection across blocks deletes the text selected in each and keeps each
 * block's kind: the blocks inside it go whole, and one break stays. A selection of all of one
 * block's text leaves an empty paragraph.
 */
export function planSelectionReturn(
  state: EditorState,
): { deletion: KeyEdit; then: ((state: EditorState) => KeyEdit | null) | null } | null {
  const { selection } = state;
  if (selection.ranges.length > 1 || selection.main.empty) return null;
  const { from, to } = selection.main;
  const first = blockAt(state, from);
  const last = blockAt(state, to);
  if (!first || !last) return null;
  const join = (edit: KeyEdit | null): KeyEdit | null =>
    edit && { ...edit, userEvent: 'delete.selection', join: true, record: true };
  const one = first.lines.from === last.lines.from;
  // All of the text of the blocks from the first to the last, which go whole, their syntax with
  // them, and leave one empty paragraph: of one block, or of blocks outside list items (whose
  // markers would part a list), or of the whole body (select-all).
  const covers = from <= textStart(state, first) && to >= textEnd(state, last);
  const inItem = (block: Block) => block.containers.some((c) => c.kind === 'item');
  const body = !neighbours(state, first).prev && !neighbours(state, last).next;
  if (one || (covers && ((!inItem(first) && !inItem(last)) || body))) {
    const firstLine = state.doc.lineAt(first.lines.from);
    const shared = sharedQuotes(firstLine.text, state.doc.lineAt(last.lines.from).text);
    const start = one ? from : firstLine.from + shared.length;
    const deletion: KeyEdit = {
      changes: [{ from: start, to }],
      selection: EditorSelection.single(start),
      userEvent: 'delete.selection',
    };
    if (covers) {
      // The text goes, and an empty paragraph opens: in its place with Track Changes off; with it
      // on, after the blocks' deletion, which stays: right after it at the end of the body, in
      // front of the block after it elsewhere.
      if (state.field(trackingField, false) && atBodyEnd(state, to)) {
        const cont = one ? continuation(state, first) : shared;
        if (body) {
          // All of the body: in front of the deletion, which a marker alone on its line starts,
          // and text typed after it couldn't follow. Outside any quote, which the deletion takes.
          return {
            deletion: { ...deletion, openPlain: { insert: '\n\n', down: 0, at: firstLine.from } },
            then: null,
          };
        }
        const insert = `\n${blankOf(cont)}\n${cont}`;
        return { deletion: { ...deletion, openPlain: { insert, down: 2 } }, then: null };
      }
      const then = (after: EditorState) =>
        after.field(trackingField, false) ? join(openAfterDeletion(after)) : null;
      const open: OpenRequest = { at: start, assoc: -1 };
      return { deletion: { ...deletion, open }, then };
    }
    return { deletion, then: (after) => join(planReturn(after)) };
  }
  const changes: ChangeSpec[] = [{ from, to: Math.max(from, textEnd(state, first)) }];
  const before = neighbours(state, last).prev;
  if (before && before.lines.from > first.lines.from) {
    // The blocks inside the selection go whole, with the breaks in front of them.
    changes.push({ from: first.lines.to, to: before.lines.to });
  }
  const start = textStart(state, last);
  changes.push({ from: Math.min(start, to), to });
  return {
    deletion: {
      changes,
      selection: EditorSelection.single(from),
      userEvent: 'delete.selection',
      // In front of the text after the selection, past the deletion's markers.
      caretAt: to,
    },
    then: null,
  };
}

/** The quote markers two lines start with alike, with the space after the last. */
function sharedQuotes(a: string, b: string): string {
  const quotes = (text: string) => /^(?:[ \t]*>)*[ \t]?/.exec(text)?.[0] ?? '';
  const qa = quotes(a);
  const qb = quotes(b);
  let n = 0;
  while (n < qa.length && n < qb.length && qa[n] === qb[n]) n++;
  return qa.slice(0, n);
}

/**
 * With Track Changes on, the empty paragraph beside a block whose text was all deleted, which the
 * deletion keeps, the caret in it.
 */
function openAfterDeletion(state: EditorState): KeyEdit | null {
  // Return at the start of the block after it, which opens the empty paragraph in front of the
  // deletion's line (in a break, as the format writes it plain), with the caret in it.
  const edit = planReturn(state);
  if (!edit?.open) return edit;
  const rest: KeyEdit = { ...edit, caretInOpen: true };
  delete rest.caretAt;
  return rest;
}

/** The no-break space a line holds until its first character is typed (design: Shift-Return). */
export const EMPTY_LINE_HOLD = '\u00a0';

/**
 * Shift-Return at the end of a paragraph's text: a hard break and an empty line after it, in the
 * block, the caret on it. The line holds a no-break space until the first character is typed (a
 * hard break with nothing after it is a literal backslash, and an empty line in a list would make
 * it loose); like the empty paragraph it is taken back when the caret leaves, and the file never
 * gets it. Null where the text before the caret can't take a hard break (it ends in a backslash or
 * is not text): Return's.
 */
function emptyLineAtEnd(state: EditorState, block: Block, head: number): KeyEdit | null {
  const { doc } = state;
  const line = doc.lineAt(head);
  if (head !== line.to || state.field(viewModeField, false) === 'raw') return null;
  // After a backslash, or a hard break's spaces, the new break would not read as one.
  if (/[\\ \t]$/.test(state.sliceDoc(Math.max(line.from, head - 1), head))) return null;
  const insert = `\\\n${continuation(state, block)}${EMPTY_LINE_HOLD}`;
  return {
    changes: [{ from: head, insert }],
    selection: EditorSelection.single(head + insert.length - 1),
    userEvent: 'input.break.line',
    open: { at: head, assoc: 1, down: 1, line: true },
    caretInOpen: true,
    fallback: planReturn(state) ?? undefined,
  };
}

/**
 * Backspace over the only character of the line after a hard break, at the end of a paragraph's
 * text: the line goes back to the empty line Shift-Return opened, its no-break space in the
 * character's place, since a hard break with nothing after it is a literal backslash. Null
 * elsewhere.
 */
export function lastCharOfLine(state: EditorState, block: Block, head: number): KeyEdit | null {
  const { doc } = state;
  const line = doc.lineAt(head);
  if (block.kind !== 'paragraph' || line.number < 2 || line.from <= block.text.from) return null;
  if (head < textEnd(state, block) || doc.lineAt(block.text.to).number !== line.number) return null;
  const above = doc.line(line.number - 1);
  if (!/(?<!\\)(?:\\\\)*(?:\\| {2,})$/.test(above.text)) return null;
  const char = /(\P{M}\p{M}*)$/u.exec(doc.sliceString(line.from, head))?.[1];
  if (!char || char === EMPTY_LINE_HOLD) return null;
  const from = head - char.length;
  const before = doc.sliceString(line.from, from).replace(/<!--[^]*?-->/g, '');
  if (!/^[ \t>]*$/.test(before)) return null;
  return {
    changes: [{ from, to: head, insert: EMPTY_LINE_HOLD }],
    selection: EditorSelection.single(from),
    userEvent: 'delete.backward.block',
    open: { at: from, assoc: 1, line: true },
    caretInOpen: true,
  };
}

const HEADING_ONE_LINE = 'A heading is one line in Markdown.';
const ALREADY_A_BREAK = 'There is a line break here already. Return starts a new paragraph.';

/**
 * Shift-Return at the caret (design: block editing, "Shift-Return"): in the middle of a block's
 * text a hard line break, a backslash and a line break, the next line at the block's text column;
 * at a soft line break the backslash alone, in front of the line break that is there; at a block's
 * start or end what Return does, in this stage. Refused inside a heading, which is one line. Null
 * declines: in code and front matter CodeMirror's line break.
 */
export function planShiftReturn(state: EditorState): KeyEdit | null {
  const { selection } = state;
  if (selection.ranges.length > 1 || !selection.main.empty) return null;
  const head = selection.main.head;
  const open = openBlock(state);
  if (open && head >= open.empty.from && head <= open.empty.to) return nothing(state);
  const block = blockAt(state, head);
  if (!block) return null;
  const refuse = (refusal: string): KeyEdit => ({ ...nothing(state), refusal });
  if (block.kind === 'heading') {
    // At its start or end, what Return does; inside it, refused.
    const inside = head > textStart(state, block) && head < textEnd(state, block);
    return inside ? refuse(HEADING_ONE_LINE) : planReturn(state);
  }
  // In front of a block that takes no text, and at an HTML block's end: what Return does.
  if (['code', 'table', 'html'].includes(block.kind) && head === block.text.from) {
    return planReturn(state);
  }
  if (block.kind !== 'paragraph') return block.kind === 'html' ? planReturn(state) : null;
  const start = textStart(state, block);
  const end = textEnd(state, block);
  if (head <= start) return planReturn(state);
  if (head >= end) return emptyLineAtEnd(state, block, head) ?? planReturn(state);
  const { doc } = state;
  const line = doc.lineAt(head);
  // Right before only hidden text that ends the line (the marker of a pending deletion, `alph‸<del
  // a>⏎`) is the soft break's end as well: the backslash goes behind the marker, in front of the
  // break, where the format writes it as the change that takes the break and the word after it
  // (#248). In front of the marker it would be a line break typed in the middle of the text.
  if ((head === line.to || onlyHidden(state, head, line.to)) && line.to < block.text.to) {
    // At a soft line break: the backslash makes it a hard one.
    const brk = line.to;
    if (hardBreakAt(state, block, brk)) return refuse(ALREADY_A_BREAK);
    const next = doc.line(line.number + 1);
    const text = next.from + (/^[ \t>]*/.exec(next.text)?.[0].length ?? 0);
    // After the hard break, however the format writes the backslash (a line break is never in a
    // marker's payload as it is).
    return {
      changes: [{ from: brk, insert: '\\' }],
      selection: EditorSelection.single(text + 1),
      userEvent: 'input.break.line',
      caretAfterText: { from: brk, text: '\\\n' },
    };
  }
  // Right next to a hard break already: a second one would be a paragraph, which Return makes.
  if (hardBreakAt(state, block, head)) return refuse(ALREADY_A_BREAK);
  // At the start of a line after a soft line break: that break becomes a hard one.
  if (
    line.from > block.text.from &&
    head <= line.from + (/^[ \t>]*/.exec(line.text)?.[0].length ?? 0)
  ) {
    const above = doc.line(line.number - 1);
    return {
      changes: [{ from: above.to, insert: '\\' }],
      selection: EditorSelection.single(head + 1),
      userEvent: 'input.break.line',
      caretAfterText: { from: above.to, text: '\\\n' },
    };
  }
  // Never inside an atom or a code span, where a line break reads as a space: after it.
  let at = head;
  const parted = openConstructs(state, head).find((c) => c.kind === 'atom' || c.kind === 'code');
  if (parted) at = parted.to;
  const insert = `\\\n${continuation(state, block)}`;
  return {
    changes: [{ from: at, insert }],
    selection: EditorSelection.single(at + insert.length),
    userEvent: 'input.break.line',
  };
}
