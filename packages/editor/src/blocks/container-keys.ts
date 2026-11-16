// The keys of containers (#688): Backspace and Delete never join a paragraph into a tag line,
// which would make it text of the tag's HTML block and end the container on GitHub; and a key on a
// summary line opens or closes its section.

import { Prec } from '@codemirror/state';
import { type Command, EditorView, keymap } from '@codemirror/view';
import { BLANK } from './hidden.ts';
import { containersOf, headLine, isOpen, setFold, tagLines } from './containers.ts';

/** A line that starts with a block's marker: a key there changes the block, it joins nothing. */
const MARKED = /^\s{0,3}(?:[#>*+\-|`~]|\d+[.)])/;

/**
 * Whether a tag line is the next line in the direction `step` from line `n`, or the one after a
 * single blank line: the key would then take away the line break that keeps the text and the tag
 * apart (with more blank lines between, it takes away only a blank one).
 */
function tagNext(view: EditorView, n: number, step: -1 | 1): boolean {
  const { doc } = view.state;
  const tags = tagLines(view.state);
  const next = doc.line(Math.min(doc.lines, Math.max(1, n + step)));
  if (n + step < 1 || n + step > doc.lines) return false;
  if (tags.has(next.from)) return true;
  if (!BLANK.test(next.text) || n + 2 * step < 1 || n + 2 * step > doc.lines) return false;
  return tags.has(doc.line(n + 2 * step).from);
}

const backspace: Command = (view) => {
  const { state } = view;
  const range = state.selection.main;
  if (!range.empty || state.selection.ranges.length > 1) return false;
  const line = state.doc.lineAt(range.head);
  const container = containersOf(state).find(
    (c) => c.summary && line.from === c.summary.from && range.head <= c.summary.textFrom,
  );
  // At the start of a summary, the line break above it is the tag's.
  if (container) return true;
  if (range.head !== line.from || MARKED.test(line.text)) return false;
  return tagNext(view, line.number, -1) && !tagOnly(view, line.number);
};

const del: Command = (view) => {
  const { state } = view;
  const range = state.selection.main;
  if (!range.empty || state.selection.ranges.length > 1) return false;
  const line = state.doc.lineAt(range.head);
  const summary = containersOf(state).find(
    (c) => c.summary && line.from === c.summary.from && range.head >= c.summary.textTo,
  );
  // At the end of a summary, the line break below it is the tag's.
  if (summary) return true;
  if (range.head !== line.to) return false;
  return tagNext(view, line.number, 1) && !tagOnly(view, line.number);
};

/** Whether the line is itself a tag line (Backspace there is the tag's own business). */
function tagOnly(view: EditorView, n: number): boolean {
  return tagLines(view.state).has(view.state.doc.line(n).from);
}

/** The section whose summary line the caret is on. */
function sectionAtCaret(view: EditorView) {
  const head = view.state.selection.main.head;
  return containersOf(view.state).find((c) => {
    if (c.kind !== 'details') return false;
    const line = headLine(view.state, c);
    return head >= line.from && head <= line.to;
  });
}

const toggle =
  (open: boolean): Command =>
  (view) => {
    const section = sectionAtCaret(view);
    if (!section || isOpen(view.state, section) === open) return false;
    view.dispatch({ effects: setFold.of({ from: section.from, open }) });
    return true;
  };

export const containerKeys = Prec.highest(
  keymap.of([
    { key: 'Backspace', run: backspace },
    { key: 'Delete', run: del },
    { key: 'Mod-Alt-ArrowDown', run: toggle(true) },
    { key: 'Mod-Alt-ArrowUp', run: toggle(false) },
  ]),
);
