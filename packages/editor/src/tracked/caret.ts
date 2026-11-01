// Arrow keys over hidden text (design §5.5). The caret steps over markers, which draw nothing, so
// the two ends of a run of markers look the same: a press that only crosses such a run moves on
// by another character or word. Crossing deleted text or hidden lines is a step of its own,
// because the caret looks different at their two ends.

import { EditorSelection, Prec, type SelectionRange } from '@codemirror/state';
import { type Command, Direction, EditorView, keymap } from '@codemirror/view';
import { onlyHidden } from './decorations.ts';

type Move = (view: EditorView, start: SelectionRange, forward: boolean) => SelectionRange;

const byChar: Move = (view, start, forward) => view.moveByChar(start, forward);
const byGroup: Move = (view, start, forward) => view.moveByGroup(start, forward);

/** Whether the caret, moved from `from` to `to`, looks to be where it was. */
function unmoved(view: EditorView, from: number, to: number): boolean {
  return from !== to && onlyHidden(view.state, Math.min(from, to), Math.max(from, to), true);
}

/**
 * A command that moves the caret, or with `extend` the selection's head, toward the right or the
 * left, and moves again when a move only crosses markers. It leaves every other move to
 * CodeMirror's own command.
 */
function step(move: Move, right: boolean, extend: boolean): Command {
  return (view) => {
    const { selection } = view.state;
    const range = selection.main;
    if (selection.ranges.length > 1 || (!extend && !range.empty)) return false;
    const forward = right === (view.textDirectionAt(range.head) === Direction.LTR);
    let next = move(view, range, forward);
    if (!unmoved(view, range.head, next.head)) return false;
    // A few steps at most: past the markers, then past what comes after them.
    for (let i = 0; i < 4 && unmoved(view, range.head, next.head); i++) {
      const further = move(view, next, forward);
      if (further.head === next.head) break;
      next = further;
    }
    view.dispatch({
      selection: extend ? EditorSelection.range(range.anchor, next.head) : next,
      scrollIntoView: true,
      userEvent: 'select',
    });
    return true;
  };
}

/** Arrow keys, by character and by word, that cross a run of markers in one press. */
export const caretKeys = Prec.high(
  keymap.of([
    { key: 'ArrowLeft', run: step(byChar, false, false), shift: step(byChar, false, true) },
    { key: 'ArrowRight', run: step(byChar, true, false), shift: step(byChar, true, true) },
    {
      key: 'Mod-ArrowLeft',
      mac: 'Alt-ArrowLeft',
      run: step(byGroup, false, false),
      shift: step(byGroup, false, true),
    },
    {
      key: 'Mod-ArrowRight',
      mac: 'Alt-ArrowRight',
      run: step(byGroup, true, false),
      shift: step(byGroup, true, true),
    },
  ]),
);
