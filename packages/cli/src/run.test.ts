import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('the logic of the command line', () => {
  it('imports no node: module', () => {
    // The logic runs in QuickJS, which has none (design: the `redlines` program).
    for (const name of ['run.ts', 'files.ts', 'commands.ts', 'path.ts']) {
      const source = readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');
      expect(source, name).not.toMatch(/\bnode:/);
    }
  });
});
