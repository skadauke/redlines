// YAML front matter as one block of the Markdown parse (#154, format §3.8): a `---` line that opens
// the document, a line that isn't blank, and the lines through the first `---` or `...` line after
// it. Without this, the parser reads it as a rule and a setext heading, or, closed by `...`, as a
// rule and a paragraph that a list key goes on with.

import { tags } from '@lezer/highlight';
import type { BlockContext, Line, MarkdownConfig } from '@lezer/markdown';

/** What the parser reads from (lezer's `Input`). */
interface Input {
  readonly length: number;
  read(from: number, to: number): string;
}

const OPEN = /^---[ \t]*$/;
const CLOSE = /^(?:---|\.\.\.)[ \t]*$/;
const BLANK = /^[ \t]*$/;

/**
 * The start of the closing line of the front matter that opens `input`, or -1 when it has none:
 * the first line is `---`, the second isn't blank, and a later line is `---` or `...`.
 */
function closingLine(input: Input): number {
  let start = 0;
  for (let n = 0; start <= input.length; n++) {
    // Lines are read a piece at a time, so a long document without a closing line is read once.
    let end = start;
    let text = '';
    for (;;) {
      const piece = input.read(end, Math.min(input.length, end + 512));
      const at = piece.indexOf('\n');
      if (at >= 0) {
        text += piece.slice(0, at);
        end += at;
        break;
      }
      text += piece;
      end += piece.length;
      if (end >= input.length) break;
    }
    if (n === 0 && !OPEN.test(text)) return -1;
    if (n === 1 && BLANK.test(text)) return -1;
    if (n >= 1 && CLOSE.test(text)) return start;
    if (end >= input.length) return -1;
    start = end + 1;
  }
  return -1;
}

/** The parser's input, which block parsers aren't handed: null if this version hides it. */
function inputOf(cx: BlockContext): Input | null {
  const input = (cx as unknown as { input?: Input }).input;
  return input && typeof input.read === 'function' ? input : null;
}

function parseFrontMatter(cx: BlockContext, line: Line): boolean {
  // The document is the one block around the first line.
  if (cx.lineStart !== 0 || cx.depth !== 1 || !OPEN.test(line.text)) return false;
  const input = inputOf(cx);
  if (!input) return false;
  const close = closingLine(input);
  if (close < 0) return false;
  const marks = [cx.elt('FrontMatterMark', 0, 3)];
  while (cx.lineStart < close && cx.nextLine()) {
    // The lines of the front matter.
  }
  const end = cx.lineStart + line.text.length;
  marks.push(cx.elt('FrontMatterMark', cx.lineStart, cx.lineStart + 3));
  cx.nextLine();
  cx.addElement(cx.elt('FrontMatter', 0, end, marks));
  return true;
}

/** Leading front matter as a `FrontMatter` node, its `---` and `...` lines `FrontMatterMark`s. */
export const frontMatter: MarkdownConfig = {
  defineNodes: [
    { name: 'FrontMatter', block: true, style: tags.meta },
    { name: 'FrontMatterMark', style: tags.processingInstruction },
  ],
  parseBlock: [{ name: 'FrontMatter', before: 'HorizontalRule', parse: parseFrontMatter }],
};
