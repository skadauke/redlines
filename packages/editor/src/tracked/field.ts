// The tracked-change layer's state (design §5.3, §5.5): the parse of the document, how it is
// shown, and who is editing. Format calls run on the LF text that CodeMirror holds, so the parse's
// offsets are CodeMirror positions.

import { Facet, StateEffect, StateField } from '@codemirror/state';
import { type MarkRange, type Parsed, parse } from '@redlines/format';
import type { Author, ViewMode } from '../api.ts';

/** The person editing. Their marks take the first author color. */
export const authorFacet = Facet.define<Author, Author | null>({
  combine: (values) => values[0] ?? null,
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
 * Whether a document has redlines (design §5.3): pending changes, highlights or comment threads.
 * Marks this version doesn't draw, such as format changes, don't count.
 */
export function hasRedlines(parsed: Parsed): boolean {
  return (
    parsed.ledger.comments.length > 0 ||
    parsed.marks.some((mark) => isChange(mark) || mark.kind === 'hl' || mark.kind === 'cmt')
  );
}

/**
 * Whether the editor draws and decides a mark as a change: an insertion, a deletion or a
 * substitution. Format changes, splits and table row and column marks are kept as written, with
 * their markers hidden, but this version doesn't draw them.
 */
export function isChange(mark: MarkRange): boolean {
  if (mark.kind === 'sub') return true;
  if (mark.kind === 'ins') return mark.payload === undefined;
  return mark.kind === 'del' && !/^(?:row|col)=/.test(mark.payload ?? '');
}

export const setViewModeEffect = StateEffect.define<ViewMode>();

/**
 * How the document is shown. It starts in Redlines when the document has redlines and in Clean
 * when it doesn't (design §5.3). A document that gains redlines while it is shown Clean, as when an
 * agent's suggestions arrive, switches to Redlines, so suggestions are never invisible. One whose
 * last redline goes while it is shown Redlines falls back to Clean, the view it would open in.
 */
export const viewModeField = StateField.define<ViewMode>({
  create: (state) => (hasRedlines(state.field(parsedField)) ? 'redlines' : 'clean'),
  update(mode, tr) {
    const chosen = tr.effects.findLast((effect) => effect.is(setViewModeEffect));
    if (chosen) return chosen.value;
    if (!tr.docChanged) return mode;
    const has = hasRedlines(tr.state.field(parsedField));
    if (mode === 'redlines' && !has) return 'clean';
    if (mode === 'clean' && has && !hasRedlines(tr.startState.field(parsedField))) {
      return 'redlines';
    }
    return mode;
  },
});
