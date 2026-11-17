// @vitest-environment happy-dom
// Tabs as the windows of a session (src/session-tabs.ts): who leads comes from a lock, a hung leader
// is replaced when its heartbeat stops, and a leader that was replaced can no longer write the log.
// The lock, the channel and the store are the fakes below, which do what a browser's do.

import { createEditor, type Editor } from '@redlines/editor';
import { parse } from '@redlines/format';
import { afterEach, describe, expect, it } from 'vitest';
import { joinSession, EVENTS } from './session.ts';
import type { Moved, Session } from './session.ts';
import { TabPorts } from './session-tabs.ts';
import type { TabChannel, TabEnv, TabLocks, TabMessage, TabStore } from './session-tabs.ts';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A BroadcastChannel: what a tab posts reaches every other tab, a moment later. */
class FakeChannels {
  readonly handlers = new Map<string, (message: TabMessage) => void>();
  channel(label: string): TabChannel {
    return {
      post: (message) => {
        for (const [other, handler] of this.handlers) {
          if (other !== label) queueMicrotask(() => handler(message));
        }
      },
      listen: (handler) => {
        this.handlers.set(label, handler);
        return () => void this.handlers.delete(label);
      },
    };
  }
}

/** Web Locks: one holder, a line of waiters, and a lock that can be stolen. */
class FakeLocks implements TabLocks {
  readonly #held = new Map<string, { revoke: (error: Error) => void }>();
  readonly #waiting = new Map<string, (() => void)[]>();

  request(
    name: string,
    options: { steal?: boolean; ifAvailable?: boolean },
    held: (granted: boolean) => Promise<void>,
  ): Promise<void> {
    const taken = this.#held.get(name);
    if (taken && options.steal) {
      taken.revoke(new Error('AbortError: the lock was stolen'));
      this.#held.delete(name);
      return this.#hold(name, held);
    }
    if (taken && options.ifAvailable) return held(false);
    if (taken) {
      return new Promise<void>((resolve, reject) => {
        const line = this.#waiting.get(name) ?? [];
        this.#waiting.set(name, line);
        line.push(() => void this.#hold(name, held).then(resolve, reject));
      });
    }
    return this.#hold(name, held);
  }

  #hold(name: string, held: (granted: boolean) => Promise<void>): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let revoked = false;
      this.#held.set(name, {
        revoke: (error) => {
          revoked = true;
          reject(error);
        },
      });
      held(true).then(
        () => {
          if (revoked) return;
          this.#held.delete(name);
          resolve();
          this.#waiting.get(name)?.shift()?.();
        },
        (error: unknown) => {
          if (revoked) return;
          this.#held.delete(name);
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
    });
  }
}

/** The one store every tab reaches: an epoch and a log, which refuses an epoch that is over. */
class FakeStore implements TabStore {
  current = 0;
  base: string | null = null;
  records: string[] = [];
  bumpEpoch(): Promise<number> {
    return Promise.resolve(++this.current);
  }
  epoch(): Promise<number> {
    return Promise.resolve(this.current);
  }
  start(epoch: number, base: string): Promise<void> {
    if (epoch < this.current) return Promise.reject(new Error('The epoch is over.'));
    this.base = base;
    this.records = [];
    return Promise.resolve();
  }
  append(epoch: number, lines: readonly string[]): Promise<void> {
    if (epoch < this.current) return Promise.reject(new Error('The epoch is over.'));
    this.records.push(...lines);
    return Promise.resolve();
  }
  read(): Promise<{ base: string; records: string[] } | null> {
    return Promise.resolve(this.base === null ? null : { base: this.base, records: this.records });
  }
}

function world(heartbeatMs = 30) {
  const channels = new FakeChannels();
  const locks = new FakeLocks();
  const store = new FakeStore();
  const tab = (label: string): TabPorts => {
    const env: TabEnv = {
      label,
      path: '/docs/plan.md',
      channel: channels.channel(label),
      locks,
      store,
      heartbeatMs,
    };
    return new TabPorts(env);
  };
  return { tab, store };
}

const PATH = '/docs/plan.md';

