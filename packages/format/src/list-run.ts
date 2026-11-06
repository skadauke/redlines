// Whether a numbered item that doesn't start at 1 is read as an item however the pending changes
// in the lines right above it are decided (format §2.6).
//
// Those lines are read in the newest view, one at a time. A line that no pending change touches at
// its start, and that holds no line break of one, reads the same in every decision. The others are
// put together in groups, with the changes that touch them: a change that holds a line break (a
// split, an insertion or a substitution that holds one, a deletion or a substitution whose old text
// holds one), or that stands in a line's indentation, list marker or at the start of its text. A
// group is read in each of the ways its own few changes can be decided, each worked out from the
// newest text of its lines with the changes taken back that it rejects. The groups are read one
// after another, and every way a group can read is tried after every way the lines above it can
// read, which takes in every decision of the changes and more. Where that can't be worked out,
// as with many changes in one group, the item is taken not to go on.

import {
  LIST_START,
  lineEnd,
  lineStart,
  listGoesOn,
  listPrefixLength,
  listStep,
  nextLineStart,
  openerRange,
  splitEnd,
  touchingAbove,
} from './blocks.ts';
import type { ListState } from './blocks.ts';
import type { DocView, MarkRange, Parsed, Range, Segment } from './types.ts';

/** The most changes a group is read with: every way they can be decided is tried. */
const MOST = 4;

interface Edit {
  from: number;
  to: number;
  insert: string;
}

/**
 * Whether the numbered item from 2 with `delimiter`, on the line of `text` that starts at `top`, is
 * read as an item in every decision of the pending changes in the lines right above it that touch
 * it. `newest` is the newest view of `text`, `original` its original view (asked for only where a
 * change of another block's type stands in those lines, or the item's indentation is changed), and
 * `payload` that of the item's block change.
 */
