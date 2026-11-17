// An item whose marker is followed by a tab, as the parse reads it (#453). Lezer decides that an item
// starts on a blank line by comparing the column its text starts at with the length of the line in
// characters. A tab makes the two differ, and where they meet by chance (`1.<TAB>a` is four
// characters long, and its text starts at column 4; `-<TAB>a`, three and four) the item reads as one
// that starts on an empty line, which the blank line below it then ends. CommonMark goes on with the
// item over a line indented to its text, so `1.<TAB>a⏎⏎<TAB>b` is one item with two paragraphs and
// not a list and a code block. The block parser here runs again on the line's text, once the marker
// is read, and takes the blank start back from an item that has text on its first line.

import type { BlockContext, Line, MarkdownConfig } from '@lezer/markdown';

/** The item context that the list parsers have just started on this line, or null. */
interface Item {
  type: number;
  from: number;
  blankFirstLine: boolean;
}

function mendFirstLine(cx: BlockContext, line: Line): false {
  const item = (cx as unknown as { block?: Item }).block;
  if (
    item &&
    cx.parser.nodeSet.types[item.type]?.name === 'ListItem' &&
    item.blankFirstLine &&
    item.from >= cx.lineStart &&
    line.next >= 0
  ) {
    item.blankFirstLine = false;
  }
  // It only mends a flag, and never takes the line.
  return false;
}

/** The parse of an item with a tab after its marker holds the item over its continuation lines. */
export const tabItems: MarkdownConfig = {
  parseBlock: [{ name: 'TabItems', before: 'IndentedCode', parse: mendFirstLine }],
};
