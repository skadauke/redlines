// @vitest-environment happy-dom
// Per-person undo (multiuser plan, PR 6): a step knows whose it is. Undo takes back what is left of
// your own step and keeps what others did since; it never refuses and never takes another person's
// work with it. Their changes come in as remote changes.
import { Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { acceptMarks, parse, rejectMarks, trackedEdit, type TextChange } from '@redlines/format';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type Editor } from '../index.ts';
import { refusedEditEffect, setTrackingEffect } from '../tracked/typing.ts';
import { redoSayingWhy, undoSayingWhy } from './guard.ts';
import { historyField, remoteStep, undoDepth } from './history.ts';

const open: Editor[] = [];
afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

function made(doc: string, tracking: boolean) {
  const parent = document.createElement('div');
  document.body.append(parent);
  const said: string[] = [];
  const editor = createEditor(parent, {
    doc,
    author: { handle: 'ada', name: 'Ada Lovelace' },
    tracking,
    extensions: [
      EditorView.updateListener.of((update) => {
        for (const tr of update.transactions)
          for (const effect of tr.effects)
            if (effect.is(refusedEditEffect)) said.push(effect.value);
      }),
    ],
  });
  open.push(editor);
  return { editor, said };
}

const type = (editor: Editor, from: number, to: number, insert: string) =>
  editor.view.dispatch({ changes: { from, to, insert }, userEvent: 'input.type' });

const fromBo = [Transaction.addToHistory.of(false), remoteStep.of({ person: 'bo', name: 'Bo' })];

/** Bo's edit, as the session delivers it: outside the history, with its author. */
const remote = (editor: Editor, from: number, to: number, insert: string) =>
  editor.view.dispatch({ changes: { from, to, insert }, annotations: fromBo, filter: false });

/** Bo's edit as the format writes it with Track Changes on. */
const remoteTracked = (editor: Editor, from: number, to: number, insert: string) => {
  const changes = trackedEdit(
    editor.view.state.doc.toString(),
    { from, to, insert },
    { author: { handle: 'bo', name: 'Bo' }, time: '2026-11-17T10:00Z' },
  );
  editor.view.dispatch({ changes, annotations: fromBo, filter: false });
};

/** Bo decides every mark of the file. */
const decide = (editor: Editor, how: typeof acceptMarks) => {
  const text = editor.view.state.doc.toString();
  const changes: TextChange[] = how(
    text,
    parse(text).marks.map((mark) => mark.id),
  );
  editor.view.dispatch({ changes, annotations: fromBo, filter: false });
};

const track = (editor: Editor, on: boolean) =>
  editor.view.dispatch({ effects: setTrackingEffect.of(on) });

const bodyOf = (editor: Editor) => editor.view.state.doc.toString().split('\n\n<!-- redlines')[0];
const parsedOf = (editor: Editor) => parse(editor.view.state.doc.toString());

