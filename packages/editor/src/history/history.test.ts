import { invertedEffects, isolateHistory } from '@codemirror/commands';
import {
  EditorState,
  type Extension,
  StateEffect,
  StateField,
  type Transaction,
  type TransactionSpec,
  Transaction as Tr,
} from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import {
  agentOf,
  agentStep,
  followsText,
  history,
  redo,
  redoDepth,
  undo,
  undoDepth,
} from './index.ts';

/** A state with the module's history and `extensions`, and a way to step it on. */
function start(doc: string, extensions: Extension = []) {
  let state = EditorState.create({ doc, extensions: [history(), extensions] });
  let last: Transaction | null = null;
  const dispatch = (tr: Transaction) => {
    last = tr;
    state = tr.state;
  };
  return {
    get state() {
      return state;
    },
    /** The transaction applied last. */
    get last(): Transaction {
      if (!last) throw new Error('Nothing was applied');
      return last;
    },
    apply(spec: TransactionSpec) {
      dispatch(state.update(spec));
    },
    undo: () => undo({ state, dispatch }),
    redo: () => redo({ state, dispatch }),
  };
}

const at = (time: number) => Tr.time.of(time);

describe('the history', () => {
  it('joins typing within half a second into one step, and not after a selection change', () => {
    const editor = start('');
    editor.apply({
      changes: { from: 0, insert: 'a' },
      userEvent: 'input.type',
      annotations: at(1000),
    });
    editor.apply({
      changes: { from: 1, insert: 'b' },
      userEvent: 'input.type',
      annotations: at(1200),
    });
    expect(undoDepth(editor.state)).toBe(1);
    // Half a second later: a step of its own.
    editor.apply({
      changes: { from: 2, insert: 'c' },
      userEvent: 'input.type',
      annotations: at(1800),
    });
    expect(undoDepth(editor.state)).toBe(2);
    // A selection change in between: a step of its own too.
    editor.apply({ selection: { anchor: 0 }, userEvent: 'select', annotations: at(1850) });
    editor.apply({
      changes: { from: 0, insert: 'd' },
      userEvent: 'input.type',
      annotations: at(1900),
    });
    expect(undoDepth(editor.state)).toBe(3);
    expect(editor.undo()).toBe(true);
    expect(editor.state.doc.toString()).toBe('abc');
    expect(editor.undo()).toBe(true);
    expect(editor.state.doc.toString()).toBe('ab');
    expect(editor.undo()).toBe(true);
    expect(editor.state.doc.toString()).toBe('');
    expect(editor.undo()).toBe(false);
    expect(redoDepth(editor.state)).toBe(3);
  });

  it('keeps a transaction annotated isolateHistory a step of its own', () => {
    const editor = start('');
    editor.apply({
      changes: { from: 0, insert: 'a' },
      userEvent: 'input.type',
      annotations: at(1000),
    });
    editor.apply({
      changes: { from: 1, insert: 'b' },
      userEvent: 'input.type',
      annotations: [at(1010), isolateHistory.of('full')],
    });
    editor.apply({
      changes: { from: 2, insert: 'c' },
      userEvent: 'input.type',
      annotations: at(1020),
    });
    expect(undoDepth(editor.state)).toBe(3);
    editor.undo();
    expect(editor.state.doc.toString()).toBe('ab');
    editor.undo();
    expect(editor.state.doc.toString()).toBe('a');
  });

  it('gives back what invertedEffects records, and its inverse on redo', () => {
    const set = StateEffect.define<number>();
    const counter = StateField.define<number>({
      create: () => 0,
      update(value, tr) {
        for (const effect of tr.effects) if (effect.is(set)) return effect.value;
        return value;
      },
    });
    const inverse = invertedEffects.of((tr) =>
      tr.effects.some((effect) => effect.is(set)) ? [set.of(tr.startState.field(counter))] : [],
    );
    const editor = start('x', [counter, inverse]);
    editor.apply({ effects: set.of(5) });
    editor.apply({ effects: set.of(7), annotations: isolateHistory.of('full') });
    expect(undoDepth(editor.state)).toBe(2);
    editor.undo();
    expect(editor.state.field(counter)).toBe(5);
    editor.undo();
    expect(editor.state.field(counter)).toBe(0);
    editor.redo();
    expect(editor.state.field(counter)).toBe(5);
    editor.redo();
    expect(editor.state.field(counter)).toBe(7);
  });

  it('maps its steps through a change outside the history', () => {
    const editor = start('hello world');
    editor.apply({ changes: { from: 11, insert: '!' }, userEvent: 'input.type' });
    editor.apply({
      changes: { from: 0, insert: '>> ' },
      annotations: Tr.addToHistory.of(false),
    });
    expect(editor.state.doc.toString()).toBe('>> hello world!');
    editor.undo();
    expect(editor.state.doc.toString()).toBe('>> hello world');
    editor.redo();
    expect(editor.state.doc.toString()).toBe('>> hello world!');
  });
});

const claude = (group: string) => agentStep.of({ group, agent: 'Claude' });

/** Inserts `text` at the end, as typing at `time`. */
function typeAt(editor: ReturnType<typeof start>, text: string, time: number): void {
  const end = editor.state.doc.length;
  editor.apply({
    changes: { from: end, insert: text },
    userEvent: 'input.type',
    annotations: at(time),
  });
}

