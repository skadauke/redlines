// The comparison of the plain Lamport log with a Yjs log, on identical seeds and workloads, and
// the tables that the research note reports. `yjs-cli.ts` runs it.

import { runReplay } from './replay.ts';
import type { ReplayConfig } from './replay.ts';
import { quantile, pct, msOf } from './report.ts';
import { seedFor } from './rng.ts';
import { WORKLOADS } from './workloads.ts';
import type { WorkloadName } from './workloads.ts';
import { runYjsReplay } from './yjs-replay.ts';

export type Arm = 'plain' | 'yarray' | 'ylamport';
export const ARMS: readonly Arm[] = ['plain', 'yarray', 'ylamport'];

export interface YCell {
  name: string;
  workload: WorkloadName;
  clients?: number;
  ops?: number;
  offlineP?: number;
  offlineMs?: [number, number];
}

export const YCELLS: YCell[] = [
  ...WORKLOADS.map((workload) => ({ name: workload, workload })),
  { name: 'hot/5', workload: 'hot', clients: 5 },
  { name: 'typical/5', workload: 'typical', clients: 5 },
  { name: 'hot/online', workload: 'hot', offlineP: 0 },
  // Long offline periods: 20-40 s of a 56 s session, so a replica makes 15-30 intents alone.
  { name: 'hot/long', workload: 'hot', ops: 40, offlineP: 0.7, offlineMs: [20_000, 40_000] },
  { name: 'typical/long', workload: 'typical', ops: 40, offlineP: 0.7, offlineMs: [20_000, 40_000] },
];

export interface RunSummary {
  seed: number;
  corrupted: boolean;
  invalid: boolean;
  converged: boolean;
  codes: string[];
  merges: number;
  rewrites: number;
  rewound: number;
  rederived: number;
  intents: number;
  applied: number;
  vanished: number;
  appeared: number;
  latencies: number[];
  messages: number;
  opBytes: number;
  syncBytes: number;
  docBytes: number;
  plainBytes: number;
  outages: number;
  heldBack: number;
  duplicates: number;
  finalText: string;
}

export type CellRuns = Record<Arm, RunSummary[]>;

function configOf(cell: YCell, n: number): ReplayConfig {
  return {
    seed: seedFor(7, n),
    workload: cell.workload,
    ...(cell.clients !== undefined ? { clients: cell.clients } : {}),
    ...(cell.ops !== undefined ? { ops: cell.ops } : {}),
    ...(cell.offlineP !== undefined ? { offlineP: cell.offlineP } : {}),
    ...(cell.offlineMs !== undefined ? { offlineMs: cell.offlineMs } : {}),
  };
}

export function runArms(cell: YCell, from: number, to: number): CellRuns {
  const out: CellRuns = { plain: [], yarray: [], ylamport: [] };
  for (let n = from; n < to; n++) {
    const config = configOf(cell, n);
    const plain = runReplay(config);
    const s = plain.stats;
    out.plain.push({
      seed: config.seed,
      corrupted: plain.corruptedAtEnd,
      invalid: plain.invalidAtAnyPoint,
      converged: plain.converged,
      codes: [...new Set(plain.violations.map((v) => v.code))],
      merges: s.merges,
      rewrites: s.rewrites,
      rewound: s.rewound,
      rederived: s.rewound,
      intents: s.intents,
      applied: s.applied,
      vanished: s.vanished,
      appeared: s.appeared,
      latencies: s.latencies,
      messages: s.bytes.messages,
      opBytes: s.bytes.ops,
      syncBytes: s.bytes.sync,
      docBytes: 0,
      plainBytes: 0,
      outages: s.outages,
      heldBack: 0,
      duplicates: 0,
      finalText: '',
    });
    for (const order of ['array', 'lamport'] as const) {
      const result = runYjsReplay({ ...config, order });
      const y = result.stats;
      out[order === 'array' ? 'yarray' : 'ylamport'].push({
        seed: config.seed,
        corrupted: result.corruptedAtEnd,
        invalid: result.invalidAtAnyPoint,
        converged: result.converged,
        codes: [...new Set(result.violations.map((v) => v.code))],
        merges: y.merges,
        rewrites: y.rewrites,
        rewound: y.rewound,
        rederived: y.rederived,
        intents: y.intents,
        applied: y.applied,
        vanished: y.vanished,
        appeared: y.appeared,
        latencies: y.latencies,
        messages: y.bytes.messages,
        opBytes: y.bytes.ops,
        syncBytes: y.bytes.sync,
        docBytes: y.docBytes,
        plainBytes: y.plainBytes,
        outages: y.outages,
        heldBack: y.heldBack,
        duplicates: y.duplicates,
        finalText: '',
      });
    }
  }
  return out;
}

export type YResults = Record<string, CellRuns>;

const row = (...cells: string[]): string => `| ${cells.join(' | ')} |`;

function table(head: string[], rows: string[][]): string {
  return [row(...head), row(...head.map(() => '---')), ...rows.map((r) => row(...r))].join('\n');
}

const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);
const total = (runs: readonly RunSummary[], f: (r: RunSummary) => number): number =>
  sum(runs.map(f));
const mean = (runs: readonly RunSummary[], f: (r: RunSummary) => number): number =>
  runs.length === 0 ? 0 : total(runs, f) / runs.length;
