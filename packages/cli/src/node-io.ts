// The files, the terminal and the clock of the machine the command line runs on.

import {
  access,
  chmod,
  constants,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { buffer } from 'node:stream/consumers';
import { EditError } from '@redlines/format';
import type { CliIo } from './main.ts';

/** The text of `bytes`, which came from `source`. It is decoded so that writing it back gives the
 * same bytes (format §9.2): a byte order mark stays as U+FEFF, and bytes that aren't UTF-8 throw
 * instead of becoming U+FFFD. */
function decode(bytes: Uint8Array, source: string): string {
  try {
    return new TextDecoder('utf-8', { ignoreBOM: true, fatal: true }).decode(bytes);
  } catch {
    throw new EditError(
      `${source} isn't UTF-8 text, so redlines can't change it without damaging it.`,
    );
  }
}

/** A reader that stops reading, as `head` does after its first line, closes the pipe. That is not
 * a failure of ours, so writing to it raises no error. */
export function ignoreBrokenPipe(stream: NodeJS.WriteStream): void {
  stream.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code !== 'EPIPE') throw error;
  });
}

export const nodeIo: CliIo = {
  readFile: async (path) => decode(await readFile(path), path),
  async writeFile(path, text, mode) {
    await writeFile(path, text, { encoding: 'utf8', mode });
    // The mode given to a new file is cut down by the umask; this sets it as it was asked.
    if (mode !== undefined) await chmod(path, mode);
  },
  realpath: (path) => realpath(path),
  modeOf: async (path) => (await stat(path)).mode & 0o7777,
  async canWrite(path) {
    try {
      await access(path, constants.W_OK);
      return true;
    } catch (error) {
      // Not being allowed to is an answer; a file that isn't there is not.
      if (['EACCES', 'EPERM', 'EROFS'].includes((error as NodeJS.ErrnoException).code ?? '')) {
        return false;
      }
      throw error;
    }
  },
  rename: (from, to) => rename(from, to),
  remove: (path) => rm(path),
  readStdin: async () => decode(await buffer(process.stdin), 'Standard input'),
  stdout: (s) => {
    process.stdout.write(s);
  },
  stderr: (s) => {
    process.stderr.write(s);
  },
  now: () => new Date(),
};
