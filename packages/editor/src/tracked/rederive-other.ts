// Deriving the intents that are not typing again on newer text (docs/research/multiuser.md §4.2).
// A format change names ranges of the text it was made on, and a move names a run of blocks and a
// gap by offsets and an index, none of which mean the same once someone else's edit has landed. So
// each is anchored to the visible words it was made among, and placed again among the words of the
// newest text, as `anchorIntent` does for typing.
//
// Place, don't refuse. What can't be found is said, never dropped silently: the person is told what
// was not done, and why.

import { ChangeSet } from '@codemirror/state';
import type { EditorState } from '@codemirror/state';
import { applyChanges, blockRunAt, EditError, newestView, Untrackable } from '@redlines/format';
import type { BlockGap, BlockRun, DocView, Range } from '@redlines/format';
import { deriveMove } from '../blocks/move-intent.ts';
import type { MoveIntent } from '../blocks/move-intent.ts';
import { deriveFormat } from './format-intent.ts';
import type { FormatIntent } from './format-intent.ts';
import { best, CONTEXT, occurrences, placeInsertion, score, WINDOW } from './rederive.ts';
import type { Part, Rederived } from './rederive.ts';

/** The words around `from` to `to` (source offsets of `text`), among its visible text. */
function partOf(text: string, view: DocView, from: number, to: number): Part {
  const a = view.map.fromSource(from);
  const b = Math.max(a, view.map.fromSource(to));
  const start = Math.max(0, from - WINDOW);
  return {
    at: a,
    removed: view.text.slice(a, b),
    before: view.text.slice(Math.max(0, a - CONTEXT), a),
    after: view.text.slice(b, b + CONTEXT),
    window: { from: start, text: text.slice(start, to + WINDOW) },
  };
}

/**
 * Where the words of `part` are in `view`, as offsets of the visible text; null when they are gone.
 * A range with words is the only place that has them, or the one whose neighbours fit best. A range
 * with none (a caret) is placed among its neighbours, and null when they are gone too.
 */
function placed(view: DocView, part: Part): { from: number; to: number } | null {
  if (!part.removed) {
    const near = placeInsertion(view.text, part);
    return near.found ? { from: near.at, to: near.at } : null;
  }
  const end = (p: number) => p + part.removed.length;
  const found = occurrences(view.text, part.removed);
  const top = best(found, (p) => score(view.text, part, p, end(p)), part.at);
  if (
    top !== null &&
    (found.length === 1 ||
      score(view.text, part, top, end(top)) * 2 >= part.before.length + part.after.length)
  ) {
    return { from: top, to: end(top) };
  }
  return around(view.text, part);
}

/**
 * The words between the two sides of a range that changed inside (someone typed in the middle of
 * them): from the end of what stood before it to the start of what stood after it, so that the
 * range grows to hold what was added, as an edit widens to the unit that holds it.
 */
function around(text: string, part: Part): { from: number; to: number } | null {
  const a = part.before.slice(-8);
  const b = part.after.slice(0, 8);
  // A side with almost nothing is the start or the end of the file.
  const starts = a.length >= 3 ? occurrences(text, a).map((p) => p + a.length) : [];
  if (part.before.length < 3 && text.startsWith(part.before)) starts.push(part.before.length);
  const stops = (from: number): number =>
    b.length >= 3
      ? text.indexOf(b, from)
      : part.after.length < 3 &&
          text.endsWith(part.after) &&
          text.length - part.after.length >= from
        ? text.length - part.after.length
        : -1;
  let top: { from: number; to: number } | null = null;
  let gap = Infinity;
  for (const from of starts) {
    const to = stops(from);
    if (to < 0 || to - from > part.removed.length + 256) continue;
    const off = Math.abs(to - from - part.removed.length) + Math.abs(from - part.at) / 1000;
    if (off < gap) {
      gap = off;
      top = { from, to };
    }
  }
  return top;
}

// -- Format ---------------------------------------------------------------------------------

export interface AnchoredFormat {
  intent: FormatIntent;
  parts: readonly Part[];
}

/** Anchors a format change to the visible words of `text`, the text it was made on. */
export function anchorFormat(text: string, intent: FormatIntent): AnchoredFormat {
  const view = newestView(text);
  return { intent, parts: intent.ranges.map((range) => partOf(text, view, range.from, range.to)) };
}

/**
 * The format change placed again on `state`'s text: each range is where its words are now (as it
 * was when nothing around it changed), and the change is written for them there. Ranges whose words
 * are gone are left out and said; when all are gone nothing is formatted, and that is said too.
 */
