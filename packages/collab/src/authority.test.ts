import { ChangeSet, EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { Authority } from './authority.ts';
import type { AuthorityOptions } from './authority.ts';
import { isError } from './protocol.ts';
import type {
  HelloReply,
  HelloRequest,
  Identity,
  ProtocolError,
  PushReply,
  Role,
  WireUpdate,
} from './protocol.ts';
import { collab, getSyncedVersion, receiveUpdates, sendableUpdates } from './vendor/collab.ts';
import { MemoryLog } from './wal.ts';

const BASE = 'First paragraph here.\n\nSecond paragraph here.\n\nThird paragraph here.\n';

const people: Record<string, Identity> = {
  ada: { handle: 'ada', name: 'Ada', role: 'owner' },
  bo: { handle: 'bo', name: 'Bo', role: 'editor' },
  cy: { handle: 'cy', name: 'Cy', role: 'commenter' },
  dee: { handle: 'dee', name: 'Dee', role: 'editor' },
  vi: { handle: 'vi', name: 'Vi', role: 'viewer' },
};

function make(overrides: Partial<AuthorityOptions> = {}, base = BASE) {
  let time = 1000;
  const clock = { now: () => time, advance: (ms: number) => (time += ms) };
  const authority = new Authority({
    base,
    now: clock.now,
    authenticate: (credential) => {
      if ('token' in credential) {
        return credential.token === 'old' ? { error: 'token-expired' } : { error: 'forbidden' };
      }
      return people[credential.key] ?? { error: 'forbidden' };
    },
    ...overrides,
  });
  return { authority, clock };
}

function join(
  authority: Authority,
  key: string,
  clientID = key,
  extra: Partial<HelloRequest> = {},
) {
  const reply = authority.hello({
    credential: { key },
    clientID,
    protocol: 1,
    format: 1,
    version: 0,
    epoch: authority.epoch,
    ...extra,
  });
  if (isError(reply)) throw new Error(reply.message);
  return reply;
}

function edit(
  clientID: string,
  length: number,
  from: number,
  insert: string,
  to = from,
  extra: Partial<WireUpdate> = {},
): WireUpdate {
  return { changes: ChangeSet.of({ from, to, insert }, length).toJSON(), clientID, ...extra };
}

function wireOf(u: { changes: ChangeSet; clientID: string }): WireUpdate {
  const changes: unknown = u.changes.toJSON();
  return { changes, clientID: u.clientID };
}

function ok(reply: PushReply | ProtocolError): PushReply {
  if (isError(reply)) throw new Error(`${reply.error}: ${reply.message}`);
  return reply;
}

function code(reply: unknown): string {
  return isError(reply as { ok: boolean }) ? (reply as ProtocolError).error : 'ok';
}

describe('hello', () => {
  it('gives the role, the person, the epoch and the version', () => {
    const { authority } = make();
    const reply: HelloReply = join(authority, 'bo');
    expect(reply).toMatchObject({ role: 'editor', person: { handle: 'bo' }, epoch: 1, version: 0 });
    expect(reply.reset).toBe(false);
  });

  it('answers token-expired, forbidden and update-required', () => {
    const { authority } = make();
    const hello = (extra: Partial<HelloRequest>) =>
      authority.hello({
        credential: { key: 'bo' },
        clientID: 'x',
        protocol: 1,
        format: 1,
        version: 0,
        epoch: 1,
        ...extra,
      });
    expect(code(hello({ credential: { token: 'old' } }))).toBe('token-expired');
    expect(code(hello({ credential: { key: 'nobody' } }))).toBe('forbidden');
    expect(code(hello({ protocol: 0 }))).toBe('update-required');
    expect(code(hello({ format: 2 }))).toBe('update-required');
    expect(code(hello({ protocol: 2 }))).toBe('update-required');
  });

  it('says reset to a client from another epoch or ahead of the log', () => {
    const { authority } = make();
    expect(join(authority, 'bo', 'bo', { epoch: 0 }).reset).toBe(true);
    expect(join(authority, 'bo', 'bo', { version: 5 }).reset).toBe(true);
  });

  it('needs a hello before anything else', () => {
    const { authority } = make();
    expect(code(authority.getDocument('nobody'))).toBe('forbidden');
    expect(code(authority.pull('nobody', 0))).toBe('forbidden');
  });
});

describe('getDocument and pull', () => {
  it('returns the text with its version, and the updates since a version', () => {
    const { authority } = make();
    join(authority, 'bo');
    ok(
      authority.push('bo', { version: 0, epoch: 1, updates: [edit('bo', BASE.length, 0, 'Hi. ')] }),
    );
    const doc = authority.getDocument('bo');
    expect(doc).toMatchObject({ ok: true, version: 1, epoch: 1 });
    expect((doc as { text: string }).text.startsWith('Hi. First')).toBe(true);
    const pulled = authority.pull('bo', 0);
    if (isError(pulled)) throw new Error('pull');
    expect(pulled.updates).toHaveLength(1);
    expect(pulled.updates[0]).toMatchObject({ version: 1, clientID: 'bo', by: 'bo', at: 1000 });
    expect(authority.pull('bo', 1)).toMatchObject({ ok: true, updates: [] });
    expect(code(authority.pull('bo', 2))).toBe('stale');
  });
});

describe('push', () => {
  it('appends a push based on the current version', () => {
    const { authority } = make();
    join(authority, 'bo');
    const reply = ok(
      authority.push('bo', { version: 0, epoch: 1, updates: [edit('bo', BASE.length, 0, 'A')] }),
    );
    expect(reply).toMatchObject({ status: 'accepted', version: 1, duplicates: 0 });
    expect(authority.text.startsWith('AFirst')).toBe(true);
  });

  it('refuses a viewer, a wrong epoch, a version ahead and another client’s update', () => {
    const { authority } = make();
    join(authority, 'vi');
    join(authority, 'bo');
    const u = (id: string) => [edit(id, BASE.length, 0, 'A')];
    expect(code(authority.push('vi', { version: 0, epoch: 1, updates: u('vi') }))).toBe(
      'forbidden',
    );
    const wrongEpoch = authority.push('bo', { version: 0, epoch: 0, updates: u('bo') });
    expect(wrongEpoch).toMatchObject({ error: 'stale', reason: 'epoch' });
    const ahead = authority.push('bo', { version: 3, epoch: 1, updates: u('bo') });
    expect(ahead).toMatchObject({ error: 'stale', reason: 'version' });
    expect(code(authority.push('bo', { version: 0, epoch: 1, updates: u('someone') }))).toBe(
      'forbidden',
    );
    expect(authority.version).toBe(0);
  });

  it('rebases a stale push whose footprint touches nothing logged since', () => {
    const { authority } = make();
    join(authority, 'ada');
    join(authority, 'bo');
    ok(
      authority.push('ada', {
        version: 0,
        epoch: 1,
        updates: [edit('ada', BASE.length, 0, 'AAA')],
      }),
    );
    // Bo, still on version 0, types in the last paragraph.
    const at = BASE.indexOf('Third');
    const reply = ok(
      authority.push('bo', { version: 0, epoch: 1, updates: [edit('bo', BASE.length, at, 'B')] }),
    );
    expect(reply).toMatchObject({ status: 'rebased', version: 2 });
    expect(authority.text).toBe('AAA' + BASE.slice(0, at) + 'B' + BASE.slice(at));
  });

  it('answers stale when the footprint touches an update since the base, ends included', () => {
    const { authority } = make();
    join(authority, 'ada');
    join(authority, 'bo');
    ok(
      authority.push('ada', { version: 0, epoch: 1, updates: [edit('ada', BASE.length, 5, 'XX')] }),
    );
    // Bo changes 2..5: the ranges meet at 5.
    const touching = authority.push('bo', {
      version: 0,
      epoch: 1,
      updates: [edit('bo', BASE.length, 2, '', 5)],
    });
    expect(touching).toMatchObject({ error: 'stale', reason: 'footprint', version: 1 });
    // Bo changes 2..4: apart.
    expect(
      ok(
        authority.push('bo', {
          version: 0,
          epoch: 1,
          updates: [edit('bo', BASE.length, 2, '', 4)],
        }),
      ),
    ).toMatchObject({ status: 'rebased' });
  });

  it('counts what a push depends on, not only what it changes', () => {
    const { authority } = make();
    join(authority, 'ada');
    join(authority, 'bo');
    ok(
      authority.push('ada', {
        version: 0,
        epoch: 1,
        updates: [edit('ada', BASE.length, 40, 'XX')],
      }),
    );
    const at = 0;
    const reads = edit('bo', BASE.length, at, 'B', at, { footprint: [{ from: 0, to: 41 }] });
    expect(authority.push('bo', { version: 0, epoch: 1, updates: [reads] })).toMatchObject({
      error: 'stale',
      reason: 'footprint',
    });
  });

  it('maps a footprint through each logged update, so later updates are compared where they apply', () => {
    const { authority } = make();
    join(authority, 'ada');
    join(authority, 'bo');
    join(authority, 'dee');
    // Ada inserts 10 characters at the start; Cy's push at version 0 touches the end paragraph.
    ok(
      authority.push('ada', {
        version: 0,
        epoch: 1,
        updates: [edit('ada', BASE.length, 0, '0123456789')],
      }),
    );
    const end = BASE.length - 1;
    ok(
      authority.push('bo', { version: 0, epoch: 1, updates: [edit('bo', BASE.length, end, 'E')] }),
    );
    // Cy's two-update push, on version 0: the second update applies after the first.
    const first = edit('dee', BASE.length, 25, 'M');
    const second = edit('dee', BASE.length + 1, 25, 'N');
    const reply = authority.push('dee', { version: 0, epoch: 1, updates: [first, second] });
    expect(code(reply)).toBe('ok');
    expect(authority.text).toContain('NM');
  });

  it('drops the updates of a push that the log already holds', () => {
    const { authority } = make();
    join(authority, 'bo');
    const push = { version: 0, epoch: 1, updates: [edit('bo', BASE.length, 0, 'A')] };
    ok(authority.push('bo', push));
    const again = ok(authority.push('bo', push));
    expect(again).toMatchObject({ duplicates: 1, version: 1 });
    expect(authority.text.startsWith('AFirst')).toBe(true);
  });

  it('refuses an update that does not fit its text, or a bad footprint', () => {
    const { authority } = make();
    join(authority, 'bo');
    expect(
      code(authority.push('bo', { version: 0, epoch: 1, updates: [edit('bo', 7, 0, 'A')] })),
    ).toBe('invalid');
    expect(
      code(
        authority.push('bo', {
          version: 0,
          epoch: 1,
          updates: [{ changes: 'nonsense', clientID: 'bo' }],
        }),
      ),
    ).toBe('invalid');
    const bad = edit('bo', BASE.length, 0, 'A', 0, { footprint: [{ from: 5, to: 2 }] });
    expect(code(authority.push('bo', { version: 0, epoch: 1, updates: [bad] }))).toBe('invalid');
  });
});

describe('what the format library checks', () => {
  it('refuses a push that makes new parse warnings, and logs none of the push', () => {
    const { authority } = make();
    join(authority, 'bo');
    const good = edit('bo', BASE.length, 0, 'Fine. ');
    const broken = edit('bo', BASE.length + 6, 0, '<!--ins k3x9-->');
    const reply = authority.push('bo', { version: 0, epoch: 1, updates: [good, broken] });
    expect(code(reply)).toBe('invalid');
    expect(authority.version).toBe(0);
    expect(authority.text).toBe(BASE);
  });

  it('does not hold a push to warnings the file already had', () => {
    const odd = `${BASE}\n<!--ins k3x9-->\n`;
    const { authority } = make({}, odd);
    join(authority, 'bo');
    const reply = authority.push('bo', {
      version: 0,
      epoch: 1,
      updates: [edit('bo', odd.length, 0, 'Fine. ')],
    });
    expect(code(reply)).toBe('ok');
  });

  it('accepts a well-formed tracked insertion with its ledger', () => {
    const { authority } = make();
    join(authority, 'bo');
    const tracked = 'New<!--ins k3x9-->';
    expect(tracked.length).toBeGreaterThan(0);
    const ledger =
      '\n<!-- redlines\nversion: 1\npeople:\n  bo: {name: Bo}\nmarks:\n  k3x9: {by: bo, at: 2026-11-16T10:00Z}\n-->\n';
    const text = `<!--ins k3x9-->Hello<!--/ins k3x9-->\n${ledger}`;
    const { authority: fresh } = make({}, text);
    join(fresh, 'bo');
    expect(
      code(fresh.push('bo', { version: 0, epoch: 1, updates: [edit('bo', text.length, 0, 'X')] })),
    ).toBe('ok');
  });
});

describe('limits', () => {
  it('answers too-large for a long push or a big insertion, and rate-limited with a retry time', () => {
    const { authority, clock } = make({
      limits: { maxUpdates: 2, maxInserted: 10, rateMax: 3, rateWindowMs: 1000 },
    });
    join(authority, 'bo');
    const one = (n: number, len: number) => edit('bo', len, 0, 'x'.repeat(n));
    expect(
      code(authority.push('bo', { version: 0, epoch: 1, updates: [one(11, BASE.length)] })),
    ).toBe('too-large');
    const three = [one(1, BASE.length), one(1, BASE.length + 1), one(1, BASE.length + 2)];
    expect(code(authority.push('bo', { version: 0, epoch: 1, updates: three }))).toBe('too-large');
    ok(authority.push('bo', { version: 0, epoch: 1, updates: [one(1, BASE.length)] }));
    ok(authority.push('bo', { version: 1, epoch: 1, updates: [one(1, BASE.length + 1)] }));
    const limited = authority.push('bo', {
      version: 2,
      epoch: 1,
      updates: [one(1, BASE.length + 2)],
    });
    expect(limited).toMatchObject({ error: 'rate-limited' });
    expect((limited as ProtocolError).retryAfterMs).toBeGreaterThan(0);
    clock.advance(1001);
    ok(authority.push('bo', { version: 2, epoch: 1, updates: [one(1, BASE.length + 2)] }));
  });

  it('limits the length of the document', () => {
    const { authority } = make({ limits: { maxDocument: BASE.length + 2 } });
    join(authority, 'bo');
    expect(
      code(
        authority.push('bo', {
          version: 0,
          epoch: 1,
          updates: [edit('bo', BASE.length, 0, 'xxx')],
        }),
      ),
    ).toBe('too-large');
  });
});

describe('presence', () => {
  it('shows others’ states, expires them, and stores nothing', () => {
    const { authority, clock } = make();
    join(authority, 'ada');
    join(authority, 'bo');
    expect(authority.presence('ada', { caret: 3 })).toMatchObject({ ok: true, peers: [] });
    const seen = authority.presence('bo', { caret: 9 });
    expect(seen).toMatchObject({ peers: [{ handle: 'ada', state: { caret: 3 } }] });
    clock.advance(31_000);
    expect(authority.presence('bo', { caret: 10 })).toMatchObject({ peers: [] });
    expect(authority.presence('bo', null)).toMatchObject({ peers: [] });
    expect(authority.version).toBe(0);
    expect(code(authority.presence('bo', { text: 'x'.repeat(5000) }))).toBe('too-large');
  });
});

describe('the end', () => {
  it('answers ended to everything once the host closes the session', () => {
    const { authority } = make();
    join(authority, 'bo');
    authority.end();
    expect(code(authority.getDocument('bo'))).toBe('ended');
    expect(
      code(
        authority.push('bo', { version: 0, epoch: 1, updates: [edit('bo', BASE.length, 0, 'A')] }),
      ),
    ).toBe('ended');
    expect(
      code(
        authority.hello({
          credential: { key: 'bo' },
          clientID: 'bo',
          protocol: 1,
          format: 1,
          version: 0,
          epoch: 1,
        }),
      ),
    ).toBe('ended');
  });
});

describe('the write-ahead log', () => {
  it('writes every accepted update before it counts, and replay restores the session', () => {
    const wal = new MemoryLog();
    const { authority } = make({ wal });
    join(authority, 'ada');
    join(authority, 'bo');
    ok(
      authority.push('ada', { version: 0, epoch: 1, updates: [edit('ada', BASE.length, 0, 'AA')] }),
    );
    ok(
      authority.push('bo', {
        version: 0,
        epoch: 1,
        updates: [edit('bo', BASE.length, BASE.length - 1, 'BB')],
      }),
    );
    expect(wal.records()).toHaveLength(2);
    const { authority: restarted } = make({ wal });
    expect(restarted.text).toBe(authority.text);
    expect(restarted.version).toBe(2);
    expect(restarted.epoch).toBe(authority.epoch);
    join(restarted, 'bo');
    expect(restarted.pull('bo', 0)).toMatchObject({
      updates: [{ clientID: 'ada' }, { clientID: 'bo' }],
    });
  });

  it('does not count an update the log refused to write', () => {
    const wal = new MemoryLog();
    const { authority } = make({ wal });
    join(authority, 'bo');
    wal.append = () => {
      throw new Error('disk full');
    };
    expect(() =>
      authority.push('bo', { version: 0, epoch: 1, updates: [edit('bo', BASE.length, 0, 'A')] }),
    ).toThrow('disk full');
    expect(authority.version).toBe(0);
    expect(authority.text).toBe(BASE);
  });

  it('refuses a log that is out of order or does not fit', () => {
    const wal = new MemoryLog([
      {
        kind: 'update',
        epoch: 1,
        version: 2,
        clientID: 'a',
        by: 'a',
        at: 0,
        changes: ChangeSet.of({ from: 0, insert: 'x' }, BASE.length).toJSON(),
        footprint: [],
      },
    ]);
    expect(() => make({ wal })).toThrow(/not in order/);
    const wrong = new MemoryLog([
      {
        kind: 'update',
        epoch: 1,
        version: 1,
        clientID: 'a',
        by: 'a',
        at: 0,
        changes: ChangeSet.of({ from: 0, insert: 'x' }, 3).toJSON(),
        footprint: [],
      },
    ]);
    expect(() => make({ wal: wrong })).toThrow(/doesn't fit/);
  });
});

describe('takeover', () => {
  function session() {
    const wal = new MemoryLog();
    const { authority } = make({ wal });
    join(authority, 'ada');
    join(authority, 'bo');
    let length = BASE.length;
    for (let i = 0; i < 3; i++) {
      ok(
        authority.push('ada', {
          version: i,
          epoch: 1,
          updates: [edit('ada', length, 0, String(i))],
        }),
      );
      length += 1;
    }
    return { authority, wal };
  }

  it('starts epoch + 1 from a log prefix and refuses older epochs', () => {
    const { authority, wal } = session();
    const next = new MemoryLog();
    const taken = Authority.takeover({
      base: BASE,
      records: wal.records(),
      upTo: 2,
      wal: next,
      authenticate: (c) =>
        'key' in c ? (people[c.key] ?? { error: 'forbidden' }) : { error: 'forbidden' },
    });
    expect(taken.epoch).toBe(authority.epoch + 1);
    expect(taken.version).toBe(2);
    expect(taken.text).toBe(authority.text.slice(1));
    // A client of the old epoch is told to start over, and its push is refused.
    const old = join(taken, 'bo', 'bo', { epoch: 1, version: 3 });
    expect(old.reset).toBe(true);
    expect(
      taken.push('bo', { version: 2, epoch: 1, updates: [edit('bo', taken.text.length, 0, 'z')] }),
    ).toMatchObject({ error: 'stale', reason: 'epoch', epoch: 2 });
    // One that joins in the new epoch pushes.
    join(taken, 'bo', 'bo', { epoch: 2, version: 2 });
    ok(
      taken.push('bo', { version: 2, epoch: 2, updates: [edit('bo', taken.text.length, 0, 'z')] }),
    );
  });

  it('keeps the new epoch through a restart', () => {
    const { wal } = session();
    const next = new MemoryLog();
    const auth = (c: { key: string } | { token: string }) =>
      'key' in c
        ? (people[c.key] ?? { error: 'forbidden' as const })
        : { error: 'forbidden' as const };
    const taken = Authority.takeover({
      base: BASE,
      records: wal.records(),
      wal: next,
      authenticate: auth,
    });
    const restarted = new Authority({ base: BASE, wal: next, authenticate: auth });
    expect(restarted.epoch).toBe(taken.epoch);
    expect(restarted.text).toBe(taken.text);
  });
});

describe('with real clients', () => {
  /** Clients edit at random; stale pushes are dropped and re-read. The text always agrees. */
  function rng(seed: number) {
    let s = seed >>> 0;
    return () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 2 ** 32;
    };
  }

  function run(seed: number): void {
    const next = rng(seed);
    const { authority } = make();
    const ids = ['ada', 'bo'] as const;
    let clients = ids.map((id) => {
      join(authority, id);
      return EditorState.create({ doc: BASE, extensions: [collab({ clientID: id })] });
    });
    const catchUp = (i: number) => {
      const state = clients[i]!;
      const pulled = authority.pull(ids[i]!, getSyncedVersion(state));
      if (isError(pulled)) throw new Error(pulled.message);
      if (!pulled.updates.length) return;
      const updates = pulled.updates.map((u) => ({
        changes: ChangeSet.fromJSON(u.changes),
        clientID: u.clientID,
      }));
      clients[i] = receiveUpdates(state, updates).state;
    };
    for (let step = 0; step < 40; step++) {
      const i = Math.floor(next() * ids.length);
      const state = clients[i]!;
      const roll = next();
      if (roll < 0.6) {
        const at = Math.floor(next() * (state.doc.length + 1));
        clients[i] = state.update({
          changes: { from: at, insert: String.fromCharCode(97 + Math.floor(next() * 26)) },
        }).state;
      } else if (roll < 0.8) {
        catchUp(i);
      } else {
        const sendable = sendableUpdates(state);
        if (!sendable.length) continue;
        const reply = authority.push(ids[i]!, {
          version: getSyncedVersion(state),
          epoch: authority.epoch,
          updates: sendable.map(wireOf),
        });
        if (isError(reply)) {
          // Derive again: here, drop the edits and read the authority's text.
          const doc = authority.getDocument(ids[i]!);
          if (isError(doc)) throw new Error(doc.message);
          clients[i] = EditorState.create({
            doc: doc.text,
            extensions: [collab({ clientID: ids[i]!, startVersion: doc.version })],
          });
        }
      }
    }
    for (let round = 0; round < 2; round++) {
      for (let i = 0; i < ids.length; i++) {
        const state = clients[i]!;
        const sendable = sendableUpdates(state);
        if (sendable.length) {
          const reply = authority.push(ids[i]!, {
            version: getSyncedVersion(state),
            epoch: authority.epoch,
            updates: sendable.map(wireOf),
          });
          if (isError(reply)) {
            const doc = authority.getDocument(ids[i]!);
            if (isError(doc)) throw new Error(doc.message);
            clients[i] = EditorState.create({
              doc: doc.text,
              extensions: [collab({ clientID: ids[i]!, startVersion: doc.version })],
            });
          }
        }
        catchUp(i);
      }
    }
    clients = clients.map((c) => c);
    for (const c of clients) expect(c.doc.toString()).toBe(authority.text);
  }

  it('ends with the authority’s text on every client, over 300 random sessions', () => {
    for (let seed = 1; seed <= 300; seed++) run(seed);
  });

  it('a session replayed from its log gives the same text', () => {
    const wal = new MemoryLog();
    const { authority } = make({ wal });
    join(authority, 'ada');
    let length = BASE.length;
    for (let i = 0; i < 20; i++) {
      ok(
        authority.push('ada', { version: i, epoch: 1, updates: [edit('ada', length, i % 7, 'q')] }),
      );
      length++;
    }
    expect(make({ wal }).authority.text).toBe(authority.text);
  });
});

describe('hostile input', () => {
  it('answers an error, and never throws, for malformed messages', () => {
    const { authority } = make();
    join(authority, 'bo');
    const bad = (request: unknown) => authority.push('bo', request as never);
    expect(code(bad(null))).toBe('invalid');
    expect(code(bad({ version: 0, epoch: 1, updates: [null] }))).toBe('invalid');
    expect(code(bad({ version: 0, epoch: 1, updates: 'x' }))).toBe('invalid');
    expect(code(bad({ version: 'a', epoch: 1, updates: [] }))).toBe('stale');
    expect(
      code(bad({ version: 0, epoch: 1, updates: [{ clientID: 'bo', changes: [-5, [1]] }] })),
    ).toBe('invalid');
    const cyclic: Record<string, unknown> = {};
    cyclic.me = cyclic;
    expect(code(authority.presence('bo', cyclic))).toBe('too-large');
    const hello = (request: unknown) => authority.hello(request as never);
    expect(code(hello(null))).toBe('invalid');
    expect(
      code(hello({ credential: { key: 'bo' }, clientID: 'x', protocol: 'one', format: 1 })),
    ).toBe('invalid');
    expect(code(hello({ clientID: 'x', protocol: 1, format: 1 }))).toBe('invalid');
    expect(authority.version).toBe(0);
  });

  it('counts what a push changes whatever footprint it declares', () => {
    const { authority } = make();
    join(authority, 'ada');
    join(authority, 'bo');
    ok(
      authority.push('ada', { version: 0, epoch: 1, updates: [edit('ada', BASE.length, 5, 'XX')] }),
    );
    const hiding = edit('bo', BASE.length, 2, '', 6, { footprint: [] });
    expect(authority.push('bo', { version: 0, epoch: 1, updates: [hiding] })).toMatchObject({
      error: 'stale',
    });
    // And an empty declared footprint is logged with what the change touched.
    ok(
      authority.push('bo', {
        version: 1,
        epoch: 1,
        updates: [edit('bo', BASE.length + 2, 30, 'Q', 30, { footprint: [] })],
      }),
    );
    const pulled = authority.pull('bo', 1);
    if (isError(pulled)) throw new Error('pull');
    expect(pulled.updates[0]?.footprint).toEqual([{ from: 30, to: 30 }]);
  });

  it('binds a client id to the person who said hello with it', () => {
    const { authority } = make();
    join(authority, 'bo', 'shared-id');
    expect(
      code(
        authority.hello({
          credential: { key: 'ada' },
          clientID: 'shared-id',
          protocol: 1,
          format: 1,
          version: 0,
          epoch: 1,
        }),
      ),
    ).toBe('forbidden');
    // The same person may come back with it.
    join(authority, 'bo', 'shared-id');
  });

  it('limits the length of the document after a rebase too', () => {
    const { authority } = make({ limits: { maxDocument: BASE.length + 4 } });
    join(authority, 'ada');
    join(authority, 'bo');
    ok(
      authority.push('ada', {
        version: 0,
        epoch: 1,
        updates: [edit('ada', BASE.length, 0, 'aaa')],
      }),
    );
    expect(
      code(
        authority.push('bo', {
          version: 0,
          epoch: 1,
          updates: [edit('bo', BASE.length, 30, 'bbb')],
        }),
      ),
    ).toBe('too-large');
  });

  it('counts a push by its updates when it limits the rate', () => {
    const { authority } = make({ limits: { rateMax: 3, rateWindowMs: 1000 } });
    join(authority, 'bo');
    const two = [edit('bo', BASE.length, 0, 'a'), edit('bo', BASE.length + 1, 0, 'b')];
    ok(authority.push('bo', { version: 0, epoch: 1, updates: two }));
    ok(
      authority.push('bo', {
        version: 2,
        epoch: 1,
        updates: [edit('bo', BASE.length + 2, 0, 'c')],
      }),
    );
    expect(
      code(
        authority.push('bo', {
          version: 3,
          epoch: 1,
          updates: [edit('bo', BASE.length + 3, 0, 'd')],
        }),
      ),
    ).toBe('rate-limited');
  });
});

export type { Role };