export function listGoesOnEveryWay(
  text: string,
  parsed: Parsed,
  newest: DocView,
  original: () => DocView,
  top: number,
  delimiter: string,
  payload: string,
): boolean {
  const view = newest.text;
  const at = newest.map.fromSource(top);
  const deletions = parsed.marks.flatMap((mark) => (mark.kind === 'del' ? mark.segments : []));
  const limit = parsed.ledgerRange?.from;
  const reach = (mark: MarkRange, segment: Segment): Range =>
    pendingReach(text, parsed, mark, segment);
  const shown = (range: Range): Range => ({
    from: newest.map.fromSource(range.from),
    to: newest.map.fromSource(range.to),
  });
  const blank = (line: string) => /^[ \t]*$/.test(line);
  // The lines right above the item that touch it, from the blank line before them; a blank line
  // that a pending change wrote may not be there, and the lines above it are read too.
  let first = touchingAbove(view, at);
  for (;;) {
    let gap = first;
    while (gap > 0 && blank(view.slice(lineStart(view, gap - 1), gap - 1))) {
      gap = lineStart(view, gap - 1);
    }
    if (gap === 0 || gap === first) break;
    const sourceGap = { from: newest.map.toSource(gap - 1, -1), to: newest.map.toSource(first, 1) };
    const wrote = parsed.marks.some(
      (mark) =>
        (mark.kind === 'ins' ||
          mark.kind === 'del' ||
          mark.kind === 'sub' ||
          mark.kind === 'split') &&
        mark.segments.some((segment) => {
          const source = reach(mark, segment);
          if (source.to < sourceGap.from || source.from > sourceGap.to) return false;
          const range = shown(source);
          return range.from < first && range.to > gap - 1;
        }),
    );
    if (!wrote) break;
    first = touchingAbove(view, lineStart(view, gap - 1));
  }
  if (first >= at) return true;
  // The lines, in the newest view: where each starts, where its text starts, and where it ends.
  const lines: { start: number; text: number; end: number }[] = [];
  for (let line = first; line < at; line = nextLineStart(view, line)) {
    const end = lineEnd(view, line);
    lines.push({ start: line, text: line + listPrefixLength(view.slice(line, end)), end });
  }
  // The blank line above them, with the line break in front of it: a change there can join the
  // lines to the ones above, or part them.
  const bound = first > 0 ? Math.max(0, lineStart(view, first - 1) - 1) : first;
  // The line that holds a view offset, or -1 above the lines.
  const lineOf = (position: number) => {
    let low = 0;
    let high = lines.length - 1;
    let found = -1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if ((lines[middle]?.start ?? 0) <= position) {
        found = middle;
        low = middle + 1;
      } else high = middle - 1;
    }
    return found;
  };
  // The changes that can change how the lines read, and the lines each one stands on.
  const changes: { mark: MarkRange; from: number; to: number }[] = [];
  const sourceFrom = newest.map.toSource(bound, -1);
  for (const mark of parsed.marks) {
    if (mark.kind === 'hl' || mark.kind === 'cmt') continue;
    const head = mark.segments[0];
    const tail = mark.segments.at(-1);
    if (!head || !tail || head.open.from > top) continue;
    const end = (tail.close ?? tail.open).to;
    if (end < sourceFrom && (mark.kind !== 'split' || /[^\s>]/.test(text.slice(end, sourceFrom)))) {
      continue;
    }
    if (reach(mark, tail).to < sourceFrom) continue;
    const ranges = mark.segments.map((segment) => shown(reach(mark, segment)));
    const from = Math.min(...ranges.map((range) => range.from));
    const to = Math.max(...ranges.map((range) => range.to));
    if (to < bound || from >= at) continue;
    if (mark.kind === 'sub' && renumbers(text, mark)) continue;
    const breaks =
      mark.kind === 'split' ||
      mark.kind === 'fmt' ||
      mark.segments.some(
        (segment) =>
          (segment.payload ?? mark.payload ?? '').includes('\n') ||
          (mark.kind !== 'del' &&
            text.slice(segment.content.from, segment.content.to).includes('\n')),
      );
    const starts = ranges.some((range) => {
      for (let i = Math.max(0, lineOf(range.from)); i <= lineOf(range.to); i++) {
        const line = lines[i];
        if (line && range.from <= line.text && line.start <= range.to) return true;
      }
      return false;
    });
    if (!breaks && !starts) continue;
    // A change at the blank line above, or one that reaches into the item's line, may move where
    // the lines start or end: that can't be read here.
    if (from < first || to >= at) return false;
    changes.push({ mark, from, to });
  }
  // Groups of lines, joined by the changes that stand on them.
  const group = lines.map((_, i) => i);
  const root = (i: number): number => {
    let r = i;
    while (group[r] !== r) r = group[r] ?? r;
    return r;
  };
  const marksOf = new Map<number, MarkRange[]>();
  for (const change of changes) {
    const a = lineOf(change.from);
    const b = lineOf(change.to);
    for (let i = a + 1; i <= b; i++) {
      const x = root(i);
      const y = root(a);
      group[Math.max(x, y)] = Math.min(x, y);
    }
  }
  for (const change of changes) {
    const r = root(lineOf(change.from));
    marksOf.set(r, [...(marksOf.get(r) ?? []), change.mark]);
  }
  // Each group's ways of reading: the texts of its lines in every decision of its changes.
  const ways = new Map<number, string[][]>();
  for (const [r, marks] of marksOf) {
    if (marks.length > MOST) return false;
    let last = r;
    while (last + 1 < lines.length && root(last + 1) === r) last++;
    const from = lines[r]?.start ?? 0;
    const to = lines[last]?.end ?? from;
    const read = new Set<string>();
    if (marks.some((mark) => mark.kind === 'fmt')) {
      // Another block's change of type: its lines with the syntax it had, from the original view.
      if (marks.length > 1) return false;
      read.add(view.slice(from, to));
      const old = original();
      read.add(
        lines
          .slice(r, last + 1)
          .map((line) => {
            const at = old.map.fromSource(newest.map.toSource(line.start, -1));
            const was = old.text.slice(lineStart(old.text, at), lineEnd(old.text, at));
            return was.slice(0, listPrefixLength(was)) + view.slice(line.text, line.end);
          })
          .join('\n'),
      );
    } else {
      for (let accepted = 0; accepted < 1 << marks.length; accepted++) {
        const edits = marks.flatMap((mark, i) =>
          accepted & (1 << i) ? [] : takenBack(text, mark, deletions, limit, shown),
        );
        const reverted = applied(view, from, to, edits);
        if (reverted === undefined) return false;
        read.add(reverted);
      }
    }
    ways.set(
      r,
      [...read].map((way) => way.split('\n').map((line) => line.replace(/\r$/, ''))),
    );
  }
  // The item's indentation, in each view where a change of it can move it.
  const owns = new Set([/^[ \t]*/.exec(view.slice(at, lineEnd(view, at)))?.[0].length ?? 0]);
  if (/(?:^| )was=indent/.test(payload)) {
    const old = original();
    const item = old.map.fromSource(top);
    owns.add(/^[ \t]*/.exec(old.text.slice(item, lineEnd(old.text, item)))?.[0].length ?? 0);
  }
  // A blank line: what is below it starts afresh.
  const step = (state: ListState, line: string, own: number) =>
    blank(line) ? LIST_START : listStep(state, line, own, delimiter);
  for (const own of owns) {
    let states: ListState[] = [LIST_START];
    for (let i = 0; i < lines.length;) {
      const r = root(i);
      const read = ways.get(r);
      if (!read) {
        // A line that reads the same in every decision.
        const line = lines[i];
        const text = line ? view.slice(line.start, line.end) : '';
        const next: ListState[] = [];
        for (const state of states) {
          const now = step(state, text, own);
          if (!now) return false;
          next.push(now);
        }
        states = next.length > 1 ? distinct(next) : next;
        i++;
        continue;
      }
      const next: ListState[] = [];
      for (const state of states) {
        for (const way of read) {
          let now: ListState | undefined = state;
          for (const line of way) {
            now = step(now, line, own);
            if (!now) return false;
          }
          next.push(now);
        }
      }
      states = distinct(next);
      i++;
      while (i < lines.length && root(i) === r) i++;
    }
    for (const state of states) if (!listGoesOn(state)) return false;
  }
  return true;
}

