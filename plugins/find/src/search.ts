// What find knows: the query, and where it matches in the text a reader sees. The document holds
// markers and a ledger that a reader never sees, so the search runs over the newest view (format
// §8) and each match is mapped back to the document with `PositionMap.toSource`. Matches are
// recomputed whenever the document, the query or the bar changes. Replacing goes through the same
// input path as typing, so Track Changes turns it into substitutions (or refuses it inside code).

import { isolateHistory } from '@codemirror/commands';
import {
  EditorSelection,
  type EditorState,
  StateEffect,
  StateField,
  type TransactionSpec,
} from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view';
import { newestView } from '@redlines/format';

/** A match, as positions in the document (CodeMirror's), which may span hidden markers. */
export interface Match {
  from: number;
  to: number;
}

export interface FindState {
  /** Whether the find bar is open: while it is closed, nothing is found or drawn. */
  open: boolean;
  /** Whether the bar shows the replace row. */
  replace: boolean;
  query: string;
  matches: readonly Match[];
  decorations: DecorationSet;
}

/** Changes the bar's state: any of these. */
export const setFind = StateEffect.define<Partial<Pick<FindState, 'open' | 'replace' | 'query'>>>();

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The matches of `query` in the text a reader sees, without regard to case, in document order. */
export function findMatches(doc: string, query: string): Match[] {
  if (!query) return [];
  const { text, map } = newestView(doc);
  const found = text.matchAll(new RegExp(escapeRegExp(query), 'giu'));
  return [...found].map((match) => ({
    // From after the markers that sit before the match, to before those after it.
    from: map.toSource(match.index, 1),
    to: map.toSource(match.index + match[0].length, -1),
  }));
}

/** The index of the match the selection covers exactly, or -1. */
export function currentIndex(state: EditorState, matches: readonly Match[]): number {
  const { from, to } = state.selection.main;
  return matches.findIndex((match) => match.from === from && match.to === to);
}

const matchMark = Decoration.mark({ class: 'rl-find-match' });
const currentMark = Decoration.mark({ class: 'rl-find-match rl-find-current' });

function decorate(state: EditorState, matches: readonly Match[]): DecorationSet {
  const current = currentIndex(state, matches);
  return Decoration.set(
    matches.map((match, i) =>
      (i === current ? currentMark : matchMark).range(match.from, match.to),
    ),
  );
}

const closed: FindState = {
  open: false,
  replace: false,
  query: '',
  matches: [],
  decorations: Decoration.none,
};

export const findField = StateField.define<FindState>({
  create: () => closed,
  update(value, tr) {
    let { open, replace, query } = value;
    let changed = tr.docChanged;
    for (const effect of tr.effects) {
      if (!effect.is(setFind)) continue;
      changed ||= effect.value.open !== undefined || effect.value.query !== undefined;
      open = effect.value.open ?? open;
      replace = effect.value.replace ?? replace;
      query = effect.value.query ?? query;
    }
    if (!open) {
      return value.open || query !== value.query ? { ...closed, query } : value;
    }
    if (!changed && !tr.selection && replace === value.replace) return value;
    const matches = changed ? findMatches(tr.newDoc.toString(), query) : value.matches;
    return { open, replace, query, matches, decorations: decorate(tr.state, matches) };
  },
  provide: (field) => EditorView.decorations.from(field, (state) => state.decorations),
});

/** The search state of an editor view. */
export const findState = (state: EditorState): FindState => state.field(findField);

/** The next match from the selection (`dir` 1), or the previous (-1), round to the other end. */
export function neighbor(
  state: EditorState,
  matches: readonly Match[],
  dir: 1 | -1,
): Match | undefined {
  const { from, to, empty } = state.selection.main;
  if (dir > 0) {
    const after = empty ? from : to;
    return matches.find((match) => match.from >= after) ?? matches[0];
  }
  return matches.findLast((match) => match.to <= from) ?? matches.at(-1);
}

/** Selects a match and scrolls it into view. */
export function select(view: EditorView, match: Match): void {
  view.dispatch({
    selection: EditorSelection.range(match.from, match.to),
    effects: EditorView.scrollIntoView(EditorSelection.range(match.from, match.to), {
      y: 'center',
    }),
    userEvent: 'select.find',
  });
}

/** Moves to the next or previous match. Returns false when there is none. */
export function step(view: EditorView, dir: 1 | -1): boolean {
  const match = neighbor(view.state, findState(view.state).matches, dir);
  if (match) select(view, match);
  return !!match;
}

/** The text a reader sees in the selection, up to its first line break. */
export function selectedText(state: EditorState): string {
  const { from, to } = state.selection.main;
  const { text, map } = newestView(state.doc.toString());
  return text.slice(map.fromSource(from), map.fromSource(to)).split('\n')[0] ?? '';
}

const replacing = (matches: readonly Match[], text: string): TransactionSpec => ({
  changes: matches.map(({ from, to }) => ({ from, to, insert: text })),
  // Typing, to Track Changes, and a step of its own to undo.
  userEvent: 'input.replace',
  annotations: isolateHistory.of('full'),
});

/** Whether the editor would make the replacement: a tracked change in code, for one, it refuses. */
const allowed = (state: EditorState, match: Match, text: string) =>
  state.update(replacing([match], text)).docChanged;

/**
 * Replaces the match the selection is on, then moves to the next. With no match selected it only
 * moves to the next. A replacement the editor refuses, which it says why through `onNotice`, is
 * left, and the search goes on after it. Returns whether a replacement was made.
 */
export function replaceCurrent(view: EditorView, text: string): boolean {
  const { matches } = findState(view.state);
  const index = currentIndex(view.state, matches);
  const match = matches[index];
  if (!match) {
    step(view, 1);
    return false;
  }
  const before = view.state.doc;
  view.dispatch(replacing([match], text));
  const replaced = view.state.doc !== before;
  const rest = findState(view.state).matches;
  if (replaced) {
    const next = neighbor(view.state, rest, 1);
    if (next) select(view, next);
  } else {
    const next = rest.find((other) => other.from >= match.to) ?? rest[0];
    if (next && next !== match) select(view, next);
  }
  return replaced;
}

/**
 * Replaces every match in one step to undo. Matches the editor would refuse are left alone, the
 * first of them with its reason through `onNotice`. Returns how many were replaced and how many
 * left.
 */
export function replaceAll(view: EditorView, text: string): { replaced: number; left: number } {
  const { matches } = findState(view.state);
  const ok = matches.filter((match) => allowed(view.state, match, text));
  const refused = matches.find((match) => !ok.includes(match));
  // Dispatched for the reason it gives, as a replacement one at a time would.
  if (refused) view.dispatch(replacing([refused], text));
  if (ok.length) view.dispatch(replacing(ok, text));
  return { replaced: ok.length, left: matches.length - ok.length };
}
