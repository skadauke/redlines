// The tabs of a browser as the windows of a session (the plain-browser page of the app, and the
// website's embed one day). The app's own windows have the app to say who leads, count the epochs
// and keep the log (`src-tauri/src/session.rs`); tabs have none, so the same things are done by
// what a browser gives them:
//
// - who leads: a Web Lock on the document, held by the leader for as long as it lives. The tabs
//   that wait for it are the followers, and the next one is granted it when the leader's tab
//   closes. A tab that hangs keeps its lock, so the leader says it is alive every second
//   (a heartbeat on a BroadcastChannel) and a follower that hears nothing for five seconds
//   steals the lock; the old leader's lock is revoked, and it finds out when it runs again.
// - the epochs, and the log: one store that every tab can reach (IndexedDB in a browser), in which
//   taking the lead raises the epoch and a write names its own: a leader that was replaced and
//   writes late, from a page that was frozen, is refused, as the app refuses it.
//
// It fills `SessionPorts` (`session.ts`), so a tab hosts or joins a session as a window does. Nothing
// here touches a browser global: `TabEnv` is what it needs, and `session-browser.ts` fills it.

import type { Joined, Moved, SessionPorts } from './session.ts';
import { EVENTS } from './session.ts';

/** A message between tabs. */
export type TabMessage =
  /** A tab that joined asks who leads. */
  | { kind: 'hello'; from: string }
  /** The leader is alive: its label and epoch. Followers learn who leads from it. */
  | { kind: 'beat'; from: string; epoch: number }
  /** Every tab says it is here, for the leader to count. */
  | { kind: 'here'; from: string }
  /** A tab is going. */
  | { kind: 'bye'; from: string }
  /** An event for one tab. */
  | { kind: 'event'; from: string; to: string; event: string; payload: unknown };

export interface TabChannel {
  post(message: TabMessage): void;
  /** Listens to what the other tabs post. Returns the way to stop. */
  listen(handler: (message: TabMessage) => void): () => void;
}

export interface TabLocks {
  /**
   * Holds the lock `name` while `held` is pending. `granted` is false when `ifAvailable` and it is
   * held by another. With `steal`, the holder's lock is revoked and this one is held at once. The
   * returned promise settles when the lock is released, or rejects when it was stolen.
   */
  request(
    name: string,
    options: { steal?: boolean; ifAvailable?: boolean },
    held: (granted: boolean) => Promise<void>,
  ): Promise<void>;
}

/** The log and the epochs, kept where every tab of the document can reach them. */
export interface TabStore {
  /** Raises the epoch by one, and says it. */
  bumpEpoch(): Promise<number>;
  epoch(): Promise<number>;
  /** Starts the log over from `base`. Refused to an epoch that is over. */
  start(epoch: number, base: string): Promise<void>;
  /** Adds records. Refused to an epoch that is over. */
  append(epoch: number, lines: readonly string[]): Promise<void>;
  read(): Promise<{ base: string; records: string[] } | null>;
}

export interface TabEnv {
  /** This tab's label. */
  label: string;
  /** The document's name, which the lock and the channel are named for. */
  path: string;
  channel: TabChannel;
  locks: TabLocks;
  store: TabStore;
  /** How often the leader says it is alive; five times that of silence and a follower steals. */
  heartbeatMs?: number;
}

const LOCK = 'redlines-session:';

type Handler = (payload: unknown) => void;

export class TabPorts implements SessionPorts {
  readonly label: string;
  readonly #env: TabEnv;
  readonly #beat: number;
  readonly #handlers = new Map<string, Set<Handler>>();
  /** When each tab was last heard of. */
  readonly #seen = new Map<string, number>();
  #leader: string | null = null;
  #epoch = 0;
  #leading = false;
  #lastBeat = 0;
  #timer: ReturnType<typeof setInterval> | null = null;
  #stop: (() => void) | null = null;
  #left = false;
  /** Frozen for a test: a tab whose page is not running says and hears nothing. */
  #frozen = false;

  constructor(env: TabEnv) {
    this.#env = env;
    this.label = env.label;
    this.#beat = env.heartbeatMs ?? 1000;
  }

  get leading(): boolean {
    return this.#leading;
  }

  /** Stops this tab as a browser freezes a page: no heartbeat and no hearing, the lock still held. */
  freeze(): void {
    this.#frozen = true;
  }

