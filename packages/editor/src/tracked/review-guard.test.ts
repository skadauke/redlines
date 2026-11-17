// @vitest-environment happy-dom
// The review guard in the editor (multiuser §4.4): a decision carries the marks as seen; on a mark
// that changed or is gone it is not applied, and says why in the reviewer's words. Accept All
// carries the ids of the click. Whatever the order of other people's decisions, the bytes agree
// (docs/hardening.md), and one person's decisions write what they always wrote.
import { forceParsing } from '@codemirror/language';
import { Transaction } from '@codemirror/state';
import { acceptAll, accept, applyChanges, parse, reject } from '@redlines/format';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type Editor } from '../index.ts';
import { recordedAs } from './intent.ts';
import type { ReviewIntent } from './review-intent.ts';
import { deriveReview, guardDecision, seenOf, writeReview } from './review-intent.ts';

const ada = { handle: 'ada', name: 'Ada Lovelace' };
const cy = { handle: 'cy', name: 'Cy Young' };
const time = '2026-11-17T10:00Z';

const ledger = (marks: string) =>
  `\n\n<!-- redlines\nversion: 1\npeople:\n  bo: {name: Bo Chen}\nmarks:\n${marks}-->\n`;

const doc =
  `One <!--ins b2b2-->two<!--/b2b2--> three <!--del c3c3-->four<!--/c3c3--> five ` +
  `<!--ins d4d4-->six<!--/d4d4--> seven.` +
  ledger(
    '  b2b2: {by: bo, at: 2026-10-31T09:30Z}\n' +
      '  c3c3: {by: bo, at: 2026-10-31T09:31Z}\n' +
      '  d4d4: {by: bo, at: 2026-10-31T09:32Z}\n',
  );
const IDS = ['b2b2', 'c3c3', 'd4d4'];

const decision = (
  text: string,
  how: 'accept' | 'reject',
  ids: string[],
  by: typeof ada = ada,
  bulk = false,
): ReviewIntent => {
  const made = writeReview(
    text,
    { op: 'decide', decision: how, ids, ...(bulk ? { bulk: true as const } : {}) },
    { author: by, time },
  );
  return { ...made.intent, id: `${by.handle}-${how}-${ids.join('')}` };
};

/** Applies intents one after another, each on the text the last left, and returns the text. */
function applyAll(text: string, intents: readonly ReviewIntent[]): string {
  let now = text;
  for (const intent of intents) {
    const derived = deriveReview(now, intent);
    if (derived.ok) now = applyChanges(now, derived.changes);
  }
  return now;
}

const permutations = <T>(items: readonly T[]): T[][] =>
  items.length <= 1
    ? [[...items]]
    : items.flatMap((item, i) =>
        permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]),
      );

describe('decisions in every order', () => {
  it('on different marks, give the same bytes in every order', () => {
    const intents = [
      decision(doc, 'accept', ['b2b2']),
      decision(doc, 'reject', ['c3c3'], cy),
      decision(doc, 'accept', ['d4d4'], cy),
    ];
    const results = new Set(permutations(intents).map((order) => applyAll(doc, order)));
    expect(results.size).toBe(1);
    const [only] = [...results];
    expect(parse(only!).marks).toHaveLength(0);
  });

  it('a click of Accept All and a person deciding one mark agree in any order', () => {
    const all = decision(doc, 'accept', IDS, cy, true);
    const one = decision(doc, 'reject', ['c3c3']);
    const results = permutations([all, one]).map((order) => applyAll(doc, order));
    // Rejecting c3c3 first leaves the click to accept the others; Accept All first accepts it,
    // and the rejection finds it gone. Either way, every mark is decided once.
    for (const text of results) expect(parse(text).marks).toHaveLength(0);
    expect(results[0]).toBe(applyAll(doc, [one, all]));
  });

  it('on one mark: the first decision wins, whoever it is', () => {
    const a = decision(doc, 'accept', ['b2b2']);
    const r = decision(doc, 'reject', ['b2b2'], cy);
    const aThenR = applyAll(doc, [a, r]);
    const rThenA = applyAll(doc, [r, a]);
    expect(aThenR).toBe(applyAll(doc, [a]));
    expect(rThenA).toBe(applyAll(doc, [r]));
    expect(deriveReview(aThenR, r)).toEqual({ ok: false, reason: 'gone', id: 'b2b2' });
  });
});

