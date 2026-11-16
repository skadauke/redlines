// What find knows: the query, and where it matches in the text a reader sees. The document holds
// markers and a ledger that a reader never sees, so the search runs over the newest view (format
// §8) and each match is mapped back to the document with `PositionMap.toSource`. Matches are
// recomputed whenever the document, the query, the options or the bar changes. Replacing goes
// through the same input path as typing, so Track Changes turns it into substitutions (or refuses
// it inside code). Replace All is one transaction (one step to undo) in which every match is a
// change of its own, so each becomes its own tracked change, as if replaced by hand.

import { isolateHistory } from '@codemirror/commands';
import {
  EditorSelection,
  type EditorState,
  Facet,
  StateEffect,
  StateField,
  type TransactionSpec,
} from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view';
import { trackingField } from '@redlines/editor';
import { newestView, parse } from '@redlines/format';

/** A match, as positions in the document (CodeMirror's), which may span hidden markers. */
export interface Match {
  from: number;
  to: number;
  /** The groups of a regular expression's match, for `$1` in the replacement: whole match first. */
  groups?: readonly string[];
}

/** The ways a search is narrowed, besides its text. */
export interface FindOptions {
  matchCase: boolean;
  wholeWord: boolean;
  regex: boolean;
}

export interface FindState extends FindOptions {
  /** Whether the find bar is open: while it is closed, nothing is found or drawn. */
  open: boolean;
  /** Whether the bar shows the replace row. */
  replace: boolean;
  query: string;
  /** The part of the document Find is limited to (Find in Selection), or null for all of it. */
  scope: Match | null;
  /** Whether Track Changes is on: then text in a tracked change is not matched. */
  tracking: boolean;
  /** Whether the query is a regular expression that does not compile. */
  invalid: boolean;
  matches: readonly Match[];
  decorations: DecorationSet;
}

/**
 * Called whenever a match becomes the current one (it is selected: by stepping, by replacing or by
 * typing a query), before the editor scrolls to it. A host that hides text, such as a closed fold,
 * opens it here so that the match can be seen. Add a handler with `currentMatchHandlers.of(fn)`;
 * `createFind`'s `onCurrentMatch` option does the same.
 */
export const currentMatchHandlers = Facet.define<(match: Match) => void>();

/** Changes the bar's state: any of these. A `scope` of null turns Find in Selection off. */
export const setFind =
  StateEffect.define<
    Partial<Pick<FindState, 'open' | 'replace' | 'query' | 'scope' | keyof FindOptions>>
  >();

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const WORD = '[\\p{L}\\p{N}_]';

const plain: FindOptions = { matchCase: false, wholeWord: false, regex: false };

/** The expression a query stands for, or null when it is a regular expression that is no good. */
export function expressionOf(query: string, options: FindOptions = plain): RegExp | null {
  let source = options.regex ? query : escapeRegExp(query);
  if (options.wholeWord) source = `(?<!${WORD})(?:${source})(?!${WORD})`;
  try {
    return new RegExp(source, options.matchCase ? 'gu' : 'giu');
  } catch {
    return null;
  }
}

/** What a tracked insertion, replacement or format change holds: no match is made there. */
function trackedRanges(doc: string): { from: number; to: number }[] {
  return parse(doc).marks.flatMap((mark) =>
    mark.kind === 'ins' || mark.kind === 'sub' || mark.kind === 'fmt'
      ? mark.segments.map((s) => ({ from: s.open.from, to: s.close?.to ?? s.content.to }))
      : [],
  );
}

export interface SearchOptions extends Partial<FindOptions> {
  /** Only matches inside this range of the document. */
  scope?: { from: number; to: number } | null;
  /** Leave out matches that touch text in a tracked change. */
  skipTracked?: boolean;
}

/** The matches of `query` in the text a reader sees, in document order; `invalid` for a bad one. */
export function searchDoc(
  doc: string,
  query: string,
  options: SearchOptions = {},
): { matches: Match[]; invalid: boolean } {
  if (!query) return { matches: [], invalid: false };
  const expression = expressionOf(query, { ...plain, ...options });
  if (!expression) return { matches: [], invalid: true };
  const { text, map } = newestView(doc);
  const tracked = options.skipTracked ? trackedRanges(doc) : [];
  const { scope } = options;
  const matches: Match[] = [];
  for (const found of text.matchAll(expression)) {
    if (!found[0]) continue;
    // From after the markers that sit before the match, to before those after it.
    const from = map.toSource(found.index, 1);
    const to = map.toSource(found.index + found[0].length, -1);
    if (scope && (from < scope.from || to > scope.to)) continue;
    if (tracked.some((range) => from < range.to && to > range.from)) continue;
    matches.push({ from, to, ...(options.regex ? { groups: [...found] } : {}) });
  }
  return { matches, invalid: false };
}

/** The matches of `query` in the text a reader sees, without regard to case, in document order. */
export function findMatches(doc: string, query: string): Match[] {
  return searchDoc(doc, query).matches;
}

/** The replacement for a match: with a regular expression, `$1`, `$&` and `$$` are filled in. */
export function replacementFor(match: Match, text: string): string {
  const { groups } = match;
  if (!groups) return text;
  return text.replace(/\$(\$|&|\d{1,2})/g, (whole, what: string) =>
    what === '$' ? '$' : what === '&' ? (groups[0] ?? '') : (groups[Number(what)] ?? whole),
  );
}

/** The index of the match the selection covers exactly, or -1. */
export function currentIndex(state: EditorState, matches: readonly Match[]): number {
  const { from, to } = state.selection.main;
  return matches.findIndex((match) => match.from === from && match.to === to);
}