  /** The page runs again. */
  thaw(): void {
    this.#frozen = false;
    // What it missed is told at once: the others' beats, which say who leads now.
    this.#env.channel.post({ kind: 'hello', from: this.label });
  }

  // --- SessionPorts -----------------------------------------------------------------------------

  async join(path: string): Promise<Joined> {
    this.#ofThisDocument(path);
    const env = this.#env;
    this.#stop = env.channel.listen((message) => this.#heard(message));
    env.channel.post({ kind: 'hello', from: this.label });
    // The lock is asked for at once: granted, this tab leads; otherwise it waits, and is granted
    // it when the leader's tab closes.
    const granted = await this.#claim();
    if (!granted) {
      // Who leads? Its next beat says; one the tab asks for is answered at once.
      await this.#untilHeard(400);
      if (this.#leader === null) {
        // Nobody answered: the silence is timed from now, and the lock is taken if it goes on.
        this.#leader = '?';
        this.#lastBeat = Date.now();
      }
    }
    this.#timer = setInterval(() => this.#tick(), this.#beat);
    return {
      leader: this.#leader ?? this.label,
      epoch: this.#epoch,
      leading: this.#leading,
      left: null,
    };
  }

  async walStart(path: string, epoch: number, base: string): Promise<void> {
    this.#ofThisDocument(path);
    await this.#env.store.start(epoch, base);
  }

  async walAppend(path: string, epoch: number, lines: string[]): Promise<void> {
    this.#ofThisDocument(path);
    await this.#env.store.append(epoch, lines);
  }

  async walRead(): Promise<{ base: string; records: string[] } | null> {
    return this.#env.store.read();
  }

