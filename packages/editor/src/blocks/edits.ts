// What the block keys write (design: block editing, the matrix). Each key is a pure function of the
// state that gives plain edits of the text, which the tracked layer then records through the
// format's trackedEdit or untrackedEdit as typing is recorded, and where the caret and the empty
// paragraph go; or null to decline, so that CodeMirror's own key runs.
//
// A new block always gets a blank line above and below it, whatever the file's habit, so that no
// new block is read into its neighbour. The blocks around it keep their spacing.

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

/** Return in the open empty paragraph. */
function returnInOpen(state: EditorState, head: number): KeyEdit | null {
  const open = openBlock(state);
  if (!open || head < open.empty.from || head > open.empty.to) return null;
  const { doc } = state;
  const line = doc.lineAt(open.empty.from);
  const syntax = line.text;
  // At the top level: nothing (Markdown keeps no second empty paragraph).
  if (!/>/.test(syntax)) return nothing(state);
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
  if (block.containers.some((container) => container.kind === 'item')) return null;
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
