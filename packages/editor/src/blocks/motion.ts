// The caret across breaks, and the other keys and input that edit line breaks (design: block
// editing, "Arrows, clicks, selection and Mac keys" and "Other keys and input that edit line
// breaks"). ← at the start of a block's text goes to the end of the text above in one press, and
// → back; ⌘← and ⌘→ stop at the start and end of a block's text; a click in the upper half of the
// space between two blocks goes to the block above. The Mac's control keys act as the block keys
// do, a `beforeinput` of a paragraph or a line break is Return or Shift-Return, and a user edit
// from anything else that adds or takes away a line break in a hidden run is dropped.

import {
  cursorLineDown,
  cursorPageDown,
  selectLineDown,
  selectPageDown,
} from '@codemirror/commands';
import {
  EditorSelection,
  EditorState,
  type Extension,
  Prec,
  type SelectionRange,
  Transaction,
} from '@codemirror/state';
import { type Command, EditorView, keymap } from '@codemirror/view';
import { atomsOf, hiddenLines } from '../tracked/decorations.ts';
import { trackedEditAnnotation, viewModeField } from '../tracked/field.ts';
import { hardBreakAt, type KeyEdit, moveTo, nothing, textEnd, textStart } from './edits.ts';
import { type Block, blockAt, neighbours, NO_TEXT } from './structure.ts';

/** The block before `block` that the caret can rest in: past thematic breaks, which it skips. */
export function restingBefore(state: EditorState, block: Block): Block | null {
  let prev = neighbours(state, block).prev;
  while (prev?.kind === 'rule') prev = neighbours(state, prev).prev;
  return prev;
}

export function restingAfter(state: EditorState, block: Block): Block | null {
  let next = neighbours(state, block).next;
  while (next?.kind === 'rule') next = neighbours(state, next).next;
  return next;
}

/** The end of a block's text, or of its last line for one that takes no text. */
export const endOf = (state: EditorState, block: Block) =>
  NO_TEXT.has(block.kind)
    ? restingPlace(state, state.doc.lineAt(block.lines.to).to)
    : textEnd(state, block);

/**
 * The start of a block's text, on the left of any hidden markers in front of it (as CodeMirror's
 * → stops there), or the block's own start for one that takes no text.
 */
export const startOf = (_state: EditorState, block: Block) => block.text.from;

/**
 * ← at the start of a block's text (or in its prefix, showing or not): the end of the text above,
 * in one press. Null elsewhere, for CodeMirror's ←.
 */
