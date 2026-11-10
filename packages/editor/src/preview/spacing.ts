// The space between blocks, drawn by their kinds (design: block editing, "What Clean and Redlines
// draw"): padding on the first line of a block, from the theme's tokens, the same whether the file
// has no blank line between the blocks (a paragraph right under a heading), one or three. The
// blank lines themselves are hidden (`blocks/hidden.ts`).

import type { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import { isGapLine, leafKind, loose } from '../blocks/structure.ts';
import { parsedField } from '../tracked/field.ts';

type SyntaxNode = ReturnType<typeof syntaxTree>['topNode'];

/**
 * The space above a block: `block` between blocks, `h1` under a heading 1, `heading` under
 * headings 2 to 6, `item` between the items of a tight list, `loose` between the items of a loose
 * list and between the paragraphs of a quote or an item. Each is a line class, `rl-space-<kind>`.
 */
export type Spacing = 'block' | 'h1' | 'heading' | 'item' | 'loose';

/** The innermost list item or quote around `node`. */
function containerOf(node: SyntaxNode): SyntaxNode | null {
  for (let up = node.parent; up; up = up.parent) {
    if (up.name === 'ListItem' || up.name === 'Blockquote') return up;
  }
  return null;
}

/** The list item whose first line `node` starts on, if any: the block that is its first. */
function itemStarted(state: EditorState, node: SyntaxNode): SyntaxNode | null {
  const line = state.doc.lineAt(node.from).number;
  for (let up = node.parent; up; up = up.parent) {
    if (up.name === 'ListItem') return state.doc.lineAt(up.from).number === line ? up : null;
    if (up.name !== 'Blockquote') return null;
  }
  return null;
}

/** The space between `above` and `block`, the leaf blocks next to each other. */
function spacingOf(
  state: EditorState,
  above: SyntaxNode,
  block: SyntaxNode,
  looseness: (list: SyntaxNode) => boolean,
): Spacing {
  if (above.name.startsWith('ATXHeading') || above.name.startsWith('SetextHeading')) {
    return above.name.endsWith('1') ? 'h1' : 'heading';
  }
  const item = itemStarted(state, block);
  const list = item?.parent;
  if (item && list) {
    if (above.from >= list.from) return looseness(list) ? 'loose' : 'item';
    // The first item of a list nested in an item, under that item's text: as its own list is.
    const parent = list.parent;
    if (parent?.name === 'ListItem' && parent.parent && above.from >= parent.from) {
      return looseness(parent.parent) ? 'loose' : 'item';
    }
    return 'block';
  }
  const container = containerOf(block);
  return container && above.from >= container.from ? 'loose' : 'block';
}

/** Whether a leaf block is no block to the person: the ledger, or a line of markers alone. */
function isGap(state: EditorState, node: SyntaxNode): boolean {
  const ledger = state.field(parsedField, false)?.ledgerRange;
  if (ledger && node.from >= ledger.from && node.to <= ledger.to) return true;
  if (leafKind(node.name) !== 'html') return false;
  const { doc } = state;
  for (let n = doc.lineAt(node.from).number; n <= doc.lineAt(node.to).number; n++) {
    if (!isGapLine(state, doc.line(n))) return false;
  }
  return true;
}

/**
 * Blocks drawn on a tint or as a widget: their first line can't take the space above them, which
 * would be tinted or not drawn, so the last line of the block above takes it, below its text.
 */
const BOXED = new Set(['FencedCode', 'CodeBlock', 'FrontMatter', 'Table']);

/** Where the space between two blocks goes: a line, by its start, and which side of it. */
export interface Space {
  line: number;
  spacing: Spacing;
  /** Below the line's text, for a boxed block under it, rather than above. */
  below: boolean;
}

/** The space above each leaf block but the first, given the leaf blocks in document order. */
export function spacings(state: EditorState, leaves: readonly SyntaxNode[]): Space[] {
  const found: Space[] = [];
  const lists = new Map<number, boolean>();
  const looseness = (list: SyntaxNode) => {
    let value = lists.get(list.from);
    if (value === undefined) lists.set(list.from, (value = loose(state, list)));
    return value;
  };
  const { doc } = state;
  let above: SyntaxNode | null = null;
  for (const leaf of leaves) {
    if (isGap(state, leaf)) continue;
    if (above) {
      const spacing = spacingOf(state, above, leaf, looseness);
      const below = BOXED.has(leaf.name) && !BOXED.has(above.name);
      found.push({ line: doc.lineAt(below ? above.to : leaf.from).from, spacing, below });
    }
    above = leaf;
  }
  return found;
}
