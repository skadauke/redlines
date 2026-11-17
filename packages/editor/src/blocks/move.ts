// Moving blocks (format §3.14): ⌥↑ and ⌥↓ move the paragraph, item or block the caret is in, or the
// blocks a selection covers, one place among their siblings; a drag moves them to a drop line
// (`drag.ts`). Both are one edit, written by the format: tracked with Track Changes on (a deletion
// at the old place and an insertion at the new, one group, or a widened replacement where those can't
// be written), plain with it off, and one step to undo.

import { isolateHistory } from '@codemirror/commands';
import { ChangeSet, EditorSelection, type EditorState, Transaction } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import {
  type BlockGap,
  type BlockRun,
  blockRunAt,
  EditError,
  moveBlockEdits,
  neighbourGap,
  newestView,
  Untrackable,
} from '@redlines/format';
import type { Range, TextChange } from '@redlines/format';
import {
  markupViewFacet,
  parsedField,
  setViewModeEffect,
  trackedEditAnnotation,
  viewModeField,
} from '../tracked/field.ts';
import { heldEditEffect, untrackedAnswerAnnotation, untrackedAskFacet } from '../tracked/ask.ts';
import { openBlock, setOpenEffect, takeBackChanges } from './open.ts';
import {
  authoredWrite,
  contextFor,
  refusedEditEffect,
  trackingField,
  untrackedWrite,
} from '../tracked/typing.ts';
import { plainIntent, recordedAs, type Unnamed } from '../tracked/intent.ts';
import type { MoveIntent } from './move-intent.ts';
import { writeMove } from './move-intent.ts';
import type { TypingIntent } from '../tracked/intent.ts';

/** The run the selection names, with Raw and several selections excluded. */
export function runOfSelection(state: EditorState): BlockRun | undefined {
  if (state.field(viewModeField, false) === 'raw') return undefined;
  if (state.selection.ranges.length > 1) return undefined;
  const { from, to } = state.selection.main;
  return blockRunAt(state.doc.toString(), { from, to });
}

/** The file's state and the changes that took the open paragraph back (`asFile`). */
export type FileRead = { file: EditorState; back: ChangeSet | null };

/**
 * The state as the file has it, with the empty paragraph that Return opened taken back, and the
 * changes that take it back; the state itself, with none, where nothing is open. Null where the
 * caret is in the empty paragraph itself, which is no block of the file and has nothing to move.
 */
export function asFile(state: EditorState): { file: EditorState; back: ChangeSet | null } | null {
  const open = openBlock(state);
  if (!open) return { file: state, back: null };
  const { from, to } = state.selection.main;
  if (open.empty.from <= from && to <= open.empty.to) return null;
  const back = takeBackChanges(state, true);
  if (!back) return { file: state, back: null };
  const file = state.update({
    changes: back,
    selection: state.selection.map(back),
    effects: [setOpenEffect.of(null)],
    filter: false,
  }).state;
  return { file, back };
}

/** Why the blocks at the selection can't move up or down, or undefined when they can. */
export function moveBlocksReason(state: EditorState, up: boolean): string | undefined {
  const read = asFile(state);
  if (!read) return 'An empty paragraph has nothing to move. Type in it first.';
  const run = runOfSelection(read.file);
  if (!run) return 'Put the caret in a paragraph, a list item or a block.';
  if (neighbourGap(run, up)) return undefined;
  const many = run.count > 1;
  return `${many ? 'These blocks are' : 'This block is'} at the ${up ? 'top' : 'bottom'} already.`;
}

/**
 * ⌥↑ and ⌥↓: moves the blocks one place. False in Raw and with several selections; at the edge it
 * does nothing. The empty paragraph Return opened is no block of the file: with the caret in the
 * block Return was pressed in, the move takes it back, in the same step, and moves the block as the
 * file has it (#872); with the caret in the empty paragraph there is nothing to move.
 */
export function moveBlocks(view: EditorView, up: boolean): boolean {
  const read = asFile(view.state);
  if (!read) return true;
  const run = runOfSelection(read.file);
  if (!run) return false;
  const gap = neighbourGap(run, up);
  // Nothing above the first or below the last: the command is disabled (`moveBlocksReason` says why),
  // and the key does nothing, with no notice.
  if (!gap) return true;
  return moveRunTo(view, run, gap, read);
}

