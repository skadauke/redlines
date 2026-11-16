// An image file dragged from the sidebar into the document (#681): it lands between blocks, as a
// block of its own, at the gap nearest the pointer, and a line shows which gap that is while the
// pointer is over the text. Dragging in the project's own file is no copy: the link is the
// file's path from the document, which the host works out (`EditorOptions.projectImageLink`).
// Dropping an image into the middle of another block is not what a person wants (#674).

import { ensureSyntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

/** The drag's data type, set by the sidebar: the absolute path of an image file of the project. */
export const PROJECT_IMAGE_TYPE = 'application/x-redlines-project-image';

/** A place between blocks where a block of its own can go. */
export interface BlockGap {
  /** Where the text is written. */
  pos: number;
  /** The line breaks that set the new block apart, written before it and after it. */
  before: string;
  after: string;
  /** The block above it, by its place in `topBlocks`: null at the top of the document. */
  above: number | null;
  /** The block below it, null at the end. */
  below: number | null;
}

/** What starts the ledger, which stands at the end of a file and is never a place for text. */
const LEDGER = /^<!--\s*redlines\b/;

interface Span {
  from: number;
  to: number;
  name: string;
}

/** The top-level blocks a reader sees, and the ledger that ends the file, if it has one. */
function topBlocks(state: EditorState): { blocks: Span[]; ledger: Span | null } {
  const tree = ensureSyntaxTree(state, state.doc.length, 200);
  const blocks: Span[] = [];
  if (!tree) return { blocks, ledger: null };
  for (let node = tree.topNode.firstChild; node; node = node.nextSibling) {
    blocks.push({ from: node.from, to: node.to, name: node.name });
  }
  const last = blocks.at(-1);
  const isLedger = last !== undefined && LEDGER.test(state.sliceDoc(last.from, last.to));
  return { blocks: isLedger ? blocks.slice(0, -1) : blocks, ledger: isLedger ? last : null };
}

/**
 * The gaps of the document's top-level blocks: before each block, but not above front matter, which
 * has to be the first thing in the file, and after the last. A block of its own is written with
 * a blank line after it where a block follows (the ledger that ends a file counts as one), and with
 * one before it at the end of the document.
 */
export function blockGaps(state: EditorState): BlockGap[] {
  const { blocks, ledger } = topBlocks(state);
  const tail = ledger ? '\n\n' : '';
  if (blocks.length === 0) {
    return [{ pos: ledger?.from ?? 0, before: '', after: tail, above: null, below: null }];
  }
  const gaps: BlockGap[] = [];
  blocks.forEach((block, index) => {
    if (index === 0 && block.name === 'FrontMatter') return;
    gaps.push({
      pos: block.from,
      before: '',
      after: '\n\n',
      above: index === 0 ? null : index - 1,
      below: index,
    });
  });
  const last = blocks.length - 1;
  gaps.push(
    ledger
      ? { pos: ledger.from, before: '', after: '\n\n', above: last, below: null }
      : { pos: blocks[last]!.to, before: '\n\n', after: '', above: last, below: null },
  );
  return gaps;
}

/** The client y of a gap: between the block above and the one below, at the top or at the bottom. */
function gapY(view: EditorView, gap: BlockGap, blocks: readonly Span[]): number {
  const top = view.documentTop;
  const above = gap.above === null ? null : blocks[gap.above];
  const below = gap.below === null ? null : blocks[gap.below];
  const bottomOf = (block: Span) => top + view.lineBlockAt(block.to).bottom;
  const topOf = (block: Span) => top + view.lineBlockAt(block.from).top;
  if (above && below) return (bottomOf(above) + topOf(below)) / 2;
  if (above) return bottomOf(above) + 2;
  return below ? topOf(below) - 2 : top;
}

/** The gap nearest the client height `y`, and where its line is drawn (client y), or null for none. */
export function nearestGap(view: EditorView, y: number): { gap: BlockGap; y: number } | null {
  const gaps = blockGaps(view.state);
  const { blocks } = topBlocks(view.state);
  let best: { gap: BlockGap; y: number } | null = null;
  for (const gap of gaps) {
    const at = gapY(view, gap, blocks);
    if (best === null || Math.abs(at - y) < Math.abs(best.y - y)) best = { gap, y: at };
  }
  return best;
}

/** The line that shows the gap a drag is over, in the editor, until it is hidden. */
export function dropLine(view: EditorView): {
  show(clientY: number): void;
  hide(): void;
} {
  let line: HTMLElement | null = null;
  return {
    show(clientY) {
      if (!line) {
        line = view.dom.ownerDocument.createElement('div');
        line.className = 'rl-drop-line';
        line.setAttribute('aria-hidden', 'true');
        view.dom.append(line);
      }
      const host = view.dom.getBoundingClientRect();
      const content = view.contentDOM.getBoundingClientRect();
      line.style.top = `${Math.round(clientY - host.top - 1)}px`;
      line.style.left = `${Math.round(content.left - host.left)}px`;
      line.style.width = `${Math.round(content.width)}px`;
    },
    hide() {
      line?.remove();
      line = null;
    },
  };
}
