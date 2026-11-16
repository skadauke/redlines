// A cheap scan of the whole document for the places where Markdown starts fresh (design,
// Performance): a line that begins a block with nothing before it that could still be open. A jump
// far past what the full parse has reached is drawn from the nearest of these (`parse.ts`), parsed
// as if the document began there. It reads each line once, with a few regular expressions: a few
// milliseconds for megabytes. Nothing here is a parse: a rule it misses only makes the first drawing
// of a far place differ from the full parse's, which then corrects it.

import type { Text } from '@codemirror/state';

/** A stretch of the document. */
export interface Span {
  from: number;
  to: number;
}

/** What the scan found. */
export interface Scan {
  /** The start of each line where a block begins afresh, in order. */
  restarts: number[];
  /** The link reference definitions (`[label]: url`, on one line), which links elsewhere resolve to. */
  refs: Span[];
}

/** The most definitions kept: a document that holds more reads them from its first part. */
const MAX_REFS = 4000;

const FENCE = /^\s*(`{3,}|~{3,})/;
const LIST_ITEM = /^(?:[-+*]|\d{1,9}[.)])(?:\s|$)/;
const REF = /^ {0,3}\[(?:[^\]\\\n]|\\.)+\]:[ \t]*\S/;
/** The HTML blocks that end at a line with their own closing text (CommonMark's types 1 to 5). */
const HTML_ENDS: readonly [RegExp, RegExp][] = [
  [/^ {0,3}<(?:script|pre|style|textarea)(?:\s|>|$)/i, /<\/(?:script|pre|style|textarea)>/i],
  [/^ {0,3}<!--/, /-->/],
  [/^ {0,3}<\?/, /\?>/],
  [/^ {0,3}<![A-Za-z]/, />/],
  [/^ {0,3}<!\[CDATA\[/, /\]\]>/],
];
/** The HTML blocks that end at a blank line (types 6 and 7). */
const HTML_BLOCK =
  /^ {0,3}(?:<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|section|source|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:\s|\/?>|$)|<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^>]*)?\/?>\s*$)/i;

/** Scans `doc`: where Markdown starts fresh, and the link definitions. */
export function scan(doc: Text): Scan {
  const restarts: number[] = [];
  const refs: Span[] = [];
  let pos = 0;
  let previousBlank = true;
  let fence: { char: string; size: number } | null = null;
  let htmlEnd: RegExp | null = null;
  let htmlToBlank = false;
  let frontMatter = false;
  let lineNo = 0;
  /** The line before was a definition, after which another may follow with no blank line. */
  let afterRef = false;
  for (const line of doc.iterLines()) {
    const start = pos;
    pos += line.length + 1;
    lineNo++;
    const wasRef: boolean = afterRef;
    afterRef = false;
    const blank = line.trim() === '';
    if (lineNo === 1 && line.trimEnd() === '---') {
      frontMatter = true;
      previousBlank = false;
      continue;
    }
    if (frontMatter) {
      if (line.trimEnd() === '---' || line.trimEnd() === '...') {
        frontMatter = false;
        previousBlank = true;
      }
      continue;
    }
    if (fence) {
      const close = FENCE.exec(line);
      if (
        close &&
        close[1]![0] === fence.char &&
        close[1]!.length >= fence.size &&
        /^\s*\S+\s*$/.test(line)
      )
        fence = null;
      previousBlank = false;
      continue;
    }
    if (htmlEnd) {
      if (htmlEnd.test(line)) htmlEnd = null;
      previousBlank = false;
      continue;
    }
    if (htmlToBlank) {
      if (blank) {
        htmlToBlank = false;
        previousBlank = true;
      }
      continue;
    }
    if (blank) {
      previousBlank = true;
      continue;
    }
    const first = line.charCodeAt(0);
    const indented = first === 32 || first === 9;
    const opening = FENCE.exec(line);
    if (
      opening &&
      !(
        opening[1]![0] === '`' &&
        line.indexOf('`', line.indexOf(opening[1]!) + opening[1]!.length) >= 0
      )
    ) {
      if (previousBlank && !indented) restarts.push(start);
      fence = { char: opening[1]![0]!, size: opening[1]!.length };
      previousBlank = false;
      continue;
    }
    if (first === 60 /* < */ || (indented && line.trimStart().startsWith('<'))) {
      let html = false;
      for (const [open, close] of HTML_ENDS) {
        if (!open.test(line)) continue;
        html = true;
        if (previousBlank && !indented) restarts.push(start);
        if (!close.test(line.slice(open.exec(line)![0].length))) htmlEnd = close;
        break;
      }
      if (!html && HTML_BLOCK.test(line)) {
        html = true;
        if (previousBlank && !indented) restarts.push(start);
        htmlToBlank = true;
      }
      if (html) {
        previousBlank = false;
        continue;
      }
    }
    const isRef: boolean = !indented && (previousBlank || wasRef) && REF.test(line);
    if (isRef && refs.length < MAX_REFS) refs.push({ from: start, to: start + line.length });
    if (previousBlank && !indented && !LIST_ITEM.test(line)) restarts.push(start);
    afterRef = isRef;
    previousBlank = false;
  }
  return { restarts, refs };
}

/**
 * The last place where Markdown starts fresh at or before `pos`, or null when there is none: the
 * place to parse from for what is drawn at `pos`.
 */
export function restartBefore(restarts: readonly number[], pos: number): number | null {
  let lo = 0;
  let hi = restarts.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (restarts[mid]! <= pos) lo = mid + 1;
    else hi = mid;
  }
  return lo === 0 ? null : restarts[lo - 1]!;
}