/** Moves `run` to `gap` and keeps it selected, as it was (a caret stays at its place in the text). */
export function moveRunTo(
  view: EditorView,
  run: BlockRun,
  gap: BlockGap,
  read?: FileRead,
): boolean {
  // The state the run is read in: the file's, with an empty paragraph taken back (`asFile`), and
  // the changes that did it, which the step makes first.
  const state = read?.file ?? view.state;
  const back = read?.back ?? null;
  const text = state.doc.toString();
  const tracking = state.field(trackingField);
  let changes: ChangeSet;
  let moved: Range;
  let intent: Unnamed<MoveIntent | TypingIntent>;
  let untracked = !tracking;
  let asking = TOO_MANY_BLOCKS;
  try {
    if (tracking) {
      try {
        const ctx = contextFor(state);
        const done = writeMove(text, {
          run,
          gap,
          ...(back ? { revert: changesOf(back) } : {}),
          author: ctx.author,
          time: ctx.time,
          ...(ctx.dialect === undefined ? {} : { dialect: ctx.dialect }),
          ...(ctx.random ? { random: ctx.random } : {}),
        });
        if (!done) return false;
        changes = ChangeSet.of(done.changes, state.doc.length);
        moved = done.moved;
        intent = done.intent;
      } catch (error) {
        if (!(error instanceof Untrackable)) throw error;
        // Not even the widened write holds it: the person is asked, and the move is made untracked
        // (design: widen, alert or disable, §3.1), never refused.
        untracked = true;
        if (error.reason !== 'too-large') asking = NOT_MARKABLE;
        const plain = plainMove(state, text, run, gap, true);
        if (!plain) return false;
        ({ changes, moved, intent } = plain);
      }
    } else {
      const plain = plainMove(state, text, run, gap);
      if (!plain) return false;
      ({ changes, moved, intent } = plain);
    }
  } catch (error) {
    if (error instanceof EditError) {
      const message = error.message;
      view.dispatch({ effects: refusedEditEffect.of(message) });
      return true;
    }
    throw error;
  }
  const after = changes.apply(state.doc).toString();
  const selection = selectionAfter(state, after, run, moved);
  // The move as it was asked and written; the open paragraph taken back is part of the step.
  const recorded = recordedAs(
    intent.kind === 'typing' && back ? { ...intent, revert: changesOf(back) } : intent,
  );
  const annotations = [trackedEditAnnotation.of(true), isolateHistory.of('full'), recorded];
  // From the document as it was (the open paragraph in it): taken back, then moved, in one step.
  const whole = back ? back.compose(changes) : changes;
  if (tracking && untracked) {
    const asker = state.facet(untrackedAskFacet);
    if (asker) {
      // Held for the sheet: Make Edit makes the same move without tracking, Cancel drops it.
      view.dispatch({
        effects: heldEditEffect.of({
          reason: 'accept-pending',
          words: { title: asking },
          doc: view.state.doc,
          changes: whole,
          selection,
          annotations: [Transaction.userEvent.of('move.block'), ...annotations],
          effects: back ? [setOpenEffect.of(null)] : [],
          scrollIntoView: true,
        }),
      });
      return true;
    }
    annotations.push(untrackedAnswerAnnotation.of(true));
  }
  view.dispatch({
    changes: whole,
    selection,
    userEvent: 'move.block',
    annotations,
    effects: [
      ...(tracking && !untracked && state.field(viewModeField) === 'clean'
        ? [setViewModeEffect.of(state.facet(markupViewFacet))]
        : []),
      ...(back ? [setOpenEffect.of(null)] : []),
    ],
    scrollIntoView: true,
  });
  return true;
}

/** The sheet's question for a move that no tracked write holds. */
const TOO_MANY_BLOCKS =
  'This move reaches too many blocks to be tracked. Make it without tracking?';

/** The sheet's question for a move whose pending marks would read otherwise than the move (two lists
 * that it brings side by side are one list in the text, two in the file with a marker between). */
const NOT_MARKABLE = 'Marks would read this move otherwise than it is. Make it without tracking?';

/** The move as plain edits, in offsets of the text (none when the run is no longer there). */
function plainMove(
  state: EditorState,
  text: string,
  run: BlockRun,
  gap: BlockGap,
  forced = false,
): { changes: ChangeSet; moved: Range; intent: Unnamed<TypingIntent> } | undefined {
  const plan = moveBlockEdits(text, run, gap);
  if (!plan) return undefined;
  if (plan.verbatim) {
    // The file's own text with its markers, taken out and put in again: written as it is, never
    // through the writers of typed text (they refuse markup).
    const changes = ChangeSet.of(plan.edits, state.doc.length);
    return { changes, moved: plan.moved, intent: plainIntent(state, changes) };
  }
  const written = (forced ? untrackedWrite : authoredWrite)(
    state,
    text,
    state.field(parsedField),
    plan.edits,
  );
  return { changes: written.changes, moved: plan.moved, intent: written.intent };
}

/** The changes of a set, as the edits an intent records. */
function changesOf(set: ChangeSet): TextChange[] {
  const out: TextChange[] = [];
  set.iterChanges((from, to, _a, _b, inserted) =>
    out.push({ from, to, insert: inserted.toString() }),
  );
  return out;
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
  if (anchor === head) return EditorSelection.single(place(head));
  return EditorSelection.single(place(anchor), place(head));
}
