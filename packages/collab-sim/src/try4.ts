import { runReplay } from './replay.ts';
const [workload, n] = process.argv.slice(2);
for (let i = 0; i < Number(n ?? 3); i++) {
  const t = Date.now();
  const r = runReplay({ seed: 1000 + i, workload: (workload ?? 'hot') as 'hot' });
  const s = r.stats;
  console.log(
    i,
    Date.now() - t,
    'ms',
    'intents',
    s.intents,
    'applied',
    s.applied,
    'derived',
    s.derived,
    'rewrites',
    s.rewrites,
    '/',
    s.merges,
    'vanished',
    s.vanished,
    'appeared',
    s.appeared,
    'viol',
    r.violations.length,
    r.corruptedAtEnd,
    r.invalidAtAnyPoint,
    r.converged,
  );
  const seen = new Set<string>();
  for (const v of r.violations) {
    if (seen.has(v.code)) continue;
    seen.add(v.code);
    console.log('   ', v.version, v.code, v.detail.slice(0, 140));
  }
}
