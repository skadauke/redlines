// A table that is a pending insertion (format §3.4): each of its lines ends with the marker of a line
// break it inserted (`<!--split k3x9-->`), and the last with the closer of the insertion. The
// parser reads text after a row's last pipe as one more cell, so the header had a cell more than
// the delimiter row, and the table was no table: the page drew its lines as raw Markdown, with
// Track Changes on and until the insertion was decided.
//
// This reads such a table as the table it will be. The markers at the end of a line are seen as
// white space, by the parser alone: the document, and every position in the tree, stay as they are.
// A rule inserted the same way (`---<!--/k3x9-->`) is read as the rule it will be.

import { GFM, type BlockContext, type Line, type MarkdownConfig } from '@lezer/markdown';

/** The markers of an inserted line break or the end of an insertion that end a line. */
const TRAILING = /(?:<!--(?:split [a-z0-9]{4}|\/[a-z0-9]{4})-->)+(?=[ \t]*$)/;

/** `text` with the markers that end it as spaces: the same length, so the same positions. */
export const blankTrailingMarkers = (text: string): string =>
  text.replace(TRAILING, (marker) => ' '.repeat(marker.length));

/**
 * `text` without the markers that end it, and the white space after them. The parser reads a
 * delimiter row only when nothing follows its last pipe or dash, not even spaces; the row's own
 * range, in the tree, then stops in front of the markers.
 */
const stripTrailingMarkers = (text: string): string =>
  text.replace(new RegExp(`${TRAILING.source}[ \\t]*$`), '');

/** The GFM extension that reads tables (`Table`), the one whose block parser is wrapped. */
const gfmTable = (Array.isArray(GFM) ? GFM : [GFM]).find((extension) =>
  extension.parseBlock?.some((block) => block.name === 'Table'),
);
const original = gfmTable?.parseBlock?.find((block) => block.name === 'Table');

/** A line that is a horizontal rule when the markers that end it are taken away. */
const RULE = /^([-*_])(?:[ \t]*\1){2,}[ \t]*$/;

/** The parse of a table's lines, and of a rule, with the markers that end them blanked. */
export const tableMarkers: MarkdownConfig = {
  parseBlock: original?.leaf
    ? [
        {
          name: 'PendingRule',
          before: 'HorizontalRule',
          parse(cx, line) {
            if (line.next !== 42 && line.next !== 45 && line.next !== 95) return false;
            if (line.indent - line.baseIndent >= 4) return false;
            const blank = blankTrailingMarkers(line.text);
            if (blank === line.text || !RULE.test(blank.slice(line.pos).trimEnd())) return false;
            const from = cx.lineStart + line.pos;
            const to = cx.lineStart + line.text.length;
            cx.nextLine();
            cx.addElement(cx.elt('HorizontalRule', from, to));
            return true;
          },
        },
        {
          name: 'Table',
          before: 'SetextHeading',
          leaf(cx, leaf) {
            const parser = original.leaf!(
              cx,
              withContent(leaf, blankTrailingMarkers(leaf.content)),
            );
            if (!parser) return null;
            // The original's own object, so that its `instanceof` checks hold; only the text it is
            // given differs.
            const next = parser.nextLine.bind(parser);
            parser.nextLine = (block: BlockContext, line: Line, own) => {
              const text = line.text;
              // Until it has seen the second line, the delimiter row if the block is a table, the
              // parser's `rows` is null.
              const second = (parser as unknown as { rows: unknown }).rows == null;
              line.text = second ? stripTrailingMarkers(text) : blankTrailingMarkers(text);
              try {
                return next(block, line, withContent(own, blankTrailingMarkers(own.content)));
              } finally {
                line.text = text;
              }
            };
            return parser;
          },
          endLeaf(cx, line, leaf) {
            if (!original.endLeaf) return false;
            const text = line.text;
            line.text = blankTrailingMarkers(text);
            const peek = Object.create(cx) as BlockContext;
            peek.peekLine = () => blankTrailingMarkers(cx.peekLine());
            try {
              return original.endLeaf(peek, line, leaf);
            } finally {
              line.text = text;
            }
          },
        },
      ]
    : [],
};

/** The same leaf block, with the text it reads for its content. */
function withContent<T extends { content: string }>(leaf: T, content: string): T {
  return Object.create(leaf, { content: { value: content } }) as T;
}
