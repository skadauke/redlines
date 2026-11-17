// The matrix of cells that the research notes report, and the tables made from them.

import { WORKLOADS } from './workloads.ts';
import { endAndAny, msOf, pct, rejectedShare, statsOf, turnedAwayShare } from './report.ts';
import type { Cell, CellStats, SessionSummary } from './report.ts';
import type { Strategy } from './authority.ts';

const STRATEGIES: readonly Strategy[] = ['c1', 'c2', 'naive'];

/** Today's format with the real library: every workload under every strategy, the review
 * workload without the guard, and the hot workload at other sizes. */
export const MATRIX: Cell[] = [
  ...WORKLOADS.flatMap((workload) =>
    STRATEGIES.map((strategy) => ({ name: `${workload}/${strategy}`, workload, strategy })),
  ),
  { name: 'review/c2/noguard', workload: 'review', strategy: 'c2', guard: false },
  { name: 'review/c1/noguard', workload: 'review', strategy: 'c1', guard: false },
  { name: 'hot/c2/3', workload: 'hot', strategy: 'c2', clients: 3 },
  { name: 'hot/c2/5', workload: 'hot', strategy: 'c2', clients: 5 },
  { name: 'typical/c2/5', workload: 'typical', strategy: 'c2', clients: 5 },
  { name: 'hot/c2/online', workload: 'hot', strategy: 'c2', offlineP: 0 },
];

export type Results = Record<string, SessionSummary[]>;

const row = (...cells: string[]): string => `| ${cells.join(' | ')} |`;

function table(head: string[], rows: string[][]): string {
  return [row(...head), row(...head.map(() => '---')), ...rows.map((r) => row(...r))].join('\n');
}

/** The main table: per workload, the share of sessions corrupted at the end and the share that
 * confirmed invalid markup at any point, under each strategy. */
export function mainTable(results: Results): string {
  const s = (name: string): CellStats | undefined => {
    const cell = results[name];
    return cell ? statsOf(cell) : undefined;
  };
  const rows = WORKLOADS.map((w) => {
    const c1 = s(`${w}/c1`);
    const c2 = s(`${w}/c2`);
    const nv = s(`${w}/naive`);
    return [
      w,
      c1 ? endAndAny(c1) : '-',
      c2 ? endAndAny(c2) : '-',
      nv ? endAndAny(nv) : '-',
      c1 && c2 ? `${rejectedShare(c1)} / ${rejectedShare(c2)}` : '-',
    ];
  });
  return table(['Workload', '(c1)', '(c2)', '(c-naive)', 'Pushes rejected, c1 / c2'], rows);
}

/** What was confirmed, turned away and how fast. */
export function speedTable(results: Results): string {
  const rows = WORKLOADS.flatMap((w) =>
    (['c1', 'c2'] as const).flatMap((strategy) => {
      const cell = results[`${w}/${strategy}`];
      if (!cell) return [];
      const s = statsOf(cell);
      return [
        [
          w,
          strategy,
          pct(s.confirmed, s.intents),
          turnedAwayShare(s),
          msOf(s.medianMs),
          msOf(s.p95Ms),
          pct(s.rebased, s.pushes),
        ],
      ];
    }),
  );
  return table(
    [
      'Workload',
      'Strategy',
      'Intents confirmed',
      'Turned away while deriving',
      'Median to confirm',
      'p95 to confirm',
      'Pushes rebased',
    ],
    rows,
  );
}

/** What went wrong, by kind, in sessions out of the cell's sessions. */
export function codesTable(results: Results, names: string[]): string {
  const stats = names.map((n) => [n, results[n] ? statsOf(results[n]) : undefined] as const);
  const codes = [...new Set(stats.flatMap(([, s]) => Object.keys(s?.withCode ?? {})))].sort();
  return table(
    ['Violation', ...names],
    codes.map((code) => [code, ...stats.map(([, s]) => (s ? String(s.withCode[code] ?? 0) : '-'))]),
  );
}

/** How often two edits made at once collide in the ledger. */
export function ledgerTable(results: Results): string {
  const rows = WORKLOADS.flatMap((w) => {
    const cell = results[`${w}/c2`];
    if (!cell) return [];
    const s = statsOf(cell);
    return [
      [
        w,
        pct(s.ledgerUpdates, s.updates),
        pct(s.stale, s.pushes),
        pct(s.staleLedgerCollides, s.staleWithLedger),
        pct(s.staleBody, s.stale),
        pct(s.staleLedgerOnly, s.stale),
      ],
    ];
  });
  return table(
    [
      'Workload',
      'Updates that change the ledger',
      'Pushes made on an older version',
      'Of those with a ledger change, collide in the ledger',
      'Of the older pushes, touch another body edit',
      'Of the older pushes, collide only in the ledger',
    ],
    rows,
  );
}

export function sizeTable(results: Results): string {
  const names = ['hot/c2/3', 'hot/c2', 'hot/c2/5', 'typical/c2', 'typical/c2/5', 'hot/c2/online'];
  const rows = names.flatMap((n) => {
    const cell = results[n];
    if (!cell) return [];
    const s = statsOf(cell);
    return [[n, String(s.sessions), endAndAny(s), rejectedShare(s), msOf(s.medianMs)]];
  });
  return table(
    ['Cell', 'Sessions', 'Corrupted at end / invalid at any point', 'Pushes rejected', 'Median'],
    rows,
  );
}

export function guardTable(results: Results): string {
  const rows = ['review/c2', 'review/c2/noguard', 'review/c1', 'review/c1/noguard'].flatMap((n) => {
    const cell = results[n];
    if (!cell) return [];
    const s = statsOf(cell);
    const decisions = s.turnedAway;
    const guard = Object.entries(decisions)
      .filter(([k]) => k.startsWith('decide:'))
      .reduce((a, [, v]) => a + v, 0);
    return [[n, String(s.sessions), endAndAny(s), String(guard)]];
  });
  return table(
    ['Cell', 'Sessions', 'Corrupted at end / invalid at any point', 'Decisions turned away'],
    rows,
  );
}
