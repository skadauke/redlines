// `pnpm --filter @redlines/collab-sim matrix -- --sessions 300 --workers 3 --out results.json`
//
// Runs the matrix of matrix.ts over worker processes (each its own Node) and prints the tables.
// Flags: --sessions N (default 200), --workers N (default 3), --only <substring>, --out <file>.

import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  codesTable,
  guardTable,
  ledgerTable,
  mainTable,
  MATRIX,
  replaySizeTable,
  replayTable,
  sizeTable,
  speedTable,
} from './matrix.ts';
import type { Results } from './matrix.ts';
import { runCell } from './report.ts';
import type { SessionSummary } from './report.ts';

const file = fileURLToPath(import.meta.url);

function flag(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? (process.argv[at + 1] ?? fallback) : fallback;
}

async function main(): Promise<void> {
  const sessions = Number(flag('sessions', '200'));
  const workers = Number(flag('workers', '3'));
  const only = flag('only', '');
  const out = flag('out', '');
  const cells = MATRIX.filter((cell) => cell.name.includes(only));
  const chunk = 10;
  const jobs: { name: string; from: number; to: number }[] = [];
  for (const cell of cells) {
    for (let from = 0; from < sessions; from += chunk) {
      jobs.push({ name: cell.name, from, to: Math.min(sessions, from + chunk) });
    }
  }
  const results: Results = Object.fromEntries(cells.map((c) => [c.name, []]));
  let next = 0;
  let done = 0;
  const started = Date.now();
  const run = (job: (typeof jobs)[number]): Promise<void> =>
    new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          '--experimental-strip-types',
          '--disable-warning=ExperimentalWarning',
          file,
          '--worker',
          job.name,
          String(job.from),
          String(job.to),
        ],
        { stdio: ['ignore', 'pipe', 'inherit'] },
      );
      let data = '';
      child.stdout.on('data', (d: Buffer) => (data += d.toString()));
      child.on('close', (code) => {
        if (code !== 0) return reject(new Error(`worker ${job.name} failed`));
        (results[job.name] as SessionSummary[]).push(...(JSON.parse(data) as SessionSummary[]));
        done++;
        if (done % 20 === 0) {
          console.error(
            `${done}/${jobs.length} jobs, ${Math.round((Date.now() - started) / 1000)} s`,
          );
        }
        resolve();
      });
    });
  const lane = async (): Promise<void> => {
    for (;;) {
      const job = jobs[next++];
      if (!job) return;
      await run(job);
    }
  };
  await Promise.all(Array.from({ length: workers }, lane));

  if (out) writeFileSync(out, JSON.stringify(results));
  console.log(mainTable(results), '\n');
  console.log(speedTable(results), '\n');
  console.log(ledgerTable(results), '\n');
  console.log(guardTable(results), '\n');
  console.log(sizeTable(results), '\n');
  console.log(replayTable(results), '\n');
  console.log(replaySizeTable(results), '\n');
  console.log(codesTable(results, Object.keys(results)));
}

if (process.argv[2] === '--worker') {
  const [, , , name, from, to] = process.argv;
  const cell = MATRIX.find((c) => c.name === name);
  if (!cell) throw new Error(`no cell ${name}`);
  process.stdout.write(JSON.stringify(runCell(cell, Number(from), Number(to))));
} else {
  await main();
}
