// Tab and Shift-Tab in list items (design: block editing, "Tab and Shift-Tab; numbered sublists").
// Tab anywhere in an item indents it under the item above it, with its nested items; Shift-Tab
// outdents it. Each is the format's block change (`trackedFormat`, `untrackedFormat`), which with
// Track Changes on writes `<!--fmt … was=indent=N-->`, and on an item that is all your own pending
// insertion edits its text and writes no mark. What the format refuses (the first item of a list,
// a list with too many pending changes to check) is said in its words.
//
// `planTab` decides by the block at the caret and returns null where it isn't in a list item, so
// that the keys of other kinds of block (code, tables) can be tried beside it.

import { type ChangeSpec, EditorSelection, type EditorState } from '@codemirror/state';
import { EditError, type FormatOp } from '@redlines/format';
import { blockFormatChanges, trackingField } from '../tracked/typing.ts';
import { authorFacet, parsedField } from '../tracked/field.ts';
import { EMPTY_ITEM, unsoundEmptyItem } from './empty-item.ts';
import { type Item, itemsAround, type KeyEdit, nothing } from './edits.ts';
import { openBlock, recordField } from './open.ts';
import { type Block, blockAt } from './structure.ts';

/** The innermost list item that a paragraph block is in, with the text position that stands for it. */
function itemOf(state: EditorState, block: Block, pos: number) {
  if (block.kind !== 'paragraph' || block.containers.at(-1)?.kind !== 'item') return null;
  const item = itemsAround(state, block)[0];
  if (!item) return null;
  // The first paragraph of the item takes the position as it is, in its text; a later paragraph
  // stands for the item by the start of its first paragraph's text, where the format finds it.
  const first = block.lines.from <= item.line.to && block.lines.to >= item.line.from;
  const mark = item.node.getChild('ListMark');
  const at = first
    ? Math.min(Math.max(pos, block.text.from), block.text.to)
    : Math.min(item.line.to, (mark?.to ?? item.line.from) + 1);
  return { item, at };
}

const FIRST_ITEM = "The first item of a list can't be indented: there is no item to put it under.";
const THEIR_SPLIT =
  "Another person's pending change made this item. Accept or reject it before indenting or outdenting it.";
const NOT_UNDER_TEXT =
  "An empty item can't be indented under a line of text in Markdown. Type in it first.";

/**
 * A plain edit of an empty item's line, with the caret kept in place. With Track Changes on the
 * edit is final, as it stands, no typing: of the break of the item's own pending split, or of a
 * line no reader sees the indentation of.
 */
function planned(
  state: EditorState,
  changes: ChangeSpec[],
  more: Partial<KeyEdit> = {},
  item?: Item,
): KeyEdit {
  const { head } = state.selection.main;
  // Another person's pending split made the break: its prefix is theirs, and the tracked layer
  // takes no edit of it until their change is decided, so it is refused, in words.
  const me = state.facet(authorFacet)?.handle;
  const theirs =
    item !== undefined &&
    item.line.number > 1 &&
    state
      .field(parsedField)
      .marks.some(
        (mark) =>
          mark.kind === 'split' &&
          mark.entry.by !== me &&
          mark.segments.some((g) => g.open.to === state.doc.line(item.line.number - 1).to),
      );
  if (theirs) return { ...nothing(state), userEvent: 'indent', refusal: THEIR_SPLIT };
  return {
    changes,
    selection: EditorSelection.single(state.changes(changes).mapPos(head, 1)),
    userEvent: 'indent',
    caretAt: head,
    ...(state.field(trackingField, false) ? { final: true } : {}),
    ...more,
  };
}

/**
 * Tab or Shift-Tab in an empty item, which has no text for the format to write a change around:
 * the item's marker line takes the indentation of its sibling above, or of its parent, as the line
 * of an item that was typed would. Where Track Changes is on, that is the break of the item's own
 * pending split, and no mark. A numbered item that becomes the first of a new sublist is `1.`.
 */
