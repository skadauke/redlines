// Blank lines between blocks are never drawn in Clean and Redlines (design: block editing, "What
// Clean and Redlines draw"): they are structure, the space between blocks, which is drawn by the
// kinds of the blocks (`spacing`), not lines a caret can rest on. The tracked layer hides them as
// whole lines, together with the lines of markers alone and the ledger it hides already, in one
// pass (`tracked/decorations.ts`), and the caret steps over each run with the line breaks around it.
//
// Blank lines that are content stay: in code, front matter, HTML blocks that hold them, and math.
// So does the blank line the caret is on, and a line of quote markers alone that the caret is on,
// as a `>` just typed (#167): until a key makes it a block, it is the line being typed on.

import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import type { Span } from './structure.ts';

/** A line of white space and quote markers only: blank, also inside a quote. */
export const BLANK = /^[ \t>]*$/;

/** The blocks whose blank lines are lines of their content. */
const HOLDERS = new Set([
  'FencedCode',
  'CodeBlock',
  'HTMLBlock',
  'CommentBlock',
  'ProcessingInstructionBlock',
  'FrontMatter',
]);

/** The ranges of the blocks that hold blank lines, in document order. */
function holders(state: EditorState): Span[] {
  const spans: Span[] = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      if (HOLDERS.has(node.name)) {
        spans.push({ from: node.from, to: node.to });
        return false;
      }
      // Leaf blocks hold no blank lines and no blocks: their inline content needs no walk.
      return !/^(?:Paragraph|ATXHeading|SetextHeading|Table|LinkReference|HorizontalRule)/.test(
        node.name,
      );
    },
  });
  return spans;
}

/** The line the caret is on, when it is blank: it is drawn, for the caret to be on. */
export function keptLine(state: EditorState): number | null {
  const line = state.doc.lineAt(state.selection.main.head);
  return BLANK.test(line.text) ? line.from : null;
}

/**
 * The runs of blank lines between blocks, each from the start of its first line to the end of its
 * last, in document order: blank lines at the start and the end of the document too, but not those
 * of a block that holds them, nor the line that starts at `kept`, nor those of `open` (the empty
 * block Return opens). In time linear in the lines.
 */
export function blankLines(
  state: EditorState,
  kept: number | null = keptLine(state),
  open: Span | null = null,
): Span[] {
  const { doc } = state;
  const content = holders(state);
  const runs: Span[] = [];
  let next = 0;
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    if (!BLANK.test(line.text) || line.from === kept) continue;
    if (open && line.from <= open.to && line.to >= open.from) continue;
    while (next < content.length && content[next]!.to < line.from) next++;
    const holder = content[next];
    if (holder && holder.from <= line.from && line.to <= holder.to) continue;
    const run = runs.at(-1);
    if (run && run.to === line.from - 1) run.to = line.to;
    else runs.push({ from: line.from, to: line.to });
  }
  return runs;
}
