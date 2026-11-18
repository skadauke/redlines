import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
  it('never replaces a .docx it was not told to: only -o names the file to replace', async () => {
    await inFolder(async (folder, io) => {
      const file = join(folder, 'plan.md');
      await writeFile(file, 'Hello.\n');
      const docx = join(folder, 'plan.docx');
      await writeFile(docx, 'mine');
      const said: string[] = [];
      expect(await run(['export-docx', file], { ...io, stderr: (s) => void said.push(s) })).toBe(1);
      expect(said.join('')).toContain(`-o ${docx}`);
      expect(await readFile(docx, 'utf8')).toBe('mine');
      expect(await run(['export-docx', file, '-o', docx], io)).toBe(0);
      expect([...(await readFile(docx)).subarray(0, 2)]).toEqual([0x50, 0x4b]);
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
      // An -o that names a file that is there is refused too, and a corrupt file is a message.
      expect(await run(['import-docx', docx, '-o', file], io)).toBe(1);
      await writeFile(join(folder, 'bad.docx'), 'not a zip');
      expect(await run(['import-docx', join(folder, 'bad.docx')], io)).toBe(1);
    });
  });
});

describe('redlines import-docx with pictures', () => {
  it('takes its pictures away again when the Markdown cannot be written', async () => {
    await inFolder(async (folder, io) => {
      const docx = join(folder, 'pic.docx');
      await copyFile(new URL('./picture.fixture.docx', import.meta.url), docx);
      const failing: CliIo = {
        ...io,
        writeFile: () => Promise.reject(new Error('disk full')),
      };
      expect(await run(['import-docx', docx, '-o', join(folder, 'out', 'pic.md')], failing)).toBe(
        1,
      );
      await expect(readFile(join(folder, 'out', 'media', 'image1.png'))).rejects.toThrow();
      expect(await run(['import-docx', docx, '-o', join(folder, 'out', 'pic.md')], io)).toBe(0);
    });
  });
  it('writes the pictures beside the Markdown, where its links name them', async () => {
    await inFolder(async (folder, io) => {
      const docx = join(folder, 'pic.docx');
      await copyFile(new URL('./picture.fixture.docx', import.meta.url), docx);
      expect(await run(['import-docx', docx, '-o', join(folder, 'out', 'pic.md')], io)).toBe(0);
      const markdown = await readFile(join(folder, 'out', 'pic.md'), 'utf8');
      expect(markdown).toMatch(/!\[A dot\]\(media\/image1\.png\)/);
      const png = await readFile(join(folder, 'out', 'media', 'image1.png'));
      expect([...png.subarray(1, 4)]).toEqual([0x50, 0x4e, 0x47]);
      // A second import to the same folder doesn't replace the picture.
      expect(await run(['import-docx', docx, '-o', join(folder, 'out', 'again.md')], io)).toBe(1);
    });
  });
});

const DOT = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describe('redlines export-docx with pictures', () => {
  it('embeds a picture beside the document, and says when one is missing', async () => {
    await inFolder(async (folder, io) => {
      await mkdir(join(folder, 'media'));
      await writeFile(join(folder, 'media', 'dot.png'), DOT);
      const file = join(folder, 'pic.md');
      await writeFile(file, 'Before.\n\n![A dot](media/dot.png)\n');
      const said: string[] = [];
      const loud = { ...io, stderr: (s: string) => void said.push(s) };
      expect(await run(['export-docx', file], loud)).toBe(0);
      expect(said.join('')).not.toContain('not in the Word file');
      const back = join(folder, 'o', 'p.md');
      expect(await run(['import-docx', join(folder, 'pic.docx'), '-o', back], io)).toBe(0);
      const png = await readFile(join(folder, 'o', 'media', 'image1.png'));
      expect(png.subarray(1, 4).toString()).toBe('PNG');

      await writeFile(file, '![Gone](media/gone.png)\n');
      said.length = 0;
      expect(await run(['export-docx', file, '-o', join(folder, 'g.docx')], loud)).toBe(0);
      expect(said.join('')).toContain('An image is written as its description');
    });
  });
  it('says a picture could not be read, and does not read a file past the cap', async () => {
    await inFolder(async (folder, io) => {
      // A folder named like a picture is a file that cannot be read.
      await mkdir(join(folder, 'unreadable.png'));
      await writeFile(join(folder, 'big.png'), DOT);
      await expect(io.readBytes?.(join(folder, 'big.png'), 10)).rejects.toThrow('too large');
      expect((await io.readBytes?.(join(folder, 'big.png'), 1000))?.length).toBe(DOT.length);
      const file = join(folder, 'u.md');
      await writeFile(file, '![x](unreadable.png)\n');
      const said: string[] = [];
      const loud = { ...io, stderr: (s: string) => void said.push(s) };
      expect(await run(['export-docx', file], loud)).toBe(0);
      expect(said.join('')).toContain('it could not be read');
    });
  });
});
