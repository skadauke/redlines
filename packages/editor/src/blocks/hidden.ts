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
import type { EditorState, Text } from '@codemirror/state';
import type { Tree } from '@lezer/common';
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

/** How far past the parsed part of a document blank lines are read: beyond it, nothing is drawn. */
const TAIL = 20_000;

/**
 * What the tree says about the text, read once per text and carried on as the parse goes on
 * (#696): the blocks that hold blank lines, the ordinary comments, and the runs of blank lines
 * outside the holders. A parse that adds a stretch reads that stretch, not the whole text again.
 */
interface Scan {
  /** How far the tree had gone when the holders and comments were read. */
  reach: number;
  holders: Span[];
  /** Each `<!--` of a Comment or CommentBlock node to its `-->`, markers and ledger included. */
  comments: Span[];
  /** The runs of blank lines that start before `reach`, with no regard for the caret. */
  runs: Span[];
}

const scans = new WeakMap<Text, Scan>();

/** The start of the block before the one at `pos`: where a re-read of the tree starts. */
function blockBefore(tree: Tree, pos: number): number {
  const block = tree.topNode.childBefore(pos);
  return block?.prevSibling?.from ?? block?.from ?? 0;
}

function scanOf(state: EditorState): Scan {
  const tree = syntaxTree(state);
  const { doc } = state;
  let scan = scans.get(doc);
  if (!scan) scans.set(doc, (scan = { reach: -1, holders: [], comments: [], runs: [] }));
  if (tree.length <= scan.reach) return scan;
  const from = blockBefore(tree, scan.reach);
  scan.holders = scan.holders.filter((span) => span.from < from);
  scan.comments = scan.comments.filter((span) => span.from < from);
  tree.iterate({
    from,
    to: tree.length,
    enter: (node) => {
      if (node.name === 'Comment' || node.name === 'CommentBlock') {
        const text = state.sliceDoc(node.from, node.to);
        for (let open = text.indexOf('<!--'); open !== -1;) {
          const close = text.indexOf('-->', open + 2);
          if (close === -1) break;
          if (node.from + open >= from) {
            scan.comments.push({ from: node.from + open, to: node.from + close + 3 });
          }
          open = text.indexOf('<!--', close + 3);
        }
        if (HOLDERS.has(node.name) && node.from >= from) {
          scan.holders.push({ from: node.from, to: node.to });
        }
        return false;
      }
      if (HOLDERS.has(node.name)) {
        if (node.from >= from) scan.holders.push({ from: node.from, to: node.to });
        return false;
      }
      return true;
    },
  });
  // The blank lines from there to the end of what the tree covers.
  const first = doc.lineAt(Math.min(from, doc.length));
  while (scan.runs.length && scan.runs[scan.runs.length - 1]!.to >= first.from) {
    const run = scan.runs[scan.runs.length - 1]!;
    if (run.from < first.from) {
      run.to = first.from - 1;
      break;
    }
    scan.runs.pop();
  }
  let next = 0;
  while (next < scan.holders.length && scan.holders[next]!.to < first.from) next++;
  for (let n = first.number; n <= doc.lines; n++) {
    const line = doc.line(n);
    if (line.from >= tree.length && tree.length < doc.length) break;
    if (!BLANK.test(line.text)) continue;
    while (next < scan.holders.length && scan.holders[next]!.to < line.from) next++;
    const holder = scan.holders[next];
    if (holder && holder.from <= line.from && line.to <= holder.to) continue;
    const run = scan.runs.at(-1);
    if (run && run.to === line.from - 1) run.to = line.to;
    else scan.runs.push({ from: line.from, to: line.to });
  }
  scan.reach = tree.length;
  return scan;
}

/** The ordinary HTML comments of the parsed part of the text, each from `<!--` to `-->`. */
export function commentSpans(state: EditorState): readonly Span[] {
  return scanOf(state).comments;
}

/** The closers of marks (`<!--/k3x9-->`). */
const CLOSER = /<!--\/[^\n>]*-->/g;

/**
 * The line the caret is on, when it is blank, or holds only the closers of marks (the empty line
 * at the end of an inserted paragraph that has no text yet, #670): it is drawn, for the caret to be
 * on.
 */
export function keptLine(state: EditorState): number | null {
  const line = state.doc.lineAt(state.selection.main.head);
  if (BLANK.test(line.text)) return line.from;
  return line.text.includes('<!--/') && BLANK.test(line.text.replace(CLOSER, ''))
    ? line.from
    : null;
}

/**
 * The runs of blank lines between blocks, each from the start of its first line to the end of its
 * last, in document order: blank lines at the start and the end of the document too, but not those
 * of a block that holds them, nor the line that starts at `kept`, nor those of `open` (the empty
 * block Return opens). In time linear in the lines of what the parse has added since the last
 * call on the same text, and in the lines of a stretch after it that it has not reached.
 */
export function blankLines(
  state: EditorState,
  kept: number | null = keptLine(state),
  open: Span | null = null,
): Span[] {
  const { doc } = state;
  const tree = syntaxTree(state);
  const scan = scanOf(state);
  const runs = scan.runs.map((run) => ({ ...run }));
  // Past the tree nothing is known of the holders, and nothing is drawn: a stretch of the text
  // is read as it stands, so that the blank lines there are hidden before the parse gets to them.
  const end = Math.min(doc.length, tree.length + TAIL);
  if (tree.length < end) {
    for (let n = doc.lineAt(tree.length).number; n <= doc.lines; n++) {
      const line = doc.line(n);
      if (line.from > end) break;
      if (line.from < tree.length || !BLANK.test(line.text)) continue;
      const run = runs.at(-1);
      if (run && run.to === line.from - 1) run.to = line.to;
      else runs.push({ from: line.from, to: line.to });
    }
  }
  // The lines that stay: the caret's, and the open block's, taken out of the runs they are in.
  const keep = (from: number, to: number) => {
    for (let i = 0; i < runs.length; i++) {
      const run = runs[i]!;
      if (run.to < from || run.from > to) continue;
      const parts: Span[] = [];
      if (run.from < from) parts.push({ from: run.from, to: from - 1 });
      if (run.to > to) parts.push({ from: to + 1, to: run.to });
      runs.splice(i, 1, ...parts);
      i += parts.length - 1;
    }
  };
  if (kept !== null) keep(kept, doc.lineAt(kept).to);
  if (open) {
    for (let n = doc.lineAt(open.from).number; n <= doc.lineAt(open.to).number; n++) {
      const line = doc.line(n);
      if (BLANK.test(line.text) && line.from <= open.to && line.to >= open.from) {
        keep(line.from, line.to);
      }
    }
  }
  return runs;
}
