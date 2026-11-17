// Prints the `--grep` pattern of the journeys a pull request runs, from the paths it changes, one
// per line on the standard input:
//
//   git diff --name-only origin/main...HEAD | node --experimental-strip-types scripts/areas.ts
//
// It prints `@smoke|@lists|@tables`, or nothing when every journey runs (src/areas.ts has the rules).

import { readFileSync } from 'node:fs';
import { grepFor } from '../src/areas.ts';

const paths = readFileSync(0, 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean);
process.stdout.write(grepFor(paths));
