// The caret across breaks, and the other keys and input that edit line breaks (design: block
// editing, "Arrows, clicks, selection and Mac keys" and "Other keys and input that edit line
// breaks"). ← at the start of a block's text goes to the end of the text above in one press, and
// → back; ⌘← and ⌘→ stop at the start and end of a block's text; a click in the upper half of the
// space between two blocks goes to the block above. The Mac's control keys act as the block keys
// do, a `beforeinput` of a paragraph or a line break is Return or Shift-Return, and a user edit
// from anything else that adds or takes away a line break in a hidden run is dropped.

import { EditorSelection, EditorState, type Extension, Prec, Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { atomsOf, hiddenLines } from '../tracked/decorations.ts';
import { trackedEditAnnotation, viewModeField } from '../tracked/field.ts';
import { type KeyEdit, moveTo, textEnd, textStart } from './edits.ts';
import { type Block, blockAt, neighbours } from './structure.ts';

/** Blocks that take no text of their own: the caret goes to their edge. */
const NO_TEXT = new Set(['code', 'table', 'html', 'front-matter', 'math', 'definition']);

/** The block before `block` that the caret can rest in: past thematic breaks, which it skips. */
function restingBefore(state: EditorState, block: Block): Block | null {
  let prev = neighbours(state, block).prev;
  while (prev?.kind === 'rule') prev = neighbours(state, prev).prev;
  return prev;
}

function restingAfter(state: EditorState, block: Block): Block | null {
  let next = neighbours(state, block).next;
  while (next?.kind === 'rule') next = neighbours(state, next).next;
  return next;
}

/** The end of a block's text, or of its last line for one that takes no text. */
const endOf = (state: EditorState, block: Block) =>
  NO_TEXT.has(block.kind) ? state.doc.lineAt(block.lines.to).to : textEnd(state, block);

/**
 * The start of a block's text, on the left of any hidden markers in front of it (as CodeMirror's
 * → stops there), or the block's own start for one that takes no text.
 */
const startOf = (_state: EditorState, block: Block) => block.text.from;

/**
 * ← at the start of a block's text (or in its prefix, showing or not): the end of the text above,
 * in one press. Null elsewhere, for CodeMirror's ←.
 */
export function planArrowLeft(state: EditorState): KeyEdit | null {
  const { main } = state.selection;
  if (!main.empty || state.selection.ranges.length > 1) return null;
  const block = blockAt(state, main.head);
  if (!block || NO_TEXT.has(block.kind) || block.kind === 'rule') return null;
  const first = state.doc.lineAt(block.lines.from);
  if (main.head > textStart(state, block) || main.head < first.from) return null;
  const prev = restingBefore(state, block);
  if (!prev) return null;
  // Never inside hidden text (a line break hidden with the deletion in front of it, which makes the
  // block above an HTML comment for the parse): in front of it.
  const at = outOfHidden(state, endOf(state, prev), false);
  return at < main.head ? moveTo(at) : null;
}

/** A position strictly inside text the caret steps over, moved to its start, or its end. */
function outOfHidden(state: EditorState, pos: number, forward: boolean): number {
  let at = pos;
  atomsOf(state).between(pos, pos, (from, to) => {
    if (from < pos && pos < to) at = forward ? to : from;
  });
  return at;
}

/** → at the end of a block's text: the start of the text below, in one press. */
export function planArrowRight(state: EditorState): KeyEdit | null {
  const { main } = state.selection;
  if (!main.empty || state.selection.ranges.length > 1) return null;
  const block = blockAt(state, main.head);
  if (!block || NO_TEXT.has(block.kind) || block.kind === 'rule') return null;
  if (main.head < textEnd(state, block)) return null;
  const next = restingAfter(state, block);
  if (!next) return null;
  const at = outOfHidden(state, startOf(state, next), true);
  return at > main.head ? moveTo(at) : null;
}

/**
 * Where ⌘← (and ⌃A) goes from `head`, given the start of its visual line `boundary`: on a block's
 * first row the start of its text, not its hidden prefix.
 */
export function lineStartIn(state: EditorState, head: number, boundary: number): number {
  const block = blockAt(state, head);
  if (!block || NO_TEXT.has(block.kind)) return boundary;
  const first = state.doc.lineAt(block.lines.from);
  const start = textStart(state, block);
  return boundary >= first.from && boundary < start ? start : boundary;
}

/** Where ⌘→ (and ⌃E) goes: on a block's last row the end of its text, before hidden markers. */
export function lineEndIn(state: EditorState, head: number, boundary: number): number {
  const block = blockAt(state, head);
  if (!block || NO_TEXT.has(block.kind)) return boundary;
  const last = state.doc.lineAt(block.lines.to);
  const end = textEnd(state, block);
  return boundary <= last.to && boundary > end ? end : boundary;
}

/** Whether the caret is at the end of a block's text, where ⌃K and ⌘⌦ act as Delete. */
export function atTextEnd(state: EditorState): boolean {
  const { main } = state.selection;
  if (!main.empty) return false;
  const block = blockAt(state, main.head);
  return !!block && !NO_TEXT.has(block.kind) && main.head >= textEnd(state, block);
}

/** The state with the caret at the end of the caret's block's text: ⌘Return's Return. */
export function atBlockEnd(state: EditorState): EditorState | null {
  const { main } = state.selection;
  if (!main.empty) return null;
  const block = blockAt(state, main.head);
  if (!block || NO_TEXT.has(block.kind)) return null;
  return state.update({ selection: EditorSelection.cursor(textEnd(state, block)) }).state;
}

/**
 * The text of the caret's line in its block, without the line's syntax or its line break: what
 * ⇧⌘K deletes and ⌃L selects. Null outside a block's text, for CodeMirror's.
 */
export function lineText(state: EditorState): { from: number; to: number } | null {
  const { main } = state.selection;
  if (!main.empty) return null;
  const block = blockAt(state, main.head);
  if (!block || NO_TEXT.has(block.kind) || block.kind === 'rule') return null;
  const line = state.doc.lineAt(main.head);
  const first = state.doc.lineAt(block.lines.from).number === line.number;
  const from = first
    ? textStart(state, block)
    : line.from + (/^[ \t>]*/.exec(line.text)?.[0].length ?? 0);
  const last = state.doc.lineAt(block.lines.to).number === line.number;
  const to = last ? textEnd(state, block) : line.to;
  return { from, to: Math.max(from, to) };
}

/** Whether ⌃T would swap characters across a line break: at a line's start or end. */
export function transposeCrosses(state: EditorState): boolean {
  const { main } = state.selection;
  if (!main.empty) return false;
  const line = state.doc.lineAt(main.head);
  const start = line.from + (/^[ \t>]*/.exec(line.text)?.[0].length ?? 0);
  return main.head <= start || main.head >= line.to;
}

/**
 * Which block a click in the space between two blocks goes to: the space is the padding on top of
 * the line below, and its upper half belongs to the block above (`'above'`), as the space after
 * a paragraph does in Word and Docs; null for a click in the line's text.
 */
export function gapSide(clickY: number, lineTop: number, paddingTop: number): 'above' | null {
  if (paddingTop <= 0) return null;
  const into = clickY - lineTop;
  return into >= 0 && into < paddingTop / 2 ? 'above' : null;
}

/** A click in the upper half of the space above a block: the caret at the end of the block above,
 * at the click's column. */
const gapClicks = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (event.button !== 0 || event.detail > 1 || event.shiftKey) return false;
    if (view.state.field(viewModeField, false) === 'raw') return false;
    const target = event.target instanceof Element ? event.target.closest('.cm-line') : null;
    if (!(target instanceof HTMLElement)) return false;
    const rect = target.getBoundingClientRect();
    const padding = Number.parseFloat(getComputedStyle(target).paddingTop) || 0;
    if (gapSide(event.clientY, rect.top, padding) !== 'above') return false;
    const pos = view.posAtCoords({ x: event.clientX, y: rect.top - 1 }, false);
    view.dispatch({
      selection: EditorSelection.cursor(pos),
      userEvent: 'select.pointer',
      scrollIntoView: true,
    });
    view.focus();
    event.preventDefault();
    return true;
  },
});

