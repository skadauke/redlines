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

  it('records the switch in the file when the document owns Track Changes, Undo included', () => {
    const parent = document.createElement('div');
    document.body.append(parent);
    const editor = createEditor(parent, { doc: 'One.\n', author, saveTracking: true });
    editor.setTracking(true);
    editor.view.dispatch({ changes: { from: 0, insert: 'x' }, userEvent: 'input.type' });
    forceParsing(editor.view, editor.view.state.doc.length, 5000);
    editor.acceptAllAndStopTracking();
    editor.recordTracking();
    expect(editor.getDoc()).not.toContain('tracking: everyone');
    editor.undo();
    editor.recordTracking();
    expect(editor.getDoc()).toContain('tracking: everyone');
    editor.destroy();
  });
});
