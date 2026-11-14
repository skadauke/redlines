// @vitest-environment happy-dom
// The two settings of the ledger that the editor applies and writes (format §5.6): Track Changes,
// which turning it on or off writes when the host asks for it, and the view a document opens in,
// which the host has the editor record when it saves the file.

import { afterEach, describe, expect, it } from 'vitest';
import { applyChanges, parse, setTracking as trackingInFile, setView } from '@redlines/format';
import { createEditor, type Editor, type EditorOptions, redoDepth, undoDepth } from '../index.ts';
import { editSourceFacet } from './typing.ts';

const ada = { handle: 'ada', name: 'Ada Lovelace' };
const NOTE =
  "# If git shows a merge conflict in this block, keep both sides. The order of entries doesn't matter.";
const open: Editor[] = [];

afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

function load(doc: string, options: Partial<EditorOptions> = {}): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, {
    doc,
    author: ada,
    ...options,
    extensions: [
      editSourceFacet.of({ now: () => new Date('2026-11-01T10:00:30Z') }),
      ...(options.extensions ?? []),
    ],
  });
  open.push(editor);
  return editor;
}

/** A body with a ledger that holds a tracked insertion and a comment, plus the given settings. */
function reviewed(...settings: string[]): string {
  return [
    'A <!--ins k3x9-->new <!--/k3x9-->word, <!--cmt c8d2-->noted<!--/c8d2-->.',
    '',
    '<!-- redlines',
    NOTE,
    'version: 1',
    ...settings,
    'people:',
    '  ada: {name: Ada Lovelace}',
    'marks:',
    '  k3x9: {by: ada, at: 2026-10-13T22:30Z}',
    'comments:',
    '  c8d2:',
    '    by: ada',
    '    at: 2026-10-13T22:36Z',
    '    text: |-',
    '      Why?',
    '-->',
    '',
  ].join('\n');
}

const PLAIN = '# Notes\n\nA paragraph.\n';

/** Types text at the caret, as the keyboard does. */
function type(editor: Editor, text: string): void {
  editor.view.dispatch(editor.view.state.replaceSelection(text), { userEvent: 'input.type' });
}

/** Puts the caret in front of `word` in the document. */
function caretBefore(editor: Editor, word: string): void {
  const at = editor.view.state.doc.toString().indexOf(word);
  editor.view.dispatch({ selection: { anchor: at }, userEvent: 'select' });
}

describe('the view a document opens in (format §5.6)', () => {
  it('is the ledger’s, Clean, Redlines or the simple look, whatever the document holds', () => {
    const clean = load(reviewed('view: clean'));
    expect(clean.getUiState().view).toBe('clean');
    expect(clean.getUiState().hasRedlines).toBe(true);
    expect(load(reviewed('view: redlines')).getUiState().view).toBe('redlines');
    expect(load(reviewed('view: simple')).getUiState().view).toBe('simple');
    // With nothing to show, as well: a file that only says how it was left.
    const plain = `${PLAIN}\n<!-- redlines\n${NOTE}\nversion: 1\ntracking: everyone\nview: redlines\n-->\n`;
    expect(load(plain).getUiState().view).toBe('redlines');
  });

  it('wins over the markup view the app remembered, which opens the files that have none', () => {
    const editor = load(reviewed('view: redlines'), { markupView: 'simple' });
    expect(editor.getUiState().view).toBe('redlines');
    // The choice of the app is still the app's: it reaches the next file, and nothing is saved.
    expect(editor.getUiState().markupView).toBe('simple');
    // And the other way: a file that was left in the simple look opens there, whatever look the
    // app remembered.
    const left = load(reviewed('view: simple'), { markupView: 'redlines' });
    expect(left.getUiState().view).toBe('simple');
    expect(left.getUiState().markupView).toBe('redlines');
    expect(load(reviewed(), { markupView: 'simple' }).getUiState().view).toBe('simple');
    expect(load(reviewed()).getUiState().view).toBe('redlines');
    expect(load(PLAIN).getUiState().view).toBe('clean');
  });

  it('is the one of the next document when another is opened', () => {
    const editor = load(PLAIN);
    editor.setDoc(reviewed('view: redlines'));
    expect(editor.getUiState().view).toBe('redlines');
    editor.setDoc(reviewed('view: clean'));
    expect(editor.getUiState().view).toBe('clean');
    editor.setDoc(PLAIN);
    expect(editor.getUiState().view).toBe('clean');
  });

  it('is not Raw, which a ledger can’t ask for', () => {
    const editor = load(reviewed('view: raw'));
    expect(editor.getUiState().view).toBe('redlines');
  });

  it('is kept when the document is reloaded, and a view chosen since stays', () => {
    const editor = load(reviewed('view: clean'));
    editor.setViewMode('redlines');
    editor.reloadDoc(reviewed('view: clean', 'history: full'));
    expect(editor.getUiState().view).toBe('redlines');
  });
});