/** The states, each once. */
function distinct(states: ListState[]): ListState[] {
  const seen = new Map<string, ListState>();
  for (const state of states) seen.set(key(state), state);
  return [...seen.values()];
}

function key(state: ListState): string {
  return `${state.list} ${state.paragraph} ${state.column}`;
}

/**
 * Whether a substitution only renumbers list items: its old and new text are the same but for the
 * numbers at the start of their lines, as wide as each other and none of them 1. A numbered item
 * from 2 reads the same after either.
 */
function renumbers(text: string, mark: MarkRange): boolean {
  return mark.segments.every((segment) => {
    const now = text.slice(segment.content.from, segment.content.to);
    const was = segment.payload ?? mark.payload ?? '';
    if (now.includes('<!--')) return false;
    let one = false;
    const numberless = (s: string) =>
      s.replace(
        /(^|\n)([ \t]*)(\d{1,9})(?=[.)])/g,
        (_, before: string, indent: string, n: string) => {
          if (Number(n) === 1) one = true;
          return `${before}${indent}${'#'.repeat(n.length)}`;
        },
      );
    return numberless(now) === numberless(was) && now !== was && !one;
  });
}

/** The edits, in offsets of the newest view, that take a change back. */
function takenBack(
  text: string,
  mark: MarkRange,
  deletions: readonly Segment[],
  limit: number | undefined,
  shown: (range: Range) => Range,
): Edit[] {
  return mark.segments.map((segment) => {
    const payload = segment.payload ?? mark.payload ?? '';
    if (mark.kind === 'del') {
      const at = shown({ from: segment.open.from, to: segment.open.from }).from;
      return { from: at, to: at, insert: payload };
    }
    if (mark.kind === 'split') {
      const range = shown({
        from: segment.open.to,
        to: splitEnd(text, segment.open, deletions, limit),
      });
      return { ...range, insert: '' };
    }
    const range = shown(segment.content);
    return { ...range, insert: mark.kind === 'sub' ? payload : '' };
  });
}

/** The text of the view between `from` and `to` with the edits made, or undefined where they
 * overlap or reach outside it. An edit inside another, as a split inside an insertion that is
 * taken back, goes with it. */
function applied(view: string, from: number, to: number, edits: Edit[]): string | undefined {
  // Inside another: an insertion strictly inside a stretch that is taken out, or a stretch within
  // one (the first of two that are the same).
  const inside = (edit: Edit, i: number) =>
    edits.some((other, j) => {
      if (j === i || other.to === other.from) return false;
      if (edit.to === edit.from) return other.from < edit.from && edit.from < other.to;
      const within = other.from <= edit.from && edit.to <= other.to;
      return within && (other.from < edit.from || edit.to < other.to || j < i);
    });
  const outer = edits.filter((edit, i) => !inside(edit, i));
  outer.sort((a, b) => b.from - a.from || b.to - a.to);
  let result = view.slice(from, to);
  let floor = Infinity;
  for (const edit of outer) {
    if (edit.from < from || edit.to > to || edit.to > floor) return undefined;
    result = result.slice(0, edit.from - from) + edit.insert + result.slice(edit.to - from);
    floor = edit.from;
  }
  return result;
}

