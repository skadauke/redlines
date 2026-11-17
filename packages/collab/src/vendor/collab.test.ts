import { ChangeSet, EditorState, StateEffect, Text } from '@codemirror/state';
import type { Transaction } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import type { LoggedUpdate, Update } from './collab.ts';
import * as fixedLib from './collab.ts';
import * as upstreamLib from './upstream.ts';

const { collab, getClientID, getSyncedVersion, sendableUpdates } = fixedLib;

/** A collab to run: the extension and state it keeps, and the two functions that differ. */
interface Impl {
  lib: Pick<typeof fixedLib, 'collab' | 'getSyncedVersion' | 'sendableUpdates'>;
  rebase: typeof fixedLib.rebaseUpdates;
  receive: typeof fixedLib.receiveUpdates;
}
const fixed: Impl = {
  lib: fixedLib,
  rebase: fixedLib.rebaseUpdates,
  receive: fixedLib.receiveUpdates,
};
const upstream: Impl = {
  lib: upstreamLib,
  rebase: upstreamLib.rebaseUpdates,
  receive: upstreamLib.receiveUpdates,
};

/** The smallest authority: a log of accepted updates and the text they make. */
class Authority {
  log: Update[] = [];
  doc: Text;
  private impl: Impl;
  constructor(text: string, impl: Impl) {
    this.impl = impl;
    this.doc = Text.of(text.split('\n'));
  }
  push(version: number, updates: readonly Update[]): boolean {
    if (version > this.log.length) return false;
    const rebased = this.impl.rebase(updates, this.log.slice(version));
    for (const u of rebased) {
      this.doc = u.changes.apply(this.doc);
      this.log.push(u);
    }
    return true;
  }
}

function client(text: string, id: string, impl: Impl = fixed) {
  return EditorState.create({ doc: text, extensions: [impl.lib.collab({ clientID: id })] });
}

/** Everything the client has not confirmed, sent from the version it has seen. */
function sync(
  authority: Authority,
  state: EditorState,
  impl: Impl,
  mode: 'one' | 'all',
): EditorState {
  const { getSyncedVersion, sendableUpdates } = impl.lib;
  const sendable = sendableUpdates(state);
  if (sendable.length) authority.push(getSyncedVersion(state), sendable);
  const fresh = authority.log.slice(getSyncedVersion(state));
  if (mode === 'all') return fresh.length ? impl.receive(state, fresh).state : state;
  for (const u of fresh) state = impl.receive(state, [u]).state;
  return state;
}

function insert(state: EditorState, at: number, text: string): EditorState {
  return state.update({ changes: { from: at, insert: text } }).state;
}

function remove(state: EditorState, from: number, to: number): EditorState {
  return state.update({ changes: { from, to } }).state;
}

/** A small deterministic generator. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/**
 * Three clients edit a short text at random and sync at random. Returns the seed of the first
 * session whose clients end with other text than the authority, or null.
 */
function run(impl: Impl, seed: number, mode: 'one' | 'all'): string | null {
  try {
    return session(impl, seed, mode);
  } catch (error) {
    // A log that was rebased wrongly no longer fits the text a client holds.
    return `seed ${seed}: ${String(error)}`;
  }
}

function session(impl: Impl, seed: number, mode: 'one' | 'all'): string | null {
  const next = rng(seed);
  const start = 'abcdef';
  const authority = new Authority(start, impl);
  let clients = ['a', 'b', 'c'].map((id) => client(start, id, impl));
  for (let step = 0; step < 14; step++) {
    const i = Math.floor(next() * clients.length);
    let state = clients[i]!;
    if (next() < 0.65) {
      const len = state.doc.length;
      const at = Math.floor(next() * (len + 1));
      if (next() < 0.6 || len === 0) {
        state = insert(state, at, String.fromCharCode(65 + Math.floor(next() * 26)));
      } else {
        const from = Math.min(at, len - 1);
        state = remove(state, from, Math.min(len, from + 1 + Math.floor(next() * 2)));
      }
    } else {
      state = sync(authority, state, impl, mode);
    }
    clients[i] = state;
  }
  // Quiesce: everyone sends, then everyone catches up.
  for (let round = 0; round < 2; round++) {
    clients = clients.map((c) => sync(authority, c, impl, mode));
  }
  const want = authority.doc.toString();
  const bad = clients.find(
    (c) => c.doc.toString() !== want || impl.lib.sendableUpdates(c).length > 0,
  );
  return bad ? `seed ${seed}: authority "${want}", client "${bad.doc.toString()}"` : null;
}

