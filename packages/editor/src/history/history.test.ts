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
import { history, redo, redoDepth, undo, undoDepth } from './index.ts';

/** A state with the module's history and `extensions`, and a way to step it on. */
function start(doc: string, extensions: Extension = []) {
  let state = EditorState.create({ doc, extensions: [history(), extensions] });
  const dispatch = (tr: Transaction) => (state = tr.state);
  return {
    get state() {
      return state;
    },
    apply(spec: TransactionSpec) {
      state = state.update(spec).state;
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
