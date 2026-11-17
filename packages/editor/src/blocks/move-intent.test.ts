// @vitest-environment happy-dom
// Moving blocks as intents (multiuser §4.2): a tracked move records the run and the gap it was
// made to, a move without tracking records the plain edits it made, and with the empty paragraph
// that Return opened, the change that took it back. Deriving the record again on the text it was
// made on gives the document the move made, ids and all; nothing in the document changes by
// recording (the same text with and without a listener).
import { forceParsing } from '@codemirror/language';
import { EditorView, runScopeHandlers } from '@codemirror/view';
import { newestView } from '@redlines/format';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createEditor,
  deriveMove,
  editSourceFacet,
  type Editor,
  type Intent,
  intentOf,
  moveBlocks,
} from '../index.ts';
import { deriveIntent } from '../tracked/typing.ts';
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

function mount(doc: string, tracking: boolean, caret: number, record = true) {
  const parent = document.createElement('div');
  document.body.append(parent);
  const seen: Seen[] = [];
  const editor = createEditor(parent, {
    doc,
    author: { handle: 'ada', name: 'Ada Lovelace' },
    tracking,
    extensions: [
      editSourceFacet.of({ now: () => new Date('2026-11-17T10:00:30Z'), random: source() }),
      ...(record
        ? [
            EditorView.updateListener.of((update) => {
              for (const tr of update.transactions) {
                const intent = intentOf(tr);
                if (intent) {
                  seen.push({ before: tr.startState, after: tr.state.doc.toString(), intent });
                }
              }
            }),
          ]
        : []),
    ],
  });
  open.push(editor);
  forceParsing(editor.view, editor.view.state.doc.length, 10_000);
  editor.view.dispatch({ selection: { anchor: caret } });
  seen.length = 0;
  return { editor, seen };
}

/** What the intent derives on the text it was made on, applied to that text. */
function derived({ before, intent }: Seen): string {
  if (intent.kind === 'move') return deriveMove(before, intent).apply(before.doc).toString();
  if (intent.kind === 'typing') return deriveIntent(before, intent).apply(before.doc).toString();
  throw new Error(`not a move: ${intent.kind}`);
}

const DOC = 'One.\n\nTwo.\n\nThree.\n';

describe.each([true, false])('⌥↓ on a paragraph, Track Changes %s', (tracking) => {
  it('records the move, and deriving it again gives the document', () => {
    const { editor, seen } = mount(DOC, tracking, 2);
    expect(moveBlocks(editor.view, false)).toBe(true);
    expect(seen).toHaveLength(1);
    const { intent } = seen[0]!;
    expect(intent.kind).toBe(tracking ? 'move' : 'typing');
    expect(seen[0]!.after).not.toBe(DOC);
    expect(derived(seen[0]!)).toBe(seen[0]!.after);
    expect(derived(seen[0]!)).toBe(derived(seen[0]!));
  });

  it('leaves the same text as a run that records nothing', () => {
    const recorded = mount(DOC, tracking, 2);
    moveBlocks(recorded.editor.view, false);
    const plain = mount(DOC, tracking, 2, false);
    moveBlocks(plain.editor.view, false);
    expect(recorded.editor.view.state.doc.toString()).toBe(plain.editor.view.state.doc.toString());
  });
});

describe('a tracked move', () => {
  it('keeps the author, the minute and the bytes of its ids', () => {
    const { editor, seen } = mount(DOC, true, 2);
    moveBlocks(editor.view, false);
    const { intent } = seen[0]!;
    if (intent.kind !== 'move') throw new Error('not a move');
    expect(intent.author.handle).toBe('ada');
    expect(intent.time).toBe('2026-11-17T10:00Z');
    expect(intent.drawn.length).toBeGreaterThan(0);
    expect(intent.run.count).toBe(1);
  });

  it('is written again on newer text, with the same ids, from the run and the gap there', () => {
    const { editor, seen } = mount(DOC, true, 2);
    moveBlocks(editor.view, false);
    const { intent, before } = seen[0]!;
    if (intent.kind !== 'move') throw new Error('not a move');
    // Another person added a paragraph at the end meanwhile: the run and the gap stand where they were.
    const newer = `${before.doc.toString()}\nFour.\n`;
    const then = deriveMove(before, intent).apply(before.doc).toString();
    const now = deriveMove(
      before.update({ changes: { from: before.doc.length, insert: '\nFour.\n' } }).state,
      intent,
    )
      .apply(before.update({ changes: { from: before.doc.length, insert: '\nFour.\n' } }).state.doc)
      .toString();
    const ids = (text: string) => [...text.matchAll(/<!--(?:ins|del) (\w+)/g)].map((m) => m[1]);
    expect(newer).toContain('Four.');
    expect(ids(now)).toEqual(ids(then));
    expect(newestView(now).text).toBe(
      `${newestView(then).text}\nFour.\n`.replace('\n\n\nFour', '\n\nFour'),
    );
  });
});

describe.each([true, false])('⌥↑ after Return opened a paragraph, Track Changes %s', (tracking) => {
  it('records the move with the paragraph taken back, and derives the document', () => {
    const doc = 'One.\n\nTwo.\n\nThree.\n';
    const { editor, seen } = mount(doc, tracking, doc.indexOf('Two.'));
    expect(runScopeHandlers(editor.view, key('Enter'), 'editor')).toBe(true);
    seen.length = 0;
    expect(moveBlocks(editor.view, true)).toBe(true);
    const done = seen.filter((s) => s.intent.kind === 'move' || s.intent.kind === 'typing');
    expect(done).toHaveLength(1);
    const { intent } = done[0]!;
    expect(intent.kind === 'move' || intent.kind === 'typing').toBe(true);
    if (intent.kind === 'move' || intent.kind === 'typing') {
      expect(intent.revert?.length ?? 0).toBeGreaterThan(0);
    }
    expect(derived(done[0]!)).toBe(done[0]!.after);
  });
});

function key(name: string) {
  return new KeyboardEvent('keydown', { key: name, bubbles: true });
}
