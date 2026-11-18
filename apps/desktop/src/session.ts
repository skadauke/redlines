// One document in several windows of this app (docs/research/collaboration.md, "One app as the
// authority"). The windows of a document are a session: one of them, the leader, runs the
// authority and saves the file; the others are its clients, and talk to it by events between the
// windows. The app (`src-tauri/src/session.rs`) says who leads, counts the epochs and keeps the
// authority's log, so that a window that takes over begins from what was confirmed.
//
// Nothing here knows Tauri: `SessionPorts` is what a page asks of the app and of the other
// windows, and `session-tauri.ts` fills it. A test fills it with two pages in one process.

import {
  Authority,
  Hub,
  memoryTransport,
  type AuthResult,
  type Call,
  type DurableLog,
  type Notice,
  type Peer,
  type Reply,
  type Transport,
  type WalRecord,
} from '@redlines/collab';
import type { Editor } from '@redlines/editor';
import { PALETTE, syncEditor, syncText, type SyncBinding, type SyncState } from '@redlines/sync';

/** What the app answers a window that joins a document's session. */
export interface Joined {
  leader: string;
  epoch: number;
  leading: boolean;
  /** The log an earlier run left, for the window that starts the session. */
  left: { base: string; records: string[] } | null;
}

/** What the app tells the members when the leader changes. */
export interface Moved {
  path: string;
  leader: string;
  epoch: number;
}

/** What a page asks of the app and of the other windows. */
export interface SessionPorts {
  /** This window's label. */
  readonly label: string;
  join(path: string): Promise<Joined>;
  walStart(path: string, epoch: number, base: string): Promise<void>;
  walAppend(path: string, epoch: number, lines: string[]): Promise<void>;
  walRead(path: string): Promise<{ base: string; records: string[] } | null>;
  /** The windows of the session, which only a member may ask. */
  members(path: string): Promise<string[]>;
  leave(path: string): Promise<void>;
  /** Sends an event to one window. */
  send(label: string, event: string, payload: unknown): Promise<void>;
  /** Listens for an event sent to this window. Resolves to the way to stop. */
  listen(event: string, handler: (payload: unknown) => void): Promise<() => void>;
}

/** The names of the events between windows (the app's own is `session-moved`). */
export const EVENTS = {
  call: 'session-call',
  reply: 'session-reply',
  notice: 'session-notice',
  moved: 'session-moved',
  left: 'session-left',
  save: 'session-save',
  saved: 'session-saved',
} as const;

export interface SessionOptions {
  path: string;
  /** Who this window's person is, as the ledger names them. */
  person: { handle: string; name: string };
  /** What the file holds, as far as this window knows: the leader tells it to a window that joins. */
  diskText?(): string | null;
  /** Writes the file, which only the leader does. Resolves to the text written, or null. */
  save(): Promise<string | null>;
  /** The leader wrote the file: this is what it holds. */
  onSaved?(text: string): void;
  /** The authority's text replaced the editor's (a window that joined). */
  onLoaded?(): void;
  /** This window leads from now on: the window that did closed. */
  onLead?(): void;
  onState?(state: SyncState): void;
  /** The other windows of the session changed. */
  onPeers?(peers: readonly Peer[]): void;
  notice?(message: string): void;
  /**
   * The window has no text of its own and joins a session that is there: if there is none, it
   * rejects, having left, rather than start one from nothing.
   */
  follow?: boolean;
  /** How long the leader waits after the last change before it saves. */
  saveDelayMs?: number;
}

export interface Session {
  readonly path: string;
  readonly binding: SyncBinding;
  /** Whether this window leads: it runs the authority and writes the file. */
  readonly leading: boolean;
  /** How many windows are in the session, for the leader; one for any other window. */
  readonly members: number;
  /** Whether everything this window made is confirmed by the authority. */
  readonly confirmed: boolean;
  /** Has the file written, by the leader, and resolves to the text it holds or null. */
  save(): Promise<string | null>;
  /** Leaves the session. The editor keeps its text. */
  stop(): Promise<void>;
}