/** Whether a transaction is one the block keys made, or one that the backstop leaves alone. */
function exempt(tr: Transaction): boolean {
  return (
    tr.isUserEvent('input.break') ||
    tr.isUserEvent('delete.backward.block') ||
    tr.isUserEvent('delete.forward.block') ||
    tr.isUserEvent('delete.block') ||
    tr.isUserEvent('delete.selection') ||
    tr.isUserEvent('undo') ||
    tr.isUserEvent('redo') ||
    !!tr.annotation(Transaction.remote) ||
    // What the tracked layer writes itself (a composition made a change, a format call).
    !!tr.annotation(trackedEditAnnotation)
  );
}

/**
 * The backstop: a user edit from anything but the block keys, with no selection, that takes away
 * a line break around or inside a run of hidden lines, or puts one inside it, is dropped. The
 * keys a person presses are the block keys' in Clean and Redlines; this catches what else could
 * (a command, an input the page didn't map).
 */
const hiddenBreaks = Prec.lowest(
  EditorState.transactionFilter.of((tr) => {
    if (!tr.docChanged || exempt(tr)) return tr;
    if (!['input', 'delete', 'move'].some((event) => tr.isUserEvent(event))) return tr;
    const start = tr.startState;
    if (start.field(viewModeField, false) === 'raw') return tr;
    if (start.selection.ranges.some((range) => !range.empty)) return tr;
    const runs = hiddenLines(start);
    let crossed = false;
    tr.changes.iterChanges((from, to, _fromB, _toB, inserted) => {
      if (crossed) return;
      const removed = from < to && start.doc.sliceString(from, to).includes('\n');
      const added = inserted.toString().includes('\n');
      runs.between(Math.max(0, from - 1), Math.min(start.doc.length, to + 1), (runFrom, runTo) => {
        const around = {
          from: Math.max(0, runFrom - 1),
          to: Math.min(start.doc.length, runTo + 1),
        };
        if (removed && from < around.to && to > around.from) crossed = true;
        if (added && from > around.from && from < around.to) crossed = true;
        return crossed ? false : undefined;
      });
    });
    return crossed ? {} : tr;
  }),
);

/** The page's paragraph and line break inputs as Return and Shift-Return. */
function beforeInput(run: {
  paragraph: (view: EditorView) => boolean;
  line: (view: EditorView) => boolean;
}) {
  return Prec.highest(
    EditorView.domEventHandlers({
      beforeinput(event, view) {
        if (view.state.field(viewModeField, false) === 'raw') return false;
        if (view.composing) return false;
        const command =
          event.inputType === 'insertParagraph'
            ? run.paragraph
            : event.inputType === 'insertLineBreak'
              ? run.line
              : null;
        if (!command || !command(view)) return false;
        event.preventDefault();
        return true;
      },
    }),
  );
}

/** The motion and input extensions, given the block keys' Return and Shift-Return. */
export function blockMotion(run: {
  paragraph: (view: EditorView) => boolean;
  line: (view: EditorView) => boolean;
}): Extension {
  return [gapClicks, hiddenBreaks, beforeInput(run)];
}
