// The word under a position, for a right-click on a misspelled word (design §5.1): the formatting
// palette asks the host's spell checker about it and shows the suggestions in place of WebKit's own
// menu, and the one the person picks is made here, as typing, as the Mac's own corrections are
// (corrections.ts). The word is read from the text the page shows, so a hidden marker inside it
// doesn't part it, and only where the Mac spell checks: prose, outside code, a URL, front matter and
// Raw (`autocorrects`).

import type { EditorView } from '@codemirror/view';
import type { Range } from '@redlines/format';
import { takesCodeKeys } from '../blocks/code.ts';
import { blockAt } from '../blocks/structure.ts';
import { blockBefore, cellText } from './break-correction.ts';
import { pointAt, shownRuns, shownText } from './corrections.ts';
import { autocorrects } from './smart-typing.ts';

/** A word that a spell checker may be asked about, with where it is. */
export interface WordAt extends Range {
  /** The text the page shows from `from` to `to`. */
  word: string;
  /** The block's text before the word, for the checker to tell its language from. */
  before: string;
}

/** Letters, digits and apostrophes, around a position. */
const BEFORE = /[\p{L}\p{N}'’]*$/u;
const AFTER = /^[\p{L}\p{N}'’]*/u;
/** Letters, with an apostrophe inside: what the checker is asked about. */
const WORD = /^\p{L}+(?:['’]\p{L}+)*$/u;
/**
 * The longest word asked about: a run of letters longer than any word, such as a long line of
 * `a`s, goes to no checker, and into no dictionary.
 */
const MAX_WORD = 100;

/**
 * How many characters of the shown text `runs` come before the document position `pos`: a position
 * inside hidden text counts as at its start.
 */
function shownOffset(runs: readonly Range[], pos: number): number {
  let offset = 0;
  for (const run of runs) {
    if (run.to <= pos) offset += run.to - run.from;
    else {
      if (run.from < pos) offset += pos - run.from;
      break;
    }
  }
  return offset;
}

/** The word at `pos`, or null where none is, or where no one asks the spell checker. */
export function wordAt(view: EditorView, pos: number): WordAt | null {
  const { state } = view;
  if (!Number.isInteger(pos) || pos < 0 || pos > state.doc.length) return null;
  const line = state.doc.lineAt(pos);
  const block = blockAt(state, pos);
  if (block && takesCodeKeys(block)) return null;
  // In a table cell the text is the cell's, not the row's with its pipes.
  const cell = cellText(state, pos);
  const runs = shownRuns(state, cell?.from ?? line.from, cell?.to ?? line.to);
  const shown = shownText(state, runs);
  const at = shownOffset(runs, pos);
  const left = BEFORE.exec(shown.slice(0, at));
  const right = AFTER.exec(shown.slice(at));
  let start = at - (left?.[0].length ?? 0);
  let end = at + (right?.[0].length ?? 0);
  // An apostrophe at either end quotes the word, and isn't in it.
  while (start < end && /['’]/.test(shown[start] ?? '')) start++;
  while (end > start && /['’]/.test(shown[end - 1] ?? '')) end--;
  if (at < start || at > end || start === end) return null;
  const word = shown.slice(start, end);
  if (word.length > MAX_WORD || !WORD.test(word)) return null;
  const from = pointAt(runs, start, 1);
  const to = pointAt(runs, end, -1);
  if (!autocorrects(state, from, to) || view.composing) return null;
  return { from, to, word, before: blockBefore(state, from, cell) };
}
