// The files, the terminal and the clock of the machine the command line runs on.

import { randomBytes } from 'node:crypto';
import {
  access,
  chmod,
  constants,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { buffer } from 'node:stream/consumers';
import { notUtf8 } from './files.ts';
import type { ReportEntry } from '@redlines/word';
import type { CliIo } from './run.ts';

/** The text of `bytes`, which came from `source`. It is decoded so that writing it back gives the
 * same bytes (format §9.2): a byte order mark stays as U+FEFF, and bytes that aren't UTF-8 throw
 * instead of becoming U+FFFD. */
function decode(bytes: Uint8Array, source: string): string {
  try {
    return new TextDecoder('utf-8', { ignoreBOM: true, fatal: true }).decode(bytes);
  } catch {
    throw notUtf8(source);
  }
}

/** The largest picture the export reads: Word's own limit for a picture is far under it. */
const MAX_PICTURE_BYTES = 50 * 1024 * 1024;

/**
 * The pictures a Markdown file links by a relative path, read from the file's own folder and what is
 * under it, where its images folder is (#523). Another address (a web address, an absolute path, a
 * `file:` link) and a path that leaves the folder, even by a symbolic link, is no picture of this
 * file's: it gives nothing, and the export says the picture is written as its description.
 */
export function imagesBeside(file: string): (src: string) => Promise<Uint8Array | undefined> {
  const folder = dirname(resolve(file));
  return async (src) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(src) || /^[/\\]/.test(src)) return undefined;
    let relative: string;
    try {
      relative = decodeURIComponent(src.replace(/[?#].*$/s, ''));
    } catch {
      return undefined;
    }
    try {
      const root = await realpath(folder);
      const path = await realpath(resolve(folder, relative));
      if (!path.startsWith(root + sep)) return undefined;
      const info = await stat(path);
      if (!info.isFile() || info.size > MAX_PICTURE_BYTES) return undefined;
      return new Uint8Array(await readFile(path));
    } catch {
      return undefined;
    }
  };
}

/** A reader that stops reading, as `head` does after its first line, closes the pipe. That is not
 * a failure of ours, so writing to it raises no error. A program that reads through a socket, as
 * Node's child processes do on macOS, can leave it as ENOTCONN instead of EPIPE. */
export function ignoreBrokenPipe(stream: NodeJS.EventEmitter): void {
  stream.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code !== 'EPIPE' && error.code !== 'ENOTCONN') throw error;
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
  randomHex: (n) => randomBytes(n).toString('hex'),
  writeBytes: async (path, bytes) => {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  },
  readBytes: async (path) => new Uint8Array(await readFile(path)),
  async importDocx(bytes) {
    const { importDocx } = await import('@redlines/word');
    const result = importDocx(bytes);
    const notes = result.report.entries.map((entry) => entry.message);
    return { markdown: result.markdown, notes, media: result.media };
  },
  async exportDocx(text, file) {
    // Loaded here and not in `run.ts`, so the program in the app, which has no Node, never holds it.
    const { exportDocx } = await import('@redlines/word');
    const report: ReportEntry[] = [];
    const bytes = await exportDocx(text, {
      report,
      ...(file === undefined ? {} : { images: imagesBeside(file) }),
    });
    return { bytes, notes: report.map((entry) => entry.message) };
  },
};