describe('who leads, among tabs', () => {
  it('is the tab that holds the lock, and the others follow it', async () => {
    const { tab } = world();
    const a = tab('tab-1');
    const b = tab('tab-2');
    const first = await a.join(PATH);
    const second = await b.join(PATH);
    expect(first).toMatchObject({ leader: 'tab-1', epoch: 1, leading: true });
    expect(second).toMatchObject({ leader: 'tab-1', epoch: 1, leading: false });
    expect(await a.members()).toContain('tab-2');
    await a.leave();
    await b.leave();
  });

  it('passes to the next tab when the leader closes, in a new epoch', async () => {
    const { tab } = world();
    const a = tab('tab-1');
    const b = tab('tab-2');
    await a.join(PATH);
    await b.join(PATH);
    const moves: Moved[] = [];
    await b.listen(EVENTS.moved, (payload) => moves.push(payload as Moved));
    await a.leave();
    await wait(60);
    expect(b.leading).toBe(true);
    expect(moves).toEqual([{ path: PATH, leader: 'tab-2', epoch: 2 }]);
    await b.leave();
  });

  it('takes the lock from a leader that stopped saying it is alive', async () => {
    const { tab } = world();
    const a = tab('tab-1');
    const b = tab('tab-2');
    await a.join(PATH);
    await b.join(PATH);
    const moves: Moved[] = [];
    await b.listen(EVENTS.moved, (payload) => moves.push(payload as Moved));
    const hers: Moved[] = [];
    await a.listen(EVENTS.moved, (payload) => hers.push(payload as Moved));
    // The page hangs: its lock is still held, and nothing comes from it.
    a.freeze();
    await wait(400);
    expect(b.leading).toBe(true);
    expect(moves).toEqual([{ path: PATH, leader: 'tab-2', epoch: 2 }]);
    // It runs again, and finds that it leads no more.
    a.thaw();
    await wait(80);
    expect(a.leading).toBe(false);
    expect(hers).toEqual([{ path: PATH, leader: 'tab-2', epoch: 2 }]);
    await a.leave();
    await b.leave();
  });

  it('refuses a late write from the leader that was replaced', async () => {
    const { tab, store } = world();
    const a = tab('tab-1');
    const b = tab('tab-2');
    await a.join(PATH);
    await b.join(PATH);
    await a.walStart(PATH, 1, 'Base');
    await a.walAppend(PATH, 1, ['{"v":1}']);
    a.freeze();
    await wait(400);
    expect(b.leading).toBe(true);
    // The page that was frozen wakes and writes what it had queued, in the epoch it knew.
    await expect(a.walAppend(PATH, 1, ['{"v":2}'])).rejects.toThrow('epoch');
    await b.walStart(PATH, 2, 'Base');
    await b.walAppend(PATH, 2, ['{"v":1}', '{"v":2}']);
    expect(store.records).toEqual(['{"v":1}', '{"v":2}']);
    await a.leave();
    await b.leave();
  });

  it('tells the leader that a tab has gone, and when it stops saying it is here', async () => {
    const { tab } = world();
    const a = tab('tab-1');
    const b = tab('tab-2');
    await a.join(PATH);
    await b.join(PATH);
    const gone: unknown[] = [];
    await a.listen(EVENTS.left, (payload) => gone.push(payload));
    await b.leave();
    await wait(30);
    expect(gone).toEqual([{ path: PATH, window: 'tab-2' }]);
    // A tab whose page hangs is counted out after a while.
    const c = tab('tab-3');
    await c.join(PATH);
    await wait(60);
    expect(await a.members()).toContain('tab-3');
    c.freeze();
    await wait(400);
    expect(await a.members()).not.toContain('tab-3');
    await a.leave();
  });
});

// --- two tabs, each a window of one session ----------------------------------------------------

const BASE = 'First paragraph here.\n\nSecond paragraph here.\n\nThird paragraph here.\n';

const open: Editor[] = [];
afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

async function inTab(ports: TabPorts, doc: string): Promise<{ editor: Editor; session: Session }> {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, { doc, author: { handle: 'ada', name: 'Ada' } });
  open.push(editor);
  const session = await joinSession(ports, editor, {
    path: PATH,
    person: { handle: 'ada', name: 'Ada' },
    save: () => Promise.resolve(editor.view.state.doc.toString()),
    saveDelayMs: 20,
    follow: doc === '',
  });
  return { editor, session };
}

const type = (editor: Editor, after: string, text: string) => {
  const at = editor.view.state.doc.toString().indexOf(after) + after.length;
  editor.view.dispatch({ changes: { from: at, insert: text }, userEvent: 'input.type' });
};

async function settled(...tabs: { session: Session }[]): Promise<void> {
  for (let round = 0; round < 80; round++) {
    await Promise.all(tabs.map((t) => t.session.binding.settled()));
    const versions = new Set(tabs.map((t) => t.session.binding.replica.version));
    if (versions.size === 1 && tabs.every((t) => t.session.confirmed)) return;
    await wait(10);
  }
}

describe('a document in two tabs', () => {
  it('converges, and goes on in the other tab when the leader’s page hangs', async () => {
    const { tab } = world();
    const pa = tab('tab-1');
    const pb = tab('tab-2');
    const a = await inTab(pa, BASE);
    const b = await inTab(pb, '');
    await settled(a, b);
    expect(a.session.leading).toBe(true);
    expect(b.editor.view.state.doc.toString()).toBe(BASE);
    type(a.editor, 'First', ' ONE');
    type(b.editor, 'Third', ' TWO');
    await settled(a, b);
    const text = a.editor.view.state.doc.toString();
    expect(b.editor.view.state.doc.toString()).toBe(text);
    expect(text).toContain('ONE');
    expect(text).toContain('TWO');

    // The leader's page hangs. The other tab takes the lock and the log, and the session goes on.
    pa.freeze();
    await wait(450);
    expect(b.session.leading).toBe(true);
    type(b.editor, 'Second', ' THREE');
    await wait(150);
    await b.session.binding.settled();
    expect(b.session.binding.replica.pending).toHaveLength(0);
    const kept = b.editor.view.state.doc.toString();
    for (const word of ['ONE', 'TWO', 'THREE']) expect(kept).toContain(word);
    expect(parse(kept).warnings).toEqual([]);

    // The hung page runs again: it is a window of the session, not its authority, and it catches up.
    pa.thaw();
    await wait(300);
    expect(a.session.leading).toBe(false);
    await settled(a, b);
    expect(a.editor.view.state.doc.toString()).toBe(b.editor.view.state.doc.toString());
    await a.session.stop();
    await b.session.stop();
  });
});