describe('Track Changes, written to the document (format §5.6)', () => {
  it('is written when it is turned on, and taken out when it is turned off', () => {
    const editor = load(PLAIN, { saveTracking: true });
    expect(editor.setTracking(true)).toBe(true);
    expect(editor.getUiState().tracking).toBe(true);
    expect(editor.getParsed().ledger.tracking).toBe('everyone');
    expect(editor.getDoc()).toContain('\ntracking: everyone\n');
    expect(editor.getDoc().startsWith(PLAIN.trimEnd())).toBe(true);
    expect(editor.setTracking(false)).toBe(true);
    expect(editor.getUiState().tracking).toBe(false);
    // Nothing is left of it: the file is as it was.
    expect(editor.getDoc()).toBe(PLAIN);
  });

  it('is the one line in a file that has a ledger', () => {
    const editor = load(reviewed(), { saveTracking: true });
    editor.setTracking(true);
    expect(editor.getDoc()).toBe(reviewed('tracking: everyone'));
    editor.setTracking(false);
    expect(editor.getDoc()).toBe(reviewed());
  });

  it('tells the host the file changed, so that the document is edited, once for each switch', () => {
    const told: string[] = [];
    const editor = load(PLAIN, { saveTracking: true, onChange: (text) => told.push(text) });
    editor.setTracking(true);
    expect(told).toEqual([editor.getDoc()]);
    editor.setTracking(true);
    expect(told).toHaveLength(1);
    editor.setTracking(false);
    expect(told).toEqual([expect.stringContaining('tracking: everyone'), PLAIN]);
  });

  it('is a step of its own, which Undo and Redo take back and bring back with the setting', () => {
    const editor = load(PLAIN, { saveTracking: true });
    editor.setTracking(true);
    expect(undoDepth(editor.view.state)).toBe(1);
    expect(editor.getUiState().undo).toBe('Track Changes');
    expect(editor.undo()).toBe(true);
    // The file and Track Changes are as they were, together.
    expect(editor.getUiState().tracking).toBe(false);
    expect(editor.getDoc()).toBe(PLAIN);
    expect(editor.getUiState().redo).toBe('Track Changes');
    expect(editor.redo()).toBe(true);
    expect(editor.getUiState().tracking).toBe(true);
    expect(editor.getParsed().ledger.tracking).toBe('everyone');
    editor.setTracking(false);
    expect(undoDepth(editor.view.state)).toBe(2);
    editor.undo();
    expect(editor.getUiState().tracking).toBe(true);
    expect(editor.getParsed().ledger.tracking).toBe('everyone');
  });

  it('is apart from the typing around it', () => {
    const editor = load(PLAIN, { saveTracking: true });
    caretBefore(editor, 'paragraph');
    editor.setTracking(true);
    type(editor, 'a');
    editor.setTracking(false);
    type(editor, 'b');
    expect(undoDepth(editor.view.state)).toBe(4);
  });

  it('adds no step when the file refuses it', () => {
    const editor = load('Text\n\n```js\nlet x;\n', { saveTracking: true, onNotice: () => {} });
    editor.setTracking(true);
    expect(undoDepth(editor.view.state)).toBe(0);
  });

  it('is never made into a tracked change of its own', () => {
    const editor = load(reviewed('tracking: everyone'), { saveTracking: true, tracking: true });
    editor.setTracking(false);
    expect(editor.getDoc()).toBe(reviewed());
    expect(editor.getParsed().marks.map((mark) => mark.id)).toEqual(['k3x9', 'c8d2']);
  });

  it('can be turned off in Raw, where typing is read-only while it is on', () => {
    const editor = load(reviewed('tracking: everyone'), { saveTracking: true });
    editor.setViewMode('raw');
    expect(editor.setTracking(false)).toBe(true);
    expect(editor.getUiState().tracking).toBe(false);
    expect(editor.getDoc()).toBe(reviewed());
    expect(editor.setTracking(true)).toBe(true);
    expect(editor.getDoc()).toBe(reviewed('tracking: everyone'));
  });

  it('stays in the ledger as tracked changes are made, and a switch after them keeps them', () => {
    const editor = load(PLAIN, { saveTracking: true });
    editor.setTracking(true);
    caretBefore(editor, 'paragraph');
    type(editor, 'new ');
    expect(editor.getParsed().ledger.tracking).toBe('everyone');
    expect(editor.getParsed().marks.map((mark) => mark.kind)).toEqual(['ins']);
    editor.setTracking(false);
    expect(editor.getParsed().ledger.tracking).toBeUndefined();
    expect(editor.getParsed().marks.map((mark) => mark.kind)).toEqual(['ins']);
  });

  it('takes back and brings back in the order they were made, the file and Track Changes together', () => {
    const editor = load(PLAIN, { saveTracking: true });
    const states: { text: string; tracking: boolean }[] = [];
    const note = () =>
      states.push({ text: editor.getDoc(), tracking: editor.getUiState().tracking });
    note();
    editor.setTracking(true);
    note();
    caretBefore(editor, 'paragraph');
    type(editor, 'new ');
    note();
    editor.setTracking(false);
    note();
    // Back through each state, without a refusal: no step is put out of step by another.
    for (const state of states.slice(0, -1).reverse()) {
      expect(editor.undo()).toBe(true);
      expect(editor.getDoc()).toBe(state.text);
      expect(editor.getUiState().tracking).toBe(state.tracking);
    }
    expect(editor.undo()).toBe(false);
    for (const state of states.slice(1)) {
      expect(editor.redo()).toBe(true);
      expect(editor.getDoc()).toBe(state.text);
      expect(editor.getUiState().tracking).toBe(state.tracking);
    }
  });

  it('is written with its blank line in a document with no text, and the file keeps it', () => {
    for (const start of ['', '\n']) {
      const label = JSON.stringify(start);
      const editor = load(start, { saveTracking: true });
      editor.setTracking(true);
      // What a save writes: the ledger after its blank line, though the caret is on an empty line.
      const saved = editor.getDoc();
      expect(saved.startsWith('\n\n<!-- redlines'), label).toBe(true);
      // Opened again from the file, the first text typed has its place, and nothing is refused.
      const notices: string[] = [];
      const again = load(saved, { saveTracking: true, onNotice: (m) => notices.push(m) });
      expect(again.getUiState().tracking, label).toBe(true);
      again.view.dispatch({ selection: { anchor: 0 }, userEvent: 'select' });
      type(again, 'Hello');
      expect(notices, label).toEqual([]);
      expect(
        again.getParsed().marks.map((mark) => mark.kind),
        label,
      ).toEqual(['ins']);
      expect(again.getDoc().startsWith('<!--ins '), label).toBe(true);
    }
  });

  it('leaves a gap between blank lines as it was, when the caret is in it', () => {
    const text = 'One\n\n\n\nTwo\n';
    const editor = load(text, { saveTracking: true });
    editor.view.dispatch({ selection: { anchor: text.indexOf('Two') - 2 }, userEvent: 'select' });
    editor.setTracking(true);
    expect(editor.getDoc()).toBe(applyChanges(text, trackingInFile(text, true)));
    editor.setTracking(false);
    expect(editor.getDoc()).toBe(text);
  });

  it('lets the first text be typed in a document with none, as Track Changes is turned on in it', () => {
    for (const start of ['', '\n']) {
      const label = JSON.stringify(start);
      const notices: string[] = [];
      const editor = load(start, { saveTracking: true, onNotice: (m) => notices.push(m) });
      expect(editor.setTracking(true), label).toBe(true);
      editor.view.dispatch({ selection: { anchor: 0 }, userEvent: 'select' });
      type(editor, 'Hello');
      expect(notices, label).toEqual([]);
      expect(editor.getParsed().warnings, label).toEqual([]);
      expect(editor.getParsed().ledger.tracking, label).toBe('everyone');
      expect(
        editor.getParsed().marks.map((mark) => mark.kind),
        label,
      ).toEqual(['ins']);
      expect(editor.getDoc().startsWith('<!--ins '), label).toBe(true);
    }
  });

  it('is refused where the file can’t take a ledger, with the reason, and stays off', () => {
    const notices: string[] = [];
    const unclosed = 'Text\n\n```js\nlet x;\n';
    const editor = load(unclosed, { saveTracking: true, onNotice: (m) => notices.push(m) });
    expect(editor.setTracking(true)).toBe(false);
    expect(editor.getUiState().tracking).toBe(false);
    expect(editor.getDoc()).toBe(unclosed);
    expect(notices).toEqual([
      "The end of this file is inside a code block or a comment that is never closed, so Redlines can't add its ledger. Close it first.",
    ]);
    // Turning it off has nothing to take out, and nothing to refuse.
    expect(editor.setTracking(false)).toBe(true);
    expect(notices).toHaveLength(1);
  });

  it('is refused where the ledger can’t be read', () => {
    const notices: string[] = [];
    const broken = 'Body.\n\n<!-- redlines\nversion: 1\npeople: {ada: {name: Ada\n-->\n';
    const editor = load(broken, { saveTracking: true, onNotice: (m) => notices.push(m) });
    expect(editor.setTracking(true)).toBe(false);
    expect(editor.getDoc()).toBe(broken);
    expect(notices).toEqual([
      "The ledger at the end of this file can't be read, so Redlines won't change it. Fix or remove it first.",
    ]);
  });

  it('can be kept to the editor when the caller says so, as a preference for new documents is', () => {
    const editor = load(PLAIN, { saveTracking: true });
    expect(editor.setTracking(true, { inFile: false })).toBe(true);
    expect(editor.getUiState().tracking).toBe(true);
    expect(editor.getDoc()).toBe(PLAIN);
    expect(undoDepth(editor.view.state)).toBe(0);
    // Typing then writes a ledger as it always did, and the file says nothing of Track Changes.
    editor.view.dispatch({
      selection: { anchor: PLAIN.indexOf('paragraph') },
      userEvent: 'select',
    });
    type(editor, 'new ');
    expect(editor.getParsed().ledger.tracking).toBeUndefined();
    expect(editor.getParsed().marks.map((mark) => mark.kind)).toEqual(['ins']);
  });

  it('only changes the editor’s state, as before, when the host does not ask for the file', () => {
    const editor = load(PLAIN);
    expect(editor.setTracking(true)).toBe(true);
    expect(editor.getUiState().tracking).toBe(true);
    expect(editor.getDoc()).toBe(PLAIN);
    expect(editor.setTracking(false)).toBe(true);
    expect(editor.getDoc()).toBe(PLAIN);
  });

  it('is on when the file says so, whoever turned it on', () => {
    const editor = load(reviewed('tracking: everyone'), { saveTracking: true });
    expect(editor.getUiState().tracking).toBe(true);
  });
});

