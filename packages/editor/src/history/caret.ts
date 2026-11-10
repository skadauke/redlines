// Where the caret goes when an agent's step is taken back or brought back: where it changed, so
// that the person sees what went or came back (docs/superpowers/specs/
// 2026-11-10-agents-undo-and-allow-design.md, One ⌘Z after a run). Neither CodeMirror's caret for
// a redo, where it was at ⌘Z, nor the step's own start selection says that, and an undo runs no
// transaction filter that would move the caret out of hidden text.

import { EditorSelection, type Transaction } from '@codemirror/state';
import { openerRange, type Parsed, type Thread } from '@redlines/format';
import { visibleSelection } from '../tracked/decorations.ts';
import { bodyEnd, parsedField } from '../tracked/field.ts';

const sameReplies = (a: Thread, b: Thread) =>
  a.replies.length === b.replies.length &&
  a.replies.every((reply, i) => {
    const other = b.replies[i]!;
    return reply.id === other.id && reply.text === other.text;
  });

/** The first thread of `after` whose replies differ in `before`, by id. */
function repliedThread(before: Parsed, after: Parsed): string | null {
  const was = new Map(before.ledger.comments.map((thread) => [thread.id, thread]));
  for (const thread of after.ledger.comments) {
    const old = was.get(thread.id);
    if (old && !sameReplies(old, thread)) return thread.id;
  }
  return null;
}

/**
 * Where the caret goes when an agent's step is taken back or brought back (`tr`, that undo or redo,
 * as made with the step's own start selection): at the start of its first change in the body, moved
 * out of hidden text (`visibleSelection`); for a step that changed only the ledger, at the start of
 * the anchor (`openerRange(segment).to`) of the first thread whose replies differ; else as `tr` has it.
 */
export function agentCaret(tr: Transaction): EditorSelection {
  const { state } = tr;
  const after = state.field(parsedField, false);
  if (!after) return state.selection;
  const end = bodyEnd(after) ?? after.ledgerRange?.from ?? state.doc.length;
  let first: number | null = null;
  tr.changes.iterChangedRanges((_fromA, _toA, fromB) => {
    if (first === null && fromB < end) first = fromB;
  });
  if (first !== null) return visibleSelection(state, EditorSelection.single(first));
  const thread = repliedThread(tr.startState.field(parsedField), after);
  const segment = thread && after.marks.find((mark) => mark.id === thread)?.segments[0];
  if (segment) {
    return visibleSelection(state, EditorSelection.single(openerRange(segment).to));
  }
  return state.selection;
}
