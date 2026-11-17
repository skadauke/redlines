// Undo and Redo. A tracked edit, a decision, a reply and an agent's edit in a run are each a step to
// undo. A new version of the file from disk is not: the steps before it were made to the old
// version, and replayed over the new text they could take its work apart, a reply's lines left
// after the ledger or a suggestion's ledger entry gone. So a reload that changes the text starts
// the history over, with nothing to undo or redo, and Undo says why it does nothing.
//
// As a safeguard, once the text has changed outside the history in any other way, an undo or redo
// that would break the file, adding a warning to its parse or putting text after its ledger, is
// refused with the same message.

import {
  ChangeSet,
  Compartment,
  EditorSelection,
  EditorState,
  type Extension,
  Prec,
  StateEffect,
  type StateCommand,
  StateField,
  Transaction,
} from '@codemirror/state';
import { type Command, EditorView, type KeyBinding } from '@codemirror/view';
import type { Parsed, TextChange, Warning } from '@redlines/format';
import { takeBackAnnotation } from '../blocks/open.ts';
import { hardBreakAtoms } from '../preview/decorations.ts';
import { atomsOf } from '../tracked/decorations.ts';
import { intentOf } from '../tracked/intent.ts';
import { bodyEnd, parsedField } from '../tracked/field.ts';
import {
  authoredChanges,
  RAW_READ_ONLY,
  rawIsReadOnly,
  refusedEditEffect,
} from '../tracked/typing.ts';
import { agentCaret } from './caret.ts';
import {
  history,
  historyField,
  historyKeymap,
  markNotes,
  remoteStep,
  redo,
  redoDepth,
  type StepInfo,
  undo,
  undoDepth,
} from './history.ts';
import { labelOf } from './names.ts';

export const UNDO_AFTER_RELOAD = 'Undo isn’t available after the file changed on disk.';
export const REDO_AFTER_RELOAD = 'Redo isn’t available after the file changed on disk.';

/** An empty history, which the history starts over with. */
const EMPTY = EditorState.create({ extensions: historyField }).field(historyField);

/** Holds what starts the history over: each reload that changes the text puts a new one in. */
const restart = new Compartment();

/** Comes with the reload that starts the history over: whether it had steps to undo or redo. */
const startedOver = StateEffect.define<boolean>();

/**
 * Whether a reload took steps to undo or redo away, and nothing has been done since: Undo and Redo
 * then say why they do nothing.
 */
const droppedField = StateField.define<boolean>({
  create: () => false,
  update(dropped, tr) {
    for (const effect of tr.effects) if (effect.is(startedOver)) return effect.value;
    return tr.docChanged && tr.annotation(Transaction.addToHistory) !== false ? false : dropped;
  },
});

/**
 * Whether the text changed outside the history since it started (over), by a change that didn't
 * go through `reloadDoc`: its steps may no longer fit the text.
 */
const outsideField = StateField.define<boolean>({
  create: () => false,
  update(outside, tr) {
    if (tr.effects.some((effect) => effect.is(startedOver))) return false;
    // Taking back the Returns that opened an empty paragraph, as the caret leaves it, goes in
    // outside the history, which drops their steps (a Return joined to the step before it is
    // composed out of it, exactly): what is left fits the text exactly.
    if (tr.annotation(takeBackAnnotation)) return outside;
    // Another person's edit from the session isn't the file changed on disk: its steps are mapped.
    if (tr.annotation(remoteStep)) return outside;
    return outside || (tr.docChanged && tr.annotation(Transaction.addToHistory) === false);
  },
});

/** Whether `tr` starts the history over: a reload that changed the text (`startOver`). */
export function startsOver(tr: Transaction): boolean {
  return tr.effects.some((effect) => effect.is(startedOver));
}

/** Whether the text changed outside the history since it started (over). For tests. */
export function changedOutside(state: EditorState): boolean {
  return state.field(outsideField, false) ?? false;
}

/** The effects that start the history over, for a reload of `state` that changes its text. */
export function startOver(state: EditorState): StateEffect<unknown>[] {
  // A second reload in a row finds the history empty, but its steps were still taken away.
  const dropped =
    undoDepth(state) > 0 || redoDepth(state) > 0 || (state.field(droppedField, false) ?? false);
  return [restart.reconfigure(historyField.init(() => EMPTY)), startedOver.of(dropped)];
}