describe('Accept All carries the ids of the click', () => {
  it('writes what Accept All always wrote', () => {
    const made = writeReview(
      doc,
      { op: 'decide', decision: 'accept', ids: IDS, bulk: true },
      { author: ada, time },
    );
    expect(made.changes).toEqual(acceptAll(doc));
  });

  it('leaves out a mark that changed, and decides the rest', () => {
    const click = decision(doc, 'accept', IDS, ada, true);
    const newer = doc.replace('<!--ins d4d4-->six', '<!--ins d4d4-->six!');
    const derived = deriveReview(newer, click);
    expect(derived.ok && derived.skipped).toEqual([{ id: 'd4d4', reason: 'changed' }]);
    const text = derived.ok ? applyChanges(newer, derived.changes) : '';
    expect(parse(text).marks.map((mark) => mark.id)).toEqual(['d4d4']);
  });

  it('does not decide a mark added after the click', () => {
    const click = decision(doc, 'accept', ['b2b2', 'c3c3'], ada, true);
    const text = applyAll(doc, [click]);
    expect(parse(text).marks.map((mark) => mark.id)).toEqual(['d4d4']);
  });

  it('leaves out a mark that is gone, and says nothing is left when none stands', () => {
    const click = decision(doc, 'accept', ['b2b2', 'c3c3'], ada, true);
    const newer = applyAll(doc, [decision(doc, 'accept', ['b2b2'], cy)]);
    const derived = deriveReview(newer, click);
    expect(derived.ok && derived.skipped).toEqual([{ id: 'b2b2', reason: 'gone' }]);
    const none = applyAll(doc, [decision(doc, 'accept', ['b2b2', 'c3c3'], cy, true)]);
    expect(deriveReview(none, click)).toMatchObject({ ok: false, reason: 'gone' });
  });

  it('leaves a whole group out when one of its marks changed', () => {
    const grouped = doc
      .replace(
        'b2b2: {by: bo, at: 2026-10-31T09:30Z}',
        'b2b2: {by: bo, at: 2026-10-31T09:30Z, group: g1}',
      )
      .replace(
        'c3c3: {by: bo, at: 2026-10-31T09:31Z}',
        'c3c3: {by: bo, at: 2026-10-31T09:31Z, group: g1}',
      );
    const click = decision(grouped, 'accept', IDS, ada, true);
    const newer = grouped.replace('<!--ins b2b2-->two', '<!--ins b2b2-->two!');
    const derived = guardDecision(newer, click.op as never);
    expect(derived.apply).toEqual(['d4d4']);
    expect(derived.skipped.map((one) => one.id).sort()).toEqual(['b2b2', 'c3c3']);
  });
});

