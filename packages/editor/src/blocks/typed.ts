// Typed Markdown makes a block (design: block editing, "Typed syntax and the Paragraph menu on an
// empty paragraph"). Most of it needs no code: `# `, `- `, `1. ` and `> ` typed in an empty
// paragraph are the block's syntax as text, and the format takes them as part of the paragraph's
// whole-block insertion; the preview draws a lone `#` or `-` as body until the space completes it
// (`preview/decorations.ts`). What is written here is what typing alone leaves open or wrong:
//
// - Three backticks (or tildes) alone on an empty paragraph's line are a code block, closed at
//   once, with the caret after the opening fence for a language. An open fence runs to the end of
//   the file, over the ledger, which the format refuses with Track Changes on.
// - `---`, `***` or `___` and Return: a thematic break and an empty paragraph after it.
// - A number and a period typed as the start of a list item's text (`- 1.`): Markdown reads a
//   marker with nothing after it as a numbered list in the item, so the period is written escaped
//   (`- 1\.`), which stays text (#666). A space after it takes the backslash away: the numbered sublist (#512).
// - A row of cells, `| a | b |`, and Return: the table's delimiter row (and a first row to type in).

import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';
import {
  EditorSelection,
  EditorState,
  Prec,
  type Annotation,
  type Transaction,
} from '@codemirror/state';
import {
  authorFacet,
  parsedField,
  trackedEditAnnotation,
  viewModeField,
} from '../tracked/field.ts';
import { trackingField } from '../tracked/typing.ts';
import { textStart } from './edits.ts';
import { blockAt, isGapLine } from './structure.ts';

/** A transaction's annotations (CodeMirror reads them by type only; a transaction keeps a list). */
function annotationsOf(tr: Transaction): Annotation<unknown>[] {
  return [
    ...((tr as unknown as { annotations?: readonly Annotation<unknown>[] }).annotations ?? []),
  ];
}

/** The nodes of a document in which a line is code: its blank lines and fences are content. */
const CODE_NODES = new Set([
  'FencedCode',
  'CodeBlock',
  'HTMLBlock',
  'CommentBlock',
  'ProcessingInstructionBlock',
  'FrontMatter',
  'Table',
]);

/**
 * Whether the line from `from` to `to` stands alone as a paragraph of the top level: blank lines
 * (or the edges of the document) on either side of it, and no block around it that holds lines.
 */
function aloneAt(state: EditorState, lineNumber: number): boolean {
  const { doc } = state;
  const line = doc.line(lineNumber);
  const blankAt = (n: number) => n < 1 || n > doc.lines || isGapLine(state, doc.line(n));
  if (!blankAt(lineNumber - 1) || !blankAt(lineNumber + 1)) return false;
  if (!line.text.length || /^[ \t]/.test(line.text)) return false;
  for (
    let node = syntaxTree(state).resolveInner(line.from, 1) as SyntaxNode | null;
    node;
    node = node.parent
  ) {
    if (CODE_NODES.has(node.name)) return false;
  }
  return true;
}

/**
 * The third backtick or tilde typed after two on a line of their own: the fence is closed at
 * once, with the caret after the opening one. The change is widened before the tracked layer
 * writes it, so that it records one insertion, a code block that is closed.
 */
const closeFence = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || !tr.isUserEvent('input.type') || tr.isUserEvent('input.type.compose')) {
    return tr;
  }
  const { startState: start } = tr;
  if (start.field(viewModeField, false) === 'raw') return tr;
  const { main } = start.selection;
  if (start.selection.ranges.length > 1 || !main.empty) return tr;
  let seen: string | null = null;
  let single = true;
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, text) => {
    if (fromA !== main.head || toA !== main.head || seen !== null) single = false;
    seen = text.toString();
  });
  const typed = String(seen ?? '');
  const fence = typed === '`' || typed === '~';
  const rule = typed === '-' || typed === '*' || typed === '_';
  if (!single || !(fence || rule)) return tr;
  const line = start.doc.lineAt(main.head);
  // Two of them in front of the caret, and nothing after it but the closer of an insertion.
  const before = start.sliceDoc(line.from, main.head);
  const after = start.sliceDoc(main.head, line.to);
  if (before !== typed.repeat(2) || !/^(?:<!--[^]*?-->)*$/.test(after)) return tr;
  if (!aloneAt(start, line.number)) return tr;
  if (start.field(trackingField, false)) {
    // The two characters are the author's own pending insertion, which a closed code block is
    // written into whole, its closer on a line of its own, as a block inserted is (format §3.5): the
    // format takes a code block only whole.
    const handle = start.facet(authorFacet)?.handle;
    const mine = start
      .field(parsedField)
      .marks.find(
        (mark) =>
          mark.kind === 'ins' &&
          mark.entry.by === handle &&
          mark.segments.some(
            (g) =>
              g.close?.from === main.head &&
              g.content.to === main.head &&
              /^\n*$/.test(start.sliceDoc(g.content.from, line.from)),
          ),
      );
    if (!mine) return tr;
    return {
      changes: {
        from: line.from,
        to: main.head,
        // A thematic break's line takes nothing after it, not even a closer.
        insert: fence ? `${typed.repeat(3)}\n\n${typed.repeat(3)}\n` : `${typed.repeat(3)}\n`,
      },
      selection: EditorSelection.cursor(line.from + 3),
      annotations: [...annotationsOf(tr), trackedEditAnnotation.of(true)],
      effects: tr.effects,
      scrollIntoView: tr.scrollIntoView,
    };
  }
  // With Track Changes off a thematic break needs nothing but typing.
  if (rule) return tr;
  return {
    changes: { from: main.head, insert: `${typed}\n\n${typed.repeat(3)}` },
    selection: EditorSelection.cursor(main.head + 1),
    annotations: annotationsOf(tr),
    effects: tr.effects,
    scrollIntoView: tr.scrollIntoView,
  };
});