function planEmptyItem(state: EditorState, item: Item, outdent: boolean): KeyEdit {
  const { doc } = state;
  const mark = item.node.getChild('ListMark');
  if (!mark) return nothing(state);
  const line = item.line;
  const head = state.selection.main.head;
  if (outdent) {
    const parent = itemsAround(state, blockAt(state, head)!)[1];
    if (!parent) return { ...nothing(state), userEvent: 'indent' };
    const changes: ChangeSpec[] = [{ from: line.from, to: mark.from, insert: parent.indent }];
    // An open item that moves out is an ordinary item again, and Backspace right after puts it
    // back, open.
    return planned(state, changes, openBlock(state)?.item ? { record: true } : {}, item);
  }
  let before = item.node.prevSibling;
  while (before && before.name !== 'ListItem') before = before.prevSibling;
  const above = before?.getChild('ListMark');
  if (!before || !above) return { ...nothing(state), userEvent: 'indent', refusal: FIRST_ITEM };
  // The sibling's text column: its marker and the spaces after it, as many as CommonMark counts.
  const aboveLine = doc.lineAt(above.from);
  const spaces = /^[ \t]*/.exec(aboveLine.text.slice(above.to - aboveLine.from))?.[0].length ?? 0;
  const column = above.to - aboveLine.from + Math.max(1, Math.min(spaces, 4));
  const indentation = ' '.repeat(Math.max(0, column - (mark.from - line.from)));
  // A numbered item that opens a sublist is numbered 1, as the format writes it; after items of a
  // numbered sublist it keeps its number.
  const number = /^\d+/.exec(item.marker)?.[0];
  const renumber = number && number !== '1' && !before.getChild('OrderedList');
  const changes: ChangeSpec[] = [
    renumber
      ? { from: mark.from, to: mark.from + number.length, insert: `${indentation}1` }
      : { from: mark.from, insert: indentation },
  ];
  // Under a line of text Markdown has no such item: it is open, as an empty paragraph is, if the
  // person's own Return just made it; otherwise refused.
  const found = EMPTY_ITEM.exec(line.text);
  if (
    found &&
    unsoundEmptyItem(doc, line.number, found[1]!, found[2]!.length + indentation.length, found[3]!)
  ) {
    const made = state.field(recordField, false)?.at(-1)?.caret === head;
    if (!made) return { ...nothing(state), userEvent: 'indent', refusal: NOT_UNDER_TEXT };
    return planned(state, changes, { open: { at: head, assoc: 1, item: true } }, item);
  }
  return planned(state, changes, {}, item);
}

/** Whether the item is nested in another one. */
const nested = (state: EditorState, block: Block) => itemsAround(state, block).length > 1;

/**
 * Tab (`outdent` false) or Shift-Tab in a list item, or over a selection that touches items: the
 * format's block change of each, in one step. Null where the caret isn't in a list item.
 */
export function planTab(state: EditorState, outdent: boolean): KeyEdit | null {
  const { selection } = state;
  if (selection.ranges.length > 1) return null;
  const { from, to, anchor, head } = selection.main;
  const start = blockAt(state, from);
  const end = from === to ? start : blockAt(state, to);
  if (!start || !end) return null;
  const first = itemOf(state, start, from);
  const last = itemOf(state, end, to);
  if (!first || !last) return null;
  // Shift-Tab in a top-level item does nothing.
  if (outdent && !nested(state, start) && !nested(state, end)) return nothing(state);
  // An empty item has no text for the format to write a change around: its line is edited.
  const only = from === to && first.item.node === last.item.node;
  if (only && start.text.from >= start.text.to && start.lines.from === first.item.line.from) {
    return planEmptyItem(state, first.item, outdent);
  }
  const op: FormatOp = { kind: 'indent', by: outdent ? -1 : 1 };
  const range = { from: Math.min(first.at, from), to: Math.max(last.at, to) };
  let changes;
  try {
    changes = blockFormatChanges(state, range, op);
  } catch (error) {
    if (!(error instanceof EditError)) throw error;
    return { ...nothing(state), userEvent: 'indent', refusal: error.message };
  }
  if (!changes.length) return { ...nothing(state), userEvent: 'indent' };
  const kept = from === to ? { caretAt: head } : { range: { anchor, head } };
  return {
    changes,
    selection: EditorSelection.single(head),
    userEvent: 'indent',
    final: true,
    ...kept,
  };
}