/** Why Undo or Redo would do nothing, when there is something to say: Plain, or a reload. */
function whyNot(state: EditorState, afterReload: string): string | null {
  if (rawIsReadOnly(state)) return RAW_READ_ONLY;
  return !state.readOnly && state.field(droppedField, false) ? afterReload : null;
}

/** Whether Undo has a step to take back. */
export const undoHasSomething = (state: EditorState) => undoDepth(state) > 0;

/** Whether Redo has a step to bring back. */
export const redoHasSomething = (state: EditorState) => redoDepth(state) > 0;

/**
 * Why Undo is grayed, when there is something to say beyond "nothing to undo": a reload took its
 * steps away, or Plain is read-only (a hint for the Edit menu and the toolbar, as a command's is).
 */
export const undoDisabledReason = (state: EditorState): string | undefined =>
  undoDepth(state) > 0 ? undefined : (whyNot(state, UNDO_AFTER_RELOAD) ?? undefined);

/** Why Redo is grayed, likewise. */
export const redoDisabledReason = (state: EditorState): string | undefined =>
  redoDepth(state) > 0 ? undefined : (whyNot(state, REDO_AFTER_RELOAD) ?? undefined);

/**
 * Undo or Redo, which says why it does nothing: in Plain while Track Changes is on, which is
 * read-only, or after a reload took its steps away.
 */
function sayingWhy(command: StateCommand, message: string): Command {
  return (view) => {
    // Raw while edits are tracked takes no step back, with or without a sheet that asks about typing.
    if (!rawIsReadOnly(view.state) && command(view)) return true;
    const why = whyNot(view.state, message);
    if (!why) return false;
    view.dispatch({ effects: refusedEditEffect.of(why) });
    return true;
  };
}

/** Undo, saying why it does nothing, for the host's Edit menu. */
export const undoSayingWhy = sayingWhy(undo, UNDO_AFTER_RELOAD);
/** Redo, likewise. */
export const redoSayingWhy = sayingWhy(redo, REDO_AFTER_RELOAD);

/**
 * Undo or Redo as the editor's own, which the Edit menu and the keys share: it says why it does
 * nothing when it can, and else calls `nothing` (the host beeps). It is always taken, so that the
 * key never goes on to the page's own undo, which the editor's history doesn't know.
 */
const taking =
  (command: Command, nothing: (() => void) | undefined): Command =>
  (view) => {
    if (!command(view)) nothing?.();
    return true;
  };

/**
 * CodeMirror's keys for Undo and Redo, which say why they do nothing after a reload, and take the
 * key when there is nothing, calling `nothing`.
 */
export const undoKeys = (nothing?: (redo: boolean) => void): readonly KeyBinding[] =>
  historyKeymap.map((binding) => {
    if (binding.run === undo)
      return { ...binding, run: taking(undoSayingWhy, nothing && (() => nothing(false))) };
    if (binding.run === redo)
      return { ...binding, run: taking(redoSayingWhy, nothing && (() => nothing(true))) };
    return binding;
  });

export const undoKeymap: readonly KeyBinding[] = undoKeys();

/**
 * The selection of a redo with each end that is strictly inside hidden text moved out of
 * it (#461): a caret to the nearer edge, a range's ends outward. A place at an edge of hidden text,
 * the start of the file included, stays where the step left it.
 */
function outOfHiddenText(tr: Transaction): EditorSelection {
  const { selection } = tr.state;
  // The hard breaks' spaces are in the preview's field, not among the atoms of `atomsOf` (#649).
  const atoms = [atomsOf(tr.state), hardBreakAtoms(tr.state)];
  const end = bodyEnd(tr.state.field(parsedField));
  const outside = (pos: number, side: -1 | 0 | 1) => {
    let moved = pos;
    for (const set of atoms) {
      set.between(pos, pos, (from, to) => {
        if (from < pos && pos < to) {
          moved = side < 0 || (side === 0 && pos - from <= to - pos) ? from : to;
        }
      });
    }
    // Never past the body: onto the ledger that is hidden after it, in front of the closers that
    // end the body's text when the body's end is inside them (as `selectionInBody` stops a
    // selection).
    if (end !== null && moved > end) {
      moved = end;
      for (const set of atoms) {
        set.between(end, end, (from, to) => {
          if (from < end && end < to) moved = from;
        });
      }
    }
    return moved;
  };
  const next = EditorSelection.create(
    selection.ranges.map((range) =>
      range.empty
        ? EditorSelection.cursor(outside(range.head, 0))
        : EditorSelection.range(
            outside(range.anchor, range.anchor < range.head ? -1 : 1),
            outside(range.head, range.head < range.anchor ? -1 : 1),
          ),
    ),
    selection.mainIndex,
  );
  return next.eq(selection) ? selection : next;
}

