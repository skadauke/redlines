// The block keys (design: block editing, "Mechanism"): a keymap above the editor's others, in Clean
// and Redlines only (Raw keeps CodeMirror's and lang-markdown's keys). Each key plans its edit
// (`edits.ts`) and `applyKeyEdit` dispatches it as one step to undo, with the user event the
// tracked layer records it by, the record of Returns and the empty paragraph it opens.

import { isolateHistory } from '@codemirror/commands';
import { Annotation, EditorSelection, EditorState, type Extension, Prec } from '@codemirror/state';
import { type Command, type EditorView, keymap } from '@codemirror/view';
import { setViewModeEffect, trackedEditAnnotation, viewModeField } from '../tracked/field.ts';
import { refusedEditEffect, trackingField } from '../tracked/typing.ts';
import { type KeyEdit, planReturn, planSelectionReturn, planShiftReturn } from './edits.ts';
import { nextTextStart, planBackspace, planDelete } from './joins.ts';
import {
  closeOpen,
  openAnnotation,
  type OpenRequest,
  requestedLine,
  returnAnnotation,
  takeBack,
} from './open.ts';

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
      // After the line's container syntax, in front of any markers on it.
      const line = requestedLine(tr, caret.inOpen);
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
  if (edit.close && closeOpen(view, edit.selection)) return true;
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
  if (edit.final) {
    // A block change as the format wrote it: final, markers and all. Made in Clean, it shows in
    // Redlines, as typing's tracked changes do.
    annotations.push(trackedEditAnnotation.of(true));
    const before = view.state.doc;
    const tracked = view.state.field(trackingField, false);
    view.dispatch({
      changes: edit.changes,
      userEvent: edit.userEvent,
      annotations,
      scrollIntoView: true,
    });
    if (tracked && view.state.doc !== before && view.state.field(viewModeField) === 'clean') {
      view.dispatch({ effects: setViewModeEffect.of('redlines') });
    }
    return true;
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

/**
 * Shift-Return: a hard line break in a block's text (`planShiftReturn`). Over a selection, the
 * selection goes as typing deletes it, then the hard break, in one step to undo.
 */
const shiftReturnKey = blockKey((view) => {
  const { main } = view.state.selection;
  if (!main.empty) {
    if (view.state.selection.ranges.length > 1) return false;
    const before = view.state.doc;
    // Deleted as typing deletes it, a join across blocks.
    applyKeyEdit(view, {
      changes: [{ from: main.from, to: main.to }],
      selection: EditorSelection.single(main.from),
      userEvent: 'delete.selection',
      isolateBefore: true,
    });
    if (view.state.doc.eq(before)) return true;
    // Named as the deletion is, which the history joins it to; kept in the record of Returns.
    const then = planShiftReturn(view.state);
    if (then)
      applyKeyEdit(view, { ...then, userEvent: 'delete.selection', join: true, record: true });
    return true;
  }
  const edit = planShiftReturn(view.state);
  return edit ? applyKeyEdit(view, edit) : false;
});

/**
 * Backspace right after a Return takes it back, from the record; at a block's edge it acts on
 * blocks (`planBackspace`); otherwise CodeMirror's. Option- and Command-Backspace act as it at an
 * edge, and are CodeMirror's inside the text.
 */
const backspaceKey = blockKey((view) => {
  if (takeBack(view)) return true;
  const edit = planBackspace(view.state);
  return edit ? applyKeyEdit(view, edit) : false;
});

/**
 * Delete in an empty block right after the Return that opened it takes the Return back; at a
 * block's end it joins the next block (`planDelete`); otherwise CodeMirror's.
 */
const deleteKey = blockKey((view) => {
  if (takeBack(view, 'delete.forward.block', nextTextStart)) return true;
  const edit = planDelete(view.state);
  return edit ? applyKeyEdit(view, edit) : false;
});

/** The block keys, above the editor's other keymaps. */
export function blockKeys(): Extension {
  return [
    Prec.highest(
      keymap.of([
        { key: 'Enter', run: returnKey },
        // Option-Return is Return, and Option-Shift-Return Shift-Return: no line break goes in
        // that the block keys don't write.
        { key: 'Alt-Enter', run: returnKey },
        { key: 'Shift-Enter', run: shiftReturnKey },
        { key: 'Alt-Shift-Enter', run: shiftReturnKey },
        { key: 'Backspace', run: backspaceKey },
        { key: 'Alt-Backspace', run: backspaceKey },
        { key: 'Mod-Backspace', run: backspaceKey },
        { key: 'Delete', run: deleteKey },
        { key: 'Alt-Delete', run: deleteKey },
      ]),
    ),
    keyCaret,
  ];
}
