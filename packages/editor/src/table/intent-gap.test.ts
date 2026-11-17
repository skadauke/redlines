// @vitest-environment happy-dom
// The writes that dispatch their own changes, recorded as intents (multiuser §4.2): Backspace at the
// start of a block, typing into a cell a row lacks, and a paste over cells, with Track Changes on and
// off. Each records the intent that wrote it, and deriving the record again on the text it was made
// on gives the document the write made. The files are as before: only an annotation is added.
import { forceParsing } from '@codemirror/language';
import { EditorView, runScopeHandlers } from '@codemirror/view';
import { applyChanges } from '@redlines/format';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createEditor,
  deriveFormat,
  deriveMove,
  deriveWidenedPaste,
  deriveSteps,
  deriveTable,
  editSourceFacet,
  type Editor,
  type Intent,
  intentOf,
} from '../index.ts';
import { deriveIntent } from '../tracked/typing.ts';
import { plainPastes } from '../tracked/clipboard.ts';
import type { EditorState } from '@codemirror/state';

const open: Editor[] = [];
afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

const source = () => {
  let a = 20261117;
  return (n: number) =>
    Uint8Array.from({ length: n }, () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return (t ^ (t >>> 14)) & 0xff;
    });
};

interface Seen {
  before: EditorState;
  after: string;
  intent: Intent;
}

function mount(doc: string, tracking: boolean, caret: number) {
  const parent = document.createElement('div');
  document.body.append(parent);
  const seen: Seen[] = [];
  const editor = createEditor(parent, {
    doc,
    author: { handle: 'ada', name: 'Ada Lovelace' },
    tracking,
    extensions: [
      editSourceFacet.of({ now: () => new Date('2026-11-17T10:00:30Z'), random: source() }),
      EditorView.updateListener.of((update) => {
        for (const tr of update.transactions) {
          const intent = intentOf(tr);
          if (intent) seen.push({ before: tr.startState, after: tr.state.doc.toString(), intent });
        }
      }),
    ],
  });
  open.push(editor);
  forceParsing(editor.view, editor.view.state.doc.length, 10_000);
  editor.view.dispatch({ selection: { anchor: caret } });
  seen.length = 0;
  return { editor, seen };
}

/** What the intent derives on the text it was made on, applied to that text. */
function derived(seen: Seen): string {
  const { before, intent } = seen;
  const text = before.doc.toString();
  switch (intent.kind) {
    case 'typing':
      return deriveIntent(before, intent).apply(before.doc).toString();
    case 'steps':
      return deriveSteps(before, intent).apply(before.doc).toString();
    case 'table':
      return applyChanges(text, deriveTable(text, intent).changes);
    case 'format':
      return applyChanges(text, deriveFormat(text, intent));
    case 'move':
      return deriveMove(before, intent).apply(before.doc).toString();
    case 'widened-paste':
      return applyChanges(text, deriveWidenedPaste(text, intent));
  }
}

const key = (editor: Editor, name: string) =>
  runScopeHandlers(
    editor.view,
    new KeyboardEvent('keydown', { key: name, bubbles: true }),
    'editor',
  );

function paste(editor: Editor, text: string) {
  const clipboardData = new DataTransfer();
  clipboardData.setData('text/plain', text);
  const event = new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true });
  plainPastes.delete(event);
  editor.view.contentDOM.dispatchEvent(event);
}

describe.each([true, false])('Backspace at the start of a quote, Track Changes %s', (tracking) => {
  it('records the block change, and deriving it gives the document', () => {
    const doc = '> quoted\n';
    const { editor, seen } = mount(doc, tracking, 2);
    key(editor, 'Backspace');
    const done = seen.filter((s) => s.intent.kind === 'format');
    expect(done).toHaveLength(1);
    expect(done[0]!.after).not.toBe(doc);
    expect(derived(done[0]!)).toBe(done[0]!.after);
  });
});

describe.each([true, false])('typing into a cell a row lacks, Track Changes %s', (tracking) => {
  it('records the fill, and deriving it gives the pipes and the text', () => {
    const doc = '| a | b |\n| - | - |\n| 1 |';
    const { editor, seen } = mount(doc, tracking, doc.length - 2);
    key(editor, 'Tab');
    seen.length = 0;
    editor.view.dispatch({
      changes: { from: editor.view.state.selection.main.head, insert: 'x' },
      userEvent: 'input.type',
    });
    const done = seen.filter((s) => s.intent.kind === 'table');
    expect(done).toHaveLength(1);
    const { intent } = done[0]!;
    expect(intent.kind === 'table' && intent.op.kind).toBe('fillCells');
    expect(done[0]!.after).toContain('x');
    expect(derived(done[0]!)).toBe(done[0]!.after);
  });
});

describe.each([true, false])('a paste over cells, Track Changes %s', (tracking) => {
  const doc = '| a | b |\n| - | - |\n| 1 | 2 |\n';

  it('records one typing intent when it only fills cells', () => {
    const { editor, seen } = mount(doc, tracking, doc.indexOf('1 |'));
    paste(editor, 'x\ty');
    expect(seen).toHaveLength(1);
    expect(seen[0]!.intent.kind).toBe('typing');
    expect(seen[0]!.after).not.toBe(doc);
    expect(derived(seen[0]!)).toBe(seen[0]!.after);
  });

  it('records the rows and columns it adds and the fill as steps', () => {
    const { editor, seen } = mount(doc, tracking, doc.indexOf('2 |'));
    paste(editor, 'p\tq\nr\ts');
    expect(seen).toHaveLength(1);
    const { intent } = seen[0]!;
    expect(intent.kind).toBe('steps');
    if (intent.kind === 'steps') {
      expect(intent.steps.map((s) => s.kind)).toEqual(['table', 'table', 'typing']);
    }
    expect(seen[0]!.after).toContain('q');
    expect(derived(seen[0]!)).toBe(seen[0]!.after);
  });
});
