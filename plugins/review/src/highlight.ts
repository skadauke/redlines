// The Highlight command (format §2.2): a reviewer's highlight on the selection, or on the word under
// the caret, and taking it away again, from one key. Where the selection or caret is in a highlight
// already, the command removes it, as accepting does: it is dismissed and the text stays.

import type { EditorState } from '@codemirror/state';
import {
  markupViewFacet,
  parsedField,
  pastHidden,
  refusedEditEffect,
  setViewModeEffect,
  viewModeField,
} from '@redlines/editor';
import {
  addHighlight,
  EditError,
  type MarkRange,
  type Parsed,
  type Range,
  type Segment,
} from '@redlines/format';
import { applyEdit, editContext, openerEnd, type ReviewContext } from './shared.ts';

/** What the person is told when no text is there to highlight. */
const NO_TEXT = 'Select some text to highlight.';

/** What a highlight in Raw says: its markers are text there, and no highlight is drawn. */
const REFUSED_IN_RAW =
  "A highlight can't be made or removed in Raw. Switch to Redlines to do either.";

/** The highlights of each parse, which the menu and the palette ask about at every change. */
const highlightsOf = new WeakMap<Parsed, readonly MarkRange[]>();

function highlightMarks(parsed: Parsed): readonly MarkRange[] {
  let found = highlightsOf.get(parsed);
  if (!found) {
    found = parsed.marks.filter((mark) => mark.kind === 'hl');
    highlightsOf.set(parsed, found);
  }
  return found;
}

/**
 * Whether the selection `from`–`to` is in a stretch of a highlight. A caret is in it from the start of
 * the opener to the end of the closer, which is at the word the highlight is on, as the markers are
 * hidden: a caret at either end of the word is in it. A selection is in it when it has some of its
 * text, so that one that only ends where the highlight starts is not.
 */
function inSegment(segment: Segment, from: number, to: number): boolean {
  const { close } = segment;
  if (!close) return false;
  if (from === to) return segment.open.from <= from && from <= close.to;
  return from < close.from && openerEnd(segment) < to;
}

/**
 * The highlights that the selection or caret is inside of, or that the selection overlaps, in
 * document order: the ones the command removes, and that a menu shows as on. None in Raw, where
 * the command does neither, and none in a state without the editor's fields, such as the empty one
 * that a menu asks for a title (`baseTitle`).
 */
export function highlightsAt(state: EditorState): readonly MarkRange[] {
  const parsed = state.field(parsedField, false);
  if (!parsed || state.field(viewModeField, false) === 'raw') return [];
  const { from, to } = state.selection.main;
  return highlightMarks(parsed).filter((mark) =>
    mark.segments.some((segment) => inSegment(segment, from, to)),
  );
}

/** The command's title: it takes the highlight away where there is one, and makes one elsewhere. */
export function highlightTitle(state: EditorState): string {
  return highlightsAt(state).length > 0 ? 'Remove Highlight' : 'Highlight';
}

/**
 * What a new highlight is on: the selection, or else the word under the caret (on screen, a caret
 * beside a hidden marker is at the end of the word past it), or else nothing.
 */
function highlightTarget(state: EditorState): Range | null {
  const { from, to, empty, head } = state.selection.main;
  if (!empty) return { from, to };
  const word =
    state.wordAt(head) ??
    state.wordAt(pastHidden(state, head, true)) ??
    state.wordAt(pastHidden(state, head, false));
  return word ? { from: word.from, to: word.to } : null;
}

/**
 * Makes a highlight on the selection or on the word under the caret, or, where the selection or
 * caret is in a highlight or overlaps one, removes those. Both are one step to undo. Returns
 * whether it did something: Raw takes no highlight and says so, as a comment is refused there, and
 * so is a selection with no text to highlight, or one that the format refuses, in its words, all
 * through the editor's `onNotice`.
 *
 * A highlight shows only in the markup views, so a document shown Clean switches to the one chosen
 * last first, as it does for a comment and for a tracked change: the person sees what they did.
 */
export function toggleHighlight(ctx: ReviewContext): boolean {
  const { view } = ctx.editor;
  const { state } = view;
  const mode = state.field(viewModeField);
  const refuse = (message: string) => {
    view.dispatch({ effects: refusedEditEffect.of(message) });
    return false;
  };
  if (mode === 'raw') return refuse(REFUSED_IN_RAW);
  const found = highlightsAt(state);
  try {
    if (found.length > 0) {
      // Accepting a highlight dismisses it and leaves the text, all of them in one step to undo.
      ctx.editor.accept(found.map((mark) => mark.id));
    } else {
      const target = highlightTarget(state);
      if (!target) return refuse(NO_TEXT);
      const { changes } = addHighlight(state.doc.toString(), target, editContext(ctx.author));
      applyEdit(view, changes, 'review.highlight');
    }
  } catch (error) {
    if (!(error instanceof EditError)) throw error;
    return refuse(error.message);
  }
  // After the format has agreed, so that a refusal leaves the view as it was.
  if (mode === 'clean') {
    view.dispatch({ effects: setViewModeEffect.of(view.state.facet(markupViewFacet)) });
  }
  return true;
}
