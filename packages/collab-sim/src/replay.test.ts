// The no-host replay merge: replicas that know the same intents have the same text, whatever order
// they heard them in.

import { expect, test } from 'vitest';
import { replayText, runReplay } from './replay.ts';
import type { ReplayConfig } from './replay.ts';
import { Rng, seedFor } from './rng.ts';
import { baseDocument } from './text.ts';
import { makeIntent, WORKLOADS } from './workloads.ts';
import type { Intent } from './intents.ts';

const fuzz = Number(process.env['REDLINES_FUZZ'] ?? 0);
const SMOKE: Partial<ReplayConfig> = { clients: 3, ops: 8 };

test('the text of a set of intents does not depend on the order they are given in', () => {
  const base = baseDocument(3, 8);
  const rng = new Rng(21);
  const entries: { lamport: number; replica: number; intent: Intent }[] = [];
  const counters = [0, 1, 2].map(() => ({ words: 0, notes: 0, replies: 0, intents: 0 }));
  for (let n = 0; n < 12; n++) {
    const who = n % 3;
    const intent = makeIntent({
      rng,
      workload: 'hot',
      who,
      local: base,
      confirmed: base,
      counter: counters[who] as (typeof counters)[number],
      at: n * 1000,
      guard: true,
    });
    if (intent) entries.push({ lamport: Math.floor(n / 3), replica: who, intent });
  }
  const text = replayText(base, entries);
  for (let k = 0; k < 4; k++) {
    const shuffled = [...entries].sort(() => rng.next() - 0.5);
    expect(replayText(base, shuffled)).toBe(text);
  }
  expect(text).not.toBe(base);
});

test('a replay session is a pure function of its seed', { timeout: 60_000 }, () => {
  const config: ReplayConfig = { seed: 4, workload: 'hot', ...SMOKE };
  const a = runReplay(config);
  const b = runReplay(config);
  expect(a.finalText).toBe(b.finalText);
  expect(a.violations).toEqual(b.violations);
  expect(a.stats.intents).toBeGreaterThan(5);
});

test.each(WORKLOADS)(
  'smoke: %s replay sessions settle and every replica converges',
  { timeout: 120_000 },
  (workload) => {
    for (let n = 0; n < 2; n++) {
      const result = runReplay({ seed: seedFor(8, n), workload, ...SMOKE, render: false });
      const codes = new Set(result.violations.map((v) => v.code));
      expect(codes.has('crash'), `${workload}/${n}`).toBe(false);
      expect(codes.has('stuck')).toBe(false);
      expect(result.converged).toBe(true);
    }
  },
);

test.skipIf(fuzz === 0)(
  'fuzz: replay sessions of every workload settle and converge',
  // A synchronous run can't be stopped by its timeout, only marked after it ends: give it the deep
  // run's own limit (deep.yml), so that a slow runner doesn't fail a run that passed.
  { timeout: 19_800_000 },
  () => {
    // REDLINES_FUZZ is the number of sessions in all, spread evenly over the workloads.
    const perCell = Math.ceil(fuzz / WORKLOADS.length);
    for (const workload of WORKLOADS) {
      for (let n = 0; n < perCell; n++) {
        const result = runReplay({ seed: seedFor(9, n), workload });
        const codes = new Set(result.violations.map((v) => v.code));
        expect(codes.has('crash'), `${workload}/${n}`).toBe(false);
        expect(codes.has('stuck'), `${workload}/${n}`).toBe(false);
        expect(result.converged, `${workload}/${n}`).toBe(true);
      }
    }
  },
);