export function rederiveFormat(state: EditorState, anchored: AnchoredFormat): Rederived {
  const { intent, parts } = anchored;
  const text = state.doc.toString();
  const view = newestView(text);
  const ranges: Range[] = [];
  let lost = 0;
  let moved = false;
  parts.forEach((part, i) => {
    const range = intent.ranges[i]!;
    const here = text.slice(part.window.from, part.window.from + part.window.text.length);
    if (here === part.window.text) {
      ranges.push(range);
      return;
    }
    moved = true;
    const at = placed(view, part);
    if (!at) {
      lost++;
      return;
    }
    ranges.push(
      at.from === at.to
        ? { from: view.map.toSource(at.from, -1), to: view.map.toSource(at.from, -1) }
        : { from: view.map.toSource(at.from, 1), to: view.map.toSource(at.to, -1) },
    );
  });
  // Two ranges that came to the same words can't both be written: the later one goes, and is said.
  ranges.sort((x, y) => x.from - y.from || x.to - y.to);
  for (let i = ranges.length - 1; i > 0; i--) {
    if (ranges[i]!.from < ranges[i - 1]!.to) {
      ranges.splice(i, 1);
      lost++;
    }
  }
  const notices: string[] = [];
  if (lost && !ranges.length) {
    return {
      ok: true,
      changes: ChangeSet.empty(text.length),
      notices: ['The text you formatted was changed by someone else, so it was not formatted.'],
      moved,
    };
  }
  if (lost) notices.push('Part of the text you formatted was changed by someone else.');
  try {
    const changes = deriveFormat(text, intent, ranges);
    return {
      ok: true,
      changes: ChangeSet.of(
        changes.map(({ from, to, insert }) => ({ from, to, insert })),
        text.length,
      ),
      notices,
      moved,
    };
  } catch (error) {
    if (error instanceof EditError || error instanceof Untrackable) {
      return { ok: false, reason: error.message };
    }
    throw error;
  }
}

// -- Move -----------------------------------------------------------------------------------

export interface AnchoredMove {
  intent: MoveIntent;
  /** The blocks that moved, as the words they hold. */
  run: Part;
  /** The words of the block above the gap they moved to, ending at the gap, and of the one below. */
  above: string;
  below: string;
}

/** Anchors a move to the words of `text`, the text it was made on. */
export function anchorMove(text: string, intent: MoveIntent): AnchoredMove {
  // The run and the gap are of the text with the open paragraph taken back.
  const base = intent.revert ? applyChanges(text, intent.revert) : text;
  const view = newestView(base);
  const { run, gap } = intent;
  const part = partOf(base, view, run.from, run.to);
  // Taken from the lines' starts, so that an item's bullet is among the words, as the run is.
  const runText = view.text.slice(run.viewFrom, run.viewTo);
  const at = run.viewFrom;
  const start = view.map.fromSource(gap.at);
  const stop = gap.above === undefined ? 0 : view.map.fromSource(gap.above);
  return {
    intent,
    run: {
      ...part,
      at,
      removed: runText,
      before: view.text.slice(Math.max(0, at - CONTEXT), at),
      after: view.text.slice(run.viewTo, run.viewTo + CONTEXT),
    },
    above: gap.above === undefined ? '' : view.text.slice(Math.max(0, stop - CONTEXT), stop),
    below: gap.after ? '' : view.text.slice(start, start + CONTEXT),
  };
}

/** How many characters of `a` end `b`, and of `c` start `d`: the words that fit around a gap. */
function fit(view: DocView, gap: BlockGap, above: string, below: string): number {
  let n = 0;
  if (gap.above !== undefined && above) {
    const stop = view.map.fromSource(gap.above);
    while (
      n < above.length &&
      n < stop &&
      view.text[stop - 1 - n] === above[above.length - 1 - n]
    ) {
      n++;
    }
  }
  if (!gap.after && below) {
    const start = view.map.fromSource(gap.at);
    let m = 0;
    while (m < below.length && view.text[start + m] === below[m]) m++;
    n += m;
  }
  return n;
}

/**
 * The move placed again on `state`'s text: the blocks are where their words are now, and the place
 * is the gap whose neighbours' words fit best, wherever that gap is by index. When the blocks are
 * gone, or no gap's neighbours are the ones the move named, nothing is moved and the person is told.
 */
export function rederiveMove(state: EditorState, anchored: AnchoredMove): Rederived {
  const { intent, run: runPart, above, below } = anchored;
  const text = state.doc.toString();
  const none = (notice: string): Rederived => ({
    ok: true,
    changes: ChangeSet.empty(text.length),
    notices: [notice],
    moved: true,
  });
  const view = newestView(text);
  const at = placed(view, runPart);
  if (!at)
    return none('The blocks you moved were changed by someone else, so they were not moved.');
  const run: BlockRun | undefined = blockRunAt(text, {
    from: view.map.toSource(at.from, 1),
    to: view.map.toSource(at.to, -1),
  });
  if (!run || run.count !== intent.run.count || run.kind !== intent.run.kind) {
    return none('The blocks you moved were changed by someone else, so they were not moved.');
  }
  let top: BlockGap | undefined;
  let topFit = 0;
  for (const gap of run.gaps) {
    const n = fit(view, gap, above, below);
    const near = (g: BlockGap) => Math.abs(g.index - intent.gap.index);
    if (n > topFit || (n === topFit && top && n > 0 && near(gap) < near(top))) {
      top = gap;
      topFit = n;
    }
  }
  // With words on one side only (a gap at an end), less is enough: a character typed nearby is likely.
  const wanted = Math.min(above && below ? 8 : 3, above.length + below.length);
  if (!top || topFit < wanted) {
    return none(
      'The place you moved the blocks to was changed by someone else, so they were not moved.',
    );
  }
  try {
    return {
      ok: true,
      changes: deriveMove(state, intent, run, top),
      notices: [],
      moved: true,
    };
  } catch (error) {
    if (error instanceof EditError || error instanceof Untrackable) {
      return { ok: false, reason: error.message };
    }
    throw error;
  }
}
