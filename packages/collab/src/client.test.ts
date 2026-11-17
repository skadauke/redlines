import { ChangeSet, Text } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { Authority } from './authority.ts';
import { SyncClient } from './client.ts';
import type { SyncState } from './client.ts';
import { Hub } from './hub.ts';
import { memoryTransport } from './memory.ts';
import type { Identity } from './protocol.ts';
import { Replica } from './replica.ts';
import type { Pending } from './replica.ts';
import { MemoryLog } from './wal.ts';

const BASE = 'First paragraph here.\n\nSecond paragraph here.\n\nThird paragraph here.\n';

const people: Record<string, Identity> = {
  ada: { handle: 'ada', name: 'Ada', role: 'owner' },
  bo: { handle: 'bo', name: 'Bo', role: 'editor' },
  cy: { handle: 'cy', name: 'Cy', role: 'editor' },
  vi: { handle: 'vi', name: 'Vi', role: 'viewer' },
};

/** What a test window remembers of an edit, to make it again: type `insert` after `after`. */
interface Note {
  after: string;
  insert: string;
}

function authorityFor(text = BASE, log = new MemoryLog(), epoch?: number): Authority {
  return new Authority({
    base: text,
    wal: log,
    ...(epoch ? { epoch } : {}),
    authenticate: (credential) =>
      'key' in credential
        ? (people[credential.key] ?? { error: 'forbidden' })
        : { error: 'forbidden' },
  });
}

/** A window: an editor's text, its replica, and the client between it and a hub. */
class Window {
  doc: Text;
  readonly replica: Replica<Note>;
  readonly client: SyncClient<Note>;
  readonly transport: ReturnType<typeof memoryTransport>;
  readonly notices: string[] = [];
  readonly states: SyncState[] = [];

  readonly id: string;

  constructor(hub: Hub, id: string, key: string, host = false) {
    this.id = id;
    this.doc = Text.of((host ? hub.authority.text : '').split('\n'));
    this.replica = new Replica<Note>(id, this.doc);
    this.transport = memoryTransport(hub, id);
    this.client = new SyncClient<Note>({
      transport: this.transport,
      replica: this.replica,
      credential: { key },
      loaded: host,
      rederive: (confirmed, pending, drop) => this.rederive(confirmed, pending, drop),
      showRemote: (changes) => (this.doc = changes.apply(this.doc)),
      showAll: (doc) => (this.doc = doc),
      load: (text) => (this.doc = Text.of(text.split('\n'))),
      notice: (message) => this.notices.push(message),
      onState: (state) => this.states.push(state),
      retryMs: 5,
    });
  }

  private rederive(confirmed: Text, pending: readonly Pending<Note>[], drop: number) {
    let doc = confirmed;
    const kept: Pending<Note>[] = [];
    for (const edit of pending.slice(drop)) {
      const at = doc.toString().indexOf(edit.note.after);
      if (at < 0) continue;
      const pos = at + edit.note.after.length;
      const changes = ChangeSet.of({ from: pos, insert: edit.note.insert }, doc.length);
      kept.push({ changes, start: doc, note: edit.note });
      doc = changes.apply(doc);
    }
    return { pending: kept, notices: [] };
  }

  /** Types `insert` right after the first `after` the person sees. */
  type(after: string, insert: string): void {
    const at = this.doc.toString().indexOf(after);
    if (at < 0) throw new Error(`${after} is not in ${this.id}'s text`);
    const pos = at + after.length;
    const changes = ChangeSet.of({ from: pos, insert }, this.doc.length);
    this.replica.local(changes, this.doc, { after, insert });
    this.doc = changes.apply(this.doc);
    this.client.edited();
  }

  get text(): string {
    return this.doc.toString();
  }
}