const deletionsOf = new WeakMap<Parsed, Segment[]>();

/** Where a pending change reaches in the text, its markers and what it inserted with them: a
 * split's line break and prefix, a deletion's carrier. */
export function pendingReach(
  text: string,
  parsed: Parsed,
  mark: MarkRange,
  segment: Segment,
): Range {
  if (mark.kind === 'split') {
    let deletions = deletionsOf.get(parsed);
    if (!deletions) {
      deletions = parsed.marks.flatMap((m) => (m.kind === 'del' ? m.segments : []));
      deletionsOf.set(parsed, deletions);
    }
    const end = splitEnd(text, segment.open, deletions, parsed.ledgerRange?.from);
    return { from: segment.open.from, to: end };
  }
  if (mark.kind === 'del') return openerRange(segment);
  return { from: segment.open.from, to: (segment.close ?? segment.open).to };
}

/** Whether a pending insertion, deletion, substitution or split reaches over the line break at
 * `from - 1` or into the text up to `to`: the blank line there may not be there. */
function pendingOver(text: string, parsed: Parsed, from: number, to: number): boolean {
  return parsed.marks.some(
    (mark) =>
      (mark.kind === 'ins' ||
        mark.kind === 'del' ||
        mark.kind === 'sub' ||
        mark.kind === 'split') &&
      mark.segments.some((segment) => {
        if (segment.open.from >= to) return false;
        const end = (segment.close ?? segment.open).to;
        // A split reaches past its marker, over the line break and the white space it wrote.
        if (end < from - 1 && (mark.kind !== 'split' || /[^\s>]/.test(text.slice(end, from - 1)))) {
          return false;
        }
        const reach = pendingReach(text, parsed, mark, segment);
        return reach.from < to && reach.to > from - 1;
      }),
  );
}

/**
 * Where the lines right above `top` start that touch it (`touchingAbove`), in offsets of `text`,
 * reading on past a blank line that a pending change wrote, or that one stands at: once it is
 * rejected, the lines above the blank line touch them.
 */
export function linesAboveStart(text: string, parsed: Parsed, top: number): number {
  const blank = (start: number) => /^[ \t>]*\r?$/.test(text.slice(start, lineEnd(text, start)));
  let first = touchingAbove(text, top);
  for (;;) {
    let gap = first;
    while (gap > 0 && blank(lineStart(text, gap - 1))) gap = lineStart(text, gap - 1);
    if (gap === 0 || gap === first || !pendingOver(text, parsed, gap, first)) return first;
    first = touchingAbove(text, lineStart(text, gap - 1));
  }
}

/**
 * Whether a blank line stands between the line of `from` and `top`, wholly after the one and before
 * the other, that no pending change wrote or stands at: the lines up to it don't touch a block
 * that starts at `top`, in any decision.
 */
export function blankBetween(text: string, parsed: Parsed, from: number, top: number): boolean {
  for (let at = nextLineStart(text, from); at < top; at = nextLineStart(text, at)) {
    if (!/^[ \t>]*\r?$/.test(text.slice(at, lineEnd(text, at)))) continue;
    if (!pendingOver(text, parsed, at, nextLineStart(text, at))) return true;
  }
  return false;
}

/**
 * Where a pending change stands at the start of a line, in its indentation, list marker or right
 * at the start of its text, as the newest view `newest` reads the lines: the offsets of its
 * openers in `text`. A change there can make the line an item, or not, or empty.
 */
export function lineStartsTouched(
  text: string,
  parsed: Parsed,
  mark: MarkRange,
  newest: DocView,
): number[] {
  if (mark.kind !== 'ins' && mark.kind !== 'del' && mark.kind !== 'sub') return [];
  const view = newest.text;
  return mark.segments
    .filter((segment) => {
      const reach = pendingReach(text, parsed, mark, segment);
      const from = newest.map.fromSource(reach.from);
      const to = newest.map.fromSource(reach.to);
      const line = lineStart(view, from);
      const start = line + listPrefixLength(view.slice(line, lineEnd(view, line)));
      return from <= start && line <= to;
    })
    .map((segment) => segment.open.from);
}
