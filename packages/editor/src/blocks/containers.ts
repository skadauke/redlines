// HTML containers (#686, #688): `<details>` with an optional `<summary>`, and `<div>` (usually with
// `align`), around Markdown. GitHub draws what is between the tags as Markdown when blank lines
// keep the tags apart from it, so here the tag lines are hidden, the Markdown inside is ordinary
// blocks, and a `<details>` folds.
//
// What the parse makes of them is the parse's own: an opening tag line (with the summary's line
// under it) is an `HTMLBlock` of its own, which ends at the blank line, and so is the closing tag.
// A container is such a pair of blocks at the top of the document, read here from the tree (no
// new node), matched like brackets. A `<details>` with no closing tag folds to the end of the
// document, as on GitHub. A tag with other text in its block (`<div align="center">` and an image
// right under it) is one HTML block with no Markdown inside, which a later phase draws (#689).
//
// Folding is view state, never written into the file: a section is closed unless the file says
// `open`, a person's toggle is kept in the state (and mapped through edits), and a section that a
// match or a change is in, or the caret, is open for as long as that is so.

import { syntaxTree } from '@codemirror/language';
import {
  type EditorState,
  type Extension,
  StateEffect,
  StateField,
  type Transaction,
} from '@codemirror/state';
import type { Tree } from '@lezer/common';

/** A container of the document. Every position is in the document. */
export interface Container {
  kind: 'details' | 'div';
  /** The start of the opening tag's line: the container's key. */
  from: number;
  /** The end of the opening block's last line. */
  openerTo: number;
  /** The summary's line (`<summary>…</summary>` alone), and where its text is. */
  summary: { from: number; to: number; textFrom: number; textTo: number } | null;
  /** The start of the line after the opening block: where what is folded begins. */
  bodyFrom: number;
  /** The closing tag's line, or null when it is missing and the container runs to `end`. */
  closer: { from: number; to: number } | null;
  /** Where the container ends: the closing tag's line end, or the end of the document's text. */
  end: number;
  /** Whether the file says `open`. */
  fileOpen: boolean;
  /** `align`'s value on a `div`: left, center, right or justify. */
  align: string | null;
  /** The container this one is inside, or -1: its index in the list. */
  parent: number;
}

const OPENER =
  /^<(details|div)((?:\s[^<>\n]*)?)>[ \t]*(?:\r?\n[ \t]*<summary>([^\n]*?)<\/summary>[ \t]*)?$/i;
