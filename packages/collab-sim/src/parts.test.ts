import { applyChanges, trackedEdits } from '@redlines/format';
import type { TextChange } from '@redlines/format';
import { expect, test } from 'vitest';
import { Authority } from './authority.ts';
import type { Push } from './authority.ts';
import { footprintOf, mapChanges, mapPos, overlapAny } from './footprint.ts';
import { derive } from './intents.ts';
import type { Intent } from './intents.ts';
import { Clock, DEFAULT_NET, Link } from './net.ts';
import { Rng } from './rng.ts';
import { baseDocument, joined, tokenRanges } from './text.ts';

const intent = (author: string, seed: number, body: Intent['body']): Intent => ({
  id: `${author}-${seed}`,
  author: { handle: author, name: author },
  time: '2026-11-16T09:00Z',
  seed,
  at: 0,
  body,
});

test('the first text has unique tokens, and a typed token names its author', () => {
  const text = baseDocument(3, 5);
  const tokens = tokenRanges(text).map((t) => t.token);
  expect(new Set(tokens).size).toBe(tokens.length);
  expect(tokens).toHaveLength(2 + 15);
  expect(joined('u001u002 u003')).toEqual(['u001u002']);
});

test('the same seed draws the same numbers, and forks are apart', () => {
  const a = new Rng(5);
  const b = new Rng(5);
  expect([a.next(), a.int(100)]).toEqual([b.next(), b.int(100)]);
  expect(new Rng(5).fork().next()).not.toBe(new Rng(6).fork().next());
});

test('the same intent over the same text gives the same changes, with new ids each time it is new', () => {
  const text = baseDocument(2, 6);
  const body: Intent['body'] = { kind: 'delete', tokens: ['u003', 'u004'] };
  const a = derive(text, intent('ada', 1, body));
  const b = derive(text, intent('ada', 1, body));
  expect(a).toEqual(b);
  const c = derive(text, intent('ada', 2, body));
  expect(JSON.stringify(c)).not.toBe(JSON.stringify(a));
});

test('a deletion takes only the words asked for, even when someone typed between them', () => {
  let text = baseDocument(1, 6);
  const typed = derive(
    text,
    intent('bo', 1, {
      kind: 'type',
      anchors: [{ token: 'u003', side: 'after' }],
      words: ['eb000'],
    }),
  );
  if (!typed.ok) throw new Error(typed.reason);
  text = applyChanges(text, typed.changes);
  const deleted = derive(text, intent('ada', 2, { kind: 'delete', tokens: ['u003', 'u004'] }));
  if (!deleted.ok) throw new Error(deleted.reason);
  expect(deleted.summary.removes).toEqual(['u003', 'u004']);
  const after = applyChanges(text, deleted.changes);
  expect(after).toContain('eb000');
});

test('a decision is dropped when the mark is not as the person saw it', () => {
  let text = baseDocument(1, 6);
  const first = derive(
    text,
    intent('bo', 1, {
      kind: 'type',
      anchors: [{ token: 'u003', side: 'after' }],
      words: ['eb000'],
    }),
  );
  if (!first.ok) throw new Error(first.reason);
  text = applyChanges(text, first.changes);
  const id = /<!--ins (\w+)-->/.exec(text)?.[1] ?? '';
  const stale = intent('ada', 2, {
    kind: 'decide',
    mark: id,
    decision: 'accept',
    seen: 'ins|bo|x',
  });
  expect(derive(text, stale)).toEqual({ ok: false, reason: 'guard' });
  expect(derive(text, stale, { guard: false }).ok).toBe(true);
});

