// @vitest-environment happy-dom
import { forceParsing } from '@codemirror/language';
import { describe, expect, it } from 'vitest';
import { createEditor, type Editor } from './index.ts';

const author = { handle: 'ada', name: 'Ada Lovelace' };

/** A document with two tracked changes, in two paragraphs, made by typing with Track Changes on. */
function tracked(): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, { doc: 'First paragraph.\n\nSecond paragraph.\n', author });
  editor.setTracking(true, { inFile: false });
  const type = (at: string, text: string) => {
    const from = editor.view.state.doc.toString().indexOf(at);
    editor.view.dispatch({
      changes: { from, insert: text },
      selection: { anchor: from + text.length },
      userEvent: 'input.type',
    });
  };
  type('Second', 'new ');
  type('First', 'old ');
  forceParsing(editor.view, editor.view.state.doc.length, 5000);
  return editor;
}

const pending = (editor: Editor) => editor.getUiState().changes.length;

describe('Accept All Changes and Stop Tracking', () => {
  it('accepts every change of the document with a caret, and turns Track Changes off', () => {
    const editor = tracked();
    editor.view.dispatch({ selection: { anchor: 0 } });
    expect(pending(editor)).toBe(2);
    expect(editor.getUiState().canAcceptAll).toBe(true);
    expect(editor.acceptAllAndStopTracking()).toBe(true);
    expect(pending(editor)).toBe(0);
    expect(editor.getUiState()).toMatchObject({ tracking: false, canAcceptAll: false });
    expect(editor.view.state.doc.toString()).toContain('old First paragraph.');
    expect(editor.view.state.doc.toString()).toContain('new Second paragraph.');
    // Nothing is left to accept: no step is made.
    const before = editor.getDoc();
    expect(editor.acceptAllAndStopTracking()).toBe(false);
    expect(editor.getDoc()).toBe(before);
    editor.destroy();
  });

  it('accepts only the changes the selection touches, then turns Track Changes off', () => {
    const editor = tracked();
    const text = editor.view.state.doc.toString();
    const from = text.indexOf('Second');
    editor.view.dispatch({ selection: { anchor: from - 2, head: from + 4 } });
    expect(editor.getUiState().canAcceptAll).toBe(true);
    expect(editor.acceptAllAndStopTracking()).toBe(true);
    // The change in the first paragraph is still pending.
    expect(pending(editor)).toBe(1);
    expect(editor.getUiState().tracking).toBe(false);
    editor.destroy();
  });

  it('is unavailable when the selection holds no change, though the document has some', () => {
    const editor = tracked();
    const text = editor.view.state.doc.toString();
    const from = text.indexOf('paragraph.\n\n');
    editor.view.dispatch({ selection: { anchor: from, head: from + 4 } });
    expect(pending(editor)).toBe(2);
    expect(editor.getUiState().canAcceptAll).toBe(false);
    expect(editor.acceptAllAndStopTracking()).toBe(false);
    expect(editor.getUiState().tracking).toBe(true);
    editor.destroy();
  });

  it('is one step: Undo brings the changes and Track Changes back, and Redo does both again', () => {
    const editor = tracked();
    const before = editor.getDoc();
    editor.view.dispatch({ selection: { anchor: 0 } });
    editor.acceptAllAndStopTracking();
    const after = editor.getDoc();
    expect(editor.getUiState()).toMatchObject({ undo: 'Accept', tracking: false });
    expect(editor.undo()).toBe(true);
    expect(editor.getDoc()).toBe(before);
    expect(editor.getUiState()).toMatchObject({ tracking: true, redo: 'Accept' });
    expect(editor.redo()).toBe(true);
    expect(editor.getDoc()).toBe(after);
    expect(editor.getUiState().tracking).toBe(false);
    editor.destroy();
  });

  it('records the switch in the file when the document owns Track Changes, Undo and Redo included', () => {
    const parent = document.createElement('div');
    document.body.append(parent);
    const editor = createEditor(parent, { doc: 'One.\n', author, saveTracking: true });
    editor.setTracking(true);
    editor.view.dispatch({ changes: { from: 0, insert: 'x' }, userEvent: 'input.type' });
    forceParsing(editor.view, editor.view.state.doc.length, 5000);
    editor.recordTracking();
    expect(editor.getDoc()).toContain('tracking: everyone');
    editor.acceptAllAndStopTracking();
    editor.recordTracking();
    expect(editor.getDoc(), 'the line goes').not.toContain('tracking: everyone');
    editor.undo();
    editor.recordTracking();
    expect(editor.getDoc()).toContain('tracking: everyone');
    editor.redo();
    editor.recordTracking();
    expect(editor.getDoc(), 'Redo stops tracking again').not.toContain('tracking: everyone');
    editor.destroy();
  });

  it('Redo stops tracking even when it was switched on by hand after the step', () => {
    const editor = tracked();
    editor.view.dispatch({ selection: { anchor: 0 } });
    editor.acceptAllAndStopTracking();
    editor.setTracking(true, { inFile: false });
    expect(editor.undo()).toBe(true);
    expect(editor.getUiState().tracking, 'Undo gives back what it was').toBe(true);
    expect(editor.redo()).toBe(true);
    expect(pending(editor)).toBe(0);
    expect(editor.getUiState().tracking, 'Redo turns it off').toBe(false);
    editor.destroy();
  });

  it('Undo gives back Track Changes as it was, off included', () => {
    const editor = tracked();
    editor.view.dispatch({ selection: { anchor: 0 } });
    editor.setTracking(false, { inFile: false });
    editor.acceptAllAndStopTracking();
    editor.setTracking(true, { inFile: false });
    editor.undo();
    expect(editor.getUiState().tracking).toBe(false);
    editor.redo();
    expect(editor.getUiState().tracking).toBe(false);
    editor.destroy();
  });

  it('says so when Undo and Redo switch Track Changes, and not for the step itself', () => {
    const notices: string[] = [];
    const parent = document.createElement('div');
    document.body.append(parent);
    const editor = createEditor(parent, {
      doc: 'One.\n',
      author,
      onNotice: (message) => notices.push(message),
    });
    editor.setTracking(true, { inFile: false });
    editor.view.dispatch({ changes: { from: 0, insert: 'x' }, userEvent: 'input.type' });
    forceParsing(editor.view, editor.view.state.doc.length, 5000);
    editor.acceptAllAndStopTracking();
    expect(notices).toEqual([]);
    editor.undo();
    editor.redo();
    expect(notices).toEqual(['Track Changes is on', 'Track Changes is off']);
    editor.destroy();
  });
});

