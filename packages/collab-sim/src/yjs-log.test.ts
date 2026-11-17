// What Yjs does with a log of intents: the facts that "Yjs as the intent log" in
// docs/research/collaboration.md relies on.

import * as Y from 'yjs';
import { expect, test } from 'vitest';

const pair = (gc = true): [Y.Doc, Y.Doc] => {
  const a = new Y.Doc({ gc });
  a.clientID = 1;
  const b = new Y.Doc({ gc });
  b.clientID = 2;
  return [a, b];
};

const sync = (a: Y.Doc, b: Y.Doc): void => {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
};

test('replicas that know the same updates have the same order, whatever order they heard them in', () => {
  const docs = [1, 2, 3].map((id) => {
    const d = new Y.Doc();
    d.clientID = id;
    return d;
  });
  const updates: Uint8Array[] = [];
  docs.forEach((d, i) => {
    d.on('update', (u: Uint8Array) => updates.push(u));
    const arr = d.getArray<string>('log');
    for (let n = 0; n < 4; n++) arr.push([`r${i}#${n}`]);
  });
  const orders = [0, 1, 2, 3].map((k) => {
    const d = new Y.Doc();
    const shuffled = [...updates.slice(k * 3), ...updates.slice(0, k * 3)];
    if (k % 2 === 1) shuffled.reverse();
    // Updates that arrive before what they follow are held back, and applied when it comes.
    for (const u of shuffled) Y.applyUpdate(d, u);
    return d.getArray<string>('log').toArray();
  });
  for (const order of orders) expect(order).toEqual(orders[0]);
  expect(orders[0]).toHaveLength(12);
});

test('an update that depends on one not yet received is held back, not shown', () => {
  const [a, b] = pair();
  const c = new Y.Doc();
  const updates: Uint8Array[] = [];
  a.on('update', (u: Uint8Array) => updates.push(u));
  const arr = a.getArray<string>('log');
  arr.push(['first']);
  arr.push(['second']);
  // The second update reaches `c` first: it is pending until the first arrives.
  Y.applyUpdate(c, updates[1] as Uint8Array);
  expect(c.getArray('log').length).toBe(0);
  expect(c.store.pendingStructs).not.toBeNull();
  Y.applyUpdate(c, updates[0] as Uint8Array);
  expect(c.getArray('log').toArray()).toEqual(['first', 'second']);
  expect(b.getArray('log').length).toBe(0);
});

test('an intent concurrent with the deletion of its origin is kept, with or without gc', () => {
  for (const gc of [true, false]) {
    const [a, b] = pair(gc);
    a.getArray<string>('log').push(['p1', 'p2', 'p3']);
    sync(a, b);
    b.getArray<string>('log').push(['late']);
    a.getArray<string>('log').delete(0, 3);
    sync(a, b);
    expect(a.getArray('log').toArray()).toEqual(['late']);
    expect(b.getArray('log').toArray()).toEqual(['late']);
  }
});

test('deleting a prefix drops its content with gc, and keeps it without', () => {
  const size = (gc: boolean): number => {
    const d = new Y.Doc({ gc });
    const arr = d.getArray<{ words: string }>('log');
    for (let n = 0; n < 500; n++)
      arr.push([{ words: 'some words that an intent holds '.repeat(4) + n }]);
    const before = Y.encodeStateAsUpdate(d).length;
    arr.delete(0, 490);
    return Y.encodeStateAsUpdate(d).length / before;
  };
  expect(size(true)).toBeLessThan(0.1);
  expect(size(false)).toBeGreaterThan(0.99);
});

test('a snapshot holds no content: the old text comes from the doc, which gc has emptied', () => {
  const d = new Y.Doc({ gc: true });
  const arr = d.getArray<string>('log');
  arr.push(['a', 'b', 'c']);
  const snap = Y.snapshot(d);
  arr.delete(0, 2);
  // With gc on, restoring the snapshot is not possible: the content is gone.
  expect(() => Y.createDocFromSnapshot(d, snap)).toThrow();
});