describe('in the editor', () => {
  const open: Editor[] = [];
  afterEach(() => {
    for (const editor of open.splice(0)) editor.destroy();
    document.body.replaceChildren();
  });

  function mount(text = doc): Editor {
    const parent = document.createElement('div');
    document.body.append(parent);
    const editor = createEditor(parent, { doc: text, author: ada, tracking: false });
    forceParsing(editor.view, editor.view.state.doc.length, 5000);
    open.push(editor);
    return editor;
  }

  /** Another window's edit: text changed under the reviewer, not a step of this person's. */
  const remote = (editor: Editor, from: number, to: number, insert: string) =>
    editor.view.dispatch({
      changes: { from, to, insert },
      annotations: [Transaction.remote.of(true), Transaction.addToHistory.of(false)],
    });

  it('one person: accept, reject and Accept All write what they always wrote', () => {
    const one = mount();
    one.accept('b2b2');
    expect(one.getDoc()).toBe(applyChanges(doc, accept(doc, 'b2b2')));
    const two = mount();
    two.reject('c3c3');
    expect(two.getDoc()).toBe(applyChanges(doc, reject(doc, 'c3c3')));
    const three = mount();
    three.view.dispatch({ selection: { anchor: 0 } });
    expect(three.getUiState().acceptAllCount).toBe(3);
    three.acceptAllAndStopTracking();
    expect(three.getDoc()).toBe(applyChanges(doc, acceptAll(doc)));
  });

  it('says who changed a suggestion that was changed since it was seen', () => {
    const editor = mount();
    const seen = editor.seenOf(['b2b2']);
    const at = editor.view.state.doc.toString().indexOf('two<!--/b2b2-->') + 3;
    remote(editor, at, at, ' more');
    const before = editor.getDoc();
    const outcome = editor.decideSeen('accept', ['b2b2'], seen);
    expect(outcome.applied).toEqual([]);
    expect(outcome.skipped).toMatchObject([
      {
        id: 'b2b2',
        reason: 'changed',
        message: 'Bo Chen changed this suggestion. Review it again.',
      },
    ]);
    expect(editor.getDoc()).toBe(before);
    // Looked at again, it is decided.
    expect(editor.decideSeen('accept', ['b2b2'], editor.seenOf(['b2b2'])).applied).toEqual([
      'b2b2',
    ]);
  });

  it('says who decided a mark that is gone', () => {
    const editor = mount();
    const seen = editor.seenOf(['b2b2']);
    editor.noteDecided('b2b2', 'Cy Young', 'accept');
    const text = editor.view.state.doc.toString();
    const decided = applyChanges(text, accept(text, 'b2b2'));
    editor.view.dispatch({
      changes: { from: 0, to: text.length, insert: decided },
      annotations: [Transaction.remote.of(true), Transaction.addToHistory.of(false)],
    });
    const outcome = editor.decideSeen('reject', ['b2b2'], seen);
    expect(outcome.skipped[0]?.message).toBe('Cy Young accepted this a moment ago.');
  });

  it('notes a decision applied from another window by its intent', () => {
    const editor = mount();
    const seen = editor.seenOf(['b2b2']);
    const theirs = writeReview(
      editor.getDoc(),
      { op: 'decide', decision: 'reject', ids: ['b2b2'] },
      { author: cy, time },
    );
    editor.view.dispatch({
      changes: theirs.changes,
      annotations: [Transaction.remote.of(true), recordedAs(theirs.intent)],
    });
    expect(editor.decideSeen('accept', ['b2b2'], seen).skipped[0]?.message).toBe(
      'Cy Young rejected this a moment ago.',
    );
  });

  it('keeps no stale record when a decision is undone', () => {
    const editor = mount();
    const seen = editor.seenOf(['b2b2']);
    editor.accept('b2b2');
    expect(editor.getDoc()).not.toContain('b2b2');
    editor.undo();
    expect(editor.getDoc()).toBe(doc);
    // The mark is back and is decided as seen: nothing says it was decided.
    const again = editor.decideSeen('reject', ['b2b2'], seen);
    expect(again.applied).toEqual(['b2b2']);
    // Gone for another reason, it is only gone: Ada's accepted-and-undone is not remembered.
    editor.undo();
    const text = editor.getDoc();
    remote(editor, 0, text.length, text.replace('<!--ins b2b2-->two<!--/b2b2-->', 'two'));
    expect(editor.decideSeen('accept', ['b2b2'], seen).skipped[0]?.message).toBe(
      'This change is gone.',
    );
  });

  it('Accept All, undone in one step, gives the changes and Track Changes back', () => {
    const editor = mount();
    editor.view.dispatch({ selection: { anchor: 0 } });
    editor.setTracking(true, { inFile: false });
    expect(editor.acceptAllAndStopTracking()).toBe(true);
    expect(editor.getUiState()).toMatchObject({ tracking: false, acceptAllCount: 0 });
    editor.undo();
    expect(editor.getDoc()).toBe(doc);
    expect(editor.getUiState()).toMatchObject({ tracking: true, acceptAllCount: 3 });
  });

  it('seenOf is what a decision carries', () => {
    expect(seenOf(doc, ['b2b2', 'nope'])[1]).toBe('');
    expect(mount().seenOf(['b2b2'])).toEqual(seenOf(doc, ['b2b2']));
  });
});
