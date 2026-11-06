// Whether a numbered item that doesn't start at 1 is read as an item however the pending changes
// in the lines right above it are decided (format §2.6).
//
// Those lines are read in the newest view from the top, keeping every state of the list they can
// be in (`ListState`), and the line being read in each, summed up to what the list can read of it
// (`lineSoFar`). Where a change that can change how they read starts (one that holds a line break,
// or that stands at the start of a line, or another block's change of type), the reading goes on
// both ways: with the change accepted, as the newest view has it, and with it rejected, its text
// taken out and its old text put in. States that are the same are kept once, and the sum tells
// lines apart by their shape, not their words, so the states are bounded at each line and the work
// grows with the lines, not with the changes. Each change is decided on its own at each place it
// stands, which takes in every decision of them and more.

import {
  LIST_START,
  indentColumns,
  lineEnd,
  lineSoFar,
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

/** A stretch of the newest view that a change wrote, and what stands there with it rejected. */
interface Region {
  from: number;
  to: number;
  old: string;
}

/** A reading of the lines: the list's state, the line read so far (summed up, `lineSoFar`), and
 * where a rejected change that is being passed over ends. */
interface Reading {
  list: ListState;
  line: string;
  skip: number;
}

/**
 * Whether the numbered item from 2 with `delimiter`, on the line of `text` that starts at `top`, is
 * read as an item in every decision of the pending changes in the lines right above it that touch
 * it (`linesAboveStart`). `newest` is the newest view of `text`, `original` its original view (asked
 * for only where a change of another block's type stands in those lines, or the item's indentation
 * is changed), and `payload` that of the item's block change.
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
  const sourceFirst = linesAboveStart(text, parsed, top);
  const first = lineStart(view, newest.map.fromSource(sourceFirst));
  if (first >= at) return true;
  // Where each line starts, and where its text starts after its prefix.
  const starts: number[] = [];
  const texts: number[] = [];
  for (let line = first; line < at; line = nextLineStart(view, line)) {
    starts.push(line);
    texts.push(line + listPrefixLength(view.slice(line, lineEnd(view, line))));
  }
  const lineOf = (position: number) => {
    let low = 0;
    let high = starts.length - 1;
    let found = -1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if ((starts[middle] ?? 0) <= position) {
        found = middle;
        low = middle + 1;
      } else high = middle - 1;
    }
    return found;
  };
  const shown = (range: Range): Range => ({
    from: newest.map.fromSource(range.from),
    to: newest.map.fromSource(range.to),
  });
  // A stretch that touches the start of a line: its indentation, list marker or the start of its
  // text.
  const atStart = (range: Range) => {
    for (let i = Math.max(0, lineOf(range.from)); i <= lineOf(range.to); i++) {
      if (range.from <= (texts[i] ?? -1) && (starts[i] ?? Infinity) <= range.to) return true;
    }
    return false;
  };
  // The changes in the lines, with where each stands in the newest view.
  const near: { mark: MarkRange; segment: Segment; shown: Range }[] = [];
  for (const mark of parsed.marks) {
    if (mark.kind === 'hl' || mark.kind === 'cmt') continue;
    if (mark.kind === 'sub' && renumbers(text, mark)) continue;
    for (const segment of mark.segments) {
      if (segment.open.from > top) continue;
      const end = (segment.close ?? segment.open).to;
      if (
        end < sourceFirst &&
        (mark.kind !== 'split' || /[^\s>]/.test(text.slice(end, sourceFirst)))
      ) {
        continue;
      }
      const range = shown(pendingReach(text, parsed, mark, segment));
      if (range.to < first || range.from >= at) continue;
      near.push({ mark, segment, shown: range });
    }
  }
  // A change that holds a line break, or whose old text does: rejected, it brings lines back,
  // and a change at their start stands at the start of a line too.
  const breaks = (mark: MarkRange, segment: Segment) =>
    mark.kind === 'split' ||
    (mark.kind !== 'ins' && (segment.payload ?? mark.payload ?? '').includes('\n')) ||
    (mark.kind !== 'del' && text.slice(segment.content.from, segment.content.to).includes('\n'));
  const brought = near
    .filter(({ mark, segment }) => mark.kind !== 'ins' && breaks(mark, segment))
    .map(({ shown: range }) => range.from);
  const regions: Region[] = [];
  for (const { mark, segment, shown: range } of near) {
    const old = segment.payload ?? mark.payload ?? '';
    if (mark.kind === 'fmt') {
      // Another block's change of type: its lines with the syntax they had, from the original view.
      if (range.from < first || range.to > at) return false;
      for (let i = Math.max(0, lineOf(range.from)); i <= lineOf(range.to); i++) {
        const line = starts[i] ?? 0;
        const was = original();
        const place = was.map.fromSource(newest.map.toSource(line, -1));
        const wasLine = was.text.slice(lineStart(was.text, place), lineEnd(was.text, place));
        regions.push({
          from: line,
          to: texts[i] ?? line,
          old: wasLine.slice(0, listPrefixLength(wasLine)),
        });
      }
      continue;
    }
    const counts =
      breaks(mark, segment) ||
      atStart(range) ||
      brought.some((position) => range.from <= position && position <= range.to);
    if (!counts) continue;
    // A change that reaches above the lines, or into the item's line, may move where they start
    // or end: that is taken not to go on.
    if (range.from < first || range.to >= at) return false;
    if (mark.kind === 'split') {
      const reach = shown({
        from: segment.open.to,
        to: pendingReach(text, parsed, mark, segment).to,
      });
      regions.push({ ...reach, old: '' });
    } else if (mark.kind === 'del') {
      regions.push({ from: range.from, to: range.from, old });
    } else {
      const content = shown(segment.content);
      regions.push({ ...content, old: mark.kind === 'sub' ? old : '' });
    }
  }
  // In order; where changes start at one place, a deletion first, so that a rejected insertion
  // there doesn't pass over it, then an outer change before one within it.
  const point = (region: Region) => (region.to === region.from ? 0 : 1);
  regions.sort((a, b) => a.from - b.from || point(a) - point(b) || b.to - a.to);
  // The item's indentation, in each view where a change of it can move it.
  const owns = new Set([indentColumns(view.slice(at, lineEnd(view, at)))]);
  if (/(?:^| )was=indent/.test(payload)) {
    const was = original();
    const item = was.map.fromSource(top);
    owns.add(indentColumns(was.text.slice(item, lineEnd(was.text, item))));
  }
  for (const own of owns) {
    // Reads `chunk` on from `reading`: each line break ends a line, which the list reads. The line
    // left over is kept as what the list can read of it, which words typed onto it don't change.
    const read = (reading: Reading, chunk: string, skip: number): Reading | undefined => {
      let { list, line } = reading;
      let from = 0;
      for (let next = chunk.indexOf('\n'); next >= 0; next = chunk.indexOf('\n', from)) {
        const done = listStep(
          list,
          (line + chunk.slice(from, next)).replace(/\r$/, ''),
          own,
          delimiter,
        );
        if (!done) return undefined;
        list = done;
        line = '';
        from = next + 1;
      }
      return { list, line: lineSoFar(line + chunk.slice(from), own), skip };
    };
    let readings = new Map<string, Reading>();
    const keep = (reading: Reading) => readings.set(keyOf(reading), reading);
    keep({ list: LIST_START, line: '', skip: -1 });
    // Reads every reading on to `to`, passing over what a rejected change takes out.
    let at0 = first;
    const advance = (to: number) => {
      const was = readings;
      readings = new Map();
      for (const reading of was.values()) {
        if (reading.skip >= to) {
          keep(reading);
          continue;
        }
        const next = read(reading, view.slice(Math.max(at0, reading.skip), to), -1);
        if (!next) return false;
        keep(next);
      }
      at0 = to;
      return true;
    };
    for (const region of regions) {
      if (!advance(region.from)) return false;
      const was = readings;
      readings = new Map();
      for (const reading of was.values()) {
        keep(reading);
        // Inside a change that is passed over, this one goes with it.
        if (reading.skip > region.from) continue;
        const rejected = read(reading, region.old, region.to > region.from ? region.to : -1);
        if (!rejected) return false;
        keep(rejected);
      }
    }
    if (!advance(at)) return false;
    for (const reading of readings.values()) {
      // A reading that ran the item's line into the line above it doesn't read it as an item.
      if (reading.line !== '' || reading.skip > at || !listGoesOn(reading.list)) return false;
    }
  }
  return true;
}

function keyOf(reading: Reading): string {
  const { list } = reading;
  const flags = [list.list, list.paragraph, list.inner, list.fresh, list.code].map(Number).join('');
  return `${flags}${list.column} ${reading.skip} ${reading.line}`;
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

/** The reaches of the pending insertions, deletions, substitutions and splits of a text, sorted by
 * where they start, with the furthest end of each and those before it. */
const reachesOf = new WeakMap<Parsed, { from: number[]; furthest: number[] }>();

/** Whether a pending insertion, deletion, substitution or split reaches over the line break at
 * `from - 1` or into the text up to `to`: the blank line there may not be there. */
function pendingOver(text: string, parsed: Parsed, from: number, to: number): boolean {
  let reaches = reachesOf.get(parsed);
  if (!reaches) {
    const ranges = parsed.marks
      .filter(
        (mark) =>
          mark.kind === 'ins' ||
          mark.kind === 'del' ||
          mark.kind === 'sub' ||
          mark.kind === 'split',
      )
      .flatMap((mark) => mark.segments.map((segment) => pendingReach(text, parsed, mark, segment)))
      .sort((a, b) => a.from - b.from);
    let furthest = -1;
    reaches = {
      from: ranges.map((range) => range.from),
      furthest: ranges.map((range) => (furthest = Math.max(furthest, range.to))),
    };
    reachesOf.set(parsed, reaches);
  }
  // The last reach that starts before `to`; any up to it that ends after `from - 1`.
  let low = 0;
  let high = reaches.from.length - 1;
  let last = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if ((reaches.from[middle] ?? 0) < to) {
      last = middle;
      low = middle + 1;
    } else high = middle - 1;
  }
  return last >= 0 && (reaches.furthest[last] ?? -1) > from - 1;
}