const ledger = (marks: string) => `\n<!-- redlines
version: 1
people:
  ada: {name: Ada Lovelace}
marks:
${marks}-->\n`;
const entry = (id: string, extra = '') => `  ${id}: {by: ada, at: 2026-10-13T22:30Z${extra}}\n`;

/** An editor on a file written by hand, with a selection from `from` to `to` (text to find). */
function open(doc: string, from?: string, to?: string): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, { doc, author });
  forceParsing(editor.view, editor.view.state.doc.length, 5000);
  if (from !== undefined) {
    const text = editor.view.state.doc.toString();
    const a = text.indexOf(from);
    const b = to === undefined ? a + from.length : text.indexOf(to) + to.length;
    editor.view.dispatch({ selection: { anchor: a, head: b } });
  }
  return editor;
}

describe('what the selection touches', () => {
  const TABLE = [
    '| Fruit  | Count |',
    '| ------ | ----- |',
    '| Apples | 3     |',
    '| <!--ins k3x9 row--> Pears | 5 |',
  ].join('\n');

  it('with a selection over an inserted row, accepts the row and stops tracking', () => {
    const doc = `${TABLE}\n\nAfter.\n${ledger(entry('k3x9'))}`;
    const editor = open(doc, 'Pears');
    expect(editor.getUiState().canAcceptAll).toBe(true);
    expect(editor.acceptAllAndStopTracking()).toBe(true);
    expect(editor.getDoc()).not.toContain('ins k3x9');
    expect(editor.getDoc()).toContain('Pears');
    editor.destroy();
  });

  it('does not take an inserted row that the selection does not touch', () => {
    const doc = `${TABLE}\n\nAfter.\n${ledger(entry('k3x9'))}`;
    const editor = open(doc, 'Apples');
    expect(editor.getUiState().canAcceptAll).toBe(false);
    expect(editor.acceptAllAndStopTracking()).toBe(false);
    editor.destroy();
  });

  it('with a selection over a table with a deleted row, accepts the deletion', () => {
    const doc = [
      '| Fruit  | Count |',
      '| ------ | ----- |',
      '| Apples | 3     |',
      '',
      '<!--del g5nb row=2 \\| Pears \\| 5 \\|-->',
      '',
      'After.',
      ledger(entry('g5nb')),
    ].join('\n');
    const editor = open(doc, 'Apples');
    expect(editor.getUiState().canAcceptAll).toBe(true);
    expect(editor.acceptAllAndStopTracking()).toBe(true);
    expect(editor.getDoc()).not.toContain('g5nb');
    expect(editor.getDoc()).not.toContain('Pears');
    editor.destroy();
  });

  it('with a selection over an inserted column, accepts the column', () => {
    const doc = [
      '| Fruit  | Count | <!--ins w8nn col--> |',
      '| ------ | ----- | --- |',
      '| Apples | 3     |     |',
      '',
      'After.',
      ledger(entry('w8nn')),
    ].join('\n');
    const editor = open(doc, 'Apples');
    expect(editor.getUiState().canAcceptAll).toBe(true);
    expect(editor.acceptAllAndStopTracking()).toBe(true);
    expect(editor.getDoc()).not.toContain('w8nn');
    editor.destroy();
  });

  it('is disabled, and does nothing, when the only changes are table marks in no table', () => {
    const doc = `Some text.\n\n<!--ins c9qf row--> stray\n${ledger(entry('c9qf'))}`;
    const editor = open(doc);
    expect(editor.getUiState().canAcceptAll).toBe(false);
    const before = editor.getDoc();
    expect(editor.acceptAllAndStopTracking()).toBe(false);
    expect(editor.getDoc()).toBe(before);
    expect(editor.getUiState().canUndo).toBe(false);
    editor.destroy();
  });

  it('accepts the whole suggestion when the selection holds half of it', () => {
    const doc = `<!--ins p7qd-->One <!--/p7qd-->two.\n\nThree <!--ins w2rf-->four <!--/w2rf-->five.\n${ledger(
      entry('p7qd', ', group: g2rs') + entry('w2rf', ', group: g2rs'),
    )}`;
    const editor = open(doc, 'One');
    expect(editor.acceptAllAndStopTracking()).toBe(true);
    expect(editor.getUiState().changes, 'both halves are decided').toHaveLength(0);
    editor.destroy();
  });
});
