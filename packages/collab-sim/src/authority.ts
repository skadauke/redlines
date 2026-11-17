// The reference authority (multiuser §4.1): an ordered log of confirmed updates, the current text,
// and the rebase rules of collaboration.md. It never reads a mark. It orders, and it compares
// ranges.
//
// - c1: a push based on an older version is rejected, and the client derives it again.
// - c2: a stale push is rebased, one logged update at a time, unless its footprint touches the
//   footprint of an update logged since its base ("touching ends count"); then it is rejected.
// - naive: a stale push is always rebased, by mapping its positions. The earlier design's
//   mistake with re-deriving clients: the authority still transforms what it can't know.

import { applyChanges } from '@redlines/format';
import type { TextChange } from '@redlines/format';
import { mapChanges, mapFootprint, overlapAny } from './footprint.ts';
import type { Footprint } from './footprint.ts';
import type { Summary } from './intents.ts';

export type Strategy = 'c1' | 'c2' | 'naive';

export interface Push {
  clientId: string;
  pushId: string;
  /** The version the changes were derived on. */
  base: number;
  changes: TextChange[];
  footprint: Footprint;
  summary: Summary;
}

export interface LogEntry {
  /** 1 for the first update. */
  version: number;
  clientId: string;
  pushId: string;
  /** In offsets of the text before this update. */
  changes: TextChange[];
  footprint: Footprint;
  rebased: boolean;
  summary: Summary;
}

export type PushResult =
  | { status: 'ok'; version: number }
  | { status: 'stale'; version: number; why: 'c1' | 'body' | 'ledger' }
  /** The changes don't apply to the text, which no derivation should produce. */
  | { status: 'invalid'; version: number };

export interface AuthorityStats {
  pushes: number;
  /** Pushes whose base was behind the head. */
  stale: number;
  accepted: number;
  rebased: number;
  rejected: number;
  /** Stale pushes whose footprint touched a logged update's body range. */
  staleBody: number;
  /** Stale pushes that touch no body range of the updates since their base, but whose ledger
   * change collides with a ledger change. */
  staleLedgerOnly: number;
  /** Stale pushes that have a ledger change at all. */
  staleWithLedger: number;
  /** Stale pushes whose ledger change collides with a logged ledger change. */
  staleLedgerCollides: number;
  /** Updates that changed the ledger, and all updates. */
  ledgerUpdates: number;
}

export class Authority {
  text: string;
  readonly snapshots: string[];
  readonly log: LogEntry[] = [];
  readonly stats: AuthorityStats = {
    pushes: 0,
    stale: 0,
    accepted: 0,
    rebased: 0,
    rejected: 0,
    staleBody: 0,
    staleLedgerOnly: 0,
    staleWithLedger: 0,
    staleLedgerCollides: 0,
    ledgerUpdates: 0,
  };
  private readonly pushed = new Map<string, number>();
  /** Called for each confirmed update, with the text before and after. */
  onConfirm: (entry: LogEntry, before: string, after: string) => void = () => {};

  readonly strategy: Strategy;

  constructor(text: string, strategy: Strategy) {
    this.strategy = strategy;
    this.text = text;
    this.snapshots = [text];
  }

  get version(): number {
    return this.log.length;
  }

  since(version: number): LogEntry[] {
    return this.log.slice(version);
  }

  push(push: Push): PushResult {
    const known = this.pushed.get(push.pushId);
    if (known !== undefined) return { status: 'ok', version: known };
    this.stats.pushes++;
    let changes = push.changes;
    let footprint = push.footprint;
    let rebased = false;

    if (push.base > this.version) return { status: 'stale', version: this.version, why: 'c1' };
    if (push.base < this.version) {
      this.stats.stale++;
      // Classify the collisions whatever the strategy, so that the ledger's share is measured in
      // every run.
      let body = false;
      let ledger = false;
      let cur = { changes, footprint };
      for (const entry of this.log.slice(push.base)) {
        if (overlapAny(cur.footprint.body, entry.footprint.body)) body = true;
        if (overlapAny(cur.footprint.ledger, entry.footprint.ledger)) ledger = true;
        cur = {
          changes: mapChanges(cur.changes, entry.changes),
          footprint: mapFootprint(cur.footprint, entry.changes),
        };
      }
      if (body) this.stats.staleBody++;
      if (!body && ledger) this.stats.staleLedgerOnly++;
      if (push.footprint.ledger.length > 0) this.stats.staleWithLedger++;
      if (ledger) this.stats.staleLedgerCollides++;

      if (this.strategy === 'c1') {
        this.stats.rejected++;
        return { status: 'stale', version: this.version, why: 'c1' };
      }
      if (this.strategy === 'c2' && (body || ledger)) {
        this.stats.rejected++;
        return { status: 'stale', version: this.version, why: body ? 'body' : 'ledger' };
      }
      changes = cur.changes;
      footprint = cur.footprint;
      rebased = true;
    }

    let after: string;
    try {
      after = applyChanges(this.text, changes);
    } catch {
      return { status: 'invalid', version: this.version };
    }
    const before = this.text;
    const entry: LogEntry = {
      version: this.version + 1,
      clientId: push.clientId,
      pushId: push.pushId,
      changes,
      footprint,
      rebased,
      summary: push.summary,
    };
    this.log.push(entry);
    this.text = after;
    this.snapshots.push(after);
    this.pushed.set(push.pushId, entry.version);
    this.stats.accepted++;
    if (rebased) this.stats.rebased++;
    if (footprint.ledger.length > 0) this.stats.ledgerUpdates++;
    this.onConfirm(entry, before, after);
    return { status: 'ok', version: entry.version };
  }
}
