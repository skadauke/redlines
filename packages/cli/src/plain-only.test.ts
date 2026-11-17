import { describe, expect, it } from 'vitest';
import { isPlainOnly } from './plain-only.ts';
import { redlines } from './test-helpers.ts';

const CODE = 'const a = 1; // <!--ins k3x9-->x<!--/ins k3x9-->\n';

describe('a Plain-only file', () => {
  it('is known by its last extension, in any case', () => {
    for (const name of ['a.ts', 'x/y/b.PY', 'notes.txt', 'plan.md.json']) {
      expect(isPlainOnly(name), name).toBe(true);
    }
    for (const name of ['plan.md', 'a.qmd', 'b.Rmd', 'Makefile', '.txt', 'notes.txt.md']) {
      expect(isPlainOnly(name), name).toBe(false);
    }
  });

  it('is printed as it is by view, marks that are text and all', async () => {
    for (const flags of [[], ['--review'], ['--original']]) {
      const result = await redlines(['view', 'a.ts', ...flags], { 'a.ts': CODE });
      expect(result.code).toBe(0);
      expect(result.stdout).toBe(CODE);
    }
  });

  it('is refused every command that makes or decides a mark, and left as it is', async () => {
    const commands = [
      ['str-replace', 'a.ts', '--old', 'const', '--new', 'let', '--as', 'ada'],
      ['comment', 'a.ts', '--quote', 'const', '--text', 'Why?', '--as', 'ada'],
      ['reply', 'a.ts', 'c8d2', '--text', 'No.', '--as', 'ada'],
      ['accept', 'a.ts', 'k3x9'],
      ['reject', 'a.ts', 'k3x9'],
    ];
    for (const argv of commands) {
      const result = await redlines(argv, { 'a.ts': CODE });
      expect(result.code, argv[0]).toBe(1);
      expect(result.stderr).toContain('is not a Markdown document');
      expect(result.writes).toEqual([]);
      expect(result.files['a.ts']).toBe(CODE);
    }
  });
});
