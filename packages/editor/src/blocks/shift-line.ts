// The empty line Shift-Return opens at a block's end (design: block editing, "Shift-Return"): a
// hard break and a line that holds a no-break space, so that the caret has a line to be on. The
// first character typed replaces the space; the line is taken back, with the break, when the caret
// leaves it (`open.ts`), and the file never gets it.

import { EditorSelection, EditorState, Prec, type Transaction } from '@codemirror/state';
import type { Annotation } from '@codemirror/state';
import {
  markupViewFacet,
  setViewModeEffect,
  trackedEditAnnotation,
  viewModeField,
} from '../tracked/field.ts';
import { trackingField } from '../tracked/typing.ts';
import { EMPTY_LINE_HOLD } from './edits.ts';
import { openBlock } from './open.ts';

/** A transaction's annotations (CodeMirror reads them by type only; a transaction keeps a list). */
function annotationsOf(tr: Transaction): Annotation<unknown>[] {
  return [
    ...((tr as unknown as { annotations?: readonly Annotation<unknown>[] }).annotations ?? []),
  ];
}

/**
 * Text typed (or composed) on the empty line replaces its no-break space: the change is widened to
 * cover it, before the tracked layer writes it, which then sees text that replaces your own
 * pending insertion. Typing a character is what makes the split a change worth a card, so the
 * view that Shift-Return held in Clean switches to the markup view now.
 */
const replaceHold = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || !tr.isUserEvent('input.type')) return tr;
  const start = tr.startState;
  const open = openBlock(start);
  const { main } = start.selection;
  if (!open?.line || !main.empty || start.selection.ranges.length > 1) return tr;
  if (main.head < open.empty.from || main.head > open.empty.to) return tr;
  if (tr.annotation(trackedEditAnnotation)) return tr;
  // One insertion at the caret, next to the space.
  let insert: string | null = null;
  let single = true;
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, text) => {
    if (fromA !== main.head || toA !== main.head || insert !== null) single = false;
    insert = text.toString();
  });
  if (!single || !insert) return tr;
  const at =
    start.sliceDoc(main.head, main.head + 1) === EMPTY_LINE_HOLD
      ? main.head
      : start.sliceDoc(main.head - 1, main.head) === EMPTY_LINE_HOLD
        ? main.head - 1
        : -1;
  if (at < 0) return tr;
  const toMarkup =
    start.field(trackingField, false) && start.field(viewModeField, false) === 'clean'
      ? [setViewModeEffect.of(start.facet(markupViewFacet))]
      : [];
  return {
    changes: { from: at, to: at + 1, insert },
    selection: EditorSelection.cursor(at + (insert as string).length),
    effects: [...tr.effects, ...toMarkup],
    annotations: annotationsOf(tr),
    scrollIntoView: tr.scrollIntoView,
  };
});

/** Typing on the empty line replaces its no-break space. Below the tracked layer's filter. */
export const emptyLineTyping = Prec.low(replaceHold);