describe('the vendored collab', () => {
  it('numbers clients and versions as upstream does', () => {
    const a = client('x', 'ann');
    expect(getClientID(a)).toBe('ann');
    expect(getSyncedVersion(a)).toBe(0);
    expect(getClientID(EditorState.create({ extensions: [collab()] }))).not.toBe('');
  });

  it('confirms an own update without changing the text', () => {
    const authority = new Authority('hello', fixed);
    let a = insert(client('hello', 'a'), 5, '!');
    a = sync(authority, a, fixed, 'one');
    expect(a.doc.toString()).toBe('hello!');
    expect(getSyncedVersion(a)).toBe(1);
    expect(sendableUpdates(a)).toHaveLength(0);
  });

  it('drops a push the log already holds', () => {
    const authority = new Authority('hello', fixed);
    const a = insert(client('hello', 'a'), 0, '>');
    const sent = [...sendableUpdates(a)];
    authority.push(0, sent);
    authority.push(0, sent);
    expect(authority.doc.toString()).toBe('>hello');
    expect(authority.log).toHaveLength(1);
  });

  it('maps a stale push over what was logged since its base', () => {
    const authority = new Authority('hello', fixed);
    const a = insert(client('hello', 'a'), 0, 'AA');
    const b = insert(client('hello', 'b'), 5, 'BB');
    authority.push(0, sendableUpdates(a));
    authority.push(0, sendableUpdates(b));
    expect(authority.doc.toString()).toBe('AAhelloBB');
  });

  it('moves unconfirmed effects and changes over received updates, one at a time', () => {
    const authority = new Authority('abc', fixed);
    let a = insert(client('abc', 'a'), 1, 'X');
    const b = insert(client('abc', 'b'), 1, 'Y');
    authority.push(0, sendableUpdates(b));
    a = fixed.receive(a, authority.log).state;
    expect(a.doc.toString()).toBe('aYXbc');
    expect(sendableUpdates(a)).toHaveLength(1);
  });

  describe('the divergence in upstream', () => {
    // Upstream maps a late push over the composition of the updates logged since its base, and a
    // client maps its own edits over the same updates one at a time. With three clients editing
    // one short text, the two disagree about where an insertion goes: the letters are the same and
    // their order differs. These sessions were found by searching seeds 1 to 20000.
    it.each([11, 14, 15])('session %i: upstream ends with other text, the fix does not', (seed) => {
      expect(run(upstream, seed, 'one')).toMatch(/authority ".*", client ".*"/);
      expect(run(fixed, seed, 'one')).toBeNull();
      expect(run(fixed, seed, 'all')).toBeNull();
    });

    it('the rebase alone is the cause: the fixed receive agrees with the fixed authority only', () => {
      const mixed: Impl = { lib: fixedLib, rebase: upstream.rebase, receive: fixed.receive };
      const bad = [11, 14, 15].filter((seed) => run(mixed, seed, 'one') !== null);
      expect(bad.length).toBeGreaterThan(0);
    });
  });

  it('the fix: 2000 random sessions, clients receiving one update at a time or in a batch', () => {
    for (let seed = 1; seed <= 2000; seed++) {
      expect(run(fixed, seed, 'one')).toBeNull();
      expect(run(fixed, seed, 'all')).toBeNull();
    }
  });

  it('rebases over each update in turn, as a client receiving them would', () => {
    const ada = insert(client('abcdef', 'a'), 3, 'Q');
    const over: LoggedUpdate[] = [
      { changes: ChangeSet.of({ from: 2, to: 4 }, 6).desc, clientID: 'b' },
      { changes: ChangeSet.of({ from: 2, insert: 'zz' }, 4).desc, clientID: 'c' },
    ];
    const [out] = fixed.rebase(sendableUpdates(ada), over);
    expect(out?.clientID).toBe('a');
    expect(
      ChangeSet.of({ from: 2, to: 4 }, 6)
        .compose(ChangeSet.of({ from: 2, insert: 'zz' }, 4))
        .compose(out!.changes)
        .apply(Text.of(['abcdef']))
        .toString(),
    ).toBe('abzzQef');
  });

  it('moves a shared effect with the text it points at', () => {
    const mark = StateEffect.define<number>({ map: (v, ch) => ch.mapPos(v) });
    const config = {
      clientID: 'a',
      sharedEffects: (tr: Transaction) => tr.effects.filter((e) => e.is(mark)),
    };
    let a = EditorState.create({ doc: 'abc', extensions: [collab(config)] });
    a = a.update({ effects: mark.of(2) }).state;
    const remote: Update = { changes: ChangeSet.of({ from: 0, insert: 'XY' }, 3), clientID: 'b' };
    const out = fixed.rebase(sendableUpdates(a), [{ changes: remote.changes.desc, clientID: 'b' }]);
    expect(out[0]?.effects?.map((e) => e.value as number)).toEqual([4]);
    const received = fixed.receive(a, [remote]).state;
    expect(sendableUpdates(received)[0]?.effects?.map((e) => e.value as number)).toEqual([4]);
  });
});
