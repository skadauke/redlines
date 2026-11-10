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
