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
  holdViewAnnotation,
  markupViewFacet,
  parsedField,
  setViewModeEffect,
  trackedEditAnnotation,
  viewModeField,
} from '../tracked/field.ts';
import { visibleSelection } from '../tracked/decorations.ts';
import { heldEditEffect, wasHeld } from '../tracked/ask.ts';
import { refusedEditEffect, trackingField } from '../tracked/typing.ts';
import {
  type KeyEdit,
  inRoomParagraph,
  NBSP_LINE,
  planReturn,
  planSelectionReturn,
  planShiftReturn,
  returnAtEnd,
  textEnd,
  textStart,
} from './edits.ts';
import { joinsStep } from '../history/index.ts';
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
  planParagraphMotion,
  transposeCrosses,
} from './motion.ts';
import { blockAt, neighbours } from './structure.ts';
import { openIndentedLine, shapeOf, openLineSpaces, planCodeTab } from './code.ts';
import { blockDrag } from './drag.ts';
import { moveBlocks } from './move.ts';
import { planTab } from './tab.ts';
import { bareMarkerAt, pastedItems, planListPaste } from './paste.ts';
import {
  closeOpen,
  openBlock,
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
  | { afterText: { from: number; text: string } }
  | { onLine: { at: number; down: number; col: number } };

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
    else if ('onLine' in caret) {
      const line = requestedLine(tr, {
        at: caret.onLine.at,
        assoc: -1,
        down: caret.onLine.down,
      });
      pos = line.from + caret.onLine.col;
    } else if ('inOpen' in caret) {
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
    let shown = visibleSelection(tr.state, EditorSelection.single(pos)).main.head;
    // A caret at the end of a line's text, with the tracked layer's closer written at it, was
    // taken to the near end of the hidden range that the closer and the line breaks after it make:
    // the start of the next block (#508). It stays in front of the closer, on its own line.
    if ('at' in caret) {
      const before = tr.changes.mapPos(caret.at, -1);
      const line = tr.newDoc.lineAt(pos).number;
      if (before !== pos && tr.newDoc.lineAt(shown).number !== line) {
        const back = visibleSelection(tr.state, EditorSelection.single(before)).main.head;
        if (tr.newDoc.lineAt(back).number === line) shown = back;
      }
    }
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
  if (edit.join && !edit.isolateBefore) annotations.push(joinsStep.of(true));
  if (edit.record ?? edit.userEvent.startsWith('input.break')) {
    annotations.push(returnAnnotation.of(true));
  }
  if (edit.open) annotations.push(openAnnotation.of(edit.open));
  if (edit.open?.line) annotations.push(holdViewAnnotation.of(true));
  if (edit.plain) annotations.push(trackedEditAnnotation.of(true));
  if (edit.openPlain) annotations.push(openPlainAnnotation.of(edit.openPlain));
  if (edit.range) annotations.push(caretAnnotation.of({ range: edit.range }));
  else if (edit.caretBefore !== undefined) {
    annotations.push(caretAnnotation.of({ before: edit.caretBefore }));
  } else if (edit.caretAt !== undefined) annotations.push(caretAnnotation.of({ at: edit.caretAt }));
  else if (edit.caretInOpen && edit.open)
    annotations.push(caretAnnotation.of({ inOpen: edit.open }));
  else if (edit.caretOnLine) annotations.push(caretAnnotation.of({ onLine: edit.caretOnLine }));
  else if (edit.caretAfterText) {
    annotations.push(caretAnnotation.of({ afterText: edit.caretAfterText }));
  }
  if (edit.final) {
    // A block change as the format wrote it: final, markers and all. Made in Clean, it shows in
    // the markup view, as typing's tracked changes do.
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
      view.dispatch({ effects: setViewModeEffect.of(view.state.facet(markupViewFacet)) });
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
  if (edit.fallback && (wasHeld(tr) || tr.effects.some((effect) => effect.is(refusedEditEffect)))) {
    return applyKeyEdit(view, edit.fallback);
  }
  view.dispatch(tr);
  return true;
}

/**
 * A paste of list items into a list item (`planListPaste`): one step to undo, a selection in the
 * item deleted first as typing deletes it. False where the paste is not that, and goes in as text.
 */
export function pasteListItems(view: EditorView, text: string): boolean {
  const pasted = pastedItems(text);
  if (!pasted) return false;
  const { state } = view;
  const { main } = state.selection;
  if (state.selection.ranges.length > 1) return false;
  /** Whether the tracked layer would refuse an edit: it is not made, and the paste goes in as text. */
  const refused = (at: EditorState, edit: KeyEdit) =>
    at
      .update({ changes: edit.changes, selection: edit.selection, userEvent: edit.userEvent })
      .effects.some((effect) => effect.is(refusedEditEffect) || effect.is(heldEditEffect));
  if (main.empty) {
    const bare = bareMarkerAt(state);
    if (bare !== null) {
      // The space after the marker first, written as it is, then the paste after it: one step.
      const space: KeyEdit & { isolateBefore?: boolean } = {
        changes: [{ from: bare, insert: ' ' }],
        selection: EditorSelection.single(bare + 1),
        userEvent: 'input.paste',
        plain: true,
        isolateBefore: true,
      };
      const after = state.update({
        changes: space.changes,
        selection: space.selection,
        annotations: trackedEditAnnotation.of(true),
      }).state;
      const planned = planListPaste(after, pasted);
      if (!planned || refused(after, planned)) return false;
      applyKeyEdit(view, space);
      const edit = planListPaste(view.state, pasted);
      if (edit) applyKeyEdit(view, { ...edit, userEvent: 'delete.selection', join: true });
      return true;
    }
    const edit = planListPaste(state, pasted);
    return edit && !refused(state, edit) ? applyKeyEdit(view, edit) : false;
  }
  // Over a selection: planned on the text without it first, so that nothing is deleted for a paste
  // that then goes in as text.
  // Both ends in the text of an item (a selection over a marker or a checkbox is text's way).
  const inText = (pos: number) => {
    const block = blockAt(state, pos);
    return (
      block?.kind === 'paragraph' &&
      block.containers.at(-1)?.kind === 'item' &&
      pos >= textStart(state, block) &&
      pos <= Math.max(textEnd(state, block), textStart(state, block))
    );
  };
  if (!inText(main.from) || !inText(main.to)) return false;
  const deletion: KeyEdit = {
    changes: [{ from: main.from, to: main.to }],
    selection: EditorSelection.single(main.from),
    // Named as the paste is, which the history joins it to.
    userEvent: 'input.paste',
  };
  if (refused(state, deletion)) return false;
  const without = state.update({ ...deletion, changes: deletion.changes }).state;
  const planned = planListPaste(without, pasted);
  if (!planned || refused(without, planned)) return false;
  const before = state.doc;
  applyKeyEdit(view, { ...deletion, isolateBefore: true });
  // Refused: nothing more.
  if (view.state.doc.eq(before)) return true;
  const edit = planListPaste(view.state, pasted);
  // Named as a deletion, which the history joins to the step before it (only typing and deletions
  // join); the step keeps the name of the first, Paste. The plan was made on the text without the
  // selection above, and no shape the sweeps try (every selection of the swept lists, Track Changes on and
  // off) plans differently after the real deletion: a plan that is gone is a bug, which is reported, not a paste to lose.
  // The text goes in rather than lose the paste.
  if (!edit) console.error('A list paste that planned before its deletion has no plan after it');
  const at = view.state.selection.main.head;
  applyKeyEdit(view, {
    ...(edit ?? {
      changes: [{ from: at, insert: text }],
      selection: EditorSelection.single(at + text.length),
    }),
    userEvent: 'delete.selection',
    join: true,
  });
  return true;
}

/** A key that acts in Clean and Redlines, and leaves Raw to CodeMirror. */
function blockKey(run: Command): Command {
  return (view) => view.state.field(viewModeField, false) !== 'raw' && run(view);
}

/**
 * Takes the open empty line back, from the record or, with none, as leaving it does, the caret at
 * the end of the text above. False when it can't go.
 */
function takeBackEmptyLine(view: EditorView): boolean {
  // The Return after it joins its step: one step to undo.
  if (takeBack(view, 'delete.selection', undefined, 'before')) return true;
  const { doc } = view.state;
  const open = openBlock(view.state);
  if (!open) return false;
  const above = doc.line(doc.lineAt(open.empty.from).number - 1);
  const syntax = /(?:\\| {2,})$/.exec(above.text)?.[0].length ?? 0;
  return closeOpen(view, EditorSelection.single(above.to - syntax));
}

const returnKey = blockKey((view) => {
  // In the open empty item Markdown can't hold at its level: out one level, where it can.
  const open = openBlock(view.state);
  const { main } = view.state.selection;
  if (open?.item && main.empty && main.head >= open.empty.from && main.head <= open.empty.to) {
    const out = planTab(view.state, true);
    if (out) return applyKeyEdit(view, out);
  }
  if (open?.line && main.empty && main.head >= open.empty.from && main.head <= open.empty.to) {
    // On the empty line Shift-Return opened: that is taken back, and Return opens an empty
    // paragraph below the block (two steps: replacing the line break in one edit would leave the
    // split pending).
    if (!takeBackEmptyLine(view)) return true;
    const again = planReturn(view.state);
    return again
      ? applyKeyEdit(view, { ...again, userEvent: 'delete.selection', join: true, record: true })
      : true;
  }
  // On the open line that Return at the end of indented code left: that Return is taken back, and
  // the key opens the empty paragraph after the code.
  const indented = main.empty ? openIndentedLine(view.state, main.head) : null;
  if (indented && takeBack(view, 'delete.selection', undefined, 'before')) {
    const code = blockAt(view.state, view.state.selection.main.head);
    const again = code && returnAtEnd(view.state, code);
    return again
      ? applyKeyEdit(view, { ...again, userEvent: 'delete.selection', join: true, record: true })
      : true;
  }
  // Return again in the empty paragraph: `&nbsp;` is typed into it, a line of room (format §3.4;
  // with Track Changes on, the paragraph is the author's insertion), and Return opens the next
  // empty paragraph below it: one step to undo.
  if (inRoomParagraph(view.state)) {
    const head = view.state.selection.main.head;
    applyKeyEdit(view, {
      changes: [{ from: head, insert: NBSP_LINE }],
      selection: EditorSelection.single(head + NBSP_LINE.length),
      userEvent: 'input.type',
      record: true,
      join: true,
      isolateBefore: true,
    });
    const then = planReturn(view.state);
    if (then) {
      applyKeyEdit(view, { ...then, userEvent: 'delete.selection', join: true, record: true });
    }
    return true;
  }
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
    // (inside a heading).
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
    // Code, display math, HTML blocks and front matter indent by their own unit.
    const code = block && planCodeTab(view.state, block, outdent);
    if (code) return applyKeyEdit(view, code);
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

/** ⇧⌥↑ and ⇧⌥↓ select by paragraph: never CodeMirror's, which move the source line. (⌥↑ and ⌥↓ move
 * the blocks, `move.ts`.) */
const paragraphKey = (forward: boolean, extend: boolean) =>
  blockKey((view) => {
    const edit = planParagraphMotion(view.state, forward, extend);
    return edit ? applyKeyEdit(view, edit) : true;
  });

/**
 * ⌥← and ⌥→ (with ⇧, selecting): by word, and at a block's edge across its break, as they cross a
 * line break in other Mac apps: the word move goes on from the end of the text above, or the start
 * of the text below, never resting in the hidden lines between. Inside the text it is CodeMirror's.
 */
const groupKey = (forward: boolean, extend: boolean) =>
  blockKey((view) => {
    const { state } = view;
    if (state.selection.ranges.length > 1) return false;
    const { anchor, head } = state.selection.main;
    const crossing = (forward ? planArrowRight : planArrowLeft)(
      state.update({ selection: EditorSelection.cursor(head) }).state,
    );
    if (!crossing) return false;
    const from = crossing.selection.main.head;
    const at = view.moveByGroup(EditorSelection.cursor(from), forward).head;
    return applyKeyEdit(view, {
      ...crossing,
      selection: extend ? EditorSelection.single(anchor, at) : EditorSelection.single(at),
    });
  });

/**
 * ⌘← and ⌃A, ⌘→, ⌃E and End: the visual line's start or end, the block's text on its first or last
 * row. End rests in front of the hidden closers that end the text, where typing leaves the caret
 * (#434): CodeMirror's End goes past them, to a place that the DOM can't tell from the start of
 * the next line, where a command that changes the text takes the caret to the next block.
 */
const lineBoundaryKey = (forward: boolean) =>
  blockKey((view) => {
    const { main } = view.state.selection;
    if (view.state.selection.ranges.length > 1) return false;
    // As CodeMirror's own line boundary keys: the layout's answer, or, where that is where the caret
    // is already (the end of a wrapped row), the end of the whole line; and the side the answer has
    // (`assoc`), which keeps the caret on the row it was moved to, not the start of the next one.
    const visual = view.lineBlockAt(main.head);
    let moved = view.moveToLineBoundary(main, forward, true);
    if (moved.head === main.head && moved.head !== (forward ? visual.to : visual.from)) {
      moved = view.moveToLineBoundary(main, forward, false);
    }
    // With no layout, or one that answers on the wrong side of the caret, the line's own end.
    let boundary = moved.head;
    const line = view.state.doc.lineAt(main.head);
    if (forward ? boundary < main.head : boundary > main.head) {
      boundary = forward ? line.to : line.from;
    }
    const pos = forward
      ? lineEndIn(view.state, main.head, boundary)
      : lineStartIn(view.state, main.head, boundary);
    const assoc = pos === moved.head ? moved.assoc : forward ? -1 : 1;
    view.dispatch({
      selection: EditorSelection.create([EditorSelection.cursor(pos, assoc)]),
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

/**
 * ↓ from the last line of the last block of the document, when it is a block with nothing after it
 * that a caret can take: a quote or an alert, code, a rule, an HTML block or a picture. It opens the
 * empty paragraph below it, as Return at its end does (and as ↓ does in a table, which Word and Docs
 * also keep one after), where the line after it would be one the block's own text goes on into: a
 * quote or a list carries on over a line with no blank line above it. Null in every other place, for
 * CodeMirror's ↓ (#514).
 */
export function planDownAtEnd(view: EditorView): KeyEdit | null {
  const { state } = view;
  const { main } = state.selection;
  if (!main.empty || state.selection.ranges.length > 1) return null;
  const block = blockAt(state, main.head);
  if (!block || block.kind === 'table') return null;
  const quoted = block.containers.some((c) => c.kind === 'quote');
  const picture =
    block.kind === 'paragraph' &&
    /^!\[[^\]]*\]\([^)]*\)\s*$/.test(state.sliceDoc(block.text.from, block.text.to));
  if (!quoted && !picture && !['code', 'rule', 'html'].includes(block.kind)) return null;
  // Code with no closing fence runs to the end of the file: a line after it is code (Return writes
  // a plain line break there). ↓ there writes the closing fence first (`closeFenceAtEnd`).
  const unclosed = block.kind === 'code' && !shapeOf(state, block).closes;
  if (unclosed && !shapeOf(state, block).opens) return null;
  // A block in an item stays with its list's keys (Return leaves it).
  if (block.containers.some((c) => c.kind === 'item')) return null;
  if (neighbours(state, block).next) return null;
  const { doc } = state;
  const last = doc.lineAt(block.lines.to);
  // On the block's last line; the lines above it are CodeMirror's.
  if (main.head < last.from) return null;
  const moved = view.moveVertically(main, true).head;
  if (moved !== main.head && moved <= last.to) return null;
  // Lines already there to go to: the file's last line break, and the lines of a gap, each a line
  // the caret can rest in once there are two (a blank one and the one to type in). The ledger's
  // gap is one line shorter, since the ledger's own line is no place for the caret.
  const parsed = state.field(parsedField, false);
  const end = parsed?.ledgerRange?.from ?? doc.length;
  const breaks = (doc.sliceString(last.to, end).match(/\n/g) ?? []).length;
  if (breaks - (end < doc.length ? 1 : 0) >= 2) return null;
  if (unclosed) {
    // The closing fence goes on the last line when that is empty (the code ends above it), and on
    // a new line under it otherwise, in the opening fence's own container syntax and indentation.
    const first = doc.lineAt(block.lines.from);
    const fence = /^[ \t>]*(`{3,}|~{3,})/.exec(first.text)?.[0] ?? '```';
    const empty = /^[ \t>]*$/.test(last.text) && last.number > first.number;
    const from = empty ? last.from : last.to;
    return {
      changes: [{ from, to: last.to, insert: (empty ? '' : '\n') + fence }],
      selection: EditorSelection.single(from + (empty ? 0 : 1) + fence.length),
      userEvent: 'input.break',
      closeFence: true,
    };
  }
  return returnAtEnd(
    state.update({ selection: EditorSelection.cursor(last.to) }).state,
    block,
    true,
  );
}

const downKey = blockKey((view) => {
  const edit = planDownAtEnd(view);
  // Code that is never closed: the closing fence, then the empty paragraph below it, one step to
  // undo (#570).
  if (!edit?.closeFence) return edit ? applyKeyEdit(view, edit) : false;
  applyKeyEdit(view, { ...edit, isolateBefore: true });
  const below = planDownAtEnd(view);
  if (below)
    applyKeyEdit(view, { ...below, userEvent: 'delete.selection', join: true, record: true });
  return true;
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
        { key: 'Alt-ArrowUp', run: blockKey((view) => moveBlocks(view, true)) },
        { key: 'Alt-ArrowDown', run: blockKey((view) => moveBlocks(view, false)) },
        { key: 'Shift-Alt-ArrowUp', run: paragraphKey(false, true) },
        { key: 'Shift-Alt-ArrowDown', run: paragraphKey(true, true) },
        { key: 'Alt-ArrowLeft', run: groupKey(false, false) },
        { key: 'Alt-ArrowRight', run: groupKey(true, false) },
        { key: 'Shift-Alt-ArrowLeft', run: groupKey(false, true) },
        { key: 'Shift-Alt-ArrowRight', run: groupKey(true, true) },
        { key: 'Tab', run: tabKey(false) },
        { key: 'Shift-Tab', run: tabKey(true) },
        { key: 'Mod-Enter', run: returnAtEndKey },
        { key: 'ArrowDown', run: downKey },
        { key: 'Shift-Mod-k', run: deleteLineKey },
        // End, as ⌘→ goes: in front of the closers that end a block's text (#434).
        { key: 'End', run: lineBoundaryKey(true) },
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
    blockDrag(),
    Prec.lowest(openLineSpaces),
  ];
}
