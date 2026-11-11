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
import { authorFacet, parsedField } from '../tracked/field.ts';
import { blockFormatChanges, trackingField } from '../tracked/typing.ts';
import { type Item, itemsAround, type KeyEdit, nothing } from './edits.ts';
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

/** Whether `item` is an empty item that a pending split of the author's own made. */
function ownSplitItem(state: EditorState, item: Item): boolean {
  const me = state.facet(authorFacet)?.handle;
  if (!me || item.line.number < 2) return false;
  const above = state.doc.line(item.line.number - 1);
  return state
    .field(parsedField)
    .marks.some(
      (mark) =>
        mark.kind === 'split' &&
        mark.entry.by === me &&
        mark.segments.some((segment) => segment.open.to === above.to),
    );
}

/**
 * A plain edit of an empty item's line, with the caret kept in place. With Track Changes on the
 * edit is of the break of the item's own pending split, as it stands: final, no typing.
 */
function planned(state: EditorState, changes: ChangeSpec[]): KeyEdit {
  const { head } = state.selection.main;
  return {
    changes,
    selection: EditorSelection.single(state.changes(changes).mapPos(head, 1)),
    userEvent: 'indent',
    caretAt: head,
    ...(state.field(trackingField, false) ? { final: true } : {}),
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
    return planned(state, changes);
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
  return planned(state, changes);
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
  // An empty item that has none: its own pending split's break is edited, or with Track Changes off
  // the line is.
  const only = from === to && first.item.node === last.item.node;
  if (only && start.text.from >= start.text.to) {
    if (!state.field(trackingField, false) || ownSplitItem(state, first.item)) {
      return planEmptyItem(state, first.item, outdent);
    }
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