async function settle(...windows: Window[]): Promise<void> {
  for (let round = 0; round < 20; round++) {
    await Promise.all(windows.map((w) => w.client.sync()));
    if (windows.every((w) => w.client.state === 'synced')) {
      const versions = new Set(windows.map((w) => w.replica.version));
      if (versions.size === 1) return;
    }
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

describe('a session of windows', () => {
  it('lets a window join and read the document', async () => {
    const hub = new Hub(authorityFor());
    const ada = new Window(hub, 'ada-1', 'ada', true);
    const bo = new Window(hub, 'bo-1', 'bo');
    await ada.client.start();
    await bo.client.start();
    expect(bo.text).toBe(BASE);
    expect(bo.client.state).toBe('synced');
  });

  it('converges when two windows type in different places at once', async () => {
    const hub = new Hub(authorityFor());
    const ada = new Window(hub, 'ada-1', 'ada', true);
    const bo = new Window(hub, 'bo-1', 'bo');
    await Promise.all([ada.client.start(), bo.client.start()]);
    ada.type('First', ' (ada)');
    bo.type('Third', ' (bo)');
    await settle(ada, bo);
    expect(ada.text).toBe(hub.authority.text);
    expect(bo.text).toBe(hub.authority.text);
    expect(hub.authority.text).toContain('First (ada) paragraph');
    expect(hub.authority.text).toContain('Third (bo) paragraph');
    expect(ada.replica.pending).toHaveLength(0);
  });

  it('derives an edit again when someone typed at the same place', async () => {
    const hub = new Hub(authorityFor());
    const ada = new Window(hub, 'ada-1', 'ada', true);
    const bo = new Window(hub, 'bo-1', 'bo');
    await Promise.all([ada.client.start(), bo.client.start()]);
    ada.type('Second', ' A');
    bo.type('Second', ' B');
    await settle(ada, bo);
    expect(ada.text).toBe(hub.authority.text);
    expect(bo.text).toBe(hub.authority.text);
    expect(hub.authority.text).toMatch(/ A/);
    expect(hub.authority.text).toMatch(/ B/);
  });

  it('converges over many random edits by three windows', async () => {
    for (let seed = 1; seed <= 12; seed++) {
      const hub = new Hub(authorityFor());
      const names = ['ada', 'bo', 'cy'];
      const windows = names.map((n, i) => new Window(hub, `${n}-1`, n, i === 0));
      await Promise.all(windows.map((w) => w.client.start()));
      let state = seed * 7919;
      const next = () => (state = (state * 48271) % 2147483647);
      const inserted: string[] = [];
      for (let i = 0; i < 40; i++) {
        const w = windows[next() % windows.length]!;
        const words = ['First', 'Second', 'Third', 'paragraph', 'here.'];
        const after = words[next() % words.length]!;
        const insert = ` w${i}`;
        if (!w.text.includes(after)) continue;
        w.type(after, insert);
        inserted.push(insert);
        if (next() % 3 === 0) await new Promise((r) => setTimeout(r, 1));
      }
      await settle(...windows);
      const text = hub.authority.text;
      for (const w of windows) expect(w.text, `seed ${seed}`).toBe(text);
      for (const insert of inserted)
        expect(text, `seed ${seed} ${windows.map((w) => w.notices.join('/')).join('|')}`).toContain(
          insert,
        );
    }
  });

  it('keeps edits made while offline and sends them when the host answers', async () => {
    const hub = new Hub(authorityFor());
    const ada = new Window(hub, 'ada-1', 'ada', true);
    const bo = new Window(hub, 'bo-1', 'bo');
    await Promise.all([ada.client.start(), bo.client.start()]);
    bo.transport.disconnect();
    bo.type('First', ' offline');
    ada.type('Third', ' online');
    await ada.client.sync();
    await bo.client.sync();
    expect(bo.client.state).toBe('offline');
    expect(hub.authority.text).not.toContain('offline');
    bo.transport.connect();
    await new Promise((r) => setTimeout(r, 20));
    await settle(ada, bo);
    expect(hub.authority.text).toContain('First offline');
    expect(bo.text).toBe(hub.authority.text);
    expect(ada.text).toBe(hub.authority.text);
  });

  it('turns a viewer away', async () => {
    const hub = new Hub(authorityFor());
    const ada = new Window(hub, 'ada-1', 'ada', true);
    const vi = new Window(hub, 'vi-1', 'vi');
    await Promise.all([ada.client.start(), vi.client.start()]);
    vi.type('First', ' nope');
    await vi.client.sync();
    expect(vi.client.state).toBe('ended');
    expect(hub.authority.text).not.toContain('nope');
  });

  it('goes on after a takeover from the log, with nothing lost', async () => {
    const log = new MemoryLog();
    const first = new Hub(authorityFor(BASE, log));
    const ada = new Window(first, 'ada-1', 'ada', true);
    const bo = new Window(first, 'bo-1', 'bo');
    await Promise.all([ada.client.start(), bo.client.start()]);
    ada.type('First', ' one');
    bo.type('Third', ' two');
    await settle(ada, bo);
    const before = first.authority.text;
    expect(before).toContain(' one');

    // The window that hosted it closes; bo's takes over from the log.
    await ada.client.stop();
    const records = [...log.records()];
    const second = new Hub(
      Authority.takeover({
        base: BASE,
        records,
        authenticate: (c) =>
          'key' in c ? (people[c.key] ?? { error: 'forbidden' }) : { error: 'forbidden' },
      }),
    );
    expect(second.authority.text).toBe(before);
    expect(second.authority.epoch).toBeGreaterThan(first.authority.epoch);
    const boAgain = new Window(second, 'bo-1', 'bo');
    // Bo keeps its replica and its pending edits; only the host it talks to is new.
    const moved = new SyncClient<Note>({
      transport: boAgain.transport,
      replica: bo.replica,
      credential: { key: 'bo' },
      loaded: true,
      rederive: (confirmed, pending, drop) => boAgain['rederive'](confirmed, pending, drop),
      showRemote: (changes) => (bo.doc = changes.apply(bo.doc)),
      showAll: (doc) => (bo.doc = doc),
      load: (text) => (bo.doc = Text.of(text.split('\n'))),
      retryMs: 5,
    });
    await moved.start();
    bo.type('Second', ' three');
    moved.edited();
    await moved.sync();
    await new Promise((r) => setTimeout(r, 5));
    await moved.sync();
    expect(second.authority.text).toContain(' three');
    expect(second.authority.text).toContain(' one');
    expect(second.authority.text).toContain(' two');
  });
});