  members(): Promise<string[]> {
    const now = Date.now();
    const live = [...this.#seen]
      .filter(([label, at]) => label !== this.label && now - at < this.#beat * 5)
      .map(([label]) => label);
    return Promise.resolve([this.label, ...live]);
  }

  leave(): Promise<void> {
    if (this.#left) return Promise.resolve();
    this.#left = true;
    if (this.#timer) clearInterval(this.#timer);
    this.#env.channel.post({ kind: 'bye', from: this.label });
    this.#stop?.();
    this.#releaseLock?.();
    this.#leading = false;
    return Promise.resolve();
  }

  send(label: string, event: string, payload: unknown): Promise<void> {
    if (this.#frozen) return Promise.resolve();
    if (label === this.label) {
      this.#deliver(event, payload);
      return Promise.resolve();
    }
    this.#env.channel.post({ kind: 'event', from: this.label, to: label, event, payload });
    return Promise.resolve();
  }

  listen(event: string, handler: Handler): Promise<() => void> {
    const set = this.#handlers.get(event) ?? new Set<Handler>();
    this.#handlers.set(event, set);
    set.add(handler);
    return Promise.resolve(() => void set.delete(handler));
  }

  /** These ports serve one document; a page names its own path, and any other is a mistake. */
  #ofThisDocument(path: string): void {
    if (path !== this.#env.path)
      throw new Error(`These ports are for ${this.#env.path}, not ${path}.`);
  }

  // --- leading ----------------------------------------------------------------------------------

  #releaseLock: (() => void) | null = null;
  /** Counts the grants of the lock; one that was lost or left no longer leads. */
  #grant = 0;
  #claiming: Promise<boolean> | null = null;

  /** Asks for the lock. Resolves to whether it was granted at once. */
  #claim(): Promise<boolean> {
    this.#claiming ??= new Promise<boolean>((resolve) => {
      let first = true;
      const answer = (granted: boolean) => {
        if (first) resolve(granted);
        first = false;
      };
      // Held while the tab leads: the lock is released by `leave`, or by the page ending.
      this.#env.locks
        .request(LOCK + this.#env.path, { ifAvailable: true }, (granted) => {
          if (!granted) {
            answer(false);
            // Wait in line for it: the leader's tab may close.
            return this.#env.locks.request(LOCK + this.#env.path, {}, (now) => this.#lead(now));
          }
          // Granted: it is answered once this tab leads, which takes a moment (the epoch is stored).
          return this.#lead(true, () => answer(true));
        })
        .catch(() => {
          // Stolen, or the store failed: this tab leads no more, and `join` need not wait.
          this.#lost();
          answer(false);
        });
    });
    return this.#claiming;
  }

  /** The lock is this tab's: it leads, in a new epoch, until it lets go of it. */
  async #lead(granted: boolean, led?: () => void): Promise<void> {
    if (!granted || this.#left) return;
    const grant = ++this.#grant;
    const epoch = await this.#env.store.bumpEpoch();
    // Left, or the lock was stolen, while the epoch was stored: it is not this tab's to lead.
    if (this.#left || grant !== this.#grant) {
      led?.();
      return;
    }
    this.#epoch = epoch;
    this.#leading = true;
    this.#leader = this.label;
    this.#lastBeat = Date.now();
    this.#beating();
    // A tab that takes over from another tells its own windows, as the app does.
    this.#deliver(EVENTS.moved, {
      path: this.#env.path,
      leader: this.label,
      epoch,
    } satisfies Moved);
    led?.();
    await new Promise<void>((release) => {
      this.#releaseLock = release;
    });
  }

  /** The lock was stolen: this tab leads no more. */
  #lost(): void {
    this.#grant++;
    this.#leading = false;
  }

  #beating(): void {
    if (this.#frozen) return;
    this.#env.channel.post({ kind: 'beat', from: this.label, epoch: this.#epoch });
  }

  #tick(): void {
    if (this.#frozen || this.#left) return;
    this.#env.channel.post({ kind: 'here', from: this.label });
    if (this.#leading) {
      this.#beating();
      // A tab that stopped saying it is here has gone: its caret goes with it.
      const now = Date.now();
      for (const [label, at] of this.#seen) {
        if (now - at > this.#beat * 5) {
          this.#seen.delete(label);
          this.#deliver(EVENTS.left, { path: this.#env.path, window: label });
        }
      }
      return;
    }
    // The leader says it is alive each second. Silent for five, it is frozen or gone: this tab takes
    // the lock from it. Another follower may do the same at the same moment; the lock has one holder.
    if (this.#leader !== null && Date.now() - this.#lastBeat > this.#beat * 5) {
      this.#leader = null;
      void this.#steal();
    }
  }

  async #steal(): Promise<void> {
    try {
      await this.#env.locks.request(LOCK + this.#env.path, { steal: true }, (granted) =>
        this.#lead(granted),
      );
    } catch {
      // Stolen from this tab in turn, or the store failed: it is tried again after the next silence.
      this.#lost();
      this.#leader = '?';
      this.#lastBeat = Date.now();
    }
  }

  // --- hearing ----------------------------------------------------------------------------------

  #untilHeard(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const started = Date.now();
      const check = () => {
        if (this.#leader !== null || Date.now() - started >= ms) resolve();
        else setTimeout(check, 20);
      };
      check();
    });
  }

  #heard(message: TabMessage): void {
    if (this.#frozen || this.#left || message.from === this.label) return;
    this.#seen.set(message.from, Date.now());
    switch (message.kind) {
      case 'hello':
        // The leader answers at once, so the tab that asked need not wait for the next beat.
        if (this.#leading) this.#beating();
        return;
      case 'beat':
        this.#learnLeader(message.from, message.epoch);
        return;
      case 'bye':
        this.#seen.delete(message.from);
        if (this.#leading) {
          this.#deliver(EVENTS.left, { path: this.#env.path, window: message.from });
        }
        return;
      case 'event':
        if (message.to === this.label) this.#deliver(message.event, message.payload);
        return;
      case 'here':
        return;
    }
  }

  /** A beat from a leader: a newer epoch than this tab knows is a new leader, which every window is told. */
  #learnLeader(from: string, epoch: number): void {
    if (epoch < this.#epoch) return;
    this.#lastBeat = Date.now();
    if (epoch === this.#epoch && from === this.#leader) return;
    const changed = this.#leader !== null && this.#epoch > 0;
    this.#leader = from;
    this.#epoch = epoch;
    // A tab that led and is replaced learns it here: it leads no more.
    this.#leading = false;
    if (changed) {
      this.#deliver(EVENTS.moved, { path: this.#env.path, leader: from, epoch } satisfies Moved);
    }
  }

  #deliver(event: string, payload: unknown): void {
    for (const handler of this.#handlers.get(event) ?? []) handler(payload);
  }
}
