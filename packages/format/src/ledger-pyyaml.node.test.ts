import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { addComment } from './comments.ts';
import { decodePayload } from './payload.ts';
import { ada, context } from './test-helpers.ts';

const have = spawnSync('python3', ['-c', 'import yaml'], { encoding: 'utf8' }).status === 0;

const PY = `
import sys, yaml, json
src = sys.stdin.read()
body = src[src.index('<!-- redlines') + len('<!-- redlines'):src.rindex('-->')]
print(json.dumps(yaml.load(body, Loader=yaml.BaseLoader)))
`;

type Ledger = { comments?: Record<string, { text?: string }[] | { text?: string }> };

describe.skipIf(!have)("PyYAML reads a comment's text as written (format §5.5)", () => {
  it.each([
    ['U+2028', `a${String.fromCharCode(0x2028)}b`],
    ['U+2029', `a${String.fromCharCode(0x2029)}b`],
    ['a backslash before a control character', `a\\${String.fromCharCode(1)}b`],
    ['a line of spaces', 'a\n   \nb'],
  ])('%s', (_, text) => {
    const body = 'Hello world.\n';
    const { changes } = addComment(body, { from: 0, to: 5 }, text, context(ada, ['c8d2']));
    const file = applyChanges(body, changes);
    const run = spawnSync('python3', ['-c', PY], { input: file, encoding: 'utf8' });
    expect(run.status, run.stderr).toBe(0);
    const ledger = JSON.parse(run.stdout) as Ledger;
    const entry = Object.values(ledger.comments ?? {})[0];
    const first = Array.isArray(entry) ? entry[0] : entry;
    expect(decodePayload(first?.text ?? 'MISSING')).toBe(text);
  });
});
