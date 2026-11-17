// The oracle has to see what it is there to see: each test feeds it a state or a step that is wrong
// in one way.

import { applyChanges } from '@redlines/format';
import { expect, test } from 'vitest';
import { derive } from './intents.ts';
import type { Intent, Summary } from './intents.ts';
import { Oracle } from './oracle.ts';
import { baseDocument } from './text.ts';

const oracle = () => new Oracle({ render: true });
const intent = (author: string, seed: number, body: Intent['body']): Intent => ({
  id: `${author}-${seed}`,
  author: { handle: author, name: author },
  time: '2026-11-16T09:00Z',
  seed,
  at: 0,
  body,
});
const summary = (extra: Partial<Summary>): Summary => ({
  kind: 'type',
  author: 'bo',
  removes: [],
  adds: [],
  ...extra,
});

const base = baseDocument(1, 6);

function step(text: string, body: Intent['body'], who = 'bo') {
  const derived = derive(text, intent(who, 1, body));
  if (!derived.ok) throw new Error(derived.reason);
  return { derived, after: applyChanges(text, derived.changes) };
}

test('a clean typing step and its state pass', () => {
  const { derived, after } = step(base, {
    kind: 'type',
    anchors: [{ token: 'u003', side: 'after' }],
    words: ['eb000'],
  });
  const o = oracle();
  expect(o.step(1, base, after, derived.summary)).toEqual([]);
  expect(o.state(1, after)).toEqual([]);
});

test('text that vanishes is lost, and text deleted beyond the intent is swallowed', () => {
  const { derived, after } = step(base, { kind: 'delete', tokens: ['u003', 'u004'] });
  const o = oracle();
  expect(o.step(1, base, after, derived.summary)).toEqual([]);
  const wrong = summary({ kind: 'delete', removes: ['u003'] });
  expect(o.step(1, base, after, wrong).map((v) => v.code)).toContain('swallowed');
  const revived = base.replace('u003 ', 'u003 u999 ');
  expect(o.step(1, base, revived, summary({ kind: 'bold' })).map((v) => v.code)).toContain(
    'revived',
  );
  const gone = base.replace(' u005', '');
  expect(o.step(1, base, gone, summary({ kind: 'type' })).map((v) => v.code)).toContain('lost');
  expect(
    o.step(1, base, gone, summary({ kind: 'delete', removes: ['u003'] })).map((v) => v.code),
  ).toContain('swallowed');
});

test('a deletion that did not happen is dropped', () => {
  const o = oracle();
  const found = o.step(1, base, base, summary({ kind: 'delete', removes: ['u003'] }));
  expect(found.map((v) => v.code)).toEqual(['dropped']);
});

test('an edit with no mark leaves the original changed, which is untracked', () => {
  const o = oracle();
  const after = base.replace('u003 ', 'u003 eb000 ');
  const found = o.step(1, base, after, summary({ adds: ['eb000'] }));
  expect(found.map((v) => v.code)).toEqual(['untracked']);
});

test('a decision may move only the words of its mark', () => {
  const typed = step(base, {
    kind: 'type',
    anchors: [{ token: 'u003', side: 'after' }],
    words: ['eb000'],
  });
  const id = /<!--ins (\w+)-->/.exec(typed.after)?.[1] ?? '';
  const seen = /<!--ins \w+-->[^]*?<!--\/\w+-->/.exec(typed.after)?.[0] ?? '';
  expect(seen).not.toBe('');
  const accepted = step(typed.after, {
    kind: 'decide',
    mark: id,
    decision: 'accept',
    seen: `ins|bo|${seen}`,
  });
  const o = oracle();
  expect(o.step(2, typed.after, accepted.after, accepted.derived.summary)).toEqual([]);
  // The same text with a word taken from the original too.
  const bad = accepted.after.replace('u005 ', '');
  expect(o.step(2, typed.after, bad, accepted.derived.summary).map((v) => v.code)).toContain(
    'decision',
  );
});

test('broken markup and a missing ledger entry are caught', () => {
  const o = oracle();
  const { after } = step(base, {
    kind: 'type',
    anchors: [{ token: 'u003', side: 'after' }],
    words: ['eb000'],
  });
  const unclosed = after.replace(/<!--\/\w+-->/, '');
  expect(o.state(1, unclosed).map((v) => v.code)).toContain('markup');
  const noEntry = after.replace(/ {2}\w{4}: \{by: bo[^\n]*\n/, '');
  expect(o.state(1, noEntry).map((v) => v.code)).toContain('markup');
});

test("a word typed by one person in another one's change is misattributed", () => {
  const { after } = step(base, {
    kind: 'type',
    anchors: [{ token: 'u003', side: 'after' }],
    words: ['eb000'],
  });
  const o = oracle();
  expect(o.state(1, after)).toEqual([]);
  expect(o.state(1, after.replace('eb000', 'ea000')).map((v) => v.code)).toContain('misattributed');
});

test('a duplicated word is caught in the newest view', () => {
  const o = oracle();
  expect(o.state(1, base.replace('u004', 'u003')).map((v) => v.code)).toContain('duplicated');
});

test('comments and replies must be in the ledger exactly once', () => {
  const o = oracle();
  const comment = step(base, { kind: 'comment', tokens: ['u003'], anchors: [], note: 'nb000' });
  expect(o.step(1, base, comment.after, comment.derived.summary)).toEqual([]);
  const replied = step(comment.after, { kind: 'reply', note: 'nb000', body: 'rb000' }, 'cy');
  expect(o.step(2, comment.after, replied.after, replied.derived.summary)).toEqual([]);
  expect(o.state(2, replied.after)).toEqual([]);
  // The state before the reply is missing it.
  expect(o.state(2, comment.after).map((v) => v.code)).toContain('ledger');
});
