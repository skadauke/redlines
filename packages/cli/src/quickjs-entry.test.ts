import { describe, expect, it } from 'vitest';
import './quickjs-entry.ts';

const PLAIN = '# Plan\n\nWe will ship the importer in March.\n';

/** A host over files in memory, as the program supplies one. */
function host(files: Record<string, string>, out: string[]) {
  return {
    readFile(path: string) {
      const text = files[path];
      if (text === undefined) throw new Error(`ENOENT: no such file or directory, open '${path}'`);
      if (text === 'BAD') throw Object.assign(new Error('bad'), { name: 'NotUtf8' });
      return text;
    },
    writeFile: (path: string, text: string) => void (files[path] = text),
    stdout: (s: string) => void out.push(s),
    stderr: (s: string) => void out.push(s),
    nowMs: () => Date.parse('2026-10-31T23:30:45.678Z'),
    realpath: (path: string) => Promise.resolve(path),
    modeOf: () => 0o644,
    canWrite: () => true,
    rename(from: string, to: string) {
      files[to] = files[from] ?? '';
      delete files[from];
    },
    remove: (path: string) => void delete files[path],
    readStdin: () => '',
    randomHex: () => 'abababab',
  };
}

describe('redlinesMain', () => {
  it('runs a command over the host', async () => {
    const files = { 'plan.md': PLAIN };
    const out: string[] = [];
    Object.assign(globalThis, { __host: host(files, out) });
    const code = await globalThis.redlinesMain([
      ...['str-replace', 'plan.md', '--old', 'March', '--new', 'April'],
      ...['--as', 'claude-ada', '--for', 'ada'],
    ]);
    expect(code).toBe(0);
    expect(files['plan.md']).toContain('<!--sub ');
    expect(Object.keys(files)).toEqual(['plan.md']);
  });

  it('says that a file is not UTF-8 text, and exits 1', async () => {
    const out: string[] = [];
    Object.assign(globalThis, { __host: host({ 'bad.md': 'BAD' }, out) });
    expect(await globalThis.redlinesMain(['view', 'bad.md'])).toBe(1);
    expect(out.join('')).toBe(
      "bad.md isn't UTF-8 text, so redlines can't change it without damaging it.\n",
    );
  });
});
