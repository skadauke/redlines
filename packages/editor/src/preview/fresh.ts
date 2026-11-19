// The image a paste or a drop has just added, which the preview draws while the caret is at its end.
// The preview draws an image only while the caret is off its link, and a paste leaves the caret at the
// end of what it pasted, where it may have nowhere else to be (the end of a file that ends with its
// ledger, a table's last cell). So the link just added is drawn all the same until the caret moves or
// anything is written: the exception is for the caret as the paste left it, and for no other.

import { StateEffect, StateField } from '@codemirror/state';

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