describe('recording the view in the document (format §5.6)', () => {
  it('writes Clean as clean, Redlines as redlines and the simple look as simple', () => {
    const editor = load(reviewed());
    editor.setViewMode('clean');
    editor.recordView();
    expect(editor.getDoc()).toBe(reviewed('view: clean'));
    editor.setViewMode('simple');
    editor.recordView();
    expect(editor.getDoc()).toBe(reviewed('view: simple'));
    editor.setViewMode('clean');
    editor.recordView();
    expect(editor.getDoc()).toBe(reviewed('view: clean'));
    editor.setViewMode('redlines');
    editor.recordView();
    expect(editor.getDoc()).toBe(reviewed('view: redlines'));
  });

  it('leaves the view the file had when the document is in Raw', () => {
    for (const had of ['view: clean', 'view: redlines', 'view: simple']) {
      const editor = load(reviewed(had));
      editor.setViewMode('raw');
      editor.recordView();
      expect(editor.getDoc(), had).toBe(reviewed(had));
    }
  });

  it('opens a file again in the look it was saved in, from either look', () => {
    // A save in the simple look, and then in the full markup, and a document opened from each.
    const editor = load(reviewed(), { markupView: 'redlines' });
    editor.setViewMode('simple');
    editor.recordView();
    expect(load(editor.getDoc(), { markupView: 'redlines' }).getUiState().view).toBe('simple');
    editor.setViewMode('redlines');
    editor.recordView();
    expect(load(editor.getDoc(), { markupView: 'simple' }).getUiState().view).toBe('redlines');
  });

  it('never adds a ledger for the view', () => {
    const editor = load(PLAIN);
    editor.recordView();
    expect(editor.getDoc()).toBe(PLAIN);
    editor.setViewMode('redlines');
    editor.recordView();
    expect(editor.getDoc()).toBe(PLAIN);
  });

  it('changes nothing, and tells no one, when the file has the view already', () => {
    const told: string[] = [];
    const editor = load(reviewed('view: redlines'), { onChange: (text) => told.push(text) });
    editor.recordView();
    editor.recordView();
    expect(told).toEqual([]);
    expect(editor.getDoc()).toBe(reviewed('view: redlines'));
  });

  it('leaves the view that is shown as it is, and no step where there is none to join', () => {
    const editor = load(reviewed());
    editor.setViewMode('clean');
    editor.recordView();
    expect(undoDepth(editor.view.state)).toBe(0);
    expect(editor.getUiState().view).toBe('clean');
    expect(parse(editor.getDoc()).ledger.view).toBe('clean');
  });

  it('joins the newest step, which Undo and Redo then take back and bring back with it', () => {
    const editor = load(reviewed('tracking: everyone'));
    const before = editor.getDoc();
    caretBefore(editor, 'word');
    type(editor, 'x');
    const typed = editor.getDoc();
    editor.setViewMode('clean');
    editor.recordView();
    expect(undoDepth(editor.view.state)).toBe(1);
    const saved = editor.getDoc();
    expect(parse(saved).ledger.view).toBe('clean');
    expect(saved.replace('view: clean\n', '')).toBe(typed);
    // The text of a save is one step away from what it was, however long ago the typing was.
    expect(editor.undo()).toBe(true);
    expect(editor.getDoc()).toBe(before);
    expect(editor.redo()).toBe(true);
    expect(editor.getDoc()).toBe(saved);
  });

  it('is no part of what is typed next', () => {
    const editor = load(reviewed('tracking: everyone'));
    caretBefore(editor, 'word');
    type(editor, 'x');
    editor.recordView();
    // Typed at once, next to the last typing: still a step of its own.
    type(editor, 'y');
    expect(undoDepth(editor.view.state)).toBe(2);
    editor.undo();
    expect(parse(editor.getDoc()).ledger.view).toBe('redlines');
    expect(editor.getDoc()).toContain('new x<!--/k3x9-->');
    expect(editor.getDoc()).not.toContain('xy');
  });

  it('joins the newest step when steps can be redone, which it drops', () => {
    const editor = load(reviewed(), { saveTracking: true });
    editor.setTracking(true);
    caretBefore(editor, 'word');
    type(editor, 'x');
    editor.undo();
    expect(redoDepth(editor.view.state)).toBe(1);
    editor.setViewMode('clean');
    editor.recordView();
    expect(parse(editor.getDoc()).ledger.view).toBe('clean');
    expect(redoDepth(editor.view.state)).toBe(0);
    expect(undoDepth(editor.view.state)).toBe(1);
    // The step is the switch's, with the view: taken back, the file is as it was.
    editor.undo();
    expect(editor.getDoc()).toBe(reviewed());
  });

  it('waits for the next save when every step is taken back, which leaves nothing to join', () => {
    const editor = load(reviewed('tracking: everyone'));
    caretBefore(editor, 'word');
    type(editor, 'x');
    editor.undo();
    expect(undoDepth(editor.view.state)).toBe(0);
    editor.setViewMode('clean');
    const before = editor.getDoc();
    editor.recordView();
    expect(editor.getDoc()).toBe(before);
    expect(redoDepth(editor.view.state)).toBe(1);
    expect(editor.redo()).toBe(true);
    editor.recordView();
    expect(parse(editor.getDoc()).ledger.view).toBe('clean');
  });

  it('leaves a gap between blank lines as it was, whatever the caret is on', () => {
    const gap = reviewed().replace(
      'noted<!--/c8d2-->.\n\n<!--',
      'noted<!--/c8d2-->.\n\n\n\nEnd.\n\n<!--',
    );
    expect(gap).not.toBe(reviewed());
    const editor = load(gap);
    editor.view.dispatch({ selection: { anchor: gap.indexOf('End.') - 2 }, userEvent: 'select' });
    editor.setViewMode('clean');
    editor.recordView();
    expect(editor.getDoc()).toBe(applyChanges(gap, setView(gap, 'clean')));
  });

  it('is recorded for the next time a window opens the document, exactly as it was left', () => {
    const left = load(reviewed());
    left.setViewMode('clean');
    left.recordView();
    expect(load(left.getDoc(), { markupView: 'simple' }).getUiState().view).toBe('clean');
  });

  it('leaves a ledger it can’t read alone', () => {
    const broken = 'Body.\n\n<!-- redlines\nversion: 1\npeople: {ada: {name: Ada\n-->\n';
    const editor = load(broken);
    editor.setViewMode('redlines');
    expect(() => editor.recordView()).not.toThrow();
    expect(editor.getDoc()).toBe(broken);
  });
});
