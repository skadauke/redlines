// A hang freezes the app, and a test in the same thread can't fail one: this runs the edits that
// once looped forever (CRLF, the end of a closing fence with text under it) in a process of their
// own, killed after a time. Every one of them must return, written or refused with words.

import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const SCRIPT = `
const dir = ${JSON.stringify(new URL('.', import.meta.url).href)};
const { trackedEdits } = await import(dir + 'track.ts');
const bodies = [
  'Intro.\\r\\n\\r\\n\`\`\`js\\r\\na\\r\\n\`\`\`\\r\\nAfter.',
  'Intro.\\r\\n\\r\\n\`\`\`js\\r\\na\\r\\n\`\`\`\\r\\n\\r\\nAfter.',
  '> \`\`\`js\\r\\n> a\\r\\n> \`\`\`\\r\\n> After.',
  '- item\\r\\n\\r\\n  \`\`\`js\\r\\n  a\\r\\n  \`\`\`\\r\\n  After.',
  'Intro.\\r\\n\\r\\n\`\`\`js\\r\\na\\n\`\`\`\\r\\nAfter.',
];
const ledger = '\\r\\n\\r\\n<!-- redlines\\r\\nversion: 1\\r\\npeople:\\r\\n  ada: {name: Ada}\\r\\n-->\\r\\n';
const ctx = { author: { handle: 'ada', name: 'Ada' }, time: '2026-10-31T09:00Z' };
let done = 0;
for (const body of bodies) {
  const text = body + ledger;
  for (let at = 0; at <= body.length; at++) {
    for (const insert of ['x', '\\r\\n', '\\r\\n\\r\\n', '\\n']) {
      try { trackedEdits(text, [{ from: at, to: at, insert }], ctx); } catch (error) {
        if (error?.name !== 'EditError') throw error;
      }
      done++;
    }
  }
}
console.log('done ' + done);
`;

describe('edits that once looped forever', () => {
  it('return, in a process that is killed if one does not', () => {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', SCRIPT], {
      timeout: 60_000,
      encoding: 'utf8',
    });
    expect(result.error, 'timed out: an edit did not return').toBeUndefined();
    expect(result.stderr).toBe('');
    expect(result.stdout).toMatch(/^done \d+/);
  }, 90_000);
});
