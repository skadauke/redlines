// Runs the `redlines` command line under Node (`pnpm redlines …`). The commands are in `run.ts`.

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ignoreBrokenPipe, nodeIo } from './node-io.ts';
import { run } from './run.ts';

/** The files, terminal and clock of the machine, for running commands outside tests. */
export { nodeIo, run };
export type { CliIo } from './run.ts';

/** Whether `node` was started with this file, rather than with a file that imports it. */
function isScript(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

// Run as a script (`pnpm redlines …`), the process ends once the output is written, with the exit
// code of the command. `process.exit` could cut off a long output that a pipe has not yet taken.
if (isScript()) {
  ignoreBrokenPipe(process.stdout);
  ignoreBrokenPipe(process.stderr);
  process.exitCode = await run(process.argv.slice(2), nodeIo);
}
