// Accept All Changes and Stop Tracking (design §5.7): accepts the pending changes of the whole
// document, or of the selection, and turns Track Changes off, as one step that Undo takes back.

import { invertedEffects, isolateHistory } from '@codemirror/commands';
import { type EditorState, Transaction } from '@codemirror/state';
import { acceptAll, changesIn, type MarkRange, type Person } from '@redlines/format';
import { parsedField, trackedEditAnnotation } from './tracked/field.ts';
import { recordedAs } from './tracked/intent.ts';
import { seenOf } from './tracked/review-intent.ts';
import { trackingField, trackingStepEffect } from './tracked/typing.ts';

/**
 * The changes the command accepts: with a caret, all of the document's that Accept All decides;
 * with a selection, those it touches, whole suggestions and table changes included (`changesIn`).
 * The command is enabled exactly when there are some.
 */
export function changesToAccept(state: EditorState): MarkRange[] {
  const parsed = state.field(parsedField, false);
  if (!parsed) return [];
  const { from, to } = state.selection.main;
  return changesIn(parsed, from === to ? undefined : { from, to });
}

/**
 * What the history keeps to give Track Changes back with the text: the inverse of a switch that
 * is part of a step swaps what it sets and what it gives back (`trackingStepEffect`). A switch
 * alone writes nothing and is no step (`Editor.setTracking`).
 */
export const trackingBack = invertedEffects.of((tr) => {
  const step = tr.effects.findLast((effect) => effect.is(trackingStepEffect));
  return step ? [trackingStepEffect.of({ set: step.value.back, back: step.value.set })] : [];
});

/**
 * The transaction that accepts `changesToAccept` and turns Track Changes off, or null when that
 * would change nothing. With `who` it is recorded as a decision of the ids at the click, so that a
 * window that applies it to newer text decides the marks that still stand.
 * @throws EditError when the format can't write the decision.
 */
export function acceptAndStop(state: EditorState, who?: { author: Person; time: string }) {
  const ids = new Set(changesToAccept(state).map((mark) => mark.id));
  if (!ids.size) return null;
  const changes = acceptAll(state.doc.toString(), (mark) => ids.has(mark.id));
  if (!changes.length) return null;
  return state.update({
    changes,
    effects: trackingStepEffect.of({ set: false, back: state.field(trackingField) }),
    annotations: [
      trackedEditAnnotation.of(true),
      isolateHistory.of('full'),
      Transaction.userEvent.of('accept'),
      // Kept as the click's decision: the ids it had, as they looked, each decided on its own.
      ...(who
        ? [
            recordedAs({
              kind: 'review',
              op: {
                op: 'decide',
                decision: 'accept',
                ids: [...ids],
                seen: seenOf(state.doc.toString(), [...ids]),
                many: true,
                bulk: true,
              },
              author: who.author,
              time: who.time,
              drawn: [],
            }),
          ]
        : []),
    ],
  });
}
