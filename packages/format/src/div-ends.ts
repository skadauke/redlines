// A comment or a highlight whose range starts or ends on a `:::` line, the fence of a pandoc div
// (format §3.1, rule 9: pandoc takes a fence only when nothing else is on its line). It is not refused:
// the end is widened. A range that reaches out of the div, or is only on its fences, takes the whole div,
// with its opener alone on the line before the opening fence and its closer alone on the line after
// the closing fence (as for an include, include.ts); a range that is inside the div, with one end
// on a fence, is pulled in to the div's body. Pandoc files only.

import { isPandoc } from './dialect.ts';
import { frontMatterEnd, lineEnd, lineStart } from './blocks.ts';
import type { AroundInclude } from './include.ts';
import type { Range } from './types.ts';

/** A fenced div: the lines of its fences, as ranges without their line breaks. */
interface Div {
  open: Range;
  close: Range;
}

const OPENING = /^ {0,3}:{3,}[ \t]*\S/;
const CLOSING = /^ {0,3}:{3,}[ \t]*$/;
const CODE_FENCE = /^[ \t]*(`{3,}|~{3,})/;

/** The closed divs of a text, in the order of their opening fences; code and front matter hold none. */
function divsOf(text: string): Div[] {
  const divs: Div[] = [];
  const open: Range[] = [];
  let code: string | null = null;
  const front = frontMatterEnd(text);
  let at = front === -1 ? 0 : front + 1;
  while (at <= text.length) {
    const end = lineEnd(text, at);
    const line = text.slice(at, end).replace(/\r$/, '');
    const fence = CODE_FENCE.exec(line);
    if (code !== null) {
      if (
        fence?.[1] &&
        fence[1][0] === code[0] &&
        fence[1].length >= code.length &&
        /^[ \t]*$/.test(line.slice(fence[0].length))
      ) {
        code = null;
      }
    } else if (fence?.[1]) {
      code = fence[1];
    } else if (CLOSING.test(line)) {
      const opener = open.pop();
      if (opener) divs.push({ open: opener, close: { from: at, to: end } });
    } else if (OPENING.test(line)) open.push({ from: at, to: end });
    if (end >= text.length) break;
    at = text.indexOf('\n', end) + 1;
    if (at === 0) break;
  }
  return divs;
}

const OPENER_LINE = /^<!--(?:cmt|hl|fmt) [^>]*-->\r?$/;
const CLOSER_LINE = /^(?:<!--\/\w+-->)+\r?$/;

/** The start of the lines above `at` that hold only the openers of marks around the div that starts
 * there (a change of a callout's type has a blank line under its opener, which goes with it). */
function outsideOpeners(text: string, at: number): number {
  let start = at;
  while (start > 0) {
    const above = lineStart(text, start - 1);
    const content = text.slice(above, start - 1).replace(/\r$/, '');
    if (OPENER_LINE.test(content)) {
      start = above;
      continue;
    }
    if (content.trim() === '' && above > 0) {
      const over = lineStart(text, above - 1);
      if (/^<!--fmt [^>]*-->\r?$/.test(text.slice(over, above - 1))) {
        start = over;
        continue;
      }
    }
    break;
  }
  return start;
}

/** The end of the lines under `at` that hold only the closers of the marks around the div. */
function outsideClosers(text: string, at: number): number {
  let end = at;
  for (;;) {
    const below = end + (text[end] === '\r' ? 2 : 1);
    if (end >= text.length || below > text.length) return end;
    const last = lineEnd(text, below);
    if (!CLOSER_LINE.test(text.slice(below, last))) return end;
    end = last;
  }
}

/** What a range comes to once its ends are off the fences. */
interface FencedRange {
  /** The range to place with the usual rules, none of whose ends is on a fence line. */
  inner: Range;
  /** Where both ends go out of divs: the whole div, with no other placing to do. */
  whole?: AroundInclude;
  /** The placed range, with the ends that were out of a div taken to the div's fences. */
  apply(placed: AroundInclude): AroundInclude;
}

const onLine = (line: Range, position: number) => position >= line.from && position <= line.to;

/** The innermost div that has a fence on the line of `position`. */
function fenceAt(divs: readonly Div[], position: number): Div | undefined {
  return divs
    .filter((div) => onLine(div.open, position) || onLine(div.close, position))
    .toSorted((a, b) => b.open.from - a.open.from)[0];
}

/** Whether `position` is in the body of `div`: on a line between its fences. */
const inBody = (div: Div, position: number) => position > div.open.to && position < div.close.from;

/**
 * The range with its ends off the fences: an end on a fence of a div that the other end is inside
 * of is pulled in to the body, and any other goes out to the whole div.
 */
export function aroundFences(text: string, range: Range): FencedRange {
  const same: FencedRange = { inner: range, apply: (placed) => placed };
  if (!isPandoc() || !text.includes(':::')) return same;
  const divs = divsOf(text);
  // A range that ends with the line break of a closing fence ends on the fence.
  if (range.to > range.from && text[range.to - 1] === '\n') {
    const end = range.to - (text[range.to - 2] === '\r' ? 2 : 1);
    if (divs.some((div) => div.close.to === end)) range = { from: range.from, to: end };
  }
  const first = fenceAt(divs, range.from);
  const last = fenceAt(divs, range.to);
  const bodyStart = (div: Div) => div.open.to + (text[div.open.to] === '\r' ? 2 : 1);
  const bodyEnd = (div: Div) => lineEnd(text, div.close.from - 1);
  // A start at the first column of a body's first line has the fence above it, where its opener
  // would go: it takes a line of its own under the fence.
  const firstLine = divs.some(
    (div) => bodyStart(div) === range.from && bodyStart(div) < div.close.from,
  );
  if (!first && !last && !firstLine) return same;
  // The ends that are not placed by the usual rules: where each goes, on a line of its own.
  let startAt: number | undefined;
  let endAt: number | undefined;
  if (first) startAt = inBody(first, range.to) ? bodyStart(first) : first.open.from;
  else if (firstLine) startAt = range.from;
  if (last) endAt = inBody(last, range.from) ? bodyEnd(last) : last.close.to;
  // Marks already around the div stand outside it: their openers above its opening fence, and their
  // closers under its closing fence. The new ones go outside them, so that no two cross.
  if (startAt !== undefined && first && startAt === first.open.from)
    startAt = outsideOpeners(text, startAt);
  if (endAt !== undefined && last && endAt === last.close.to) endAt = outsideClosers(text, endAt);
  const apply = (placed: AroundInclude): AroundInclude => {
    const a = startAt ?? placed.from;
    const b = endAt ?? placed.to;
    return {
      from: a,
      to: Math.max(a, b),
      openerLine: startAt !== undefined || placed.openerLine,
      closerLine: endAt !== undefined || placed.closerLine,
    };
  };
  if (startAt !== undefined && endAt !== undefined) {
    return {
      inner: range,
      whole: apply({ from: startAt, to: endAt, openerLine: false, closerLine: false }),
      apply,
    };
  }
  // The other end is placed as a point, by the usual rules, and the end on the fence is set after.
  // (A point at the first column of a body is the opener's alone.)
  if (startAt !== undefined && !first && range.from === range.to) {
    return {
      inner: range,
      whole: apply({ from: startAt, to: startAt, openerLine: false, closerLine: false }),
      apply,
    };
  }
  const other = startAt === undefined ? range.from : range.to;
  return { inner: { from: other, to: other }, apply };
}
