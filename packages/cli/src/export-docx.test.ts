import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { nodeIo } from './node-io.ts';
import { run } from './run.ts';
import type { CliIo } from './run.ts';

async function inFolder(body: (folder: string, io: CliIo) => Promise<void>) {
  const folder = await mkdtemp(join(tmpdir(), 'redlines-docx-'));
  try {
    await body(folder, { ...nodeIo, stdout: () => undefined, stderr: () => undefined });
  } finally {
    await rm(folder, { recursive: true });
  }
}

describe('redlines export-docx', () => {
  it('writes a .docx beside the file, or where -o says', async () => {
    await inFolder(async (folder, io) => {
      const file = join(folder, 'plan.md');
      await writeFile(file, 'Hello **world**.\n');
      expect(await run(['export-docx', file], io)).toBe(0);
      const bytes = await readFile(join(folder, 'plan.docx'));
      expect([...bytes.subarray(0, 2)]).toEqual([0x50, 0x4b]);
      expect(await run(['export-docx', file, '-o', join(folder, 'x.docx')], io)).toBe(0);
      expect((await readFile(join(folder, 'x.docx'))).length).toBeGreaterThan(100);
    });
  });
  it('needs a file, and refuses an unknown option', async () => {
    await inFolder(async (_folder, io) => {
      expect(await run(['export-docx'], io)).toBe(2);
      expect(await run(['export-docx', 'a.md', '--nope'], io)).toBe(2);
    });
  });
});

describe('redlines import-docx', () => {
  it('turns a .docx back into Markdown, and never writes over a file', async () => {
    await inFolder(async (folder, io) => {
      const file = join(folder, 'plan.md');
      await writeFile(file, 'Hello **world**.\n');
      expect(await run(['export-docx', file], io)).toBe(0);
      const docx = join(folder, 'plan.docx');
      expect(await run(['import-docx', docx, '-o', join(folder, 'back.md')], io)).toBe(0);
      expect(await readFile(join(folder, 'back.md'), 'utf8')).toContain('Hello **world**.');
      // Beside the .docx, the name is taken by plan.md.
      expect(await run(['import-docx', docx], io)).toBe(1);
      expect(await run(['import-docx'], io)).toBe(2);
    });
  });
});
