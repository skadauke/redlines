// Deriving an intent again on newer text (docs/research/multiuser.md §4.2). When someone else's edit
// lands first, an intent's offsets no longer mean what they did, and offsets mapped through text
// full of markers can land inside a marker. So an intent is anchored to the visible words it was
// made among, and placed again among the words of the newest text.
//
// Place, don't refuse: an edit that can't be placed exactly is placed as near as it can be, and one
// whose text is gone does nothing. Only when the format itself refuses the placed edit, widened as
// the filter widens, is the person told, with the reason.

import { ChangeSet } from '@codemirror/state';
import type { EditorState } from '@codemirror/state';
import { EditError, newestView } from '@redlines/format';
import type { IntentEdit, TypingIntent } from './intent.ts';
import { deriveIntent } from './typing.ts';
import type { BreakStyle } from '../line-breaks.ts';

/** How much visible text on each side of an edit is kept to find its place again. */
export const CONTEXT = 24;
/** How much source text on each side tells that the place hasn't changed. */
export const WINDOW = 12;

/** One edit of an intent, among the visible words of the text it was made on. */
export interface Part {
  /** Where the edit starts, in the visible text. */
  at: number;
  /** The visible text the edit removes. */
  removed: string;
  before: string;
  after: string;
  /** The source around the edit, to know that nothing there changed. */
  window: { from: number; text: string };
}

export interface AnchoredIntent {
  intent: TypingIntent;
  parts: readonly Part[];
}

/**
 * Anchors an intent to the visible words of `text`, the text it was made on. For an intent of text
 * composed by an input method, that is the text with the composition taken back (its `revert`
 * applied), since its edits are of that.
 */
export function anchorIntent(text: string, intent: TypingIntent): AnchoredIntent {
  const view = newestView(text);
  const parts = intent.edits.map((edit): Part => {
    const from = view.map.fromSource(edit.from);
    const to = Math.max(from, view.map.fromSource(edit.to));
    const start = Math.max(0, edit.from - WINDOW);
    return {
      at: from,
      removed: view.text.slice(from, to),
      before: view.text.slice(Math.max(0, from - CONTEXT), from),
      after: view.text.slice(to, to + CONTEXT),
      window: { from: start, text: text.slice(start, edit.to + WINDOW) },
    };
  });
  return { intent, parts };
}

export type Rederived =
  | {
      ok: true;
      changes: ChangeSet;
      /** What to tell the person, if anything: where text was kept, or why nothing was done. */
      notices: string[];
      /** Whether any edit is placed other than where it was made. */
      moved: boolean;
      /** The line breaks of another kind than the file's that the changes bring (#924). */
      styles?: readonly BreakStyle[];
    }
  | { ok: false; reason: string };

/** How well `p` in `text` matches the words around an edit: the characters that agree on each side. */
export function score(text: string, part: Part, p: number, end: number): number {
  let n = 0;
  while (
    n < part.before.length &&
    n < p &&
    text[p - 1 - n] === part.before[part.before.length - 1 - n]
  ) {
    n++;
  }
  let m = 0;
  while (m < part.after.length && text[end + m] === part.after[m]) m++;
  return n + m;
}

export function occurrences(text: string, needle: string, cap = 5000): number[] {
  const found: number[] = [];
  if (!needle) return found;
  for (
    let at = text.indexOf(needle);
    at >= 0 && found.length < cap;
    at = text.indexOf(needle, at + 1)
  ) {
    found.push(at);
  }
  return found;
}

/** The candidate whose words fit best, the nearest to `near` among equals. */
export function best(
  candidates: number[],
  fit: (p: number) => number,
  near: number,
): number | null {
  let top: number | null = null;
  let topScore = -1;
  for (const p of candidates) {
    const s = fit(p);
    if (s > topScore || (s === topScore && Math.abs(p - near) < Math.abs((top ?? p) - near))) {
      top = p;
      topScore = s;
    }
  }
  return top;
}

/** Where an insertion goes among the words of the newest text, and whether its words were found. */
export function placeInsertion(text: string, part: Part): { at: number; found: boolean } {
  // Nothing was kept around the edit (an empty text): there is nothing to find, and nothing lost.
  if (!part.before && !part.after) return { at: Math.min(part.at, text.length), found: true };
  const a = part.before.slice(-8);
  const b = part.after.slice(0, 8);
  const both: number[] = [];
  const first: number[] = [];
  const second: number[] = [];
  for (const p of occurrences(text, a)) {
    const at = p + a.length;
    (b && text.startsWith(b, at) ? both : first).push(at);
  }
  for (const p of occurrences(text, b))
    if (!a || !(p >= a.length && text.startsWith(a, p - a.length))) second.push(p);
  const pool = both.length ? both : first.length ? first : second;
  const at = best(pool, (p) => score(text, part, p, p), part.at);
  // Words that fit on one side only count when they fit well: half of all the words kept.
  const enough =
    both.length > 0 ||
    (at !== null && score(text, part, at, at) * 2 >= part.before.length + part.after.length);
  return at === null || !enough
    ? { at: Math.min(part.at, text.length), found: false }
    : { at, found: true };
}

