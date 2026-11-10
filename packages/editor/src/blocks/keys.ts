// The block keys (design: block editing, "Mechanism"): a keymap above the editor's others, in Clean
// and Redlines only (Raw keeps CodeMirror's and lang-markdown's keys). Each key plans its edit
// (`edits.ts`) and `applyKeyEdit` dispatches it as one step to undo, with the user event the
// tracked layer records it by, the record of Returns and the empty paragraph it opens.

import { isolateHistory } from '@codemirror/commands';
import { Annotation, EditorSelection, EditorState, type Extension, Prec } from '@codemirror/state';
import { type Command, type EditorView, keymap } from '@codemirror/view';
import { viewModeField } from '../tracked/field.ts';
import { refusedEditEffect } from '../tracked/typing.ts';
import { type KeyEdit, planReturn, planSelectionReturn } from './edits.ts';
import { openAnnotation, type OpenRequest, returnAnnotation, takeBack } from './open.ts';

/** Where a key's caret goes, once the tracked layer has written its edits (see `KeyEdit`). */
type KeyCaret =
  { at: number } | { inOpen: OpenRequest } | { afterText: { from: number; text: string } };

const caretAnnotation = Annotation.define<KeyCaret>();

/**
 * Puts the caret where a key said, once the tracked layer has written the key's edits: in front of
 * the text that followed it, in the empty paragraph, or after the text it wrote again. CodeMirror
 * runs transaction filters from the lowest precedence up, so at the highest this one runs after the
 * typing filter.
 */
const keyCaret = Prec.highest(
  EditorState.transactionFilter.of((tr) => {
    const caret = tr.annotation(caretAnnotation);
    if (caret === undefined || !tr.docChanged) return tr;
    let pos: number;
    if ('at' in caret) pos = tr.changes.mapPos(caret.at, 1);
    else if ('inOpen' in caret) {
      const doc = tr.newDoc;
      const at = tr.changes.mapPos(caret.inOpen.at, caret.inOpen.assoc);
      // After the line's container syntax, in front of any markers on it.
      const line = doc.line(Math.max(1, doc.lineAt(at).number - (caret.inOpen.up ?? 0)));
      pos = line.from + (/^[ \t>]*/.exec(line.text)?.[0].length ?? 0);
    } else {
      const from = tr.changes.mapPos(caret.afterText.from, -1);
      const found = tr.newDoc.sliceString(from).indexOf(caret.afterText.text);
      if (found < 0) return tr;
      pos = from + found + caret.afterText.text.length;
    }
    return [tr, { selection: EditorSelection.cursor(pos), sequential: true }];
  }),
);

/**
 * Dispatches a key's edit: one step to undo, apart from the typing around it, recorded by the
 * tracked layer as its user event says, and, for a Return, kept in the record of Returns.
 */
export function applyKeyEdit(
  view: EditorView,
  edit: KeyEdit & { isolateBefore?: boolean },
): boolean {
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
  // A step that the next joins is isolated only from the step before it.
  const isolate = edit.isolateBefore ? 'before' : edit.join ? 'after' : 'full';
  const annotations: Annotation<unknown>[] = [isolateHistory.of(isolate)];
  if (edit.record ?? edit.userEvent.startsWith('input.break')) {
    annotations.push(returnAnnotation.of(true));
  }
  if (edit.open) annotations.push(openAnnotation.of(edit.open));
  if (edit.caretAt !== undefined) annotations.push(caretAnnotation.of({ at: edit.caretAt }));
  else if (edit.caretInOpen && edit.open)
    annotations.push(caretAnnotation.of({ inOpen: edit.open }));
  else if (edit.caretAfterText) {
    annotations.push(caretAnnotation.of({ afterText: edit.caretAfterText }));
  }
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
  const over = planSelectionReturn(view.state);
  if (over) {
    const before = view.state.doc;
    applyKeyEdit(view, { ...over.deletion, join: false, isolateBefore: true });
    // Refused: nothing more.
    if (view.state.doc.eq(before) || !over.then) return true;
    const then = over.then(view.state);
    if (then) applyKeyEdit(view, then);
    return true;
  }
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