export function planArrowLeft(state: EditorState): KeyEdit | null {
  const { main } = state.selection;
  if (!main.empty || state.selection.ranges.length > 1) return null;
  const block = blockAt(state, main.head);
  if (!block || NO_TEXT.has(block.kind) || block.kind === 'rule') return null;
  // A hard line break is one character: ← from the start of the line after it goes to the end of
  // the text before it, past the syntax the break hides.
  const hard = hardBreakAt(state, block, main.head);
  if (hard && main.head > hard.from && main.head <= hard.to) {
    return moveTo(outOfHidden(state, hard.from, false));
  }
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
export function outOfHidden(state: EditorState, pos: number, forward: boolean): number {
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
  // → in front of a hard line break's syntax, or in it: the start of the next line's text.
  const hard = hardBreakAt(state, block, main.head);
  if (hard && main.head >= hard.from && main.head < hard.to) {
    return moveTo(outOfHidden(state, hard.to, true));
  }
  if (main.head < textEnd(state, block)) return null;
  const next = restingAfter(state, block);
  // At the end of the last block there is nowhere to go: CodeMirror's → would step into the closers
  // and the ledger that follow it, which are hidden.
  if (!next) return nothing(state);
  const at = outOfHidden(state, startOf(state, next), true);
  return at > main.head ? moveTo(at) : null;
}

/**
 * ⌥↑ and ⌥↓ (with ⇧, selecting): ⌥↑ goes to the start of the paragraph, or of the one before when
 * it is there already, and ⌥↓ to the end, or the end of the next one's, as in other Mac apps. A
 * paragraph is a block's text; CodeMirror's keys move the source line instead, which would move a
 * block's markers and other blocks' syntax. A caret that no block holds stays.
 */
export function planParagraphMotion(
  state: EditorState,
  forward: boolean,
  extend: boolean,
): KeyEdit | null {
  if (state.selection.ranges.length > 1) return null;
  const { anchor, head } = state.selection.main;
  const block = blockAt(state, head);
  let target = head;
  if (block && block.kind !== 'rule') {
    const own = forward ? endOf(state, block) : startOf(state, block);
    // The paragraph's own edge, or where the caret already is, the next one's.
    const there = forward ? head >= own : head <= own;
    const next = there
      ? forward
        ? restingAfter(state, block)
        : restingBefore(state, block)
      : null;
    target = next ? (forward ? endOf(state, next) : startOf(state, next)) : own;
  }
  const at = outOfHidden(state, target, forward);
  return {
    changes: [],
    selection: extend ? EditorSelection.single(anchor, at) : EditorSelection.single(at),
    userEvent: 'input.break',
  };
}

/** The text of the block at `pos` that a triple-click there selects: not its line break. */
function blockTextAt(state: EditorState, pos: number): { from: number; to: number } | null {
  const block = blockAt(state, pos);
  if (!block || block.kind === 'rule') return null;
  // A block that takes no text (code, a table row, HTML) has its lines: the line's text.
  if (NO_TEXT.has(block.kind)) {
    const line = state.doc.lineAt(pos);
    return { from: line.from, to: line.to };
  }
  const from = textStart(state, block);
  return { from, to: Math.max(from, textEnd(state, block)) };
}

/**
 * Triple-click: the block's text, without its line break (CodeMirror's selects the source line with
 * its line break, and typing over that would join two blocks). Dragging on selects whole blocks'
 * text, as dragging after a triple-click selects whole lines.
 */
const tripleClicks = EditorView.mouseSelectionStyle.of((view, event) => {
  if (event.button !== 0 || event.detail < 3 || event.shiftKey) return null;
  if (view.state.field(viewModeField, false) === 'raw') return null;
  const start = view.posAtCoords({ x: event.clientX, y: event.clientY }, false);
  // A table's triple-click selects the cell's text: the table's own presses decide it.
  if (blockAt(view.state, start)?.kind === 'table') return null;
  const first = blockTextAt(view.state, start);
  if (!first) return null;
  return {
    get(current, _extend, multiple) {
      const pos = view.posAtCoords({ x: current.clientX, y: current.clientY }, false);
      const last = blockTextAt(view.state, pos) ?? first;
      const forward = pos >= start;
      const from = Math.min(first.from, last.from);
      const to = Math.max(first.to, last.to);
      const range = forward ? EditorSelection.range(from, to) : EditorSelection.range(to, from);
      return multiple
        ? EditorSelection.create(
            [...view.state.selection.ranges, range],
            view.state.selection.ranges.length,
          )
        : EditorSelection.create([range]);
    },
    update() {},
  };
});

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
  if (!block) return boundary;
  // A block that takes no text: the end of its line, in front of any hidden closers on it (#494).
  if (NO_TEXT.has(block.kind)) return restingPlace(state, boundary);
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
    // The end of the block above rests in front of the closers that end its text (#434).
    const pos = restingPlace(
      view.state,
      view.posAtCoords({ x: event.clientX, y: rect.top - 1 }, false),
    );
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

/**
 * Where a caret or a selection's end that is put at `pos` rests, the one rule for every way to put
 * it there (End, a click, a drag, a shift-click, a double-click, ↓ and ⇟): `pos` itself, or, where
 * it is the end of a line past the hidden closers that end the line's text, in front of them,
 * where typing leaves the caret (#434). Past the closers is no place for the caret: they and the
 * hidden break after them are one range that the caret steps over, so a click or a key that lands
 * there is moved to the start of the next block, or rests where the DOM can't tell it from there.
 * A block that takes no text (HTML, code, a table's cell) rests at the end of its line the same
 * way. The end of a paragraph that ends in a pending deletion rests in front of the struck text,
 * as ⌘→ always went (#494).
 */
export function restingPlace(state: EditorState, pos: number): number {
  const block = blockAt(state, pos);
  if (block && !NO_TEXT.has(block.kind) && block.kind !== 'rule') {
    return pos === block.text.to ? Math.min(pos, textEnd(state, block)) : pos;
  }
  const line = state.doc.lineAt(pos);
  if (pos !== line.to) return pos;
  let at = pos;
  atomsOf(state).between(pos, pos, (from, to) => {
    if (from >= line.from && from < pos && pos < to) at = from;
  });
  return at;
}

/** Whether a line of the document ends inside the range of hidden closers and a break after them. */
function hasTails(state: EditorState): boolean {
  let found = false;
  atomsOf(state).between(0, state.doc.length, (from, to) => {
    if (to > state.doc.lineAt(from).to && from < state.doc.lineAt(from).to) found = true;
    return found ? false : undefined;
  });
  return found;
}

/**
 * The start of the hidden closers that end the row before `pos`, when `pos` is the far edge of the
 * range that the closers and the break after them make: where a move down that landed at the end
 * of that row was taken on to, past the break.
 */
function tailBefore(state: EditorState, pos: number): number | null {
  let from: number | null = null;
  atomsOf(state).between(pos, pos, (start, end) => {
    if (end === pos && start < pos) from = start;
  });
  if (from === null) return null;
  const line = state.doc.lineAt(from);
  if (pos <= line.to || restingPlace(state, line.to) !== from) return null;
  return state.doc.sliceString(line.from, from).trim() === '' ? null : from;
}

/**
 * ↓ and ⇟ that end at the end of a row of text that is followed by hidden closers (the end of a
 * block that a typed or commented change ends): CodeMirror steps a caret that lands inside the
 * range of the closers and the break after them to its far edge, the start of the next block
 * (#491). The move meant the end of the row: in front of the closers. A caret that starts on that
 * row, or lands at the start of the next block by its column (not past the end of the row above),
 * is the move's own. Moves up, which CodeMirror takes to the near edge, are as they are.
 */
function settleVertical(
  view: EditorView,
  start: SelectionRange,
  moved: SelectionRange,
  forward: boolean,
): SelectionRange {
  if (!forward || moved.head <= start.head) return moved;
  const row = tailBefore(view.state, moved.head);
  if (row === null) return moved;
  const end = view.coordsAtPos(row, -1);
  const from = view.coordsAtPos(
    start.head,
    start.assoc || ((start.empty ? forward : start.head === start.from) ? 1 : -1),
  );
  if (!end || !from || from.bottom > end.top + 1) return moved;
  // The column the move aims at: CodeMirror's own, kept in the range it returns.
  const rect = view.contentDOM.getBoundingClientRect();
  const goal = start.goalColumn ?? from.left - rect.left;
  if (rect.left + goal < end.left - 1) return moved;
  return EditorSelection.cursor(row, -1, undefined, goal);
}

/** A view whose vertical moves are `settleVertical`'s, for CodeMirror's own commands to act on. */
function settling(view: EditorView): EditorView {
  return new Proxy(view, {
    get(target, key) {
      if (key === 'moveVertically') {
        return (start: SelectionRange, forward: boolean, distance?: number) =>
          settleVertical(target, start, target.moveVertically(start, forward, distance), forward);
      }
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === 'function'
        ? (value as (...args: unknown[]) => unknown).bind(target)
        : value;
    },
  });
}

const settled =
  (command: Command): Command =>
  (view) =>
    view.state.field(viewModeField, false) !== 'raw' && command(settling(view));

/**
 * The keys that move down by a row or a page, CodeMirror's commands with the end of a row settled
 * (#491). The keys that move up are CodeMirror's, which rest in front of the closers.
 */
const verticalKeys = Prec.high(
  keymap.of([
    { key: 'ArrowDown', run: settled(cursorLineDown), shift: settled(selectLineDown) },
    { key: 'PageDown', run: settled(cursorPageDown), shift: settled(selectPageDown) },
    { mac: 'Ctrl-n', run: settled(cursorLineDown), shift: settled(selectLineDown) },
    { mac: 'Ctrl-v', run: settled(cursorPageDown) },
    { mac: 'Ctrl-ArrowDown', run: settled(cursorPageDown), shift: settled(selectPageDown) },
  ]),
);

/**
 * A click, a modified click and a drag that ends past the end of a line, which end in front of the
 * hidden closers that end it, and a double-click there (#434, #494). CodeMirror puts the end of
 * the line, inside the range of the closers and the break after them, and steps it on to the start
 * of the next block, where a command that follows (⌘2) acts on the next block, and typing after a
 * drag joins two blocks. This is CodeMirror's own selection by the mouse (a click, ⇧ to extend, ⌥
 * or ⌘ to add a range, a double-click's word, a drag) with `restingPlace` at both ends; a
 * double-click's drag, and a triple-click, are CodeMirror's and `tripleClicks`'.
 */
const pointerSelection = EditorView.mouseSelectionStyle.of((view, event) => {
  if (event.button !== 0 || event.detail > 2) return null;
  if (view.state.field(viewModeField, false) === 'raw' || !hasTails(view.state)) return null;
  const type = event.detail === 2 ? 2 : 1;
  const at = (e: MouseEvent) => {
    const { pos, assoc } = view.posAndSideAtCoords({ x: e.clientX, y: e.clientY }, false);
    const rested = restingPlace(view.state, pos);
    return { pos: rested, assoc: rested === pos ? assoc : (-1 as const), hit: pos };
  };
  let start = at(event);
  // A table's presses are the table's own (cells, rectangles of cells).
  if (blockAt(view.state, start.hit)?.kind === 'table') return null;
  // A double-click picks the word, which CodeMirror's own does, but past the end of a line.
  if (type === 2 && start.pos === start.hit) return null;
  let startSel = view.state.selection;
  const rangeFor = (pos: number, assoc: -1 | 1): SelectionRange => {
    if (type === 1) return EditorSelection.cursor(pos, assoc);
    const word = view.state.wordAt(pos);
    return word ? EditorSelection.range(word.from, word.to) : EditorSelection.cursor(pos, assoc);
  };
  return {
    update(update) {
      if (update.docChanged) {
        start = { ...start, pos: update.changes.mapPos(start.pos) };
        startSel = startSel.map(update.changes);
      }
    },
    get(current, extend, multiple) {
      const cur = at(current);
      let range = rangeFor(cur.pos, cur.assoc);
      if (start.pos !== cur.pos && !extend) {
        const first = rangeFor(start.pos, start.assoc);
        const from = Math.min(first.from, range.from);
        const to = Math.max(first.to, range.to);
        range =
          from < range.from
            ? EditorSelection.range(from, to, undefined, undefined, range.assoc)
            : EditorSelection.range(to, from, undefined, undefined, range.assoc);
      }
      if (extend) {
        return startSel.replaceRange(startSel.main.extend(range.from, range.to, range.assoc));
      }
      if (multiple && type === 1 && startSel.ranges.length > 1) {
        const index = startSel.ranges.findIndex((r) => r.from <= cur.pos && r.to >= cur.pos);
        if (index >= 0) {
          const rest = startSel.ranges.filter((_, i) => i !== index);
          const main =
            startSel.mainIndex === index ? 0 : startSel.mainIndex - +(startSel.mainIndex > index);
          return EditorSelection.create(rest, main);
        }
      }
      return multiple ? startSel.addRange(range) : EditorSelection.create([range]);
    },
  };
});

/** The motion and input extensions, given the block keys' Return and Shift-Return. */
export function blockMotion(run: {
  paragraph: (view: EditorView) => boolean;
  line: (view: EditorView) => boolean;
}): Extension {
  return [gapClicks, pointerSelection, tripleClicks, hiddenBreaks, verticalKeys, beforeInput(run)];
}