/**
 * The intent placed again on `state`'s text, and the changes it makes there. With the place
 * unchanged, they are what the filter wrote the first time.
 */
export function rederiveIntent(state: EditorState, anchored: AnchoredIntent): Rederived {
  const { intent, parts } = anchored;
  const text = state.doc.toString();
  const view = newestView(text);
  const notices: string[] = [];
  let moved = false;
  const placed: IntentEdit[] = [];
  let lost = false;
  parts.forEach((part, i) => {
    const edit = intent.edits[i]!;
    const here = text.slice(part.window.from, part.window.from + part.window.text.length);
    if (here === part.window.text) {
      placed.push(edit);
      return;
    }
    moved = true;
    if (intent.exact) {
      // Text's own changes, markers and all, can't be placed among visible words: they go where
      // the same source stands now, with its neighbours, or not at all.
      const near = best(occurrences(text, part.window.text), () => 0, part.window.from);
      if (near === null) {
        lost = true;
        return;
      }
      const shift = near - part.window.from;
      placed.push({ ...edit, from: edit.from + shift, to: edit.to + shift });
      return;
    }
    let from: number;
    let to: number;
    if (part.removed) {
      const end = (p: number) => p + part.removed.length;
      const found = occurrences(view.text, part.removed);
      const top = best(found, (p) => score(view.text, part, p, end(p)), part.at);
      // Other words in its place don't do: the text must be the only one like it, or fit its words.
      const at =
        top !== null &&
        (found.length === 1 ||
          score(view.text, part, top, end(top)) * 2 >= part.before.length + part.after.length)
          ? top
          : null;
      if (at !== null) {
        from = at;
        to = end(at);
      } else if (edit.insert === '') {
        // The text this deletes is gone already: nothing to do, and nothing to say.
        return;
      } else {
        // A replacement of text that is gone becomes an insertion where the text stood.
        const near = placeInsertion(view.text, part);
        from = to = near.at;
        if (!near.found)
          notices.push('The text around your edit was deleted. Your text is kept here.');
      }
    } else {
      const near = placeInsertion(view.text, part);
      from = to = near.at;
      if (!near.found)
        notices.push('The text around your edit was deleted. Your text is kept here.');
    }
    placed.push({
      from: from === to ? view.map.toSource(from, -1) : view.map.toSource(from, 1),
      to: from === to ? view.map.toSource(from, -1) : view.map.toSource(to, -1),
      insert: edit.insert,
      main: edit.main,
    });
  });
  if (lost) return { ok: false, reason: 'the text it changed was changed by someone else' };
  // Edits that now overlap can't be written together; the later ones go (the filter widens only a
  // single edit, and refuses the rest, as it does for the first time).
  placed.sort((x, y) => x.from - y.from || x.to - y.to);
  const kept: IntentEdit[] = [];
  for (const edit of placed) if (!kept.length || edit.from >= kept.at(-1)!.to) kept.push(edit);
  if (kept.length < placed.length) {
    notices.push('Part of your edit fell on text that changed.');
    // The caret follows the main edit; with it gone, the last one kept.
    if (!kept.some((edit) => edit.main)) kept[kept.length - 1] = { ...kept.at(-1)!, main: true };
  }
  if (!kept.length) return { ok: true, changes: ChangeSet.empty(text.length), notices, moved };
  // The newer text holds no composition to take back: the edits are placed on it as they are.
  const whole: TypingIntent = { ...intent };
  delete whole.revert;
  const derive = (widening: boolean | 'first') => ({
    ...whole,
    edits: kept,
    widening: intent.widening || widening,
  });
  try {
    try {
      return { ok: true, changes: deriveIntent(state, derive(false)), notices, moved };
    } catch (error) {
      if (!(error instanceof EditError) || kept.length > 1) throw error;
      return { ok: true, changes: deriveIntent(state, derive(true)), notices, moved };
    }
  } catch (error) {
    if (error instanceof EditError) return { ok: false, reason: error.message };
    throw error;
  }
}
