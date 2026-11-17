// The host of an authority: it takes calls from any transport, answers them, and tells the other
// clients what changed. The authority stays pure; the hub is the one place that waits for the log
// to be stored (`DurableLog.flushed`) before a client is told its push is in.

import type { Authority } from './authority.ts';
import type { ProtocolError } from './protocol.ts';
import type { Call, Notice, Reply } from './wire.ts';
import type { DurableLog } from './wal.ts';

export type NoticeListener = (to: string, notice: Notice) => void;

export class Hub {
  readonly authority: Authority;
  private readonly log: DurableLog | null;
  private readonly listeners = new Set<NoticeListener>();
  private readonly clients = new Set<string>();
  /** Calls are answered in the order they came: the authority's log is one line. */
  private tail: Promise<unknown> = Promise.resolve();

  constructor(authority: Authority, log: DurableLog | null = null) {
    this.authority = authority;
    this.log = log;
  }

  /** Who hears of what the hub says: `to` is a client's id. */
  onNotice(listener: NoticeListener): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  /** The clients that said hello and have not left. */
  get members(): readonly string[] {
    return [...this.clients];
  }

  handle(call: Call): Promise<Reply> {
    const run = this.tail.then(() => this.run(call));
    this.tail = run.catch(() => undefined);
    return run;
  }

  /** Tells every client that the session moved to another epoch, or ended. */
  announce(notice: Notice): void {
    for (const id of this.clients) this.tell(id, notice);
  }

  private tell(to: string, notice: Notice): void {
    for (const listener of this.listeners) listener(to, notice);
  }

  private async run(call: Call): Promise<Reply> {
    const { authority } = this;
    switch (call.call) {
      case 'hello': {
        const reply = authority.hello(call.request);
        if (reply.ok) this.clients.add(call.request.clientID);
        return reply;
      }
      case 'getDocument':
        return authority.getDocument(call.clientID);
      case 'pull':
        return authority.pull(call.clientID, call.since, call.limit);
      case 'push': {
        const reply = authority.push(call.clientID, call.request);
        if (!reply.ok) return reply;
        const stored = await this.stored();
        if (stored) return stored;
        for (const id of this.clients) {
          if (id !== call.clientID) {
            this.tell(id, { kind: 'version', version: reply.version, epoch: reply.epoch });
          }
        }
        return reply;
      }
      case 'presence': {
        const reply = authority.presence(call.clientID, call.state);
        if (reply.ok) this.sharePresence(call.clientID);
        return reply;
      }
      case 'leave': {
        authority.presence(call.clientID, null);
        this.clients.delete(call.clientID);
        this.sharePresence(call.clientID);
        return { ok: true };
      }
    }
  }

  private sharePresence(except: string): void {
    for (const id of this.clients) {
      if (id !== except) this.tell(id, { kind: 'peers', peers: this.authority.peers(id) });
    }
  }

  /** Waits for the log; a log that could not store a record ends the session. */
  private async stored(): Promise<ProtocolError | null> {
    if (!this.log) return null;
    try {
      await this.log.flushed();
      return null;
    } catch {
      this.authority.end();
      this.announce({ kind: 'ended' });
      return {
        ok: false,
        error: 'ended',
        message: 'The session could not write its log, and ended.',
      };
    }
  }
}
