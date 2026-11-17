// The ledger's apply log (multiuser research §4.3, §4.4). In a session the authority gives every
// entry one place in a single order; a copy applies the log to its map. Applying is safe to repeat:
// an entry that is already applied (by its id) is skipped, so a copy that is sent the same update
// twice, or the whole log again after a reconnect, ends with the same map. A decision on a mark
// goes through the log like any entry: the first one wins, and a second is dropped with a notice
// that names the first. Nothing here is written to the file: the map is written by `writeLedger`,
// and a decided mark leaves the ledger as it does today, when its markers leave the body.
//
// Deferred, on purpose: `decided` lives in the session's state and is rebuilt from the log, not
// stored in the file (an epoch change replays the log); undoing a decision, the guard that carries
// the mark as the person saw it (§4.4), and the thread's one outcome come with the review PRs.
// Entries of one key (two `addMark` of an id, two settings) are applied in the log's order.

import { applyLedgerOp } from './ledger-map.ts';
import type { LedgerMap, LedgerOp } from './ledger-map.ts';

/** The outcome of a decision. */
export type Outcome = 'accepted' | 'rejected';

/** What a log entry does: an operation on the map, or a decision on a mark. */
export type LogBody =
  LedgerOp | { op: 'decide'; mark: string; outcome: Outcome; by: string; at: string };

/** One entry of the log. `id` is unique to the entry, so that applying it twice is the same. */
export interface LogEntry {
  id: string;
  body: LogBody;
}

/** A first decision on a mark, as the log holds it. The mark's entry is gone from the map. */
export interface Decision {
  outcome: Outcome;
  by: string;
  at: string;
}

/** A decision that came second, and was dropped. */
export interface DroppedDecision {
  entry: string;
  mark: string;
  /** What was asked, and what stands. */
  asked: Outcome;
  first: Decision;
}

/** A map, the log's applied entries and what it decided. Not written to the file. */
export interface LedgerState {
  map: LedgerMap;
  applied: ReadonlySet<string>;
  decided: ReadonlyMap<string, Decision>;
  dropped: readonly DroppedDecision[];
}

/** A state that has applied nothing, over `map`. */
export function ledgerState(map: LedgerMap): LedgerState {
  return { map, applied: new Set(), decided: new Map(), dropped: [] };
}

/** The state after one entry. `state` is not changed. */
export function applyLogEntry(state: LedgerState, entry: LogEntry): LedgerState {
  if (state.applied.has(entry.id)) return state;
  const applied = new Set(state.applied).add(entry.id);
  const body = entry.body;
  if (body.op !== 'decide') {
    // A mark that was decided is gone: a late edit to its entry doesn't bring it back.
    if (body.op === 'addMark' && state.decided.has(body.id)) return { ...state, applied };
    return { ...state, applied, map: applyLedgerOp(state.map, body) };
  }
  const first = state.decided.get(body.mark);
  if (first) {
    // The same person deciding the same way again says nothing.
    if (first.by === body.by && first.outcome === body.outcome) return { ...state, applied };
    const drop: DroppedDecision = {
      entry: entry.id,
      mark: body.mark,
      asked: body.outcome,
      first,
    };
    return { ...state, applied, dropped: [...state.dropped, drop] };
  }
  const decided = new Map(state.decided).set(body.mark, {
    outcome: body.outcome,
    by: body.by,
    at: body.at,
  });
  return {
    ...state,
    applied,
    decided,
    map: applyLedgerOp(state.map, { op: 'removeMark', id: body.mark }),
  };
}

/** The state after `log`, in the order given. */
export function applyLog(state: LedgerState, log: readonly LogEntry[]): LedgerState {
  // One pass, so that a long log isn't copied for every entry.
  let next = state;
  const applied = new Set(state.applied);
  for (const entry of log) {
    if (applied.has(entry.id)) continue;
    next = applyLogEntry({ ...next, applied: new Set() }, entry);
    applied.add(entry.id);
    next = { ...next, applied };
  }
  return next;
}
