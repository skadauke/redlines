// Accept All Changes and Stop Tracking (design §5.7): accepts the pending changes of the whole
// document, or of the selection, and turns Track Changes off, as one step that Undo takes back.

import { invertedEffects, isolateHistory } from '@codemirror/commands';
import { type EditorState, Transaction } from '@codemirror/state';
import { acceptAll, type MarkRange } from '@redlines/format';
import { isChange, parsedField, trackedEditAnnotation } from './tracked/field.ts';
import { setTrackingEffect, trackingField } from './tracked/typing.ts';

/** The changes the command accepts: those the selection touches, or with a caret, all of them. */
export function changesToAccept(state: EditorState): MarkRange[] {
  const parsed = state.field(parsedField, false);
  if (!parsed) return [];
  const changes = parsed.marks.filter(isChange);
  const { from, to } = state.selection.main;
  if (from === to) return changes;
  return changes.filter((mark) => {
    const start = Math.min(...mark.segments.map((segment) => segment.open.from));
    const end = Math.max(...mark.segments.map((s) => (s.close ?? s.content).to));
    return from < end && start < to;
  });
}

/**
 * Gives Track Changes back with the text: a step that changes the text and the switch together
 * has the switch's old value as its inverse, and Redo's inverse is the new one. A switch alone
 * writes nothing and is no step (`Editor.setTracking`).
 */
export const trackingBack = invertedEffects.of((tr) =>
  tr.docChanged && tr.effects.some((effect) => effect.is(setTrackingEffect))
    ? [setTrackingEffect.of(tr.startState.field(trackingField))]
    : [],
);

/**
 * The transaction that accepts `changesToAccept` and turns Track Changes off, or null when there
 * is nothing to accept.
 * @throws EditError when the format can't write the decision.
 */
export function acceptAndStop(state: EditorState) {
  const ids = new Set(changesToAccept(state).map((mark) => mark.id));
  if (!ids.size) return null;
  const changes = acceptAll(state.doc.toString(), (mark) => ids.has(mark.id));
  return state.update({
    changes,
    effects: setTrackingEffect.of(false),
    annotations: [
      trackedEditAnnotation.of(true),
      isolateHistory.of('full'),
      Transaction.userEvent.of('accept'),
    ],
  });
}
