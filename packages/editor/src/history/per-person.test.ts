// @vitest-environment happy-dom
// Per-person undo (multiuser plan, PR 6): a step knows whose it is. Undo takes back your own text
// and never another person's, which comes in as a remote change.
import { Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type Editor } from '../index.ts';
import { refusedEditEffect } from '../tracked/typing.ts';
import { staleMessage, undoSayingWhy } from './guard.ts';
import { remoteStep } from './history.ts';

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

/** Bo's edit, as the session delivers it: outside the history, with its author. */
const remote = (editor: Editor, from: number, to: number, insert: string) =>
  editor.view.dispatch({
    changes: { from, to, insert },
    annotations: [Transaction.addToHistory.of(false), remoteStep.of({ person: 'bo', name: 'Bo' })],
    filter: false,
  });

const bodyOf = (editor: Editor) => editor.view.state.doc.toString().split('\n\n<!-- redlines')[0];

describe('undo, per person', () => {
  it('takes back an untracked step that nobody touched, though others edited elsewhere', () => {
    const { editor } = made('Hello world\n', false);
    type(editor, 5, 5, ' there');
    remote(editor, 0, 0, 'Oh. ');
    expect(bodyOf(editor)).toBe('Oh. Hello there world\n');
    undoSayingWhy(editor.view);
    expect(bodyOf(editor)).toBe('Oh. Hello world\n');
  });

  it('leaves an untracked step alone that another person changed, and says who', () => {
    const { editor, said } = made('Hello world\n', false);
    type(editor, 5, 5, ' there');
    remote(editor, 8, 8, 'X');
    const before = editor.view.state.doc.toString();
    expect(undoSayingWhy(editor.view)).toBe(true);
    expect(editor.view.state.doc.toString()).toBe(before);
    expect(said).toEqual([staleMessage('Bo')]);
  });

  it('does not count text typed beside the step as touching it', () => {
    const { editor, said } = made('Hello world\n', false);
    type(editor, 5, 5, ' there');
    remote(editor, 11, 11, '!');
    undoSayingWhy(editor.view);
    expect(said).toEqual([]);
    expect(bodyOf(editor)).toBe('Hello! world\n');
  });

  it('takes back a tracked step by rejecting its marks, though Bo typed inside', () => {
    const { editor, said } = made('Hello world\n', true);
    type(editor, 5, 5, ' there');
    const text = editor.view.state.doc.toString();
    const at = text.indexOf('there');
    remote(editor, at + 2, at + 2, 'X');
    expect(undoSayingWhy(editor.view)).toBe(true);
    expect(said).toEqual([]);
    expect(bodyOf(editor)).not.toContain('<!--ins');
  });

  it('says who when a tracked step was decided by another person', () => {
    const { editor, said } = made('Hello world\n', true);
    type(editor, 5, 5, ' there');
    const text = editor.view.state.doc.toString();
    // Bo accepts it: the markers go.
    const opener = text.indexOf('<!--ins');
    const openerEnd = text.indexOf('-->', opener) + 3;
    const closer = text.indexOf('<!--/');
    const closerEnd = text.indexOf('-->', closer) + 3;
    remote(editor, closer, closerEnd, '');
    remote(editor, opener, openerEnd, '');
    const before = editor.view.state.doc.toString();
    undoSayingWhy(editor.view);
    expect(editor.view.state.doc.toString()).toBe(before);
    expect(said).toEqual([staleMessage('Bo')]);
  });

  it('puts the caret on what it gave back', () => {
    const { editor } = made('Hello world\n', true);
    type(editor, 5, 5, ' there');
    remote(editor, 0, 0, 'Oh. ');
    undoSayingWhy(editor.view);
    expect(editor.view.state.selection.main.empty).toBe(true);
    expect(bodyOf(editor)).toBe('Oh. Hello world\n');
  });
});
