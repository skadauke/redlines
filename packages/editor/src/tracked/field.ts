// The tracked-change layer's state (design §5.3, §5.5): the parse of the document, how it is
// shown, and who is editing. Format calls run on the LF text that CodeMirror holds, so the parse's
// offsets are CodeMirror positions.

import { Annotation, Facet, StateEffect, StateField } from '@codemirror/state';
import { isDecidable, type MarkRange, type Parsed, parse } from '@redlines/format';
import type { Author, MetPerson, ViewMode } from '../api.ts';

/**
 * Marks a transaction the tracked layer has dealt with: an edit of the author's, tracked or plain,
 * or a decision on a change. Track Changes leaves it as it is, and the caret moves out of hidden
 * text after it.
 */
export const trackedEditAnnotation = Annotation.define<boolean>();

/** The person editing. Their marks take the first author color. */
export const authorFacet = Facet.define<Author, Author | null>({
  combine: (values) => values[0] ?? null,
});

/**
 * The people this machine has met, with their colors (design §5.5), when the host keeps them;
 * null otherwise, and then colors come from handles alone.
 */
export const peopleFacet = Facet.define<readonly MetPerson[], readonly MetPerson[] | null>({
  combine: (values) => values[0] ?? null,
});

/**
 * Whether an inserted or a deleted line break shows its mark, a small pilcrow (¶), in Redlines
 * (design §5.5). Hidden, as by default, the change bar still marks its line.
 */
export const lineBreakMarksFacet = Facet.define<boolean, boolean>({
  combine: (values) => values[0] ?? false,
});

/**
 * The parse of the document. Each parse hands the previous one to the next, so a ledger whose
 * text didn't change isn't read again on every keystroke.
 */
export const parsedField = StateField.define<Parsed>({
  create: (state) => parse(state.doc.toString()),
  update: (parsed, tr) => (tr.docChanged ? parse(tr.newDoc.toString(), parsed) : parsed),
});

/**
 * Where the body ends when the ledger ends the file, as it should: the ledger is hidden, and so
 * is the line break after it, but CodeMirror still has an empty last line there, where the caret
 * or typing would land after the ledger. Null when the file has no ledger at its end.
 */
export function bodyEnd(parsed: Parsed): number | null {
  const ledger = parsed.ledgerRange;
  return ledger && !parsed.text.slice(ledger.to).trim() ? ledger.from : null;
}

/**
 * Whether a document has redlines (design §5.3): pending changes, format changes among them,
 * highlights or comment threads. Marks this version doesn't draw, such as table rows, don't count.
 */
export function hasRedlines(parsed: Parsed): boolean {
  return (
    parsed.ledger.comments.length > 0 ||
    parsed.marks.some((mark) => isDrawnChange(mark) || mark.kind === 'hl' || mark.kind === 'cmt')
  );
}

/**
 * Whether the editor draws a mark as a change: an insertion, a deletion, a substitution, an
 * inserted line break (a split, format §3.4), the two halves of a move included, or a format
 * change that accept and reject decide. Table row and column marks, and format changes with
 * operations this version can't undo, are kept as written, with their markers hidden, but this
 * version doesn't draw them.
 */
export function isDrawnChange(mark: MarkRange): boolean {
  if (mark.kind === 'sub' || mark.kind === 'split') return true;
  if (mark.kind === 'fmt') return isDecidable(mark);
  if (mark.kind === 'ins') return mark.payload === undefined;
  return mark.kind === 'del' && !/^(?:row|col)=/.test(mark.payload ?? '');
}

/**
 * Whether the editor lists and decides a mark as a change, in the review bar, its counts and the
 * cards: a change it draws, except the halves of a move (format §5.2), which v0.1 doesn't accept or
 * reject.
 */
export function isChange(mark: MarkRange): boolean {
  return isDrawnChange(mark) && mark.entry.move === undefined;
}

export const setViewModeEffect = StateEffect.define<ViewMode>();

/**
 * How the document is shown. It starts in Redlines when the document has redlines and in Clean
 * when it doesn't (design §5.3), and after that it stays as chosen: Redlines is available whatever
 * the document holds, so one whose last redline goes stays in it. The one exception is a document
 * that gains redlines while it is shown Clean, as when an agent's suggestions arrive, which
 * switches to Redlines, so suggestions are never invisible.
 */
export const viewModeField = StateField.define<ViewMode>({
  create: (state) => (hasRedlines(state.field(parsedField)) ? 'redlines' : 'clean'),
  update(mode, tr) {
    const chosen = tr.effects.findLast((effect) => effect.is(setViewModeEffect));
    if (chosen) return chosen.value;
    if (!tr.docChanged || mode !== 'clean') return mode;
    const gained =
      hasRedlines(tr.state.field(parsedField)) && !hasRedlines(tr.startState.field(parsedField));
    return gained ? 'redlines' : mode;
  },
});
