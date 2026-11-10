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
import { pastHidden } from '../tracked/decorations.ts';
import { trackingField } from '../tracked/typing.ts';
import { BLANK } from './hidden.ts';
import { openBlock, type OpenRequest } from './open.ts';
import { type Block, blockAt, isGapLine, neighbours } from './structure.ts';

/** A key's edit: plain changes, where the caret goes, and what it is, for the history. */
export interface KeyEdit {
  /** Plain edits of the text, in the state's offsets. Empty for a key that only moves the caret. */
  changes: ChangeSpec[];
  /** The selection after them, in the offsets of the text they make. */
  selection: EditorSelection;
  userEvent:
    | 'input.break'
    | 'input.break.line'
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
}

/** A key that is taken and does nothing, the caret left where it is. */
function nothing(state: EditorState): KeyEdit {
  return { changes: [], selection: state.selection, userEvent: 'input.break' };
}

/** A key that only moves the caret. */
function moveTo(pos: number): KeyEdit {
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
const blankOf = (cont: string) => cont.replace(/[ \t]+$/, '');

/** The start of a block's text, past the hidden markers in front of it. */
const textStart = (state: EditorState, block: Block) => pastHidden(state, block.text.from, true);

/** The end of a block's text, before the hidden markers after it. */
const textEnd = (state: EditorState, block: Block) => pastHidden(state, block.text.to, false);

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
interface Item {
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
function itemsAround(state: EditorState, block: Block): Item[] {
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
function nextMarker(state: EditorState, item: Item): string {
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
function retype(line: Line, upTo: number, target: string): ChangeSpec {
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
  const changes: ChangeSpec[] = [];
  let at: number;
  let caret: number;
  if (nested) {
    // It holds nested items: they go back under the item above, and the empty paragraph opens
    // after them, as taking back the Return that made it and leaving the list would give.
    changes.push({ from, to: line.to });
    const end = doc.lineAt(nested.to);
    changes.push({ from: end.to, insert });
    at = end.to;
    caret = end.to - (line.to - from) + insert.length;
    if (end.number < doc.lines && !BLANK.test(doc.line(end.number + 1).text)) {
      changes.push({ from: end.to + 1, insert: `${blankOf(cont)}\n` });
    }
  } else {
    // The next item, or block, right under it: a blank line between them too, in the same edit.
    // With Track Changes on the format refuses that one (a line break that would take the start of
    // the block below), so the empty paragraph opens right above the next item, which a bullet
    // can start under text.
    const below =
      line.number < doc.lines && !BLANK.test(doc.line(line.number + 1).text) && !tracking;
    changes.push({ from, to: line.to, insert: below ? `${insert}\n${blankOf(cont)}` : insert });
    at = line.to;
    caret = from + insert.length;
    if (below) {
      return {
        changes,
        selection: EditorSelection.single(caret),
        userEvent: 'input.break',
        open: { at, assoc: 1, up: 1 },
      };
    }
  }
  return {
    changes,
    selection: EditorSelection.single(caret),
    userEvent: 'input.break',
    open: { at, assoc: 1 },
  };
}

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
    return {
      changes: [{ from: at, insert }],
      selection: EditorSelection.single(start + insert.length),
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
  const insert = `${between}\n${sibling}`;
  return {
    changes: [{ from: head, insert }],
    selection: EditorSelection.single(head + insert.length),
    userEvent: 'input.break',
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
function returnAtEnd(state: EditorState, block: Block): KeyEdit {
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

/** Return in the middle of a block's text: two blocks of its kind, the caret at the second's start. */
function returnInMiddle(state: EditorState, block: Block, head: number): KeyEdit {
  const cont = continuation(state, block);
  const { doc } = state;
  const line = doc.lineAt(head);
  let insert: string;
  if (block.kind === 'heading' && block.setext) {
    const underline = doc.lineAt(block.lines.to);
    const mark = underline.text.slice(cont.length).trim();
    insert = `\n${cont}${mark}\n${blankOf(cont)}\n${cont}`;
  } else if (block.kind === 'heading') {
    insert = `\n${blankOf(cont)}\n${cont}${atxPrefix(block)}`;
  } else if (head === line.to && line.to < block.text.to) {
    // At a soft line break, the end of a source line inside the paragraph: the paragraph break is
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
  return {
    changes: [{ from: head, insert }],
    selection: EditorSelection.single(head + insert.length),
    userEvent: 'input.break',
  };
}

/**
 * Return: a new block (design: block editing, "The matrix"). Null declines: a selection, a list
 * item, inline syntax, a hard break, code, a table and the other blocks that take no text are
 * handled elsewhere, or by CodeMirror.
 */
export function planReturn(state: EditorState): KeyEdit | null {
  const { selection } = state;
  if (selection.ranges.length > 1 || !selection.main.empty) return null;
  const head = selection.main.head;
  const inOpen = returnInOpen(state, head);
  if (inOpen) return inOpen;
  const block = blockAt(state, head);
  if (!block) return null;
  if (block.kind !== 'paragraph' && block.kind !== 'heading') return null;
  if (block.kind === 'paragraph' && block.containers.at(-1)?.kind === 'item') {
    return returnInItem(state, block, head);
  }
  const start = textStart(state, block);
  const end = textEnd(state, block);
  const open = openBlock(state);
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
    return returnAtEnd(state, block);
  }
  return returnInMiddle(state, block, head);
}