const matchMark = Decoration.mark({ class: 'rl-find-match' });
const currentMark = Decoration.mark({ class: 'rl-find-match rl-find-current' });
const scopeMark = Decoration.mark({ class: 'rl-find-scope' });

function decorate(
  state: EditorState,
  matches: readonly Match[],
  scope: Match | null,
): DecorationSet {
  const current = currentIndex(state, matches);
  const marks = matches.map((match, i) =>
    (i === current ? currentMark : matchMark).range(match.from, match.to),
  );
  if (scope && scope.from < scope.to) marks.push(scopeMark.range(scope.from, scope.to));
  return Decoration.set(marks, true);
}

const closed: FindState = {
  open: false,
  replace: false,
  query: '',
  ...plain,
  scope: null,
  tracking: false,
  invalid: false,
  matches: [],
  decorations: Decoration.none,
};

export const findField = StateField.define<FindState>({
  create: () => closed,
  update(value, tr) {
    let { open, replace, query, matchCase, wholeWord, regex, scope } = value;
    const tracking = tr.state.field(trackingField, false) ?? false;
    let changed = tr.docChanged || tracking !== value.tracking;
    if (scope && tr.docChanged) {
      scope = { from: tr.changes.mapPos(scope.from, -1), to: tr.changes.mapPos(scope.to, 1) };
    }
    for (const effect of tr.effects) {
      if (!effect.is(setFind)) continue;
      const set = effect.value;
      changed ||=
        set.open !== undefined ||
        set.query !== undefined ||
        set.matchCase !== undefined ||
        set.wholeWord !== undefined ||
        set.regex !== undefined ||
        set.scope !== undefined;
      open = set.open ?? open;
      replace = set.replace ?? replace;
      query = set.query ?? query;
      matchCase = set.matchCase ?? matchCase;
      wholeWord = set.wholeWord ?? wholeWord;
      regex = set.regex ?? regex;
      if (set.scope !== undefined) scope = set.scope;
    }
    if (!open) {
      const same = !value.open && query === value.query;
      return same &&
        matchCase === value.matchCase &&
        wholeWord === value.wholeWord &&
        regex === value.regex
        ? value
        : { ...closed, query, matchCase, wholeWord, regex };
    }
    if (!changed && !tr.selection && replace === value.replace) return value;
    const { matches, invalid } = changed
      ? searchDoc(tr.newDoc.toString(), query, {
          matchCase,
          wholeWord,
          regex,
          scope,
          skipTracked: tracking,
        })
      : { matches: value.matches, invalid: value.invalid };
    return {
      open,
      replace,
      query,
      matchCase,
      wholeWord,
      regex,
      scope,
      tracking,
      invalid,
      matches,
      decorations: decorate(tr.state, matches, scope),
    };
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
  for (const handler of view.state.facet(currentMatchHandlers)) handler(match);
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

/**
 * Selects the first match that starts at `pos` or after it, round to the first: what typing in the
 * find box does, so that the match nearest the caret is the current one. False when none.
 */
export function selectFrom(view: EditorView, pos: number): boolean {
  const { matches } = findState(view.state);
  const match = matches.find((m) => m.from >= pos) ?? matches[0];
  if (match) select(view, match);
  return !!match;
}

/** The text a reader sees in the selection, up to its first line break. */
export function selectedText(state: EditorState): string {
  const { from, to } = state.selection.main;
  const { text, map } = newestView(state.doc.toString());
  return text.slice(map.fromSource(from), map.fromSource(to)).split('\n')[0] ?? '';
}

/** A selection this long (in characters a reader sees) limits Find to itself. */
export const SCOPE_LENGTH = 80;

/**
 * What a selection means for Find. A selection limits Find to itself (`scope`) when it is more than
 * one block or holds a line break, is 80 characters or more, or is a whole block; a shorter phrase
 * is the search term (`query`) instead. An empty selection means nothing.
 */
export function seedOf(state: EditorState): { query?: string; scope?: Match } | null {
  const { from, to, empty } = state.selection.main;
  if (empty) return null;
  const { text, map } = newestView(state.doc.toString());
  const a = map.fromSource(from);
  const b = map.fromSource(to);
  const picked = text.slice(a, b);
  if (!picked.trim()) return null;
  const whole = (a === 0 || text[a - 1] === '\n') && (b === text.length || text[b] === '\n');
  if (picked.includes('\n') || picked.length >= SCOPE_LENGTH || whole) {
    return { scope: { from, to } };
  }
  return { query: picked };
}

/** One replacement: the match and the text that goes in its place. */
const replacing = (
  matches: readonly Match[],
  text: string,
  userEvent = 'input.replace',
): TransactionSpec => ({
  changes: matches.map((match) => ({
    from: match.from,
    to: match.to,
    insert: replacementFor(match, text),
  })),
  // Typing, to Track Changes, and a step of its own to undo. Replace All has its own kind, so that
  // the Edit menu can tell it from Replace.
  userEvent,
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
 * Replaces every match in one step to undo, each as a change of its own: with Track Changes on,
 * each is its own tracked change, as if replaced by hand. Matches the editor would refuse are left
 * alone, the first of them with its reason through `onNotice`. Returns how many were replaced and
 * how many left.
 */
export function replaceAll(view: EditorView, text: string): { replaced: number; left: number } {
  const { matches } = findState(view.state);
  const ok = matches.filter((match) => allowed(view.state, match, text));
  const refused = matches.find((match) => !ok.includes(match));
  // Dispatched for the reason it gives, as a replacement one at a time would.
  if (refused) view.dispatch(replacing([refused], text));
  if (ok.length) view.dispatch(replacing(ok, text, 'input.replace.all'));
  return { replaced: ok.length, left: matches.length - ok.length };
}
