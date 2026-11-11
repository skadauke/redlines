// The block keys (design: block editing, "Mechanism"): a keymap above the editor's others, in Clean
// and Redlines only (Raw keeps CodeMirror's and lang-markdown's keys). Each key plans its edit
// (`edits.ts`) and `applyKeyEdit` dispatches it as one step to undo, with the user event the
// tracked layer records it by, the record of Returns and the empty paragraph it opens.

import { isolateHistory } from '@codemirror/commands';
import {
  Annotation,
  EditorSelection,
  EditorState,
  type Extension,
  Prec,
  Text,
} from '@codemirror/state';
import { type Command, type EditorView, keymap } from '@codemirror/view';
import {
  bodyEnd,
  parsedField,
  setViewModeEffect,
  trackedEditAnnotation,
  viewModeField,
} from '../tracked/field.ts';
import { visibleSelection } from '../tracked/decorations.ts';
import { refusedEditEffect, trackingField } from '../tracked/typing.ts';
import { type KeyEdit, planReturn, planSelectionReturn, planShiftReturn } from './edits.ts';
import { nextTextStart, planBackspace, planDelete } from './joins.ts';
import {
  atBlockEnd,
  atTextEnd,
  blockMotion,
  lineEndIn,
  lineStartIn,
  lineText,
  planArrowLeft,
  planArrowRight,
  transposeCrosses,
} from './motion.ts';
import { blockAt } from './structure.ts';
import { planTab } from './tab.ts';
import {
  closeOpen,
  openAnnotation,
  type OpenRequest,
  requestedLine,
  returnAnnotation,
  setOpenEffect,
  takeBack,
} from './open.ts';

/** Where a key's caret goes, once the tracked layer has written its edits (see `KeyEdit`). */
type KeyCaret =
  | { at: number }
  | { before: number }
  | { range: { anchor: number; head: number } }
  | { inOpen: OpenRequest }
  | { afterText: { from: number; text: string } };

const caretAnnotation = Annotation.define<KeyCaret>();

/** The empty paragraph's line breaks at the end of the body, after the tracked edit (`KeyEdit`). */
const openPlainAnnotation = Annotation.define<{ insert: string; down: number; at?: number }>();

/**
 * Puts the caret where a key said, once the tracked layer has written the key's edits: in front of
 * the text that followed it, in the empty paragraph, or after the text it wrote again. CodeMirror
 * runs transaction filters from the lowest precedence up, so at the highest this one runs after the
 * typing filter.
 */