describe('undo, per person', () => {
  it('takes back an untracked step that nobody touched, though others edited elsewhere', () => {
    const { editor } = made('Hello world\n', false);
    type(editor, 5, 5, ' there');
    remote(editor, 0, 0, 'Oh. ');
    expect(bodyOf(editor)).toBe('Oh. Hello there world\n');
    undoSayingWhy(editor.view);
    expect(bodyOf(editor)).toBe('Oh. Hello world\n');
  });

  it('takes your text from an untracked step that Bo typed inside, and keeps his typing', () => {
    const { editor, said } = made('Hello world\n', false);
    type(editor, 5, 5, ' there');
    remote(editor, 8, 8, 'X');
    expect(bodyOf(editor)).toBe('Hello thXere world\n');
    expect(undoSayingWhy(editor.view)).toBe(true);
    expect(bodyOf(editor)).toBe('HelloX world\n');
    expect(said).toEqual([]);
    // Redo brings back what Undo took, with his typing where it is.
    redoSayingWhy(editor.view);
    expect(bodyOf(editor)).toBe('Hello thXere world\n');
  });

  it('keeps Bo’s tracked deletion over part of your untracked text, and takes the rest', () => {
    const { editor, said } = made('Hello world\n', false);
    type(editor, 5, 5, ' there');
    remoteTracked(editor, 7, 10, '');
    expect(parsedOf(editor).marks.map((mark) => mark.entry.by)).toEqual(['bo']);
    undoSayingWhy(editor.view);
    const after = parsedOf(editor);
    expect(said).toEqual([]);
    expect(after.warnings).toEqual([]);
    expect(after.marks.map((mark) => [mark.kind, mark.entry.by, mark.payload])).toEqual([
      ['del', 'bo', 'her'],
    ]);
    expect(bodyOf(editor)).not.toContain('there');
    expect(Object.keys(after.ledger.marks)).toEqual(after.marks.map((mark) => mark.id));
  });

  it('does not count text typed beside the step as touching it', () => {
    const { editor, said } = made('Hello world\n', false);
    type(editor, 5, 5, ' there');
    remote(editor, 11, 11, '!');
    undoSayingWhy(editor.view);
    expect(said).toEqual([]);
    expect(bodyOf(editor)).toBe('Hello! world\n');
  });

  it('takes back a tracked step by rejecting its marks, though Bo edited inside it', () => {
    const { editor, said } = made('Hello world\n', true);
    type(editor, 5, 5, ' there');
    const at = editor.view.state.doc.toString().indexOf('there');
    // Bo deletes a letter inside the inserted text: it touches the step, adds nothing to it.
    remote(editor, at + 2, at + 3, '');
    expect(undoSayingWhy(editor.view)).toBe(true);
    expect(said).toEqual([]);
    expect(bodyOf(editor)).not.toContain('<!--ins');
    expect(parsedOf(editor).warnings).toEqual([]);
  });

  it('takes your marks and text from a tracked step Bo typed inside, and keeps his typing', () => {
    const { editor, said } = made('Hello world\n', true);
    type(editor, 5, 5, ' there');
    const at = editor.view.state.doc.toString().indexOf('there');
    remote(editor, at + 2, at + 2, 'X');
    undoSayingWhy(editor.view);
    const after = parsedOf(editor);
    expect(said).toEqual([]);
    expect(after.warnings).toEqual([]);
    expect(after.marks).toEqual([]);
    expect(bodyOf(editor)).toBe('HelloX world\n');
    expect(after.ledger.marks).toEqual({});
  });

  it('keeps Bo’s own tracked typing, under his mark, inside a tracked step of yours', () => {
    const { editor, said } = made('Hello world\n', true);
    type(editor, 5, 5, ' there');
    const at = editor.view.state.doc.toString().indexOf('there');
    remoteTracked(editor, at + 2, at + 2, 'X');
    expect(parsedOf(editor).warnings).toEqual([]);
    undoSayingWhy(editor.view);
    const after = parsedOf(editor);
    expect(said).toEqual([]);
    expect(after.warnings).toEqual([]);
    expect(after.marks.length).toBeGreaterThan(0);
    expect(after.marks.every((mark) => mark.entry.by === 'bo')).toBe(true);
    expect(bodyOf(editor)).toContain('X');
    expect(bodyOf(editor)).not.toContain('there');
    expect(Object.keys(after.ledger.marks)).toEqual(after.marks.map((mark) => mark.id));
  });

  it('writes the take-back of a step Bo accepted as a tracked deletion, with Track Changes on', () => {
    const { editor, said } = made('Hello world\n', true);
    type(editor, 5, 5, ' there');
    decide(editor, acceptMarks);
    expect(bodyOf(editor)).toBe('Hello there world\n');
    undoSayingWhy(editor.view);
    const after = parsedOf(editor);
    expect(said).toEqual([]);
    expect(after.warnings).toEqual([]);
    expect(after.marks.map((mark) => [mark.kind, mark.entry.by, mark.payload])).toEqual([
      ['del', 'ada', ' there'],
    ]);
    // Redo brings the text back.
    redoSayingWhy(editor.view);
    expect(bodyOf(editor)).toBe('Hello there world\n');
    expect(parsedOf(editor).marks).toEqual([]);
  });

  it('writes the take-back of a step Bo accepted plain, with Track Changes off', () => {
    const { editor } = made('Hello world\n', true);
    type(editor, 5, 5, ' there');
    decide(editor, acceptMarks);
    track(editor, false);
    undoSayingWhy(editor.view);
    expect(bodyOf(editor)).toBe('Hello world\n');
    expect(parsedOf(editor).marks).toEqual([]);
  });

  it('brings back the text of a deletion Bo accepted, as a tracked insertion', () => {
    const { editor, said } = made('Hello world\n', true);
    type(editor, 5, 11, '');
    expect(parsedOf(editor).marks.map((mark) => mark.kind)).toEqual(['del']);
    decide(editor, acceptMarks);
    expect(bodyOf(editor)).toBe('Hello\n');
    undoSayingWhy(editor.view);
    const after = parsedOf(editor);
    expect(said).toEqual([]);
    expect(after.warnings).toEqual([]);
    expect(after.marks.map((mark) => [mark.kind, mark.entry.by])).toEqual([['ins', 'ada']]);
    expect(bodyOf(editor)).toContain(' world');
    redoSayingWhy(editor.view);
    expect(bodyOf(editor)).toBe('Hello\n');
  });

  it('brings back an accepted deletion plain with Track Changes off', () => {
    const { editor } = made('Hello world\n', true);
    type(editor, 5, 11, '');
    decide(editor, acceptMarks);
    track(editor, false);
    undoSayingWhy(editor.view);
    expect(bodyOf(editor)).toBe('Hello world\n');
    expect(parsedOf(editor).marks).toEqual([]);
  });

  it('has nothing to write for a step Bo rejected, and goes to the step below, with no message', () => {
    const { editor, said } = made('Hello world\n', false);
    type(editor, 0, 0, 'A');
    track(editor, true);
    editor.view.dispatch({
      changes: { from: 6, to: 6, insert: ' there' },
      userEvent: 'input.type',
      annotations: Transaction.time.of(Date.now() + 5000),
    });
    decide(editor, rejectMarks);
    expect(bodyOf(editor)).toBe('AHello world\n');
    undoSayingWhy(editor.view);
    expect(said).toEqual([]);
    expect(bodyOf(editor)).toBe('Hello world\n');
  });

  it('writes nothing back for a deletion Bo rejected', () => {
    const { editor, said } = made('Hello world\n', true);
    type(editor, 5, 11, '');
    decide(editor, rejectMarks);
    expect(bodyOf(editor)).toBe('Hello world\n');
    undoSayingWhy(editor.view);
    expect(said).toEqual([]);
    expect(bodyOf(editor)).toBe('Hello world\n');
    expect(undoDepth(editor.view.state)).toBe(0);
  });

  it('goes on to the step below after one it took back in part', () => {
    const { editor } = made('Hello world\n', false);
    type(editor, 0, 0, 'A');
    // Isolate the second step from the first.
    editor.view.dispatch({
      changes: { from: 12, to: 12, insert: 'ZZ' },
      userEvent: 'input.type',
      annotations: Transaction.time.of(Date.now() + 5000),
    });
    remote(editor, 13, 13, 'Q');
    undoSayingWhy(editor.view);
    expect(bodyOf(editor)).toBe('AHello worldQ\n');
    undoSayingWhy(editor.view);
    expect(bodyOf(editor)).toBe('Hello worldQ\n');
  });

  it('puts the caret on what it gave back', () => {
    const { editor } = made('Hello world\n', true);
    type(editor, 5, 5, ' there');
    remote(editor, 0, 0, 'Oh. ');
    undoSayingWhy(editor.view);
    expect(editor.view.state.selection.main.empty).toBe(true);
    expect(bodyOf(editor)).toBe('Oh. Hello world\n');
  });

  it('keeps what it knows of a step through the history’s JSON', () => {
    const { editor } = made('Hello world\n', true);
    type(editor, 5, 5, ' there');
    const json = editor.view.state.toJSON({ history: historyField }) as {
      history: { done: { meta?: { person: string; marks: string[] } }[] };
    };
    const kept = json.history.done.find((event) => event.meta?.person);
    expect(kept?.meta?.person).toBe('ada');
    expect(kept?.meta?.marks.length).toBe(1);
  });
});
