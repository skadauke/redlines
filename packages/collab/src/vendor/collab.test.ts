import { ChangeSet, EditorState, Text } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import type { LoggedUpdate, Update } from './collab.ts';
import {
  collab,
  getClientID,
  getSyncedVersion,
  rebaseUpdates,
  receiveUpdates,
  sendableUpdates,
} from './collab.ts';
import { upstreamRebaseUpdates, upstreamReceiveUpdates } from './upstream.ts';

interface Impl {
  rebase: typeof rebaseUpdates;
  receive: typeof receiveUpdates;
}
const fixed: Impl = { rebase: rebaseUpdates, receive: receiveUpdates };
const upstream: Impl = { rebase: upstreamRebaseUpdates, receive: upstreamReceiveUpdates };

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

function client(text: string, id: string) {
  return EditorState.create({ doc: text, extensions: [collab({ clientID: id })] });
}

/** Everything the client has not confirmed, sent from the version it has seen. */
function sync(
  authority: Authority,
  state: EditorState,
  impl: Impl,
  mode: 'one' | 'all',
): EditorState {
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
  let clients = ['a', 'b', 'c'].map((id) => client(start, id));
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
  const bad = clients.find((c) => c.doc.toString() !== want || sendableUpdates(c).length > 0);
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
    // one short text, the two disagree, and the client's text no longer fits the log.
    it('is found by search, upstream diverges, the fix never does', () => {
      let upstreamBad: string | null = null;
      for (let seed = 1; seed <= 3000 && !upstreamBad; seed++) {
        upstreamBad = run(upstream, seed, 'one');
      }
      expect(upstreamBad).not.toBeNull();
      const failing = Number(/seed (\d+)/.exec(upstreamBad ?? '')?.[1]);
      expect(run(fixed, failing, 'one')).toBeNull();
    });

    it("a late push over two logged updates ends with the authority's text", () => {
      const base = 'abcdef';
      const make = (impl: Impl) => {
        const authority = new Authority(base, impl);
        // Ada types between "b" and "c", unsent. Bo removes "bc", logged in two updates.
        let ada = insert(client(base, 'ada'), 2, 'X');
        const bo = client(base, 'bo');
        const bo1 = remove(bo, 1, 2);
        const bo2 = remove(bo1, 1, 2);
        const cy = insert(client(base, 'cy'), 2, 'Y');
        authority.push(0, [sendableUpdates(bo2)[0]!]);
        authority.push(1, [sendableUpdates(bo2)[1]!]);
        authority.push(0, sendableUpdates(cy));
        // Ada pushes late, based on version 0.
        ada = sync(authority, ada, impl, 'one');
        return { authority, ada };
      };
      const f = make(fixed);
      expect(f.ada.doc.toString()).toBe(f.authority.doc.toString());
      expect(sendableUpdates(f.ada)).toHaveLength(0);
    });
  });

  it('the fix: 2000 random sessions, clients receiving one update at a time or in a batch', () => {
    for (let seed = 1; seed <= 2000; seed++) {
      expect(run(fixed, seed, 'one')).toBeNull();
      expect(run(fixed, seed, 'all')).toBeNull();
    }
  });

  it('rebases to the same result however the log is cut into steps', () => {
    const a = insert(client('abcdef', 'a'), 3, 'Q');
    const over: LoggedUpdate[] = [
      { changes: ChangeSet.of({ from: 2, to: 4 }, 6).desc, clientID: 'b' },
      { changes: ChangeSet.of({ from: 2, insert: 'zz' }, 4).desc, clientID: 'c' },
    ];
    const [out] = fixed.rebase(sendableUpdates(a), over);
    expect(out?.changes.length).toBe(6);
    expect(out?.clientID).toBe('a');
  });
});
