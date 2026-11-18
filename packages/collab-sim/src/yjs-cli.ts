// `node --experimental-strip-types src/yjs-cli.ts --sessions 200 --workers 2 --out yjs.json`
//
// Runs every cell of yjs-matrix.ts with the plain log and both Yjs logs on the same seeds, over
// worker processes, and prints the tables. Flags: --sessions N (default 200), --workers N
// (default 2), --only <substring>, --out <file>.

import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ARMS,
  YCELLS,
  bytesTable,
  changeTable,
  latencyTable,
  offlineTable,
  reorderTable,
  runArms,
  safetyTable,
} from './yjs-matrix.ts';
import type { CellRuns, YResults } from './yjs-matrix.ts';

const file = fileURLToPath(import.meta.url);

function flag(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? (process.argv[at + 1] ?? fallback) : fallback;
}

async function main(): Promise<void> {
  const sessions = Number(flag('sessions', '200'));
  const workers = Number(flag('workers', '2'));
  const only = flag('only', '');
  const out = flag('out', '');
  const not = flag('not', '\u0000');
  const cells = YCELLS.filter((cell) => cell.name.includes(only) && !cell.name.includes(not));
  const chunk = 10;
  const jobs: { name: string; from: number; to: number }[] = [];
  for (const cell of cells) {
    for (let from = 0; from < sessions; from += chunk) {
      jobs.push({ name: cell.name, from, to: Math.min(sessions, from + chunk) });
    }
  }
  const results: YResults = Object.fromEntries(
    cells.map((c) => [c.name, { plain: [], yarray: [], ylamport: [] }]),
  );
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
        const part = JSON.parse(data) as CellRuns;
        const cell = results[job.name] as CellRuns;
        for (const arm of ARMS) cell[arm].push(...part[arm]);
        done++;
        if (done % 10 === 0) {
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
  console.log(safetyTable(results), '\n');
  console.log(reorderTable(results), '\n');
  console.log(changeTable(results), '\n');
  console.log(latencyTable(results), '\n');
  console.log(bytesTable(results), '\n');
  console.log(offlineTable(results));
}

if (process.argv[2] === '--worker') {
  const [, , , name, from, to] = process.argv;
  const cell = YCELLS.find((c) => c.name === name);
  if (!cell) throw new Error(`no cell ${name}`);
  process.stdout.write(JSON.stringify(runArms(cell, Number(from), Number(to))));
} else {
  await main();
}