/**
 * A single character typed at the caret, with nothing selected, in a list item's first line of
 * text, where `pattern` matches the text before the caret (markers of the tracked layer left out)
 * and nothing but markers follows it on the line. Null otherwise.
 */
function typedAtItemStart(tr: Transaction, chars: string[], pattern: RegExp) {
  if (!tr.docChanged || !tr.isUserEvent('input.type') || tr.isUserEvent('input.type.compose')) {
    return null;
  }
  const { startState: start } = tr;
  if (start.field(viewModeField, false) === 'raw') return null;
  const { main } = start.selection;
  if (start.selection.ranges.length > 1 || !main.empty) return null;
  let seen: string | null = null;
  let single = true;
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, text) => {
    if (fromA !== main.head || toA !== main.head || seen !== null) single = false;
    seen = text.toString();
  });
  const typed = String(seen ?? '');
  if (!single || !chars.includes(typed)) return null;
  const block = blockAt(start, main.head);
  const item = block?.containers.at(-1);
  // A task item's `1.` is text for Markdown as it stands (a box is no list).
  if (!block || block.kind !== 'paragraph' || item?.kind !== 'item' || item.task) return null;
  // The item's first paragraph: its marker is on the block's first line, or alone on the line
  // above it, where a tracked insertion's opener (the carrier) put the text on a line of its own.
  const first = start.doc.lineAt(block.lines.from);
  const above = first.number > 1 ? start.doc.line(first.number - 1).text : '';
  if (
    !/[-*+]|\d[.)]/.test(start.sliceDoc(item.prefix.from, item.prefix.to)) &&
    !/^[ \t>]*(?:[-*+]|\d{1,9}[.)])[ \t]*(?:\[[ xX]\][ \t]*)?$/.test(
      above.replace(/<!--[^]*?-->/g, ''),
    )
  ) {
    return null;
  }
  const from = textStart(start, block);
  if (main.head < from) return null;
  const before = start.sliceDoc(from, main.head).replace(/<!--[^]*?-->/g, '');
  if (!pattern.test(before)) return null;
  // Nothing after the caret but markers: a period before more text, as `1.5`, is text as it is.
  const line = start.doc.lineAt(main.head);
  const after = start.sliceDoc(main.head, line.to).replace(/<!--[^]*?-->/g, '');
  if (/\S/.test(after) || block.text.to > line.to) return null;
  return { head: main.head, typed };
}

/**
 * The period or parenthesis typed after the digits that are the whole of a list item's first line
 * of text, with nothing after the caret: written escaped, so that the line reads as text and not as
 * the marker of a numbered list in the item (#666; format §3.2).
 */
const escapeMarker = EditorState.transactionFilter.of((tr) => {
  const found = typedAtItemStart(tr, ['.', ')'], /^\d{1,9}$/);
  if (!found) return tr;
  return {
    changes: { from: found.head, insert: `\\${found.typed}` },
    selection: EditorSelection.cursor(found.head + 2),
    annotations: annotationsOf(tr),
    effects: tr.effects,
    scrollIntoView: tr.scrollIntoView,
  };
});

/**
 * The space typed after the escaped delimiter (`- 1\.`, the whole of the item's first line): the
 * person typed `1. ` at the start of the item's text, the numbered sublist (#512; format §3.2). The
 * backslash goes (with Track Changes on it is a letter of the author's own insertion, which a
 * deletion of it only takes back) and the item holds the numbered list, `- 1. `.
 */
const startSublist = EditorState.transactionFilter.of((tr) => {
  const found = typedAtItemStart(tr, [' '], /^\d{1,9}\\[.)]$/);
  if (!found || !/^\\[.)]$/.test(tr.startState.sliceDoc(found.head - 2, found.head))) return tr;
  return {
    changes: [
      { from: found.head - 2, to: found.head - 1 },
      { from: found.head, insert: ' ' },
    ],
    selection: EditorSelection.cursor(found.head),
    annotations: annotationsOf(tr),
    effects: tr.effects,
    scrollIntoView: tr.scrollIntoView,
  };
});

/** Typed syntax that needs more than typing. Below the tracked layer's filter, which runs after. */
export const typedSyntax = Prec.low([closeFence, escapeMarker, startSublist]);