const TIMEOUT = 8000;

/** A transport whose target can change: to the leader's window, or to a hub of this window's own. */
class Switch implements Transport {
  #target: Transport;
  readonly #handlers = new Set<(notice: Notice) => void>();
  #stop: (() => void) | null = null;

  constructor(target: Transport) {
    this.#target = target;
    this.#follow();
  }

  use(target: Transport): void {
    this.#stop?.();
    this.#target = target;
    this.#follow();
  }

  #follow(): void {
    this.#stop = this.#target.subscribe((notice) => {
      for (const handler of this.#handlers) handler(notice);
    });
  }

  call(call: Call): Promise<Reply> {
    return this.#target.call(call);
  }

  subscribe(handler: (notice: Notice) => void): () => void {
    this.#handlers.add(handler);
    return () => void this.#handlers.delete(handler);
  }
}

/** The transport of a window that is not the leader: calls go to the leader's window as events. */
class Remote implements Transport {
  leader: string;
  readonly #ports: SessionPorts;
  readonly #waiting = new Map<
    number,
    { resolve: (reply: Reply) => void; reject: (e: Error) => void }
  >();
  readonly #handlers = new Set<(notice: Notice) => void>();
  #next = 0;

  constructor(ports: SessionPorts, leader: string) {
    this.#ports = ports;
    this.leader = leader;
  }

