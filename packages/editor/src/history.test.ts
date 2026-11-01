// @vitest-environment happy-dom
/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { redo, undo } from '@codemirror/commands';
import { Transaction } from '@codemirror/state';
import { runScopeHandlers } from '@codemirror/view';
import { applyChanges, parse, reply, suggestReplace } from '@redlines/format';
import { afterEach, describe, expect, it } from 'vitest';
import { lineChanges } from './diff.ts';
import { REDO_AFTER_RELOAD, UNDO_AFTER_RELOAD } from './history.ts';
import { createEditor, type Editor } from './index.ts';

// A path rather than a URL: under happy-dom, `URL` is the DOM's class, which node:fs rejects.
const fixture = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../format/src/fixtures/launch-plan.md'),
  'utf8',
);

const ada = { handle: 'ada', name: 'Ada Lovelace' };
const claude = { handle: 'claude-ada', name: 'Claude', agent: true, for: 'ada' };
const open: Editor[] = [];

afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

function load(doc: string, notices: string[] = []): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, { doc, author: ada, onNotice: (m) => notices.push(m) });
  open.push(editor);
  return editor;
}

/** Ada replies to the thread on the security review, as her margin note does. */
function adaReplies(editor: Editor): void {
  const text = editor.view.state.doc.toString();
  const changes = reply(text, 'c8d2', 'Agreed.', { author: ada, time: '2026-11-01T10:00Z' });
  editor.view.dispatch({ changes, userEvent: 'review.reply' });
}

/** The file after Claude replied to the same thread from the command line. */
function claudeReplied(file: string): string {
  const changes = reply(file, 'c8d2', 'Thanks, Ada.', {
    author: claude,
    time: '2026-11-01T10:05Z',
  });
  return applyChanges(file, changes);
}

const mac = /Mac/.test(navigator.platform);
const UNDO = 'Mod-z';
const REDO = mac ? 'Mod-Shift-z' : 'Mod-y';

/** Presses a key through the editor's keymaps. `Mod` is Cmd on a Mac and Ctrl elsewhere. */
function press(editor: Editor, key: string): void {
  const parts = key.split('-');
  const name = parts.pop()!;
  const event = new KeyboardEvent('keydown', {
    key: name,
    shiftKey: parts.includes('Shift'),
    ctrlKey: parts.includes('Mod') && !mac,
    metaKey: parts.includes('Mod') && mac,
    bubbles: true,
    cancelable: true,
  });
  runScopeHandlers(editor.view, event, 'editor');
}

const type = (editor: Editor, at: number, text: string) =>
  editor.view.dispatch({ changes: { from: at, insert: text }, userEvent: 'input.type' });

describe('undo after the file changed on disk', () => {
  it('has nothing to undo after a reload that changed the text, so the agent’s work stays', () => {
    const editor = load(fixture);
    adaReplies(editor);
    const theirs = claudeReplied(editor.getDoc());
    editor.reloadDoc(theirs);
    expect(undo(editor.view)).toBe(false);
    expect(editor.getDoc()).toBe(theirs);
    const replies = editor
      .getParsed()
      .ledger.comments[0]!.replies.map(({ by, text }) => ({ by, text }));
    expect(replies).toEqual([
      { by: 'ada', text: 'Agreed.' },
      { by: 'claude-ada', text: 'Thanks, Ada.' },
    ]);
  });

  it('has nothing to redo after a reload that changed the text', () => {
    const editor = load(fixture);
    type(editor, 0, 'Draft: ');
    expect(undo(editor.view)).toBe(true);
    const theirs = claudeReplied(editor.getDoc());
    editor.reloadDoc(theirs);
    expect(redo(editor.view)).toBe(false);
    expect(editor.getDoc()).toBe(theirs);
  });

  it('keeps the history through a reload that changes nothing', () => {
    const editor = load(fixture);
    type(editor, 0, 'Draft: ');
    editor.reloadDoc(editor.getDoc());
    expect(undo(editor.view)).toBe(true);
    expect(editor.getDoc()).toBe(fixture);
  });

  it('says why Undo and Redo do nothing after the reload, until there is something to undo', () => {
    const notices: string[] = [];
    const editor = load(fixture, notices);
    adaReplies(editor);
    const reloaded = claudeReplied(editor.getDoc());
    editor.reloadDoc(reloaded);
    press(editor, UNDO);
    press(editor, REDO);
    expect(notices).toEqual([UNDO_AFTER_RELOAD, REDO_AFTER_RELOAD]);
    expect(editor.getDoc()).toBe(reloaded);

    // An edit made after the reload is undone as usual, and takes the message away.
    type(editor, 0, 'Draft: ');
    press(editor, UNDO);
    expect(editor.getDoc()).toBe(reloaded);
    press(editor, UNDO);
    expect(editor.getDoc()).toBe(reloaded);
    expect(notices).toHaveLength(2);
  });

  it('still says why Undo does nothing after two reloads in a row', () => {
    const notices: string[] = [];
    const editor = load(fixture, notices);
    adaReplies(editor);
    const once = claudeReplied(editor.getDoc());
    editor.reloadDoc(once);
    editor.reloadDoc(`Note.\n\n${once}`);
    press(editor, UNDO);
    expect(notices).toEqual([UNDO_AFTER_RELOAD]);
  });

  it('says why the Edit menu’s Undo and Redo do nothing after the reload', () => {
    const notices: string[] = [];
    const editor = load(fixture, notices);
    adaReplies(editor);
    editor.reloadDoc(claudeReplied(editor.getDoc()));
    for (const inputType of ['historyUndo', 'historyRedo']) {
      const event = new InputEvent('beforeinput', { inputType, bubbles: true, cancelable: true });
      editor.view.contentDOM.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    }
    expect(notices).toEqual([UNDO_AFTER_RELOAD, REDO_AFTER_RELOAD]);
  });

  it('says nothing when there was nothing to undo before the reload', () => {
    const notices: string[] = [];
    const editor = load(fixture, notices);
    editor.reloadDoc(claudeReplied(fixture));
    press(editor, UNDO);
    expect(notices).toEqual([]);
  });

  it('refuses an undo that would break the file after a change outside the history', () => {
    const notices: string[] = [];
    const editor = load(fixture, notices);
    adaReplies(editor);
    // An agent's reply that reaches the editor without reloadDoc, so the history keeps Ada's
    // reply and maps it through the agent's lines, as reloadDoc once did.
    const theirs = claudeReplied(editor.getDoc());
    editor.view.dispatch({
      changes: lineChanges(editor.view.state.doc.toString(), theirs),
      annotations: [Transaction.addToHistory.of(false), Transaction.remote.of(true)],
    });
    undo(editor.view);
    expect(editor.getDoc()).toBe(theirs);
    expect(notices).toEqual([UNDO_AFTER_RELOAD]);
  });

  it('allows an undo after a change outside the history that keeps the file sound', () => {
    const editor = load(fixture);
    type(editor, 0, 'Draft: ');
    // A suggestion added elsewhere, outside the history.
    const text = editor.view.state.doc.toString();
    const ctx = { author: claude, time: '2026-11-01T10:05Z', note: 'Shorter' };
    editor.view.dispatch({
      changes: suggestReplace(text, 'importer', 'tool', ctx).changes,
      annotations: Transaction.addToHistory.of(false),
    });
    const suggested = editor.getDoc();
    expect(undo(editor.view)).toBe(true);
    expect(editor.getDoc()).toBe(suggested.replace('Draft: ', ''));
    expect(parse(editor.getDoc()).warnings).toEqual([]);
  });
});
