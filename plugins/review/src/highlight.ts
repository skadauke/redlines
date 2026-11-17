// The Highlight command (format §2.2): a reviewer's highlight on the selection, or on the word under
// the caret, and taking it away again, from one key. Where the selection lies entirely inside a
// highlight, or the caret is in one, the command removes it, as accepting does: it is dismissed and
// the text stays. A selection that overlaps a highlight, or reaches out of it, is highlighted whole.

import type { EditorState } from '@codemirror/state';
import {
  inFrontMatter,
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

/** What a highlight in Plain says: its markers are text there, and no highlight is drawn. */
const REFUSED_IN_RAW =
  "A highlight can't be made or removed in Plain. Switch to Redlines to do either.";

/** Why Highlight is disabled in Plain: its markers are text there. */
const IN_RAW_HINT = "A highlight can't be made or removed in Plain. Switch to Clean or Redlines.";
/** Why Highlight is disabled in front matter (format §3.8). */
const IN_FRONT_MATTER_HINT = "A highlight can't be made in front matter. Select text in the body.";

/**
 * Why Highlight can't run where the selection is, or undefined: in Plain, in front matter, and with no
 * text to highlight (a caret away from any word, a selection of line breaks and markers only). A
 * highlight that is there is removed, which is always possible.
 */
export function highlightDisabledReason(state: EditorState): string | undefined {
  if (state.field(viewModeField, false) === 'raw') return IN_RAW_HINT;
  if (highlightsAt(state).length > 0) return undefined;
  if (inFrontMatter(state)) return IN_FRONT_MATTER_HINT;
  const target = highlightTarget(state);
  if (!target) return NO_TEXT;
  const { from, to } = target;
  if (from === to) return NO_TEXT;
  return state
    .sliceDoc(from, to)
    .replace(/<!--[^]*?-->/g, '')
    .trim() === ''
    ? NO_TEXT
    : undefined;
}

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
 * Whether the selection lies entirely inside the highlight, from its first opener to its last closer,
 * with some of its text. A selection that reaches out of it, or that only overlaps it, is not inside.
 */
function insideMark(mark: MarkRange, from: number, to: number): boolean {
  const first = mark.segments[0];
  const last = mark.segments[mark.segments.length - 1];
  if (!first || !last?.close) return false;
  if (from < first.open.from || to > last.close.to) return false;
  return mark.segments.some((segment) => inSegment(segment, from, to));
}

/**
 * The highlights that the selection or caret is entirely inside of, in document order: the ones the
 * command removes, and that a menu shows as on. A selection that merely overlaps a highlight, or
 * reaches out of it, is in none: the command highlights it whole (format 2.2). None in Plain, where
 * the command does neither, and none in a state without the editor's fields, such as the empty one
 * that a menu asks for a title (`baseTitle`).
 */
export function highlightsAt(state: EditorState): readonly MarkRange[] {
  const parsed = state.field(parsedField, false);
  if (!parsed || state.field(viewModeField, false) === 'raw') return [];
  const { from, to } = state.selection.main;
  return highlightMarks(parsed).filter((mark) => insideMark(mark, from, to));
}

/** The command's title: it takes the highlight away where there is one, and makes one elsewhere. */
export function highlightTitle(state: EditorState): string {
  return highlightsAt(state).length > 0 ? 'Remove Highlight' : 'Highlight';
}

/**
 * The word without the underscores at its ends, or null for a word of nothing else. CodeMirror's
 * words hold `_`, which is the delimiter of `_emphasis_`: a marker would change how it flanks, and
 * at the end of the body a highlight on the word with its underscores has no place (format §3.1,
 * rule 5). The underscores inside a word (`snake_case`) stay.
 */
function withoutUnderscores(state: EditorState, word: Range): Range | null {
  const text = state.sliceDoc(word.from, word.to);
  const start = /^_*/.exec(text)?.[0].length ?? 0;
  if (start === text.length) return null;
  const end = /_*$/.exec(text)?.[0].length ?? 0;
  return { from: word.from + start, to: word.to - end };
}

/**
 * What a new highlight is on: the selection, or else the word under the caret (on screen, a caret
 * beside a hidden marker is at the end of the word past it) without the underscores of emphasis
 * around it, or else nothing.
 */
function highlightTarget(state: EditorState): Range | null {
  const { from, to, empty, head } = state.selection.main;
  if (!empty) return { from, to };
  const word =
    state.wordAt(head) ??
    state.wordAt(pastHidden(state, head, true)) ??
    state.wordAt(pastHidden(state, head, false));
  return word ? withoutUnderscores(state, { from: word.from, to: word.to }) : null;
}

/**
 * Makes a highlight on the selection or on the word under the caret, or, where the selection or
 * caret is entirely inside a highlight, removes those. Both are one step to undo. Returns
 * whether it did something: Plain takes no highlight and says so, as a comment is refused there, and
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
