// What a selection holds that a list can be made of or taken out of (issue #506): the List menu is
// in the bar only for a selection with a paragraph or a list item in it, anywhere in it and not only
// at its start, so that a selection from a heading into the paragraphs below still offers it. A
// conversion that makes no sense (to a list in a table cell, in Raw while tracking) is the commands' own
// reason, grayed in the menu with its hint.

import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';

/** What the selection holds. */
export interface Holds {
  /** A paragraph, or an empty line a paragraph can be written on. */
  paragraph: boolean;
  /** A list item, of any kind of list. */
  item: boolean;
}

/** Blocks whose text is not a paragraph's: an empty line in one isn't a paragraph to convert. */
const NOT_PARAGRAPHS = new Set(['FencedCode', 'CodeBlock', 'HTMLBlock', 'FrontMatter', 'Table']);

/** What the main selection holds, by the Markdown parse. */
export function holds(state: EditorState): Holds {
  const { from, to, empty } = state.selection.main;
  const found: Holds = { paragraph: false, item: false };
  const tree = syntaxTree(state);
  const see = (name: string) => {
    if (name === 'Paragraph') found.paragraph = true;
    else if (name === 'ListItem') found.item = true;
  };
  if (empty) {
    // A caret is inside the blocks around it, as the commands read it.
    let node: ReturnType<typeof tree.resolveInner> | null = tree.resolveInner(from, 0);
    while (node) {
      see(node.name);
      node = node.parent;
    }
  } else {
    // A range holds the blocks it overlaps, and the ones around its start.
    tree.iterate({
      from,
      to,
      enter(node) {
        see(node.name);
        return found.paragraph && found.item ? false : undefined;
      },
    });
    for (let node = tree.resolveInner(from, 1).parent; node; node = node.parent) see(node.name);
  }
  if (found.paragraph || found.item) return found;
  // A caret on a blank line, where Return leaves a paragraph to be: the commands write the list's
  // marker there.
  if (empty && state.doc.lineAt(from).text.trim() === '') {
    let inside = false;
    for (let node = syntaxTree(state).resolveInner(from, 0); node.parent; node = node.parent) {
      if (NOT_PARAGRAPHS.has(node.name)) inside = true;
    }
    found.paragraph = !inside;
  }
  return found;
}
