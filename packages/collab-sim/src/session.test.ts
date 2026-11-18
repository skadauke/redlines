// A few seeded sessions in CI. A larger run takes REDLINES_FUZZ as its number of sessions in all,
// spread evenly over the matrix's cells, as every random suite takes it as its draw count (a deep
// run's 300 is 25 a cell); `pnpm --filter @redlines/collab-sim matrix` runs the full one.

import { expect, test } from 'vitest';
import { runSession } from './session.ts';
import type { SessionConfig } from './session.ts';
import { seedFor } from './rng.ts';
import { WORKLOADS } from './workloads.ts';

const fuzz = Number(process.env['REDLINES_FUZZ'] ?? 0);
const SMOKE: Partial<SessionConfig> = { clients: 3, ops: 8 };

test('a session is a pure function of its seed', { timeout: 60_000 }, () => {
  const config: SessionConfig = { seed: 11, workload: 'hot', strategy: 'c2', ...SMOKE };
  const a = runSession(config);
  const b = runSession(config);
  expect(a.finalText).toBe(b.finalText);
  expect(a.violations).toEqual(b.violations);
  expect(a.stats.updates).toBeGreaterThan(3);
});

test.each(WORKLOADS)(
  'smoke: %s sessions settle and every copy converges',
  { timeout: 120_000 },
  (workload) => {
    for (const strategy of ['c1', 'c2'] as const) {
      for (let n = 0; n < 2; n++) {
        const result = runSession({
          seed: seedFor(3, n),
          workload,
          strategy,
          ...SMOKE,
          render: false,
        });
        const codes = new Set(result.violations.map((v) => v.code));
        expect(codes.has('crash'), `${workload}/${strategy}/${n}`).toBe(false);
        expect(codes.has('stuck')).toBe(false);
        expect(result.converged).toBe(true);
        expect(result.stats.confirmed).toBeGreaterThan(0);
      }
    }
  },
);

test(
  'the harness can fail: rebasing without footprints corrupts hot sessions',
  { timeout: 120_000 },
  () => {
    let found = 0;
    for (let n = 0; n < 6; n++) {
      const result = runSession({
        seed: seedFor(5, n),
        workload: 'hot',
        strategy: 'naive',
        clients: 4,
        ops: 10,
        render: false,
        offlineP: 0,
      });
      if (
        result.violations.some((v) =>
          ['lost', 'swallowed', 'dropped', 'untracked', 'markup'].includes(v.code),
        )
      ) {
        found++;
      }
    }
    expect(found).toBeGreaterThan(0);
  },
);

test.skipIf(fuzz === 0)(
  'fuzz: the whole matrix of workloads and strategies settles and converges',
  // A synchronous run can't be stopped by its timeout, only marked after it ends: give it the deep
  // run's own limit (deep.yml), so that a slow runner doesn't fail a run that passed.
  { timeout: 19_800_000 },
  () => {
    const strategies = ['c1', 'c2', 'naive'] as const;
    const perCell = Math.ceil(fuzz / (WORKLOADS.length * strategies.length));
    for (const workload of WORKLOADS) {
      for (const strategy of strategies) {
        for (let n = 0; n < perCell; n++) {
          const result = runSession({ seed: seedFor(9, n), workload, strategy });
          const codes = new Set(result.violations.map((v) => v.code));
          expect(codes.has('crash'), `${workload}/${strategy}/${n}`).toBe(false);
          expect(codes.has('stuck'), `${workload}/${strategy}/${n}`).toBe(false);
          expect(result.converged, `${workload}/${strategy}/${n}`).toBe(true);
        }
      }
    }
  },
);
