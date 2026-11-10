// What a step is called, for the Edit menu ("Undo Typing", "Undo Claude’s Changes"): the label an
// event keeps from its first transaction (history.ts, `HistoryConfig.label`), and the words for it.
// An agent's step is named for the agent and for what it changed; yours, for the user event the
// Mac's own apps would name it by.

import { type EditorState, Transaction } from '@codemirror/state';
import { bodyEnd, parsedField } from '../tracked/field.ts';
import { agentOf, redoLabel, undoLabel } from './history.ts';

/**
 * What a step is: an agent's, and whether it changed nothing but threads; or yours, by its user
 * event (null for none).
 */
export type StepLabel = { agent: string; onlyThreads: boolean } | { userEvent: string | null };

/**
 * Whether an agent's transaction changed nothing but threads: every change lies in the ledger
 * region, and the ledger's marks read the same before and after (people and threads may change).
 */
function onlyThreads(tr: Transaction): boolean {
  const before = tr.startState.field(parsedField, false);
  const after = tr.state.field(parsedField, false);
  if (!before || !after) return false;
  const start = bodyEnd(before) ?? before.ledgerRange?.from;
  if (start === undefined) return false;
  let inLedger = true;
  tr.changes.iterChangedRanges((fromA) => {
    if (fromA < start) inLedger = false;
  });
  return inLedger && JSON.stringify(before.ledger.marks) === JSON.stringify(after.ledger.marks);
}

/** What a transaction's step is: an agent's, and whether it changed nothing but threads; or yours. */
export function labelOf(tr: Transaction): StepLabel {
  const step = agentOf(tr);
  if (step) return { agent: step.agent, onlyThreads: onlyThreads(tr) };
  return { userEvent: tr.annotation(Transaction.userEvent) ?? null };
}

/** Whether `event` is `name` or one of its kinds (`input.type.compose` is `input.type`). */
const is = (event: string, name: string) => event === name || event.startsWith(`${name}.`);

const REVIEW: Readonly<Record<string, string>> = {
  'review.comment': 'Comment',
  'review.reply': 'Reply',
  'review.resolve': 'Resolve',
  'review.reopen': 'Reopen',
};

function userName(event: string | null): string | null {
  if (event === null) return null;
  if (event === 'delete.cut') return 'Cut';
  if (is(event, 'delete')) return 'Typing';
  if (event === 'input' || is(event, 'input.type') || is(event, 'input.complete')) return 'Typing';
  if (is(event, 'input.paste')) return 'Paste';
  if (is(event, 'input.drop') || is(event, 'move.drop')) return 'Drag';
  if (is(event, 'format') || is(event, 'input.format')) return 'Formatting';
  if (is(event, 'input.replace.all')) return 'Replace All';
  if (is(event, 'input.replace')) return 'Replace';
  if (event === 'accept') return 'Accept';
  if (event === 'reject') return 'Reject';
  return REVIEW[event] ?? null;
}

function nameOf(label: StepLabel | null): string | null {
  if (!label) return null;
  if ('agent' in label) return `${label.agent}’s ${label.onlyThreads ? 'Reply' : 'Changes'}`;
  return userName(label.userEvent);
}

/** What Undo would take back, or null for nothing, or a step with no name. */
export function undoName(state: EditorState): string | null {
  return nameOf(undoLabel(state));
}

/** What Redo would bring back, likewise. */
export function redoName(state: EditorState): string | null {
  return nameOf(redoLabel(state));
}
