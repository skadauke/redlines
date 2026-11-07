// The blocks of a few lines of Markdown as CommonMark reads them (format §3.4), to tell whether a
// blank line between two blocks changes what is rendered: the kind of each block, its text, and the
// containers it is in, quotes (with their lazy lines) and list items. It reads a run of whole lines
// that starts at the top level, and gives nothing (undefined) where it meets what it does not read:
// a tab, an empty list item, an item whose text is indented as code, a lazy line that looks like
// the underline of a heading, a line that only a lone tag would make an HTML block, a link
// reference definition, an item right after indented code, indented code right after the end of a
// container, a fence or an HTML block that the end of its container ends, or one still open at the
// end of the run. It is not a Markdown parser: it reads blocks, not what is inside them. Where
// micromark reads otherwise than CommonMark, it gives nothing too.

/** A block as read: a leaf block, or the start of a container. */
export interface BlockRead {
  /** The containers it is in, outermost first: `q` for a quote and `i` for an item, each with a
   * number in the order they start. A container's own path ends with itself. */
  path: string;
  /** `paragraph`, `h1` to `h6`, `rule`, `fence`, `code`, `html`, or `quote` or `item` for the start
   * of a container. */
  kind: string;
  /** Its text: a paragraph's lines without their indentation, a heading's text, a fence's info
   * string and lines, or an item's marker. */
  text: string;
  /** The lines of the run it is on, the first and the last, counted from 0. */
  first: number;
  last: number;
}

interface Container {
  kind: 'quote' | 'item';
  id: string;
  /** For an item: the column its text starts at. */
  column: number;
}

type Leaf =
  | { kind: 'paragraph'; first: number; last: number; lines: string[] }
  | { kind: 'code'; first: number; last: number; lines: string[] }
  | { kind: 'fence'; first: number; last: number; lines: string[]; fence: string; indent: number }
  | { kind: 'html'; first: number; last: number; lines: string[]; end: RegExp | null };

