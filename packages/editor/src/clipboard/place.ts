// Where a converted paste goes (docs/research/paste.md, "Where the caret is"): a paste whose
// Markdown has blocks lands as blocks, whatever is around the caret.
//
// - In a paragraph, a paste that starts with a block other than a paragraph gets a blank line
//   before it when text comes before the caret, and one that ends with such a block a blank line
//   after it when text follows the caret. One paragraph joins the line; of several, the first
//   joins the line and the rest are blocks after it.
// - In a heading or a link, the first paragraph joins the line, flattened; the rest go after it.
// - In a list item or a quote, every line after the first takes the item's indent or the `> `.
// - In a table cell, the paste is one line, with `<br>` between paragraphs and `|` escaped.
//
// Code is the caller's: a paste there is text as it is.

import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import { GFM, parser } from '@lezer/markdown';

const markdown = parser.configure(GFM);

/** A paste as one text for the caret, or as a part for the caret and a part for the line's end. */
export type Placement = { text: string } | { text: string; rest: string; at: number };

/** The blocks of Markdown, each as written and whether it is a paragraph. */
function blocksOf(text: string): { text: string; paragraph: boolean; to: number }[] {
  const blocks: { text: string; paragraph: boolean; to: number }[] = [];
  for (let node = markdown.parse(text).topNode.firstChild; node; node = node.nextSibling) {
    blocks.push({
      text: text.slice(node.from, node.to),
      paragraph: node.name === 'Paragraph',
      to: node.to,
    });
  }
  return blocks;
}

const flat = (text: string) => text.replace(/\\?\n/g, ' ').trim();

/** The quote marks and list marker at the start of a line, with the marker as spaces. */
const LEADING = /^((?:[ \t]*>)*[ \t]*)((?:[-+*]|\d{1,9}[.)])[ \t]+(?:\[[ xX]\][ \t]+)?)?/;

export function place(state: EditorState, text: string, from: number, to: number): Placement {
  const line = state.doc.lineAt(from);
  const before = state.sliceDoc(line.from, from);
  const after = state.sliceDoc(to, state.doc.lineAt(to).to);
  let inCell = false;
  let inHeading = false;
  let inLink = false;
  let inContainer = false;
  for (
    let node: { name: string; parent: unknown } | null = syntaxTree(state).resolveInner(from, -1);
    node;
    node = node.parent as typeof node
  ) {
    if (node.name === 'TableCell' || node.name === 'TableHeader') inCell = true;
    else if (/^(?:ATX|Setext)Heading/.test(node.name)) inHeading = true;
    else if (node.name === 'Link' || node.name === 'Image') inLink = true;
    else if (node.name === 'ListItem' || node.name === 'Blockquote') inContainer = true;
  }
  const blocks = blocksOf(text);

  if (inCell) {
    const cell = blocks
      .map((block) => block.text.replace(/\\?\n/g, '<br>'))
      .join('<br>')
      .replace(/(?<!\\)\|/g, '\\|');
    return { text: cell };
  }

  if (inHeading || inLink) {
    const first = blocks[0]?.paragraph ? blocks[0] : null;
    const rest = text.slice(first ? first.to : 0).trim();
    if (!rest) return { text: flat(text) };
    const next = state.doc.lines > line.number ? state.doc.line(line.number + 1) : null;
    return {
      text: first ? flat(first.text) : '',
      rest: `\n\n${rest}${next?.text.trim() ? '\n' : ''}`,
      at: state.doc.lineAt(to).to,
    };
  }

  const leading = LEADING.exec(before);
  const prefix = inContainer && leading ? leading[1]! + ' '.repeat(leading[2]?.length ?? 0) : '';
  const first = blocks[0];
  const last = blocks[blocks.length - 1];
  const textBefore = before.slice(leading && inContainer ? leading[0].length : 0).trim() !== '';
  let result = text;
  if (first && !first.paragraph && textBefore) result = `\n\n${result}`;
  if (last && !last.paragraph && after.trim() !== '') result = `${result}\n\n`;
  if (prefix.trim() || prefix) {
    const blank = prefix.includes('>') ? prefix.trimEnd() : '';
    const rows = result.split('\n');
    // A last row that is empty is the start of the text that followed the caret.
    result = rows
      .map((row, i) => (i === 0 ? row : row.trim() || i === rows.length - 1 ? prefix + row : blank))
      .join('\n');
  }
  return { text: result };
}
