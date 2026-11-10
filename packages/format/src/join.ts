// How an agent's edit is compared and joined (format §3.11). `str_replace` compares its old text
// with its new text piece by piece, and the changes that comparison finds are then joined where
// they stand close together, so that a rewrite reads as one change and a light edit keeps a mark
// for each word or phrase it changed. Everything here works on the old and new text alone; what
// the file holds around them comes in through `JoinGuards`.

import { LINE_PREFIX } from './track.ts';

/** A word, a run of whitespace, or one other character (punctuation, an emoji): the pieces a
 * replacement is compared in. A word keeps its accents, digits and underscores. */
const TOKEN = /[\p{L}\p{N}\p{M}_]+|\s+|[^\p{L}\p{N}\p{M}_\s]/gu;

const WORD = /^[\p{L}\p{N}\p{M}_]+$/u;

/** The most pairs of tokens compared. Longer texts are one change, from the first token that
 * differs to the last. */
const MOST_PAIRS = 4_000_000;

/** A change to the old text: `[from, to)` becomes `insert`. */
export interface Hunk {
  from: number;
  to: number;
  insert: string;
}

/** What the join needs to know about the file around the old text, as offsets of the old text. */
export interface JoinGuards {
  /** Whether no marker stands in the source behind old-text offsets [from, to) (unchanged text
   * only). */
  plain(from: number, to: number): boolean;
  /** The text of the line in front of the old text, when the old text starts inside a line: it
   * says whether the first line is a table row. Empty by default. */
  lead?: string;
}

/** A run of tokens: unchanged (old equals new) or one change. */
export interface Run {
  equal: boolean;
  old: string[];
  new: string[];
}

export function tokens(s: string): string[] {
  return s.match(TOKEN) ?? [];
}

type Op = 'equal' | 'delete' | 'insert';

/** The longest common subsequence of two token lists as a list of operations, preferring to delete
 * first, so that an old word comes before its replacement. */
function compare(a: readonly string[], b: readonly string[]): Op[] {
  const n = a.length;
  const m = b.length;
  const width = m + 1;
  const common = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      common[i * width + j] =
        a[i] === b[j]
          ? (common[(i + 1) * width + j + 1] ?? 0) + 1
          : Math.max(common[(i + 1) * width + j] ?? 0, common[i * width + j + 1] ?? 0);
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push('equal');
      i++;
      j++;
    } else if ((common[(i + 1) * width + j] ?? 0) >= (common[i * width + j + 1] ?? 0)) {
      ops.push('delete');
      i++;
    } else {
      ops.push('insert');
      j++;
    }
  }
  for (; i < n; i++) ops.push('delete');
  for (; j < m; j++) ops.push('insert');
  return ops;
}

/**
 * The comparison of `before` with `after`, token by token, as runs that are unchanged or changed in
 * turn: a run of changed tokens that nothing separates is one change. The tokens at the start and
 * the end that agree are matched first, so an insertion comes after the words before it, as it is
 * typed.
 */
