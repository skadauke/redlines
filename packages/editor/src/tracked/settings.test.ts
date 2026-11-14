// @vitest-environment happy-dom
// The two settings of the ledger that the editor applies and writes (format §5.6): Track Changes
// and the view a document opens in, which the host has the editor record when it saves the file.
// Switching either never edits the document.

import { afterEach, describe, expect, it } from 'vitest';
import { applyChanges, parse, setView } from '@redlines/format';
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
    expect(load(plain.replace('view: redlines', 'view: simple')).getUiState().view).toBe('simple');
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

describe('Track Changes, recorded when the file is saved (format §5.6)', () => {
  it('writes nothing when it is turned on or off, and is no edit, so the document is not edited', () => {
    const told: string[] = [];
    const editor = load(PLAIN, { saveTracking: true, onChange: (text) => told.push(text) });
    editor.setTracking(true);
    expect(editor.getUiState().tracking).toBe(true);
    expect(editor.getDoc()).toBe(PLAIN);
    editor.setTracking(false);
    expect(editor.getUiState().tracking).toBe(false);
    editor.setTracking(true);
    // The host hears of no change to the file, so nothing is edited and quitting asks nothing.
    expect(told).toEqual([]);
    expect(editor.getDoc()).toBe(PLAIN);
    expect(undoDepth(editor.view.state)).toBe(0);
    expect(editor.getUiState().undo).toBeNull();
  });

  it('is no step of its own: Undo has nothing to take back', () => {
    const editor = load(PLAIN, { saveTracking: true });
    editor.setTracking(true);
    expect(editor.getUiState().canUndo).toBe(false);
    expect(editor.undo()).toBe(false);
    expect(editor.getUiState().tracking).toBe(true);
  });

  it('is written in no plain file at a save until a change gives it a ledger', () => {
    const editor = load(PLAIN, { saveTracking: true });
    editor.setTracking(true);
    editor.recordTracking();
    editor.recordView();
    expect(editor.getDoc()).toBe(PLAIN);
    expect(undoDepth(editor.view.state)).toBe(0);
  });

  it('is written at a save after a first tracked change, with the ledger that change made', () => {
    const editor = load(PLAIN, { saveTracking: true });
    editor.setTracking(true);
    caretBefore(editor, 'paragraph');
    type(editor, 'new ');
    // The change made a ledger; the setting waits for the save.
    expect(editor.getParsed().ledger.tracking).toBeUndefined();
    expect(editor.getParsed().marks.map((mark) => mark.kind)).toEqual(['ins']);
    editor.recordTracking();
    expect(editor.getParsed().ledger.tracking).toBe('everyone');
    expect(editor.getDoc()).toContain('\ntracking: everyone\n');
    // Opened again, as the file says: Track Changes is on.
    const again = load(editor.getDoc(), { saveTracking: true });
    expect(again.getUiState().tracking).toBe(true);
  });

  it('is the one line in a file that has a ledger', () => {
    const editor = load(reviewed(), { saveTracking: true });
    editor.setTracking(true);
    expect(editor.getDoc()).toBe(reviewed());
    editor.recordTracking();
    expect(editor.getDoc()).toBe(reviewed('tracking: everyone'));
  });

  it('is taken out at a save made after turning it off in a tracked file', () => {
    const editor = load(reviewed('tracking: everyone'), { saveTracking: true });
    expect(editor.getUiState().tracking).toBe(true);
    editor.setTracking(false);
    // Turning it off is no edit: the file still says it.
    expect(editor.getDoc()).toBe(reviewed('tracking: everyone'));
    // An edit, untracked now, is why the file is saved.
    caretBefore(editor, 'word');
    type(editor, 'x');
    editor.recordTracking();
    expect(editor.getParsed().ledger.tracking).toBeUndefined();
    expect(editor.getDoc()).not.toContain('tracking:');
    expect(editor.getParsed().marks.map((mark) => mark.id)).toEqual(['k3x9', 'c8d2']);
    // Opened again, as the file says: Track Changes is off.
    const again = load(editor.getDoc(), { saveTracking: true });
    expect(again.getUiState().tracking).toBe(false);
  });

  it('leaves a file that asks for it alone when nobody switched it, whatever the window has', () => {
    const editor = load(reviewed('tracking: everyone'), { saveTracking: true, tracking: false });
    caretBefore(editor, 'word');
    type(editor, 'x');
    editor.recordTracking();
    expect(editor.getParsed().ledger.tracking).toBe('everyone');
  });

  it('is recorded as it was chosen last', () => {
    const editor = load(reviewed(), { saveTracking: true });
    editor.setTracking(true);
    editor.setTracking(false);
    editor.setTracking(true);
    editor.recordTracking();
    expect(editor.getDoc()).toBe(reviewed('tracking: everyone'));
    editor.setTracking(false);
    editor.recordTracking();
    expect(editor.getDoc()).toBe(reviewed());
  });

  it('is joined to the newest step, which Undo takes back with it', () => {
    const editor = load(reviewed(), { saveTracking: true });
    editor.setTracking(true);
    caretBefore(editor, 'word');
    type(editor, 'x');
    const typed = editor.getDoc();
    editor.recordTracking();
    expect(editor.getDoc()).not.toBe(typed);
    expect(undoDepth(editor.view.state)).toBe(1);
    editor.undo();
    expect(editor.getDoc()).toBe(reviewed());
    expect(redoDepth(editor.view.state)).toBe(1);
    // With every step taken back, the next save records it again.
    editor.redo();
    editor.recordTracking();
    expect(editor.getParsed().ledger.tracking).toBe('everyone');
  });

  it('waits for the next save when every step is taken back, which a change would put out of step', () => {
    const editor = load(reviewed(), { saveTracking: true });
    editor.setTracking(true);
    caretBefore(editor, 'word');
    type(editor, 'x');
    editor.undo();
    expect(redoDepth(editor.view.state)).toBe(1);
    editor.recordTracking();
    expect(editor.getDoc()).toBe(reviewed());
    expect(redoDepth(editor.view.state)).toBe(1);
  });

  it('can be turned off in Raw, where typing is read-only while it is on', () => {
    const editor = load(reviewed('tracking: everyone'), { saveTracking: true });
    editor.setViewMode('raw');
    editor.setTracking(false);
    expect(editor.getUiState().tracking).toBe(false);
    editor.setTracking(true);
    expect(editor.getUiState().tracking).toBe(true);
  });

  it('is never made into a tracked change of its own', () => {
    const editor = load(reviewed('tracking: everyone'), { saveTracking: true, tracking: true });
    editor.setTracking(false);
    editor.recordTracking();
    expect(editor.getDoc()).toBe(reviewed());
    expect(editor.getParsed().marks.map((mark) => mark.id)).toEqual(['k3x9', 'c8d2']);
  });

  it('is written with the first text typed in a document with none, which gets its ledger with its blank line', () => {
    for (const start of ['', '\n']) {
      const label = JSON.stringify(start);
      const notices: string[] = [];
      const editor = load(start, { saveTracking: true, onNotice: (m) => notices.push(m) });
      editor.setTracking(true);
      expect(editor.getDoc(), label).toBe(start);
      editor.view.dispatch({ selection: { anchor: 0 }, userEvent: 'select' });
      type(editor, 'Hello');
      expect(notices, label).toEqual([]);
      expect(editor.getParsed().warnings, label).toEqual([]);
      expect(
        editor.getParsed().marks.map((mark) => mark.kind),
        label,
      ).toEqual(['ins']);
      editor.recordTracking();
      expect(editor.getParsed().ledger.tracking, label).toBe('everyone');
      expect(editor.getDoc().startsWith('<!--ins '), label).toBe(true);
    }
  });

  it('is left alone, and never why a save fails, where the file can’t take a ledger', () => {
    for (const text of [
      'Text\n\n```js\nlet x;\n',
      'Body.\n\n<!-- redlines\nversion: 1\npeople: {ada: {name: Ada\n-->\n',
    ]) {
      const notices: string[] = [];
      const editor = load(text, { saveTracking: true, onNotice: (m) => notices.push(m) });
      editor.setTracking(true);
      expect(editor.getUiState().tracking).toBe(true);
      expect(() => editor.recordTracking()).not.toThrow();
      expect(editor.getDoc()).toBe(text);
      expect(notices).toEqual([]);
    }
  });

  it('is never recorded when the caller says it is the person’s own preference, as for new documents', () => {
    const editor = load(PLAIN, { saveTracking: true });
    editor.setTracking(true, { inFile: false });
    expect(editor.getUiState().tracking).toBe(true);
    expect(editor.getDoc()).toBe(PLAIN);
    editor.view.dispatch({
      selection: { anchor: PLAIN.indexOf('paragraph') },
      userEvent: 'select',
    });
    type(editor, 'new ');
    editor.recordTracking();
    expect(editor.getParsed().ledger.tracking).toBeUndefined();
    expect(editor.getParsed().marks.map((mark) => mark.kind)).toEqual(['ins']);
  });

  it('is never recorded when the host does not ask for the file', () => {
    const editor = load(reviewed());
    editor.setTracking(true);
    expect(editor.getUiState().tracking).toBe(true);
    editor.recordTracking();
    expect(editor.getDoc()).toBe(reviewed());
  });

  it('forgets a choice when the file is loaded or reloaded: the file says what it says', () => {
    const editor = load(reviewed(), { saveTracking: true });
    editor.setTracking(true);
    editor.reloadDoc(reviewed('history: full'));
    caretBefore(editor, 'word');
    type(editor, 'x');
    editor.recordTracking();
    expect(editor.getParsed().ledger.tracking).toBeUndefined();
    editor.setTracking(true);
    editor.setDoc(reviewed());
    editor.recordTracking();
    expect(editor.getDoc()).toBe(reviewed());
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
    const editor = load(reviewed());
    caretBefore(editor, 'word');
    type(editor, 'x');
    editor.recordView();
    type(editor, 'y');
    editor.undo();
    expect(undoDepth(editor.view.state)).toBe(1);
    expect(redoDepth(editor.view.state)).toBe(1);
    editor.setViewMode('clean');
    editor.recordView();
    expect(parse(editor.getDoc()).ledger.view).toBe('clean');
    expect(redoDepth(editor.view.state)).toBe(0);
    expect(undoDepth(editor.view.state)).toBe(1);
    // The step is the typing's, with the view: taken back, the file is as it was.
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
