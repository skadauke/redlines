import {
  chmod,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EditError } from '@redlines/format';
import { nodeIo } from './node-io.ts';

let directory = '';

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'redlines-io-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

/** A file in a scratch directory. */
async function fileWith(content: string | Buffer, name = 'plan.md'): Promise<string> {
  const path = join(directory, name);
  await writeFile(path, content);
  return path;
}

describe('reading a file', () => {
  it('gives the text of a UTF-8 file, with its byte order mark and emoji', async () => {
    const path = await fileWith('﻿Plan 🎉\r\nCafé\n');
    expect(await nodeIo.readFile(path)).toBe('﻿Plan 🎉\r\nCafé\n');
  });

  it('refuses a file that is not UTF-8 text, such as "Café" in Latin-1', async () => {
    const path = await fileWith(Buffer.from([0x43, 0x61, 0x66, 0xe9]));
    const error = await nodeIo.readFile(path).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EditError);
    expect((error as EditError).message).toBe(
      `${path} isn't UTF-8 text, so redlines can't change it without damaging it.`,
    );
  });

  it('refuses a file that ends in the middle of a character', async () => {
    const path = await fileWith(Buffer.from([0x43, 0xf0, 0x9f, 0x8e])); // "C" and 3 bytes of 🎉
    await expect(nodeIo.readFile(path)).rejects.toBeInstanceOf(EditError);
  });

  it('says why a file cannot be read, as the system does', async () => {
    await expect(nodeIo.readFile(join(directory, 'missing.md'))).rejects.toThrow(/ENOENT/);
  });
});

describe('writing a file', () => {
  it('writes UTF-8 text', async () => {
    const path = join(directory, 'new.md');
    await nodeIo.writeFile(path, '﻿Plan 🎉\r\n');
    expect(await readFile(path)).toEqual(Buffer.from('﻿Plan 🎉\r\n', 'utf8'));
  });

  it('gives a new file the mode asked for, whatever the umask says', async () => {
    const path = join(directory, 'new.md');
    await nodeIo.writeFile(path, 'text', 0o664);
    expect((await stat(path)).mode & 0o7777).toBe(0o664);
  });

  it('tells the mode of a file', async () => {
    const path = await fileWith('text');
    await chmod(path, 0o640);
    expect(await nodeIo.modeOf(path)).toBe(0o640);
  });

  it('tells whether a file can be written to', async () => {
    const path = await fileWith('text');
    expect(await nodeIo.canWrite(path)).toBe(true);
    // A superuser can write to any file.
    if (process.getuid?.() !== 0) {
      await chmod(path, 0o444);
      expect(await nodeIo.canWrite(path)).toBe(false);
    }
  });

  it('does not take a file that is not there for one that cannot be written', async () => {
    await expect(nodeIo.canWrite(join(directory, 'missing.md'))).rejects.toThrow(/ENOENT/);
  });
});

describe('replacing a file', () => {
  it('renames a file over another in one step', async () => {
    const path = await fileWith('old');
    const temp = await fileWith('new', '.plan.md.tmp');
    await nodeIo.rename(temp, path);
    expect(await readFile(path, 'utf8')).toBe('new');
    expect(await readdir(directory)).toEqual(['plan.md']);
  });

  it('finds the file that a symbolic link leads to', async () => {
    const path = await fileWith('text');
    const link = join(directory, 'link.md');
    await symlink(path, link);
    expect(await nodeIo.realpath(link)).toBe(await realpath(path));
  });

  it('removes a file, and says when there is none', async () => {
    const path = await fileWith('text');
    await nodeIo.remove(path);
    expect(await readdir(directory)).toEqual([]);
    await expect(nodeIo.remove(path)).rejects.toThrow(/ENOENT/);
  });
});
