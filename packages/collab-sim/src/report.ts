// Cells of the matrix, and the tables that summarise them.

import type { Strategy } from './authority.ts';
import { runSession } from './session.ts';
import type { SessionConfig, SessionResult } from './session.ts';
import { seedFor } from './rng.ts';
import type { WorkloadName } from './workloads.ts';

/** A row of a table: one way to run sessions. */
export interface Cell {
  name: string;
  workload: WorkloadName;
  strategy: Strategy;
  clients?: number;
  ops?: number;
  guard?: boolean;
  offlineP?: number;
}

/** What is kept of a session. */
export interface SessionSummary {
  seed: number;
  corrupted: boolean;
  invalid: boolean;
  joined: boolean;
  converged: boolean;
  /** Distinct violation codes, with the first example of each. */
  codes: Record<string, string>;
  turnedAway: Record<string, number>;
  intents: number;
  confirmed: number;
  pushes: number;
  rejected: number;
  rebased: number;
  stale: number;
  staleBody: number;
  staleLedgerOnly: number;
  staleWithLedger: number;
  staleLedgerCollides: number;
  ledgerUpdates: number;
  updates: number;
  latencies: number[];
  outages: number;
}

export function configOf(cell: Cell, n: number, base = 7): SessionConfig {
  return {
    seed: seedFor(base, n),
    workload: cell.workload,
    strategy: cell.strategy,
    ...(cell.clients !== undefined ? { clients: cell.clients } : {}),
    ...(cell.ops !== undefined ? { ops: cell.ops } : {}),
    ...(cell.guard !== undefined ? { guard: cell.guard } : {}),
    ...(cell.offlineP !== undefined ? { offlineP: cell.offlineP } : {}),
  };
}

export function summarize(result: SessionResult): SessionSummary {
  const codes: Record<string, string> = {};
  for (const v of result.violations) codes[v.code] ??= `v${v.version}: ${v.detail}`;
  const s = result.stats;
  return {
    seed: result.config.seed,
    corrupted: result.corruptedAtEnd,
    invalid: result.invalidAtAnyPoint,
    joined: 'joined' in codes,
    converged: result.converged,
    codes,
    turnedAway: s.turnedAway,
    intents: Object.values(s.byKind).reduce((a, b) => a + b, 0),
    confirmed: s.confirmed,
    pushes: s.pushes,
    rejected: s.rejected,
    rebased: s.rebased,
    stale: s.stale,
    staleBody: s.staleBody,
    staleLedgerOnly: s.staleLedgerOnly,
    staleWithLedger: s.staleWithLedger,
    staleLedgerCollides: s.staleLedgerCollides,
    ledgerUpdates: s.ledgerUpdates,
    updates: s.updates,
    latencies: s.latencies,
    outages: s.outages,
  };
}

export function runCell(cell: Cell, from: number, to: number, base = 7): SessionSummary[] {
  const out: SessionSummary[] = [];
  for (let n = from; n < to; n++) out.push(summarize(runSession(configOf(cell, n, base))));
  return out;
}

const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);
const pct = (a: number, b: number, digits = 1): string =>
  b === 0 ? 'n/a' : `${((100 * a) / b).toFixed(digits)}%`;

export function quantile(xs: readonly number[], q: number): number {
  if (xs.length === 0) return NaN;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] as number;
}

export interface CellStats {
  sessions: number;
  corrupted: number;
  invalid: number;
  joined: number;
  diverged: number;
  withCode: Record<string, number>;
  examples: Record<string, string>;
  pushes: number;
  rejected: number;
  rebased: number;
  stale: number;
  staleBody: number;
  staleLedgerOnly: number;
  staleWithLedger: number;
  staleLedgerCollides: number;
  ledgerUpdates: number;
  updates: number;
  intents: number;
  confirmed: number;
  turnedAway: Record<string, number>;
  medianMs: number;
  p95Ms: number;
}

export function statsOf(sessions: readonly SessionSummary[]): CellStats {
  const withCode: Record<string, number> = {};
  const examples: Record<string, string> = {};
  const turnedAway: Record<string, number> = {};
  for (const s of sessions) {
    for (const [code, example] of Object.entries(s.codes)) {
      withCode[code] = (withCode[code] ?? 0) + 1;
      examples[code] ??= `seed ${s.seed}, ${example}`;
    }
    for (const [why, n] of Object.entries(s.turnedAway))
      turnedAway[why] = (turnedAway[why] ?? 0) + n;
  }
  const latencies = sessions.flatMap((s) => s.latencies);
  return {
    sessions: sessions.length,
    corrupted: sessions.filter((s) => s.corrupted).length,
    invalid: sessions.filter((s) => s.invalid).length,
    joined: sessions.filter((s) => s.joined).length,
    diverged: sessions.filter((s) => !s.converged).length,
    withCode,
    examples,
    pushes: sum(sessions.map((s) => s.pushes)),
    rejected: sum(sessions.map((s) => s.rejected)),
    rebased: sum(sessions.map((s) => s.rebased)),
    stale: sum(sessions.map((s) => s.stale)),
    staleBody: sum(sessions.map((s) => s.staleBody)),
    staleLedgerOnly: sum(sessions.map((s) => s.staleLedgerOnly)),
    staleWithLedger: sum(sessions.map((s) => s.staleWithLedger)),
    staleLedgerCollides: sum(sessions.map((s) => s.staleLedgerCollides)),
    ledgerUpdates: sum(sessions.map((s) => s.ledgerUpdates)),
    updates: sum(sessions.map((s) => s.updates)),
    intents: sum(sessions.map((s) => s.intents)),
    confirmed: sum(sessions.map((s) => s.confirmed)),
    turnedAway,
    medianMs: quantile(latencies, 0.5),
    p95Ms: quantile(latencies, 0.95),
  };
}

/** "corrupted at the end / invalid markup confirmed at any point". */
export const endAndAny = (s: CellStats): string =>
  `${pct(s.corrupted, s.sessions)} / ${pct(s.invalid, s.sessions)}`;

export const rejectedShare = (s: CellStats): string => pct(s.rejected, s.pushes);

export const turnedAwayShare = (s: CellStats): string =>
  pct(sum(Object.values(s.turnedAway)), s.intents);

export const msOf = (ms: number): string => (Number.isNaN(ms) ? 'n/a' : `${Math.round(ms)} ms`);

export { pct };
