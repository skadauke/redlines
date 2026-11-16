// What a selection holds that a list can be made of or taken out of (issue #506): the List menu is
// in the bar only for a selection with a paragraph or a list item in it, anywhere in it and not only
// at its start, so that a selection from a heading into the paragraphs below still offers it. A
// conversion that makes no sense (to a list in a table cell, in Raw while tracking) is the commands' own
// reason, grayed in the menu with its hint.

import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';

/** What the selection holds. */
export interface Holds {
  /** A paragraph, or an empty line a paragraph can be written on. */
  paragraph: boolean;
  /** A list item, of any kind of list. */
  item: boolean;
}

/** Blocks whose text is not a paragraph's: an empty line in one isn't a paragraph to convert. */
const NOT_PARAGRAPHS = new Set([
  'FencedCode',
  'CodeBlock',
  'HTMLBlock',
  'CommentBlock',
  'ProcessingInstructionBlock',
  'FrontMatter',
  'Table',
]);

/** How long the toolbar waits for the parse of the selection, in ms: the bar is drawn on each update. */
const PARSE_BUDGET_MS = 20;

/** What the main selection holds, by the Markdown parse. */
export function holds(state: EditorState): Holds {
  const { from, to, empty } = state.selection.main;
  const found: Holds = { paragraph: false, item: false };
  // The parse as far as the selection, if it can be had quickly (a jump far down a big file).
  const tree = ensureSyntaxTree(state, to, PARSE_BUDGET_MS) ?? syntaxTree(state);
  const see = (name: string) => {
    if (name === 'Paragraph') found.paragraph = true;
    else if (name === 'ListItem') found.item = true;
  };
  /** The blocks around a place: a caret at the edge of a block is in it, from either side. */
  const around = (pos: number, sides: readonly (-1 | 1)[] = [-1, 1]) => {
    for (const side of sides) {
      let node: ReturnType<typeof tree.resolveInner> | null = tree.resolveInner(pos, side);
      while (node) {
        see(node.name);
        node = node.parent;
      }
    }
  };
  if (empty) {
    around(from);
  } else {
    // A range holds the blocks it overlaps, and the ones around its start and its end.
    tree.iterate({
      from,
      to,
      enter(node) {
        // Only a block the range overlaps: one that starts where it ends, or ends where it starts, is no part of it.
        if (node.from < to && node.to > from) see(node.name);
        return found.paragraph && found.item ? false : undefined;
      },
    });
    // The start belongs to the block after it and the end to the block before it: a selection that
    // ends at the start of the next block (a triple-click takes the line break) doesn't hold it.
    around(from, [1]);
    around(to, [-1]);
  }
  if (found.paragraph || found.item) return found;
  // A caret on a blank line, where Return leaves a paragraph to be: the commands write the list's
  // marker there.
  if (empty && state.doc.lineAt(from).text.trim() === '') {
    let inside = false;
    for (
      let node: ReturnType<typeof tree.resolveInner> | null = tree.resolveInner(from, 0);
      node;
    ) {
      if (NOT_PARAGRAPHS.has(node.name)) inside = true;
      node = node.parent;
    }
    found.paragraph = !inside;
  }
  return found;
}
