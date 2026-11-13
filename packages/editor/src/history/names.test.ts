// @vitest-environment happy-dom
/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyChanges, reply } from '@redlines/format';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type Editor } from '../index.ts';
import { redo, undo } from './index.ts';

const fixture = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../../format/src/fixtures/launch-plan.md'),
  'utf8',
);

const ada = { handle: 'ada', name: 'Ada Lovelace' };
const claude = { handle: 'claude-ada', name: 'Claude', agent: true, for: 'ada' };
const open: Editor[] = [];

afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

function load(doc = 'Some plain words here.\n'): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, { doc, author: ada, tracking: false });
  open.push(editor);
  return editor;
}

/** The names Undo and Redo show after `userEvent` changes the text of a plain document. */
function nameOfEvent(userEvent: string | undefined, doc?: string): string | null {
  const editor = load(doc);
  editor.view.dispatch({ changes: { from: 0, insert: 'X' }, userEvent });
  return editor.getUiState().undo;
}

const claudeReplied = (file: string) =>
  applyChanges(
    file,
    reply(file, 'c8d2', 'Thanks, Ada.', { author: claude, time: '2026-11-01T10:05Z' }),
  );

describe('naming a step', () => {
  it('names your steps as the Mac does', () => {
    const names: Record<string, string> = {
      input: 'Typing',
      'input.type': 'Typing',
      'input.type.compose': 'Typing',
      'input.complete': 'Typing',
      'input.break': 'Typing',
      'input.break.line': 'Typing',
      'delete.backward': 'Typing',
      'delete.backward.block': 'Typing',
      'delete.block': 'Typing',
      'delete.forward': 'Typing',
      'delete.selection': 'Typing',
      'delete.cut': 'Cut',
      'input.paste': 'Paste',
      'input.drop': 'Drag',
      'move.drop': 'Drag',
      'format.bold': 'Formatting',
      'format.block': 'Formatting',
      'input.format': 'Formatting',
      'input.replace': 'Replace',
      'input.replace.all': 'Replace All',
      accept: 'Accept',
      reject: 'Reject',
      'review.comment': 'Comment',
      'review.highlight': 'Highlight',
      'review.reply': 'Reply',
      'review.resolve': 'Resolve',
      'review.reopen': 'Reopen',
    };
    for (const [event, name] of Object.entries(names)) {
      expect([event, nameOfEvent(event)]).toEqual([event, name]);
    }
    expect(nameOfEvent('something.else')).toBeNull();
    expect(nameOfEvent('input.correct')).toBeNull();
    expect(nameOfEvent(undefined)).toBeNull();
  });

  it('names a paste, Paste as Plain Text too, Paste', () => {
    const editor = load(fixture);
    editor.view.dispatch({ selection: { anchor: 20 } });
    // What Paste as Plain Text does, without the focus that happy-dom can't give: a paste event.
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', 'pasted\n\n');
    editor.view.contentDOM.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }),
    );
    expect(editor.getUiState().undo).toBe('Paste');
  });

  it('names a decision and the typing that follows it', () => {
    const reviewed = load(fixture);
    const id = reviewed.getUiState().changes[0]!.id;
    reviewed.accept(id);
    expect(reviewed.getUiState().undo).toBe('Accept');
    reviewed.view.dispatch({ changes: { from: 0, insert: 'Hi ' }, userEvent: 'input.type' });
    expect(reviewed.getUiState().undo).toBe('Typing');
    undo(reviewed.view);
    expect(reviewed.getUiState().undo).toBe('Accept');
    const next = reviewed.getUiState().changes[0]!.id;
    reviewed.reject(next);
    expect(reviewed.getUiState().undo).toBe('Reject');
  });

  it('names an agent’s step Changes, or Reply when it changed only threads', () => {
    const replied = load(fixture);
    replied.applyAgentEdit(claudeReplied(fixture), { group: 'run-1', agent: 'Claude' });
    expect(replied.getUiState().undo).toBe('Claude’s Reply');

    const changed = load(fixture);
    changed.applyAgentEdit(`Intro by Claude.\n\n${fixture}`, { group: 'run-1', agent: 'Claude' });
    expect(changed.getUiState().undo).toBe('Claude’s Changes');

    // A run that replied and then changed the body is one step, and no longer a reply.
    const both = load(fixture);
    const step = { group: 'run-1', agent: 'Claude' };
    const first = claudeReplied(fixture);
    both.applyAgentEdit(first, step);
    expect(both.getUiState().undo).toBe('Claude’s Reply');
    both.applyAgentEdit(`Intro by Claude.\n\n${first}`, step);
    expect(both.getUiState().undo).toBe('Claude’s Changes');
  });

  it('names a change on disk by two agents “Claude and Codex’s Changes”', () => {
    const editor = load();
    editor.applyAgentEdit('Some plain words here, changed.\n', {
      group: 'disk-1',
      agent: 'Claude and Codex',
    });
    expect(editor.getUiState().undo).toBe('Claude and Codex’s Changes');
  });

  it('names what Redo would bring back', () => {
    const editor = load(fixture);
    editor.applyAgentEdit(claudeReplied(fixture), { group: 'run-1', agent: 'Claude' });
    expect(editor.getUiState()).toMatchObject({ undo: 'Claude’s Reply', redo: null });
    undo(editor.view);
    expect(editor.getUiState()).toMatchObject({ undo: null, redo: 'Claude’s Reply' });
    editor.view.dispatch({ changes: { from: 0, insert: 'Hi ' }, userEvent: 'input.type' });
    expect(editor.getUiState().redo).toBeNull();
    undo(editor.view);
    expect(editor.getUiState().redo).toBe('Typing');
    redo(editor.view);
    expect(editor.getUiState()).toMatchObject({ undo: 'Typing', redo: null });
  });

  it('has no name with nothing to undo', () => {
    const editor = load();
    expect(editor.getUiState()).toMatchObject({ undo: null, redo: null });
    editor.view.dispatch({ changes: { from: 0, insert: 'X' }, userEvent: 'input.type' });
    undo(editor.view);
    expect(editor.getUiState().undo).toBeNull();
  });
});