  call(call: Call): Promise<Reply> {
    const id = ++this.#next;
    return new Promise<Reply>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#waiting.delete(id);
        reject(new Error('The window that leads the session did not answer.'));
      }, TIMEOUT);
      this.#waiting.set(id, {
        resolve: (reply) => {
          clearTimeout(timer);
          resolve(reply);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.#ports
        .send(this.leader, EVENTS.call, { from: this.#ports.label, id, call })
        .catch((error: unknown) => {
          clearTimeout(timer);
          this.#waiting.delete(id);
          reject(error instanceof Error ? error : new Error(String(error)));
        });
    });
  }

  subscribe(handler: (notice: Notice) => void): () => void {
    this.#handlers.add(handler);
    return () => void this.#handlers.delete(handler);
  }

  replied(id: number, reply: Reply): void {
    this.#waiting.get(id)?.resolve(reply);
    this.#waiting.delete(id);
  }

  /** The leader changed: what was asked of the old one will not be answered. */
  retarget(leader: string): void {
    this.leader = leader;
    for (const { reject } of this.#waiting.values()) reject(new Error('The leader changed.'));
    this.#waiting.clear();
  }

  heard(notice: Notice): void {
    for (const handler of this.#handlers) handler(notice);
  }
}

/**
 * The authority's log, kept by the app. `append` is synchronous, as the authority needs; the
 * records reach the app in batches, and `flushed` resolves when they have. A refusal (this window
 * was replaced as the leader) is kept, and every later `flushed` rejects with it.
 */
export class PortLog implements DurableLog {
  readonly #ports: SessionPorts;
  readonly #path: string;
  readonly #epoch: number;
  readonly #all: WalRecord[] = [];
  #queue: WalRecord[] = [];
  #chain: Promise<void> = Promise.resolve();
  #failure: Error | null = null;

  constructor(ports: SessionPorts, path: string, epoch: number) {
    this.#ports = ports;
    this.#path = path;
    this.#epoch = epoch;
  }

  append(record: WalRecord): void {
    this.#all.push(record);
    this.#queue.push(record);
  }

  records(): readonly WalRecord[] {
    return this.#all;
  }

  flushed(): Promise<void> {
    if (this.#failure) return Promise.reject(this.#failure);
    const lines = this.#queue.map((record) => JSON.stringify(record));
    this.#queue = [];
    if (lines.length) {
      this.#chain = this.#chain.then(async () => {
        if (this.#failure) throw this.#failure;
        try {
          await this.#ports.walAppend(this.#path, this.#epoch, lines);
        } catch (error) {
          this.#failure = error instanceof Error ? error : new Error(String(error));
          throw this.#failure;
        }
      });
    }
    return this.#chain;
  }
}

/**
 * The number a window is known by in a session: the main window is the first, `doc-<n>` the one
 * after it. It comes from the label, so that the window that leads next gives every window the
 * same name and color as the one before it.
 */
export function ordinalOf(label: string): number {
  const found = /(\d+)$/.exec(label);
  return label === 'main' || !found ? 1 : Number(found[1]) + 1;
}

/**
 * Anyone in a session of this app's windows may be in it: they are the person's own. Each window is
 * named for its number, and has a color of its own that every window shows it in.
 */
function authenticateFor(person: { handle: string; name: string }) {
  return (credential: unknown): AuthResult => {
    if (typeof credential !== 'object' || credential === null || !('key' in credential)) {
      return { error: 'forbidden' };
    }
    const n = ordinalOf(String(credential.key));
    return {
      handle: person.handle,
      name: `${person.name} (window ${n})`,
      role: 'owner',
      color: PALETTE[(n - 1) % PALETTE.length]!,
    };
  };
}

/** Joins the session of the document `options.path`, or starts it when there is none. */
export async function joinSession(
  ports: SessionPorts,
  editor: Editor,
  options: SessionOptions,
): Promise<Session> {
  const { path } = options;
  const off: (() => void)[] = [];
  const listen = async (event: string, handler: (payload: unknown) => void) => {
    off.push(await ports.listen(event, handler));
  };
  // Listening starts before the app counts this window in: the leader may close in between, and
  // the app tells the next window once.
  let onMoved: ((moved: Moved) => void) | null = null;
  const early: Moved[] = [];
  await listen(EVENTS.moved, (payload) => {
    const moved = payload as Moved;
    if (moved.path !== path) return;
    if (onMoved) onMoved(moved);
    else early.push(moved);
  });
  const joined = await ports.join(path);
  if (options.follow && joined.leading) {
    await ports.leave(path).catch(() => {});
    for (const stop of off) stop();
    throw new Error('The window that showed this document has closed.');
  }
  const authenticate = authenticateFor(options.person);
  let hub: Hub | null = null;
  let leading = joined.leading;
  let leader = joined.leader;
  let epoch = joined.epoch;
  /** Which window each client of the hub is in. */
  const windowOf = new Map<string, string>();
  let remote: Remote | null = null;
  let saving: Promise<string | null> | null = null;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  const waitingSaves = new Map<number, (text: string | null) => void>();
  let saveIds = 0;
  let stopped = false;

  /** Starts the authority in this window, from `log` when there is one to begin from. */
  const host = async (
    base: string,
    log: { base: string; records: string[] } | null,
  ): Promise<Hub> => {
    await ports.walStart(path, epoch, log ? log.base : base);
    const wal = new PortLog(ports, path, epoch);
    const authority = log
      ? Authority.takeover({
          base: log.base,
          records: log.records.map((line) => JSON.parse(line) as WalRecord),
          epoch: epoch - 1,
          wal,
          authenticate,
        })
      : new Authority({ base, epoch, wal, authenticate });
    const made = new Hub(authority, wal);
    made.onNotice((to, notice) => {
      const label = windowOf.get(to);
      if (label && label !== ports.label) {
        void ports.send(label, EVENTS.notice, { clientID: to, notice }).catch(() => {});
      }
    });
    made.onLogged(() => saveSoon());
    // What a takeover or a restore wrote to the new log is stored before anyone is answered: until
    // then the app's log holds the base alone, and a second handover would begin from that.
    await wal.flushed();
    return made;
  };

  const saveNow = (): Promise<string | null> => {
    saving ??= (async () => {
      try {
        if (!hub) return null;
        // What is shown is what the authority holds, or the file would lag behind the session.
        for (let tries = 0; tries < 250; tries++) {
          const settled =
            binding.replica.pending.length === 0 &&
            binding.replica.version === hub.authority.version;
          if (settled) break;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        const text = await options.save();
        if (text !== null) {
          options.onSaved?.(text);
          for (const label of new Set(windowOf.values())) {
            if (label !== ports.label) {
              void ports.send(label, EVENTS.saved, { text }).catch(() => {});
            }
          }
        }
        return text;
      } finally {
        saving = null;
      }
    })();
    return saving;
  };

  function saveSoon(): void {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      void saveNow().catch((error: unknown) => console.error('Could not save the session', error));
    }, options.saveDelayMs ?? 1000);
  }

  /** While this window takes the lead over, a call that comes waits for the hub. */
  let taking: Promise<void> | null = null;
  let served = false;

  /** Answers the calls other windows make to this one, the leader. Listens once. */
  const serve = async () => {
    if (served) return;
    served = true;
    await listen(EVENTS.call, (payload) => {
      const { from, id, call } = payload as { from: string; id: number; call: Call };
      const answer = (reply: Reply) => ports.send(from, EVENTS.reply, { id, reply });
      const refuse = () =>
        answer({ ok: false, error: 'forbidden', message: 'Not a window of this session.' });
      void (async () => {
        // The others ask as soon as the app says who leads, which this window may not have heard
        // yet: the answer waits for the hub, for a moment.
        for (let tries = 0; tries < 30 && !stopped && !(leading && hub); tries++) {
          if (taking) await taking.catch(() => {});
          else await new Promise((resolve) => setTimeout(resolve, 100));
        }
        if (!hub || !leading) return;
        if (call.call === 'hello') {
          // Only a window the app counts in the session may join it.
          const members = await ports.members(path).catch(() => [] as string[]);
          if (!members.includes(from)) return refuse();
          windowOf.set(call.request.clientID, from);
        } else if (windowOf.get(call.clientID) !== from) {
          // A client is its window's: no window speaks for another's.
          return refuse();
        }
        const reply = await hub.handle(call);
        await answer(reply);
        // A window that joins is told what the file holds, to know what is unsaved.
        const disk = options.diskText?.() ?? null;
        if (call.call === 'hello' && reply.ok && disk !== null) {
          await ports.send(from, EVENTS.saved, { text: disk });
        }
      })().catch(() => {});
    });
    // A window closed: its client is out of the session, and its caret with it.
    await listen(EVENTS.left, (payload) => {
      const { window } = payload as { window: string };
      for (const [id, label] of [...windowOf]) {
        if (label !== window) continue;
        windowOf.delete(id);
        void hub?.handle({ call: 'leave', clientID: id });
      }
    });
    await listen(EVENTS.save, (payload) => {
      const { from, id } = payload as { from: string; id: number };
      void saveNow()
        .catch(() => null)
        .then((text) => ports.send(from, EVENTS.saved, { id, text }));
    });
  };

  const clientID = `${ports.label}`;
  let transport: Switch;
  // What the leader answers, and tells: heard by every window, for one that leads may be replaced.
  await listen(EVENTS.reply, (payload) => {
    const { id, reply } = payload as { id: number; reply: Reply };
    remote?.replied(id, reply);
  });
  await listen(EVENTS.notice, (payload) => {
    remote?.heard((payload as { notice: Notice }).notice);
  });
  // Every window listens for calls: the one that leads next must not miss the first.
  await serve();
  if (leading) {
    const left =
      joined.left && joined.left.base === syncText(editor.view.state) ? joined.left : null;
    hub = await host(syncText(editor.view.state), left);
    windowOf.set(clientID, ports.label);
    transport = new Switch(memoryTransport(hub, clientID));
    if (left && hub.authority.text !== syncText(editor.view.state)) {
      // What the last run confirmed and never saved comes back, as a reload does: unsaved.
      editor.reloadDoc(hub.authority.text);
    }
  } else {
    remote = new Remote(ports, leader);
    transport = new Switch(remote);
  }
  await listen(EVENTS.saved, (payload) => {
    const { id, text } = payload as { id?: number; text: string | null };
    if (id !== undefined) {
      waitingSaves.get(id)?.(text);
      waitingSaves.delete(id);
    }
    if (text !== null) options.onSaved?.(text);
  });

  const binding = syncEditor(editor, {
    transport,
    clientID,
    credential: { key: ports.label },
    hosts: leading,
    ...(leading && hub ? { version: hub.authority.version } : {}),
    notice: (message) => options.notice?.(message),
    onState: (state) => options.onState?.(state),
    onPeers: (peers) => options.onPeers?.(peers),
    onLoaded: () => options.onLoaded?.(),
    retryMs: 500,
  });

  // The app says who leads. A window that is now the leader takes the log over, and the others
  // look for the new leader.
  const moved = (change: Moved): void => {
    epoch = change.epoch;
    leader = change.leader;
    if (change.leader === ports.label) {
      if (!leading) takeOver();
    } else if (leading) demote(change.leader);
    else if (remote) {
      remote.retarget(change.leader);
      binding.client.rejoin();
    }
  };
  onMoved = moved;
  for (const change of early.splice(0)) moved(change);

  function takeOver(): void {
    if (taking) return;
    // Set before anything waits: the others ask the moment the app says who leads, and a call
    // that comes meanwhile waits for the hub (`serve`).
    const forEpoch = epoch;
    taking = (async () => {
      try {
        const log = await ports.walRead(path);
        if (!log) throw new Error('The session has no log to take over from.');
        // Another window may have been made the leader since: this one is not, then.
        if (epoch !== forEpoch || leader !== ports.label) return;
        windowOf.clear();
        windowOf.set(clientID, ports.label);
        hub = await host(log.base, log);
        leading = true;
        remote?.retarget(ports.label);
        transport.use(memoryTransport(hub, clientID));
        remote = null;
        binding.client.rejoin();
        options.onLead?.();
      } catch (error) {
        console.error('Could not take over the session', error);
        options.notice?.('The session could not go on in this window.');
      }
    })().finally(() => {
      taking = null;
    });
  }

  /** The window that led was replaced (a tab that hung, and ran again): it hosts no more. */
  function demote(to: string): void {
    hub?.authority.end();
    hub = null;
    leading = false;
    windowOf.clear();
    if (saveTimer) clearTimeout(saveTimer);
    remote = new Remote(ports, to);
    transport.use(remote);
    binding.client.rejoin();
  }

  const session: Session = {
    path,
    binding,
    get leading() {
      return leading;
    },
    get members() {
      return hub ? Math.max(1, hub.members.length) : 1;
    },
    get confirmed() {
      return binding.replica.pending.length === 0 && binding.client.state === 'synced';
    },
    save: () => {
      if (leading) return saveNow();
      const id = ++saveIds;
      return new Promise<string | null>((resolve) => {
        const timer = setTimeout(() => {
          waitingSaves.delete(id);
          resolve(null);
        }, TIMEOUT);
        waitingSaves.set(id, (text) => {
          clearTimeout(timer);
          resolve(text);
        });
        ports.send(leader, EVENTS.save, { from: ports.label, id }).catch(() => {
          clearTimeout(timer);
          waitingSaves.delete(id);
          resolve(null);
        });
      });
    },
    stop: async () => {
      stopped = true;
      if (saveTimer) clearTimeout(saveTimer);
      await binding.stop();
      for (const stop of off) stop();
      await ports.leave(path).catch(() => {});
    },
  };
  void binding.settled();
  return session;
}
