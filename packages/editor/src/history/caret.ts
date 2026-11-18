// Where the caret goes when an agent's step is taken back or brought back: where it changed, so
// that the person sees what went or came back (docs/superpowers/specs/
// 2026-11-10-agents-undo-and-allow-design.md, One ⌘Z after a run). Neither CodeMirror's caret for
// a redo, where it was at ⌘Z, nor the step's own start selection says that, and an undo runs no
// transaction filter that would move the caret out of hidden text.

import { EditorSelection, type EditorState, type Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
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
 * A caret that is inside a table's hidden syntax (the `\n| ` before a row's first cell) goes to the
 * nearer end of it (walk seed 270 of `REDLINES_FUZZ=300`: an undo that took an agent's paragraph
 * back, above a table, put the caret in front of the table's first cell).
 */
function outOfTableSyntax(state: EditorState, selection: EditorSelection): EditorSelection {
  // The table's hidden syntax is a state field's atomic ranges (`table/stops.ts`, which this
  // file can't import); the sources are read through a view that is only its state.
  const sources = state.facet(EditorView.atomicRanges);
  const stub = { state } as unknown as EditorView;
  return EditorSelection.create(
    selection.ranges.map((range) => {
      if (!range.empty) return range;
      const at = range.head;
      let moved = at;
      for (const source of sources) {
        for (let it = source(stub).iter(at - 1); it.value; it.next()) {
          if (it.from < at && at < it.to) moved = at - it.from <= it.to - at ? it.from : it.to;
          if (it.from >= at) break;
        }
      }
      return EditorSelection.cursor(moved);
    }),
    selection.mainIndex,
  );
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
  if (first !== null) {
    return outOfTableSyntax(state, visibleSelection(state, EditorSelection.single(first)));
  }
  const thread = repliedThread(tr.startState.field(parsedField), after);
  const segment = thread && after.marks.find((mark) => mark.id === thread)?.segments[0];
  if (segment) {
    return visibleSelection(state, EditorSelection.single(openerRange(segment).to));
  }
  return state.selection;
}