const QUOTE = /^ {0,3}> ?/;
const ITEM = /^ {0,3}(?:[-*+]|(\d{1,9})[.)])(?= |$)/;
const RULE = /^ {0,3}(?:(?:\* *){3,}|(?:- *){3,}|(?:_ *){3,})$/;
const ATX = /^ {0,3}(#{1,6})(?: +(.*?))??(?: +#+)? *$/;
const UNDERLINE = /^ {0,3}(=+|-+) *$/;
const FENCE = /^( {0,3})(`{3,}|~{3,})(.*)$/;
/** The starts of the HTML blocks that may end a paragraph (CommonMark's types 1 to 6), each with
 * the end of its block: null for one that a blank line ends. */
const HTML_STARTS: readonly (readonly [RegExp, RegExp | null])[] = [
  [/^ {0,3}<(?:script|pre|style|textarea)(?:\s|>|$)/i, /<\/(?:script|pre|style|textarea)>/i],
  [/^ {0,3}<!--/, /-->/],
  [/^ {0,3}<\?/, /\?>/],
  [/^ {0,3}<![A-Za-z]/, />/],
  [/^ {0,3}<!\[CDATA\[/, /\]\]>/],
  [
    /^ {0,3}<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:\s|\/?>|$)/i,
    null,
  ],
];
/** The start of a link reference definition, which is no paragraph, and leaves none for the
 * underline of a heading after it. */
const DEFINITION = /^ {0,3}\[(?:[^\]\\]|\\.)+\]:/;
/** A tag at the start of a line, which may start an HTML block that no paragraph is ended by. */
const TAG = /^ {0,3}<\/?[A-Za-z]/;

const indentOf = (line: string) => line.length - line.trimStart().length;

/** A fence that opens a block: a backtick fence's info string has no backtick. */
function fenceOf(rest: string): RegExpExecArray | null {
  const fence = FENCE.exec(rest);
  return fence && !(fence[2]?.startsWith('`') && fence[3]?.includes('`')) ? fence : null;
}

/** An item's marker at the start of `rest`, if it starts one, and whether the item is empty. */
function itemOf(rest: string): { marker: string; ordered?: string; empty: boolean } | undefined {
  if (RULE.test(rest)) return undefined;
  const item = ITEM.exec(rest);
  if (!item) return undefined;
  return {
    marker: item[0].trimStart(),
    ordered: item[1],
    empty: rest.slice(item[0].length).trim() === '',
  };
}

/**
 * Whether `rest`, on a line that lacks the markers of some of the containers above it, starts a
 * block: then it is no lazy line of the paragraph above. The paragraph is not among the blocks that
 * the line goes on with, so any item starts a list there, whatever its number, empty or not, and a
 * lone tag may start an HTML block (undefined: not read).
 */
function startsLazily(rest: string): boolean | undefined {
  if (indentOf(rest) >= 4) return false;
  if (QUOTE.test(rest) || RULE.test(rest) || ATX.test(rest) || fenceOf(rest)) return true;
  if (HTML_STARTS.some(([start]) => start.test(rest))) return true;
  if (TAG.test(rest)) return undefined;
  return itemOf(rest) !== undefined;
}

/**
 * The blocks of `text`, a run of whole lines that starts at the top level, in order; undefined
 * where it reads something that it does not know (see the top of this file).
 */
export function readBlocks(text: string): BlockRead[] | undefined {
  if (text.includes('\t')) return undefined;
  const blocks: BlockRead[] = [];
  const stack: Container[] = [];
  let leaf: Leaf | undefined;
  let made = 0;
  // Indented code ended on the last line of text, blank lines after it or not: micromark reads an
  // item there as though it were in a paragraph, which CommonMark does not. Not read.
  let afterCode = false;
  const path = () => stack.map((container) => container.id).join('');
  const close = () => {
    if (!leaf) return;
    const { kind, first, last, lines } = leaf;
    if (kind === 'code') while (lines.at(-1)?.trim() === '') lines.pop();
    const body = lines.join('\n');
    blocks.push({
      path: path(),
      kind,
      text: kind === 'paragraph' ? body.trimEnd() : body,
      first,
      last,
    });
    leaf = undefined;
  };
  const closeTo = (depth: number) => {
    close();
    stack.length = depth;
  };
  const lines = text.split('\n');
  for (const [n, raw] of lines.entries()) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    // The containers that the line goes on with.
    let pos = 0;
    let matched = 0;
    for (const container of stack) {
      const rest = line.slice(pos);
      if (container.kind === 'quote') {
        const quote = QUOTE.exec(rest);
        if (!quote) break;
        pos += quote[0].length;
      } else if (rest.trim() !== '') {
        if (pos + indentOf(rest) < container.column) break;
        pos = container.column;
      }
      matched++;
    }
    let rest = line.slice(pos);
    if (rest.trim() === '') {
      // A blank line is a line of a fence, of indented code (if more code follows) or of an HTML
      // block that goes on over blank lines; any other block ends with it, and so does a quote that
      // has no marker on it.
      const over =
        leaf?.kind === 'fence' ||
        leaf?.kind === 'code' ||
        (leaf?.kind === 'html' && leaf.end !== null);
      if (over && matched === stack.length && leaf) {
        leaf.lines.push(leaf.kind === 'code' ? rest.slice(4) : rest);
        leaf.last = n;
      } else closeTo(matched);
      continue;
    }
    const codeAbove = afterCode;
    const paragraphAbove = leaf?.kind === 'paragraph';
    afterCode = false;
    if (matched < stack.length) {
      // A line of a paragraph that lacks the markers of its containers goes on with it, lazily,
      // unless it starts a block.
      const starts = startsLazily(rest);
      if (starts === undefined) return undefined;
      if (leaf?.kind === 'paragraph' && !starts) {
        if (UNDERLINE.test(rest)) return undefined;
        leaf.lines.push(rest.trimStart());
        leaf.last = n;
        continue;
      }
      // Code right after a container that the line lacks the marker of, which micromark reads as
      // a code block for each line, or a fence or an HTML block that the end of its container
      // ends, which micromark gives a line more: not read.
      if (indentOf(rest) >= 4 || leaf?.kind === 'fence' || leaf?.kind === 'html') return undefined;
      closeTo(matched);
    } else if (leaf?.kind === 'fence' || leaf?.kind === 'html') {
      // A line of a fence or of an HTML block, which may be the last.
      if (leaf.kind === 'fence') {
        const end = FENCE.exec(rest);
        const closes =
          end !== null &&
          end[2]?.[0] === leaf.fence[0] &&
          (end[2]?.length ?? 0) >= leaf.fence.length &&
          end[3]?.trim() === '';
        leaf.last = n;
        if (closes) close();
        else leaf.lines.push(rest.slice(Math.min(leaf.indent, indentOf(rest))));
      } else {
        leaf.lines.push(rest);
        leaf.last = n;
        if (leaf.end?.test(rest)) close();
      }
      continue;
    }
    // The containers the line starts.
    for (let started = 0; ; started++) {
      const quote = QUOTE.exec(rest);
      const item = quote ? undefined : itemOf(rest);
      if (quote) {
        close();
        stack.push({ kind: 'quote', id: `q${made++}`, column: 0 });
        blocks.push({ path: path(), kind: 'quote', text: '', first: n, last: n });
        pos += quote[0].length;
      } else if (item) {
        // An empty item, or one numbered from another number than 1, does not end a paragraph
        // that the line goes on with. Behind a container the line starts in front of it, after a
        // paragraph, or after indented code, micromark reads it so too, which CommonMark does not:
        // not read.
        const weak = item.empty || (item.ordered !== undefined && item.ordered !== '1');
        if (weak && started === 0 && leaf?.kind === 'paragraph') break;
        if (weak && (codeAbove || (started > 0 && paragraphAbove))) return undefined;
        const spaces = indentOf(rest.slice(indentOf(rest) + item.marker.length));
        if (item.empty || spaces > 4) return undefined;
        close();
        pos += indentOf(rest) + item.marker.length + spaces;
        stack.push({ kind: 'item', id: `i${made++}`, column: pos });
        blocks.push({ path: path(), kind: 'item', text: item.marker, first: n, last: n });
      } else break;
      rest = line.slice(pos);
    }
    // A line of container markers and nothing else.
    if (rest.trim() === '') continue;
    const paragraph = leaf?.kind === 'paragraph' ? leaf : undefined;
    if (indentOf(rest) >= 4) {
      // Indented code, or a line of the paragraph, which code does not end.
      const target = paragraph ?? (leaf?.kind === 'code' ? leaf : undefined);
      if (target) {
        target.lines.push(paragraph ? rest.trimStart() : rest.slice(4));
        target.last = n;
      } else {
        close();
        leaf = { kind: 'code', first: n, last: n, lines: [rest.slice(4)] };
      }
      afterCode = paragraph === undefined;
      continue;
    }
    const atx = ATX.exec(rest);
    const underline = paragraph ? UNDERLINE.exec(rest) : null;
    const fence = fenceOf(rest);
    const html = HTML_STARTS.find(([start]) => start.test(rest));
    if (atx) {
      close();
      const heading = (atx[2] ?? '').trim();
      blocks.push({ path: path(), kind: `h${atx[1]?.length}`, text: heading, first: n, last: n });
    } else if (paragraph && underline) {
      // The underline of a heading, whose text is the paragraph's.
      const heading = paragraph.lines.join('\n').trimEnd();
      const kind = underline[1]?.startsWith('=') ? 'h1' : 'h2';
      blocks.push({ path: path(), kind, text: heading, first: paragraph.first, last: n });
      leaf = undefined;
    } else if (RULE.test(rest)) {
      close();
      blocks.push({ path: path(), kind: 'rule', text: '', first: n, last: n });
    } else if (fence) {
      close();
      const [, indent = '', marks = '', info = ''] = fence;
      const lines = [info.trim()];
      leaf = { kind: 'fence', first: n, last: n, lines, fence: marks, indent: indent.length };
    } else if (html) {
      close();
      leaf = { kind: 'html', first: n, last: n, lines: [rest], end: html[1] };
      if (html[1]?.test(rest)) close();
    } else if (paragraph) {
      paragraph.lines.push(rest.trimStart());
      paragraph.last = n;
    } else if (TAG.test(rest) || DEFINITION.test(rest)) {
      return undefined;
    } else {
      close();
      leaf = { kind: 'paragraph', first: n, last: n, lines: [rest.trimStart()] };
    }
  }
  if (leaf?.kind === 'fence' || (leaf?.kind === 'html' && leaf.end !== null)) return undefined;
  close();
  return blocks;
}

/**
 * Whether `head + blank + tail` and `head + close + tail` have the same blocks, where `blank` is
 * line breaks that leave a blank line between the last block of `head` and the first of `tail`, and
 * `close` leaves none (format §3.4): the same blocks, of the same kinds, with the same text, in the
 * same containers, which CommonMark renders the same. Not where it does not read the text, nor
 * where the two blocks are both in list items, whose list a blank line between them makes loose.
 */
export function sameBlocks(head: string, blank: string, close: string, tail: string): boolean {
  const wide = readBlocks(head + blank + tail);
  const narrow = readBlocks(head + close + tail);
  if (!wide || !narrow || wide.length !== narrow.length) return false;
  // The blocks of the last line of text above the line breaks and of the first line below them.
  const breaks = (s: string) => (s.match(/\n/g) ?? []).length;
  const rest = blank + tail;
  const above = breaks(head.trimEnd());
  const below = breaks(head) + breaks(rest.slice(0, rest.length - rest.trimStart().length));
  // A line is in the containers of the block that starts last on it or above it, the innermost.
  const inItem = (line: number) => {
    let latest: BlockRead | undefined;
    for (const block of wide) {
      if (block.first > line || (latest && block.first < latest.first)) continue;
      if (!latest || block.first > latest.first || block.path.length > latest.path.length) {
        latest = block;
      }
    }
    return latest?.path.includes('i') === true;
  };
  if (inItem(above) && inItem(below)) return false;
  return wide.every((block, i) => {
    const other = narrow[i];
    return other?.path === block.path && other.kind === block.kind && other.text === block.text;
  });
}