const keyCaret = Prec.highest(
  EditorState.transactionFilter.of((tr) => {
    const atEnd = tr.annotation(openPlainAnnotation);
    if (atEnd && tr.docChanged) {
      // After the body, as the tracked layer left it (in front of its ledger), or in front of what
      // it wrote at `at`.
      const end =
        atEnd.at !== undefined
          ? tr.changes.mapPos(atEnd.at, -1)
          : (bodyEnd(tr.state.field(parsedField)) ?? tr.newDoc.length);
      const doc = tr.newDoc.replace(end, end, Text.of(atEnd.insert.split('\n')));
      const line = doc.line(tr.newDoc.lineAt(end).number + atEnd.down);
      const caret =
        atEnd.at !== undefined ? end : line.from + (/^[ \t>]*/.exec(line.text)?.[0].length ?? 0);
      return [
        tr,
        {
          changes: { from: end, insert: atEnd.insert },
          selection: EditorSelection.cursor(caret),
          effects: setOpenEffect.of({ empty: { from: line.from, to: line.to }, pressedIn: null }),
          sequential: true,
        },
      ];
    }
    const caret = tr.annotation(caretAnnotation);
    if (caret === undefined || !tr.docChanged) return tr;
    let pos: number;
    if ('range' in caret) {
      // Each end stays with its text: the start of the selection after what is written at it, the
      // end before it.
      const { anchor, head } = caret.range;
      const forward = anchor <= head;
      const a = tr.changes.mapPos(anchor, forward ? 1 : -1);
      const h = tr.changes.mapPos(head, forward ? -1 : 1);
      const selection = visibleSelection(tr.state, EditorSelection.single(a, h));
      return [tr, { selection, sequential: true }];
    }
    if ('at' in caret) pos = tr.changes.mapPos(caret.at, 1);
    else if ('before' in caret) pos = tr.changes.mapPos(caret.before, -1);
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
    // Never inside text the caret steps over (the closer of a mark and the deletion after it).
    const shown = visibleSelection(tr.state, EditorSelection.single(pos)).main.head;
    return [tr, { selection: EditorSelection.cursor(shown), sequential: true }];
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
    // Never inside text the caret steps over.
    const selection = visibleSelection(view.state, edit.selection);
    if (!selection.eq(view.state.selection)) {
      view.dispatch({ selection, scrollIntoView: true });
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
  if (edit.plain) annotations.push(trackedEditAnnotation.of(true));
  if (edit.openPlain) annotations.push(openPlainAnnotation.of(edit.openPlain));
  if (edit.range) annotations.push(caretAnnotation.of({ range: edit.range }));
  else if (edit.caretBefore !== undefined) {
    annotations.push(caretAnnotation.of({ before: edit.caretBefore }));
  } else if (edit.caretAt !== undefined) annotations.push(caretAnnotation.of({ at: edit.caretAt }));
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
  const tr = view.state.update({
    changes: edit.changes,
    selection: edit.selection,
    userEvent: edit.userEvent,
    annotations,
    scrollIntoView: true,
  });
  // Refused, where the key has another form: that one.
  if (edit.fallback && tr.effects.some((effect) => effect.is(refusedEditEffect))) {
    return applyKeyEdit(view, edit.fallback);
  }
  view.dispatch(tr);
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
/** A key edit that changes nothing, to carry a refusal. */
const nothingAt = (state: EditorState): KeyEdit => ({
  changes: [],
  selection: state.selection,
  userEvent: 'input.break.line',
});

const shiftReturnKey = blockKey((view) => {
  const { main } = view.state.selection;
  if (!main.empty) {
    if (view.state.selection.ranges.length > 1) return false;
    const before = view.state.doc;
    // Refused whole, before anything is deleted, where the line break would be refused after it
    // (inside a heading, in a table cell).
    const deleted = view.state.update({
      changes: [{ from: main.from, to: main.to }],
      selection: EditorSelection.single(main.from),
    }).state;
    const refusal = planShiftReturn(deleted)?.refusal;
    if (refusal) return applyKeyEdit(view, { ...nothingAt(view.state), refusal });
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

/** The kinds of block in which Tab does nothing, and keeps the focus in the document. */
const TAB_DOES_NOTHING = new Set(['paragraph', 'heading', 'rule', 'definition']);

/**
 * Tab and Shift-Tab: in a list item the item moves (`planTab`); in a paragraph, a heading or a
 * quote nothing does, and the focus stays in the document, as in a word processor, with Escape and
 * then Tab (CodeMirror's `tabFocusMode`, which keydown handles before any key) or ⇧⌥M to leave.
 * The blocks that give Tab a meaning of their own (code, tables, front matter) decline here.
 */
const tabKey = (outdent: boolean) =>
  blockKey((view) => {
    if (view.state.selection.ranges.length > 1) return false;
    const edit = planTab(view.state, outdent);
    if (edit) return applyKeyEdit(view, edit);
    const block = blockAt(view.state, view.state.selection.main.head);
    return !!block && TAB_DOES_NOTHING.has(block.kind);
  });

/**
 * Indents or outdents the list items at the selection, as Tab and Shift-Tab do (the Paragraph
 * menu's Indent and Outdent, ⌘] and ⌘[). False where the selection isn't in a list item.
 */
export function indentItems(view: EditorView, outdent: boolean): boolean {
  const edit = planTab(view.state, outdent);
  return edit ? applyKeyEdit(view, edit) : false;
}

/** A key that only moves the caret, as `plan` says, or declines. */
const motionKey = (plan: (state: EditorState) => KeyEdit | null) =>
  blockKey((view) => {
    const edit = plan(view.state);
    return edit ? applyKeyEdit(view, edit) : false;
  });

/** ⌘← and ⌃A, ⌘→ and ⌃E: the visual line's start or end, the block's text on its first or last row. */
const lineBoundaryKey = (forward: boolean) =>
  blockKey((view) => {
    const { main } = view.state.selection;
    if (view.state.selection.ranges.length > 1) return false;
    const boundary = view.moveToLineBoundary(main, forward, true).head;
    const pos = forward
      ? lineEndIn(view.state, main.head, boundary)
      : lineStartIn(view.state, main.head, boundary);
    view.dispatch({
      selection: EditorSelection.cursor(pos),
      userEvent: 'select',
      scrollIntoView: true,
    });
    return true;
  });

/** ⌃K and ⌘⌦ at the end of a block's text act as Delete; elsewhere CodeMirror's. */
const deleteAtEndKey = blockKey((view) => atTextEnd(view.state) && deleteKey(view));

/** ⌘Return: Return at the end of the block (Word's page break has no Markdown form). */
const returnAtEndKey = blockKey((view) => {
  const atEnd = atBlockEnd(view.state);
  const edit = atEnd && planReturn(atEnd);
  return edit ? applyKeyEdit(view, edit) : false;
});

/** ⌃O: Return, with the caret left where it was. */
const openLineKey = blockKey((view) => {
  const edit = planReturn(view.state);
  if (!edit) return false;
  const rest: KeyEdit = { ...edit };
  delete rest.caretAt;
  delete rest.caretInOpen;
  delete rest.caretAfterText;
  return applyKeyEdit(view, { ...rest, caretBefore: view.state.selection.main.head });
});

/** ⇧⌘K: the line's text in its block goes, not its line break. */
const deleteLineKey = blockKey((view) => {
  const text = lineText(view.state);
  if (!text) return false;
  if (text.from < text.to) {
    view.dispatch({ changes: text, userEvent: 'delete.line', scrollIntoView: true });
  }
  return true;
});

/** ⌃L: selects the line's text in its block, not its line break. */
const selectLineKey = blockKey((view) => {
  const text = lineText(view.state);
  if (!text) return false;
  view.dispatch({ selection: EditorSelection.single(text.from, text.to), userEvent: 'select' });
  return true;
});

/** ⌃T: nothing across a line break, which would join two blocks. */
const transposeKey = blockKey((view) => transposeCrosses(view.state));

/**
 * The block keys' commands by the Mac key that runs them, for tests, which run where CodeMirror's
 * `mac` bindings don't apply.
 */
export const macBlockCommands: Readonly<Record<string, Command>> = {
  'Ctrl-h': backspaceKey,
  'Ctrl-d': deleteKey,
  'Ctrl-k': deleteAtEndKey,
  'Cmd-Delete': deleteAtEndKey,
  'Ctrl-o': openLineKey,
  'Ctrl-l': selectLineKey,
  'Ctrl-t': transposeKey,
  'Mod-Enter': returnAtEndKey,
  'Shift-Mod-k': deleteLineKey,
};

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
        { key: 'ArrowLeft', run: motionKey(planArrowLeft) },
        { key: 'ArrowRight', run: motionKey(planArrowRight) },
        { key: 'Tab', run: tabKey(false) },
        { key: 'Shift-Tab', run: tabKey(true) },
        { key: 'Mod-Enter', run: returnAtEndKey },
        { key: 'Shift-Mod-k', run: deleteLineKey },
        // The Mac's own keys, CodeMirror's `emacsStyleKeymap` and its ⌘ line keys.
        { mac: 'Cmd-ArrowLeft', run: lineBoundaryKey(false) },
        { mac: 'Cmd-ArrowRight', run: lineBoundaryKey(true) },
        { mac: 'Ctrl-a', run: lineBoundaryKey(false) },
        { mac: 'Ctrl-e', run: lineBoundaryKey(true) },
        { mac: 'Ctrl-h', run: backspaceKey },
        { mac: 'Ctrl-d', run: deleteKey },
        { mac: 'Ctrl-k', run: deleteAtEndKey },
        { mac: 'Cmd-Delete', run: deleteAtEndKey },
        { mac: 'Ctrl-o', run: openLineKey },
        { mac: 'Ctrl-l', run: selectLineKey },
        { mac: 'Ctrl-t', run: transposeKey },
      ]),
    ),
    blockMotion({ paragraph: returnKey, line: shiftReturnKey }),
    keyCaret,
  ];
}
