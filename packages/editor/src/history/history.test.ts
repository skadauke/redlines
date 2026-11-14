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
  doneDepth,
  dropStepsEffect,
  followsText,
  history,
  joinsNewestStep,
  joinsStep,
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

  it('keeps an agent’s edit annotated isolateHistory a step of its own, as CodeMirror does', () => {
    const isolated = (isolate: 'before' | 'after' | 'full', on: 'first' | 'second') => {
      const editor = start('one');
      const end = () => editor.state.doc.length;
      const annotations = (which: 'first' | 'second', time: number) => [
        at(time),
        claude('run-1'),
        ...(which === on ? [isolateHistory.of(isolate)] : []),
      ];
      editor.apply({
        changes: { from: end(), insert: ' two' },
        annotations: annotations('first', 1000),
      });
      // A selection between them doesn't undo the isolation.
      editor.apply({
        selection: { anchor: 0 },
        userEvent: 'select.pointer',
        annotations: at(1005),
      });
      editor.apply({
        changes: { from: end(), insert: ' three' },
        annotations: annotations('second', 1010),
      });
      return undoDepth(editor.state);
    };
    expect(isolated('after', 'first')).toBe(2);
    expect(isolated('full', 'first')).toBe(2);
    expect(isolated('before', 'second')).toBe(2);
    expect(isolated('full', 'second')).toBe(2);
    // Isolated only from what comes after, the second edit still joins.
    expect(isolated('before', 'first')).toBe(1);
    expect(isolated('after', 'second')).toBe(1);
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

describe('a change that joins the newest step', () => {
  /** Inserts `text` at the start, joined to the newest step. */
  const joinAt = (
    editor: ReturnType<typeof start>,
    text: string,
    time: number,
    more: TransactionSpec = {},
  ) =>
    editor.apply({
      changes: { from: 0, insert: text },
      annotations: [at(time), joinsNewestStep.of(true)],
      ...more,
    });

  it('is taken back and brought back with that step, whatever the time and the selections between', () => {
    const editor = start('one');
    typeAt(editor, ' two', 1000);
    editor.apply({ selection: { anchor: 0 }, userEvent: 'select.pointer', annotations: at(4000) });
    joinAt(editor, '> ', 20_000);
    expect(editor.state.doc.toString()).toBe('> one two');
    expect(undoDepth(editor.state)).toBe(1);
    expect(editor.undo()).toBe(true);
    expect(editor.state.doc.toString()).toBe('one');
    expect(editor.redo()).toBe(true);
    expect(editor.state.doc.toString()).toBe('> one two');
  });

  it('joins a step of an agent’s as well, which stays the agent’s', () => {
    const editor = start('one');
    agentAt(editor, ' two', 'run-1', 1000);
    joinAt(editor, '> ', 9000);
    expect(undoDepth(editor.state)).toBe(1);
    editor.undo();
    expect(editor.state.doc.toString()).toBe('one');
    expect(agentOf(editor.last)?.agent).toBe('Claude');
  });

  it('joins a step another change followed outside the history, which the steps below still fit', () => {
    const editor = start('hello world');
    editor.apply({ changes: { from: 11, insert: '!' }, userEvent: 'input.type' });
    editor.apply({ changes: { from: 0, insert: '>> ' }, annotations: Tr.addToHistory.of(false) });
    joinAt(editor, '# ', 9000);
    expect(undoDepth(editor.state)).toBe(1);
    editor.undo();
    expect(editor.state.doc.toString()).toBe('>> hello world');
  });

  it('leaves what comes after a step of its own, when it says so', () => {
    const apart = start('one');
    typeAt(apart, ' two', 1000);
    joinAt(apart, '> ', 1005, {
      annotations: [at(1005), joinsNewestStep.of(true), isolateHistory.of('after')],
    });
    typeAt(apart, ' three', 1010);
    expect(undoDepth(apart.state)).toBe(2);
    apart.undo();
    expect(apart.state.doc.toString()).toBe('> one two');
  });

  it('is a step of its own when there is none to join, and the usual step without the annotation', () => {
    const alone = start('one');
    joinAt(alone, '> ', 1000);
    expect(undoDepth(alone.state)).toBe(1);
    const plain = start('one');
    typeAt(plain, ' two', 1000);
    plain.apply({ changes: { from: 0, insert: '> ' }, annotations: at(9000) });
    expect(undoDepth(plain.state)).toBe(2);
  });
});

describe('a take-back outside the history of a change joined to a step', () => {
  /**
   * A step that changes the tail of `body\n\nold`, then a change joined to it (a Return that opens
   * an empty paragraph), taken back outside the history as leaving the paragraph does, carrying
   * `dropStepsEffect`. Returns the editor, with `change` taken out and the step left.
   */
  function takenBack(
    extensions: Extension,
    step: TransactionSpec,
    change: TransactionSpec,
  ): ReturnType<typeof start> {
    const editor = start('body\n\nold', extensions);
    editor.apply({
      ...step,
      userEvent: 'delete.selection',
      annotations: [at(1000), isolateHistory.of('before')],
    });
    const depth = doneDepth(editor.state);
    editor.apply({
      ...change,
      userEvent: 'delete.selection',
      annotations: [at(1010), joinsStep.of(true), isolateHistory.of('after')],
    });
    // Joined: the history holds one step for both.
    expect(doneDepth(editor.state)).toBe(depth);
    const made = editor.last;
    editor.apply({
      changes: made.changes.invert(made.startState.doc),
      annotations: Tr.addToHistory.of(false),
      effects: dropStepsEffect.of({ depth, joined: made.changes }),
    });
    return editor;
  }

  it('leaves the step exactly, where the change replaced the text that the step replaced', () => {
    // As the tracked layer writes a ledger again that the step wrote: the change's inverse puts
    // back the text that it replaced, and the step mapped over it inserted its text beside that
    // one, not over it.
    const editor = takenBack(
      [],
      { changes: { from: 6, to: 9, insert: 'NEW' } },
      {
        changes: [
          { from: 4, insert: '\n\n' },
          { from: 6, to: 9, insert: 'AGAIN' },
        ],
      },
    );
    expect(editor.state.doc.toString()).toBe('body\n\nNEW');
    expect(undoDepth(editor.state)).toBe(1);
    editor.undo();
    expect(editor.state.doc.toString()).toBe('body\n\nold');
    editor.redo();
    expect(editor.state.doc.toString()).toBe('body\n\nNEW');
  });

  it('keeps the effects of the step as they were, which are in the text it leaves', () => {
    // An inverted effect has its positions in the text the step gives back, as the record of a
    // file's line breaks has. Mapped through the change's inverse, which starts from the text the
    // change made, a position past the end of that text was out of range (here 9 in a text of 6).
    const place = StateEffect.define<number>({ map: (pos, mapping) => mapping.mapPos(pos) });
    const where = StateField.define<number>({
      create: () => -1,
      // Of several, the last stands, the record before the first, as a line break's does.
      update: (value, tr) => tr.effects.findLast((effect) => effect.is(place))?.value ?? value,
    });
    const inverse = invertedEffects.of((tr) =>
      tr.docChanged ? [place.of(tr.startState.doc.length)] : [],
    );
    const editor = takenBack(
      [where, inverse],
      { changes: { from: 4, to: 9 } },
      { changes: { from: 4, insert: '\n\n' } },
    );
    expect(editor.state.doc.toString()).toBe('body');
    editor.undo();
    expect(editor.state.doc.toString()).toBe('body\n\nold');
    expect(editor.state.field(where)).toBe(9);
  });
});
