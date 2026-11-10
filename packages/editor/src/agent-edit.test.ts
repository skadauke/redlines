// @vitest-environment happy-dom
/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runScopeHandlers } from '@codemirror/view';
import { applyChanges, parse, reply, suggestReplace } from '@redlines/format';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentStep, EditorOptions } from './api.ts';
import { createEditor, type Editor } from './index.ts';
import { visibleSelection } from './tracked/decorations.ts';

// A path rather than a URL: under happy-dom, `URL` is the DOM's class, which node:fs rejects.
const fixture = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../format/src/fixtures/launch-plan.md'),
  'utf8',
);

const ada = { handle: 'ada', name: 'Ada Lovelace' };
const claude = { handle: 'claude-ada', name: 'Claude', agent: true, for: 'ada' };
const STEP: AgentStep = { group: 'run-1', agent: 'Claude' };
const open: Editor[] = [];

afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

function load(doc: string, options: Partial<EditorOptions> = {}): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, { doc, author: ada, ...options });
  open.push(editor);
  return editor;
}

let ids = 0;
/** A fresh id source for the agent's new marks and replies. */
function random(n: number): Uint8Array {
  ids++;
  return Uint8Array.from({ length: n }, (_, i) => (ids * 7 + i * 3) % 19);
}
const ctx = () => ({ author: claude, time: '2026-11-10T10:00Z', note: 'Shorter', random });

/** The agent's suggestion on the editor's text, as its tool writes it: a whole new file. */
function suggested(text: string, oldStr: string, newStr: string): string {
  return applyChanges(text, suggestReplace(text, oldStr, newStr, ctx()).changes);
}
function replied(text: string, thread = 'c8d2'): string {
  return applyChanges(text, reply(text, thread, 'Done.', ctx()));
}

const mac = /Mac/.test(navigator.platform);
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
const undoKey = (editor: Editor) => press(editor, 'Mod-z');
const redoKey = (editor: Editor) => press(editor, mac ? 'Mod-Shift-z' : 'Mod-y');
/** Edit › Undo or Redo, which reach the page as input events. */
function menu(editor: Editor, inputType: 'historyUndo' | 'historyRedo'): void {
  editor.view.contentDOM.dispatchEvent(
    new InputEvent('beforeinput', { inputType, bubbles: true, cancelable: true }),
  );
}

const lf = (text: string) => text.replace(/\r\n?/g, '\n');
/** The first index where two texts differ. */
function firstDifference(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}
const caret = (editor: Editor) => editor.view.state.selection.main.head;
const seesCaret = (editor: Editor) =>
  expect(visibleSelection(editor.view.state)).toBe(editor.view.state.selection);

/** The fixture's ledger with its comments listed before its marks, as a person might write it. */
function ledgerOutOfOrder(text: string): string {
  const marks = /\nmarks:\n(?: {2}.*\n)+/.exec(text)![0];
  const comments = /\ncomments:\n(?: {2}.*\n)+/.exec(text)![0];
  return text
    .replace(marks, '\n')
    .replace(comments, comments + marks.slice(1))
    .replace('\n\n', '\n');
}

