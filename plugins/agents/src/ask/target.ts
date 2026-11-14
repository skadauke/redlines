// The text a question is about, kept tinted while its bubble is open (issue #324: "the selection
// stays highlighted while the bubble is open"). The keyboard is in the bubble's field, so the
// editor's own selection is drawn as an unfocused one; this is the tint that stays. The range moves
// with the text as the document changes, and is what Make Comment is made on, and nothing is
// written to the file for it.

import { type EditorState, StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView } from '@codemirror/view';

export interface TargetRange {
  from: number;
  to: number;
}

/** Sets the range, or takes it away with null. */
export const setTarget = StateEffect.define<TargetRange | null>();

export const askTarget = StateField.define<TargetRange | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setTarget)) return effect.value;
    if (!value || !tr.docChanged) return value;
    const from = tr.changes.mapPos(value.from, 1);
    const to = Math.max(from, tr.changes.mapPos(value.to, -1));
    // Text that is all gone leaves nothing to be about.
    return to > from ? { from, to } : null;
  },
  provide: (field) =>
    EditorView.decorations.compute([field], (state) => {
      const target = state.field(field);
      return target
        ? Decoration.set([Decoration.mark({ class: 'rl-qa-target' }).range(target.from, target.to)])
        : Decoration.none;
    }),
});

/** The range the open question is about, or null. */
export const targetOf = (state: EditorState): TargetRange | null =>
  state.field(askTarget, false) ?? null;