/** Inserts `text` at the end, as an agent's edit of `group` at `time`. */
function agentAt(
  editor: ReturnType<typeof start>,
  text: string,
  group: string,
  time: number,
  userEvent?: string,
): void {
  const end = editor.state.doc.length;
  editor.apply({
    changes: { from: end, insert: text },
    annotations: [at(time), claude(group)],
    ...(userEvent ? { userEvent } : {}),
  });
}

describe('steps with an owner', () => {
  it('joins an agent’s edits of one group into one step, whatever the time and the selections between them', () => {
    const editor = start('one');
    agentAt(editor, ' two', 'run-1', 1000);
    editor.apply({ selection: { anchor: 0 }, userEvent: 'select.pointer', annotations: at(4000) });
    agentAt(editor, ' three', 'run-1', 11_000);
    expect(undoDepth(editor.state)).toBe(1);
    expect(editor.undo()).toBe(true);
    expect(editor.state.doc.toString()).toBe('one');
  });

  it('keeps two groups apart, the newest first', () => {
    const editor = start('one');
    agentAt(editor, ' two', 'run-1', 1000);
    agentAt(editor, ' three', 'run-2', 1010);
    expect(undoDepth(editor.state)).toBe(2);
    editor.undo();
    expect(editor.state.doc.toString()).toBe('one two');
  });

  it('never joins your typing to an agent’s step, nor an agent’s edit to yours', () => {
    const editor = start('');
    typeAt(editor, 'a', 1000);
    agentAt(editor, ' agent', 'run-1', 1010);
    typeAt(editor, 'b', 1020);
    expect(undoDepth(editor.state)).toBe(3);
    editor.undo();
    expect(editor.state.doc.toString()).toBe('a agent');
    editor.undo();
    expect(editor.state.doc.toString()).toBe('a');
  });

  it('splits a run around your edit, and joins a stretch to the one before when nothing of yours is left between', () => {
    const editor = start('one');
    agentAt(editor, ' two', 'run-1', 1000);
    typeAt(editor, ' mine', 1010);
    agentAt(editor, ' three', 'run-1', 1020);
    expect(undoDepth(editor.state)).toBe(3);
    editor.undo();
    editor.undo();
    expect(editor.state.doc.toString()).toBe('one two');
    expect(undoDepth(editor.state)).toBe(1);
    agentAt(editor, ' four', 'run-1', 5000);
    expect(undoDepth(editor.state)).toBe(1);
    editor.undo();
    expect(editor.state.doc.toString()).toBe('one');
  });

  it('never joins an input method’s composition across owners', () => {
    const composing = start('');
    agentAt(composing, 'agent', 'run-1', 1000);
    composing.apply({
      changes: { from: composing.state.doc.length, insert: 'か' },
      userEvent: 'input.type.compose',
      annotations: at(1010),
    });
    expect(undoDepth(composing.state)).toBe(2);
    composing.undo();
    expect(composing.state.doc.toString()).toBe('agent');

    const composed = start('');
    composed.apply({
      changes: { from: 0, insert: 'か' },
      userEvent: 'input.type.compose',
      annotations: at(1000),
    });
    agentAt(composed, ' agent', 'run-1', 1005, 'input.type.compose');
    expect(undoDepth(composed.state)).toBe(2);
    composed.undo();
    expect(composed.state.doc.toString()).toBe('か');
  });

  it('clears Redo with an agent’s step', () => {
    const editor = start('');
    typeAt(editor, 'a', 1000);
    editor.undo();
    expect(redoDepth(editor.state)).toBe(1);
    agentAt(editor, 'agent', 'run-1', 2000);
    expect(redoDepth(editor.state)).toBe(0);
  });

  it('says whose step an undo or a redo takes back or brings back', () => {
    const editor = start('');
    typeAt(editor, 'a', 1000);
    agentAt(editor, ' agent', 'run-1', 2000);
    expect(agentOf(editor.last)).toEqual({ group: 'run-1', agent: 'Claude' });
    editor.undo();
    expect(agentOf(editor.last)).toEqual({ group: 'run-1', agent: 'Claude' });
    editor.undo();
    expect(agentOf(editor.last)).toBeNull();
    editor.redo();
    expect(agentOf(editor.last)).toBeNull();
    editor.redo();
    expect(agentOf(editor.last)).toEqual({ group: 'run-1', agent: 'Claude' });
    expect(editor.state.doc.toString()).toBe('a agent');
    // Undone and redone, the step is still the agent's.
    editor.undo();
    expect(agentOf(editor.last)).toEqual({ group: 'run-1', agent: 'Claude' });
  });

  it('follows text through a reload, an agent’s step and its undo and redo, and maps it through anything else', () => {
    const editor = start('one');
    editor.apply({
      changes: { from: 0, insert: 'zero ' },
      userEvent: 'reload',
      annotations: Tr.addToHistory.of(false),
    });
    expect(followsText(editor.last)).toBe(true);
    agentAt(editor, ' two', 'run-1', 1000);
    expect(followsText(editor.last)).toBe(true);
    editor.undo();
    expect(followsText(editor.last)).toBe(true);
    editor.redo();
    expect(followsText(editor.last)).toBe(true);
    typeAt(editor, '!', 2000);
    expect(followsText(editor.last)).toBe(false);
    editor.undo();
    expect(followsText(editor.last)).toBe(false);
  });
});
