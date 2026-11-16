// Moving blocks (format §3.14): ⌥↑ and ⌥↓ move the paragraph, item or block the caret is in, or the
// blocks a selection covers, one place among their siblings; a drag moves them to a drop line
// (`drag.ts`). Both are one edit, written by the format: tracked with Track Changes on (a deletion
// at the old place and an insertion at the new, one group, or a widened replacement where those can't
// be written), plain with it off, and one step to undo.

import { isolateHistory } from '@codemirror/commands';
import { ChangeSet, EditorSelection, type EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import {
  type BlockGap,
  type BlockRun,
  blockRunAt,
  EditError,
  moveBlockEdits,
  neighbourGap,
  newestView,
  trackedBlockMove,
  Untrackable,
} from '@redlines/format';
import type { Range } from '@redlines/format';
import {
  markupViewFacet,
  parsedField,
  setViewModeEffect,
  trackedEditAnnotation,
  viewModeField,
} from '../tracked/field.ts';
import {
  authoredChanges,
  contextFor,
  refusedEditEffect,
  trackingField,
} from '../tracked/typing.ts';

/** The run the selection names, with Raw and several selections excluded. */
export function runOfSelection(state: EditorState): BlockRun | undefined {
  if (state.field(viewModeField, false) === 'raw') return undefined;
  if (state.selection.ranges.length > 1) return undefined;
  const { from, to } = state.selection.main;
  return blockRunAt(state.doc.toString(), { from, to });
}

/** Why the blocks at the selection can't move up or down, or undefined when they can. */
export function moveBlocksReason(state: EditorState, up: boolean): string | undefined {
  const run = runOfSelection(state);
  if (!run) return 'Put the caret in a paragraph, a list item or a block.';
  if (neighbourGap(run, up)) return undefined;
  const many = run.count > 1;
  return `${many ? 'These blocks are' : 'This block is'} at the ${up ? 'top' : 'bottom'} already.`;
}

/** ⌥↑ and ⌥↓: moves the blocks one place. False in Raw and with several selections; at the edge it
 * says so. */
export function moveBlocks(view: EditorView, up: boolean): boolean {
  const run = runOfSelection(view.state);
  if (!run) return false;
  const gap = neighbourGap(run, up);
  if (!gap) {
    view.dispatch({
      effects: refusedEditEffect.of(
        up ? 'The block is at the top.' : 'The block is at the bottom.',
      ),
    });
    return true;
  }
  return moveRunTo(view, run, gap);
}

/** Moves `run` to `gap` and keeps it selected, as it was (a caret stays at its place in the text). */
export function moveRunTo(view: EditorView, run: BlockRun, gap: BlockGap): boolean {
  const { state } = view;
  const text = state.doc.toString();
  let changes: ChangeSet;
  let moved: Range;
  try {
    if (state.field(trackingField)) {
      const done = trackedBlockMove(text, run, gap, contextFor(state));
      if (!done) return false;
      changes = ChangeSet.of(done.changes, state.doc.length);
      moved = done.moved;
    } else {
      const plan = moveBlockEdits(text, run, gap);
      if (!plan) return false;
      changes = authoredChanges(state, text, state.field(parsedField), plan.edits);
      moved = plan.moved;
    }
  } catch (error) {
    if (error instanceof EditError || error instanceof Untrackable) {
      view.dispatch({
        effects: refusedEditEffect.of(
          error instanceof EditError
            ? error.message
            : 'This move reaches too many blocks to be tracked. Turn off Track Changes to move it.',
        ),
      });
      return true;
    }
    throw error;
  }
  const after = changes.apply(state.doc).toString();
  view.dispatch({
    changes,
    selection: selectionAfter(state, after, run, moved),
    userEvent: 'move.block',
    annotations: [trackedEditAnnotation.of(true), isolateHistory.of('full')],
    effects:
      state.field(trackingField) && state.field(viewModeField) === 'clean'
        ? [setViewModeEffect.of(state.facet(markupViewFacet))]
        : [],
    scrollIntoView: true,
  });
  return true;
}

/** The selection once the move is made: the moved blocks, selected as the person had them (a caret
 * where it stood in their text), in offsets of the text `after`. */
function selectionAfter(
  state: EditorState,
  after: string,
  run: BlockRun,
  moved: Range,
): EditorSelection {
  const before = newestView(state.doc.toString());
  const next = newestView(after);
  const { anchor, head } = state.selection.main;
  // At the end of the moved text, in front of the closers that end it, never inside them.
  const place = (offset: number) => {
    const view = Math.min(
      moved.to,
      moved.from + Math.max(0, before.map.fromSource(offset) - run.viewFrom),
    );
    return next.map.toSource(view, view === moved.to ? -1 : 1);
  };
  if (anchor === head) return EditorSelection.cursor(place(head));
  return EditorSelection.single(place(anchor), place(head));
}
