// The Yjs-backed intent log: replicas converge, and a session is a pure function of its seed.

import { expect, test } from 'vitest';
import { seedFor } from './rng.ts';
import { WORKLOADS } from './workloads.ts';
import { runYjsReplay } from './yjs-replay.ts';

test.each(WORKLOADS)(
  'smoke: %s sessions settle and every replica converges, in both orders',
  { timeout: 120_000 },
  (workload) => {
    for (let n = 0; n < 2; n++) {
      for (const order of ['array', 'lamport'] as const) {
        const config = { seed: seedFor(8, n), workload, clients: 3, ops: 8, render: false, order };
        const result = runYjsReplay(config);
        const codes = new Set(result.violations.map((v) => v.code));
        expect(codes.has('crash'), `${workload}/${n}/${order}`).toBe(false);
        expect(codes.has('stuck')).toBe(false);
        expect(result.converged).toBe(true);
        expect(result.stats.intents).toBeGreaterThan(5);
      }
    }
  },
);

test('a Yjs session is a pure function of its seed', { timeout: 60_000 }, () => {
  const config = { seed: 4, workload: 'hot' as const, clients: 3, ops: 8, order: 'array' as const };
  const a = runYjsReplay(config);
  const b = runYjsReplay(config);
  expect(a.finalText).toBe(b.finalText);
  expect(a.order).toEqual(b.order);
});