const kb = (bytes: number): string => `${(bytes / 1024).toFixed(1)} KB`;

const NAMES: Record<Arm, string> = {
  plain: 'plain log',
  yarray: 'Y.Array order',
  ylamport: 'Y.Array, Lamport order',
};

/** Corrupted at the end / invalid at any point, and sessions that did not converge. */
export function safetyTable(results: YResults): string {
  const rows = Object.entries(results).map(([name, runs]) => [
    name,
    String(runs.plain.length),
    ...ARMS.map((a) => {
      const r = runs[a];
      return `${pct(r.filter((x) => x.corrupted).length, r.length)} / ${pct(r.filter((x) => x.invalid).length, r.length)} (${r.filter((x) => !x.converged).length})`;
    }),
  ]);
  return table(
    ['Cell', 'Sessions', ...ARMS.map((a) => `${NAMES[a]}: corrupted / invalid (not converged)`)],
    rows,
  );
}

/** How often a merge slots an intent in before ones already derived. */
export function reorderTable(results: YResults): string {
  const rows = Object.entries(results).map(([name, runs]) => [
    name,
    ...ARMS.map((a) => {
      const r = runs[a];
      const merges = total(r, (x) => x.merges);
      const rewrites = total(r, (x) => x.rewrites);
      const rewound = total(r, (x) => x.rewound);
      return `${pct(rewrites, merges)}, ${(rewound / Math.max(1, rewrites)).toFixed(1)}`;
    }),
    ...(['plain', 'yarray', 'ylamport'] as const).map((a) => {
      const r = runs[a];
      return (total(r, (x) => x.rederived) / Math.max(1, r.length)).toFixed(0);
    }),
  ]);
  return table(
    [
      'Cell',
      ...ARMS.map((a) => `${NAMES[a]}: intents slotted in before others, re-derived each`),
      ...ARMS.map((a) => `${NAMES[a]}: steps re-derived per session`),
    ],
    rows,
  );
}

/** What a person sees change under them. */
export function changeTable(results: YResults): string {
  const rows = Object.entries(results).map(([name, runs]) => [
    name,
    ...ARMS.map((a) => {
      const r = runs[a];
      const n = total(r, (x) => x.intents);
      return `${pct(total(r, (x) => x.applied), n)}; ${pct(total(r, (x) => x.vanished), n)} / ${pct(total(r, (x) => x.appeared), n)}`;
    }),
  ]);
  return table(
    [
      'Cell',
      ...ARMS.map((a) => `${NAMES[a]}: changed the text; gone / appeared in the final order`),
    ],
    rows,
  );
}

/** Time until every replica has an intent. */
export function latencyTable(results: YResults): string {
  const rows = Object.entries(results).map(([name, runs]) => [
    name,
    ...ARMS.flatMap((a) => {
      const l = runs[a].flatMap((x) => x.latencies);
      return [msOf(quantile(l, 0.5)), msOf(quantile(l, 0.95)), msOf(quantile(l, 0.99))];
    }),
  ]);
  return table(
    [
      'Cell',
      ...ARMS.flatMap((a) => [`${NAMES[a]}: median`, 'p95', 'p99']),
    ],
    rows,
  );
}

/** Bytes sent per session, and the size of the log at the end. */
export function bytesTable(results: YResults): string {
  const rows = Object.entries(results).map(([name, runs]) => {
    const intents = mean(runs.plain, (x) => x.intents);
    return [
      name,
      String(Math.round(intents)),
      ...ARMS.map((a) => {
        const r = runs[a];
        const bytes = mean(r, (x) => x.opBytes + x.syncBytes);
        return `${kb(bytes)} (${Math.round(mean(r, (x) => x.messages))} msgs)`;
      }),
      kb(mean(runs.yarray, (x) => x.plainBytes)),
      kb(mean(runs.yarray, (x) => x.docBytes)),
      kb(mean(runs.ylamport, (x) => x.docBytes)),
    ];
  });
  return table(
    [
      'Cell',
      'Intents',
      ...ARMS.map((a) => `${NAMES[a]}: bytes sent per session`),
      'Log as JSON, at the end',
      'Y.Doc update, Y.Array order',
      'Y.Doc update, Lamport order',
    ],
    rows,
  );
}

/** The same long sessions, by what the offline replicas cost the others. */
export function offlineTable(results: YResults): string {
  const rows = Object.entries(results)
    .filter(([name]) => name.endsWith('/long') || name.endsWith('/online'))
    .map(([name, runs]) => [
      name,
      ...ARMS.map((a) => {
        const r = runs[a];
        const merges = total(r, (x) => x.merges);
        return `${pct(total(r, (x) => x.rewrites), merges)}; ${(total(r, (x) => x.rederived) / Math.max(1, r.length)).toFixed(0)}`;
      }),
      String(total(runs.yarray, (x) => x.heldBack)),
      String(Math.round(mean(runs.yarray, (x) => x.duplicates))),
    ]);
  return table(
    [
      'Cell',
      ...ARMS.map((a) => `${NAMES[a]}: rewriting merges; steps re-derived per session`),
      'Replicas that ended holding updates back',
      'Duplicate updates per session (Y.Array order)',
    ],
    rows,
  );
}

export { WORKLOADS };
