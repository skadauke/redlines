// The write-ahead log: what the authority writes before it changes its own state, and what a restart
// or a takeover replays. A host gives the authority one that is durable (a file, IndexedDB); the
// in-memory one is for tests and for sessions that don't outlive their process.

import type { Decision, WireRange } from './protocol.ts';

/** An update that was accepted into the log. */
export interface UpdateRecord {
  kind: 'update';
  /** The epoch it was accepted in. */
  epoch: number;
  /** The version it made (the first update makes version 1). */
  version: number;
  clientID: string;
  by: string;
  at: number;
  /** A CodeMirror `ChangeSet` as JSON, applying to the text before this version. */
  changes: unknown;
  footprint: readonly WireRange[];
  entries?: unknown;
  decision?: Decision;
}

/** A new epoch began (a takeover). Replay takes the largest one. */
export interface EpochRecord {
  kind: 'epoch';
  epoch: number;
}

export type WalRecord = UpdateRecord | EpochRecord;

/**
 * Appends are synchronous: the authority writes the record, then changes its own state, so a record
 * that is not in the log never was confirmed. A host with an asynchronous store keeps its own queue
 * behind `append` and makes the acknowledgement it sends wait for it.
 */
export interface WriteAheadLog {
  append(record: WalRecord): void;
  /** Everything appended so far, in order. */
  records(): readonly WalRecord[];
}

export class MemoryLog implements WriteAheadLog {
  private list: WalRecord[];
  constructor(records: readonly WalRecord[] = []) {
    this.list = [...records];
  }
  append(record: WalRecord): void {
    this.list.push(record);
  }
  records(): readonly WalRecord[] {
    return this.list;
  }
}