/** Whose a step is: the intent's author, and the marks a tracked step wrote (per-person undo). */
function stepInfo(tr: Transaction): StepInfo {
  const made = intentOf(tr);
  // A group of steps is one person's: the first step says who, and whether it was tracked.
  const intent = made?.kind === 'steps' ? made.steps[0] : made;
  if (!intent) return { person: null, marks: [] };
  const person = intent.author?.handle ?? null;
  const tracked =
    'tracking' in intent
      ? intent.tracking
      : intent.kind === 'move' || intent.kind === 'widened-paste';
  if (!person || !tracked) return { person, marks: [] };
  const before = tr.startState.field(parsedField, false);
  const after = tr.state.field(parsedField, false);
  if (!before || !after) return { person, marks: [] };
  const known = new Set(before.marks.map((mark) => mark.id));
  const written = after.marks.filter((mark) => !known.has(mark.id));
  return {
    person,
    marks: written.map((mark) => mark.id),
    entries: markNotes(before, after),
    // The old text of a deletion is in its marker, which Undo can't find again once another person
    // accepts it.
    deleted: written
      .filter((mark) => mark.payload && (mark.kind === 'del' || mark.kind === 'sub'))
      .map((mark) => ({ id: mark.id, at: mark.segments[0]!.open.from, text: mark.payload! })),
  };
}

/** Writes edits as the person's own, for Undo of a step that another person decided. */
function takeBack(
  state: EditorState,
  text: string,
  parsed: Parsed,
  edits: readonly TextChange[],
): ChangeSet | null {
  try {
    return authoredChanges(state, text, parsed, edits);
  } catch {
    return null;
  }
}

/** The history, and Undo and Redo from the Edit menu, which reach the page as input events. */
export function undoHistory(): Extension {
  return [
    history({ agentCaret, visibleCaret: outOfHiddenText, label: labelOf, stepInfo, takeBack }),
    restart.of([]),
    droppedField,
    outsideField,
    Prec.high(
      EditorView.domEventHandlers({
        beforeinput(event, view) {
          if (event.inputType === 'historyUndo') return undoSayingWhy(view);
          if (event.inputType === 'historyRedo') return redoSayingWhy(view);
          return false;
        },
      }),
    ),
  ];
}

/** Whether text follows the ledger, which should end the file. */
const textAfterLedger = (parsed: Parsed) => parsed.ledgerRange !== null && bodyEnd(parsed) === null;

/** Whether `after` has a warning that `before` doesn't, counting warnings that repeat. */
function newWarning(before: Parsed, after: Parsed): boolean {
  const key = (warning: Warning) => `${warning.code} ${warning.id ?? ''} ${warning.message}`;
  const known = new Map<string, number>();
  for (const warning of before.warnings)
    known.set(key(warning), (known.get(key(warning)) ?? 0) + 1);
  return after.warnings.some((warning) => {
    const left = known.get(key(warning)) ?? 0;
    known.set(key(warning), left - 1);
    return left <= 0;
  });
}

/**
 * Why an undo or a redo must not happen, or null when it may: after the text changed outside the
 * history, a step that would add a warning to the parse or put text after the ledger. Without such
 * a change, a step gives back exactly a text the person had, which can't be refused.
 */
export function refusedStep(tr: Transaction): string | null {
  const step = tr.isUserEvent('undo')
    ? UNDO_AFTER_RELOAD
    : tr.isUserEvent('redo')
      ? REDO_AFTER_RELOAD
      : null;
  if (!step || !tr.docChanged || !tr.startState.field(outsideField, false)) return null;
  const before = tr.startState.field(parsedField);
  const after = tr.state.field(parsedField);
  const breaks = newWarning(before, after) || (textAfterLedger(after) && !textAfterLedger(before));
  return breaks ? step : null;
}
