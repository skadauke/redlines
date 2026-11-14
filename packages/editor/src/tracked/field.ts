// The tracked-change layer's state (design §5.3, §5.5): the parse of the document, how it is
// shown, and who is editing. Format calls run on the LF text that CodeMirror holds, so the parse's
// offsets are CodeMirror positions.

import { Annotation, Compartment, Facet, StateEffect, StateField } from '@codemirror/state';
import { isDecidable, type MarkRange, type Parsed, parse } from '@redlines/format';
import type { Author, MarkupView, MenuView, MetPerson, ViewMode } from '../api.ts';

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
 * The look of Redlines chosen last, the full markup or the simple look, which the editor shows
 * where it picks Redlines for you (design: Which look, when).
 */
export const markupViewFacet = Facet.define<MarkupView, MarkupView>({
  combine: (values) => values[0] ?? 'redlines',
});

/**
 * Where the markup view lives in a state. One compartment serves every editor: it is only a key.
 */
export const markupViewCompartment = new Compartment();

/**
 * The view a View menu lists for a mode (design §5.3): Redlines for both of its looks, so Simple,
 * which is a look and no view of its own, is Redlines to a menu.
 */
export function menuViewOf(mode: ViewMode): MenuView {
  return mode === 'simple' ? 'redlines' : mode;
}

/**
 * What choosing a look or a view does, as effects for one transaction: shows it, and when it is
 * Simple or Redlines makes it the markup view (the look chosen last) too. The review bar and the
 * automatic switches dispatch `setViewModeEffect` alone, because they don't choose.
 */
export function chooseViewEffects(mode: ViewMode): StateEffect<unknown>[] {
  const effects: StateEffect<unknown>[] = [setViewModeEffect.of(mode)];
  if (mode === 'simple' || mode === 'redlines') {
    effects.push(markupViewCompartment.reconfigure(markupViewFacet.of(mode)));
  }
  return effects;
}

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
 * highlights or comment threads. Marks this version doesn't draw, such as table columns, don't count.
 */
export function hasRedlines(parsed: Parsed): boolean {
  return (
    parsed.ledger.comments.length > 0 ||
    parsed.marks.some((mark) => isDrawnChange(mark) || mark.kind === 'hl' || mark.kind === 'cmt')
  );
}

/**
 * The check change a marker's text names: `+check` is a box checked, `-check` one unchecked (also
 * `-check=X`). The one test for a box's point mark, as the format writes it (format §2.6).
 */
export function boxChange(markerText: string): '+' | '-' | null {
  const sign = /([+-])check\b/.exec(markerText)?.[1];
  return sign === '+' || sign === '-' ? sign : null;
}

/**
 * Whether the editor draws a mark as a change: an insertion, a deletion, a substitution, an
 * inserted line break (a split, format §3.4), the two halves of a move included, or a format
 * change that accept and reject decide, and an inserted table row or column and a deleted one
 * (format §3.7). Format changes with operations this version can't undo are kept as written, with
 * their markers hidden, but this version doesn't draw them.
 */
export function isDrawnChange(mark: MarkRange): boolean {
  if (mark.kind === 'sub' || mark.kind === 'split') return true;
  if (mark.kind === 'fmt') return isDecidable(mark);
  if (mark.kind === 'ins') {
    return mark.payload === undefined || mark.payload === 'row' || mark.payload === 'col';
  }
  if (mark.kind === 'del') return true;
  return false;
}

/** A deleted row of a table (format §3.7), kept below it and drawn as a ghost row at its place. */
export function isRowDeletion(mark: MarkRange): boolean {
  return mark.kind === 'del' && /^row=/.test(mark.payload ?? '');
}

/** A deleted column of a table (format §3.7), kept below it and drawn as a ghost cell in each row. */
export function isColDeletion(mark: MarkRange): boolean {
  return mark.kind === 'del' && /^col=/.test(mark.payload ?? '');
}

/** A deleted row or column, which is drawn as ghosts and never as deleted text. */
export const isTableDeletion = (mark: MarkRange): boolean =>
  isRowDeletion(mark) || isColDeletion(mark);

/** An inserted column of a table (format §3.7): the marker in its header cell. */
export const isColInsertion = (mark: MarkRange): boolean =>
  mark.kind === 'ins' && mark.payload === 'col';

/**
 * Whether the editor lists and decides a mark as a change, in the review bar, its counts and the
 * cards: a change it draws, except the halves of a move (format §5.2), which v0.1 doesn't accept or
 * reject.
 */
export function isChange(mark: MarkRange): boolean {
  // A move of a row or column is one change, the row or column at its new place: its old place is its
  // ghost.
  if (isTableDeletion(mark)) return mark.entry.move === undefined;
  if (mark.kind === 'ins' && (mark.payload === 'row' || mark.payload === 'col')) return true;
  return isDrawnChange(mark) && mark.entry.move === undefined;
}

export const setViewModeEffect = StateEffect.define<ViewMode>();

/**
 * Marks an edit whose switch from Clean waits: the empty line Shift-Return opens holds the view
 * until the first character is typed (blocks/shift-line.ts), since the line goes again if the
 * caret leaves.
 */
export const holdViewAnnotation = Annotation.define<boolean>();

/**
 * How the document is shown. It starts in the view its ledger says it was saved in (`view`, format
 * §5.6), or else in Redlines, in the look chosen last (the markup view), when the document has
 * redlines and in Clean when it doesn't (design §5.3), and after that it stays as chosen: Redlines
 * is available whatever the document holds, so one whose last redline goes stays in it. The one
 * exception is a document that gains redlines while it is shown Clean, as when an agent's
 * suggestions arrive, which switches to Redlines in that look, so suggestions are never invisible.
 */
export const viewModeField = StateField.define<ViewMode>({
  create: (state) => {
    const parsed = state.field(parsedField);
    if (parsed.ledger.view) return parsed.ledger.view;
    return hasRedlines(parsed) ? state.facet(markupViewFacet) : 'clean';
  },
  update(mode, tr) {
    const chosen = tr.effects.findLast((effect) => effect.is(setViewModeEffect));
    if (chosen) return chosen.value;
    if (!tr.docChanged || mode !== 'clean' || tr.annotation(holdViewAnnotation)) return mode;
    const gained =
      hasRedlines(tr.state.field(parsedField)) && !hasRedlines(tr.startState.field(parsedField));
    return gained ? tr.state.facet(markupViewFacet) : mode;
  },
});