const blankLine = (text: string, start: number) =>
  /^[ \t>]*\r?$/.test(text.slice(start, lineEnd(text, start)));
const indentAt = (text: string, start: number) =>
  indentColumns(text.slice(start, lineEnd(text, start)));

/**
 * Where the lines right above `top` start that touch it (`touchingAbove`), in offsets of `text`,
 * reading on past a blank line that a pending change wrote, or that one stands at (once it is
 * rejected, the lines above it touch them), past one before a line indented more than the item at
 * `top` (more of an item above, as its second paragraph), and past one after code, which a numbered
 * item from 2 can't follow.
 */
export function linesAboveStart(text: string, parsed: Parsed, top: number): number {
  const own = indentAt(text, top);
  let first = touchingAbove(text, top);
  for (;;) {
    let gap = first;
    while (gap > 0 && blankLine(text, lineStart(text, gap - 1))) gap = lineStart(text, gap - 1);
    if (gap === 0 || gap === first) return first;
    const above = lineStart(text, gap - 1);
    if (
      indentAt(text, first) <= own &&
      indentAt(text, above) - own < 4 &&
      !pendingOver(text, parsed, gap, first)
    ) {
      return first;
    }
    first = touchingAbove(text, above);
  }
}

/**
 * Whether a blank line stands between the line of `from` and `top`, wholly after the one and before
 * the other, that no pending change wrote or stands at, and that no line indented more than the
 * item at `top` follows: the lines up to it don't touch a block that starts at `top`, in any
 * decision (`linesAboveStart`).
 */
export function blankBetween(text: string, parsed: Parsed, from: number, top: number): boolean {
  const own = indentAt(text, top);
  for (let at = nextLineStart(text, from); at < top; at = nextLineStart(text, at)) {
    if (!blankLine(text, at)) continue;
    let after = at;
    while (after < top && blankLine(text, after)) after = nextLineStart(text, after);
    const before = lineStart(text, Math.max(0, at - 1));
    if (
      indentAt(text, after) <= own &&
      indentAt(text, before) - own < 4 &&
      !pendingOver(text, parsed, at, after)
    ) {
      return true;
    }
    at = lineStart(text, after);
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
