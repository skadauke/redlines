// Undo and Redo. A tracked edit, a decision and a reply are each a step to undo. A new version of
// the file from outside, such as one an agent wrote, is not: the steps before it were made to the
// old version, and replayed over the agent's text they could take its work apart, a reply's lines
// left after the ledger or a suggestion's ledger entry gone. So a reload that changes the text
// starts the history over, with nothing to undo or redo, and Undo says why it does nothing.
//
// As a safeguard, once the text has changed outside the history in any other way, an undo or redo
// that would break the file, adding a warning to its parse or putting text after its ledger, is
// refused with the same message.

import {
  history,
  historyField,
  historyKeymap,
  redo,
  redoDepth,
  undo,
  undoDepth,
} from '@codemirror/commands';
import {
  Compartment,
  EditorState,
  type Extension,
  Prec,
  StateEffect,
  type StateCommand,
  StateField,
  Transaction,
} from '@codemirror/state';
import { type Command, EditorView, type KeyBinding } from '@codemirror/view';
import type { Parsed, Warning } from '@redlines/format';
import { bodyEnd, parsedField } from './tracked/field.ts';
import { refusedEditEffect } from './tracked/typing.ts';

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
    return outside || (tr.docChanged && tr.annotation(Transaction.addToHistory) === false);
  },
});

/** The effects that start the history over, for a reload of `state` that changes its text. */
export function startOver(state: EditorState): StateEffect<unknown>[] {
  const dropped = undoDepth(state) > 0 || redoDepth(state) > 0;
  return [restart.reconfigure(historyField.init(() => EMPTY)), startedOver.of(dropped)];
}

/** Undo or Redo, which says why it does nothing after a reload took its steps away. */
function sayingWhy(command: StateCommand, message: string): Command {
  return (view) => {
    if (command(view)) return true;
    // Raw while Track Changes is on says why itself.
    if (view.state.readOnly || !view.state.field(droppedField, false)) return false;
    view.dispatch({ effects: refusedEditEffect.of(message) });
    return true;
  };
}

const undoSayingWhy = sayingWhy(undo, UNDO_AFTER_RELOAD);
const redoSayingWhy = sayingWhy(redo, REDO_AFTER_RELOAD);

/** CodeMirror's keys for Undo and Redo, which say why they do nothing after a reload. */
export const undoKeymap: readonly KeyBinding[] = historyKeymap.map((binding) => {
  if (binding.run === undo) return { ...binding, run: undoSayingWhy };
  if (binding.run === redo) return { ...binding, run: redoSayingWhy };
  return binding;
});

/** The history, and Undo and Redo from the Edit menu, which reach the page as input events. */
export function undoHistory(): Extension {
  return [
    history(),
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