export function runsOf(before: string, after: string): Run[] {
  const a = tokens(before);
  const b = tokens(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const middleA = a.slice(start, endA);
  const middleB = b.slice(start, endB);
  const ops: Op[] = [
    ...a.slice(0, start).map((): Op => 'equal'),
    ...(middleA.length * middleB.length > MOST_PAIRS
      ? [...middleA.map((): Op => 'delete'), ...middleB.map((): Op => 'insert')]
      : compare(middleA, middleB)),
    ...a.slice(endA).map((): Op => 'equal'),
  ];
  const runs: Run[] = [];
  let i = 0;
  let j = 0;
  for (const op of ops) {
    const equal = op === 'equal';
    let last = runs.at(-1);
    if (last?.equal !== equal) {
      last = { equal, old: [], new: [] };
      runs.push(last);
    }
    if (op !== 'insert') last.old.push(a[i++] ?? '');
    if (op !== 'delete') last.new.push(b[j++] ?? '');
  }
  return runs;
}

/** The changes of `runs`, in offsets of the old text they spell. */
export function hunksOf(runs: readonly Run[]): Hunk[] {
  const hunks: Hunk[] = [];
  let at = 0;
  for (const run of runs) {
    const length = lengthOf(run.old);
    if (!run.equal) hunks.push({ from: at, to: at + length, insert: run.new.join('') });
    at += length;
  }
  return hunks;
}

const lengthOf = (pieces: readonly string[]) => pieces.reduce((n, piece) => n + piece.length, 0);

/** How many of `pieces` are words: runs of letters, digits, combining marks and `_`. */
export function wordsIn(pieces: readonly string[]): number {
  return pieces.filter((piece) => WORD.test(piece)).length;
}

/** A change counts the words it takes out or the words it puts in, whichever are more. */
const sizeOf = (run: Run) => Math.max(wordsIn(run.old), wordsIn(run.new));

/** Characters that plain text lacks: Markdown's syntax, and `+`, which starts a bullet or a sum. */
const SYNTAX = /[*_`~[\]()<>#|\\!=+^{}$&@]/;
/** A blank line, which ends a block. */
const BLANK_LINE = /\n[ \t]*\r?\n/;
/** A line that starts a block: a list item, a quote, a heading, a table row. */
const BLOCK_LINE = /\n[ \t]*(?:[-*+>#|]|\d+[.)])/;

/** Whether unchanged text is plain, so that the changes on either side may take it in: it ends no
 * block and holds no Markdown syntax. A line break that only wraps a paragraph is plain. */
export function joinable(unchanged: string): boolean {
  return !SYNTAX.test(unchanged) && !BLANK_LINE.test(unchanged) && !BLOCK_LINE.test(unchanged);
}

/** Where each line of `before` has a prefix (indentation, `>`, a bullet or a number with a box, a
 * heading's `#`s), as offsets of `before`. */
export function prefixSpans(before: string): [number, number][] {
  const spans: [number, number][] = [];
  let at = 0;
  for (const line of before.split('\n')) {
    const prefix = LINE_PREFIX.exec(line)?.[0] ?? '';
    if (prefix !== '') spans.push([at, at + prefix.length]);
    at += line.length + 1;
  }
  return spans;
}

/** Whether a change at `start` that takes `length` characters of the old text reaches into a
 * prefix. An insertion reaches the character it stands before. */
const touches = (spans: readonly [number, number][], start: number, length: number) =>
  spans.some(([from, to]) => start < to && from < start + Math.max(length, 1));

/**
 * Rule 1 of format §3.11: two changes with unchanged text between them become one when that text
 * is plain, no marker stands in it, neither change reaches into a line's prefix, and it has no more
 * words than either change has. The scan starts again from the first change after every join, and
 * a joined change counts the words it took in.
 *
 * @param base where `runs` start in `before`, when they are part of it.
 */
export function joinRuns(
  runs: readonly Run[],
  before: string,
  guards: JoinGuards,
  base = 0,
  spans: readonly [number, number][] = prefixSpans(before),
): Run[] {
  const out = runs.map((run) => ({ ...run, old: [...run.old], new: [...run.new] }));
  const starts: number[] = [];
  for (let at = base, k = 0; k < out.length; k++) {
    starts.push(at);
    at += lengthOf(out[k]?.old ?? []);
  }
  for (let k = 1; k < out.length - 1;) {
    const unchanged = out[k];
    const left = out[k - 1];
    const right = out[k + 1];
    if (
      unchanged?.equal &&
      left &&
      right &&
      !left.equal &&
      !right.equal &&
      joinsOver(unchanged, left, right, starts[k - 1] ?? 0, starts[k + 1] ?? 0, spans, guards)
    ) {
      out.splice(k - 1, 3, {
        equal: false,
        old: [...left.old, ...unchanged.old, ...right.old],
        new: [...left.new, ...unchanged.new, ...right.new],
      });
      starts.splice(k, 2);
      // Only the change before the new one can join it now; nothing before that has changed.
      k = Math.max(1, k - 2);
      continue;
    }
    k++;
  }
  return out;
}

function joinsOver(
  unchanged: Run,
  left: Run,
  right: Run,
  leftStart: number,
  rightStart: number,
  spans: readonly [number, number][],
  guards: JoinGuards,
): boolean {
  const text = unchanged.old.join('');
  const from = leftStart + lengthOf(left.old);
  return (
    joinable(text) &&
    !touches(spans, leftStart, lengthOf(left.old)) &&
    !touches(spans, rightStart, lengthOf(right.old)) &&
    wordsIn(unchanged.old) <= Math.min(sizeOf(left), sizeOf(right)) &&
    guards.plain(from, from + text.length)
  );
}

/**
 * Rule 2 of format §3.11: a block that keeps fewer than half of its words, in its old text and in
 * its new text alike, becomes one change of all of it, when what it keeps is plain, no marker
 * stands in it, and no line of its old text has a prefix. `runs` are the block's, as rule 1 left
 * them, so the words a join took in count as changed. Otherwise `runs` are given back as they are.
 *
 * @param base where `runs` start in the old text that `spans` are offsets of.
 */
export function wholeBlock(
  runs: readonly Run[],
  guards: JoinGuards,
  base = 0,
  spans: readonly [number, number][] = prefixSpans(runs.map((run) => run.old.join('')).join('')),
): readonly Run[] {
  let kept = 0;
  let oldWords = 0;
  let newWords = 0;
  for (const run of runs) {
    oldWords += wordsIn(run.old);
    newWords += wordsIn(run.new);
    if (run.equal) kept += wordsIn(run.old);
  }
  if (oldWords === 0 || newWords === 0 || kept * 2 >= oldWords || kept * 2 >= newWords) return runs;
  let at = base;
  for (const run of runs) {
    const length = lengthOf(run.old);
    if (run.equal && (!joinable(run.old.join('')) || !guards.plain(at, at + length))) return runs;
    at += length;
  }
  if (touches(spans, base, at - base)) return runs;
  return [
    { equal: false, old: runs.flatMap((run) => run.old), new: runs.flatMap((run) => run.new) },
  ];
}

/** A stretch of an edit's runs: a block's, a break between blocks that is unchanged, or a change
 * that adds or takes away a block break (a barrier), which is in no block. */
export interface Part {
  kind: 'block' | 'break' | 'barrier';
  runs: Run[];
  /** Where the part starts in the old text. */
  at: number;
  /** A block next to a barrier, which is never replaced whole. */
  besideBarrier?: boolean;
}

/** A row of a table: a line whose text, after quote markers and indentation, starts with `|`. */
const ROW = /^(?:[ \t]*>[ \t]?)*[ \t]*\|/;
/** The line breaks between two lines, with any blank lines, and the white space before them. */
const LINE_BREAKS = /[ \t]*\r?\n(?:[ \t]*\r?\n)*/g;
/** A line that starts a block, from its first character. */
const STARTS_BLOCK = /^[ \t]*(?:[-*+>#|]|\d+[.)])/;
/** A cell's pipe, with the white space around it. */
const PIPE = /[ \t]*(?<!\\)\|[ \t]*/g;

/** Where `before` breaks between blocks, as offsets of it: blank lines; a line break before a line
 * that starts a block, with that line's prefix; and the pipes of a table row. The first line is a
 * row when `lead` and it start with `|`. */
function breaksIn(
  before: string,
  lead: string,
): { breaks: [number, number][]; rows: [number, number][] } {
  const breaks: [number, number][] = [];
  const rows: [number, number][] = [];
  for (const match of before.matchAll(LINE_BREAKS)) {
    const end = match.index + match[0].length;
    const next = before.indexOf('\n', end);
    const line = before.slice(end, next === -1 ? before.length : next);
    const blank = match[0].split('\n').length > 2;
    if (!blank && !STARTS_BLOCK.test(line)) continue;
    breaks.push([match.index, end + (LINE_PREFIX.exec(line)?.[0].length ?? 0)]);
  }
  let at = -lead.length;
  for (const line of (lead + before).split('\n')) {
    if (ROW.test(line)) {
      rows.push([Math.max(at, 0), at + line.length]);
      for (const pipe of line.matchAll(PIPE)) {
        const from = at + pipe.index;
        const to = from + pipe[0].length;
        if (to > 0) breaks.push([Math.max(from, 0), to]);
      }
    }
    at += line.length + 1;
  }
  breaks.sort((x, y) => x[0] - y[0]);
  const merged: [number, number][] = [];
  for (const [from, to] of breaks) {
    const last = merged.at(-1);
    if (last && from <= last[1]) last[1] = Math.max(last[1], to);
    else merged.push([from, to]);
  }
  return { breaks: merged, rows };
}

/** Cuts the pieces of `run` at `offset` characters into it: the pieces of an unchanged run are
 * white space and syntax where a break starts or ends, so no word is cut. */
function cut(pieces: readonly string[], offset: number): [string[], string[]] {
  const head: string[] = [];
  const tail: string[] = [];
  let at = 0;
  for (const piece of pieces) {
    if (at + piece.length <= offset) head.push(piece);
    else if (at >= offset) tail.push(piece);
    else {
      head.push(piece.slice(0, offset - at));
      tail.push(piece.slice(offset - at));
    }
    at += piece.length;
  }
  return [head, tail];
}

/**
 * The blocks of an edit (format §3.11), in order: the runs are cut at each unchanged stretch that
 * breaks between blocks, which belongs to no block, and a change that holds a block break, or a
 * cell's pipe, is a barrier that ends the blocks on either side.
 */
export function blocksOf(runs: readonly Run[], before: string, lead = ''): Part[] {
  const { breaks, rows } = breaksIn(before, lead);
  const parts: Part[] = [];
  let block: Part | undefined;
  let besideBarrier = false;
  const add = (kind: Part['kind'], run: Run, at: number) => {
    if (kind === 'block') {
      if (!block) {
        block = { kind, runs: [], at, ...(besideBarrier ? { besideBarrier } : {}) };
        parts.push(block);
      }
      block.runs.push(run);
      return;
    }
    if (kind === 'barrier' && block) block.besideBarrier = true;
    besideBarrier = kind === 'barrier';
    block = undefined;
    const last = parts.at(-1);
    if (last?.kind === kind && kind === 'break') last.runs.push(run);
    else parts.push({ kind, runs: [run], at });
  };
  let at = 0;
  for (const run of runs) {
    const length = lengthOf(run.old);
    const end = at + length;
    if (!run.equal) {
      const inBreak = breaks.some(([from, to]) =>
        length === 0 ? from < at && at < to : from < end && at < to,
      );
      const added = run.new.join('');
      const barrier =
        inBreak ||
        BLANK_LINE.test(added) ||
        BLOCK_LINE.test(added) ||
        (added.includes('|') && rows.some(([from, to]) => from <= at && at <= to));
      add(barrier ? 'barrier' : 'block', run, at);
      at = end;
      continue;
    }
    // An unchanged run: the parts of it in a break belong to no block.
    let pieces = run.old;
    let from = at;
    for (const [start, stop] of breaks) {
      if (stop <= from || start >= end) continue;
      if (start > from) {
        const [head, tail] = cut(pieces, start - from);
        add('block', { equal: true, old: head, new: head }, from);
        pieces = tail;
        from = start;
      }
      const [head, tail] = cut(pieces, Math.min(stop, end) - from);
      add('break', { equal: true, old: head, new: head }, from);
      pieces = tail;
      from = Math.min(stop, end);
    }
    if (from < end) add('block', { equal: true, old: pieces, new: pieces }, from);
    at = end;
  }
  return parts;
}

/**
 * The changes of an agent's edit of `before` into `after` with the joining rule (format §3.11):
 * the comparison of `runsOf`, cut into blocks (`blocksOf`); in each block, changes close together
 * joined (`joinRuns`), and a block mostly rewritten replaced whole (`wholeBlock`) unless it is next
 * to a barrier. With nothing unchanged it is one change, as the word form is.
 */
export function joinedHunks(before: string, after: string, guards: JoinGuards): Hunk[] {
  const runs = runsOf(before, after);
  if (!runs.some((run) => run.equal)) return hunksOf(runs);
  const spans = prefixSpans(before);
  const out: Run[] = [];
  for (const part of blocksOf(runs, before, guards.lead)) {
    if (part.kind !== 'block') {
      out.push(...part.runs);
      continue;
    }
    const joined = joinRuns(part.runs, before, guards, part.at, spans);
    out.push(...(part.besideBarrier ? joined : wholeBlock(joined, guards, part.at, spans)));
  }
  return hunksOf(out);
}