describe('an agent’s edit', () => {
  it('lands as one step that ⌘Z takes back and ⇧⌘Z brings back, byte for byte', () => {
    const editor = load(fixture);
    const next = replied(suggested(fixture, 'ship', 'launch'));
    editor.applyAgentEdit(next, STEP);
    expect(editor.getDoc()).toBe(next);
    undoKey(editor);
    expect(editor.getDoc()).toBe(fixture);
    redoKey(editor);
    expect(editor.getDoc()).toBe(next);
    menu(editor, 'historyUndo');
    expect(editor.getDoc()).toBe(fixture);
    menu(editor, 'historyRedo');
    expect(editor.getDoc()).toBe(next);
  });

  it('does nothing when the text is the editor’s already', () => {
    const editor = load(fixture);
    editor.applyAgentEdit(fixture, STEP);
    undoKey(editor);
    expect(editor.getDoc()).toBe(fixture);
    expect(editor.view.state.doc.toString()).toBe(fixture);
  });

  it('is exact in CRLF and mixed files, and with a hand-written ledger out of order', () => {
    const crlf = fixture.replace(/\n/g, '\r\n');
    const lines = fixture.split('\n');
    const mixed = lines.slice(0, 3).join('\r\n') + '\r\n' + lines.slice(3).join('\n');
    const handWritten = ledgerOutOfOrder(fixture);
    expect(parse(handWritten).warnings).toEqual([]);
    expect(handWritten.indexOf('comments:')).toBeLessThan(handWritten.indexOf('marks:'));
    for (const file of [crlf, mixed, handWritten]) {
      const editor = load(file);
      const next = replied(suggested(file, 'ship', 'launch'));
      editor.applyAgentEdit(next, STEP);
      expect(editor.getDoc()).toBe(next);
      undoKey(editor);
      expect(editor.getDoc()).toBe(file);
      redoKey(editor);
      expect(editor.getDoc()).toBe(next);
      undoKey(editor);
      expect(editor.getDoc()).toBe(file);
    }
  });

  it('joins the edits of one group into one step, and the undo gives the file from before both', () => {
    const crlf = fixture.replace(/\n/g, '\r\n');
    const editor = load(crlf);
    const first = suggested(crlf, 'ship', 'launch');
    editor.applyAgentEdit(first, STEP);
    const second = replied(first);
    editor.applyAgentEdit(second, STEP);
    undoKey(editor);
    expect(editor.getDoc()).toBe(crlf);
    redoKey(editor);
    expect(editor.getDoc()).toBe(second);
  });

  it('leaves your steps before it as they were', () => {
    const editor = load(fixture);
    editor.view.dispatch({ changes: { from: 0, insert: 'Draft ' }, userEvent: 'input.type' });
    const typed = editor.getDoc();
    editor.applyAgentEdit(suggested(typed, 'ship', 'launch'), STEP);
    undoKey(editor);
    expect(editor.getDoc()).toBe(typed);
    undoKey(editor);
    expect(editor.getDoc()).toBe(fixture);
  });

  it('is no typing: Track Changes on leaves it as the agent wrote it', () => {
    const editor = load(fixture, { tracking: true });
    const text = editor.getDoc();
    const lines = text.split('\n');
    lines[2] = `${lines[2]} Plain words.`;
    const next = lines.join('\n');
    editor.applyAgentEdit(next, STEP);
    expect(editor.getDoc()).toBe(next);
  });

  it('puts the caret at its first change in the body, taken back or brought back', () => {
    const editor = load(fixture);
    const next = replied(suggested(fixture, 'ship', 'launch'));
    const first = firstDifference(lf(fixture), lf(next));
    editor.view.dispatch({ selection: { anchor: 0 } });
    editor.applyAgentEdit(next, STEP);
    editor.view.dispatch({ selection: { anchor: editor.view.state.doc.length } });
    undoKey(editor);
    expect(caret(editor)).toBe(first);
    seesCaret(editor);
    editor.view.dispatch({ selection: { anchor: 0 } });
    redoKey(editor);
    expect(caret(editor)).toBe(first);
    seesCaret(editor);
  });

  it('puts the caret at the thread’s anchor when a step that only replied is taken back or brought back', () => {
    const editor = load(fixture);
    const anchor = () => {
      const mark = editor.getParsed().marks.find((m) => m.id === 'c8d2')!;
      return mark.segments[0]!.content.from;
    };
    editor.applyAgentEdit(replied(fixture), STEP);
    editor.view.dispatch({ selection: { anchor: 0 } });
    undoKey(editor);
    expect(caret(editor)).toBe(anchor());
    expect(caret(editor)).toBeLessThan(editor.getParsed().ledgerRange!.from);
    editor.view.dispatch({ selection: { anchor: 0 } });
    redoKey(editor);
    expect(caret(editor)).toBe(anchor());
  });

  it('keeps the caret where the person can see it in Clean, for a deletion and a substitution', () => {
    for (const [oldStr, newStr] of [
      ['We will ship', 'We ship'],
      ['ship', 'launch'],
    ] as const) {
      const editor = load(fixture, { view: 'clean' });
      expect(editor.getUiState().view).toBe('clean');
      editor.applyAgentEdit(suggested(fixture, oldStr, newStr), STEP);
      expect(editor.getUiState().view).toBe('clean');
      seesCaret(editor);
      for (const step of [undoKey, redoKey, undoKey, redoKey]) {
        step(editor);
        seesCaret(editor);
        expect(editor.getUiState().view).toBe('clean');
      }
    }
  });

  it('keeps an input method’s composition out of the agent’s step', async () => {
    const texts = new Set<string>();
    const editor = load(fixture, { onChange: (text) => texts.add(text) });
    texts.add(editor.getDoc());
    const compose = (at: number, text: string) =>
      editor.view.dispatch({
        changes: { from: at, insert: text },
        userEvent: 'input.type.compose',
      });
    const end = editor.view.state.doc.line(1).to;
    compose(end, 'Ka');
    const composed = editor.getDoc();
    expect(composed).toContain('# Launch planKa');
    editor.applyAgentEdit(suggested(composed, 'ship', 'launch'), STEP);
    compose(end + 2, 'na');
    editor.view.contentDOM.dispatchEvent(new CompositionEvent('compositionend', { data: 'Kana' }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const after = editor.getDoc();
    expect(after).toContain('Kana');
    const seen: string[] = [];
    while (editor.getDoc() !== fixture) {
      const before = editor.getDoc();
      undoKey(editor);
      expect(editor.getDoc()).not.toBe(before);
      seen.push(editor.getDoc());
      expect(texts.has(editor.getDoc())).toBe(true);
    }
    // The agent's undo gives back the text it was made on: the first part composed, plain.
    expect(seen).toContain(composed);
    expect(seen.at(-1)).toBe(fixture);
  });
});