test('footprints take in whole marks and the visible characters beside them', () => {
  let text = baseDocument(1, 6);
  const typed = derive(
    text,
    intent('bo', 1, {
      kind: 'type',
      anchors: [{ token: 'u003', side: 'after' }],
      words: ['eb000'],
    }),
  );
  if (!typed.ok) throw new Error(typed.reason);
  text = applyChanges(text, typed.changes);
  const at = text.indexOf('eb000') + 2;
  const { changes } = trackedEdits(text, [{ from: at, to: at, insert: 'x' }], {
    author: { handle: 'bo', name: 'Bo' },
    time: '2026-11-16T09:01Z',
  });
  const fp = footprintOf(text, changes);
  const mark = text.indexOf('<!--ins');
  expect(fp.body[0]?.from).toBeLessThanOrEqual(mark);
  expect(fp.body[0]?.to).toBeGreaterThanOrEqual(text.indexOf('<!--/') + 5);
  // Extending one's own insertion needs no new ledger entry.
  expect(fp.ledger).toEqual([]);
});

test('positions map through changes, and touching ranges overlap', () => {
  const through: TextChange[] = [
    { from: 2, to: 2, insert: 'abc' },
    { from: 10, to: 12, insert: '' },
  ];
  expect(mapPos(1, through, 1)).toBe(1);
  expect(mapPos(2, through, -1)).toBe(2);
  expect(mapPos(2, through, 1)).toBe(5);
  expect(mapPos(8, through, 1)).toBe(11);
  expect(mapPos(14, through, 1)).toBe(15);
  expect(mapChanges([{ from: 5, to: 6, insert: 'x' }], through)).toEqual([
    { from: 8, to: 9, insert: 'x' },
  ]);
  expect(overlapAny([{ from: 1, to: 3 }], [{ from: 3, to: 5 }])).toBe(true);
  expect(overlapAny([{ from: 1, to: 2 }], [{ from: 3, to: 5 }])).toBe(false);
});

function pushOf(base: number, text: string, edit: TextChange, id: string): Push {
  const { changes } = trackedEdits(text, [edit], {
    author: { handle: id, name: id },
    time: '2026-11-16T09:00Z',
    random: (n) => new Rng(id.charCodeAt(0)).bytes(n),
  });
  return {
    clientId: id,
    pushId: `${id}#0`,
    base,
    changes,
    footprint: footprintOf(text, changes),
    summary: { kind: 'type', author: id, removes: [], adds: [] },
  };
}

test('c1 rejects a stale push; c2 rebases it unless it touches; the ledger is the exception', () => {
  const base = baseDocument(2, 8);
  const far = base.indexOf('u012');
  const near = base.indexOf('u003');
  const at = (pos: number): TextChange => ({ from: pos, to: pos, insert: ' x' });
  for (const strategy of ['c1', 'c2', 'naive'] as const) {
    const authority = new Authority(base, strategy);
    expect(authority.push(pushOf(0, base, at(near), 'a')).status).toBe('ok');
    const result = authority.push(pushOf(0, base, at(far), 'b'));
    // Both pushes make the first ledger entries, which is one change in the same place.
    if (strategy === 'naive') expect(result.status).toBe('ok');
    else expect(result).toMatchObject({ status: 'stale' });
    expect(authority.stats.staleLedgerCollides).toBe(1);
  }
});

test('a link loses what is in flight when it drops, and keeps messages in order', () => {
  const clock = new Clock();
  const link = new Link(clock, new Rng(3), DEFAULT_NET);
  const got: number[] = [];
  for (let i = 0; i < 5; i++) link.send('up', () => got.push(i));
  clock.run();
  expect(got).toEqual([0, 1, 2, 3, 4]);
  link.send('up', () => got.push(9));
  link.disconnect();
  clock.run();
  expect(got).toEqual([0, 1, 2, 3, 4]);
  expect(link.send('up', () => got.push(10))).toBe(false);
  link.connect();
  link.send('up', () => got.push(11));
  clock.run();
  expect(got.at(-1)).toBe(11);
  // Outages that overlap hold the link down until the last one ends.
  link.disconnect();
  link.disconnect();
  link.connect();
  expect(link.up).toBe(false);
  link.connect();
  expect(link.up).toBe(true);
});
