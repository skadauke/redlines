// The block keys (design: block editing, "Mechanism"): a keymap above the editor's others, in Clean
// and Redlines only (Raw keeps CodeMirror's and lang-markdown's keys). Each key plans its edit
// (`edits.ts`) and `applyKeyEdit` dispatches it as one step to undo, with the user event the
// tracked layer records it by, the record of Returns and the empty paragraph it opens.

import { isolateHistory } from '@codemirror/commands';
import { Annotation, EditorSelection, EditorState, type Extension, Prec } from '@codemirror/state';
import { type Command, type EditorView, keymap } from '@codemirror/view';
import { viewModeField } from '../tracked/field.ts';
import { refusedEditEffect } from '../tracked/typing.ts';
import { type KeyEdit, planReturn } from './edits.ts';
import { openAnnotation, returnAnnotation, takeBack } from './open.ts';

/** Where a key's caret goes, as a position of the text before the key that its edits leave. */
const caretAtAnnotation = Annotation.define<number>();

/**
 * Puts the caret where a key said, once the tracked layer has written the key's edits (it runs
 * after the typing filter): in front of the text that followed it.
 */
const keyCaret = Prec.lowest(
  EditorState.transactionFilter.of((tr) => {
    const at = tr.annotation(caretAtAnnotation);
    if (at === undefined || !tr.docChanged) return tr;
    return [tr, { selection: EditorSelection.cursor(tr.changes.mapPos(at, 1)), sequential: true }];
  }),
);

/**
 * Dispatches a key's edit: one step to undo, apart from the typing around it, recorded by the
 * tracked layer as its user event says, and, for a Return, kept in the record of Returns.
 */
export function applyKeyEdit(view: EditorView, edit: KeyEdit): boolean {
  if (edit.refusal) {
    view.dispatch({ effects: refusedEditEffect.of(edit.refusal) });
    return true;
  }
  if (!edit.changes.length) {
    if (!edit.selection.eq(view.state.selection)) {
      view.dispatch({ selection: edit.selection, scrollIntoView: true });
    }
    return true;
  }
  const annotations: Annotation<unknown>[] = [isolateHistory.of('full')];
  if (edit.userEvent.startsWith('input.break')) annotations.push(returnAnnotation.of(true));
  if (edit.open) annotations.push(openAnnotation.of(edit.open));
  if (edit.caretAt !== undefined) annotations.push(caretAtAnnotation.of(edit.caretAt));
  view.dispatch({
    changes: edit.changes,
    selection: edit.selection,
    userEvent: edit.userEvent,
    annotations,
    scrollIntoView: true,
  });
  return true;
}

/** A key that acts in Clean and Redlines, and leaves Raw to CodeMirror. */
function blockKey(run: Command): Command {
  return (view) => view.state.field(viewModeField, false) !== 'raw' && run(view);
}

const returnKey = blockKey((view) => {
  const edit = planReturn(view.state);
  return edit ? applyKeyEdit(view, edit) : false;
});

/** Backspace right after a Return takes it back, from the record; otherwise CodeMirror's. */
const backspaceKey = blockKey((view) => takeBack(view));

/** The block keys, above the editor's other keymaps. */
export function blockKeys(): Extension {
  return [
    Prec.highest(
      keymap.of([
        { key: 'Enter', run: returnKey },
        { key: 'Backspace', run: backspaceKey },
      ]),
    ),
    keyCaret,
  ];
}
