// @vitest-environment happy-dom
// The review plugin's comment, highlight, reply, resolve and reopen record an intent beside what
// the format wrote (multiuser §4.2), take the editor's clock and source when it has them, and
// leave the document as it was.
import { EditorView } from '@codemirror/view';
import {
  createEditor,
  editSourceFacet,
  intentOf,
  type ReviewIntent,
  deriveReview,
} from '@redlines/editor';
import { applyChanges, EditError } from '@redlines/format';
import { afterEach, describe, expect, it } from 'vitest';
import { applyReview } from './shared.ts';

const ada = { handle: 'ada', name: 'Ada Lovelace' };
const open: (() => void)[] = [];
afterEach(() => {
  for (const close of open.splice(0)) close();
  document.body.replaceChildren();
});

/** A seeded source of random bytes, so that ids can be written again. */
function source() {
  let a = 20261117;
  return (n: number) =>
    Uint8Array.from({ length: n }, () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return (t ^ (t >>> 14)) & 0xff;
    });
}

function mount(doc: string, tracking = false) {
  const parent = document.createElement('div');
  document.body.append(parent);
  const seen: { before: string; intent: ReviewIntent }[] = [];
  const editor = createEditor(parent, {
    doc,
    author: ada,
    tracking,
    extensions: [
      editSourceFacet.of({ now: () => new Date('2026-11-17T09:41:30Z'), random: source() }),
      EditorView.updateListener.of((update) => {
        for (const tr of update.transactions) {
          const intent = intentOf(tr);
          if (intent?.kind === 'review') {
            seen.push({ before: tr.startState.doc.toString(), intent });
          }
        }
      }),
    ],
  });
  open.push(() => editor.destroy());
  return { editor, seen };
}

describe('review actions of the plugin', () => {
  const text = 'One two three.\n';

  it('record a comment, with the editor’s clock, and derive to the same document', () => {
    const { editor, seen } = mount(text);
    const id = applyReview(
      editor.view,
      ada,
      { op: 'comment', range: { from: 4, to: 7 }, body: 'Why?' },
      'review.comment',
    );
    expect(id).toMatch(/^[bcdfghjkmnpqrstvwxz][2-9bcdfghjkmnpqrstvwxz]{3}$/);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.intent.time).toBe('2026-11-17T09:41Z');
    expect(editor.getDoc()).toContain('2026-11-17T09:41Z');
    const { before, intent } = seen[0]!;
    const derived = deriveReview(before, intent);
    expect(derived.ok && applyChanges(before, derived.changes)).toBe(editor.getDoc());
  });

  it('record a reply, a resolve and a reopen, each derived to its own step', () => {
    const { editor, seen } = mount(text);
    const id = applyReview(
      editor.view,
      ada,
      { op: 'comment', range: { from: 4, to: 7 }, body: 'Why?' },
      'review.comment',
    )!;
    applyReview(editor.view, ada, { op: 'reply', thread: id, body: 'Because.' }, 'review.reply');
    applyReview(editor.view, ada, { op: 'resolve', thread: id }, 'review.resolve');
    applyReview(editor.view, ada, { op: 'reopen', thread: id }, 'review.reopen');
    expect(seen.map((one) => one.intent.op.op)).toEqual(['comment', 'reply', 'resolve', 'reopen']);
    for (const { before, intent } of seen) {
      const derived = deriveReview(before, intent);
      expect(derived.ok && derived.changes.length).toBeGreaterThan(0);
    }
  });

  it('record a highlight', () => {
    const { editor, seen } = mount(text);
    applyReview(
      editor.view,
      ada,
      { op: 'highlight', range: { from: 4, to: 7 } },
      'review.highlight',
    );
    expect(seen[0]!.intent.op.op).toBe('highlight');
  });

  it('change nothing and record nothing when the format has nothing to do', () => {
    const { editor, seen } = mount(text);
    const id = applyReview(
      editor.view,
      ada,
      { op: 'comment', range: { from: 4, to: 7 }, body: 'Why?' },
      'review.comment',
    )!;
    const doc = editor.getDoc();
    // Reopening a thread that is not resolved is a no-op.
    applyReview(editor.view, ada, { op: 'reopen', thread: id }, 'review.reopen');
    expect(editor.getDoc()).toBe(doc);
    expect(seen).toHaveLength(1);
  });

  it('says what the format refuses, as an EditError, and records nothing', () => {
    const { editor, seen } = mount(text);
    expect(() =>
      applyReview(
        editor.view,
        ada,
        { op: 'reply', thread: 'zzzz', body: 'Nobody there.' },
        'review.reply',
      ),
    ).toThrow(EditError);
    expect(seen).toHaveLength(0);
  });

  it('decide with Track Changes on', () => {
    const { editor, seen } = mount(text, true);
    editor.view.dispatch({
      changes: { from: 3, to: 3, insert: ' new' },
      userEvent: 'input.type',
    });
    const mark = /<!--ins (\w+)-->/.exec(editor.getDoc())![1]!;
    editor.accept(mark);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.intent.op.op === 'decide' && seen[0]!.intent.op.ids).toEqual([mark]);
  });
});
