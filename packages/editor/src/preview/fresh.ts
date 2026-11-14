// The image a paste or a drop has just added, which the preview draws while the caret is at its end.
// The preview draws an image only while the caret is off its link, and a paste leaves the caret at the
// end of what it pasted, where it may have nowhere else to be (the end of a file that ends with its
// ledger, a table's last cell). So the link just added is drawn all the same until the caret moves or
// anything is written: the exception is for the caret as the paste left it, and for no other.

import { type EditorState, StateEffect, StateField } from '@codemirror/state';

/** The end of the link just added, set with the caret put there (`images.ts`). */
export const freshImageEffect = StateEffect.define<number>();

/** The end of the link just added, while nothing has moved the caret or changed the text since. */
export const freshImageField = StateField.define<number | null>({
  create: () => null,
  update(end, tr) {
    for (const effect of tr.effects) if (effect.is(freshImageEffect)) return effect.value;
    return tr.docChanged || tr.selection ? null : end;
  },
});

/**
 * Whether the image of the link that ends at `to` is drawn although the caret touches the link: it
 * was just added, and the caret is still a single caret at its end.
 */
export function freshlyAdded(state: EditorState, to: number): boolean {
  const end = state.field(freshImageField, false);
  const { ranges, main } = state.selection;
  return end != null && end === to && ranges.length === 1 && main.empty && main.head === end;
}
