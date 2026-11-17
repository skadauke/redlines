// @vitest-environment happy-dom
// Review actions as intents (multiuser §4.2, §4.4): a comment, a highlight, a reply, resolve and
// reopen and a decision are recorded with what was asked, and deriving the record gives what the
// first time wrote. A decision carries the mark as the person saw it, and on newer text it is not
// applied to a mark that changed or is gone.
import { EditorView } from '@codemirror/view';
import { accept, acceptMarks, applyChanges, reject, rejectMarks } from '@redlines/format';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type Editor } from '../index.ts';
import { intentOf } from './intent.ts';
import type { ReviewIntent, ReviewRequest } from './review-intent.ts';
import { deriveReview, writeReview } from './review-intent.ts';

const ada = { handle: 'ada', name: 'Ada Lovelace' };
const time = '2026-11-17T10:00Z';

/** A source with a stream of its own, to give ids that differ. */
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

const ledger = (marks: string, extra = '') =>
  `\n\n<!-- redlines\nversion: 1\npeople:\n  bo: {name: Bo Chen}\nmarks:\n${marks}${extra}-->\n`;

const doc =
  `One <!--ins b2b2-->two<!--/b2b2--> three <!--ins c3c3-->four<!--/c3c3--> five.` +
  ledger(
    '  b2b2: {by: bo, at: 2026-10-31T09:30Z}\n  c3c3: {by: bo, at: 2026-10-31T09:31Z}\n',
    'comments:\n  d4d4:\n    by: bo\n    at: 2026-10-31T09:30Z\n    text: |-\n      Why?\n',
  );

const PLAIN = { from: doc.indexOf('five'), to: doc.indexOf('five') + 4 };

const written = (request: ReviewRequest, text = doc) =>
  writeReview(text, request, { author: ada, time, random: source() });

const again = (made: ReturnType<typeof written>, text = doc) =>
  deriveReview(text, { ...made.intent, id: 'x' } satisfies ReviewIntent);

describe('writing a review action and deriving it again', () => {
  it.each([
    ['a comment', { op: 'comment', range: PLAIN, body: 'Check this.' }],
    ['a highlight', { op: 'highlight', range: PLAIN }],
    ['one decision', { op: 'decide', decision: 'accept', ids: ['b2b2'] }],
    ['a rejection', { op: 'decide', decision: 'reject', ids: ['b2b2'] }],
    ['two decisions', { op: 'decide', decision: 'accept', ids: ['b2b2', 'c3c3'], many: true }],
    ['one of many decisions', { op: 'decide', decision: 'reject', ids: ['c3c3'], many: true }],
  ] as [string, ReviewRequest][])('%s gives the same changes the second time', (_, request) => {
    const made = written(request);
    expect(made.changes.length).toBeGreaterThan(0);
    const derived = again(made);
    expect(derived.ok && derived.changes).toEqual(made.changes);
    expect(derived.ok && derived.id).toBe(made.id);
  });

  it('replies, resolves and reopens', () => {
    const replied = written({ op: 'reply', thread: 'd4d4', body: 'Because.' });
    expect(replied.changes.length).toBeGreaterThan(0);
    const afterReply = applyChanges(doc, replied.changes);
    const resolved = written({ op: 'resolve', thread: 'd4d4' }, afterReply);
    const reopened = written(
      { op: 'reopen', thread: 'd4d4' },
      applyChanges(afterReply, resolved.changes),
    );
    for (const [made, text] of [
      [replied, doc],
      [resolved, afterReply],
      [reopened, applyChanges(afterReply, resolved.changes)],
    ] as const) {
      const derived = again(made, text);
      expect(derived.ok && derived.changes).toEqual(made.changes);
    }
  });

  it('writes what the format writes for a decision', () => {
    expect(written({ op: 'decide', decision: 'accept', ids: ['b2b2'] }).changes).toEqual(
      accept(doc, 'b2b2'),
    );
    expect(written({ op: 'decide', decision: 'reject', ids: ['b2b2'] }).changes).toEqual(
      reject(doc, 'b2b2'),
    );
    expect(
      written({ op: 'decide', decision: 'accept', ids: ['b2b2', 'c3c3'], many: true }).changes,
    ).toEqual(acceptMarks(doc, ['b2b2', 'c3c3']));
  });
});

describe('the guard on a decision', () => {
  const made = written({ op: 'decide', decision: 'accept', ids: ['b2b2'] });

  it('carries the mark as it was seen', () => {
    const op = made.intent.op;
    expect(op.op === 'decide' && op.seen).toHaveLength(1);
    expect(op.op === 'decide' && op.seen[0]).toContain('<!--ins b2b2-->two<!--/b2b2-->');
  });

  it('applies on newer text where the mark is as it was seen', () => {
    const newer = doc.replace('five.', 'five and more.');
    const derived = again(made, newer);
    expect(derived.ok).toBe(true);
  });

  it('is not applied to a mark that changed since', () => {
    // Bo extended his insertion after it was seen.
    const newer = doc.replace(
      '<!--ins b2b2-->two<!--/b2b2-->',
      '<!--ins b2b2-->two more<!--/b2b2-->',
    );
    expect(again(made, newer)).toEqual({ ok: false, reason: 'changed', id: 'b2b2' });
  });

  it('is not applied to a mark that is gone', () => {
    // Someone else accepted it.
    const newer = applyChanges(doc, accept(doc, 'b2b2'));
    expect(again(made, newer)).toEqual({ ok: false, reason: 'gone', id: 'b2b2' });
  });

  it('names the first mark of several that changed', () => {
    const several = written({
      op: 'decide',
      decision: 'accept',
      ids: ['b2b2', 'c3c3'],
      many: true,
    });
    const newer = doc.replace('<!--ins c3c3-->four', '<!--ins c3c3-->four!');
    expect(again(several, newer)).toEqual({ ok: false, reason: 'changed', id: 'c3c3' });
  });
});

describe('in the editor', () => {
  const open: Editor[] = [];
  afterEach(() => {
    for (const editor of open.splice(0)) editor.destroy();
    document.body.replaceChildren();
  });

  function mount() {
    const parent = document.createElement('div');
    document.body.append(parent);
    const seen: { before: string; intent: ReviewIntent; changes: number }[] = [];
    const editor = createEditor(parent, {
      doc,
      author: ada,
      tracking: false,
      extensions: [
        EditorView.updateListener.of((update) => {
          for (const tr of update.transactions) {
            const intent = intentOf(tr);
            if (intent?.kind === 'review') {
              seen.push({
                before: tr.startState.doc.toString(),
                intent,
                changes: tr.changes.length,
              });
            }
          }
        }),
      ],
    });
    open.push(editor);
    return { editor, seen };
  }

  it('records Accept with the mark as seen, and deriving it gives the same document', () => {
    const { editor, seen } = mount();
    editor.accept('b2b2');
    expect(seen).toHaveLength(1);
    const { before, intent } = seen[0]!;
    expect(intent.op.op === 'decide' && intent.op.decision).toBe('accept');
    const derived = deriveReview(before, intent);
    expect(derived.ok && applyChanges(before, derived.changes)).toBe(editor.getDoc());
  });

  it('records Reject of several, as the same step', () => {
    const { editor, seen } = mount();
    editor.reject(['b2b2', 'c3c3']);
    expect(seen).toHaveLength(1);
    const op = seen[0]!.intent.op;
    expect(op.op === 'decide' && op.ids).toEqual(['b2b2', 'c3c3']);
    expect(editor.getDoc()).toBe(applyChanges(doc, rejectMarks(doc, ['b2b2', 'c3c3'])));
  });
});