// A tracked insertion's closing marker goes on the line after the tag, in the same HTML block.
const CLOSER = /^<\/(details|div)>[ \t]*(?:\r?\n[ \t]*<!--\/?[^\n]*?-->[ \t]*)*$/i;
const ALIGN = /\balign\s*=\s*["']?(left|center|right|justify)\b/i;
const OPEN = /(?:^|\s)open(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?(?=\s|$)/i;

const cache = new WeakMap<Tree, { length: number; containers: Container[] }>();

/** The containers of the document, in the order of their opening tags. */
export function containersOf(state: EditorState): readonly Container[] {
  const tree = syntaxTree(state);
  const { doc } = state;
  const hit = cache.get(tree);
  if (hit && hit.length === doc.length) return hit.containers;
  const containers: Container[] = [];
  const stack: number[] = [];
  const limits = new Map<Container, number>();
  let ledger = doc.length;
  for (let node = tree.topNode.firstChild; node; node = node.nextSibling) {
    if (
      node.name === 'CommentBlock' &&
      state.sliceDoc(node.from, node.from + 12) === '<!-- redline'
    ) {
      ledger = node.from;
      continue;
    }
    if (node.name !== 'HTMLBlock' || node.to - node.from > 600) continue;
    // The markers of a tracked insertion sit on the tags' lines (`<details><!--split k3x9-->`):
    // the tags are read without them.
    const text = state.sliceDoc(node.from, node.to).replace(/<!--[^]*?-->/g, '');
    const closing = CLOSER.exec(text);
    if (closing) {
      const kind = (closing[1] as string).toLowerCase();
      const at = stack.findLastIndex((i) => containers[i]!.kind === kind);
      if (at === -1) continue;
      const open = containers[stack[at]!]!;
      const tagLine = doc.lineAt(node.from);
      open.closer = { from: tagLine.from, to: tagLine.to };
      open.end = tagLine.to;
      // A details inside it that never closed ends where this one does.
      for (const inner of stack.slice(at + 1)) limits.set(containers[inner]!, tagLine.from);
      stack.length = at;
      continue;
    }
    const opening = OPENER.exec(text);
    if (!opening) continue;
    const kind = (opening[1] as string).toLowerCase() as 'details' | 'div';
    const attributes = opening[2] ?? '';
    const summaryText = opening[3];
    const first = doc.lineAt(node.from);
    const last = doc.lineAt(node.to);
    let summary: Container['summary'] = null;
    if (kind === 'details' && summaryText !== undefined) {
      if (summaryText.trim() === '' || first.number === last.number) continue;
      const line = last;
      const textFrom = line.from + line.text.indexOf('<summary>') + '<summary>'.length;
      summary = { from: line.from, to: line.to, textFrom, textTo: textFrom + summaryText.length };
    } else if (summaryText !== undefined) continue;
    containers.push({
      kind,
      from: first.from,
      openerTo: node.to,
      summary,
      bodyFrom: last.number < doc.lines ? doc.line(last.number + 1).from : doc.length,
      closer: null,
      end: ledger,
      fileOpen: kind === 'details' && OPEN.test(attributes),
      align: ALIGN.exec(attributes)?.[1]?.toLowerCase() ?? null,
      parent: stack.at(-1) ?? -1,
    });
    stack.push(containers.length - 1);
  }
  // A `div` with no closing tag is no container; a `details` with none runs on, but only once the
  // parse has reached the end of the text (before that, no closing tag is not yet known).
  const reached = tree.length >= doc.length;
  const kept = containers.filter(
    (container) => container.closer !== null || (container.kind === 'details' && reached),
  );
  const parents = containers.map((container) => container.parent);
  for (const container of kept) {
    let up = container.parent;
    while (up !== -1 && !kept.includes(containers[up]!)) up = parents[up]!;
    container.parent = up === -1 ? -1 : kept.indexOf(containers[up]!);
  }
  // An unclosed details ends at the last block that is not the ledger.
  for (const container of kept) {
    if (container.closer) continue;
    container.end = Math.max(
      container.openerTo,
      trimEnd(state, container.bodyFrom, limits.get(container) ?? ledger),
    );
  }
  cache.set(tree, { length: doc.length, containers: kept });
  return kept;
}

function trimEnd(state: EditorState, from: number, to: number): number {
  let end = Math.min(to, state.doc.length);
  while (end > from && /\s/.test(state.sliceDoc(end - 1, end))) end--;
  return end;
}

/** The line a container is drawn on: its summary's, or its opening tag's. */
export function headLine(state: EditorState, container: Container): { from: number; to: number } {
  return container.summary ?? state.doc.lineAt(container.from);
}

/** What a person has done to the folds, and what a match or the caret holds open. */
interface Folds {
  /** A person's toggles, by the start of the opening tag's line. */
  over: ReadonlyMap<number, boolean>;
  /** The sections held open by where the caret or the current match is. */
  peek: ReadonlySet<number>;
}

/** Opens or closes a section by the start of its opening tag's line (`toggleFold`). */
export const setFold = StateEffect.define<{ from: number; open: boolean }>();
/** Holds open the sections that `pos` is in, for as long as the caret or the match stays there. */
export const holdOpenAt = StateEffect.define<number>();

const NONE: Folds = { over: new Map(), peek: new Set() };

function inside(container: Container, pos: number): boolean {
  return pos >= container.from && pos <= container.end;
}

/** The containers a position is in, outermost first. */
export function enclosing(state: EditorState, pos: number): Container[] {
  return containersOf(state).filter((container) => inside(container, pos));
}

function peeked(state: EditorState, positions: readonly number[]): Set<number> {
  const keys = new Set<number>();
  for (const pos of positions) for (const c of enclosing(state, pos)) keys.add(c.from);
  return keys;
}

export const foldField = StateField.define<Folds>({
  create: () => NONE,
  update(value, tr: Transaction) {
    let { over, peek } = value;
    if (tr.docChanged && over.size) {
      over = new Map([...over].map(([from, open]) => [tr.changes.mapPos(from, 1), open]));
    }
    if (tr.docChanged && peek.size) {
      peek = new Set([...peek].map((from) => tr.changes.mapPos(from, 1)));
    }
    // A toggle of a section an edit has taken away is forgotten, so that no later section that
    // lands on its place inherits it.
    if (tr.docChanged && over.size && syntaxTree(tr.state).length >= tr.state.doc.length) {
      const live = new Set(containersOf(tr.state).map((c) => c.from));
      if ([...over.keys()].some((from) => !live.has(from))) {
        over = new Map([...over].filter(([from]) => live.has(from)));
      }
    }
    let hold: number | null = null;
    for (const effect of tr.effects) {
      if (effect.is(setFold)) {
        const key = tr.changes.mapPos(effect.value.from, 1);
        over = new Map(over).set(key, effect.value.open);
        peek = new Set([...peek].filter((from) => from !== key));
      } else if (effect.is(holdOpenAt)) hold = effect.value;
    }
    if (hold !== null) peek = peeked(tr.state, [hold]);
    else if (tr.docChanged || tr.selection) {
      // What the caret is inside stays open; what it has left closes again. A caret that lands
      // in a closed section (an Undo, a jump to a change) opens it.
      const heads = tr.state.selection.ranges.flatMap((range) => [range.head]);
      const next = new Set<number>();
      for (const from of peek) {
        const container = containersOf(tr.state).find((c) => c.from === from);
        if (container && heads.some((head) => inside(container, head))) next.add(from);
      }
      for (const container of containersOf(tr.state)) {
        if (isOpen(tr.state, container, { over, peek: next })) continue;
        if (heads.some((head) => head >= container.bodyFrom && head <= container.end)) {
          next.add(container.from);
        }
      }
      peek = next;
    }
    return over === value.over && sameSet(peek, value.peek) ? value : { over, peek };
  },
});

function sameSet(a: ReadonlySet<number>, b: ReadonlySet<number>): boolean {
  return a.size === b.size && [...a].every((x) => b.has(x));
}

/** Whether a section shows its content. A `div` always does. */
export function isOpen(state: EditorState, container: Container, folds?: Folds): boolean {
  if (container.kind !== 'details') return true;
  const { over, peek } = folds ?? state.field(foldField, false) ?? NONE;
  return peek.has(container.from) || (over.get(container.from) ?? container.fileOpen);
}

/** Whether a section's content is folded away: closed, and a whole container that has content. */
export function isFolded(state: EditorState, container: Container): boolean {
  return !isOpen(state, container);
}

/** The ranges of whole lines that are hidden: tag lines, and the content of closed sections. */
export function hiddenContainerLines(state: EditorState): { from: number; to: number }[] {
  const spans: { from: number; to: number }[] = [];
  const { doc } = state;
  for (const container of containersOf(state)) {
    const open = isOpen(state, container);
    // The opening tag's line is hidden when the summary is drawn on a line of its own.
    if (container.summary || container.kind === 'div') {
      spans.push({ from: container.from, to: doc.lineAt(container.openerTo).to });
      if (container.summary) {
        // Only the line of the tag: the summary's line is drawn.
        spans[spans.length - 1]!.to = doc.lineAt(container.from).to;
      }
    }
    if (open) {
      if (container.closer) spans.push(container.closer);
    } else if (container.bodyFrom <= container.end) {
      spans.push({ from: container.bodyFrom, to: container.end });
    }
  }
  return spans;
}

/** The lines (by start) that hold container tags: the keys never join text into them. */
export function tagLines(state: EditorState): Set<number> {
  const lines = new Set<number>();
  const { doc } = state;
  for (const container of containersOf(state)) {
    for (
      let n = doc.lineAt(container.from).number;
      n <= doc.lineAt(container.openerTo).number;
      n++
    ) {
      lines.add(doc.line(n).from);
    }
    if (container.closer) lines.add(doc.lineAt(container.closer.from).from);
  }
  return lines;
}

export const containers: Extension = foldField;
